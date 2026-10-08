import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("check-pages-payload.py")
spec = importlib.util.spec_from_file_location("pages_payload", SCRIPT)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
REPO = SCRIPT.parents[2]
SOURCE_UPLOAD_PATH = "${{ steps.build-frontend.outputs.site_dir || 'frontend/dist' }}"


class PagesPayloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / "dist"
        self.root.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, value=b"payload"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
        return path

    def reject(self, message):
        with self.assertRaisesRegex(guard.PayloadError, message) as failure:
            guard.check_payload(self.root)
        self.assertFalse(failure.exception.report["ok"])
        return failure.exception.report

    def test_physical_boundary_below_exact_and_over(self):
        # Bounds can only be injected by the test importing this module.
        for size in (2, 3, 4):
            with self.subTest(size=size), patch.object(guard, "SITE_LIMIT_BYTES", 3):
                self.write("index.html", b"x" * size)
                if size <= 3:
                    result = guard.check_payload(self.root)
                    self.assertTrue(result["ok"])
                    self.assertEqual(result["file_bytes"], size)
                else:
                    with patch.object(guard, "_measure_tar_bytes") as measure:
                        result = self.reject("Uncompressed site file bytes exceed")
                    measure.assert_not_called()
                    self.assertEqual(result["file_bytes"], size)
                    self.assertIsNone(result["tar_bytes"])

    def test_tar_boundary_below_exact_and_over_includes_overhead(self):
        self.write("index.html", b"x")
        actual = guard.check_payload(self.root)["tar_bytes"]
        self.assertEqual(actual, 10_240)
        for limit in (actual + 1, actual, actual - 1):
            with self.subTest(limit=limit), patch.object(guard, "TAR_LIMIT_BYTES", limit):
                if limit >= actual:
                    self.assertTrue(guard.check_payload(self.root)["ok"])
                else:
                    result = self.reject("Uncompressed Pages TAR exceeds")
                    self.assertEqual(result["file_bytes"], 1)
                    self.assertEqual(result["tar_bytes"], actual)

    def test_counts_names_directories_hidden_files_and_real_tar_padding(self):
        values = {
            "index.html": b"index",
            "empty": b"",
            "nested/asset.js": b"12345",
            ".hidden": b"conservatively counted",
            ".git/config": b"also counted",
            f"{'long-' * 24}/日本語.txt": b"unicode and long GNU TAR names",
        }
        for name, value in values.items():
            self.write(name, value)
        (self.root / "empty-directory").mkdir()
        result = guard.check_payload(self.root)
        self.assertEqual(result["file_bytes"], sum(map(len, values.values())))
        self.assertEqual(result["file_count"], len(values))
        self.assertEqual(result["directory_count"], 5)
        paths = [str(path.relative_to(self.root)) for path in self.root.rglob("*")]
        self.assertEqual(result["path_bytes"], sum(len(path.encode()) for path in paths))
        # Independent oracle: upstream v4's actual GNU TAR flags, on a tiny tree.
        archive = subprocess.run([
            "tar", "--dereference", "--hard-dereference", "--directory", str(self.root),
            "-cf", "-", "--exclude=.git", "--exclude=.github", "--exclude=.[^/]*", ".",
        ], check=True, capture_output=True).stdout
        self.assertEqual(result["tar_bytes"], len(archive))
        with tarfile.open(fileobj=io.BytesIO(archive)) as handle:
            names = handle.getnames()
        self.assertNotIn("./.hidden", names)
        self.assertNotIn("./.git/config", names)
        self.assertIn("./nested/asset.js", names)
        self.assertEqual(set(paths), {str(path.relative_to(self.root)) for path in self.root.rglob("*")})
        for name, value in values.items():
            self.assertEqual((self.root / name).read_bytes(), value)

    def test_many_empty_files_can_exceed_tar_limit(self):
        for number in range(30):
            self.write(f"empty-{number}", b"")
        with patch.object(guard, "TAR_LIMIT_BYTES", 10_240):
            result = self.reject("Uncompressed Pages TAR exceeds")
        self.assertEqual(result["file_bytes"], 0)
        self.assertEqual(result["file_count"], 30)
        self.assertGreater(result["tar_bytes"], 10_240)

    def test_nested_and_hidden_symlinks_are_rejected(self):
        outside = self.base / "outside"
        outside.write_bytes(b"do not follow")
        for name in ("link", ".hidden-link", "nested/link"):
            with self.subTest(name=name):
                path = self.root / name
                path.parent.mkdir(exist_ok=True)
                path.symlink_to(outside)
                self.reject("Symlink or special file")
                path.unlink()

    def test_root_and_ancestor_symlinks_are_rejected(self):
        alias = self.base / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        for path in (alias, alias / "child"):
            with self.subTest(path=path), self.assertRaises(guard.PayloadError):
                guard.check_payload(path)
        self.assertTrue(alias.is_symlink())

    def test_hardlink_to_outside_or_inside_is_rejected(self):
        original = self.write("original")
        for target in (self.base / "outside-link", self.root / "inside-link"):
            with self.subTest(target=target):
                os.link(original, target)
                self.reject("Hard-linked file")
                target.unlink()

    def test_fifo_is_rejected_without_opening(self):
        fifo = self.root / "fifo"
        os.mkfifo(fifo)
        self.reject("Symlink or special file")

    def test_unsafe_and_missing_paths_fail_closed(self):
        for name in ("bad\nname", "bad\\name", "bad\x7fname"):
            with self.subTest(name=name):
                path = self.write(name)
                self.reject("Unsafe payload path")
                path.unlink()
        for path in ("", "/", self.root / ".." / "dist", self.base / "missing"):
            with self.subTest(path=path), self.assertRaises(guard.PayloadError):
                guard.check_payload(path)

    def test_same_size_rewrite_with_restored_mtime_is_rejected(self):
        path = self.write("index.html", b"original")
        before = path.stat()
        measure = guard._measure_tar_bytes

        def mutate(root_fd):
            result = measure(root_fd)
            path.write_bytes(b"modified")
            os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
            return result

        with patch.object(guard, "_measure_tar_bytes", side_effect=mutate):
            self.reject("Payload changed during measurement")

    def test_addition_removal_and_root_replacement_are_rejected(self):
        for mutation in ("add", "remove", "replace-root"):
            with self.subTest(mutation=mutation):
                path = self.write("index.html")
                measure = guard._measure_tar_bytes

                def mutate(root_fd):
                    result = measure(root_fd)
                    if mutation == "add":
                        self.write("new")
                    elif mutation == "remove":
                        path.unlink()
                    else:
                        self.root.rename(self.base / "old-dist")
                        self.root.mkdir()
                        self.write("index.html")
                    return result

                with patch.object(guard, "_measure_tar_bytes", side_effect=mutate):
                    self.reject("Payload changed during measurement")

    def test_file_replaced_during_open_is_rejected(self):
        self.write("index.html")
        original_open = os.open

        def replace(name, flags, **kwargs):
            if name == "index.html":
                (self.root / name).unlink()
                os.mkfifo(self.root / name)
                self.assertTrue(flags & os.O_NONBLOCK)
            return original_open(name, flags, **kwargs)

        with patch.object(guard.os, "open", side_effect=replace):
            self.reject("Payload changed while opening")

    def test_tar_failure_is_rejected(self):
        self.write("index.html")
        with patch.object(guard.subprocess, "Popen", side_effect=OSError("tar unavailable")):
            self.reject("tar unavailable")

    def test_partial_tar_error_or_warning_is_rejected(self):
        self.write("index.html")
        for status, diagnostic in ((2, b""), (0, b"tar: file changed as we read it")):
            with self.subTest(status=status, diagnostic=diagnostic):
                class Process:
                    stdout = io.BytesIO(b"incomplete tar stream")

                    def __enter__(self):
                        return self

                    def __exit__(self, *_):
                        self.stdout.close()

                    def wait(self):
                        return status

                def spawn(*_, **kwargs):
                    kwargs["stderr"].write(diagnostic)
                    return Process()

                version = subprocess.CompletedProcess(["tar", "--version"], 0, "tar (GNU tar) 1.35")
                with patch.object(guard.subprocess, "run", return_value=version), \
                        patch.object(guard.subprocess, "Popen", side_effect=spawn):
                    self.reject("TAR measurement failed")

    def test_tar_environment_changes_are_rejected(self):
        for variable in ("TAR_OPTIONS", "POSIXLY_CORRECT"):
            with self.subTest(variable=variable), patch.dict(os.environ, {variable: ""}):
                self.reject("must be absent")

    def test_cli_has_fixed_decimal_limits_and_no_override(self):
        path = self.root / "large-sparse-file"
        with path.open("wb") as handle:
            handle.truncate(1_000_000_001)
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.root)],
                                capture_output=True, text=True,
                                env={**os.environ, "SITE_LIMIT_BYTES": "9999999999",
                                     "TAR_LIMIT_BYTES": "9999999999"})
        self.assertEqual(result.returncode, 1)
        report = json.loads(result.stdout)
        self.assertEqual(report["site_limit_bytes"], 1_000_000_000)
        self.assertEqual(report["tar_limit_bytes"], 1_000_000_000)
        self.assertEqual(report["file_bytes"], 1_000_000_001)
        self.assertIsNone(report["tar_bytes"])
        self.assertEqual(path.stat().st_size, 1_000_000_001)
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.root),
                                 "--site-limit-bytes", "9999999999"], capture_output=True)
        self.assertEqual(result.returncode, 2)


