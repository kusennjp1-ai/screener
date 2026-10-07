#!/usr/bin/env python3
"""Adversarial, offline contracts for bounded retained-price recovery."""
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('read-retained-price-archive.py'))
R = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R)
CHART = 'static-data/markets/us/charts/ABC.json'
MANIFEST = 'static-data/manifest.json'
RAW = b'{"symbol":"ABC","prices":[1,2,3]}\n'


def packed_fixture(payload=RAW, encoded=None, edit_entry=None, edit_logical=None, edit_root=None):
    if encoded is None:
        encoded = gzip.compress(payload, compresslevel=6, mtime=0)
    manifest = b'{"schema":1}\n'
    entries = []
    files = {}
    for path, kind, raw, compressed in [(MANIFEST, 'identity', manifest, manifest), (CHART, 'gzip', payload, encoded)]:
        item = {'path': path, 'kind': kind, 'assetPath': path if kind == 'identity' else R.PREFIX + 'gzip/' + R.digest(compressed) + '.bin', 'encodedBytes': len(compressed), 'encodedSha256': R.digest(compressed), 'decodedBytes': len(raw), 'decodedSha256': R.digest(raw)}
        files[item['assetPath']] = compressed
        if path == CHART and edit_entry:
            edit_entry(item)
        entries.append(item)
    logical = {e['path']: {'bytes': e['decodedBytes'], 'sha256': e['decodedSha256']} for e in sorted(entries, key=lambda e: e['path'])}
    physical = {e['assetPath']: {'bytes': e['encodedBytes'], 'sha256': e['encodedSha256']} for e in sorted(entries, key=lambda e: e['assetPath'])}
    if edit_logical:
        edit_logical(logical)

    def add(family, value, **extra):
        raw = R.canonical(value)
        sha = R.digest(raw)
        path = R.PREFIX + family + '-' + sha + '.json'
        files[path] = raw
        return {'path': path, 'bytes': len(raw), 'sha256': sha, **extra}

    logical_desc = add('logical', {'format': R.FORMAT, 'files': logical})
    physical_desc = add('physical', {'format': R.FORMAT, 'files': physical})
    shard_descriptors = []
    for i in range(256):
        shard_id = f'{i:02x}'
        shard_entries = sorted([e for e in entries if R.digest(e['path'].encode())[:2] == shard_id], key=lambda e: e['path'])
        shard_descriptors.append(add('shard', {'format': R.FORMAT, 'id': shard_id, 'files': shard_entries}, id=shard_id))
    bindings = {'manifestSha256': R.digest(manifest), 'uiInventorySha256': 'b' * 64, 'financialGeneration': None, 'financialLineageSha256': None, 'sourceCommit': 'a' * 40, 'appCommit': 'b' * 40, 'candidateId': 'c' * 64}
    body = {'format': R.FORMAT, 'bindings': bindings, 'logicalInventory': logical_desc, 'physicalInventory': physical_desc, 'shards': shard_descriptors}
    root = {'format': R.FORMAT, 'generation': R.digest(R.canonical(body)), 'bindings': bindings, 'logicalInventory': logical_desc, 'physicalInventory': physical_desc, 'shards': shard_descriptors}
    if edit_root:
        edit_root(root)
    root_desc = add('root', root, generation=root['generation'], bindings=bindings)
    publication = {'data_manifest_sha256': bindings['manifestSha256'], 'transport': {'schema_version': 'static-json-transport-publication-v1', 'root': root_desc, 'ui_sha': bindings['appCommit'], 'ui_digest': bindings['uiInventorySha256']}}
    files['publication.json'] = R.canonical(publication)
    return files


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.archive = self.base / 'artifact.zip'
        self.output = self.base / 'selected'

    def tearDown(self):
        self.temp.cleanup()

    def make_archive(self, files, extra=(), zip_extra=(), zip_type=None):
        tar_bytes = io.BytesIO()
        with tarfile.open(fileobj=tar_bytes, mode='w', format=tarfile.GNU_FORMAT) as archive:
            root = tarfile.TarInfo('.')
            root.type = tarfile.DIRTYPE
            archive.addfile(root)
            for name, value in files.items():
                item = tarfile.TarInfo('./' + name)
                item.size = len(value)
                archive.addfile(item, io.BytesIO(value))
            for item, value in extra:
                archive.addfile(item, io.BytesIO(value))
        with zipfile.ZipFile(self.archive, 'w', zipfile.ZIP_DEFLATED) as archive:
            if zip_type is None:
                archive.writestr('artifact.tar', tar_bytes.getvalue())
            else:
                item = zipfile.ZipInfo('artifact.tar')
                item.create_system = 3
                item.external_attr = zip_type << 16
                archive.writestr(item, tar_bytes.getvalue())
            for name, value in zip_extra:
                archive.writestr(name, value)
        return R.digest(self.archive.read_bytes())

    def recover(self, files=None, paths=None, **options):
        sha = self.make_archive(files if files is not None else packed_fixture(), **options)
        return R.recover(self.archive, sha, paths or [CHART], self.output)

    def refuse(self, message, callback):
        with self.assertRaisesRegex(R.RecoveryError, message):
            callback()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.base.glob('.retained-price-*')), [])

    def test_packed_success_and_receipt(self):
        result = self.recover(paths=['publication.json', MANIFEST, CHART])
        self.assertEqual((self.output / CHART).read_bytes(), RAW)
        self.assertEqual(result['files'][CHART]['decodedSha256'], R.digest(RAW))
        self.assertFalse(result['fullSiteVerified'])
        self.assertEqual(result['mode'], 'packed-static-json')
        self.assertEqual(len(result['verifiedMetadata']), 5)  # root, inventories, two selected shards
        self.assertEqual(len(list(self.output.rglob('*.json'))), 4)
        self.assertEqual(R.parse_json((self.output / 'scoped-extraction-manifest.json').read_bytes()), result)

    def test_plain_success_does_not_materialize_unselected(self):
        result = self.recover({CHART: RAW, 'static-data/unselected.json': b'not JSON'}, [CHART])
        self.assertEqual(result['mode'], 'plain-static-json')
        self.assertFalse((self.output / 'static-data/unselected.json').exists())
        self.assertEqual(result['files'][CHART]['encodedSha256'], R.digest(RAW))

    def test_pin_verified_before_zip_open(self):
        self.archive.write_bytes(b'not a zip')
        self.refuse('Archive SHA256 mismatch', lambda: R.recover(self.archive, '0' * 64, [CHART], self.output))

    def test_plain_missing(self):
        self.refuse('Selected logical file missing', lambda: self.recover({MANIFEST: b'{}\n'}))

    def test_packed_missing(self):
        self.refuse('Selected logical file missing', lambda: self.recover(paths=['static-data/research-details/ABSENT.json']))

    def test_missing_encoded_payload(self):
        files = packed_fixture()
        del files[next(p for p in files if p.endswith('.bin'))]
        self.refuse('Selected asset missing', lambda: self.recover(files))

    def test_traversal_even_when_not_selected(self):
        for name in ('../escape.json', '/absolute.json', 'a/../b.json', 'a//b.json', 'a\\b.json'):
            with self.subTest(name=name):
                item = tarfile.TarInfo(name)
                self.refuse('Unsafe TAR path', lambda: self.recover({CHART: RAW}, extra=[(item, b'')]))

    def test_duplicate_normalized_member(self):
        item = tarfile.TarInfo(CHART)
        item.size = len(RAW)
        self.refuse('Duplicate TAR path', lambda: self.recover({CHART: RAW}, extra=[(item, RAW)]))

    def test_link_device_pax_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.XHDTYPE):
            with self.subTest(kind=kind):
                item = tarfile.TarInfo('unselected')
                item.type = kind
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    item.linkname = CHART
                self.refuse('Unsupported TAR member type or link', lambda: self.recover({CHART: RAW}, extra=[(item, b'')]))

    def test_long_path_gnu_extension(self):
        path = 'static-data/' + 'x' * 110 + '.json'
        result = self.recover({path: b'{}\n'}, [path])
        self.assertIn(path, result['files'])

    def test_file_directory_conflict(self):
        self.refuse('file/directory path conflict', lambda: self.recover({CHART: RAW, 'static-data': b'{}'}))

    def test_zip_unexpected_members(self):
        self.refuse('ZIP must contain only', lambda: self.recover({CHART: RAW}, zip_extra=[('../extra', b'')]))

    def test_zip_symbolic_link(self):
        self.refuse('Unsupported ZIP member type', lambda: self.recover({CHART: RAW}, zip_type=0o120777))

    def test_metadata_digest_mismatch(self):
        files = packed_fixture()
        root = next(path for path in files if '/root-' in path)
        files[root] = files[root].replace(b'"format"', b'"Format"')
        self.refuse('metadata integrity mismatch', lambda: self.recover(files))

    def test_encoded_digest_mismatch(self):
        files = packed_fixture()
        path = next(p for p in files if p.endswith('.bin'))
        raw = bytearray(files[path])
        raw[12] ^= 1
        files[path] = bytes(raw)
        self.refuse('Encoded integrity mismatch', lambda: self.recover(files))

    def test_decoded_digest_mismatch(self):
        files = packed_fixture(edit_entry=lambda entry: entry.update(decodedSha256='0' * 64))
        self.refuse('Decoded integrity mismatch', lambda: self.recover(files))

    def test_inventory_disagreement(self):
        files = packed_fixture(edit_logical=lambda logical: logical[CHART].update(sha256='0' * 64))
        self.refuse('Logical inventory disagrees', lambda: self.recover(files))

    def test_generation_mismatch(self):
        files = packed_fixture(edit_root=lambda root: root.update(generation='0' * 64))
        self.refuse('generation digest mismatch', lambda: self.recover(files))

    def test_invalid_gzip_framing(self):
        encoded = bytearray(gzip.compress(RAW, compresslevel=6, mtime=0))
        encoded[4] = 1
        self.refuse('Noncanonical gzip framing', lambda: self.recover(packed_fixture(encoded=bytes(encoded))))

    def test_gzip_crc(self):
        encoded = bytearray(gzip.compress(RAW, compresslevel=6, mtime=0))
        encoded[-8] ^= 1
        self.refuse('Gzip CRC32', lambda: self.recover(packed_fixture(encoded=bytes(encoded))))

    def test_gzip_concatenated_members(self):
        encoded = gzip.compress(RAW, compresslevel=6, mtime=0) + gzip.compress(b'{}', compresslevel=6, mtime=0)
        self.refuse('multiple gzip members', lambda: self.recover(packed_fixture(encoded=encoded)))

    def test_gzip_trailing_bytes(self):
        encoded = gzip.compress(RAW, compresslevel=6, mtime=0)
        encoded = encoded[:-8] + b'junk' + encoded[-8:]
        self.refuse('multiple gzip members', lambda: self.recover(packed_fixture(encoded=encoded)))

    def test_gzip_bomb_rejected_at_claimed_size(self):
        encoded = gzip.compress(b' ' * (1024 * 1024), compresslevel=6, mtime=0)
        self.refuse('Decoded byte cap exceeded', lambda: self.recover(packed_fixture(encoded=encoded)))

    def test_request_limits(self):
        for paths in ([], [CHART] * 2, ['../escape.json'], [CHART] * 129, [R.PREFIX + 'root.json']):
            with self.subTest(paths=paths[:2]):
                with self.assertRaises(R.RecoveryError):
                    R.requested_paths(paths)

    def test_member_size_cap_before_materialization(self):
        sha = self.make_archive({CHART: RAW})
        with patch.object(R, 'MAX_MEMBER', len(RAW) - 1):
            self.refuse('member size cap exceeded', lambda: R.recover(self.archive, sha, [CHART], self.output))

    def test_metadata_size_cap_before_read(self):
        files = packed_fixture()
        root_path = next(path for path in files if '/root-' in path)
        files[root_path] = b' ' * (R.ROOT_CAP + 1)
        self.refuse('metadata byte cap exceeded', lambda: self.recover(files))

    def test_receipt_included_in_output_cap(self):
        sha = self.make_archive({CHART: RAW})
        self.refuse('Output plus receipt exceeds', lambda: R.recover(self.archive, sha, [CHART], self.output, len(RAW)))

    def test_output_cap_preflight(self):
        sha = self.make_archive({CHART: RAW})
        self.refuse('output byte cap exceeded', lambda: R.recover(self.archive, sha, [CHART], self.output, 1))

    def test_output_existing_and_symlink(self):
        sha = self.make_archive({CHART: RAW})
        self.output.mkdir()
        with self.assertRaisesRegex(R.RecoveryError, 'new directory'):
            R.recover(self.archive, sha, [CHART], self.output)
        self.output.rmdir()
        alias = self.base / 'alias'
        alias.symlink_to(self.base, target_is_directory=True)
        with self.assertRaisesRegex(R.RecoveryError, 'symlinks'):
            R.recover(self.archive, sha, [CHART], alias / 'selected')

    def test_duplicate_json_key(self):
        self.refuse('Duplicate JSON key', lambda: self.recover({CHART: b'{"x":1,"x":2}'}))

    def test_transport_assets_without_publication(self):
        self.refuse('without a supported publication', lambda: self.recover({CHART: RAW, R.PREFIX + 'gzip/' + 'a'*64 + '.bin': b'x'}))


if __name__ == '__main__':
    unittest.main()
