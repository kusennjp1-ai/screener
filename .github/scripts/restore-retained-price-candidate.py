#!/usr/bin/env python3
"""Restore every original regular file from a pinned normal candidate Pages ZIP.

This is an artifact-only, non-authoritative restoration helper for Linux CI. It
does not certify publication, financial lineage, prices, or candidate quality.
The complete ZIP hash and TAR structure are checked before any output is written.
The TAR is streamed twice, never expanded to an intermediate TAR on disk. Only
Python's standard library is used; no network or provider access is performed.
"""
import argparse
import ctypes
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import stat
import sys
import zipfile


SPEC = importlib.util.spec_from_file_location(
    'retained_price_archive_validation',
    Path(__file__).with_name('read-retained-price-archive.py'))
R = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R)
RecoveryError = R.RecoveryError
require = R.require

DEFAULT_RESERVE_BYTES = 8 * 1024 ** 3
RECEIPT_NAME = 'retained-price-restoration-receipt.json'
RECEIPT_CAP = 64 * R.MIB
STAGING_PREFIX = '.retained-price-restore-'


class _HashingReader:
    """Record the exact offsets validated by the unchanged TAR scanner."""

    def __init__(self, stream):
        self.stream = stream
        self.position = 0
        self.sha256 = hashlib.sha256()

    def read(self, size):
        require(0 <= size <= max(R.MIB, R.MAX_MEMBER), 'Unbounded TAR read refused')
        data = self.stream.read(size)
        self.position += len(data)
        require(self.position <= R.MAX_TAR, 'TAR byte cap exceeded')
        self.sha256.update(data)
        return data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.stream.close()


class _MeasuredArchive:
    def __init__(self, archive):
        self.archive = archive
        self.reader = None

    def open(self, name):
        require(self.reader is None and name == 'artifact.tar', 'Unexpected TAR stream')
        self.reader = _HashingReader(self.archive.open(name))
        return self.reader


def _stat_snapshot(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _source_stable(source, archive_path, before):
    require(R.snapshot(source) == before, 'Archive changed during restoration')
    current = os.stat(archive_path, follow_symlinks=False)
    require(stat.S_ISREG(current.st_mode) and _stat_snapshot(current) == before,
            'Archive path changed during restoration')
    require(archive_path.resolve(strict=True) == archive_path,
            'Archive path must not contain symlinks')


def _verify_zip_hash(source, expected_bytes, expected_sha256):
    source.seek(0)
    hasher = hashlib.sha256()
    count = 0
    for chunk in iter(lambda: source.read(R.MIB), b''):
        count += len(chunk)
        require(count <= expected_bytes, 'Archive byte size mismatch')
        hasher.update(chunk)
    require(count == expected_bytes, 'Archive byte size mismatch')
    require(hasher.hexdigest() == expected_sha256, 'Archive SHA256 mismatch')
    source.seek(0)


def _disk_free_bytes(parent_fd):
    usage = os.fstatvfs(parent_fd)
    return usage.f_bavail * usage.f_frsize


def _parent_stable(parent, parent_fd):
    require(parent.resolve(strict=True) == parent, 'Output parent must not contain symlinks')
    current, opened = os.stat(parent, follow_symlinks=False), os.fstat(parent_fd)
    require(stat.S_ISDIR(current.st_mode) and
            (current.st_dev, current.st_ino) == (opened.st_dev, opened.st_ino),
            'Output parent changed during restoration')


def _rename_function():
    # A normal os.rename can replace an empty directory that appears after the
    # final existence check. Linux renameat2 provides the needed no-replace
    # atomic commit. Fail closed on platforms without it, with no output writes.
    require(sys.platform == 'linux', 'Atomic no-replace restoration requires Linux')
    function = getattr(ctypes.CDLL(None, use_errno=True), 'renameat2', None)
    require(function is not None, 'Atomic no-replace rename is unavailable')
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                         ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    return function


def _commit(staging_name, output_name, parent_fd, rename):
    if rename(parent_fd, os.fsencode(staging_name), parent_fd,
              os.fsencode(output_name), 1) != 0:  # RENAME_NOREPLACE
        code = ctypes.get_errno()
        if code in (errno.EEXIST, errno.ENOTEMPTY):
            raise RecoveryError('Output appeared during restoration; refusing overwrite')
        raise OSError(code, os.strerror(code))


def _exclusive_file(root_fd, path):
    """Create only private regular files through no-follow directory handles."""
    require(R.valid_path(path), 'Unsafe restoration path')
    current_fd = os.dup(root_fd)
    try:
        parts = path.split('/')
        for part in parts[:-1]:
            try:
                os.mkdir(part, mode=0o700, dir_fd=current_fd)
            except FileExistsError:
                pass
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                              dir_fd=current_fd)
            os.close(current_fd)
            current_fd = next_fd
        fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=current_fd)
        return os.fdopen(fd, 'wb')
    finally:
        os.close(current_fd)


