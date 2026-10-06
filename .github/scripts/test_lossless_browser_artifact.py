"""Offline security and losslessness checks; never acquire a real artifact."""
import copy
from dataclasses import replace
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile
import zlib


SPEC = importlib.util.spec_from_file_location("lossless_browser_artifact", Path(__file__).with_name("lossless-browser-artifact.py"))
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
M = MODULE
FILES = [("corrected/index.html", b"<html>exact original\x00\xff</html>\n"),
         ("corrected/static-data/one.json", b'{"original":"data"}\n'),
         ("baseline/skip.bin", b"never extract this"),
         ("projection/skip.json", b"do not transform or extract")]
SELECTED = dict(FILES[:2])


def make_tar(entries=FILES):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.GNU_FORMAT) as archive:
        for name, value in entries:
            if isinstance(name, tarfile.TarInfo):
                info = name
            else:
                info = tarfile.TarInfo(name)
                info.size = len(value)
            archive.addfile(info, io.BytesIO(value))
    return output.getvalue()


def make_zip(tar=None, *, name="candidate.tar", compression=zipfile.ZIP_DEFLATED,
             extra=False, force_zip64=False, descriptor=False, mode=None):
    class Unseekable(io.BytesIO):
        def seek(self, *args):
            raise io.UnsupportedOperation("stream")
    output = Unseekable() if descriptor else io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=compression) as archive:
        info = zipfile.ZipInfo(name)
        info.compress_type = compression
        if mode is not None:
            info.external_attr = mode << 16
        with archive.open(info, "w", force_zip64=force_zip64) as member:
            member.write(make_tar() if tar is None else tar)
        if extra:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                archive.writestr(name, b"duplicate")
    return output.getvalue()


