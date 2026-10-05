"""Offline adversarial fixtures for the pinned review-only extractor."""
import gzip
import hashlib
import importlib.util
import io
from pathlib import Path
import stat
import struct
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

spec = importlib.util.spec_from_file_location("extract_diagnostic", Path(__file__).with_name("extract-ranking-diagnostic.py"))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)

TARGET = extractor.RESEARCH_MEMBER
WIRE = b'{"rows":[{"symbol":"EXACT"}],"original_spacing": true}\n'
LIMITS = extractor.Limits(zip_bytes=2 * 1024 * 1024, expanded_bytes=4 * 1024 * 1024, tar_members=32)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def member(name, data=b"", kind=tarfile.REGTYPE, link="", pax=None):
    info = tarfile.TarInfo(name)
    info.type, info.size, info.linkname = kind, len(data), link
    if pax:
        info.pax_headers = pax
    return info, data


def tar_bytes(entries, format=tarfile.PAX_FORMAT):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=format) as archive:
        for info, data in entries:
            archive.addfile(info, io.BytesIO(data))
    return output.getvalue()


def zip_bytes(entries, compression=zipfile.ZIP_DEFLATED):
    output = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(output, "w", compression=compression) as archive:
            for name, data in entries:
                archive.writestr(name, data)
    return output.getvalue()


class DiagnosticExtractionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.archive, self.output = self.root / "input.zip", self.root / "research.json"

    def run_extract(self, raw, *, container="candidate.tar", expected_members=None, **options):
        self.archive.write_bytes(raw)
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as fixture:
                member_sizes = {extractor.safe_name(info.filename, info.is_dir(), LIMITS): info.file_size for info in fixture.infolist()}
                container_hash = sha(fixture.open(container).read()) if container and "container_sha256" not in options else None
        except (ValueError, OSError, KeyError, zipfile.BadZipFile):
            member_sizes, container_hash = {}, None
        return extractor.extract(self.archive, self.output, outer_sha256=options.pop("outer_sha256", sha(raw)),
                                 wire_sha256=options.pop("wire_sha256", sha(WIRE)), container=container,
                                 expected_members=expected_members or (container or TARGET,),
                                 limits=options.pop("limits", LIMITS), outer_bytes=options.pop("outer_bytes", len(raw)),
                                 container_sha256=options.pop("container_sha256", container_hash),
                                 member_sizes=options.pop("member_sizes", member_sizes), **options)

    def packaged(self, entries=None, *, compressed=False):
        payload = tar_bytes(entries or [member(TARGET, WIRE)])
        name = "diagnostic.tar.gz" if compressed else "candidate.tar"
        return zip_bytes([(name, gzip.compress(payload) if compressed else payload)]), name

    def assert_rejected(self, raw, message=None, **options):
        with self.assertRaisesRegex((ValueError, OSError, EOFError, tarfile.TarError, zipfile.BadZipFile), message or ".*"):
            self.run_extract(raw, **options)
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.root.glob(".ranking-diagnostic-*")))

    def test_exact_selected_wire_and_review_only_provenance(self):
        raw, _ = self.packaged([member("./", kind=tarfile.DIRTYPE), member("unrelated.json", b"not selected"),
                                member("./" + TARGET, WIRE), member("after.txt", b"also not selected")])
        result = self.run_extract(raw)
        self.assertEqual(self.output.read_bytes(), WIRE)
        self.assertEqual(set(path.name for path in self.root.iterdir()), {"input.zip", "research.json"})
        self.assertEqual(result["status"], "UNAPPROVED")
        self.assertEqual(result["publication_authority"], "none")
        self.assertFalse(result["accepted_release_input"])
        self.assertEqual(result["wire_sha256"], sha(WIRE))

    def test_gzip_tar_and_metadata_sidecar_are_streamed(self):
        raw, container = self.packaged(compressed=True)
        with zipfile.ZipFile(io.BytesIO(raw)) as zipped:
            payload = zipped.read(container)
        raw = zip_bytes([(container, payload), ("metadata.json", b"{}")])
        with patch.object(zipfile.ZipFile, "read", side_effect=AssertionError("No full member read")):
            self.run_extract(raw, container=container, expected_members=(container, "metadata.json"))
        self.assertEqual(self.output.read_bytes(), WIRE)

    def test_direct_zip_is_supported_only_when_explicitly_pinned(self):
        raw = zip_bytes([(TARGET, WIRE)])
        self.run_extract(raw, container=None)
        self.assertEqual(self.output.read_bytes(), WIRE)

    def test_wrong_outer_hash_precedes_decompression(self):
        raw, _ = self.packaged()
        with patch.object(zipfile.ZipFile, "open", side_effect=AssertionError("Unverified archive opened")):
            self.assert_rejected(raw, "Outer ZIP SHA256 mismatch", outer_sha256="0" * 64, container_sha256=None)

    def test_wrong_wire_hash_leaves_no_output(self):
        raw, _ = self.packaged([member(TARGET, WIRE + b" ")])
        self.assert_rejected(raw, "Research wire SHA256 mismatch")

    def test_pinned_cli_cannot_override_hashes_or_member(self):
        self.assertEqual(extractor.ARTIFACT_ID, 11319208142)
        self.assertEqual(extractor.RUN_ID, 37244922910)
        self.assertEqual(extractor.RUN_ATTEMPT, 1)
        self.assertEqual(extractor.OUTER_SHA256, "2f1de2c2bd4c8107daff636caad2723ec6ac1c5aa97b07af0e0cbaaad08f236a")
        self.assertEqual(extractor.WIRE_SHA256, "10310c30693f0bc80d5ebc3b49428d422fdf64e1e5361fe5d849a058f1642690")
        with patch.object(sys, "argv", ["extract", "--archive", "input.zip", "--output", "result.json", "--wire-sha256", "0" * 64]), patch.object(sys, "stderr", io.StringIO()):
            with self.assertRaises(SystemExit) as result:
                extractor.main()
            self.assertEqual(result.exception.code, 2)

    def test_zip_traversal_and_unsafe_paths(self):
        for name in ("../outside", "/absolute", "C:/drive", "x\\y", "x/../y", "x//y", "x/./y", "x\ny"):
            with self.subTest(name=name):
                self.assert_rejected(zip_bytes([(TARGET, WIRE), (name, b"bad")]), "Unsafe archive path", container=None,
                                     expected_members=(TARGET, name))

    def test_tar_traversal_rejected_even_after_selected_member(self):
        for name in ("../outside", "./../outside", "/absolute", "C:/drive", "x\\y", "x/../y", "x//y", "x/./y", "x\ny"):
            with self.subTest(name=name):
                raw, _ = self.packaged([member(TARGET, WIRE), member(name, b"bad")])
                self.assert_rejected(raw, "Unsafe archive path")

    def test_duplicate_target_and_normalized_aliases(self):
        for alias in (TARGET, "./" + TARGET, "././" + TARGET):
            with self.subTest(alias=alias):
                raw, _ = self.packaged([member(TARGET, WIRE), member(alias, WIRE)])
                self.assert_rejected(raw, "Duplicate normalized archive path")
                self.assert_rejected(zip_bytes([(TARGET, WIRE), (alias, WIRE)]), "Duplicate normalized archive path",
                                     container=None, expected_members=(TARGET, alias))

    def test_unrelated_duplicates_and_file_directory_conflicts(self):
        for entries in ([member("x", b"file"), member("x/y", b"child")],
                        [member("x/y", b"child"), member("x", b"file")],
                        [member("x/", kind=tarfile.DIRTYPE), member("./x", kind=tarfile.DIRTYPE)]):
            raw, _ = self.packaged([member(TARGET, WIRE), *entries])
            self.assert_rejected(raw, "(Duplicate|Conflicting)")

    def test_tar_symlinks_hardlinks_and_special_types(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.GNUTYPE_SPARSE):
            with self.subTest(kind=kind):
                raw, _ = self.packaged([member(TARGET, WIRE), member("other", kind=kind, link="outside" if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE) else "")])
                self.assert_rejected(raw, "(link metadata|Special TAR)")

    def test_zip_symlinks_and_special_types(self):
        for kind in (stat.S_IFLNK, stat.S_IFIFO, stat.S_IFCHR, stat.S_IFBLK, stat.S_IFSOCK):
            info = zipfile.ZipInfo("other")
            info.create_system, info.external_attr = 3, (kind | 0o777) << 16
            with self.subTest(kind=kind):
                self.assert_rejected(zip_bytes([(TARGET, WIRE), (info, b"target")]), "Special ZIP member", container=None,
                                     expected_members=(TARGET, "other"))

    def test_zip_pkware_unix_link_metadata_is_rejected(self):
        info = zipfile.ZipInfo("other")
        # APPNOTE 0x000d can carry a link target even with ordinary mode bits.
        info.extra = struct.pack("<HH", 0x000D, 7) + b"outside"
        self.assert_rejected(zip_bytes([(TARGET, WIRE), (info, b"")]), "Unsupported ZIP extra field", container=None,
                             expected_members=(TARGET, "other"))

    def test_missing_or_directory_target_is_rejected(self):
        for entries in ([member(TARGET + ".other", WIRE)], [member(TARGET, kind=tarfile.DIRTYPE)]):
            raw, _ = self.packaged(entries)
            self.assert_rejected(raw, "(missing|regular research)")

    def test_unexpected_zip_inventory_is_rejected(self):
        raw, _ = self.packaged()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            payload = archive.read("candidate.tar")
        self.assert_rejected(zip_bytes([("candidate.tar", payload), ("unexpected", b"x")]), "Unexpected ZIP inventory")

    def test_archive_bounds(self):
        raw, _ = self.packaged()
        for limits, message in ((LIMITS._replace(zip_bytes=len(raw) - 1), "ZIP exceeds"),
                                (LIMITS._replace(central_directory_bytes=1), "inventory exceeds"),
                                (LIMITS._replace(expanded_bytes=100), "ZIP member exceeds"),
                                (LIMITS._replace(selected_bytes=len(WIRE) - 1), "Selected research exceeds"),
                                (LIMITS._replace(tar_members=0), "TAR member count")):
            with self.subTest(limits=limits):
                self.assert_rejected(raw, message, limits=limits)

    def test_decompressed_tar_bound_does_not_trust_gzip_size(self):
        raw, container = self.packaged([member(TARGET, WIRE), member("large", b"x" * 32768)], compressed=True)
        self.assert_rejected(raw, "(TAR member exceeds|Expanded archive exceeds)", container=container,
                             limits=LIMITS._replace(expanded_bytes=20000))

    def test_zip_member_count_bound(self):
        raw = zip_bytes([(TARGET, WIRE), ("extra", b"")])
        self.assert_rejected(raw, "inventory exceeds", container=None, expected_members=(TARGET, "extra"),
                             limits=LIMITS._replace(zip_members=1))

    def test_truncated_zip_and_tar(self):
        raw, _ = self.packaged()
        self.assert_rejected(raw[:-10], "ZIP")
        payload = tar_bytes([member(TARGET, WIRE)])
        for data in (payload[:100], payload[:520], payload[:1024], payload[:1536], payload[:-1]):
            with self.subTest(length=len(data)):
                self.assert_rejected(zip_bytes([("candidate.tar", data)]), "(Truncated|terminator)")

    def test_tar_nonzero_data_after_terminator_is_rejected(self):
        payload = tar_bytes([member(TARGET, WIRE)]) + b"x" * 512
        self.assert_rejected(zip_bytes([("candidate.tar", payload)]), "Nonzero data after TAR terminator")

    def test_gzip_truncation_and_corruption(self):
        payload = gzip.compress(tar_bytes([member(TARGET, WIRE)]))
        for data in (payload[:-1], payload[:-8], payload[:-8] + b"\xff" * 8):
            self.assert_rejected(zip_bytes([("diagnostic.tar.gz", data)]), container="diagnostic.tar.gz")

    def test_tar_checksum_corruption(self):
        payload = bytearray(tar_bytes([member(TARGET, WIRE)]))
        payload[0] ^= 1
        self.assert_rejected(zip_bytes([("candidate.tar", payload)]), "checksum")

    def test_pax_and_gnu_long_name_selection(self):
        for format in (tarfile.PAX_FORMAT, tarfile.GNU_FORMAT):
            with self.subTest(format=format):
                raw = zip_bytes([("candidate.tar", tar_bytes([member("long/" + "x" * 130, b"skip"), member(TARGET, WIRE)], format))])
                self.run_extract(raw)
                self.assertEqual(self.output.read_bytes(), WIRE)
                self.output.unlink()

    def test_pax_path_traversal_alias_and_sparse_metadata(self):
        for pax, message in (({"path": "../outside"}, "Unsafe archive path"),
                             ({"path": "./" + TARGET}, "Duplicate normalized archive path"),
                             ({"GNU.sparse.map": "0,1"}, "Unsupported or duplicate PAX"),
                             ({"size": "999999999"}, "TAR member exceeds")):
            raw, _ = self.packaged([member(TARGET, WIRE), member("other", b"x", pax=pax)])
            self.assert_rejected(raw, message)

    def test_metadata_bound_is_checked_before_reading_payload(self):
        entry = member("pax", b"x" * 100, kind=tarfile.XHDTYPE)
        raw, _ = self.packaged([entry, member(TARGET, WIRE)])
        self.assert_rejected(raw, "TAR metadata exceeds", limits=LIMITS._replace(metadata_bytes=32))

    def test_no_unbounded_reads_when_skipping_large_members(self):
        data = tar_bytes([member("large", b"x" * (2 * extractor.CHUNK)), member(TARGET, WIRE)])

        class Guarded(io.BytesIO):
            def read(self, size=-1):
                self.assert_size(size)
                return super().read(size)

            def assert_size(self, size):
                if not 0 <= size <= extractor.CHUNK:
                    raise AssertionError("Unbounded input read")

        selected, _, _ = extractor.read_tar(Guarded(data), TARGET, LIMITS)
        self.assertEqual(selected, WIRE)

    def test_zip64_end_record_and_local_extra_are_supported(self):
        with patch.object(zipfile, "ZIP64_LIMIT", 100):
            raw, _ = self.packaged()
        self.run_extract(raw)
        self.assertEqual(self.output.read_bytes(), WIRE)

    def test_existing_output_and_symlink_are_never_overwritten(self):
        raw, _ = self.packaged()
        self.output.write_bytes(b"keep")
        with self.assertRaisesRegex(ValueError, "Output already exists"):
            self.run_extract(raw)
        self.assertEqual(self.output.read_bytes(), b"keep")
        self.output.unlink()
        victim = self.root / "victim"
        victim.write_bytes(b"keep")
        self.output.symlink_to(victim)
        with self.assertRaisesRegex(ValueError, "Output already exists"):
            self.run_extract(raw)
        self.assertEqual(victim.read_bytes(), b"keep")

    def test_symlink_output_parent_is_rejected(self):
        raw, _ = self.packaged()
        real = self.root / "real"
        real.mkdir()
        link = self.root / "alias"
        link.symlink_to(real, target_is_directory=True)
        self.output = link / "research.json"
        self.assert_rejected(raw, "Output directory contains a link")
        self.assertFalse(list(real.iterdir()))

    def test_atomic_publish_cleans_partial_after_failure(self):
        raw, _ = self.packaged()
        with patch.object(extractor.os, "link", side_effect=OSError("exclusive publish failed")):
            self.assert_rejected(raw, "exclusive publish failed")

    def test_changed_archive_is_rejected_before_publish(self):
        raw, _ = self.packaged()
        original = extractor.read_tar

        def changed(*args, **kwargs):
            result = original(*args, **kwargs)
            with self.archive.open("ab") as source:
                source.write(b"changed")
            return result

        with patch.object(extractor, "read_tar", side_effect=changed):
            self.assert_rejected(raw, "Archive changed")

    def test_exact_outer_member_sizes_and_container_hash_are_required(self):
        raw, _ = self.packaged()
        for options, message in (({"outer_bytes": len(raw) + 1}, "Outer ZIP byte size mismatch"),
                                 ({"member_sizes": {"candidate.tar": 1}}, "ZIP member byte sizes differ"),
                                 ({"container_sha256": "0" * 64}, "Container SHA256 mismatch")):
            with self.subTest(options=options):
                self.assert_rejected(raw, message, **options)

    def test_crc_failure_after_selected_member_prevents_publish(self):
        payload = tar_bytes([member(TARGET, WIRE)])
        raw = zip_bytes([("candidate.tar", payload), ("metadata.json", b"CORRUPTME")], zipfile.ZIP_STORED)
        raw = raw.replace(b"CORRUPTME", b"CORRUPTED")
        self.assert_rejected(raw, "CRC", expected_members=("candidate.tar", "metadata.json"))

    def test_zip_nul_names_are_rejected(self):
        raw = zip_bytes([(TARGET, WIRE), ("OTHER", b"")])
        raw = raw.replace(b"OTHER", b"OT\0ER")
        self.assert_rejected(raw, "NUL in ZIP path", container=None, expected_members=(TARGET, "OT"))

    def test_central_directory_count_mismatch_is_rejected(self):
        raw, _ = self.packaged()
        changed = bytearray(raw)
        end = changed.rfind(b"PK\x05\x06")
        struct.pack_into("<HH", changed, end + 8, 2, 2)
        self.assert_rejected(changed, "ZIP entry count disagrees")

    def test_plain_files_and_nonempty_directories_cannot_claim_directory_type(self):
        raw, _ = self.packaged([member(TARGET, WIRE), member("dir", b"payload", kind=tarfile.DIRTYPE)])
        self.assert_rejected(raw, "TAR member exceeds")
        info = zipfile.ZipInfo("not-directory")
        info.external_attr = (stat.S_IFDIR | 0o755) << 16
        self.assert_rejected(zip_bytes([(TARGET, WIRE), (info, b"")]), "Special ZIP member", container=None,
                             expected_members=(TARGET, "not-directory"))

    def test_duplicate_pax_keys_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unsupported or duplicate PAX field"):
            extractor.pax_fields(b"12 path=foo\n12 path=bar\n")

    def test_invalid_hash_syntax_is_rejected(self):
        raw, _ = self.packaged()
        self.assert_rejected(raw, "Invalid pinned digest", wire_sha256="not-a-digest")


if __name__ == "__main__":
    unittest.main()