def _new_staging(parent_fd):
    for _ in range(10):
        name = STAGING_PREFIX + secrets.token_hex(12)
        try:
            os.mkdir(name, mode=0o700, dir_fd=parent_fd)
            return name
        except FileExistsError:
            continue
    raise RecoveryError('Unable to create exclusive private staging directory')


def _copy_files(archive, plan, staging_fd, tar_bytes, expected_tar_sha256):
    files = {}
    with _HashingReader(archive.open('artifact.tar')) as reader:
        for name, size, offset in plan:
            require(reader.position <= offset and offset + size <= tar_bytes,
                    'Invalid verified TAR offset')
            while reader.position < offset:
                R.read_exact(reader, min(offset - reader.position, R.MIB))
            file_hash = hashlib.sha256()
            remaining = size
            with _exclusive_file(staging_fd, name) as sink:
                while remaining:
                    chunk = R.read_exact(reader, min(remaining, R.MIB))
                    require(sink.write(chunk) == len(chunk), 'Incomplete restored file write')
                    file_hash.update(chunk)
                    remaining -= len(chunk)
            files[name] = {'bytes': size, 'sha256': file_hash.hexdigest()}
        while reader.position < tar_bytes:
            R.read_exact(reader, min(tar_bytes - reader.position, R.MIB))
        require(reader.read(1) == b'', 'TAR byte size mismatch')
        require(reader.position == tar_bytes and reader.sha256.hexdigest() == expected_tar_sha256,
                'TAR bytes changed between validation and restoration')
    return files


