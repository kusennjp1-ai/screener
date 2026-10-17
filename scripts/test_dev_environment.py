"""Isolated, offline tests; never use the real repository's Git state."""
from pathlib import Path
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("dev_environment", Path(__file__).with_name("dev_environment.py"))
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class DeveloperEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repository with spaces"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Offline Test")
        self.git("config", "user.email", "offline@example.invalid")
        self.write("source.txt", "base\n")
        self.write("other.txt", "other\n")
        self.write("binary.dat", b"\x00\x01base")
        self.write(".gitignore", "private.txt\n")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.head = self.git("rev-parse", "HEAD").strip().decode()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.PIPE)

    def write(self, name, data):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data.encode() if isinstance(data, str) else data)

    def capture(self, *paths):
        output = self.root / "checkpoint with spaces"
        return output, dev.checkpoint(self.repo, output, list(paths))

    def test_roundtrip_tracked_binary_staged_and_untracked(self):
        self.write("source.txt", "staged\n")
        self.git("add", "source.txt")
        self.write("source.txt", "working\n")
        self.write("binary.dat", b"\x00\xffnew")
        self.write("new file.txt", "new\n")
        self.write("other.txt", "excluded\n")
        before = self.git("status", "--porcelain=v1", "-z")
        output, manifest = self.capture("source.txt", "binary.dat", "new file.txt")
        self.assertEqual(manifest["excluded_changed_paths"], ["other.txt"])
        self.assertEqual(before, self.git("status", "--porcelain=v1", "-z"))
        self.assertEqual(self.head, manifest["base_head"])
        self.assertTrue(dev.verify_checkpoint(output)["verified"])
        restored = self.root / "restored"
        subprocess.check_call(["git", "clone", "--quiet", "--no-hardlinks", str(self.repo), str(restored)])
        subprocess.check_call(["git", "-C", str(restored), "apply", "--check", str(output / "changes.patch")])
        subprocess.check_call(["git", "-C", str(restored), "apply", str(output / "changes.patch")])
        for name in ("source.txt", "binary.dat"):
            self.assertEqual((self.repo / name).read_bytes(), (restored / name).read_bytes())
        self.assertEqual((output / "working-files/new file.txt").read_text(), "new\n")

    def test_staged_deletion_is_supported(self):
        self.git("rm", "source.txt")
        output, _ = self.capture("source.txt")
        self.assertIn(b"deleted file", (output / "changes.patch").read_bytes())

    def test_staged_new_file_is_in_patch(self):
        self.write("added.txt", "added")
        self.git("add", "added.txt")
        output, _ = self.capture("added.txt")
        self.assertIn(b"new file mode", (output / "changes.patch").read_bytes())
        self.assertEqual((output / "working-files/added.txt").read_text(), "added")

    def test_staged_deletion_with_untracked_replacement_preserves_bytes(self):
        self.git("rm", "source.txt")
        self.write("source.txt", "replacement")
        output, _ = self.capture("source.txt")
        self.assertEqual((output / "working-files/source.txt").read_text(), "replacement")
        self.assertTrue(dev.verify_checkpoint(output)["verified"])

    def test_diff_configuration_cannot_corrupt_patch(self):
        for key, value in (("color.ui", "always"), ("diff.noprefix", "true"),
                           ("diff.mnemonicPrefix", "true"), ("diff.context", "0"),
                           ("diff.outputIndicatorNew", ">")):
            self.git("config", key, value)
        self.write("source.txt", "changed\n")
        output, _ = self.capture("source.txt")
        self.write("source.txt", "base\n")
        self.git("apply", "--check", str(output / "changes.patch"))

    def test_crlf_working_bytes_are_preserved(self):
        self.git("config", "core.autocrlf", "true")
        self.write("source.txt", b"new\r\n")
        output, _ = self.capture("source.txt")
        self.assertEqual((output / "working-files/source.txt").read_bytes(), b"new\r\n")

    def test_filters_rejected_before_execution(self):
        marker = self.root / "filter-must-not-run"
        self.write(".gitattributes", "source.txt filter=demo\n")
        self.git("config", "filter.demo.clean", f"touch '{marker.as_posix()}'; cat")
        for action in (lambda: dev.doctor(self.repo), lambda: self.capture("source.txt")):
            with self.assertRaisesRegex(ValueError, "filters require separate review"):
                action()
        self.assertFalse(marker.exists())

    def test_fsmonitor_is_disabled(self):
        marker = self.root / "monitor-must-not-run"
        self.git("config", "core.fsmonitor", f"touch '{marker.as_posix()}'")
        dev.doctor(self.repo)
        self.capture("source.txt")
        self.assertFalse(marker.exists())

    def test_hidden_index_flags_rejected(self):
        for option, clear in (("--assume-unchanged", "--no-assume-unchanged"),
                              ("--skip-worktree", "--no-skip-worktree")):
            with self.subTest(option=option):
                self.git("update-index", option, "source.txt")
                self.write("source.txt", "hidden change")
                with self.assertRaisesRegex(ValueError, "assume-unchanged/skip-worktree"):
                    self.capture("source.txt")
                report = dev.doctor(self.repo)
                self.assertEqual(next(item for item in report["checks"] if item["name"] == "index-visibility")["state"], "warning")
                self.git("update-index", clear, "source.txt")

    def test_reparse_metadata_is_rejected(self):
        fake = SimpleNamespace(lstat=lambda: SimpleNamespace(st_mode=0o40755, st_file_attributes=0x400))
        self.assertTrue(dev.is_link_or_reparse(fake))

    def test_partial_clone_configuration_rejected(self):
        self.git("config", "remote.origin.promisor", "true")
        with self.assertRaisesRegex(ValueError, "Partial/promisor"):
            dev.doctor(self.repo)

    def test_inherited_git_directory_cannot_redirect_repository(self):
        with patch.dict(os.environ, {"GIT_DIR": str(self.root / "does-not-exist"),
                                     "GIT_WORK_TREE": str(self.root / "does-not-exist")}):
            self.assertEqual(dev.repository(self.repo), self.repo.resolve())

    def test_rename_does_not_touch_unselected_path(self):
        self.git("mv", "source.txt", "renamed.txt")
        output, _ = self.capture("renamed.txt")
        self.assertNotIn(b"rename from", (output / "changes.patch").read_bytes())
        self.assertIn("source.txt", json.loads((output / "manifest.json").read_text())["excluded_changed_paths"])

    def test_index_and_worktree_cancellation_is_still_dirty(self):
        self.write("source.txt", "staged")
        self.git("add", "source.txt")
        self.write("source.txt", "base\n")
        self.assertIn("source.txt", dev.changed_paths(self.repo))

    def test_sensitive_and_traversal_paths_rejected(self):
        for name in (".env", ".env.example", "a/.aws/config", "id_rsa", "x.key", "../outside",
                     "/absolute", "a\\b", ":(glob)*", "a//b", "./source.txt",
                     ".env ", ".aws./config", "a/CON.txt", "NUL", "x\ny"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                dev.safe_path(name)

    def test_ignored_files_rejected(self):
        self.write("private.txt", "must not capture")
        with self.assertRaisesRegex(ValueError, "Ignored"):
            self.capture("private.txt")

    def test_directory_and_missing_path_rejected(self):
        (self.repo / "folder").mkdir()
        for name in ("folder", "missing.txt"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.capture(name)

    def test_symlink_and_symlink_parent_rejected(self):
        if not hasattr(os, "symlink"):
            self.skipTest("symlink unavailable")
        try:
            (self.repo / "linked.txt").symlink_to(self.repo / "source.txt")
            (self.repo / "linked-dir").symlink_to(self.repo, target_is_directory=True)
        except OSError:
            self.skipTest("symlink privileges unavailable")
        for name in ("linked.txt", "linked-dir/source.txt"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "Symlink"):
                self.capture(name)

    def test_inside_repo_and_existing_output_rejected(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            dev.checkpoint(self.repo, self.repo / "checkpoint", ["source.txt"])
        existing = self.root / "already"
        existing.mkdir()
        (existing / "keep").write_text("keep")
        with self.assertRaisesRegex(ValueError, "never overwritten"):
            dev.checkpoint(self.repo, existing, ["source.txt"])
        self.assertEqual((existing / "keep").read_text(), "keep")

    def test_tamper_and_extra_file_rejected(self):
        self.write("source.txt", "changed")
        output, _ = self.capture("source.txt")
        original = (output / "changes.patch").read_bytes()
        (output / "changes.patch").write_bytes(original + b"tamper")
        with self.assertRaisesRegex(ValueError, "integrity"):
            dev.verify_checkpoint(output)
        (output / "changes.patch").write_bytes(original)
        (output / "extra").write_text("extra")
        with self.assertRaisesRegex(ValueError, "unlisted"):
            dev.verify_checkpoint(output)

    def test_manifest_path_escape_rejected(self):
        output, manifest = self.capture("source.txt")
        manifest["files"]["../outside"] = {"bytes": 1, "sha256": "0" * 64}
        (output / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            dev.verify_checkpoint(output)

    def test_malformed_manifest_is_rejected_cleanly(self):
        output, manifest = self.capture("source.txt")
        for malformed in ([], None, 7, {**manifest, "base_head": "f" * 41},
                          {**manifest, "base_head": 7}):
            with self.subTest(manifest=malformed):
                (output / "manifest.json").write_text(json.dumps(malformed))
                with self.assertRaises(ValueError):
                    dev.verify_checkpoint(output)

    def test_oversize_and_mutating_source_rejected(self):
        with patch.object(dev, "MAX_FILE_BYTES", 1), self.assertRaisesRegex(ValueError, "16 MiB"):
            self.capture("source.txt")
        states = [{"source.txt": "first"}, {"source.txt": "second"}]
        with patch.object(dev, "selected_state", side_effect=states), self.assertRaisesRegex(ValueError, "changed during"):
            self.capture("source.txt")
        self.assertFalse((self.root / "checkpoint with spaces").exists())

    def test_doctor_never_exposes_credential_values_or_remote_urls(self):
        secret = "DO_NOT_DISCLOSE_TEST_CREDENTIAL"
        self.git("config", "credential.helper", "!echo " + secret)
        self.git("remote", "add", "origin", "https://" + secret + "@example.invalid/repo")
        with patch.dict(os.environ, {"GH_TOKEN": secret}):
            report = dev.doctor(self.repo)
        text = json.dumps(report)
        self.assertNotIn(secret, text)
        self.assertNotIn("example.invalid", text)
        auth = next(item for item in report["checks"] if item["name"] == "authentication")
        self.assertEqual(auth["state"], "unverified")
        self.assertTrue(auth["detail"]["git_helper_key_present"])
        self.assertTrue(auth["detail"]["token_environment_name_present"])
        self.assertEqual(self.head, self.git("rev-parse", "HEAD").strip().decode())

    def test_doctor_and_strict_exit_codes(self):
        report = {"checks": [{"state": "warning"}]}
        with patch.object(dev, "doctor", return_value=report), patch("builtins.print"):
            self.assertEqual(dev.main(["--repo", str(self.repo), "doctor"]), 0)
            self.assertEqual(dev.main(["--repo", str(self.repo), "doctor", "--strict"]), 2)


if __name__ == "__main__":
    unittest.main()
