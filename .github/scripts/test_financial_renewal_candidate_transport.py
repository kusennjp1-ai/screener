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
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile


SCRIPT = Path(__file__).with_name("financial-renewal-candidate-transport.py")
spec = importlib.util.spec_from_file_location("transport", SCRIPT)
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


def hashed(data):
    return hashlib.sha256(data).hexdigest()


class CheckpointTransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        # This is an actual tiny ZIP. The outer ZIP itself must survive unchanged.
        raw = io.BytesIO()
        with zipfile.ZipFile(raw, "w", compression=zipfile.ZIP_STORED) as archive:
            entry = zipfile.ZipInfo("candidate.tar", date_time=(2026, 10, 6, 0, 0, 0))
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(entry, bytes(range(256)) * 3 + b"unaltered candidate bytes")
        self.data = raw.getvalue()
        self.expected = {**transport.SOURCE, "workflow_id": 1, "event": "workflow_run", "head_sha": "c" * 40,
                         "run_id": 10, "run_attempt": 1, "job_id": 20, "job_completed_at": "2026-10-06T22:29:56Z",
                         "artifact_id": 30, "artifact_name": "financial-source-renewal-10-1",
                         "artifact_created_at": "2026-10-06T22:29:46Z",
                         "size_in_bytes": len(self.data), "sha256": hashed(self.data)}
        self.part_bytes = (len(self.data) + 4) // 5
        self.context = {"repository": transport.REPOSITORY, "workflow": transport.WORKFLOW,
                        "head_branch": transport.BRANCH, "head_sha": "b" * 40, "run_id": 123, "run_attempt": 2}
        self.env = {"GITHUB_REPOSITORY": transport.REPOSITORY, "GITHUB_REF": "refs/heads/" + transport.BRANCH,
                    "GITHUB_EVENT_NAME": "push", "GITHUB_SHA": "b" * 40, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2"}
        self.source_artifact = {
            "id": self.expected["artifact_id"], "name": self.expected["artifact_name"],
            "expired": False, "size_in_bytes": len(self.data), "digest": "sha256:" + hashed(self.data),
            "workflow_run": {"id": self.expected["run_id"], "head_sha": self.expected["head_sha"], "head_branch": self.expected["head_branch"],
                             "repository_id": transport.SOURCE["repository_id"], "head_repository_id": transport.SOURCE["repository_id"]},
        }
        self.run = {"id": self.expected["run_id"], "run_attempt": 1, "path": self.expected["workflow"],
                    "name": self.expected["workflow_name"], "head_sha": self.expected["head_sha"], "head_branch": self.expected["head_branch"],
                    "event": "workflow_run", "status": "completed", "conclusion": "success", "workflow_id": self.expected["workflow_id"],
                    "updated_at": "2026-10-06T22:29:59Z",
                    "repository": {"id": transport.SOURCE["repository_id"], "full_name": transport.REPOSITORY, "private": False},
                    "head_repository": {"id": transport.SOURCE["repository_id"], "full_name": transport.REPOSITORY, "private": False}}
        self.job = {"id": self.expected["job_id"], "run_id": self.expected["run_id"], "run_attempt": 1,
                    "head_sha": self.expected["head_sha"], "name": self.expected["job_name"],
                    "status": "completed", "conclusion": "success", "completed_at": self.expected["job_completed_at"], "steps": [
                        {"name": name, "number": number, "status": "completed", "conclusion": "success",
                         "started_at": "2026-10-06T22:29:32Z", "completed_at": "2026-10-06T22:29:32Z"}
                        for number, name in enumerate(transport.SEAL_STEPS, 9)]}
        self.job["steps"][-1]["completed_at"] = "2026-10-06T22:29:47Z"
        self.source_artifact.update(created_at=self.expected["artifact_created_at"], expires_at="2026-10-20T22:29:32Z")
        self.workflow = {"id": self.expected["workflow_id"], "path": self.expected["workflow"], "name": self.expected["workflow_name"]}
        # Resource admission is simulated for tiny offline fixtures; never
        # require large actual free space or allocate the production payload.
        self.disk_patch = patch.object(transport.os, "fstatvfs", return_value=SimpleNamespace(
            f_bavail=100 * 1024 * 1024 * 1024, f_frsize=1))
        self.disk_patch.start()

    def test_selected_128_mib_capacity_is_exactly_2_gib_without_allocation(self):
        self.assertEqual(transport.PART_BYTES, 128 * 1024 * 1024)
        self.assertEqual(transport.BASE_MAX_PARTS, 16)
        self.assertEqual(transport.MAX_PARTS, 34)
        exact = {**self.expected, "size_in_bytes": 2 * 1024 * 1024 * 1024}
        transport.validate_source_binding(exact)
        self.assertEqual(transport.part_count(exact), 16)
        with self.assertRaises(ValueError):
            transport.validate_source_binding({**exact, "size_in_bytes": exact["size_in_bytes"] + 1})
        with self.assertRaises(ValueError):
            transport.part_count(exact, part_bytes=transport.PART_BYTES - 1)

    def test_only_exact_real_source_has_34_part_exception(self):
        source = copy.deepcopy(transport.SOURCE)
        self.assertEqual(source["run_id"], 37581569719)
        self.assertEqual(source["run_attempt"], 1)
        self.assertEqual(source["workflow_id"], 376994471)
        self.assertEqual(source["event"], "workflow_run")
        self.assertEqual(source["head_sha"], "22548890d0fe161edf7be3943b1775c4f293d0d9")
        self.assertEqual(source["job_id"], 112662209888)
        self.assertEqual(source["job_completed_at"], "2026-10-07T07:09:49Z")
        self.assertEqual(source["artifact_created_at"], "2026-10-07T07:09:42Z")
        self.assertEqual(source["artifact_id"], 11466780160)
        self.assertEqual(source["artifact_name"], "financial-source-renewal-37581569719-1")
        self.assertEqual(source["size_in_bytes"], 4478177532)
        self.assertEqual(source["sha256"], "2b8d069257fb72685600639503e86245084f158bac9252127f42567114a92ac4")
        self.assertEqual(transport.part_count(), 34)
        self.assertEqual(source["size_in_bytes"] - 33 * transport.PART_BYTES, 48992508)
        self.assertEqual(transport.CANDIDATE_TAR_LIMIT, 8589934592)
        for field, value in source.items():
            changed = copy.deepcopy(source)
            changed[field] = value + 1 if type(value) is int else value + "x"
            with self.subTest(field=field), self.assertRaises((ValueError, TypeError)):
                transport.validate_source_binding(changed)
        for size in (2147483649, source["size_in_bytes"] - 1, source["size_in_bytes"] + 1,
                     transport.MAX_PARTS * transport.PART_BYTES):
            with self.subTest(size=size), self.assertRaises(ValueError):
                transport.validate_source_binding({**source, "size_in_bytes": size})
        with self.assertRaises(ValueError):
            transport.part_count(source, transport.PART_BYTES - 1)
        # A different future source cannot inherit the larger capacity.
        future = {**source, "run_id": source["run_id"] + 1,
                  "artifact_name": f"financial-source-renewal-{source['run_id'] + 1}-1"}
        with self.assertRaises(ValueError):
            transport.part_count(future)
        with patch.dict(transport.SOURCE, {"sha256": "a" * 64}), self.assertRaises(ValueError):
            transport.validate_source_binding()

    def test_all_34_upload_identities_and_every_missing_or_extra_slot(self):
        env = {f"PART_{i}_{key}": value for i in range(1, 35)
               for key, value in (("ID", str(900 + i)), ("DIGEST", hashed(f"fixture-{i}".encode())))}
        self.assertEqual(len(transport.uploaded_parts(env)), 34)
        for index in range(1, 35):
            for suffix in ("ID", "DIGEST"):
                changed = dict(env)
                changed.pop(f"PART_{index}_{suffix}")
                with self.subTest(index=index, suffix=suffix), self.assertRaises(ValueError):
                    transport.uploaded_parts(changed)
        for index in (0, 35, 999, "01"):
            with self.subTest(extra=index), self.assertRaises(ValueError):
                transport.uploaded_parts({**env, f"PART_{index}_ID": "9999"})

    def test_34_part_manifest_rejects_missing_extra_reordered_and_changed_boundaries(self):
        # Metadata-only schema fixture, not a claim to have read actual source
        # bytes. No large ZIP, part, candidate, or remote artifact is allocated.
        manifest = self.split()
        manifest["source"] = dict(transport.SOURCE)
        manifest["part_bytes"] = transport.PART_BYTES
        observation = manifest["source_observation"]
        observation["observed_at"] = "2026-10-07T07:10:00Z"
        observation["overall_run"]["updated_at"] = "2026-10-07T07:09:49Z"
        observation["seal_job"].update(id=transport.SOURCE["job_id"], completed_at=transport.SOURCE["job_completed_at"])
        for step in observation["seal_steps"]:
            step.update(started_at="2026-10-07T07:09:42Z", completed_at="2026-10-07T07:09:42Z")
        observation["source_artifact_retention"].update(created_at="2026-10-07T07:09:42Z", expires_at="2026-10-21T07:09:42Z")
        manifest["parts"] = [{
            "index": i, "filename": transport.part_name(i), "artifact_name": transport.artifact_name(self.context, i),
            "size_in_bytes": min(transport.PART_BYTES, transport.SOURCE["size_in_bytes"] - (i - 1) * transport.PART_BYTES),
            "sha256": hashed(f"schema-only-part-{i}".encode()), "artifact_id": 900 + i,
            "artifact_zip_sha256": hashed(f"schema-only-wrapper-{i}".encode()), "artifact_zip_bytes": 134217900,
            "retention": {"created_at": "2026-10-07T07:10:00Z", "expires_at": "2026-10-21T07:10:00Z", "expired": False},
        } for i in range(1, 35)]
        manifest["disk_admission"] = {"purpose": "DISK ADMISSION ONLY", "authority": "none",
            "pre_download": transport.measure_disk_admission(self.root),
            "before_parts": [transport.measure_disk_admission(self.root, transport.SOURCE,
                transport.SOURCE["size_in_bytes"] - (i - 1) * transport.PART_BYTES, i) for i in range(1, 35)]}
        self.assertEqual(len(transport.validate_manifest(manifest, final=True)), 34)
        self.assertEqual(sum(p["size_in_bytes"] for p in manifest["parts"]), 4478177532)
        for index in range(34):
            changed = copy.deepcopy(manifest)
            changed["parts"].pop(index)
            with self.subTest(missing=index + 1), self.assertRaises(ValueError):
                transport.validate_manifest(changed, final=True)
        for change in (lambda m: m["parts"].append(copy.deepcopy(m["parts"][-1])),
                       lambda m: m["parts"].reverse(),
                       lambda m: m["parts"][-1].update(size_in_bytes=48992509),
                       lambda m: m["parts"][-1].update(index=33),
                       lambda m: m["parts"][-1].update(artifact_id=m["parts"][0]["artifact_id"])):
            changed = copy.deepcopy(manifest)
            change(changed)
            with self.assertRaises(ValueError):
                transport.validate_manifest(changed, final=True)

    def tearDown(self):
        self.disk_patch.stop()
        self.temp.cleanup()

    def validate_source(self):
        return transport.verify_source(self.source_artifact, self.run, self.job, self.workflow, self.expected,
                                       observed_at="2026-10-06T22:40:00Z")

    def split(self):
        admission = transport.measure_disk_admission(self.root, self.expected)
        (self.root / "original-artifact.zip").write_bytes(self.data)
        return transport.split_archive(self.root, self.context, self.expected, self.part_bytes, self.validate_source(), admission)

    def test_actual_filesystem_admission_has_exact_production_boundary(self):
        required = 2 * transport.SOURCE["size_in_bytes"] + transport.DISK_RESERVE_BYTES
        self.assertEqual(required, 11103838712)
        self.assertEqual(transport.DISK_RESERVE_BYTES, 2147483648)
        observed_devices = []
        def actual_fd_measurement(fd):
            self.assertTrue(stat.S_ISDIR(os.fstat(fd).st_mode))
            observed_devices.append(os.fstat(fd).st_dev)
            return SimpleNamespace(f_bavail=required, f_frsize=1)
        with patch.object(transport.os, "fstatvfs", side_effect=actual_fd_measurement):
            admitted = transport.measure_disk_admission(self.root)
        self.assertEqual(admitted["required_bytes"], required)
        self.assertEqual(admitted["available_bytes"], required)
        self.assertEqual(observed_devices, [self.root.stat().st_dev])
        with patch.object(transport.os, "fstatvfs", return_value=SimpleNamespace(f_bavail=required - 1, f_frsize=1)), \
             self.assertRaisesRegex(ValueError, "Insufficient"):
            transport.measure_disk_admission(self.root)

    def test_insufficient_disk_prevents_payload_open_and_download_after_source_checks(self):
        destination = self.root / "financial-renewal-candidate-transport"
        events = []
        observation = self.validate_source()
        def authenticated(*args):
            events.append("source-authenticated")
            return observation
        def insufficient(fd):
            events.append("disk-measured")
            return SimpleNamespace(f_bavail=11103838711, f_frsize=1)
        with patch.object(sys, "argv", ["transport", "prepare", "--directory", str(destination)]), \
             patch.dict(os.environ, self.env), patch.object(transport, "gh_json", return_value={}), \
             patch.object(transport, "verify_source", side_effect=authenticated), \
             patch.object(transport.os, "fstatvfs", side_effect=insufficient), \
             patch.object(transport, "gh_chunks", side_effect=AssertionError("No payload request")) as payload, \
             self.assertRaisesRegex(ValueError, "Insufficient"):
            transport.main()
        self.assertEqual(events, ["source-authenticated", "disk-measured"])
        payload.assert_not_called()
        self.assertFalse((destination / "original-artifact.zip").exists())
        self.assertFalse((destination / "parts-manifest.json").exists())

    def test_failed_source_authority_check_prevents_disk_admission_and_payload_download(self):
        destination = self.root / "financial-renewal-candidate-transport"
        with patch.object(sys, "argv", ["transport", "prepare", "--directory", str(destination)]), \
             patch.dict(os.environ, self.env), patch.object(transport, "gh_json", return_value={}), \
             patch.object(transport, "verify_source", side_effect=ValueError("Source authentication failed")), \
             patch.object(transport, "measure_disk_admission") as admission, \
             patch.object(transport, "gh_chunks") as payload, \
             self.assertRaisesRegex(ValueError, "Source authentication"):
            transport.main()
        admission.assert_not_called()
        payload.assert_not_called()
        self.assertFalse((destination / "original-artifact.zip").exists())

    def test_split_rechecks_remaining_budget_before_creating_each_part(self):
        admission = transport.measure_disk_admission(self.root, self.expected)
        (self.root / "original-artifact.zip").write_bytes(self.data)
        first = len(self.data) + transport.DISK_RESERVE_BYTES
        second = len(self.data) - self.part_bytes + transport.DISK_RESERVE_BYTES
        available = iter((first, second - 1))
        with patch.object(transport.os, "fstatvfs", side_effect=lambda fd: SimpleNamespace(f_bavail=next(available), f_frsize=1)), \
             self.assertRaisesRegex(ValueError, "Insufficient"):
            transport.split_archive(self.root, self.context, self.expected, self.part_bytes, self.validate_source(), admission)
        self.assertEqual((self.root / "part-001.bin").stat().st_size, self.part_bytes)
        self.assertFalse((self.root / "part-002.bin").exists())
        self.assertFalse((self.root / "parts-manifest.json").exists())

    def test_manifest_disk_measurements_are_exact_and_grant_no_authority(self):
        manifest = self.split()
        admission = manifest["disk_admission"]
        self.assertEqual(admission["purpose"], "DISK ADMISSION ONLY")
        self.assertEqual(admission["authority"], "none")
        self.assertEqual([m["pending_data_bytes"] for m in admission["before_parts"]],
                         [len(self.data) - i * self.part_bytes for i in range(5)])
        for change in (lambda m: m.pop("disk_admission"),
                       lambda m: m["disk_admission"].update(authority="granted"),
                       lambda m: m["disk_admission"]["before_parts"].pop(),
                       lambda m: m["disk_admission"]["pre_download"].update(available_bytes=0),
                       lambda m: m["disk_admission"]["before_parts"][1].update(required_bytes=1),
                       lambda m: m["disk_admission"]["before_parts"][1].update(filesystem_device=999999999)):
            changed = copy.deepcopy(manifest)
            change(changed)
            with self.assertRaises(ValueError):
                transport.validate_manifest(changed, self.expected, self.part_bytes)

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
                "size_in_bytes": len(blob), "expired": False,
                "created_at": "2026-10-06T22:40:00Z", "expires_at": "2026-10-20T22:40:00Z", "workflow_run": {
                    "id": self.context["run_id"], "head_sha": self.context["head_sha"], "head_branch": transport.BRANCH,
                    "repository_id": transport.SOURCE["repository_id"], "head_repository_id": transport.SOURCE["repository_id"]},
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

    def test_only_successful_terminal_certification_is_accepted(self):
        self.validate_source()
        for status, conclusion in (("in_progress", None), ("completed", "failure"),
                                   ("completed", "cancelled"), ("completed", "timed_out"),
                                   ("completed", None), ("queued", None), ("in_progress", "success")):
            with self.subTest(status=status, conclusion=conclusion), self.assertRaises(ValueError):
                self.run.update(status=status, conclusion=conclusion)
                self.validate_source()

    def test_failed_unfinished_duplicate_missing_or_changed_seal_is_rejected(self):
        for obj in (self.job, *self.job["steps"]):
            for field, bad in (("status", "in_progress"), ("status", "queued"), ("conclusion", "failure"),
                               ("conclusion", "cancelled"), ("conclusion", None), ("completed_at", None)):
                with self.subTest(object=obj["name"], field=field, bad=bad):
                    old, obj[field] = obj[field], bad
                    with self.assertRaises(ValueError):
                        self.validate_source()
                    obj[field] = old
        for index in range(len(transport.SEAL_STEPS)):
            original = copy.deepcopy(self.job["steps"])
            for changed in (original[:index] + original[index + 1:], original + [original[index]],
                            [{**step, "name": "wrong"} if i == index else step for i, step in enumerate(original)],
                            [{**step, "number": 99} if i == index else step for i, step in enumerate(original)]):
                self.job["steps"] = changed
                with self.assertRaises(ValueError):
                    self.validate_source()
            self.job["steps"] = original

    def test_source_retention_and_successful_upload_window_are_bound(self):
        observation = self.validate_source()
        self.assertEqual(observation["source_artifact_retention"], {
            "created_at": self.expected["artifact_created_at"], "expires_at": "2026-10-20T22:29:32Z", "expired": False})
        for obj, field, bad in ((self.source_artifact, "created_at", "2026-10-06T22:29:31Z"),
                                (self.source_artifact, "expires_at", "2026-10-06T22:29:30Z"),
                                (self.source_artifact, "expires_at", None),
                                (self.job["steps"][-1], "completed_at", "2026-10-06T22:29:45Z"),
                                (self.job, "completed_at", "2026-10-06T22:29:55Z")):
            old, obj[field] = obj[field], bad
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.validate_source()
            obj[field] = old

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
        self.assertEqual(manifest["authorities"], {"source": "none", "certification": "none", "deployment": "none", "publication": "none"})
        self.assertTrue(manifest["diagnostic_backup_only"])
        self.assertEqual(manifest["requested_retention_days"], 14)
        self.assertEqual(manifest["source_observation"]["overall_run"]["status"], "completed")
        self.assertEqual(manifest["source_observation"]["overall_run"]["conclusion"], "success")
        self.assertEqual([part["artifact_id"] for part in manifest["parts"]], [901, 902, 903, 904, 905])
        self.assertEqual(manifest["source"], self.expected)
        self.assertEqual(manifest["original_zip"], {
            "members": [{"name": "candidate.tar", "size_in_bytes": 793, "compressed_size_in_bytes": 793,
                         "sha256": hashed(bytes(range(256)) * 3 + b"unaltered candidate bytes")}],
            "expanded_size_in_bytes": 793})
        result = self.reassemble()
        self.assertEqual(result["sha256"], hashed(self.data))
        self.assertEqual((self.root / "reassembled-artifact.zip").read_bytes(), self.data)
        self.assertEqual((self.root / "original-artifact.zip").read_bytes(), self.data)
        encoded = json.dumps(manifest)
        self.assertNotIn(str(self.root), encoded)
        self.assertNotIn("token", encoded.lower())

    def test_five_part_boundaries_and_no_filesystem_extraction(self):
        with patch.object(zipfile.ZipFile, "extract", side_effect=AssertionError("No extraction")), \
             patch.object(zipfile.ZipFile, "extractall", side_effect=AssertionError("No extraction")):
            uploads, artifacts = self.ready()
            manifest = self.finalize(uploads, artifacts)
            self.reassemble()
        self.assertEqual(len(manifest["parts"]), 5)
        for part in manifest["parts"]:
            start = (part["index"] - 1) * self.part_bytes
            data = self.data[start:start + self.part_bytes]
            self.assertEqual((self.root / part["filename"]).read_bytes(), data)
            self.assertEqual(part["sha256"], hashed(data))
            self.assertEqual(part["size_in_bytes"], len(data))
            self.assertEqual(part["retention"], {"created_at": "2026-10-06T22:40:00Z", "expires_at": "2026-10-20T22:40:00Z", "expired": False})

    def test_source_observation_and_retention_are_required_on_reassembly(self):
        uploads, artifacts = self.ready()
        manifest = self.finalize(uploads, artifacts)
        changes = [lambda m: m.pop("source_observation"), lambda m: m.update(requested_retention_days=90),
                   lambda m: m["authorities"].update(source="granted"), lambda m: m.update(diagnostic_backup_only=False),
                   lambda m: m["source_observation"]["seal_job"].update(conclusion="failure"),
                   lambda m: m["source_observation"]["overall_run"].update(conclusion="failure"),
                   lambda m: m["parts"][0].pop("retention"), lambda m: m["parts"][0]["retention"].update(expired=True),
                   lambda m: m["parts"][0]["retention"].update(expires_at=None)]
        for mutate in changes:
            changed = copy.deepcopy(manifest)
            mutate(changed)
            (self.root / "transport-manifest.json").write_text(json.dumps(changed))
            with self.assertRaises(ValueError):
                self.reassemble()
            self.assertFalse((self.root / "reassembled-artifact.zip").exists())

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
                    transport.split_archive(root, self.context, self.expected, self.part_bytes, self.validate_source())
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
                              (artifact, "created_at", None), (artifact, "expires_at", None),
                              (artifact["workflow_run"], "id", 1),
                              (artifact["workflow_run"], "repository_id", 1),
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

    def test_unbound_source_and_cli_fail_before_network_or_filesystem(self):
        transport.validate_source_binding(self.expected)
        # This remains a negative test after the production SOURCE is literally bound.
        with patch.dict(transport.SOURCE, {"run_id": None}):
            with self.assertRaisesRegex(ValueError, "Unbound source identity"):
                transport.validate_source_binding()
            for command in ("prepare", "finalize", "reassemble"):
                with self.subTest(command=command), \
                     patch.object(sys, "argv", ["transport", command, "--directory", str(self.root / "absent")]), \
                     patch.object(transport, "gh_json", side_effect=AssertionError("No network")), \
                     patch.object(transport, "directory", side_effect=AssertionError("No file access")), \
                     self.assertRaisesRegex(ValueError, "Unbound source identity"):
                    transport.main()
        for field in self.expected:
            with self.subTest(field=field), self.assertRaises((ValueError, TypeError)):
                transport.validate_source_binding({**self.expected, field: None})

    def test_exact_part_count_and_bounded_upload_identities(self):
        for size, count in ((1, 1), (transport.PART_BYTES, 1), (transport.PART_BYTES + 1, 2),
                            (1739546272, 13), (transport.BASE_MAX_PARTS * transport.PART_BYTES, transport.BASE_MAX_PARTS)):
            with self.subTest(size=size):
                self.assertEqual(transport.part_count({**self.expected, "size_in_bytes": size}), count)
        for size in (0, -1, True, transport.MAX_PARTS * transport.PART_BYTES + 1):
            with self.subTest(size=size), self.assertRaises(ValueError):
                transport.part_count({**self.expected, "size_in_bytes": size})
        env = {f"PART_{i}_{key}": value for i in range(1, 6)
               for key, value in (("ID", str(900 + i)), ("DIGEST", "d" * 64))}
        self.assertEqual(transport.uploaded_parts(env, self.expected, self.part_bytes),
                         [(900 + i, "d" * 64) for i in range(1, 6)])
        for field, value in (("PART_5_ID", ""), ("PART_5_DIGEST", "bad"), ("PART_1_ID", "01"),
                             ("PART_6_ID", "906"), ("PART_6_DIGEST", "d" * 64)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                transport.uploaded_parts({**env, field: value}, self.expected, self.part_bytes)

    def test_candidate_member_streams_hash_and_rejects_extra_unsafe_and_corrupt(self):
        path = self.root / "candidate.zip"
        path.write_bytes(self.data)
        inventory = transport.candidate_inventory(self.root, path.name)
        self.assertEqual(inventory["members"][0]["sha256"], hashed(bytes(range(256)) * 3 + b"unaltered candidate bytes"))
        self.assertEqual(inventory["members"][0]["size_in_bytes"], 793)
        for name, mode in (("../candidate.tar", stat.S_IFREG), ("other.tar", stat.S_IFREG),
                           ("candidate.tar", stat.S_IFLNK), ("candidate.tar", stat.S_IFIFO),
                           ("candidate.tar", stat.S_IFDIR), ("candidate.tar", 0)):
            raw = io.BytesIO()
            with zipfile.ZipFile(raw, "w") as archive:
                entry = zipfile.ZipInfo(name)
                entry.external_attr = (mode | 0o644) << 16
                archive.writestr(entry, b"not extracted")
            path.write_bytes(raw.getvalue())
            with self.subTest(name=name, mode=mode), self.assertRaises(ValueError):
                transport.candidate_inventory(self.root, path.name)
        for name in ("candidate.tar", "extra.txt"):
            raw = io.BytesIO(self.data)
            with zipfile.ZipFile(raw, "a") as archive:
                archive.writestr(name, b"extra")
            path.write_bytes(raw.getvalue())
            with self.subTest(extra=name), self.assertRaises(ValueError):
                transport.candidate_inventory(self.root, path.name)
        corrupt = bytearray(self.data)
        # ZIP_STORED member starts after the 30-byte local header and filename.
        corrupt[30 + len("candidate.tar")] ^= 1
        path.write_bytes(corrupt)
        with self.assertRaises(zipfile.BadZipFile):
            transport.candidate_inventory(self.root, path.name)
        path.write_bytes(self.data)
        with patch.object(transport, "CANDIDATE_TAR_LIMIT", 792), \
             patch.object(zipfile.ZipFile, "open", side_effect=AssertionError("Reject before decoding")), \
             self.assertRaises(ValueError):
            transport.candidate_inventory(self.root, path.name)

    def test_manifest_requires_streamed_candidate_sha_and_exact_single_member(self):
        uploads, artifacts = self.ready()
        manifest = self.finalize(uploads, artifacts)
        for mutate in (lambda m: m["original_zip"]["members"][0].pop("sha256"),
                       lambda m: m["original_zip"]["members"][0].update(sha256="invalid"),
                       lambda m: m["original_zip"]["members"][0].update(name="other.tar"),
                       lambda m: m["original_zip"]["members"].append(m["original_zip"]["members"][0])):
            changed = copy.deepcopy(manifest)
            mutate(changed)
            with self.assertRaises(ValueError):
                transport.validate_manifest(changed, self.expected, self.part_bytes, final=True)
        manifest["original_zip"]["members"][0]["sha256"] = "0" * 64
        (self.root / "transport-manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "ZIP inventory mismatch"):
            self.reassemble()
        self.assertFalse((self.root / "reassembled-artifact.zip").exists())

    def test_production_bounds_and_workflow_scope(self):
        chunk = transport.PART_BYTES
        self.assertEqual(chunk, 128 * 1024 * 1024)
        self.assertEqual(transport.part_count({**self.expected, "size_in_bytes": 1739546272}), 13)
        # Stored deflate block overhead plus a generous ZIP header allowance.
        self.assertLess(chunk + 5 * ((chunk + 16382) // 16383) + 65536, transport.DOWNLOAD_LIMIT)
        workflow = SCRIPT.parents[1] / "workflows/financial-renewal-candidate-transport.yml"
        text = workflow.read_text()
        self.assertIn("branches: [" + transport.BRANCH + "]", text)
        self.assertIn("timeout-minutes: 30", text)
        self.assertEqual(text.count("retention-days: 14"), transport.MAX_PARTS + 1)
        self.assertEqual(text.count("compression-level: 0"), transport.MAX_PARTS + 1)
        self.assertNotIn("workflow_dispatch:", text)
        self.assertNotIn("workflow_run:", text)
        self.assertNotIn(": write", text)
        self.assertNotIn("deploy", text)
        self.assertNotIn("always()", text)
        self.assertEqual(text.count("fromJSON(steps.prepare.outputs.part_count) >="), transport.MAX_PARTS)
        for i in range(1, transport.MAX_PARTS + 1):
            self.assertIn(f"part-{i:03d}.bin", text)
            self.assertIn(f"PART_{i}_ID:", text)
            self.assertIn(f"PART_{i}_DIGEST:", text)
        self.assertEqual(transport.CANDIDATE_TAR_LIMIT, 8589934592)


if __name__ == "__main__":
    unittest.main()