def _restore(archive_path, expected_sha256, expected_bytes, output, *,
             _reserve_bytes=DEFAULT_RESERVE_BYTES):
    """Private fixture seam; the public API and CLI cannot lower the reserve."""
    require(R.valid_hash(expected_sha256), 'Expected archive SHA256 must be lowercase hex')
    require(R.integer(expected_bytes, R.MAX_ZIP, 1), 'Expected archive byte size is invalid')
    require(type(_reserve_bytes) is int and _reserve_bytes >= 0, 'Invalid disk reserve')
    output = R.ensure_real_parent(output)
    archive_path = Path(os.path.abspath(archive_path))
    require(archive_path.resolve(strict=True) == archive_path,
            'Archive path must not contain symlinks')
    require(archive_path != output and output not in archive_path.parents,
            'Archive and output paths must not overlap')
    rename = _rename_function()
    parent_fd = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    staging_name = None
    staging_fd = None
    try:
        _parent_stable(output.parent, parent_fd)
        source_fd = os.open(archive_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(source_fd, 'rb') as source:
            before = R.snapshot(source)
            require(stat.S_ISREG(os.fstat(source.fileno()).st_mode), 'Archive must be a regular file')
            require(before[2] == expected_bytes, 'Archive byte size mismatch')
            _verify_zip_hash(source, expected_bytes, expected_sha256)
            _source_stable(source, archive_path, before)
            with zipfile.ZipFile(source) as archive:
                infos = archive.infolist()
                require(len(infos) == 1 and infos[0].filename == 'artifact.tar',
                        'ZIP must contain only artifact.tar')
                info = infos[0]
                mode = info.external_attr >> 16
                require(stat.S_IFMT(mode) in (0, stat.S_IFREG) and not info.flag_bits & 1 and
                        info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                        'Unsupported ZIP member type, encryption, or compression')
                require(1024 <= info.file_size <= R.MAX_TAR, 'TAR byte cap exceeded')
                measured = _MeasuredArchive(archive)
                plan = []

                def select(name, size):
                    plan.append((name, size, measured.reader.position))
                    require(name != RECEIPT_NAME and not name.startswith(RECEIPT_NAME + '/'),
                            'Candidate conflicts with reserved restoration receipt path')
                    require(name != R.PREFIX.rstrip('/') and not name.startswith(R.PREFIX),
                            'Only normal candidates are supported; packed transport refused')
                    if name == 'publication.json':
                        require(size <= R.PUBLICATION_CAP, 'Publication byte cap exceeded')
                        return True
                    return False

                selected, sizes, structure = R.scan_tar(measured, select, R.PUBLICATION_CAP)
                require(measured.reader.position == info.file_size, 'TAR byte size mismatch')
                tar_sha256 = measured.reader.sha256.hexdigest()
                publication_bytes = selected.get('publication.json')
                require(publication_bytes is not None, 'Normal candidate publication.json is missing')
                publication = R.parse_json(publication_bytes)
                require(isinstance(publication, dict) and publication.get('transport') is None,
                        'Only normal candidates are supported; packed transport refused')
                require('static-data/manifest.json' in sizes, 'Normal candidate static-data/manifest.json is missing')
                _source_stable(source, archive_path, before)
                _parent_stable(output.parent, parent_fd)
                payload_bytes = sum(sizes.values())
                free_bytes = _disk_free_bytes(parent_fd)
                required_bytes = payload_bytes + _reserve_bytes
                require(free_bytes >= required_bytes,
                        f'Insufficient disk space: need {required_bytes} bytes '
                        f'({payload_bytes} payload + {_reserve_bytes} reserve), have {free_bytes}')
                require(not output.exists() and not output.is_symlink(), 'Output appeared during restoration')
                staging_name = _new_staging(parent_fd)
                _parent_stable(output.parent, parent_fd)
                staging_fd = os.open(staging_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                     dir_fd=parent_fd)
                files = _copy_files(archive, plan, staging_fd, info.file_size, tar_sha256)
                require({name: item['bytes'] for name, item in files.items()} == sizes,
                        'Restored file inventory mismatch')
                _source_stable(source, archive_path, before)
                _verify_zip_hash(source, expected_bytes, expected_sha256)
                _source_stable(source, archive_path, before)
                result = {
                    'schema_version': 'retained-price-candidate-restoration-v1',
                    'scope': 'Original regular-file bytes of one normal candidate only; '
                             'empty directories and archive ownership, permissions, and timestamps are not restored',
                    'publication_authority': False,
                    'ready_to_publish': False,
                    'financial_success_claim': False,
                    'quality_success_claim': False,
                    'fullSiteVerified': False,
                    'mode': 'normal-candidate',
                    'archive': {'path': str(archive_path), 'bytes': expected_bytes,
                                'sha256': expected_sha256, 'member': 'artifact.tar',
                                'tarBytes': info.file_size, 'tarSha256': tar_sha256},
                    'archiveStructure': structure,
                    'restoredFiles': len(files),
                    'restoredBytes': payload_bytes,
                    'diskPreflight': {'availableBytes': free_bytes, 'requiredBytes': required_bytes,
                                      'payloadBytes': payload_bytes, 'reserveBytes': _reserve_bytes,
                                      'reservePurpose': 'Filesystem overhead, receipt, and downstream full carry'},
                    'publication': {'bytes': len(publication_bytes), 'sha256': R.digest(publication_bytes)},
                    'files': dict(sorted(files.items())),
                }
                receipt_bytes = R.canonical(result)
                require(len(receipt_bytes) <= RECEIPT_CAP, 'Restoration receipt byte cap exceeded')
                with _exclusive_file(staging_fd, RECEIPT_NAME) as sink:
                    require(sink.write(receipt_bytes) == len(receipt_bytes), 'Incomplete receipt write')
                _source_stable(source, archive_path, before)
                _parent_stable(output.parent, parent_fd)
                require(not output.exists() and not output.is_symlink(), 'Output appeared during restoration')
                _commit(staging_name, output.name, parent_fd, rename)
                staging_name = None
                return result
    finally:
        if staging_fd is not None:
            os.close(staging_fd)
        try:
            if staging_name is not None:
                shutil.rmtree(staging_name, dir_fd=parent_fd)
        finally:
            os.close(parent_fd)


def restore(archive_path, expected_sha256, expected_bytes, output):
    return _restore(archive_path, expected_sha256, expected_bytes, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--sha256', required=True, help='Pinned complete ZIP SHA256')
    parser.add_argument('--bytes', required=True, type=int, help='Pinned complete ZIP byte size')
    parser.add_argument('--output', required=True, help='New directory under an existing real parent')
    args = parser.parse_args()
    try:
        result = restore(args.archive, args.sha256, args.bytes, args.output)
        print(json.dumps({'output': str(Path(args.output).absolute()),
                          'mode': result['mode'], 'restoredFiles': result['restoredFiles'],
                          'restoredBytes': result['restoredBytes'],
                          'archiveSha256': result['archive']['sha256'],
                          'publication_authority': False, 'ready_to_publish': False}))
    except (RecoveryError, OSError, zipfile.BadZipFile, RuntimeError, UnicodeError,
            RecursionError) as error:
        print('Restoration refused: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
