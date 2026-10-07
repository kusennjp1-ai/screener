#!/usr/bin/env python3
"""Tiny offline adversarial fixtures; never expand the retained real candidate."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SPEC = importlib.util.spec_from_file_location(
    'candidate_restoration', Path(__file__).with_name('restore-retained-price-candidate.py'))
R = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R)

FILES = {
    'publication.json': b'{"schema_version":"test-publication"}\n',
    'static-data/manifest.json': b'{"schema_version":"test-manifest"}\n',
    'static-data/markets/us/charts/ABC.json': b'{"prices":[1,2,3]}\n',
    'index.html': b'<html>Exact original bytes\n</html>',
    'assets/app.js': b'const x = 1;\n',
    'assets/icon.bin': bytes(range(256)),
    '.nojekyll': b'',
}


class RestorationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.archive = self.base / 'candidate.zip'
        self.output = self.base / 'restored'

    def tearDown(self):
        self.temp.cleanup()

    def make_archive(self, files=None, extra=(), zip_extra=(), zip_type=None,
                     edit_tar=None, compression=zipfile.ZIP_DEFLATED):
        files = FILES if files is None else files
        tar_bytes = io.BytesIO()
        with tarfile.open(fileobj=tar_bytes, mode='w', format=tarfile.GNU_FORMAT) as archive:
            root = tarfile.TarInfo('.')
            root.type = tarfile.DIRTYPE
            archive.addfile(root)
            for name, content in files.items():
                item = tarfile.TarInfo('./' + name)
                item.mode = 0o4777  # Archive modes must never be applied.
                item.size = len(content)
                archive.addfile(item, io.BytesIO(content))
            for item, content in extra:
                archive.addfile(item, io.BytesIO(content))
        data = tar_bytes.getvalue()
        if edit_tar:
            data = edit_tar(data)
        with zipfile.ZipFile(self.archive, 'w', compression) as archive:
            if zip_type is None:
                archive.writestr('artifact.tar', data)
            else:
                item = zipfile.ZipInfo('artifact.tar')
                item.create_system = 3
                item.external_attr = zip_type << 16
                archive.writestr(item, data)
            for name, content in zip_extra:
                archive.writestr(name, content)
        return self.pin()

    def pin(self):
        data = self.archive.read_bytes()
        return hashlib.sha256(data).hexdigest(), len(data)

    def restore(self, pin=None, output=None, reserve=1024 * 1024):
        sha, size = pin or self.pin()
        return R._restore(self.archive, sha, size, output or self.output,
                          _reserve_bytes=reserve)

    def refuse(self, message, action, error=R.RecoveryError):
        with self.assertRaisesRegex(error, message):
            action()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.base.glob(R.STAGING_PREFIX + '*')), [])

    def test_normal_candidate_exact_bytes_and_non_authoritative_receipt(self):
        pin = self.make_archive()
        original_zip = self.archive.read_bytes()
        result = self.restore(pin)
        for name, content in FILES.items():
            self.assertEqual((self.output / name).read_bytes(), content)
            self.assertEqual(result['files'][name], {'bytes': len(content),
                                                   'sha256': hashlib.sha256(content).hexdigest()})
            self.assertEqual(stat.S_IMODE((self.output / name).stat().st_mode), 0o600)
        self.assertEqual(result['restoredFiles'], len(FILES))
        self.assertEqual(result['restoredBytes'], sum(map(len, FILES.values())))
        for flag in ('publication_authority', 'ready_to_publish', 'fullSiteVerified',
                     'financial_success_claim', 'quality_success_claim'):
            self.assertIs(result[flag], False)
        self.assertEqual(result['mode'], 'normal-candidate')
        self.assertEqual(R.R.parse_json((self.output / R.RECEIPT_NAME).read_bytes()), result)
        self.assertEqual(self.archive.read_bytes(), original_zip)
        self.assertEqual(list(self.base.glob(R.STAGING_PREFIX + '*')), [])
        self.assertFalse((self.base / 'artifact.tar').exists())
        self.assertEqual({p.relative_to(self.output).as_posix() for p in self.output.rglob('*')
                          if p.is_file()}, {*FILES, R.RECEIPT_NAME})

    def test_streams_payloads_larger_than_one_chunk_and_gnu_long_names(self):
        name = 'static-data/' + 'x' * 110 + '.json'
        files = {**FILES, name: b'x' * (R.R.MIB + 17)}
        self.make_archive(files)
        result = self.restore()
        self.assertEqual((self.output / name).read_bytes(), files[name])
        self.assertEqual(result['files'][name]['sha256'], R.R.digest(files[name]))
        self.assertGreater(result['archiveStructure']['payloadBytes'], result['restoredBytes'])

    def test_public_api_reserves_eight_gib_without_override(self):
        pin = self.make_archive()
        with patch.object(R, '_disk_free_bytes', return_value=R.DEFAULT_RESERVE_BYTES - 1), \
             patch.object(R, '_new_staging') as staging, \
             patch.object(R, '_exclusive_file') as write:
            self.refuse('Insufficient disk space', lambda: R.restore(self.archive, *pin, self.output))
            staging.assert_not_called()
            write.assert_not_called()
        self.assertGreaterEqual(R.DEFAULT_RESERVE_BYTES, 8 * 1024 ** 3)
        with self.assertRaises(TypeError):
            R.restore(self.archive, *pin, self.output, _reserve_bytes=0)

    def test_disk_preflight_boundary_before_any_write(self):
        self.make_archive()
        required = sum(map(len, FILES.values())) + 1024 * 1024
        with patch.object(R, '_disk_free_bytes', return_value=required - 1), \
             patch.object(R, '_new_staging') as staging:
            self.refuse('Insufficient disk space', self.restore)
            staging.assert_not_called()
        with patch.object(R, '_disk_free_bytes', return_value=required):
            result = self.restore()
        self.assertEqual(result['diskPreflight']['requiredBytes'], required)

    def test_public_api_success_uses_default_reserve(self):
        pin = self.make_archive()
        with patch.object(R, '_disk_free_bytes', return_value=R.DEFAULT_RESERVE_BYTES + 10 * R.R.MIB):
            result = R.restore(self.archive, *pin, self.output)
        self.assertEqual(result['diskPreflight']['reserveBytes'], R.DEFAULT_RESERVE_BYTES)
        self.assertEqual(result['restoredFiles'], len(FILES))

    def test_pin_verified_before_opening_zip_or_writing(self):
        self.archive.write_bytes(b'not a zip')
        with patch.object(R.zipfile, 'ZipFile') as open_zip, \
             patch.object(R, '_new_staging') as staging:
            self.refuse('Archive SHA256 mismatch', lambda: self.restore(('0' * 64, 9)))
            open_zip.assert_not_called()
            staging.assert_not_called()

    def test_byte_pin_and_invalid_pins(self):
        sha, size = self.make_archive()
        for bad in (size - 1, size + 1):
            self.refuse('Archive byte size mismatch', lambda: self.restore((sha, bad)))
        for bad in (0, True, R.R.MAX_ZIP + 1):
            self.refuse('Expected archive byte size is invalid', lambda: self.restore((sha, bad)))
        self.refuse('Expected archive SHA256', lambda: self.restore(('A' * 64, size)))

    def test_full_tar_validated_before_disk_preflight(self):
        self.make_archive(edit_tar=lambda data: data + b'late trailing junk')
        with patch.object(R, '_disk_free_bytes') as disk, patch.object(R, '_new_staging') as staging:
            self.refuse('Nonzero data after TAR end markers', self.restore)
            disk.assert_not_called()
            staging.assert_not_called()

    def test_unsafe_paths(self):
        for name in ('../escape', '/absolute', 'a/../b', 'a//b', 'a\\b'):
            with self.subTest(name=name):
                item = tarfile.TarInfo(name)
                self.make_archive(extra=[(item, b'')])
                self.refuse('Unsafe TAR path', self.restore)

    def test_duplicate_and_file_directory_conflict(self):
        item = tarfile.TarInfo('index.html')
        self.make_archive(extra=[(item, b'')])
        self.refuse('Duplicate TAR path', self.restore)
        self.make_archive({**FILES, 'assets': b'bad'})
        self.refuse('file/directory path conflict', self.restore)

    def test_links_devices_and_pax_fail_before_writes(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE,
                     tarfile.FIFOTYPE, tarfile.XHDTYPE):
            with self.subTest(kind=kind):
                item = tarfile.TarInfo('evil')
                item.type = kind
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    item.linkname = 'index.html'
                self.make_archive(extra=[(item, b'')])
                with patch.object(R, '_new_staging') as staging:
                    self.refuse('Unsupported TAR member type or link', self.restore)
                    staging.assert_not_called()

    def test_tar_member_cap(self):
        self.make_archive()
        with patch.object(R.R, 'MAX_MEMBER', 100):
            self.refuse('TAR member size cap exceeded', self.restore)

    def test_zip_members_and_types(self):
        self.make_archive(zip_extra=[('other.txt', b'')])
        self.refuse('ZIP must contain only artifact.tar', self.restore)
        self.make_archive(zip_type=stat.S_IFLNK | 0o777)
        self.refuse('Unsupported ZIP member type', self.restore)

    def test_packed_candidate_and_reserved_receipt_rejected(self):
        variants = (
            ({**FILES, 'publication.json': b'{"transport":{}}'}, 'Only normal candidates'),
            ({**FILES, 'static-data/_transport/root.json': b'{}'}, 'Only normal candidates'),
            ({**FILES, R.RECEIPT_NAME: b'{}'}, 'reserved restoration receipt'),
            ({**FILES, R.RECEIPT_NAME + '/child': b'{}'}, 'reserved restoration receipt'),
        )
        for files, message in variants:
            with self.subTest(message=message, files=list(files)[-1]):
                self.make_archive(files)
                self.refuse(message, self.restore)

    def test_normal_candidate_minimum_structure_and_publication_json(self):
        for missing in ('publication.json', 'static-data/manifest.json'):
            with self.subTest(missing=missing):
                self.make_archive({name: data for name, data in FILES.items() if name != missing})
                self.refuse('is missing', self.restore)
        self.make_archive({**FILES, 'publication.json': b'{"x":1,"x":2}'})
        self.refuse('Duplicate JSON key', self.restore)
        self.make_archive({**FILES, 'publication.json': b'[]'})
        self.refuse('Only normal candidates', self.restore)

    def test_existing_output_and_symlink_parents(self):
        self.make_archive()
        self.output.mkdir()
        marker = self.output / 'keep'
        marker.write_bytes(b'keep')
        with self.assertRaisesRegex(R.RecoveryError, 'new directory'):
            self.restore()
        self.assertEqual(marker.read_bytes(), b'keep')
        alias = self.base / 'alias'
        alias.symlink_to(self.base, target_is_directory=True)
        with self.assertRaisesRegex(R.RecoveryError, 'symlinks'):
            self.restore(output=alias / 'new')
        marker.unlink()
        self.output.rmdir()
        self.output.symlink_to(self.base / 'absent')
        with self.assertRaisesRegex(R.RecoveryError, 'new directory'):
            self.restore()
        self.assertTrue(self.output.is_symlink())

    def test_source_symlinks_and_overlap_rejected(self):
        pin = self.make_archive()
        alias = self.base / 'source-alias.zip'
        alias.symlink_to(self.archive)
        self.refuse('symlinks', lambda: R._restore(alias, *pin, self.output, _reserve_bytes=0))
        with self.assertRaisesRegex(R.RecoveryError, 'new directory'):
            self.restore(output=self.archive)
        self.assertEqual(self.pin(), pin)

    def test_source_mutation_before_disk_preflight_has_no_output(self):
        self.make_archive()
        original = R.R.scan_tar

        def mutate_after_scan(*args, **kwargs):
            result = original(*args, **kwargs)
            os.utime(self.archive, ns=(self.archive.stat().st_atime_ns,
                                      self.archive.stat().st_mtime_ns + 1_000_000))
            return result

        with patch.object(R.R, 'scan_tar', side_effect=mutate_after_scan), \
             patch.object(R, '_new_staging') as staging:
            self.refuse('Archive changed', self.restore)
            staging.assert_not_called()

    def test_source_path_replacement_during_restore_cleans_partial_output(self):
        self.make_archive()
        original = R._copy_files
        preserved = self.base / 'preserved-original.zip'

        def replace_after_copy(*args, **kwargs):
            result = original(*args, **kwargs)
            data = self.archive.read_bytes()
            self.archive.rename(preserved)
            self.archive.write_bytes(data)
            return result

        with patch.object(R, '_copy_files', side_effect=replace_after_copy):
            self.refuse('Archive (path )?changed', self.restore)
        self.assertEqual(self.archive.read_bytes(), preserved.read_bytes())

    def test_input_mutation_after_copy_cleans_partial_output(self):
        self.make_archive()
        original = R._copy_files

        def mutate_after_copy(*args, **kwargs):
            result = original(*args, **kwargs)
            with self.archive.open('ab') as stream:
                stream.write(b'x')
            return result

        with patch.object(R, '_copy_files', side_effect=mutate_after_copy):
            self.refuse('Archive changed', self.restore)
        self.assertTrue(self.archive.exists())

    def test_second_tar_pass_digest_mismatch_cleans_partial_output(self):
        self.make_archive(compression=zipfile.ZIP_STORED)
        original = R._copy_files

        def wrong_verified_hash(archive, plan, root_fd, size, expected_hash):
            return original(archive, plan, root_fd, size, '0' * 64)

        with patch.object(R, '_copy_files', side_effect=wrong_verified_hash):
            self.refuse('TAR bytes changed', self.restore)

    def test_partial_io_failure_cleans_staging_and_preserves_zip(self):
        pin = self.make_archive()
        original = R._exclusive_file
        calls = 0

        def fail_after_one_file(*args):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('fixture disk failure')
            return original(*args)

        with patch.object(R, '_exclusive_file', side_effect=fail_after_one_file):
            self.refuse('fixture disk failure', self.restore, OSError)
        self.assertEqual(self.pin(), pin)

    def test_final_zip_digest_verified_again_before_commit(self):
        self.make_archive()
        original = R._verify_zip_hash
        calls = 0

        def fail_final_hash(*args):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise R.RecoveryError('fixture final ZIP digest mismatch')
            return original(*args)

        with patch.object(R, '_verify_zip_hash', side_effect=fail_final_hash):
            self.refuse('final ZIP digest mismatch', self.restore)
        self.assertEqual(calls, 2)

    def test_exclusive_writes_refuse_a_staging_symlink(self):
        self.make_archive()
        outside = self.base / 'outside'
        outside.mkdir()
        original = R._copy_files

        def plant_symlink(archive, plan, root_fd, tar_bytes, expected_hash):
            os.symlink(outside, 'static-data', dir_fd=root_fd)
            return original(archive, plan, root_fd, tar_bytes, expected_hash)

        with patch.object(R, '_copy_files', side_effect=plant_symlink):
            self.refuse('', self.restore, OSError)
        self.assertEqual(list(outside.iterdir()), [])

    def test_atomic_commit_never_overwrites_even_an_empty_destination(self):
        self.make_archive()
        original = R._commit

        def race_at_commit(*args):
            self.output.mkdir()
            original(*args)

        with patch.object(R, '_commit', side_effect=race_at_commit):
            with self.assertRaisesRegex(R.RecoveryError, 'refusing overwrite'):
                self.restore()
        self.assertTrue(self.output.is_dir())
        self.assertEqual(list(self.output.iterdir()), [])
        self.assertEqual(list(self.base.glob(R.STAGING_PREFIX + '*')), [])

    def test_cli_requires_byte_pin_and_has_no_reserve_bypass(self):
        script = Path(__file__).with_name('restore-retained-price-candidate.py')
        result = subprocess.run([sys.executable, '-B', str(script), '--help'],
                                check=True, capture_output=True, text=True)
        self.assertIn('--bytes BYTES', result.stdout)
        self.assertNotIn('--reserve', result.stdout)
        sha, size = self.make_archive()
        result = subprocess.run([sys.executable, '-B', str(script), '--archive', str(self.archive),
                                 '--sha256', sha, '--bytes', str(size), '--output', str(self.output),
                                 '--reserve-bytes', '0'],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unrecognized arguments: --reserve-bytes', result.stderr)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
