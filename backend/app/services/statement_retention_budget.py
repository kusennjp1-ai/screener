"""One-visit source-package reservation; never source or publication authority.

Known bytes are deflated with the final canonical ZIP writer's algorithm. Future
bytes use a conservative zlib bound, not an observed compression ratio. Every
provider boundary reserves the remainder of its getter plus finalization. The
actual Actions artifact must still be downloaded and verified before reuse.
"""
from dataclasses import dataclass
import hashlib
import os
import re
from pathlib import Path
import stat
import tempfile
import zipfile
import zlib

from . import financial_statement_batch as batch
from . import statement_artifact_archive as archive

ZIP_COMPRESSED_LIMIT = 128 * 1024 * 1024
ZIP_EXPANDED_LIMIT = 512 * 1024 * 1024
ZIP_MEMBER_LIMIT = 32 * 1024 * 1024
ZIP_FILE_LIMIT = 30000
MAX_PATH_BYTES = 512
MANIFEST_GROWTH_LIMIT = 8 * 1024 * 1024
STOPPED_PROJECTION_LIMIT = 32 * 1024
# local header, optional ZIP64/data descriptor, central header, bounded name;
# the canonical writer emits no arbitrary ZIP extra fields or archive comment.
MAX_MEMBER_FRAMING = 2 * MAX_PATH_BYTES + 160
ZIP_END_FRAMING = 128


class RetentionIntegrityError(ValueError):
    pass


class RetentionBudgetExceeded(ValueError):
    def __init__(self, report):
        self.report = report
        super().__init__('Bounded source retention reservation exhausted')


def compressed_bound(length):
    # Conservative compressBound overhead, with additional raw/ZIP slack.
    if type(length) is not int or length < 0:
        raise ValueError('Invalid reserved byte count')
    return length + (length >> 12) + (length >> 14) + (length >> 25) + 128


@dataclass(frozen=True)
class FileMeasure:
    signature: tuple
    size: int
    compressed: int
    sha256: str


