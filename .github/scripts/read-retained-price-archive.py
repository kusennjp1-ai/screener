#!/usr/bin/env python3
"""Recover an explicit, bounded set of JSON files from a pinned Pages ZIP.

This is a scoped recovery receipt, NOT a full transport/site/publication verifier.
The ZIP digest authenticates the input. Packed selections additionally verify the
publication -> root -> selected shards/inventories -> encoded/decoded bytes chain.
Unselected payload bytes are never materialized or claimed to be verified.
Only Python's standard library is used; no provider requests or archive extraction.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import sys
import tarfile
import tempfile
import zipfile
import zlib

FORMAT = 'screener-static-transport-v1'
PREFIX = 'static-data/_transport/'
MIB = 1024 * 1024
MAX_ZIP = 512 * MIB
MAX_TAR = 2 * 1024 * MIB
MAX_MEMBER = 128 * MIB
MAX_OUTPUT = 64 * MIB
MAX_METADATA = 64 * MIB
MAX_REQUEST = 128 * 1024
MAX_PATHS = 128
ROOT_CAP = 64 * 1024
SHARD_CAP = 256 * 1024
INVENTORY_CAP = 32 * MIB
PUBLICATION_CAP = 2 * MIB
HASH = re.compile(r'[a-f0-9]{64}\Z')
PATH_PART = re.compile(r'[A-Za-z0-9_.-]+\Z')
METADATA = re.compile(r'static-data/_transport/(root|logical|physical|shard)-[a-f0-9]{64}\.json\Z')


class RecoveryError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise RecoveryError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key: ' + key)
        result[key] = value
    return result


def parse_json(data, canonical_required=False):
    try:
        value = json.loads(data.decode('utf-8'), object_pairs_hook=unique_object,
                           parse_constant=lambda _: (_ for _ in ()).throw(RecoveryError('Nonfinite JSON number')))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise RecoveryError('Invalid UTF-8 JSON') from error
    if canonical_required:
        require(canonical(value) == data, 'Noncanonical transport JSON')
    return value


def keys_are(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def valid_hash(value):
    return isinstance(value, str) and HASH.fullmatch(value) is not None


def valid_path(value):
    return (isinstance(value, str) and 0 < len(value) <= 1024 and
            all(PATH_PART.fullmatch(part) and part not in ('.', '..') for part in value.split('/')))


def integer(value, cap, minimum=0):
    return type(value) is int and minimum <= value <= cap


def requested_paths(value):
    require(isinstance(value, list) and 0 < len(value) <= MAX_PATHS, 'Request must contain 1..128 exact logical paths')
    require(all(valid_path(path) for path in value), 'Unsafe requested path')
    require(len(set(value)) == len(value), 'Duplicate requested path')
    for path in value:
        require(path == 'publication.json' or (path.startswith('static-data/') and
                not path.startswith(PREFIX) and path.endswith('.json')), 'Request must select publication or static JSON')
    return sorted(value)


def tar_path(name, directory):
    require(isinstance(name, str), 'Invalid TAR path')
    if name in ('.', './'):
        require(directory, 'Root TAR entry must be a directory')
        return '.'
    if name.startswith('./'):
        name = name[2:]
    if directory and name.endswith('/'):
        name = name[:-1]
    require(valid_path(name), 'Unsafe TAR path: ' + repr(name))
    return name


def read_exact(stream, size):
    data = stream.read(size)
    require(len(data) == size, 'Truncated TAR content')
    return data


def scan_tar(archive, select, selected_cap=MAX_METADATA):
    """Consume the complete TAR and ZIP CRC, buffering only selected entries.

    GNU long names are bounded and validated on the following entry. Other TAR
    extensions (PAX, sparse, links, devices) are deliberately unsupported/fail shut.
    No tarfile extraction APIs are called. Padding/trailer bytes must be zero.
    """
    selected, entries, directories = {}, {}, set()
    total = buffered = headers = 0
    long_name = None
    with archive.open('artifact.tar') as stream:
        while True:
            block = read_exact(stream, 512)
            headers += 1
            require(headers <= 100000, 'TAR header count cap exceeded')
            if not any(block):
                require(long_name is None, 'Dangling GNU long name')
                require(read_exact(stream, 512) == bytes(512), 'Invalid TAR end markers')
                while True:
                    tail = stream.read(MIB)
                    if not tail:
                        break
                    require(not any(tail), 'Nonzero data after TAR end markers')
                break
            try:
                info = tarfile.TarInfo.frombuf(block, 'utf-8', 'strict')
            except (tarfile.TarError, UnicodeError, ValueError) as error:
                raise RecoveryError('Invalid TAR header') from error
            require(integer(info.size, MAX_MEMBER), 'TAR member size cap exceeded')
            total += info.size
            require(total <= MAX_TAR, 'TAR payload byte cap exceeded')
            if info.type == tarfile.GNUTYPE_LONGNAME:
                require(long_name is None and 0 < info.size <= 1026 and not info.linkname, 'Invalid GNU long name')
                raw = read_exact(stream, info.size)
                require(raw.endswith(b'\0') and b'\0' not in raw[:-1], 'Invalid GNU long name framing')
                long_name = raw[:-1].decode('utf-8', 'strict')
                padding = read_exact(stream, (-info.size) % 512)
                require(not any(padding), 'Nonzero TAR padding')
                continue
            require(info.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE), 'Unsupported TAR member type or link')
            require(not info.linkname, 'Unexpected TAR link target')
            directory = info.type == tarfile.DIRTYPE
            require(not directory or info.size == 0, 'Nonempty TAR directory')
            name = tar_path(long_name if long_name is not None else info.name, directory)
            long_name = None
            require(name not in entries and name not in directories, 'Duplicate TAR path: ' + name)
            if directory:
                directories.add(name)
            else:
                entries[name] = info.size
            keep = not directory and select(name, info.size)
            if keep:
                buffered += info.size
                require(buffered <= selected_cap, 'Selected encoded/metadata byte cap exceeded')
                selected[name] = read_exact(stream, info.size)
            else:
                remaining = info.size
                while remaining:
                    chunk = read_exact(stream, min(remaining, MIB))
                    remaining -= len(chunk)
            require(not any(read_exact(stream, (-info.size) % 512)), 'Nonzero TAR padding')
    for name in [*entries, *directories]:
        parts = name.split('/')
        require(all('/'.join(parts[:i]) not in entries for i in range(1, len(parts))), 'TAR file/directory path conflict')
    return selected, entries, {'regularFiles': len(entries), 'directories': len(directories), 'payloadBytes': total}


def descriptor(value, family, cap, extra=()):
    require(keys_are(value, ['path', 'bytes', 'sha256', *extra]), 'Invalid transport descriptor fields')
    require(valid_hash(value['sha256']) and value['path'] == f"{PREFIX}{family}-{value['sha256']}.json", 'Transport descriptor address mismatch')
    require(integer(value['bytes'], cap, 1), 'Transport descriptor byte cap exceeded')
    return value


def bindings(value):
    require(keys_are(value, ['manifestSha256', 'uiInventorySha256', 'financialGeneration', 'financialLineageSha256', 'sourceCommit', 'appCommit', 'candidateId']), 'Invalid transport binding fields')
    for key in ('manifestSha256', 'uiInventorySha256', 'candidateId'):
        require(valid_hash(value[key]), 'Invalid transport binding: ' + key)
    for key in ('financialGeneration', 'financialLineageSha256'):
        require(value[key] is None or valid_hash(value[key]), 'Invalid financial binding')
    require((value['financialGeneration'] is None) == (value['financialLineageSha256'] is None), 'Incomplete financial binding')
    for key in ('sourceCommit', 'appCommit'):
        require(isinstance(value[key], str) and re.fullmatch('[a-f0-9]{40}', value[key]), 'Invalid commit binding')


def metadata_value(cache, desc, receipts):
    data = cache.get(desc['path'])
    require(data is not None, 'Missing transport metadata: ' + desc['path'])
    require(len(data) == desc['bytes'] and digest(data) == desc['sha256'], 'Transport metadata integrity mismatch: ' + desc['path'])
    receipts[desc['path']] = {'bytes': len(data), 'sha256': digest(data)}
    return parse_json(data, canonical_required=True)


def inventory(value, logical):
    require(keys_are(value, ['format', 'files']) and value['format'] == FORMAT and isinstance(value['files'], dict), 'Invalid transport inventory')
    for path, item in value['files'].items():
        require(valid_path(path) and path != 'publication.json' and (not logical or not path.startswith(PREFIX)), 'Invalid inventory path')
        require(keys_are(item, ['bytes', 'sha256']) and integer(item['bytes'], MAX_MEMBER) and valid_hash(item['sha256']), 'Invalid inventory entry')
    return value['files']


def is_packed(path):
    return bool(re.fullmatch(r'static-data/markets/us/charts/(?!index\.json$)[^/]+\.json', path) or
                re.fullmatch(r'static-data/research-details/[^/]+\.json', path) or
                re.fullmatch(r'static-data/markets/us/scan/chunks/[^/]+\.json', path))


def entry_valid(entry):
    require(keys_are(entry, ['path', 'kind', 'assetPath', 'encodedBytes', 'encodedSha256', 'decodedBytes', 'decodedSha256']), 'Invalid transport entry fields')
    path = entry['path']
    require(valid_path(path) and not path.startswith(PREFIX) and path != 'publication.json', 'Invalid logical path')
    require(entry['kind'] in ('gzip', 'identity') and (entry['kind'] == 'gzip') == is_packed(path), 'Incorrect transport kind')
    for key in ('encodedBytes', 'decodedBytes'):
        require(integer(entry[key], MAX_MEMBER), 'Transport asset byte cap exceeded')
    require(valid_hash(entry['encodedSha256']) and valid_hash(entry['decodedSha256']), 'Invalid asset hash')
    if entry['kind'] == 'gzip':
        require(entry['assetPath'] == f"{PREFIX}gzip/{entry['encodedSha256']}.bin" and entry['encodedBytes'] >= 20, 'Invalid compressed asset address')
    else:
        require(entry['assetPath'] == path and entry['encodedBytes'] == entry['decodedBytes'] and entry['encodedSha256'] == entry['decodedSha256'], 'Invalid identity entry')


def packed_entries(publication, cache, paths, physical_sizes):
    transport = publication.get('transport')
    require(isinstance(transport, dict) and transport.get('schema_version') == 'static-json-transport-publication-v1', 'Unsupported publication transport')
    expected = descriptor(transport.get('root'), 'root', ROOT_CAP, ('generation', 'bindings'))
    require(valid_hash(expected['generation']), 'Invalid transport generation')
    bindings(expected['bindings'])
    receipts = {}
    root = metadata_value(cache, expected, receipts)
    require(keys_are(root, ['format', 'generation', 'bindings', 'logicalInventory', 'physicalInventory', 'shards']) and root['format'] == FORMAT and root['generation'] == expected['generation'], 'Invalid transport root')
    bindings(root['bindings'])
    require(canonical(root['bindings']) == canonical(expected['bindings']), 'Transport bindings mismatch')
    descriptor(root['logicalInventory'], 'logical', INVENTORY_CAP)
    descriptor(root['physicalInventory'], 'physical', INVENTORY_CAP)
    require(isinstance(root['shards'], list) and len(root['shards']) == 256, 'Transport must have exactly 256 shards')
    for index, desc in enumerate(root['shards']):
        descriptor(desc, 'shard', SHARD_CAP, ('id',))
        require(desc['id'] == f'{index:02x}', 'Unsorted or duplicate transport shard')
    generation = {key: root[key] for key in ('format', 'bindings', 'logicalInventory', 'physicalInventory', 'shards')}
    require(digest(canonical(generation)) == expected['generation'], 'Transport generation digest mismatch')
    logical = inventory(metadata_value(cache, root['logicalInventory'], receipts), True)
    physical = inventory(metadata_value(cache, root['physicalInventory'], receipts), False)
    require(logical.get('static-data/manifest.json', {}).get('sha256') == root['bindings']['manifestSha256'], 'Manifest inventory binding mismatch')
    require(publication.get('data_manifest_sha256') == root['bindings']['manifestSha256'], 'Publication manifest binding mismatch')
    require(transport.get('ui_sha') == root['bindings']['appCommit'] and transport.get('ui_digest') == root['bindings']['uiInventorySha256'], 'Publication UI binding mismatch')
    selected = {}
    shard_ids = {digest(path.encode())[:2] for path in paths if path != 'publication.json'}
    for shard_id in sorted(shard_ids):
        desc = root['shards'][int(shard_id, 16)]
        shard = metadata_value(cache, desc, receipts)
        require(keys_are(shard, ['format', 'id', 'files']) and shard['format'] == FORMAT and shard['id'] == shard_id and isinstance(shard['files'], list), 'Invalid transport shard')
        previous = ''
        for entry in shard['files']:
            entry_valid(entry)
            path = entry['path']
            require(path > previous and digest(path.encode())[:2] == shard_id, 'Duplicate, unsorted, or misplaced shard entry')
            previous = path
            require(logical.get(path) == {'bytes': entry['decodedBytes'], 'sha256': entry['decodedSha256']}, 'Logical inventory disagrees with selected shard')
            require(physical.get(entry['assetPath']) == {'bytes': entry['encodedBytes'], 'sha256': entry['encodedSha256']}, 'Physical inventory disagrees with selected shard')
            if path in paths:
                require(physical_sizes.get(entry['assetPath']) == entry['encodedBytes'], 'Selected asset missing or size mismatch: ' + path)
                selected[path] = entry
    require(set(selected) == set(paths) - {'publication.json'}, 'Selected logical file missing from transport')
    return selected, expected, receipts


def decode_gzip(data, expected_size):
    require(len(data) >= 20 and data[:9] == bytes.fromhex('1f8b08000000000000'), 'Noncanonical gzip framing')
    inflater = zlib.decompressobj(-zlib.MAX_WBITS)
    try:
        decoded = inflater.decompress(data[10:-8], expected_size + 1)
    except zlib.error as error:
        raise RecoveryError('Invalid gzip DEFLATE stream') from error
    require(len(decoded) <= expected_size and not inflater.unconsumed_tail, 'Decoded byte cap exceeded')
    require(inflater.eof and not inflater.unused_data, 'Truncated, trailing bytes, or multiple gzip members')
    crc, size = struct.unpack('<II', data[-8:])
    require(size == len(decoded) and crc == zlib.crc32(decoded), 'Gzip CRC32 or size mismatch')
    require(len(decoded) == expected_size, 'Decoded size mismatch')
    return decoded


def snapshot(file):
    info = os.fstat(file.fileno())
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def ensure_real_parent(output):
    output = Path(os.path.abspath(output))
    require(not output.exists() and not output.is_symlink(), 'Output must be a new directory')
    require(output.parent.is_dir(), 'Output parent directory must already exist')
    require(output.parent.resolve() == output.parent, 'Output parent must not contain symlinks')
    return output


def recover(archive_path, expected_sha256, paths, output, output_cap=MAX_OUTPUT):
    require(valid_hash(expected_sha256), 'Expected archive SHA256 must be lowercase hex')
    require(integer(output_cap, MAX_OUTPUT, 1), 'Output cap must be between 1 and 64 MiB')
    paths = requested_paths(paths)
    output = ensure_real_parent(output)
    archive_path = Path(os.path.abspath(archive_path))
    fd = os.open(archive_path, os.O_RDONLY | os.O_NOFOLLOW)
    staging = None
    try:
        with os.fdopen(fd, 'rb') as source:
            before = snapshot(source)
            require(stat.S_ISREG(os.fstat(source.fileno()).st_mode) and 0 < before[2] <= MAX_ZIP, 'ZIP type or byte cap mismatch')
            hasher = hashlib.sha256()
            for chunk in iter(lambda: source.read(MIB), b''):
                hasher.update(chunk)
            require(hasher.hexdigest() == expected_sha256, 'Archive SHA256 mismatch')
            require(snapshot(source) == before, 'Archive changed while hashing')
            source.seek(0)
            with zipfile.ZipFile(source) as archive:
                infos = archive.infolist()
                require(len(infos) == 1 and infos[0].filename == 'artifact.tar', 'ZIP must contain only artifact.tar')
                info = infos[0]
                mode = info.external_attr >> 16
                require(stat.S_IFMT(mode) in (0, stat.S_IFREG) and not info.flag_bits & 1 and info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), 'Unsupported ZIP member type, encryption, or compression')
                require(1024 <= info.file_size <= MAX_TAR, 'TAR byte cap exceeded')

                def metadata_selection(name, size):
                    if name == 'publication.json':
                        require(size <= PUBLICATION_CAP, 'Publication byte cap exceeded')
                        return True
                    match = METADATA.fullmatch(name)
                    if match:
                        cap = ROOT_CAP if match[1] == 'root' else SHARD_CAP if match[1] == 'shard' else INVENTORY_CAP
                        require(size <= cap, 'Transport metadata byte cap exceeded')
                        return True
                    return False

                cache, sizes, tar_receipt = scan_tar(archive, metadata_selection)
                publication_bytes = cache.get('publication.json')
                publication = parse_json(publication_bytes) if publication_bytes is not None else None
                require(publication is None or isinstance(publication, dict), 'Invalid publication JSON')
                require('publication.json' not in paths or publication_bytes is not None, 'Selected publication.json missing')
                metadata_receipts = {}
                root = None
                if publication is not None and publication.get('transport') is not None:
                    entries, root, metadata_receipts = packed_entries(publication, cache, paths, sizes)
                    mode_name = 'packed-static-json'
                else:
                    require(not any(path.startswith(PREFIX) for path in sizes), 'Transport assets without a supported publication root')
                    entries = {}
                    for path in paths:
                        if path == 'publication.json':
                            continue
                        require(path in sizes, 'Selected logical file missing: ' + path)
                        entries[path] = {'path': path, 'kind': 'identity', 'assetPath': path, 'encodedBytes': sizes[path], 'decodedBytes': sizes[path]}
                    mode_name = 'plain-static-json'
                planned = sum(entry['decodedBytes'] for entry in entries.values()) + (len(publication_bytes) if 'publication.json' in paths else 0)
                require(planned <= output_cap, 'Selected decoded output byte cap exceeded')
                asset_paths = {entry['assetPath'] for entry in entries.values()}
                encoded, second_sizes, second_receipt = scan_tar(archive, lambda path, size: path in asset_paths, MAX_OUTPUT)
                require(sizes == second_sizes and tar_receipt == second_receipt, 'Archive contents changed between passes')
                require(snapshot(source) == before, 'Archive changed during recovery')
                require(os.stat(archive_path, follow_symlinks=False).st_ino == before[1], 'Archive path changed during recovery')
                staging = Path(tempfile.mkdtemp(prefix='.retained-price-', dir=output.parent))
                files = {}
                bytes_written = 0
                for path in paths:
                    if path == 'publication.json':
                        data = publication_bytes
                        receipt = {'kind': 'bootstrap', 'assetPath': path, 'encodedBytes': len(data), 'encodedSha256': digest(data)}
                    else:
                        entry = entries[path]
                        data = encoded.get(entry['assetPath'])
                        require(data is not None and len(data) == entry['encodedBytes'], 'Selected encoded file missing or wrong length')
                        encoded_hash = digest(data)
                        if root:
                            require(encoded_hash == entry['encodedSha256'], 'Encoded integrity mismatch: ' + path)
                        if entry['kind'] == 'gzip':
                            data = decode_gzip(data, entry['decodedBytes'])
                        require(len(data) == entry['decodedBytes'], 'Decoded size mismatch: ' + path)
                        if root:
                            require(digest(data) == entry['decodedSha256'], 'Decoded integrity mismatch: ' + path)
                        receipt = {'kind': entry['kind'], 'assetPath': entry['assetPath'], 'encodedBytes': entry['encodedBytes'], 'encodedSha256': encoded_hash}
                    parse_json(data)
                    bytes_written += len(data)
                    require(bytes_written <= output_cap, 'Output byte cap exceeded')
                    target = staging / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open('xb') as sink:
                        sink.write(data)
                    files[path] = {**receipt, 'decodedBytes': len(data), 'decodedSha256': digest(data)}
                result = {
                    'schema_version': 'retained-price-scoped-extraction-v1',
                    'scope': 'Only requested logical payloads and their transport dependencies; not full-site or publication approval verification',
                    'fullSiteVerified': False, 'mode': mode_name,
                    'archive': {'path': str(archive_path), 'bytes': before[2], 'sha256': expected_sha256, 'member': 'artifact.tar', 'tarBytes': info.file_size},
                    'request': paths, 'outputBytes': bytes_written, 'outputCapBytes': output_cap,
                    'publication': ({'bytes': len(publication_bytes), 'sha256': digest(publication_bytes)} if publication_bytes is not None else None),
                    'expectedRoot': root, 'verifiedMetadata': metadata_receipts, 'archiveStructure': tar_receipt,
                    'files': files,
                }
                receipt_bytes = canonical(result)
                require(bytes_written + len(receipt_bytes) <= output_cap, 'Output plus receipt exceeds byte cap')
                with (staging / 'scoped-extraction-manifest.json').open('xb') as sink:
                    sink.write(receipt_bytes)
                require(not output.exists() and not output.is_symlink(), 'Output appeared during recovery')
                os.rename(staging, output)
                staging = None
                return result
    finally:
        if staging is not None:
            shutil.rmtree(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--paths', required=True, help='JSON array of exact logical paths (max 128)')
    parser.add_argument('--output', required=True, help='New directory under an existing real parent')
    parser.add_argument('--max-output-bytes', type=int, default=MAX_OUTPUT)
    args = parser.parse_args()
    try:
        with open(args.paths, 'rb') as source:
            request = source.read(MAX_REQUEST + 1)
        require(len(request) <= MAX_REQUEST, 'Request JSON byte cap exceeded')
        result = recover(args.archive, args.sha256, parse_json(request), args.output, args.max_output_bytes)
        print(json.dumps({'output': str(Path(args.output).absolute()), 'mode': result['mode'], 'files': len(result['files']), 'outputBytes': result['outputBytes'], 'archiveSha256': result['archive']['sha256'], 'fullSiteVerified': False}))
    except (RecoveryError, OSError, zipfile.BadZipFile, RuntimeError, UnicodeError, RecursionError) as error:
        print('Recovery refused: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