class WorkflowScopeTests(unittest.TestCase):
    def test_every_final_pages_upload_is_guarded_and_intermediate_is_separate(self):
        # Intentionally strict about these block-style steps. A new action or
        # changed workflow shape must receive an explicit publication review.
        uploads = []
        deploys = []
        for workflow in sorted((REPO / ".github/workflows").glob("*.y*ml")):
            text = workflow.read_text()
            steps = re.split(r"(?m)^      - ", text)[1:]

            def field(step, key):
                match = re.search(rf"(?m)^\s*{key}:\s*(.*?)\s*$", step)
                return match.group(1) if match else None

            def input_field(step, key):
                match = re.search(rf"(?m)^          {key}: *(.*?) *$", step)
                return match.group(1) if match else None

            found = 0
            found_deploys = 0
            for index, step in enumerate(steps):
                action = field(step, "uses")
                if action and action.startswith("actions/deploy-pages@"):
                    found_deploys += 1
                    deploys.append((workflow.name, input_field(step, "artifact_name"), field(step, "if")))
                if not action or not action.startswith("actions/upload-pages-artifact@"):
                    continue
                found += 1
                uploads.append((workflow.name, input_field(step, "path")))
                self.assertEqual(action, "actions/upload-pages-artifact@v4")
                if workflow.name == "static-site.yml":
                    # This is source material for a later rebuild, never a
                    # deployed Pages artifact. Preserve its own archive bounds.
                    self.assertEqual(input_field(step, "path"), SOURCE_UPLOAD_PATH)
                    self.assertEqual(input_field(step, "name"), "static-site-data-${{ github.run_id }}-${{ github.run_attempt }}")
                    self.assertNotIn("actions/deploy-pages@", text)
                    builds = [(i, s) for i, s in enumerate(steps)
                              if field(s, "id") == "build-frontend"]
                    self.assertEqual(len(builds), 1)
                    build_index, build = builds[0]
                    self.assertEqual(field(build, "name"), "Build static frontend")
                    self.assertEqual(input_field(build, "PRICE_REPAIR"),
                                     "${{ needs.select-markets.outputs.repair }}")
                    branches = re.search(r'if \[ "\$PRICE_REPAIR" = "true" \]; then\n'
                                         r'(.*?)\n          else\n(.*?)\n          fi', build, re.S)
                    self.assertIsNotNone(branches)
                    self.assertEqual(branches.group(1).strip(),
                                     'node .github/scripts/retained-price-source-admission.mjs produce '
                                     '--output "$RUNNER_TEMP/retained-price-source" '
                                     '--job-start "$RUNNER_TEMP/retained-price-source-job-start"')
                    self.assertIn('            cd frontend\n', branches.group(2))
                    self.assertIn('            npm run build\n', branches.group(2))
                    verifiers = [(i, s) for i, s in enumerate(steps)
                                 if field(s, "name") == "Verify finite retained-price repair"]
                    self.assertEqual(len(verifiers), 1)
                    verify_index, verification = verifiers[0]
                    self.assertLess(build_index, verify_index)
                    self.assertLess(verify_index, index)
                    self.assertEqual(field(verification, "if"), "needs.select-markets.outputs.repair == 'true'")
                    self.assertEqual(field(verification, "run"),
                                     'node .github/scripts/retained-price-source-admission.mjs verify-produced '
                                     '--output "$RUNNER_TEMP/retained-price-source"')
                    # Default success() makes a build or verification failure
                    # block upload; an always() override must never bypass it.
                    self.assertIsNone(field(build, "if"))
                    self.assertIsNone(field(step, "if"))
                    self.assertNotIn("continue-on-error:", build + verification + step)
                    self.assertNotIn("working-directory:", build + verification + step)
                    continue
                self.assertEqual(workflow.name, "research-ui-release.yml")
                # The finite-only amendment authenticates at both build boundaries
                # using the existing scoped token. Build/quality/Pages limits stay exact.
                build_steps = [(i, s) for i, s in enumerate(steps)
                               if field(s, "name") == "Build with daily selection export"]
                self.assertEqual(len(build_steps), 1)
                build_index, build = build_steps[0]
                self.assertLess(build_index, index)
                self.assertEqual(field(build, "working-directory"), "release/frontend")
                self.assertEqual(input_field(build, "GH_TOKEN"), "${{ github.token }}")
                self.assertEqual(field(build, "if"), "steps.plan.outputs.publish == 'true'")
                self.assertNotIn("continue-on-error:", build)
                self.assertIn("        run: |\n", build)
                commands = [line.strip() for line in build.split("        run: |\n", 1)[1].splitlines() if line.strip()]
                self.assertEqual(commands, [
                    "(cd ../.. && node .github/scripts/select-release-source.mjs publisher-build-before)",
                    'if [ "$METADATA_MIGRATION" != true ] && [ "$FINANCIAL_ACTIVATION" != true ] && [ "$FINANCIAL_SOURCE_RENEWAL" != true ]; then npm run build; fi',
                    "node tools/check-data-quality.mjs",
                    "(cd ../.. && node .github/scripts/select-release-source.mjs publisher-build-after)",
                ])
                self.assertEqual(input_field(step, "path"), "release/frontend/dist")
                self.assertEqual(input_field(step, "name"), "github-pages-${{ github.run_id }}-${{ github.run_attempt }}")
                self.assertGreater(index, 0)
                previous = steps[index - 1]
                self.assertEqual(field(previous, "run"), "python3 .github/scripts/check-pages-payload.py release/frontend/dist")
                condition = "steps.plan.outputs.publish == 'true' && steps.plan.outputs.correction != 'true'"
                self.assertEqual(field(previous, "if"), condition)
                self.assertEqual(field(step, "if"), condition)
                self.assertNotIn("continue-on-error:", previous + step)
                self.assertNotIn("working-directory:", previous)
                self.assertNotIn("env:", previous)
            # Catch alternative indentation/flow syntax instead of overlooking it.
            self.assertEqual(found, len(re.findall(r"uses:\s*['\"]?actions/upload-pages-artifact@", text)))
            self.assertEqual(found_deploys, len(re.findall(r"uses:\s*['\"]?actions/deploy-pages@", text)))
        self.assertEqual(sorted(uploads), [("research-ui-release.yml", "release/frontend/dist"),
                                           ("static-site.yml", SOURCE_UPLOAD_PATH)])
        self.assertEqual(deploys, [("research-ui-release.yml",
                                   "github-pages-${{ github.run_id }}-${{ github.run_attempt }}",
                                   "steps.plan.outputs.publish == 'true' && steps.plan.outputs.correction != 'true'")])
        ci = (REPO / ".github/workflows/ci.yml").read_text()
        self.assertIn("python3 -m unittest discover -s .github/scripts -p test_check_pages_payload.py", ci)

    def assert_static_mutation_rejected(self, original, changed):
        self.assertNotEqual(changed, original, "Mutation must change the actual workflow")
        static = REPO / ".github/workflows/static-site.yml"
        read_text = Path.read_text

        def mutated_read(path, *args, **kwargs):
            return changed if path == static else read_text(path, *args, **kwargs)

        with patch.object(Path, "read_text", mutated_read):
            with self.assertRaises(AssertionError):
                self.test_every_final_pages_upload_is_guarded_and_intermediate_is_separate()

    def test_source_upload_rejects_arbitrary_paths_and_unowned_build_outputs(self):
        text = (REPO / ".github/workflows/static-site.yml").read_text()
        for path in ("frontend/dist", "/tmp/unreviewed", "${{ inputs.path }}",
                     "${{ steps.unverified.outputs.site_dir || 'frontend/dist' }}",
                     "${{ steps.build-frontend.outputs.site_dir || 'arbitrary/dist' }}"):
            with self.subTest(path=path):
                self.assert_static_mutation_rejected(text, text.replace(SOURCE_UPLOAD_PATH, path, 1))
        for before, after in (("id: build-frontend", "id: unrelated-build"),
                              ('produce --output "$RUNNER_TEMP/retained-price-source"',
                               'produce --output "$RUNNER_TEMP/arbitrary-source"')):
            with self.subTest(owner=after):
                self.assert_static_mutation_rejected(text, text.replace(before, after, 1))

    def test_source_upload_rejects_missing_failed_or_late_finite_verification(self):
        text = (REPO / ".github/workflows/static-site.yml").read_text()
        verification = re.search(r'(?m)^      - name: Verify finite retained-price repair\n'
                                 r'[\s\S]*?(?=^      - )', text).group(0)
        upload = re.search(r'(?m)^      - name: Upload verified data export\n'
                          r'[\s\S]*?(?=^      - )', text).group(0)
        mutations = {
            "missing": text.replace(verification, "", 1),
            "wrong condition": text.replace(verification, verification.replace("== 'true'", "!= 'true'"), 1),
            "unchecked command": text.replace(verification, verification.replace("run: node", "run: echo node"), 1),
            "ignored failure": text.replace(verification, verification.replace("        env:", "        continue-on-error: true\n        env:"), 1),
            "upload after failure": text.replace(upload, upload.replace("        id:", "        if: always()\n        id:"), 1),
            "late verification": text.replace(verification, "", 1).replace(upload, upload + verification, 1),
        }
        for reason, changed in mutations.items():
            with self.subTest(reason=reason):
                self.assert_static_mutation_rejected(text, changed)



    def assert_publisher_mutation_rejected(self, original, changed):
        self.assertNotEqual(changed, original, "Mutation must change the actual workflow")
        publisher = REPO / ".github/workflows/research-ui-release.yml"
        read_text = Path.read_text

        def mutated_read(path, *args, **kwargs):
            return changed if path == publisher else read_text(path, *args, **kwargs)

        with patch.object(Path, "read_text", mutated_read), self.assertRaises(AssertionError):
            self.test_every_final_pages_upload_is_guarded_and_intermediate_is_separate()

    def test_publisher_tooling_build_guard_and_token_mutations_fail_closed(self):
        text = (REPO / ".github/workflows/research-ui-release.yml").read_text()
        build = re.search(r'(?m)^      - name: Build with daily selection export\n'
                          r'[\s\S]*?(?=^      - )', text).group(0)
        before = "(cd ../.. && node .github/scripts/select-release-source.mjs publisher-build-before)"
        after = "(cd ../.. && node .github/scripts/select-release-source.mjs publisher-build-after)"
        mutations = {
            "missing before": build.replace("          " + before + "\n", "", 1),
            "missing after": build.replace("          " + after + "\n", "", 1),
            "wrong caller cwd": build.replace("(cd ../.. && node", "(node", 1),
            "wrong before command": build.replace("publisher-build-before", "compose", 1),
            "missing original quality": build.replace("          node tools/check-data-quality.mjs\n", "", 1),
            "changed original build guard": build.replace('"$FINANCIAL_SOURCE_RENEWAL" != true', '"$FINANCIAL_SOURCE_RENEWAL" = true', 1),
            "missing token": build.replace("          GH_TOKEN: ${{ github.token }}\n", "", 1),
            "new token": build.replace("GH_TOKEN: ${{ github.token }}", "GH_TOKEN: ${{ secrets.EXTRA_TOKEN }}", 1),
            "ignored failure": build.replace("        env:", "        continue-on-error: true\n        env:", 1),
        }
        for reason, changed in mutations.items():
            with self.subTest(reason=reason):
                self.assert_publisher_mutation_rejected(text, text.replace(build, changed, 1))


if __name__ == "__main__":
    unittest.main()
