"""Small deterministic fixtures only. No GitHub requests or large allocations."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import struct
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).with_name("financial-candidate-transport.py")
spec = importlib.util.spec_from_file_location("transport", SCRIPT)
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


def hashed(data):
    return hashlib.sha256(data).hexdigest()


class CandidateTransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        # This is an actual tiny ZIP. The outer ZIP itself must survive unchanged.
        raw = io.BytesIO()
        with zipfile.ZipFile(raw, "w", compression=zipfile.ZIP_STORED) as archive:
            entry = zipfile.ZipInfo("candidate.tar", date_time=(2026, 10, 6, 0, 0, 0))
            archive.writestr(entry, bytes(range(256)) * 3 + b"unaltered candidate bytes")
        self.data = raw.getvalue()
        self.expected = {**transport.SOURCE, "size_in_bytes": len(self.data), "sha256": hashed(self.data)}
        self.part_bytes = (len(self.data) + 2) // 3
        self.context = {"repository": transport.REPOSITORY, "workflow": transport.WORKFLOW,
                        "head_branch": transport.BRANCH, "head_sha": "b" * 40, "run_id": 123, "run_attempt": 2}
        self.env = {"GITHUB_REPOSITORY": transport.REPOSITORY, "GITHUB_REF": "refs/heads/" + transport.BRANCH,
                    "GITHUB_EVENT_NAME": "push", "GITHUB_SHA": "b" * 40, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2"}
        self.source_artifact = {
            "id": self.expected["artifact_id"], "name": self.expected["artifact_name"],
            "expired": False, "size_in_bytes": len(self.data), "digest": "sha256:" + hashed(self.data),
            "workflow_run": {"id": self.expected["run_id"], "head_sha": self.expected["head_sha"], "head_branch": "main",
                             "repository_id": 7, "head_repository_id": 7},
        }
        self.run = {"id": self.expected["run_id"], "run_attempt": 1, "path": self.expected["workflow"],
                    "name": self.expected["workflow_name"], "head_sha": self.expected["head_sha"], "head_branch": "main",
                    "event": "workflow_run", "status": "completed", "conclusion": "success", "workflow_id": 8,
                    "repository": {"id": 7, "full_name": transport.REPOSITORY},
                    "head_repository": {"id": 7, "full_name": transport.REPOSITORY}}
        self.job = {"id": self.expected["job_id"], "run_id": self.expected["run_id"], "run_attempt": 1,
                    "head_sha": self.expected["head_sha"], "name": self.expected["job_name"],
                    "status": "completed", "conclusion": "success", "steps": [
                        {"name": name, "conclusion": "success"} for name in (
                            "Verify exact approval and immutable capture", "Recheck financial proofs and seal exact exception candidate",
                            "Retain exact exception candidate and unchanged failed Design evidence")]}
        self.workflow = {"id": 8, "path": self.expected["workflow"], "name": self.expected["workflow_name"]}

    def tearDown(self):
        self.temp.cleanup()

    def validate_source(self):
        transport.verify_source(self.source_artifact, self.run, self.job, self.workflow, self.expected)

    def split(self):
        (self.root / "original-artifact.zip").write_bytes(self.data)
        return transport.split_archive(self.root, self.context, self.expected, self.part_bytes)

    def ready(self):
        manifest = self.split()
        uploads, artifacts = [], {}
        for part in manifest["parts"]:
            # Simulate upload-artifact's single-file ZIP and returned immutable ID.
            raw = io.BytesIO()
            with zipfile.ZipFile(raw, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=0) as archive:
                archive.writestr(part["filename"], (self.root / part["filename"]).read_bytes())
            blob, identity = raw.getvalue(), 900 + part["index"]
            uploads.append((identity, hashed(blob)))
            artifacts[transport.PREFIX + f"artifacts/{identity}"] = {
                "id": identity, "name": part["artifact_name"], "digest": "sha256:" + hashed(blob),
                "size_in_bytes": len(blob), "expired": False, "workflow_run": {
                    "id": self.context["run_id"], "head_sha": self.context["head_sha"], "head_branch": transport.BRANCH},
            }
        return uploads, artifacts

    def finalize(self, uploads, artifacts):
        return transport.finalize(self.root, self.context, uploads, api=artifacts.__getitem__,
                                  expected=self.expected, part_bytes=self.part_bytes)

    def reassemble(self):
        return transport.reassemble(self.root, self.expected, self.part_bytes)

    def test_source_metadata_exact_and_every_mismatch_fails(self):
        self.validate_source()
        for obj, key, bad in (
            (self.source_artifact, "id", 99), (self.source_artifact, "name", "different"),
            (self.source_artifact, "size_in_bytes", len(self.data) - 1), (self.source_artifact, "digest", "sha256:" + "0" * 64),
            (self.source_artifact, "expired", True), (self.source_artifact["workflow_run"], "id", 99),
            (self.source_artifact["workflow_run"], "head_sha", "a" * 40), (self.source_artifact["workflow_run"], "repository_id", 9),
            (self.run, "id", 99), (self.run, "run_attempt", 2), (self.run, "head_sha", "a" * 40),
            (self.run, "path", "other.yml"), (self.run, "workflow_id", 10), (self.run, "conclusion", "failure"),
            (self.run, "event", "push"), (self.run, "head_branch", "other"),
            (self.run["head_repository"], "full_name", "elsewhere/repo"),
            (self.job, "id", 99), (self.job, "run_id", 99), (self.job, "run_attempt", 2),
            (self.job, "head_sha", "a" * 40), (self.job, "conclusion", "failure"),
            (self.job["steps"][1], "conclusion", "skipped"), (self.workflow, "path", "other.yml"),
        ):
            with self.subTest(field=key, value=bad):
                old = obj[key]
                obj[key] = bad
                with self.assertRaises(ValueError):
                    self.validate_source()
                obj[key] = old

    def test_copy_rejects_truncated_extra_and_corrupt_bytes(self):
        out = io.BytesIO()
        transport.copy_checked([self.data[:47], self.data[47:]], out, len(self.data), hashed(self.data))
        self.assertEqual(out.getvalue(), self.data)
        for data in (self.data[:-1], self.data + b"x", b"x" + self.data[1:]):
            with self.subTest(length=len(data)), self.assertRaises(ValueError):
                transport.copy_checked([data], io.BytesIO(), len(self.data), hashed(self.data))

    def test_split_finalize_and_reassembly_keep_exact_original_zip(self):
        uploads, artifacts = self.ready()
        manifest = self.finalize(uploads, artifacts)
        self.assertEqual(manifest["purpose"], "TRANSPORT ONLY")
        self.assertEqual(manifest["publication_authority"], "none")
        self.assertEqual([part["artifact_id"] for part in manifest["parts"]], [901, 902, 903])
        self.assertEqual(manifest["source"], self.expected)
        self.assertEqual(manifest["original_zip"], {
            "members": [{"name": "candidate.tar", "size_in_bytes": 793, "compressed_size_in_bytes": 793}],
            "expanded_size_in_bytes": 793})
        result = self.reassemble()
        self.assertEqual(result["sha256"], hashed(self.data))
        self.assertEqual((self.root / "reassembled-artifact.zip").read_bytes(), self.data)
        self.assertEqual((self.root / "original-artifact.zip").read_bytes(), self.data)
        encoded = json.dumps(manifest)
        self.assertNotIn(str(self.root), encoded)
        self.assertNotIn("token", encoded.lower())

    def test_zip_inventory_is_metadata_only_and_bounded(self):
        (self.root / "original-artifact.zip").write_bytes(self.data)
        self.assertEqual(transport.zip_inventory(self.root, "original-artifact.zip")["expanded_size_in_bytes"], 793)
        malformed = bytearray(self.data)
        # EOCD central-directory byte length field exceeds the metadata bound.
        offset = malformed.rfind(b"PK\x05\x06")
        malformed[offset + 12:offset + 16] = (transport.BUFFER_BYTES + 1).to_bytes(4, "little")
        (self.root / "original-artifact.zip").write_bytes(malformed)
        with self.assertRaisesRegex(ValueError, "metadata exceeds bound"):
            transport.zip_inventory(self.root, "original-artifact.zip")

    def test_zip64_inventory_is_metadata_only(self):
        offset = self.data.rfind(b"PK\x05\x06")
        end = list(struct.unpack("<4s4H2IH", self.data[offset:]))
        record = struct.pack("<4sQ2H2I4Q", b"PK\x06\x06", 44, 45, 45, 0, 0, end[3], end[4], end[5], end[6])
        locator = struct.pack("<4sIQI", b"PK\x06\x07", 0, offset, 1)
        end[3] = end[4] = 65535
        end[5] = end[6] = 0xffffffff
        data = self.data[:offset] + record + locator + struct.pack("<4s4H2IH", *end)
        (self.root / "zip64.zip").write_bytes(data)
        self.assertEqual(transport.zip_inventory(self.root, "zip64.zip")["expanded_size_in_bytes"], 793)

    def test_changed_zip_inventory_is_rejected_after_reassembly(self):
        uploads, artifacts = self.ready()
        manifest = self.finalize(uploads, artifacts)
        manifest["original_zip"]["members"][0]["size_in_bytes"] = 1
        manifest["original_zip"]["expanded_size_in_bytes"] = 1
        (self.root / "transport-manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "ZIP inventory mismatch"):
            self.reassemble()
        self.assertFalse((self.root / "reassembled-artifact.zip").exists())

    def test_split_rejects_changed_length_and_hash(self):
        for data in (self.data[:-1], self.data + b"x", b"x" + self.data[1:]):
            with self.subTest(length=len(data)), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                (root / "original-artifact.zip").write_bytes(data)
                with self.assertRaises(ValueError):
                    transport.split_archive(root, self.context, self.expected, self.part_bytes)
                self.assertFalse((root / "parts-manifest.json").exists())

    def test_manifest_rejects_shuffled_missing_extra_and_traversal_parts(self):
        uploads, artifacts = self.ready()
        manifest = self.finalize(uploads, artifacts)
        mutations = [lambda m: m["parts"].reverse(), lambda m: m["parts"].pop(),
                     lambda m: m["parts"].append(m["parts"][0]),
                     lambda m: m["parts"][0].update(filename="../outside"),
                     lambda m: m["parts"][0].update(size_in_bytes=1),
                     lambda m: m["source"].update(artifact_id=1),
                     lambda m: m["source"].update(sha256="0" * 64),
                     lambda m: m["source"].update(head_sha="0" * 40),
                     lambda m: m["source"].update(run_id=1),
                     lambda m: m["parts"][1].update(artifact_id=m["parts"][0]["artifact_id"])]
        for mutate in mutations:
            changed = copy.deepcopy(manifest)
            mutate(changed)
            (self.root / "transport-manifest.json").write_text(json.dumps(changed))
            with self.assertRaises(ValueError):
                self.reassemble()
            self.assertFalse((self.root / "reassembled-artifact.zip").exists())

    def test_reassembly_rejects_missing_truncated_corrupt_and_swapped_files(self):
        uploads, artifacts = self.ready()
        self.finalize(uploads, artifacts)
        first, second = self.root / "part-001.bin", self.root / "part-002.bin"
        original = first.read_bytes()
        for data in (None, original[:-1], b"!" + original[1:], second.read_bytes()):
            with self.subTest(mutation="missing" if data is None else hashed(data)):
                if data is None:
                    first.unlink()
                else:
                    first.write_bytes(data)
                with self.assertRaises((ValueError, OSError)):
                    self.reassemble()
                self.assertFalse((self.root / "reassembled-artifact.zip").exists())
                first.write_bytes(original)

    def test_paths_links_special_files_and_overwrites_are_rejected(self):
        outside = self.root / "outside"
        outside.write_bytes(b"do not alter")
        (self.root / "linked").symlink_to(outside)
        os.link(outside, self.root / "hardlinked")
        os.mkfifo(self.root / "fifo")
        for name in ("../outside", "/outside", "a/b", "linked", "hardlinked", "fifo"):
            with self.subTest(name=name), self.assertRaises((ValueError, OSError)):
                transport.open_file(self.root, name)
        with self.assertRaises(FileExistsError):
            transport.open_file(self.root, "outside", writing=True)
        alias = self.root / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            transport.directory(alias)
        self.assertEqual(outside.read_bytes(), b"do not alter")

    def test_reassembly_cannot_follow_input_link_or_replace_output(self):
        uploads, artifacts = self.ready()
        self.finalize(uploads, artifacts)
        part = self.root / "part-001.bin"
        saved = self.root / "saved.bin"
        part.rename(saved)
        part.symlink_to(saved)
        with self.assertRaises(OSError):
            self.reassemble()
        self.assertFalse((self.root / "reassembled-artifact.zip").exists())
        part.unlink()
        part.write_bytes(saved.read_bytes())
        output = self.root / "reassembled-artifact.zip"
        output.write_bytes(b"existing")
        with self.assertRaises(FileExistsError):
            self.reassemble()
        self.assertEqual(output.read_bytes(), b"existing")

    def test_uploaded_wrappers_are_bound_to_exact_run_and_below_connector_limit(self):
        uploads, artifacts = self.ready()
        artifact = next(iter(artifacts.values()))
        for obj, key, bad in ((artifact, "id", 1), (artifact, "name", "wrong"),
                              (artifact, "size_in_bytes", transport.DOWNLOAD_LIMIT),
                              (artifact, "digest", "sha256:" + "0" * 64), (artifact, "expired", True),
                              (artifact["workflow_run"], "id", 1),
                              (artifact["workflow_run"], "head_sha", "a" * 40)):
            with self.subTest(field=key):
                old, obj[key] = obj[key], bad
                with self.assertRaises(ValueError):
                    self.finalize(uploads, artifacts)
                self.assertFalse((self.root / "transport-manifest.json").exists())
                obj[key] = old

    def test_command_stream_is_bounded_and_does_not_echo_stderr(self):
        command = [sys.executable, "-c", "import sys; sys.stdout.buffer.write(b'abcdef'); sys.stderr.write('private redirect')"]
        self.assertEqual(b"".join(transport.command_chunks(command, 6, 3)), b"abcdef")
        with self.assertRaisesRegex(ValueError, "byte bound"):
            list(transport.command_chunks(command, 5, 3))
        with self.assertRaisesRegex(ValueError, "time bound"):
            list(transport.command_chunks([sys.executable, "-c", "import time; time.sleep(3)"], 6, .05))
        with self.assertRaisesRegex(ValueError, "read failed"):
            list(transport.command_chunks([sys.executable, "-c", "raise SystemExit(1)"], 6, 3))

    def test_exact_diagnostic_push_context_required(self):
        self.assertEqual(transport.transport_context(self.env), self.context)
        for field, bad in (("GITHUB_REPOSITORY", "other/repo"), ("GITHUB_REF", "refs/heads/main"),
                           ("GITHUB_EVENT_NAME", "workflow_dispatch"), ("GITHUB_SHA", "main"),
                           ("GITHUB_RUN_ID", "0"), ("GITHUB_RUN_ATTEMPT", "latest")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                transport.transport_context({**self.env, field: bad})

    def test_production_bounds_and_workflow_scope(self):
        size, chunk = transport.SOURCE["size_in_bytes"], transport.PART_BYTES
        self.assertEqual([min(chunk, size - start) for start in range(0, size, chunk)],
                         [419430400, 419430400, 218733173])
        # Stored deflate block overhead plus a generous ZIP header allowance.
        self.assertLess(chunk + 5 * ((chunk + 16382) // 16383) + 65536, transport.DOWNLOAD_LIMIT)
        workflow = SCRIPT.parents[1] / "workflows/financial-candidate-transport.yml"
        text = workflow.read_text()
        self.assertIn("branches: [" + transport.BRANCH + "]", text)
        self.assertIn("timeout-minutes: 20", text)
        self.assertEqual(text.count("retention-days: 14"), 4)
        self.assertEqual(text.count("compression-level: 0"), 4)
        self.assertNotIn("workflow_dispatch:", text)
        self.assertNotIn("workflow_run:", text)
        self.assertNotIn(": write", text)
        self.assertNotIn("deploy", text)
        self.assertNotIn("always()", text)


if __name__ == "__main__":
    unittest.main()
