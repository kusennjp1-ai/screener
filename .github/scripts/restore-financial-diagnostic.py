"""Bounded immutable diagnostic intake; extraction never grants publication authority."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import sys
import tarfile
import zipfile

MEMBERS = {'corrected', 'projection', 'preview-receipt.json', 'release-request.json',
           'protected-code.json', 'verification.json', 'request.json', 'evidence.json', 'target-base.json'}
AUTHORITY = {'candidate.json', 'captured-candidate.json', 'activation-candidate.json', 'publication.json'}
MAX_BYTES = 8589934592
MAX_FILES = 200000

def require(ok, message):
    if not ok:
        raise ValueError(message)

def safe(name):
    return bool(re.fullmatch(r'[A-Za-z0-9._/-]+', name)) and not name.startswith('/') and all(p not in ('', '.', '..') for p in name.split('/'))

def hashed_copy(source, target, limit):
    h, count = hashlib.sha256(), 0
    with target.open('xb') as out:
        while chunk := source.read(1024 * 1024):
            count += len(chunk)
            require(count <= limit, 'Member exceeds byte bound')
            h.update(chunk)
            out.write(chunk)
    return {'sha256': h.hexdigest(), 'bytes': count}

def extract_diagnostic(zip_path, destination, maximum_bytes=MAX_BYTES, maximum_files=MAX_FILES):
    destination = Path(destination)
    require(not destination.exists(), 'Diagnostic output must be new')
    destination.mkdir(parents=True)
    files, seen, total, metadata = {}, set(), 0, None
    with zipfile.ZipFile(zip_path) as z:
        names = z.infolist()
        require(len(names) == 2 and {n.filename for n in names} == {'unapproved-financial-diagnostic.tar.gz', 'unapproved-financial-diagnostic-metadata.json'}, 'Unexpected diagnostic ZIP members')
        require(all(not stat.S_ISLNK(n.external_attr >> 16) and n.file_size <= maximum_bytes for n in names), 'Invalid diagnostic ZIP member')
        require(z.getinfo('unapproved-financial-diagnostic-metadata.json').file_size <= 32768, 'Oversized diagnostic sidecar')
        sidecar_bytes = z.read('unapproved-financial-diagnostic-metadata.json')
        require(len(sidecar_bytes) <= 32768, 'Oversized diagnostic sidecar')
        sidecar = json.loads(sidecar_bytes)
        require(sidecar.get('status') == 'UNAPPROVED' and sidecar.get('publication_authority') == 'none' and sidecar.get('design_accepted') is False and sidecar.get('activation_eligible') is False, 'Diagnostic sidecar claims authority')
        # Check nested archive before interpreting it. Retain one compressed copy,
        # never a second uncompressed candidate-sized TAR.
        nested = destination / 'diagnostic.tar.gz'
        with z.open('unapproved-financial-diagnostic.tar.gz') as source:
            actual = hashed_copy(source, nested, maximum_bytes)
        require(actual == {'sha256': sidecar.get('sha256'), 'bytes': sidecar.get('bytes')}, 'Nested diagnostic archive changed')
        with tarfile.open(nested, mode='r|gz') as t:
            for member in t:
                name = member.name.rstrip('/')
                require(safe(name) and name not in seen and (member.isfile() or member.isdir()), 'Unsafe, duplicate or special diagnostic member')
                seen.add(name)
                total += member.size
                require(len(seen) <= maximum_files and total <= maximum_bytes, 'Diagnostic extraction exceeds bound')
                if name in ('UNAPPROVED.txt', 'UNAPPROVED.json'):
                    require(member.isfile() and member.size <= 32 * 1024 * 1024, 'Invalid diagnostic metadata')
                    data = t.extractfile(member).read()
                    if name == 'UNAPPROVED.json':
                        metadata = json.loads(data)
                        (destination / 'diagnostic-metadata.json').write_bytes(data)
                    continue
                require(name.startswith('review-only/'), 'Unexpected diagnostic root')
                relative = name[len('review-only/'):]
                require(relative.split('/')[0] in MEMBERS and Path(relative).name not in AUTHORITY, 'Unexpected diagnostic payload')
                path = destination / relative
                if member.isdir():
                    path.mkdir(parents=True, exist_ok=True)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with t.extractfile(member) as source:
                        files[relative] = hashed_copy(source, path, member.size)
                    require(files[relative]['bytes'] == member.size, 'Truncated diagnostic member')
        nested.unlink()
    require(metadata is not None and metadata.get('files') == files, 'Diagnostic inventory differs from original metadata')
    require(metadata.get('status') == 'UNAPPROVED' and metadata.get('publication_authority') == 'none' and metadata.get('design_accepted') is False and metadata.get('activation_eligible') is False, 'Diagnostic claims authority')
    require(metadata.get('producer') == sidecar.get('producer') and metadata.get('preview_receipt_sha256') == sidecar.get('preview_receipt_sha256'), 'Diagnostic sidecar disagreement')
    return metadata

def read_design(zip_path, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    pictures, report, provenance, seen, total = {}, None, None, set(), 0
    with zipfile.ZipFile(zip_path) as z:
        for member in z.infolist():
            name = member.filename.rstrip('/')
            require(safe(name) and name not in seen and not stat.S_ISLNK(member.external_attr >> 16), 'Unsafe design ZIP member')
            seen.add(name)
            total += member.file_size
            require(len(seen) <= MAX_FILES and total <= MAX_BYTES, 'Design artifact exceeds bound')
            if member.is_dir():
                continue
            if name.endswith('/design-review/report.json'):
                require(report is None and member.file_size <= 32 * 1024 * 1024, 'Missing or ambiguous report')
                report = z.read(member)
            elif name.endswith('/design-input-provenance.json') or name == 'design-input-provenance.json':
                require(provenance is None and member.file_size <= 4 * 1024 * 1024, 'Ambiguous input provenance')
                provenance = z.read(member)
            elif '/design-review/' in name and name.endswith('.png'):
                relative = name.split('/design-review/', 1)[1]
                require(relative not in pictures and '/' not in relative, 'Unexpected screenshot path')
                h = hashlib.sha256()
                with z.open(member) as source:
                    while chunk := source.read(1024 * 1024):
                        h.update(chunk)
                pictures[relative] = h.hexdigest()
    require(report is not None and provenance is not None, 'Exact Design report/input provenance missing')
    (destination / 'report.json').write_bytes(report)
    (destination / 'design-input-provenance.json').write_bytes(provenance)
    (destination / 'screenshots.json').write_text(json.dumps(pictures, sort_keys=True))
    return pictures

if __name__ == '__main__':
    if sys.argv[1] == 'diagnostic':
        extract_diagnostic(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'design':
        read_design(sys.argv[2], sys.argv[3])
    else:
        raise ValueError('Expected diagnostic or design')