def expected_for(data):
    return {**M.SOURCE, "size_in_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def bounds_for(entries=SELECTED):
    return M.Bounds(tar_bytes=1024 * 1024, members=100, file_bytes=1024 * 1024,
                    corrected_bytes=1024 * 1024, corrected_files=10,
                    expected_corrected_bytes=sum(map(len, entries.values())),
                    expected_corrected_files=len(entries))


def metadata(expected):
    s = expected
    artifact = {"id": s["artifact_id"], "name": s["artifact_name"], "expired": False,
                "digest": "sha256:" + s["sha256"], "size_in_bytes": s["size_in_bytes"],
                "workflow_run": {"id": s["run_id"], "head_sha": s["head_sha"],
                                 "head_branch": s["head_branch"], "repository_id": 321,
                                 "head_repository_id": 321}}
    run = {"id": s["run_id"], "run_attempt": s["run_attempt"], "path": s["workflow"],
           "name": s["workflow_name"], "head_sha": s["head_sha"], "head_branch": s["head_branch"],
           "event": "workflow_run", "status": "completed", "conclusion": "success", "workflow_id": 42,
           "repository": {"id": 321, "full_name": s["repository"]},
           "head_repository": {"id": 321, "full_name": s["repository"]}}
    job = {"id": s["job_id"], "run_id": s["run_id"], "run_attempt": s["run_attempt"],
           "head_sha": s["head_sha"], "name": s["job_name"], "status": "completed", "conclusion": "success",
           "steps": [{"name": name, "conclusion": "success"} for name in
                     ("Verify exact approval and immutable capture",
                      "Recheck financial proofs and seal exact exception candidate",
                      "Retain exact exception candidate and unchanged failed Design evidence")]}
    workflow = {"id": 42, "path": s["workflow"], "name": s["workflow_name"]}
    return artifact, run, job, workflow


class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name).resolve()
        self.root = self.parent / "intake"
        self.bounds = bounds_for()

    def prepare(self, data=None, *, expected=None, bounds=None, values=None, downloader=None):
        data = make_zip() if data is None else data
        expected = expected_for(data) if expected is None else expected
        values = metadata(expected) if values is None else values
        endpoints, reads = [], []
        def api(endpoint):
            endpoints.append(endpoint)
            return values[len(endpoints) - 1]
        def download(endpoint, limit, seconds):
            reads.append((endpoint, limit, seconds))
            return (data[index:index + 37] for index in range(0, len(data), 37))
        result = M.prepare(self.root, {"offline_test": True}, api=api, download=downloader or download,
                           expected=expected, bounds=bounds or self.bounds)
        self.assertEqual(endpoints, [M.PREFIX + f"artifacts/{expected['artifact_id']}",
                                   M.PREFIX + f"runs/{expected['run_id']}/attempts/{expected['run_attempt']}",
                                   M.PREFIX + f"jobs/{expected['job_id']}",
                                   M.PREFIX + "workflows/financial-performance-certification.yml"])
        if downloader is None:
            self.assertEqual(reads, [(M.PREFIX + f"artifacts/{expected['artifact_id']}/zip", len(data), 600)])
        return result

    def rejected(self, data, *, expected=None, bounds=None):
        with self.assertRaises((ValueError, tarfile.TarError, zipfile.BadZipFile, EOFError, zlib.error)):
            self.prepare(data, expected=expected, bounds=bounds)
        self.assertFalse(self.root.exists(), "Failed intake must remove only its newly created tree")

    def test_exact_original_bytes_and_corrected_only(self):
        data = make_zip()
        receipt = self.prepare(data)
        self.assertEqual((self.root / "original-artifact.zip").read_bytes(), data)
        extracted = {str(path.relative_to(self.root)): path.read_bytes()
                     for path in (self.root / "corrected").rglob("*") if path.is_file()}
        self.assertEqual(extracted, SELECTED)
        self.assertFalse((self.root / "baseline").exists())
        self.assertFalse((self.root / "projection").exists())
        self.assertFalse((self.root / "candidate.tar").exists())
        self.assertEqual(json.loads((self.root / "intake-receipt.json").read_bytes()), receipt)
        totals = receipt["extraction"]
        self.assertEqual((totals["corrected_files"], totals["corrected_bytes"]),
                         (len(SELECTED), sum(map(len, SELECTED.values()))))
        self.assertEqual(totals["tar_files"], len(FILES))
        inventory = [[name.removeprefix("corrected/"), len(value), hashlib.sha256(value).hexdigest()]
                     for name, value in sorted(SELECTED.items())]
        self.assertEqual(totals["corrected_inventory_sha256"],
                         hashlib.sha256(json.dumps(inventory, separators=(",", ":")).encode()).hexdigest())
        self.assertEqual(receipt["source"]["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(receipt["compiled_ui_sha"], M.COMPILED_UI_SHA)

    def test_sha_and_length_authenticate_before_zip_inspection(self):
        data = make_zip()
        for change in ({"sha256": "0" * 64}, {"size_in_bytes": len(data) + 1}, {"size_in_bytes": len(data) - 1}):
            with self.subTest(change=change), patch.object(M, "zip_member", side_effect=AssertionError("must not parse")):
                self.rejected(data, expected={**expected_for(data), **change})

    def test_metadata_is_verified_before_download(self):
        expected = expected_for(make_zip())
        fields = [(0, "id"), (0, "name"), (0, "digest"), (0, "size_in_bytes"), (0, "expired"),
                  (1, "id"), (1, "run_attempt"), (1, "path"), (1, "name"), (1, "head_sha"),
                  (1, "head_branch"), (1, "event"), (1, "status"), (1, "conclusion"),
                  (2, "id"), (2, "run_id"), (2, "run_attempt"), (2, "head_sha"), (2, "name"),
                  (2, "status"), (2, "conclusion"), (3, "id"), (3, "path"), (3, "name")]
        for index, key in fields:
            values = copy.deepcopy(metadata(expected))
            values[index][key] = None
            with self.subTest(index=index, key=key), self.assertRaises(ValueError):
                self.prepare(expected=expected, values=values, downloader=lambda *args: self.fail("download must not start"))
            self.assertFalse(self.root.exists())

    def test_metadata_repository_binding_and_steps(self):
        expected = expected_for(make_zip())
        changes = [(0, ("workflow_run", "id")), (0, ("workflow_run", "head_sha")),
                   (0, ("workflow_run", "head_branch")), (0, ("workflow_run", "repository_id")),
                   (0, ("workflow_run", "head_repository_id")), (1, ("repository", "id")),
                   (1, ("head_repository", "id")), (1, ("repository", "full_name")),
                   (1, ("head_repository", "full_name"))]
        for index, (key, nested) in changes:
            values = copy.deepcopy(metadata(expected))
            values[index][key][nested] = None
            with self.subTest(key=key, nested=nested), self.assertRaises(ValueError):
                M.verify_source(*values, expected=expected)
        for steps in ([], [{"name": "wrong", "conclusion": "success"}]):
            values = copy.deepcopy(metadata(expected))
            values[2]["steps"] = steps
            with self.assertRaises(ValueError):
                M.verify_source(*values, expected=expected)
        for index in range(3):
            values = copy.deepcopy(metadata(expected))
            values[2]["steps"][index]["conclusion"] = "failure"
            with self.assertRaises(ValueError):
                M.verify_source(*values, expected=expected)
        values = copy.deepcopy(metadata(expected))
        values[2]["steps"].append(values[2]["steps"][0])
        with self.assertRaises(ValueError):
            M.verify_source(*values, expected=expected)

    def test_source_evidence_excludes_urls_and_identity_data(self):
        values = list(metadata(expected_for(make_zip())))
        for value in values:
            value.update(url="https://example.invalid/?token=secret", actor={"email": "private"}, token="secret")
        receipt = self.prepare(values=values)
        text = json.dumps(receipt["source_metadata"])
        for value in ("secret", "private", "example.invalid"):
            self.assertNotIn(value, text)

    def test_stored_member(self):
        self.prepare(make_zip(compression=zipfile.ZIP_STORED))

    def test_zip64_local_header(self):
        self.prepare(make_zip(force_zip64=True))

    def test_zip_data_descriptor(self):
        self.prepare(make_zip(descriptor=True))

    def test_zip64_data_descriptor(self):
        self.prepare(make_zip(descriptor=True, force_zip64=True))

    def test_zip64_end_records(self):
        data = make_zip()
        end_offset = len(data) - 22
        end = list(struct.unpack("<4s4H2IH", data[-22:]))
        record = struct.pack("<4sQ2H2I4Q", b"PK\x06\x06", 44, 45, 45, 0, 0, 1, 1, end[5], end[6])
        locator = struct.pack("<4sIQI", b"PK\x06\x07", 0, end_offset, 1)
        end[3:7] = [65535, 65535, 0xffffffff, 0xffffffff]
        self.prepare(data[:-22] + record + locator + struct.pack("<4s4H2IH", *end))

    def test_extra_members_and_unsafe_zip_names(self):
        self.rejected(make_zip(extra=True))
        for name in ("../candidate.tar", "/candidate.tar", "candidate.tar/"):
            with self.subTest(name=name):
                self.rejected(make_zip(name=name))
        data = make_zip(name="candidate.tarX").replace(b"candidate.tarX", b"candidate.tar\x00")
        self.rejected(data)
        self.rejected(make_zip(mode=0o120777))

    def test_unsupported_or_encrypted_zip(self):
        self.rejected(make_zip(compression=zipfile.ZIP_BZIP2))
        data = bytearray(make_zip())
        central = data.index(b"PK\x01\x02")
        for offset in (6, central + 8):
            struct.pack_into("<H", data, offset, 1)
        self.rejected(bytes(data))

    def test_zip_crc_and_tail_are_verified(self):
        data = bytearray(make_zip())
        central = data.index(b"PK\x01\x02")
        struct.pack_into("<I", data, 14, 0)
        struct.pack_into("<I", data, central + 16, 0)
        self.rejected(bytes(data))
        self.rejected(make_zip() + b"garbage")

    def test_unreferenced_zip_bytes_and_bad_descriptor(self):
        data = make_zip()
        central = data.index(b"PK\x01\x02")
        damaged = bytearray(data[:central] + b"hidden local member" + data[central:])
        struct.pack_into("<I", damaged, len(damaged) - 6, central + len(b"hidden local member"))
        self.rejected(bytes(damaged))
        damaged = bytearray(make_zip(descriptor=True))
        descriptor = damaged.index(b"PK\x07\x08")
        damaged[descriptor + 4] ^= 1
        self.rejected(bytes(damaged))

    def test_truncated_and_trailing_deflate_streams(self):
        data = bytearray(make_zip())
        central = data.index(b"PK\x01\x02")
        compressed = struct.unpack_from("<I", data, 18)[0]
        # Preserve valid ZIP framing and re-pin the fixture so the inflater itself
        # must reject the deliberately shortened compressed stream.
        shortened = data[:central - 1] + data[central:]
        for offset in (18, central - 1 + 20):
            struct.pack_into("<I", shortened, offset, compressed - 1)
        struct.pack_into("<I", shortened, len(shortened) - 6, central - 1)
        self.rejected(bytes(shortened))
        extended = data[:central] + b"x" + data[central:]
        for offset in (18, central + 1 + 20):
            struct.pack_into("<I", extended, offset, compressed + 1)
        struct.pack_into("<I", extended, len(extended) - 6, central + 1)
        self.rejected(bytes(extended))

    def test_zip_expansion_cap_and_forged_expanded_size(self):
        self.rejected(make_zip(), bounds=replace(self.bounds, tar_bytes=1024))
        data = bytearray(make_zip())
        central = data.index(b"PK\x01\x02")
        struct.pack_into("<I", data, 22, 1024)
        struct.pack_into("<I", data, central + 24, 1024)
        self.rejected(bytes(data))

    def test_unbounded_or_missing_zip_directory(self):
        data = bytearray(make_zip())
        struct.pack_into("<I", data, len(data) - 10, 1000000)
        self.rejected(bytes(data))
        self.rejected(make_zip()[:-22])

    def test_unsafe_tar_paths_even_in_skipped_roots(self):
        for name in ("../escape", "/absolute", "other/../../escape", "corrected/../escape",
                     "corrected//escape", "corrected/./escape", "corrected\\escape", "corrected/a\nb",
                     "corrected/" + "a" * 256):
            with self.subTest(name=name):
                self.rejected(make_zip(make_tar(FILES + [(name, b"bad")])))

    def test_tar_links_and_special_types_even_in_skipped_roots(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE,
                     tarfile.FIFOTYPE, tarfile.GNUTYPE_SPARSE, tarfile.XHDTYPE, tarfile.XGLTYPE):
            info = tarfile.TarInfo("skipped/bad")
            info.type, info.linkname = kind, "../../escape"
            with self.subTest(kind=kind):
                self.rejected(make_zip(make_tar(FILES + [(info, b"")])))

    def test_duplicate_files_and_path_conflicts(self):
        for entries in (FILES + [FILES[0]], FILES + [FILES[-1]],
                        FILES + [("corrected/index.html/sub", b"bad")],
                        FILES + [("skipped/a/b", b"first"), ("skipped/a", b"bad")]):
            with self.subTest(entries=entries):
                self.rejected(make_zip(make_tar(entries)))
        info = tarfile.TarInfo("corrected")
        info.type = tarfile.DIRTYPE
        self.rejected(make_zip(make_tar([(info, b""), (info, b"")] + FILES)))

    def test_directories_after_implicit_parents_are_valid_once(self):
        info = tarfile.TarInfo("corrected")
        info.type = tarfile.DIRTYPE
        self.prepare(make_zip(make_tar(FILES + [(info, b"")])))

    def test_gnu_longnames_preserve_bytes(self):
        name = "corrected/" + "/".join(["long-component" * 4] * 3) + "/file.json"
        entries = FILES + [(name, b"long name bytes\x00\xff")]
        selected = {**SELECTED, name: entries[-1][1]}
        receipt = self.prepare(make_zip(make_tar(entries)), bounds=bounds_for(selected))
        self.assertEqual((self.root / name).read_bytes(), entries[-1][1])
        self.assertEqual(receipt["extraction"]["tar_members"], len(entries) + 1)

    def test_gnu_longname_bounds_and_unsafe_paths(self):
        for name in ("skipped/" + "x/" * 40 + "end", "skipped/" + "a/" * 5 + "../" + "x" * 110):
            with self.subTest(name=name):
                self.rejected(make_zip(make_tar(FILES + [(name, b"bad")])))
        info = tarfile.TarInfo("././@LongLink")
        info.type, info.size = tarfile.GNUTYPE_LONGNAME, self.bounds.path_bytes + 2
        self.rejected(make_zip(info.tobuf(format=tarfile.GNU_FORMAT) + bytes(1024)))

    def test_oversized_declared_tar_file_fails_before_read(self):
        info = tarfile.TarInfo("skipped/giant")
        info.size = self.bounds.file_bytes + 1
        self.rejected(make_zip(info.tobuf(format=tarfile.GNU_FORMAT) + bytes(1024)))

    def test_nonempty_or_repeated_separator_directory(self):
        info = tarfile.TarInfo("corrected/bad")
        info.type, info.size = tarfile.DIRTYPE, 1
        self.rejected(make_zip(make_tar(FILES + [(info, b"x")])))
        raw = bytearray(tarfile.TarInfo("corrected//").tobuf(format=tarfile.GNU_FORMAT))
        raw[156:157] = tarfile.DIRTYPE
        raw[148:156] = b"        "
        raw[148:156] = bytes(f"{sum(raw):06o}\0 ", "ascii")
        self.rejected(make_zip(bytes(raw) + bytes(1024)))

    def test_tar_counts_and_sizes_are_bounded(self):
        for changes in ({"members": 1}, {"file_bytes": 1}, {"corrected_files": 1},
                        {"corrected_bytes": 1}, {"expected_corrected_bytes": 1},
                        {"expected_corrected_files": 1}, {"path_depth": 1}):
            with self.subTest(changes=changes):
                self.rejected(make_zip(), bounds=replace(self.bounds, **changes))

    def test_tar_truncation_checksum_and_nonzero_padding(self):
        tar = make_tar()
        self.rejected(make_zip(tar[:512] + tar[512:520]))
        self.rejected(make_zip(tar[:4096]))  # Removes required end records.
        damaged = bytearray(tar)
        damaged[10] ^= 1
        self.rejected(make_zip(bytes(damaged)))
        damaged = bytearray(tar)
        damaged[512 + len(FILES[0][1])] = 1
        self.rejected(make_zip(bytes(damaged)))
        self.rejected(make_zip(tar + b"hidden after end"))

    def test_failed_download_cleans_created_directory(self):
        def download(*args):
            yield b"partial"
            raise OSError("offline fixture failure")
        with self.assertRaises(OSError):
            self.prepare(downloader=download)
        self.assertFalse(self.root.exists())

    def test_existing_intake_and_original_files_are_untouched(self):
        self.root.mkdir()
        original = self.root / "original-artifact.zip"
        original.write_bytes(b"prior evidence")
        with self.assertRaises(FileExistsError):
            self.prepare()
        self.assertEqual(original.read_bytes(), b"prior evidence")

    def test_symlink_intake_and_parent_rejected(self):
        prior = self.parent / "prior"
        prior.mkdir()
        (prior / "important").write_bytes(b"untouched")
        self.root.symlink_to(prior, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual((prior / "important").read_bytes(), b"untouched")
        self.root.unlink()
        alias = self.parent / "alias"
        alias.symlink_to(prior, target_is_directory=True)
        self.root = alias / "intake"
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertFalse((prior / "intake").exists())

    def test_partial_extraction_cleanup_preserves_sibling(self):
        sibling = self.parent / "prior-artifact.zip"
        sibling.write_bytes(b"original retained artifact")
        self.rejected(make_zip(make_tar(FILES + [("../late-escape", b"bad")])))
        self.assertEqual(sibling.read_bytes(), b"original retained artifact")

    def test_exact_diagnostic_context(self):
        env = {"GITHUB_REPOSITORY": M.REPOSITORY, "GITHUB_REF": "refs/heads/" + M.BRANCH,
               "GITHUB_EVENT_NAME": "push", "GITHUB_SHA": "a" * 40, "GITHUB_RUN_ID": "123",
               "GITHUB_RUN_ATTEMPT": "1", "GITHUB_WORKFLOW_REF":
               f"{M.REPOSITORY}/{M.WORKFLOW}@refs/heads/{M.BRANCH}"}
        self.assertEqual(M.diagnostic_context(env)["head_branch"], M.BRANCH)
        for key in env:
            with self.subTest(key=key), self.assertRaises(ValueError):
                M.diagnostic_context({**env, key: "wrong"})


if __name__ == "__main__":
    unittest.main()
