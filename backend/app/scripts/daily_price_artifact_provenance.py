"""Bind immutable Actions artifact IDs to the actual producer attempt."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def checksum(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def inventory(root, paths):
    output = {}
    for name in paths:
        if not isinstance(name, str) or name.startswith('/') or any(part in ('', '.', '..') for part in name.split('/')):
            raise ValueError('Unsafe producer input path')
        path = root / name
        for parent in [path, *path.parents]:
            if parent == root:
                break
            if parent.is_symlink():
                raise ValueError('Linked producer input')
        if not path.is_file():
            raise ValueError('Missing producer input')
        output[name] = checksum(path)
    return output


def producer_record(role, root, paths, *, repository, run_id, run_attempt, head_sha):
    if role not in ('candidate', 'downstream') or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid producer role/repository')
    if type(run_id) is not int or run_id <= 0 or type(run_attempt) is not int or run_attempt <= 0 or not re.fullmatch(r'[a-f0-9]{40}', head_sha):
        raise ValueError('Invalid producer run identity')
    return {'schema_version': 'daily-price-artifact-producer-v1', 'role': role,
            'repository': repository, 'run_id': run_id, 'run_attempt': run_attempt,
            'head_sha': head_sha, 'files': inventory(root, paths)}


def verify_producer_artifact(metadata, record, *, artifact_id, artifact_digest, role,
                             repository, run_id, producer_attempt, head_sha, root):
    # The consumer's attempt is deliberately not an input. A failed-job rerun
    # can correctly consume a successful candidate from producer attempt 1.
    expected = producer_record(role, root, list(record.get('files', {})), repository=repository,
                               run_id=run_id, run_attempt=producer_attempt, head_sha=head_sha)
    paths = set(expected['files'])
    if role == 'candidate':
        bundles = [name for name in paths if re.fullmatch(r'daily-price/daily-price-us-\d{8}\.json\.gz', name)]
        required = {'daily-price/daily-price-latest-us.json', 'daily-price-promotion/previous.json'}
        if len(bundles) != 1 or paths != required | set(bundles):
            raise ValueError('Incomplete candidate producer closure')
    elif paths != {'daily-source-downstream.json'}:
        raise ValueError('Incomplete downstream producer closure')
    if record != expected or not record['files']:
        raise ValueError('Producer provenance or input bytes changed')
    if type(artifact_id) is not int or artifact_id <= 0:
        raise ValueError('No produced immutable artifact ID')
    digest = artifact_digest.removeprefix('sha256:')
    if not re.fullmatch(r'[a-f0-9]{64}', digest) or metadata.get('digest') != f'sha256:{digest}':
        raise ValueError('Immutable artifact digest changed')
    name = (f'daily-source-candidate-US-{run_id}-{producer_attempt}' if role == 'candidate'
            else f'daily-source-downstream-{run_id}-{producer_attempt}')
    producer = metadata.get('workflow_run', {})
    if metadata.get('id') != artifact_id or metadata.get('name') != name or metadata.get('expired') is not False or producer.get('id') != run_id or producer.get('head_sha') != head_sha:
        raise ValueError('Artifact is not the exact successful producer output')
    return {'artifact_id': artifact_id, 'artifact_sha256': digest, 'producer': record}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('record', 'verify'))
    parser.add_argument('--role', required=True, choices=('candidate', 'downstream'))
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--record', type=Path, required=True)
    parser.add_argument('--paths', nargs='*', default=[])
    parser.add_argument('--artifact-id', type=int)
    parser.add_argument('--artifact-digest')
    parser.add_argument('--producer-attempt', type=int)
    args = parser.parse_args()
    repository = os.environ['GITHUB_REPOSITORY']; run_id = int(os.environ['GITHUB_RUN_ID'])
    head_sha = os.environ['GITHUB_SHA']
    if args.command == 'record':
        paths = args.paths
        if args.role == 'candidate':
            paths = sorted(path.relative_to(args.root).as_posix() for path in (args.root / 'daily-price').glob('*') if path.is_file())
            previous = args.root / 'daily-price-promotion/previous.json'
            if previous.exists(): paths.append(previous.relative_to(args.root).as_posix())
        value = producer_record(args.role, args.root, paths, repository=repository, run_id=run_id,
                                run_attempt=int(os.environ['GITHUB_RUN_ATTEMPT']), head_sha=head_sha)
        args.record.parent.mkdir(parents=True, exist_ok=True)
        args.record.write_text(json.dumps(value, sort_keys=True))
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f"producer_attempt={value['run_attempt']}\n")
    else:
        metadata = json.loads(subprocess.check_output(['gh', 'api', f'repos/{repository}/actions/artifacts/{args.artifact_id}']))
        record = json.loads(args.record.read_text())
        verified = verify_producer_artifact(metadata, record, artifact_id=args.artifact_id,
            artifact_digest=args.artifact_digest, role=args.role, repository=repository,
            run_id=run_id, producer_attempt=args.producer_attempt, head_sha=head_sha, root=args.root)
        print(json.dumps({'verified_artifact_id': verified['artifact_id'], 'producer_attempt': record['run_attempt']}))


if __name__ == '__main__':
    main()
