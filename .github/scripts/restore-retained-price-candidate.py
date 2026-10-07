#!/usr/bin/env python3
"""Restore original regular files from pinned Pages or explicitly checked export bytes.

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
CHECKED_EXPORT_SCHEMA = 'retained-price-checked-export-input-v1'


def _checked_export_reference():
    raw = (Path(__file__).parent / 'fixtures/retained-price-recovery-oct6-inputs.json').read_bytes()
    require(R.digest(raw) == '46d422e9f5e27dcd1e50fb068619c0aafbff04f646060324c29570d219955e89',
            'Unreviewed checked-export reference')
    source = R.parse_json(raw)['candidate']
    return {**source, 'repository': 'kusennjp1-ai/screener', 'repository_id': 1203919607,
            'tree_sha': '2186101e92e1f71771936831cea0a40e410975f7',
            'regular_files': 19480, 'payload_bytes': 1876607954}


def _read_bound_file(path, expected_sha256, expected_bytes=None, cap=64 * R.MIB):
    path = Path(os.path.abspath(path))
    require(path.resolve(strict=True) == path, 'Checked-export evidence path must not contain symlinks')
    with path.open('rb') as stream:
        before = R.snapshot(stream)
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode) and before[2] <= cap,
                'Checked-export evidence must be a bounded regular file')
        require(expected_bytes is None or before[2] == expected_bytes, 'Checked-export evidence size mismatch')
        raw = stream.read(cap + 1)
        require(len(raw) == before[2] and R.digest(raw) == expected_sha256, 'Checked-export evidence SHA256 mismatch')
        _source_stable(stream, path, before)
    return raw


def _verify_checked_export_inputs(archive_sha256, archive_bytes, companion_path, evidence_path, evidence_sha256):
    """No caller-defined reference or origin bypass is exposed by the public API."""
    ref = _checked_export_reference()
    require((archive_sha256, archive_bytes) == (ref['sha256'], ref['bytes']), 'Unreviewed checked-export archive')
    require(companion_path and evidence_path and R.valid_hash(evidence_sha256), 'Checked export requires exact companion and authenticated API evidence')
    companion = _read_bound_file(companion_path, ref['companion_sha256'], ref['companion_bytes'], R.MIB)
    import io
    with zipfile.ZipFile(io.BytesIO(companion)) as archive:
        infos = archive.infolist()
        require(len(infos) == 1 and infos[0].filename == 'source.json', 'Checked-export companion must contain only source.json')
        item = infos[0]
        require(stat.S_IFMT(item.external_attr >> 16) in (0, stat.S_IFREG) and not item.flag_bits & 1
                and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and item.file_size <= R.MIB,
                'Invalid checked-export companion member')
        source_raw = archive.read(item)
    require(R.digest(source_raw) == ref['retained_source_json_sha256'], 'Checked-export source.json changed')
    source = R.parse_json(source_raw)
    require(type(source.get('run_id')) is int and type(source.get('run_attempt')) is int,
            'Invalid checked-export source run identity')
    for key, value in [('run_id', ref['run_id']), ('run_attempt', ref['run_attempt']), ('source_sha', ref['head_sha']),
                       ('artifact_name', ref['artifact_name']), ('manifest_sha256', ref['manifest_sha256']),
                       ('price_observations_sha256', ref['price_observations_sha256'])]:
        require(source.get(key) == value, 'Checked-export source origin differs: ' + key)
    require(isinstance(source.get('manifest_json'), str), 'Checked export lacks literal manifest')
    manifest_raw = source['manifest_json'].encode('utf-8')
    require(R.digest(manifest_raw) == ref['manifest_sha256'], 'Checked-export literal manifest changed')
    R.parse_json(manifest_raw)
    evidence_raw = _read_bound_file(evidence_path, evidence_sha256)
    evidence = R.parse_json(evidence_raw)
    require(evidence.get('schema_version') == 'oct6-retained-price-rehearsal-api-v1'
            and evidence.get('publication_authority') is False and evidence.get('provider_work') is False,
            'Invalid checked-export API evidence scope')
    jobs = []
    for role, artifact_id, name, size, digest in [
            ('candidate', ref['artifact_id'], ref['artifact_name'], ref['bytes'], ref['sha256']),
            ('companion', ref['companion_artifact_id'], f"static-site-data-manifest-{ref['run_id']}-{ref['run_attempt']}",
             ref['companion_bytes'], ref['companion_sha256'])]:
        selected = evidence.get('selected', {}).get(role, {})
        for field in ('run', 'current'):
            run = selected.get(field, {})
            require(run.get('id') == ref['run_id'] and run.get('run_attempt') == ref['run_attempt']
                    and run.get('head_sha') == ref['head_sha'] and run.get('head_branch') == 'main'
                    and run.get('path') == '.github/workflows/static-site.yml'
                    and run.get('event') in ('schedule', 'workflow_dispatch') and run.get('status') == 'completed'
                    and run.get('head_commit', {}).get('id') == ref['head_sha']
                    and run.get('head_commit', {}).get('tree_id') == ref['tree_sha'], 'Checked-export run origin changed')
            for key in ('repository', 'head_repository'):
                require(run.get(key, {}).get('full_name') == ref['repository'] and run[key].get('id') == ref['repository_id'],
                        'Checked-export repository origin changed')
        artifact = selected.get('artifact', {})
        require(artifact.get('id') == artifact_id and artifact.get('name') == name and artifact.get('size_in_bytes') == size
                and artifact.get('digest') == 'sha256:' + digest and artifact.get('expired') is False,
                'Checked-export artifact binding changed')
        origin = artifact.get('workflow_run', {})
        require(origin.get('id') == ref['run_id'] and origin.get('head_sha') == ref['head_sha'] and origin.get('head_branch') == 'main'
                and origin.get('repository_id') == origin.get('head_repository_id') == ref['repository_id'], 'Checked-export artifact origin changed')
        job = selected.get('producer_job', {})
        require(type(job.get('id')) is int and job['id'] > 0 and job.get('name') == 'combine-and-build'
                and job.get('run_id') == ref['run_id'] and job.get('run_attempt') == ref['run_attempt']
                and job.get('head_sha') == ref['head_sha'] and job.get('status') == 'completed' and job.get('conclusion') == 'success'
                and job in selected.get('jobs', []), 'Checked-export producer job changed')
        for step_name in ('Build static frontend', 'Upload verified data export', 'Preserve dated export provenance for release selection'):
            steps = [step for step in job.get('steps', []) if step.get('name') == step_name]
            require(len(steps) == 1 and steps[0].get('status') == 'completed' and steps[0].get('conclusion') == 'success',
                    'Checked-export successful producer step missing: ' + step_name)
        jobs.append(job)
    require(jobs[0] == jobs[1], 'Checked-export companion and candidate producer differ')
    declaration = {'schema_version': CHECKED_EXPORT_SCHEMA, 'publication_authority': False,
                   'repository': ref['repository'], 'run_id': ref['run_id'], 'run_attempt': ref['run_attempt'],
                   'head_sha': ref['head_sha'], 'artifact_id': ref['artifact_id'], 'artifact_name': ref['artifact_name'],
                   'archive': {'bytes': archive_bytes, 'sha256': archive_sha256},
                   'companion': {'artifact_id': ref['companion_artifact_id'], 'bytes': len(companion), 'sha256': R.digest(companion),
                                 'source_json_bytes': len(source_raw), 'source_json_sha256': R.digest(source_raw)},
                   'manifest': {'bytes': len(manifest_raw), 'sha256': R.digest(manifest_raw)},
                   'api_evidence': {'bytes': len(evidence_raw), 'sha256': R.digest(evidence_raw)},
                   'complete_inventory_required': True}
    return {'declaration': declaration, 'manifest_bytes': manifest_raw, 'reference': ref,
            'evidence_paths': [(companion_path, ref['companion_sha256'], len(companion)), (evidence_path, evidence_sha256, len(evidence_raw))]}


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
             _reserve_bytes=DEFAULT_RESERVE_BYTES, _checked_export=None):
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
                    if _checked_export is not None and name == 'static-data/manifest.json':
                        require(size <= R.MIB, 'Checked-export manifest byte cap exceeded')
                        return True
                    return False

                selected, sizes, structure = R.scan_tar(measured, select, R.PUBLICATION_CAP + (R.MIB if _checked_export else 0))
                require(measured.reader.position == info.file_size, 'TAR byte size mismatch')
                tar_sha256 = measured.reader.sha256.hexdigest()
                publication_bytes = selected.get('publication.json')
                if _checked_export is None:
                    require(publication_bytes is not None, 'Normal candidate publication.json is missing')
                    publication = R.parse_json(publication_bytes)
                    require(isinstance(publication, dict) and publication.get('transport') is None,
                            'Only normal candidates are supported; packed transport refused')
                else:
                    require(publication_bytes is None, 'Checked export must not claim a publication.json')
                    require(selected.get('static-data/manifest.json') == _checked_export['manifest_bytes'],
                            'Checked-export TAR manifest differs from exact companion')
                    ref = _checked_export['reference']
                    require(len(sizes) == ref['regular_files'] and sum(sizes.values()) == ref['payload_bytes'],
                            'Checked-export complete inventory differs from reviewed source')
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
                    'scope': ('Original regular-file bytes of the explicitly checked prepublication Static Site export only; '
                              if _checked_export else 'Original regular-file bytes of one normal candidate only; ') +
                             'empty directories and archive ownership, permissions, and timestamps are not restored',
                    'publication_authority': False,
                    'ready_to_publish': False,
                    'financial_success_claim': False,
                    'quality_success_claim': False,
                    'fullSiteVerified': False,
                    'mode': 'checked-export' if _checked_export else 'normal-candidate',
                    'archive': {'path': str(archive_path), 'bytes': expected_bytes,
                                'sha256': expected_sha256, 'member': 'artifact.tar',
                                'tarBytes': info.file_size, 'tarSha256': tar_sha256},
                    'archiveStructure': structure,
                    'restoredFiles': len(files),
                    'restoredBytes': payload_bytes,
                    'diskPreflight': {'availableBytes': free_bytes, 'requiredBytes': required_bytes,
                                      'payloadBytes': payload_bytes, 'reserveBytes': _reserve_bytes,
                                      'reservePurpose': 'Filesystem overhead, receipt, and downstream full carry'},
                    'publication': {'bytes': len(publication_bytes), 'sha256': R.digest(publication_bytes)} if publication_bytes is not None else None,
                    'files': dict(sorted(files.items())),
                }
                if _checked_export is not None:
                    result['checked_export'] = _checked_export['declaration']
                    for evidence_path, evidence_hash, evidence_bytes in _checked_export['evidence_paths']:
                        _read_bound_file(evidence_path, evidence_hash, evidence_bytes)
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


def restore_checked_export(archive_path, expected_sha256, expected_bytes, output, *, companion_path, evidence_path, evidence_sha256):
    checked = _verify_checked_export_inputs(expected_sha256, expected_bytes, companion_path, evidence_path, evidence_sha256)
    return _restore(archive_path, expected_sha256, expected_bytes, output, _checked_export=checked)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--sha256', required=True, help='Pinned complete ZIP SHA256')
    parser.add_argument('--bytes', required=True, type=int, help='Pinned complete ZIP byte size')
    parser.add_argument('--output', required=True, help='New directory under an existing real parent')
    parser.add_argument('--input-kind', choices=['normal-candidate', 'checked-export'], default='normal-candidate')
    parser.add_argument('--checked-export-companion')
    parser.add_argument('--checked-export-api-evidence')
    parser.add_argument('--checked-export-api-evidence-sha256')
    args = parser.parse_args()
    try:
        if args.input_kind == 'checked-export':
            result = restore_checked_export(args.archive, args.sha256, args.bytes, args.output,
                     companion_path=args.checked_export_companion, evidence_path=args.checked_export_api_evidence,
                     evidence_sha256=args.checked_export_api_evidence_sha256)
        else:
            require(not any([args.checked_export_companion, args.checked_export_api_evidence, args.checked_export_api_evidence_sha256]),
                    'Checked-export evidence requires explicit checked-export input kind')
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
