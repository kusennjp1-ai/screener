#!/usr/bin/env python3
"""Adversarial local fixtures. Never contact GitHub or read a real candidate."""
import hashlib
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile
import zlib

SCRIPT = Path(__file__).with_name("financial-renewal-validation-archive.py")
archive = types.ModuleType("financial_renewal_validation_archive")
exec(compile(SCRIPT.read_bytes(), str(SCRIPT), "exec"), archive.__dict__)


def tar_bytes(extra=(), omit=(), overrides=None):
    overrides = overrides or {}
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.GNU_FORMAT) as tar:
        for name in sorted(archive.TOP_MEMBERS):
            if name in omit:
                continue
            item = tarfile.TarInfo(name)
            item.type = tarfile.DIRTYPE if name in archive.TOP_DIRS else tarfile.REGTYPE
            data = overrides.get(name, (name + "\n").encode()) if item.isfile() else b""
            item.size = len(data)
            tar.addfile(item, io.BytesIO(data) if data else None)
        for name, data, kind in extra:
            item = tarfile.TarInfo(name)
            item.type = kind
            item.size = len(data)
            if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                item.linkname = "../../outside"
            tar.addfile(item, io.BytesIO(data) if data else None)
    return output.getvalue()


def zip_bytes(payload, *, name=b"candidate.tar", decoded_size=None, crc=None,
              compressed=None, method=8, flags=0, descriptor=None, external=None):
    """Build fixtures with deliberately inconsistent full compressed streams."""
    compressor = zlib.compressobj(wbits=-15)
    if compressed is None:
        compressed = compressor.compress(payload) + compressor.flush() if method == 8 else payload
    decoded_size = len(payload) if decoded_size is None else decoded_size
    crc = zlib.crc32(payload) if crc is None else crc
    local = struct.pack("<4s5H3I2H", b"PK\x03\x04", 20, flags, method, 0, 0,
                        crc if not flags & 8 else 0, len(compressed) if not flags & 8 else 0,
                        decoded_size if not flags & 8 else 0, len(name), 0) + name
    if descriptor is None:
        descriptor = struct.pack("<4sIII", b"PK\x07\x08", crc, len(compressed), decoded_size) if flags & 8 else b""
    external = (stat.S_IFREG | 0o600) << 16 if external is None else external
    central = struct.pack("<4s6H3I5H2I", b"PK\x01\x02", (3 << 8) | 20, 20, flags,
                          method, 0, 0, crc, len(compressed), decoded_size,
                          len(name), 0, 0, 0, 0, external, 0) + name
    offset = len(local) + len(compressed) + len(descriptor)
    end = struct.pack("<4s4H2IH", b"PK\x05\x06", 0, 0, 1, 1, len(central), offset, 0)
    return local + compressed + descriptor + central + end


class ArchivePreflightTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.zip = self.root / "artifact.zip"
        self.binding = self.root / "binding.json"
        self.tar = self.root / "candidate.tar"
        self.metadata = self.root / "metadata"
        self.report = self.root / "report.json"
        # Fixtures are tiny; model capacity separately so low-space developer
        # hosts can exercise byte validation without weakening the real gate.
        self.disk_patch = patch.object(archive.os, "fstatvfs", return_value=
                                      types.SimpleNamespace(f_bavail=10 * 1024 ** 3, f_frsize=1))
        self.disk_patch.start()

    def tearDown(self):
        self.disk_patch.stop()
        self.temporary.cleanup()

    def inputs(self, payload):
        self.zip.write_bytes(payload)
        self.binding.write_text(json.dumps({"artifact_id": 12345, "size_in_bytes": len(payload),
                                            "sha256": hashlib.sha256(payload).hexdigest()}))

    def run_preflight(self, payload):
        self.inputs(payload)
        return archive.preflight(*(str(path) for path in
                                   (self.zip, self.binding, self.tar, self.metadata, self.report)))

    def assert_rejected(self, payload, message=None):
        with self.assertRaises((ValueError, OSError, tarfile.TarError, zipfile.BadZipFile,
                                UnicodeError, zlib.error)) as caught:
            self.run_preflight(payload)
        if message:
            self.assertIn(message, str(caught.exception))
        self.assertFalse(self.report.exists(), "A failed preflight must never emit success evidence")

    def test_valid_archive_reports_full_size_and_only_copies_budget_metadata(self):
        root_name = "root-" + "a" * 64 + ".json"
        logical_name = "logical-" + "b" * 64 + ".json"
        extra = [
            ("corrected/publication.json", b"{}\n", tarfile.REGTYPE),
            ("predecessor/publication.json", b"{}\n", tarfile.REGTYPE),
            ("corrected/static-data/_transport/" + root_name, b"{}\n", tarfile.REGTYPE),
            ("corrected/static-data/_financial-audit-transport/static-data/_transport/" + logical_name,
             b"{}\n", tarfile.REGTYPE),
            ("predecessor/static-data/_transport/" + logical_name, b"{}\n", tarfile.REGTYPE),
            ("corrected/static-data/_transport/shard-" + "c" * 64 + ".json", b"not-copied", tarfile.REGTYPE),
            ("corrected/payload.bin", b"payload" * 1000, tarfile.REGTYPE),
            ("original-source/files/a.py", b"print(1)\n", tarfile.REGTYPE),
        ]
        payload = tar_bytes(extra)
        result = self.run_preflight(zip_bytes(payload))
        self.assertEqual(result["tar_bytes"], len(payload))
        self.assertEqual(result["tar_sha256"], hashlib.sha256(payload).hexdigest())
        expected_bytes = sum(len((name + "\n").encode()) for name in archive.TOP_FILES)
        expected_bytes += sum(len(data) for _, data, _ in extra)
        self.assertEqual(result["extracted_bytes"], expected_bytes)
        self.assertEqual(sum(result["top_level_bytes"].values()), expected_bytes)
        self.assertEqual(result["top_level_bytes"]["original-source"], len(b"print(1)\n"))
        self.assertEqual(result["file_count"], len(archive.TOP_FILES) + len(extra))
        self.assertEqual(result["metadata_file_count"], len(archive.METADATA_FILES) + 5)
        self.assertEqual(self.tar.read_bytes(), payload)
        self.assertFalse((self.metadata / "target-base.json").exists())
        self.assertFalse((self.metadata / "evidence.json").exists())
        self.assertFalse((self.metadata / "corrected/payload.bin").exists())
        self.assertTrue((self.metadata / "corrected/static-data/_transport" / root_name).is_file())
        self.assertFalse(result["candidate_extracted"])
        self.assertEqual(result["authority"], "none")
        self.assertEqual(json.loads(self.report.read_bytes()), result)

    def test_valid_stored_zip(self):
        result = self.run_preflight(zip_bytes(tar_bytes(), method=0))
        self.assertEqual(result["status"], "verified")

    def test_valid_signed_data_descriptor(self):
        result = self.run_preflight(zip_bytes(tar_bytes(), flags=8))
        self.assertEqual(result["status"], "verified")

    def test_valid_zip64_local_header(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
            with target.open("candidate.tar", "w", force_zip64=True) as member:
                member.write(tar_bytes())
        self.assertEqual(self.run_preflight(output.getvalue())["status"], "verified")

    def test_valid_bounded_gnu_long_name(self):
        name = "corrected/" + "long" * 40 + "/payload.bin"
        result = self.run_preflight(zip_bytes(tar_bytes([(name, b"x", tarfile.REGTYPE)])))
        self.assertEqual(result["header_count"], result["entry_count"] + 1)

    def test_missing_binding_is_rejected_before_zip_open(self):
        self.binding.write_text(json.dumps({"artifact_id": None, "size_in_bytes": None, "sha256": None}))
        with patch.object(archive, "materialize_tar", side_effect=AssertionError("Archive accessed")):
            with self.assertRaisesRegex(ValueError, "artifact ID"):
                archive.preflight(*(str(path) for path in
                                    (self.zip, self.binding, self.tar, self.metadata, self.report)))
        self.assertFalse(self.tar.exists())
        self.assertFalse(self.metadata.exists())

    def test_duplicate_binding_key_rejected(self):
        self.binding.write_text('{"artifact_id":1,"artifact_id":2,"size_in_bytes":4,"sha256":"' + "a" * 64 + '"}')
        with self.assertRaisesRegex(ValueError, "Duplicate JSON"):
            archive.read_binding(str(self.binding))

    def test_incorrect_binding_hash_rejected_before_any_output(self):
        payload = zip_bytes(tar_bytes())
        self.inputs(payload)
        binding = json.loads(self.binding.read_bytes())
        binding["sha256"] = "0" * 64
        self.binding.write_text(json.dumps(binding))
        with self.assertRaisesRegex(ValueError, "SHA256"):
            archive.preflight(*(str(path) for path in
                                (self.zip, self.binding, self.tar, self.metadata, self.report)))
        self.assertFalse(self.tar.exists())

    def test_multiple_zip_members_rejected(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as target:
            target.writestr("candidate.tar", tar_bytes())
            target.writestr("extra.txt", b"x")
        self.assert_rejected(output.getvalue(), "one bounded ZIP")

    def test_zip_trailing_bytes_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes()) + b"unexpected", "Trailing bytes")

    def test_zip_symlink_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes(), external=(stat.S_IFLNK | 0o777) << 16), "special ZIP")

    def test_incorrect_zip_filename_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes(), name=b"../candidate.tar"), "Unexpected ZIP")

    def test_encrypted_zip_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes(), flags=1), "encrypted ZIP")

    def test_false_decoded_size_cannot_hide_suffix(self):
        payload = tar_bytes()
        self.assert_rejected(zip_bytes(payload, decoded_size=len(payload) - 512), "declared size")

    def test_false_decoded_size_too_large_rejected(self):
        payload = tar_bytes()
        self.assert_rejected(zip_bytes(payload, decoded_size=len(payload) + 512), "CRC mismatch")

    def test_crc_mismatch_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes(), crc=0), "CRC mismatch")

    def test_trailing_deflate_payload_rejected(self):
        payload = tar_bytes()
        compressor = zlib.compressobj(wbits=-15)
        compressed = compressor.compress(payload) + compressor.flush() + b"hidden suffix"
        self.assert_rejected(zip_bytes(payload, compressed=compressed), "Trailing DEFLATE")

    def test_truncated_deflate_stream_rejected(self):
        payload = tar_bytes()
        compressor = zlib.compressobj(wbits=-15)
        compressed = (compressor.compress(payload) + compressor.flush())[:-1]
        self.assert_rejected(zip_bytes(payload, compressed=compressed), "Truncated or trailing DEFLATE")

    def test_forged_descriptor_rejected(self):
        descriptor = struct.pack("<4sIII", b"PK\x07\x08", 0, 0, 0)
        self.assert_rejected(zip_bytes(tar_bytes(), flags=8, descriptor=descriptor), "descriptor mismatch")

    def test_missing_top_level_closure_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes(omit=["original-previous-source"])), "top-level closure")

    def test_unknown_top_level_member_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes([("unexpected", b"x", tarfile.REGTYPE)])), "top-level")

    def test_duplicate_tar_member_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes([("candidate.json", b"x", tarfile.REGTYPE)])), "Duplicate TAR")

    def test_traversal_tar_member_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes([("corrected/../../outside", b"x", tarfile.REGTYPE)])), "Unsafe TAR")

    def test_symlink_tar_member_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes([("corrected/link", b"", tarfile.SYMTYPE)])), "special TAR")

    def test_hardlink_tar_member_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes([("corrected/link", b"", tarfile.LNKTYPE)])), "special TAR")

    def test_fifo_tar_member_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes([("corrected/fifo", b"", tarfile.FIFOTYPE)])), "special TAR")

    def test_file_parent_alias_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes([
            ("corrected/a", b"x", tarfile.REGTYPE), ("corrected/a/b", b"x", tarfile.REGTYPE)])), "parent directory")

    def test_directory_replaced_by_file_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes([
            ("corrected/a/b", b"x", tarfile.REGTYPE), ("corrected/a", b"x", tarfile.REGTYPE)])), "replaced by file")

    def test_nonzero_trailing_tar_bytes_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes() + b"X" + bytes(511)), "trailing TAR")

    def test_concatenated_tar_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes() + tar_bytes()), "concatenated TAR")

    def test_invalid_tar_checksum_rejected(self):
        payload = bytearray(tar_bytes())
        payload[0] ^= 1
        self.assert_rejected(zip_bytes(bytes(payload)))

    def test_truncated_tar_rejected(self):
        self.assert_rejected(zip_bytes(tar_bytes()[:-1]), "Invalid TAR length")

    def test_oversized_metadata_rejected_without_metadata_writes(self):
        with patch.object(archive, "METADATA_MEMBER_LIMIT", 8):
            self.assert_rejected(zip_bytes(tar_bytes()), "metadata exceeds")
        self.assertFalse(self.metadata.exists())

    def test_aggregate_metadata_cap_rejected(self):
        with patch.object(archive, "METADATA_LIMIT", 20):
            self.assert_rejected(zip_bytes(tar_bytes()), "metadata exceeds")

    def test_entry_cap_rejected(self):
        with patch.object(archive, "ENTRY_LIMIT", 10):
            self.assert_rejected(zip_bytes(tar_bytes()), "entry count")

    def test_reserve_included_in_space_gate(self):
        payload = tar_bytes()
        required = len(payload) + archive.METADATA_LIMIT + archive.RESERVE_BYTES
        disk = types.SimpleNamespace(f_bavail=required - 1, f_frsize=1)
        with patch.object(archive.os, "fstatvfs", return_value=disk):
            self.assert_rejected(zip_bytes(payload), "Insufficient measured disk")
        self.assertFalse(self.tar.exists())

    def test_pax_extension_rejected_before_reading_unbounded_payload(self):
        self.assert_rejected(zip_bytes(tar_bytes([
            ("corrected/extension", b"25 path=corrected/file\n", tarfile.XHDTYPE)])), "special TAR")

    def test_oversized_gnu_name_rejected(self):
        name = "corrected/" + "x" * archive.PATH_LIMIT
        self.assert_rejected(zip_bytes(tar_bytes([(name, b"x", tarfile.REGTYPE)])), "Oversized")

    def test_nonzero_tar_padding_rejected(self):
        payload = bytearray(tar_bytes())
        # The first member is baseline/ (directory). The next is candidate.json.
        start = 2 * 512 + len(b"candidate.json\n")
        payload[start] = 1
        self.assert_rejected(zip_bytes(bytes(payload)), "padding")

    def test_tar_digest_rechecked_after_materialization(self):
        payload = tar_bytes()
        with self.assertRaisesRegex(ValueError, "bytes changed"):
            archive.inspect_tar(io.BytesIO(payload), len(payload), "0" * 64)

    def test_input_mutation_detected_before_success_report(self):
        original = archive.hash_stream

        def hash_then_mutate(source, limit):
            result = original(source, limit)
            info = self.zip.stat()
            os.utime(self.zip, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000))
            return result

        with patch.object(archive, "hash_stream", side_effect=hash_then_mutate):
            self.assert_rejected(zip_bytes(tar_bytes()), "Input changed")
        self.assertFalse(self.metadata.exists())

    def test_space_failure_before_tar_creation(self):
        disk = types.SimpleNamespace(f_bavail=0, f_frsize=4096)
        with patch.object(archive.os, "fstatvfs", return_value=disk):
            self.assert_rejected(zip_bytes(tar_bytes()), "Insufficient measured disk")
        self.assertFalse(self.tar.exists())

    def test_hardlinked_zip_input_rejected(self):
        payload = zip_bytes(tar_bytes())
        self.inputs(payload)
        os.link(self.zip, self.root / "alias.zip")
        with self.assertRaisesRegex(ValueError, "Linked or nonregular"):
            archive.preflight(*(str(path) for path in
                                (self.zip, self.binding, self.tar, self.metadata, self.report)))

    def test_symlinked_output_parent_rejected(self):
        actual = self.root / "actual"
        actual.mkdir()
        linked = self.root / "linked"
        linked.symlink_to(actual, target_is_directory=True)
        self.inputs(zip_bytes(tar_bytes()))
        with self.assertRaisesRegex(ValueError, "without symlinks"):
            archive.preflight(str(self.zip), str(self.binding), str(linked / "candidate.tar"),
                              str(self.metadata), str(self.report))
        self.assertEqual(list(actual.iterdir()), [])

    def test_existing_output_not_overwritten(self):
        self.tar.write_bytes(b"keep")
        self.assert_rejected(zip_bytes(tar_bytes()), "already exists")
        self.assertEqual(self.tar.read_bytes(), b"keep")

    def test_cli_uses_required_arguments_and_emits_small_report(self):
        self.inputs(zip_bytes(tar_bytes()))
        arguments = ["--zip", str(self.zip), "--binding", str(self.binding),
                     "--candidate-tar", str(self.tar), "--metadata", str(self.metadata),
                     "--report", str(self.report)]
        output = io.StringIO()
        with redirect_stdout(output):
            code = archive.main(arguments)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.getvalue())["status"], "verified")
        self.assertLess(len(output.getvalue()), 10_000)
        missing = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True, check=False)
        self.assertEqual(missing.returncode, 2)
        self.assertIn("--binding", missing.stderr)


if __name__ == "__main__":
    unittest.main()