class StatementRetentionBudget:
    def __init__(self, output_root, *, selected_symbols=200, max_transport_requests=1000):
        if (type(selected_symbols) is not int or not 1 <= selected_symbols <= 200
                or type(max_transport_requests) is not int or not 1 <= max_transport_requests <= 1000):
            raise ValueError('Unsupported one-visit retention scope')
        self.root = Path(output_root)
        root_info = self.root.lstat()
        if not stat.S_ISDIR(root_info.st_mode):
            raise RetentionIntegrityError('Linked or special retention root')
        self.root_identity = (root_info.st_dev, root_info.st_ino)
        self.selected_symbols = selected_symbols
        self.max_transport_requests = max_transport_requests
        self.cache = {}
        manifest = self.root / 'archive/manifest.json'
        size = self._regular(manifest).st_size
        if not 0 < size <= archive.MAX_MANIFEST_BYTES:
            raise RetentionIntegrityError('Missing bounded original archive manifest')
        self.maximum_manifest_bytes = min(archive.MAX_MANIFEST_BYTES, size + MANIFEST_GROWTH_LIMIT)
        self.last_report = None
        self.original_files = None
        self.premerge_files = None
        self.phase = "acquisition"
        self.original_directories = None
        self.premerge_directories = None
        self.authorized_final_digests = None
        self.authorized_object_paths = None
        self.integrity_failure = None

    @staticmethod
    def _regular(path):
        info = os.lstat(path)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise RetentionIntegrityError('Linked or special retention file')
        return info

    def _measure(self, path, before=None, *, key=None):
        before = self._regular(path) if before is None else before
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise RetentionIntegrityError('Linked or special retention file')
        key = path if key is None else key
        signature = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        previous = self.cache.get(key)
        if previous is not None and previous.signature == signature:
            return previous
        compressor = zlib.compressobj(6, zlib.DEFLATED, -15)
        size = 0
        checksum = hashlib.sha256()
        with open(path, 'rb') as stream:
            for data in iter(lambda: stream.read(1024 * 1024), b''):
                checksum.update(data)
                size += len(compressor.compress(data))
        size += len(compressor.flush())
        after = self._regular(path)
        if signature != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise RetentionIntegrityError('Retention input changed during measurement')
        measured = FileMeasure(signature, before.st_size, size, checksum.hexdigest())
        self.cache[key] = measured
        return measured

    def snapshot(self, *, force_bytes=False):
        if force_bytes:
            self.cache.clear()
        root_info = self.root.lstat()
        if (not stat.S_ISDIR(root_info.st_mode)
                or (root_info.st_dev, root_info.st_ino) != self.root_identity):
            raise RetentionIntegrityError('Linked, replaced or special retention root')
        files = {}
        directories = 0
        directory_ids = {}
        # Every boundary still visits and no-follow stats every entry. Reusing
        # the DirEntry stat avoids Path.rglob's extra traversal and duplicate
        # lstats. Only unchanged file measurements use their signature cache.
        pending = [(str(self.root), '')]
        while pending:
            directory, prefix = pending.pop()
            with os.scandir(directory) as entries:
                for entry in entries:
                    relative = prefix + entry.name
                    if (len(relative.encode()) > MAX_PATH_BYTES or '\\' in relative
                            or any(part in ('', '.', '..') for part in relative.split('/'))):
                        raise RetentionIntegrityError('Unsafe bounded retention path')
                    info = entry.stat(follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        directories += 1
                        directory_ids[relative] = (info.st_dev, info.st_ino)
                        pending.append((entry.path, relative + '/'))
                    elif stat.S_ISREG(info.st_mode):
                        files[relative] = self._measure(entry.path, info, key=relative)
                    else:
                        raise RetentionIntegrityError('Linked or special retention member')
        raw = sum(item.size for item in files.values())
        compressed = sum(item.compressed + 2 * len(name.encode()) + 160 for name, item in files.items()) + ZIP_END_FRAMING
        # Directory records are not emitted by our canonical ZIP, but reserving
        # them also covers the upload service's ordinary explicit directories.
        compressed += directories * MAX_MEMBER_FRAMING
        return {'files': files, '_directory_ids': directory_ids, 'expanded_bytes': raw, 'compressed_bound_bytes': compressed,
                'member_count': len(files) + directories,
                'maximum_member_bytes': max((item.size for item in files.values()), default=0)}

    def _preserved(self, measured):
        files = measured['files']
        expected = self.premerge_files if self.phase == 'finalization' else self.original_files
        if expected is None:
            self.original_files = dict(files)
            self.original_directories = dict(measured['_directory_ids'])
            return
        mutable = self.authorized_final_digests or {}
        expected_directories = self.premerge_directories if self.phase == 'finalization' else self.original_directories
        for name, identity in expected_directories.items():
            if measured['_directory_ids'].get(name) != identity:
                raise RetentionIntegrityError('Retained source directory disappeared or changed')
        for name, before in expected.items():
            if name not in files:
                raise RetentionIntegrityError('Retained source member disappeared')
            after = files[name]
            if name in mutable and after.sha256 != mutable[name]:
                raise RetentionIntegrityError('Final source metadata is not the authorized replacement')
            if name not in mutable and (before.size != after.size or before.sha256 != after.sha256):
                raise RetentionIntegrityError('Retained source bytes changed')
        for name in measured['_directory_ids'].keys() - expected_directories.keys():
            permitted = ((name == 'batch' or name.startswith('batch/')) if self.phase == 'acquisition'
                         else name in {'archive/objects', 'archive/manifests'})
            if not permitted:
                raise RetentionIntegrityError('Unowned retained source directory addition')
        for name in files.keys() - expected.keys():
            permitted = (name.startswith('batch/') if self.phase == 'acquisition' else
                         (name in (self.authorized_object_paths or set())
                          or name == f"archive/manifests/{mutable.get('archive/manifest.json')}.json"))
            if not permitted:
                raise RetentionIntegrityError('Unowned retained source addition')
            if self.phase == 'finalization' and Path(name).stem != files[name].sha256:
                raise RetentionIntegrityError('New archive path does not bind its actual bytes')
        if self.phase == 'finalization' and self.authorized_object_paths is not None:
            actual = {name for name in files if name.startswith('archive/objects/')}
            if actual != self.authorized_object_paths:
                raise RetentionIntegrityError('Final archive objects differ from the validated manifest')
            manifest_sha = mutable['archive/manifest.json']
            snapshot = files.get(f'archive/manifests/{manifest_sha}.json')
            if snapshot is None or snapshot.sha256 != manifest_sha:
                raise RetentionIntegrityError('Final immutable manifest snapshot is missing or changed')

    def _verified_snapshot(self, *, force_bytes=False):
        if self.integrity_failure is not None:
            raise RetentionIntegrityError(self.integrity_failure)
        try:
            measured = self.snapshot(force_bytes=force_bytes)
            self._preserved(measured)
            return measured
        except (RetentionIntegrityError, OSError) as exc:
            self.integrity_failure = str(exc)
            raise RetentionIntegrityError(self.integrity_failure) from None

    def before_merge(self):
        if self.phase != 'acquisition':
            raise RetentionIntegrityError('Retained source merge phase already closed')
        measured = self._verified_snapshot(force_bytes=True)
        self._capacity(measured, 'before_merge')
        self.premerge_files = dict(measured['files'])
        self.premerge_directories = dict(measured['_directory_ids'])
        self.phase = 'finalization'
        # Archive merge has its own bounded atomic writer; none of the old
        # measurement cache is evidence for the subsequent complete readback.
        self.cache.clear()

    def authorize_finalization(self, *, archive_manifest_sha256, cycle_sha256, archive_object_sha256s):
        if (self.phase != 'finalization' or self.authorized_final_digests is not None
                or any(not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value)
                       for value in (archive_manifest_sha256, cycle_sha256))):
            raise RetentionIntegrityError('Invalid retained-source finalization binding')
        if (not isinstance(archive_object_sha256s, (dict, list, tuple, set))
                or any(not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value)
                       for value in archive_object_sha256s)):
            raise RetentionIntegrityError('Invalid validated archive object inventory')
        self.authorized_object_paths = ({f'archive/objects/{value}.json' for value in archive_object_sha256s}
                                        | {name for name in self.premerge_files if name.startswith('archive/objects/')})
        self.authorized_final_digests = {'archive/manifest.json': archive_manifest_sha256,
                                         'cycle.json': cycle_sha256}

    def check(self, stage):
        if stage not in ('initial', 'getter', 'transport', 'result', 'before_merge'):
            raise ValueError('Unknown source retention boundary')
        measured = self._verified_snapshot()
        return self._capacity(measured, stage)

    def _capacity(self, measured, stage):
        files = measured['files']
        # Batch results/acquisitions and metadata are later copied into the
        # archive. Reserving every batch member is conservative: transport
        # files are embedded in receipts rather than independently indexed.
        mirrored = [value for name, value in files.items() if name.startswith('batch/')]
        mirror_raw = sum(value.size for value in mirrored)
        mirror_compressed = sum(value.compressed for value in mirrored)
        artifact = batch.MAX_ARTIFACT_BYTES
        # Four mutable global metadata files, each potentially mirrored, plus
        # two bounded next-manifest copies. The lower manifest ceiling is
        # enforced atomically by merge_batch before writing any new objects.
        global_raw = 8 * artifact + 2 * self.maximum_manifest_bytes
        global_compressed = 8 * compressed_bound(artifact) + 2 * compressed_bound(self.maximum_manifest_bytes)
        # One getter can finish its transport, acquisition, envelope and result
        # before the next boundary. Each is bounded at 2 MiB and mirrored here;
        # an additional atomic temporary exists only in the expanded tree.
        step_raw = 8 * artifact + artifact
        step_compressed = 8 * compressed_bound(artifact)
        # Every unstarted selected symbol retains the original empty envelope
        # and complete result, both mirrored into the archive. Do not invent a
        # compact schema that the independently reviewed certifier cannot replay.
        stopped_raw = 4 * self.selected_symbols * STOPPED_PROJECTION_LIMIT
        stopped_compressed = 4 * self.selected_symbols * compressed_bound(STOPPED_PROJECTION_LIMIT)
        # Worst number of new files is independently limited by the HTTP/getter
        # caps, result/envelope count, mirrored originals and fixed metadata.
        future_members = self.max_transport_requests + 8 * self.selected_symbols + 32
        if stage == 'before_merge':
            # All selected results already exist and no further provider work
            # is allowed. Reserve only actual batch copies and final metadata;
            # a normal acquisition stop must still be able to merge its proof.
            step_raw = step_compressed = stopped_raw = stopped_compressed = 0
            future_members = len(mirrored) + 16
        reserved_raw = mirror_raw + global_raw + step_raw + stopped_raw
        reserved_compressed = (mirror_compressed + global_compressed + step_compressed
                               + stopped_compressed + future_members * MAX_MEMBER_FRAMING)
        report = {key: value for key, value in measured.items() if key not in {'files', '_directory_ids'}}
        report.update(stage=stage, maximum_manifest_bytes=self.maximum_manifest_bytes,
                      reserved_expanded_bytes=reserved_raw, reserved_compressed_bytes=reserved_compressed,
                      expanded_headroom_bytes=ZIP_EXPANDED_LIMIT - measured['expanded_bytes'] - reserved_raw,
                      compressed_headroom_bytes=ZIP_COMPRESSED_LIMIT - measured['compressed_bound_bytes'] - reserved_compressed,
                      member_headroom=ZIP_FILE_LIMIT - measured['member_count'] - future_members,
                      source_package_limits={'compressed': ZIP_COMPRESSED_LIMIT, 'expanded': ZIP_EXPANDED_LIMIT,
                                             'members': ZIP_FILE_LIMIT, 'member_bytes': ZIP_MEMBER_LIMIT})
        self.last_report = report
        if (report['expanded_headroom_bytes'] < 0 or report['compressed_headroom_bytes'] < 0
                or report['member_headroom'] < 0 or measured['maximum_member_bytes'] > ZIP_MEMBER_LIMIT):
            raise RetentionBudgetExceeded(report)
        return report

    def verify_final(self):
        if self.phase == 'finalization' and self.authorized_final_digests is None:
            raise RetentionIntegrityError('Final retained-source replacements are not bound')
        measured = self._verified_snapshot(force_bytes=True)
        if (measured['expanded_bytes'] > ZIP_EXPANDED_LIMIT or measured['compressed_bound_bytes'] > ZIP_COMPRESSED_LIMIT
                or measured['member_count'] > ZIP_FILE_LIMIT or measured['maximum_member_bytes'] > ZIP_MEMBER_LIMIT):
            raise RetentionBudgetExceeded({key: value for key, value in measured.items() if key not in {'files', '_directory_ids'}})
        # Measure an actual complete standard ZIP, without copying or changing
        # source observations. The temporary package is outside the upload root.
        with tempfile.TemporaryDirectory(prefix='statement-package-', dir=self.root.parent) as temp:
            package = Path(temp) / 'source.zip'
            with zipfile.ZipFile(package, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as writer:
                for name in sorted(measured['files']):
                    writer.write(self.root / name, name)
            if package.stat().st_size > ZIP_COMPRESSED_LIMIT:
                raise RetentionBudgetExceeded({'canonical_zip_bytes': package.stat().st_size})
            with zipfile.ZipFile(package) as reader:
                if reader.testzip() is not None or len(reader.infolist()) != len(measured['files']):
                    raise RetentionIntegrityError('Final source ZIP readback failed')
                for item in reader.infolist():
                    checksum = hashlib.sha256()
                    with reader.open(item) as stream:
                        for data in iter(lambda: stream.read(1024 * 1024), b''):
                            checksum.update(data)
                    if checksum.hexdigest() != measured['files'][item.filename].sha256:
                        raise RetentionIntegrityError('Final source ZIP changed original bytes')
            after = self._verified_snapshot(force_bytes=True)
            if measured != after:
                raise RetentionIntegrityError('Retained source inventory changed during ZIP readback')
            result = {key: value for key, value in measured.items() if key not in {'files', '_directory_ids'}}
            result.update(canonical_zip_bytes=package.stat().st_size,
                          canonical_zip_sha256=hashlib.sha256(package.read_bytes()).hexdigest(),
                          actual_actions_artifact_readback_required=True)
        return result
