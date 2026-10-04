import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("retain-financial-diagnostic.py")
spec = importlib.util.spec_from_file_location("diagnostic", SCRIPT)
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


class RetainFinancialDiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / "financial-release-candidate/prepared"
        self.root.mkdir(parents=True)
        self.output = self.root.parent / "unapproved-financial-diagnostic.tar.gz"
        self.context = dict(repository="kusennjp1-ai/screener", head_sha="a" * 40, run_id="123", run_attempt="2",
                            preparation_outcome="success", candidate="true", design_status="failure")
        self.limits = dict(maximum_archive_files=100, maximum_archive_bytes=8 * 1024 * 1024)
        self.files = {
            "corrected/index.html": b"<html>exact prepared build</html>\n",
            "corrected/assets/app.js": b"original UI bytes\x00\xff",
            "corrected/static-data/manifest.json": b'{"as_of_date":"2026-10-02"}\n',
            "corrected/research-daily.json": b'{"rows":[]}\n',
            "projection/native.json": b'{"projection":"native"}\n',
            "projection/source.json": b'{"projection":"original"}\n',
            **{name: b' { "original": true }\n' for name in diagnostic.MEMBERS[3:]},
        }
        ui = {name.removeprefix("corrected/"): self.hash(value) for name, value in self.files.items() if name.startswith("corrected/")}
        is_data = lambda name: name.startswith("static-data/") or name in diagnostic.DATA_FILES
        self.receipt = {
            "schema_version": "financial-candidate-preview-v2", "kind": "unpublished_financial_candidate",
            "publication_authority": "none", "candidate_ui": {"sha": "b" * 40, "tree": "c" * 40, "digest": diagnostic.digest({k: v for k, v in ui.items() if not is_data(k)})},
            "bundles": {"corrected_data_sha256": diagnostic.digest({k: v for k, v in ui.items() if is_data(k)})},
            "financial": {"projection_sha256": self.hash(self.files["projection/native.json"])},
            "destination_projection": {"derivation": {"source_projection_sha256": self.hash(self.files["projection/source.json"])}},
            "source_evidence_sha256": self.hash(self.files["evidence.json"]),
            "verification_sha256": self.hash(self.files["verification.json"]),
        }
        self.files["preview-receipt.json"] = json.dumps(self.receipt, indent=2).encode() + b"\n"
        for name, data in self.files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def hash(data):
        return hashlib.sha256(data).hexdigest()

    def retain(self):
        return diagnostic.retain(self.root, self.output, self.context, self.limits)

    def assert_no_output(self):
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.glob("*.partial")), [])

    def test_exact_original_bytes_inventory_and_no_release_authority(self):
        # An expected dist symlink and pre-existing seal/pin elsewhere are never followed or included.
        (self.base / "dist").symlink_to(self.root / "corrected", target_is_directory=True)
        for name in diagnostic.AUTHORITY_FILES:
            (self.root / name).write_text("existing authority is outside the diagnostic allowlist")
        result = self.retain()
        self.assertEqual(result["sha256"], self.hash(self.output.read_bytes()))
        with tarfile.open(self.output) as archive:
            self.assertTrue(all(item.isfile() or item.isdir() for item in archive))
            names = archive.getnames()
            self.assertEqual(names[0], "UNAPPROVED.txt")
            self.assertFalse(any(Path(name).name in diagnostic.AUTHORITY_FILES for name in names))
            for name, original in self.files.items():
                self.assertEqual(archive.extractfile("review-only/" + name).read(), original)
                self.assertEqual((self.root / name).read_bytes(), original)
            metadata = json.load(archive.extractfile("UNAPPROVED.json"))
        self.assertEqual(metadata["status"], "UNAPPROVED")
        self.assertEqual(metadata["publication_authority"], "none")
        self.assertFalse(metadata["design_accepted"])
        self.assertFalse(metadata["activation_eligible"])
        self.assertEqual(metadata["producer"], {k: self.context[k] for k in ("repository", "head_sha", "run_id", "run_attempt")})
        self.assertEqual(metadata["preview_receipt_sha256"], self.hash(self.files["preview-receipt.json"]))
        self.assertEqual(metadata["files"], {name: {"sha256": self.hash(data), "bytes": len(data)} for name, data in self.files.items()})
        # Existing activation and publication validators cannot consume the diagnostic manifest.
        subprocess.run(["node", "--input-type=module", "-e", """
import assert from 'node:assert/strict';
import {validateCandidateRecord,parseFinancialActivationCandidate} from './.github/scripts/financial-release-activation.mjs';
import {validateReceipt} from './.github/scripts/publication-state.mjs';
const value=JSON.parse(process.argv[1]);
for(const validate of [validateCandidateRecord,parseFinancialActivationCandidate,validateReceipt])assert.throws(()=>validate(value));
""", json.dumps(metadata)], cwd=diagnostic.REPO, check=True, capture_output=True)

    def test_failure_and_cancellation_are_only_eligible_states(self):
        for status in ("success", "skipped", "", "running"):
            with self.subTest(status=status):
                self.context["design_status"] = status
                with self.assertRaisesRegex(ValueError, "unsuccessful Design"):
                    self.retain()
                self.assert_no_output()
        self.context["design_status"] = "cancelled"
        self.retain()
        self.assertTrue(self.output.is_file())

    def test_preparation_and_run_identity_fail_closed(self):
        for key, value in (("preparation_outcome", "failure"), ("candidate", "false"), ("run_id", "0"),
                           ("run_attempt", "latest"), ("head_sha", "main"), ("repository", "other/repo")):
            with self.subTest(key=key):
                original = self.context[key]
                self.context[key] = value
                with self.assertRaises(ValueError):
                    self.retain()
                self.context[key] = original
                self.assert_no_output()

    def test_changed_build_projection_and_evidence_leave_no_archive(self):
        for name in ("corrected/index.html", "corrected/static-data/manifest.json", "projection/native.json", "projection/source.json", "evidence.json", "verification.json"):
            with self.subTest(name=name):
                path = self.root / name
                path.write_bytes(b"changed")
                with self.assertRaises(ValueError):
                    self.retain()
                path.write_bytes(self.files[name])
                self.assert_no_output()

    def test_links_unsafe_names_and_authority_inside_selected_tree_are_rejected(self):
        for name, kind in (("escape", "link"), ("hardlink", "hardlink"), ("bad name", "file"), ("candidate.json", "file"), ("publication.json", "file")):
            with self.subTest(name=name):
                path = self.root / "corrected" / name
                if kind == "link":
                    path.symlink_to(self.base, target_is_directory=True)
                elif kind == "hardlink":
                    os.link(self.root / "corrected/index.html", path)
                else:
                    path.write_text("invalid")
                with self.assertRaises(ValueError):
                    self.retain()
                path.unlink()
                self.assert_no_output()
        alias = self.base / "candidate-link"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            diagnostic.retain(alias, self.output, self.context, self.limits)
        self.assert_no_output()

    def test_bounded_stream_and_changed_input_cleanup_partial_output(self):
        for limits in (dict(maximum_archive_files=2, maximum_archive_bytes=8 * 1024 * 1024),
                       dict(maximum_archive_files=100, maximum_archive_bytes=512)):
            with self.assertRaises(ValueError):
                diagnostic.retain(self.root, self.output, self.context, limits)
            self.assert_no_output()
        original_write = diagnostic.BoundedWriter.write
        def disk_failure(writer, data):
            original_write(writer, data)
            raise OSError("disk full")
        with patch.object(diagnostic.BoundedWriter, "write", disk_failure):
            with self.assertRaisesRegex(OSError, "disk full"):
                self.retain()
        self.assert_no_output()
        original_read = diagnostic.HashReader.read
        def mutate(reader, size=-1):
            data = original_read(reader, size)
            os.utime(self.root / "corrected/index.html", ns=(1, 1))
            return data
        with patch.object(diagnostic.HashReader, "read", mutate):
            with self.assertRaisesRegex(ValueError, "changed"):
                self.retain()
        self.assert_no_output()

    def test_workflow_keeps_success_only_sealing_and_failure_only_diagnostics(self):
        text = (diagnostic.REPO / ".github/workflows/design-acceptance.yml").read_text()
        blocks = {block.splitlines()[0]: block for block in text.split("      - name: ")[1:]}
        prepare = "steps.financial.outcome == 'success' && steps.financial.outputs.candidate == 'true'"
        guard = "if: (failure() || cancelled()) && " + prepare
        package = blocks["Package UNAPPROVED financial diagnostics after unsuccessful Design"]
        upload = blocks["Retain UNAPPROVED financial diagnostics for review only"]
        self.assertIn(guard + "\n", package)
        self.assertIn(guard + " && steps.financial_diagnostic.outcome == 'success'\n", upload)
        self.assertIn("retention-days: 14", upload)
        self.assertIn("compression-level: 0", upload)
        self.assertIn("name: unapproved-financial-diagnostic-${{ github.run_id }}-${{ github.run_attempt }}", upload)
        self.assertNotIn("continue-on-error", package + upload)
        for name in ("Seal the exact tested financial candidate", "Retain the exact tested financial candidate"):
            self.assertIn("if: success() && steps.financial.outputs.candidate == 'true'", blocks[name])
        self.assertLess(text.index("Require reviewed screenshots and four design scores"), text.index("Package UNAPPROVED"))
        self.assertLess(text.index("Retain UNAPPROVED"), text.index("Seal the exact tested"))
        def evaluates(block, failed, cancelled, prepared, candidate, packaged):
            condition = next(line.strip().removeprefix("if: ") for line in block.splitlines() if line.strip().startswith("if: "))
            for token, value in (("failure()", failed), ("cancelled()", cancelled),
                                 ("steps.financial.outcome == 'success'", prepared),
                                 ("steps.financial.outputs.candidate == 'true'", candidate),
                                 ("steps.financial_diagnostic.outcome == 'success'", packaged)):
                condition = condition.replace(token, str(value))
            return eval(condition.replace("&&", "and").replace("||", "or"), {"__builtins__": {}})
        for status in ("success", "failure", "cancelled"):
            for prepared in (False, True):
                for candidate in (False, True):
                    for packaged in (False, True):
                        inputs = (status == "failure", status == "cancelled", prepared, candidate, packaged)
                        expected = status != "success" and prepared and candidate
                        self.assertEqual(evaluates(package, *inputs), expected)
                        self.assertEqual(evaluates(upload, *inputs), expected and packaged)

    def test_cli_records_compressed_archive_size_and_checks_actual_head(self):
        env = {**os.environ, "GITHUB_WORKSPACE": str(diagnostic.REPO), "RUNNER_TEMP": str(self.base),
               "FINANCIAL_CANDIDATE_DIR": str(self.root), "GITHUB_REPOSITORY": self.context["repository"],
               "GITHUB_SHA": self.context["head_sha"], "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2",
               "FINANCIAL_PREPARATION_OUTCOME": "success", "FINANCIAL_CANDIDATE": "true", "DESIGN_JOB_STATUS": "failure"}
        failed = subprocess.run(["python3", str(SCRIPT)], env=env, capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("Diagnostic head differs", failed.stderr)
        self.assert_no_output()
        env["GITHUB_SHA"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=diagnostic.REPO, text=True).strip()
        result = subprocess.run(["python3", str(SCRIPT)], env=env, capture_output=True, text=True, check=True)
        metadata = json.loads(result.stdout)
        self.assertEqual(metadata, json.loads((self.root.parent / "unapproved-financial-diagnostic-metadata.json").read_text()))
        self.assertEqual(metadata["archive_format"], "tar+gzip")
        self.assertEqual(metadata["bytes"], self.output.stat().st_size)
        self.assertEqual(metadata["sha256"], self.hash(self.output.read_bytes()))
        self.assertFalse(metadata["activation_eligible"])
        self.assertEqual(metadata["producer"]["head_sha"], env["GITHUB_SHA"])


    def test_metadata_failures_remove_only_the_sidecar_created_by_this_invocation(self):
        env = {"GITHUB_WORKSPACE": str(diagnostic.REPO), "RUNNER_TEMP": str(self.base),
               "FINANCIAL_CANDIDATE_DIR": str(self.root), "GITHUB_REPOSITORY": self.context["repository"],
               "GITHUB_SHA": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=diagnostic.REPO, text=True).strip(),
               "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2", "FINANCIAL_PREPARATION_OUTCOME": "success",
               "FINANCIAL_CANDIDATE": "true", "DESIGN_JOB_STATUS": "failure"}
        sidecar = self.root.parent / "unapproved-financial-diagnostic-metadata.json"
        original_open = Path.open
        for phase in ("write", "close"):
            with self.subTest(phase=phase):
                class FailingMetadata:
                    def __init__(self, stream):
                        self.stream = stream
                    def __enter__(self):
                        return self
                    def __exit__(self, *_):
                        self.stream.close()
                        if phase == "close":
                            raise OSError("metadata close failed")
                    def write(self, data):
                        self.stream.write(data[:3])
                        if phase == "write":
                            raise OSError("metadata write failed")
                def open_with_failure(path, *args, **kwargs):
                    stream = original_open(path, *args, **kwargs)
                    return FailingMetadata(stream) if path == sidecar and args == ("xb",) else stream
                with patch.dict(os.environ, env), patch.object(Path, "open", open_with_failure):
                    with self.assertRaisesRegex(OSError, "metadata " + phase + " failed"):
                        diagnostic.main()
                self.assert_no_output()
                self.assertFalse(sidecar.exists())
        sidecar.write_bytes(b"pre-existing sidecar must survive")
        with patch.dict(os.environ, env):
            with self.assertRaises(FileExistsError):
                diagnostic.main()
        self.assert_no_output()
        self.assertEqual(sidecar.read_bytes(), b"pre-existing sidecar must survive")



if __name__ == "__main__":
    unittest.main()
