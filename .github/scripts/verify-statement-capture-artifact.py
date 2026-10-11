"""Read the actual capture upload back; byte retention confers no financial authority.

The inherited ZIP verifier is imported unchanged. This wrapper alone owns the new
capture caller, input identities, hosted artifact ownership and whole-job clock.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import stat
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location(
    '_capture_inherited_readback', Path(__file__).with_name('verify-successor-artifact.py'))
_LEGACY = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_LEGACY)
# Never mutate the inherited module's globals or invoke its historical context gate.
verify_archive = _LEGACY.verify_archive
parse, sha, require = _LEGACY.parse, _LEGACY.sha, _LEGACY.require
MAX_ZIP = _LEGACY.MAX_ZIP
REPOSITORY = 'kusennjp1-ai/screener'
REPOSITORY_ID = 1203919607
WORKFLOW = '.github/workflows/financial-statement-capture.yml'
BRANCH = 'improve/financial-statement-capture'
JOB = 'statement-capture'
REQUEST_ID = 'first-cnh-esta-annual-history'
INPUT_ROOT = Path('.github/financial-statement-capture')
MAX_JOB_SECONDS = 1500
EMPTY_SHA = hashlib.sha256(b'').hexdigest()


def utc_now():
    return datetime.now(timezone.utc)


def clock(value):
    require(isinstance(value, str) and value.endswith('Z'), 'Explicit UTC clock required')
    result = datetime.fromisoformat(value[:-1] + '+00:00')
    require(result.utcoffset() == timedelta(0), 'UTC clock required')
    return result


def hex_digest(value):
    require(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value), 'Invalid SHA-256 identity')
    return value


def safe_ancestry(path):
    path = Path(os.path.abspath(path))
    for parent in reversed((path, *path.parents)):
        if parent.exists() or parent.is_symlink():
            info = parent.lstat()
            require(not stat.S_ISLNK(info.st_mode), 'Linked readback path')
            if parent != path:
                require(stat.S_ISDIR(info.st_mode), 'Non-directory readback ancestor')
    return path


def file_identity(value):
    return (value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
            value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def read_input(path, maximum):
    path = safe_ancestry(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 <= before.st_size <= maximum,
            'Unsafe or oversized readback input')
    with path.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        content = stream.read(maximum + 1)
    after = path.lstat()
    require(file_identity(before) == file_identity(opened) == file_identity(after) and len(content) == before.st_size,
            'Readback input changed during read')
    return content, file_identity(after)


def output_locations(inventory_path, output_path, upload_root, *, result_created=False):
    upload_root = safe_ancestry(upload_root)
    require(upload_root.is_dir(), 'Missing retained upload root')
    for path in (inventory_path, output_path):
        path = safe_ancestry(path)
        require(path != upload_root and upload_root not in path.parents,
                'Readback inventory and output must be outside the upload root')
    require(Path(inventory_path).absolute() != Path(output_path).absolute(), 'Output would replace inventory')
    require(result_created or (not Path(output_path).exists() and not Path(output_path).is_symlink()),
            'Readback output already exists')
    require(Path(output_path).parent.is_dir(), 'Readback output parent must already exist')
    return tuple((str(p), p.lstat().st_dev, p.lstat().st_ino) for p in
                 (upload_root, *upload_root.parents, Path(output_path).absolute().parent,
                  *Path(output_path).absolute().parent.parents))


class Budget:
    def __init__(self, started_at, *, now=utc_now, monotonic=time.monotonic):
        self.now, self.monotonic = now, monotonic
        self.started = clock(started_at)
        self.actual_start = None
        self.origin, self.monotonic_origin = now(), monotonic()
        self.deadline = self.started + timedelta(seconds=MAX_JOB_SECONDS)
        self.check()

    def check(self):
        now = self.now()
        elapsed = self.monotonic() - self.monotonic_origin
        require(self.started <= self.origin <= now < self.deadline and elapsed >= 0
                and elapsed < (self.deadline - self.origin).total_seconds(),
                'Actual capture job exceeded its 1500-second bound or clock regressed')
        return min((self.deadline - now).total_seconds(),
                   (self.deadline - self.origin).total_seconds() - elapsed)

    def authenticate_start(self, value):
        actual = clock(value)
        require(self.actual_start is None or actual == self.actual_start, 'Authenticated hosted job start changed')
        self.actual_start = actual
        require(actual <= self.started <= actual + timedelta(seconds=60),
                'First-step clock does not bind actual hosted job start')
        self.deadline = actual + timedelta(seconds=MAX_JOB_SECONDS)
        self.check()


class GitHubTransport:
    """Bounded subprocess I/O; tests supply an offline transport instead."""
    def _run(self, arguments, *, maximum, timeout, sink=None):
        result = bytearray()
        deadline = time.monotonic() + timeout
        process = subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        count = 0
        try:
            while True:
                remaining = deadline - time.monotonic()
                require(remaining > 0, 'Readback operation timed out')
                require(selector.select(remaining), 'Readback operation timed out')
                chunk = os.read(process.stdout.fileno(), 1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                require(count <= maximum, 'Readback response exceeds size bound')
                if sink is None:
                    result.extend(chunk)
                else:
                    sink.write(chunk)
            code = process.wait(timeout=max(0.001, deadline - time.monotonic()))
            require(code == 0, 'GitHub readback operation failed')
            return bytes(result)
        finally:
            selector.close()
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()

    def api(self, path, *, timeout):
        return parse(self._run(['gh', 'api', path], maximum=2 * 1024 * 1024, timeout=timeout))

    def download(self, path, destination, *, timeout):
        with destination.open('xb') as sink:
            self._run(['gh', 'api', path], maximum=MAX_ZIP, timeout=timeout, sink=sink)


def expected_context(environment):
    fixed = {'GITHUB_REPOSITORY': REPOSITORY, 'GITHUB_REPOSITORY_ID': str(REPOSITORY_ID),
             'GITHUB_REF_NAME': BRANCH, 'GITHUB_REF': 'refs/heads/' + BRANCH,
             'GITHUB_EVENT_NAME': 'push', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_RUN_NUMBER': '1',
             'GITHUB_JOB': JOB, 'GITHUB_WORKFLOW_REF': REPOSITORY + '/' + WORKFLOW + '@refs/heads/' + BRANCH}
    require(all(environment.get(key) == value for key, value in fixed.items()), 'Wrong capture readback context')
    require(re.fullmatch(r'[1-9][0-9]*', environment.get('GITHUB_RUN_ID', ''))
            and re.fullmatch(r'[a-f0-9]{40}', environment.get('GITHUB_SHA', '')), 'Unbound capture run or commit')
    return {'id': int(environment['GITHUB_RUN_ID']), 'head_sha': environment['GITHUB_SHA']}


def validate_inputs(envelope, request, admission, lock, hashes, context):
    keys = {'schema_version', 'request_sha256', 'admission_sha256', 'runtime_lock_sha256',
            'run_id', 'run_attempt', 'head_sha', 'job_started_at', 'retained_inventory'}
    require(isinstance(envelope, dict) and set(envelope) == keys
            and envelope['schema_version'] == 'financial-statement-capture-retained-inventory-v1',
            'Closed capture retained inventory required')
    require(all(envelope[key + '_sha256'] == hashes[key] for key in ('request', 'admission', 'runtime_lock')),
            'Capture input identity differs from retained inventory')
    require(type(envelope['run_id']) is int and envelope['run_id'] == context['id']
            and type(envelope['run_attempt']) is int and envelope['run_attempt'] == 1
            and envelope['head_sha'] == context['head_sha'], 'Retained inventory belongs to another attempt')
    require(isinstance(request, dict) and request.get('request_id') == REQUEST_ID,
            'Wrong capture request identity')
    fixed = {'schema_version': 'financial-statement-capture-admission-v1', 'request_id': REQUEST_ID,
             'execution_enabled': True, 'repository': REPOSITORY, 'repository_id': REPOSITORY_ID,
             'workflow': WORKFLOW, 'branch': BRANCH, 'event': 'push', 'expected_run_number': 1,
             'first_attempt_only': True, 'request_sha256': hashes['request'],
             'runtime_lock_sha256': hashes['runtime_lock'], 'maximum_job_seconds': MAX_JOB_SECONDS,
             'finalization_reserve_seconds': 420, 'maximum_preflight_age_seconds': 30}
    extras = {'workflow_id', 'code_tree_sha256', 'dispatch_not_before', 'dispatch_not_after', 'required_valid_through'}
    require(isinstance(admission, dict) and set(admission) == set(fixed) | extras
            and all(type(admission[key]) is type(value) and admission[key] == value for key, value in fixed.items()),
            'Capture admission identity, permission or bounds changed')
    require(admission['workflow_id'] is None or (type(admission['workflow_id']) is int and admission['workflow_id'] > 0),
            'Invalid capture workflow identity')
    hex_digest(admission['code_tree_sha256'])
    require(clock(admission['dispatch_not_before']) < clock(admission['dispatch_not_after'])
            <= clock(admission['required_valid_through']), 'Invalid capture admission clocks')
    require(isinstance(lock, dict) and lock.get('schema_version') == 'financial-statement-capture-runtime-lock-v1'
            and isinstance(lock.get('files'), dict) and lock['files'], 'Missing capture runtime closure')
    required = {'.github/scripts/verify-statement-capture-artifact.py', '.github/scripts/verify-successor-artifact.py',
                '.github/scripts/run-statement-capture.py', WORKFLOW}
    require(required <= set(lock['files']), 'Readback and inherited helper must be runtime-locked')
    retained = envelope['retained_inventory']
    require(isinstance(retained, dict) and isinstance(retained.get('files'), dict)
            and retained['files'].get('archive/.archive.lock') == {'bytes': 0, 'sha256': EMPTY_SHA},
            'Exact empty hidden archive lock must be retained')
    for key, filename in (('request', 'capture-request.json'), ('admission', 'capture-admission.json'),
                          ('runtime_lock', 'capture-runtime-lock.json')):
        binding = retained['files'].get(filename, {})
        require(binding.get('sha256') == hashes[key], 'Retained capture control snapshot identity changed')
    return retained


def validate_hosted(repository, workflow, run, attempt, jobs, context, admission, budget):
    require(repository.get('id') == REPOSITORY_ID and repository.get('full_name') == REPOSITORY,
            'Hosted repository identity changed')
    require(type(workflow.get('id')) is int and workflow['id'] > 0 and workflow.get('path') == WORKFLOW
            and workflow.get('state') == 'active'
            and (admission['workflow_id'] is None or admission['workflow_id'] == workflow['id']),
            'Hosted workflow identity changed')
    compared = ('id', 'head_sha', 'run_attempt', 'run_number', 'workflow_id', 'path', 'head_branch',
                'event', 'status', 'conclusion', 'run_started_at', 'repository', 'head_repository')
    require(all(run.get(key) == attempt.get(key) for key in compared), 'Current run and attempt endpoint disagree')
    for value in (run, attempt):
        require(type(value.get('id')) is int and value['id'] == context['id']
                and value.get('head_sha') == context['head_sha']
                and type(value.get('run_attempt')) is int and value['run_attempt'] == 1
                and type(value.get('run_number')) is int and value['run_number'] == 1
                and value.get('workflow_id') == workflow['id'] and value.get('path') == WORKFLOW
                and value.get('head_branch') == BRANCH and value.get('event') == 'push'
                and value.get('status') == 'in_progress' and value.get('conclusion') is None,
                'Hosted capture is not this first in-progress attempt')
        for key in ('repository', 'head_repository'):
            require(value.get(key, {}).get('id') == REPOSITORY_ID
                    and value.get(key, {}).get('full_name') == REPOSITORY, 'Hosted run repository changed')
    require(isinstance(jobs, dict) and type(jobs.get('total_count')) is int and jobs['total_count'] == 1
            and isinstance(jobs.get('jobs'), list) and len(jobs['jobs']) == 1, 'Incomplete or unexpected hosted job inventory')
    job = jobs['jobs'][0]
    require(type(job.get('id')) is int and job['id'] > 0 and job.get('name') == JOB
            and job.get('run_id') == context['id'] and type(job.get('run_attempt')) is int
            and job['run_attempt'] == 1 and job.get('head_sha') == context['head_sha']
            and job.get('status') == 'in_progress' and job.get('conclusion') is None,
            'Hosted job does not bind this capture attempt')
    require(clock(run.get('run_started_at')) <= clock(job.get('started_at')), 'Hosted job predates current attempt')
    budget.authenticate_start(job.get('started_at'))
    return {'job_id': job['id'], 'workflow_id': workflow['id'],
            'actual_job_started_at': job['started_at'], 'run_started_at': run['run_started_at']}


def validate_artifact(artifact, context, artifact_id, digest, budget):
    require(type(artifact_id) is int and artifact_id > 0, 'Positive upload artifact ID required')
    digest = hex_digest(digest.removeprefix('sha256:'))
    owner = artifact.get('workflow_run', {})
    require(type(artifact.get('id')) is int and artifact['id'] == artifact_id and artifact.get('expired') is False
            and artifact.get('name') == f"financial-statement-capture-{context['head_sha']}-1"
            and artifact.get('digest') == 'sha256:' + digest
            and type(artifact.get('size_in_bytes')) is int and 0 < artifact['size_in_bytes'] <= MAX_ZIP
            and owner.get('id') == context['id'] and owner.get('head_sha') == context['head_sha']
            and owner.get('head_branch') == BRANCH and owner.get('repository_id') == REPOSITORY_ID
            and owner.get('head_repository_id') == REPOSITORY_ID,
            'Actual capture upload metadata, digest or owner changed')
    require(budget.started <= clock(artifact.get('created_at')) <= budget.now(), 'Artifact is outside this attempt interval')
    require(clock(artifact.get('expires_at')) > budget.now(), 'Uploaded capture artifact is expired')
    budget.check()
    return digest


def git_identity(repo, context, admission, *, timeout, checkpoint=None, runtime_files=()):
    head = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'], check=True,
                          capture_output=True, timeout=timeout).stdout.decode().strip()
    if checkpoint:
        timeout = min(timeout, checkpoint())
    require(head == context['head_sha'], 'Checkout does not match authenticated capture commit')
    raw = subprocess.run(['git', '-C', str(repo), 'ls-tree', '-rz', '--full-tree', 'HEAD'], check=True,
                         capture_output=True, timeout=timeout).stdout
    if checkpoint:
        checkpoint()
    records, committed = [], {}
    for item in raw.split(b'\0'):
        if not item:
            continue
        meta, name = item.split(b'\t', 1)
        mode, kind, blob = meta.decode('ascii').split()
        relative = name.decode('utf-8')
        require(kind == 'blob' and mode in ('100644', '100755'), 'Capture code tree contains an unsafe file entry')
        committed[relative] = (mode, blob)
        if relative != str(INPUT_ROOT / 'admission.json'):
            records.append([relative, mode, blob])
    records.sort()
    identity = sha(json.dumps(records, separators=(',', ':'), ensure_ascii=False).encode())
    require(identity == admission['code_tree_sha256'], 'Hosted capture code tree differs from admission')
    required = set(runtime_files) | {str(INPUT_ROOT / name) for name in ('request.json', 'admission.json', 'runtime-lock.json')}
    for relative in sorted(required):
        require(relative in committed, 'Capture control/runtime file is not in authenticated commit')
        content, snapshot = read_input(repo / relative, 32 * 1024 * 1024)
        mode = '100755' if snapshot[2] & stat.S_IXUSR else '100644'
        blob = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
        require(committed[relative] == (mode, blob), 'Capture working file differs from authenticated commit')
    if checkpoint:
        checkpoint()


def run_readback(inventory_path, artifact_id, artifact_digest, output_path, upload_root, *,
                 request_path=None, admission_path=None, runtime_lock_path=None, repo=ROOT,
                 environment=None, transport=None, now=utc_now, monotonic=time.monotonic):
    live_environment = os.environ if environment is None else environment
    environment = dict(live_environment)
    context = expected_context(environment)
    paths = {'inventory': Path(inventory_path), 'request': Path(request_path or repo / INPUT_ROOT / 'request.json'),
             'admission': Path(admission_path or repo / INPUT_ROOT / 'admission.json'),
             'runtime_lock': Path(runtime_lock_path or repo / INPUT_ROOT / 'runtime-lock.json')}
    for key, name in (('request', 'request.json'), ('admission', 'admission.json'), ('runtime_lock', 'runtime-lock.json')):
        require(paths[key].absolute() == (repo / INPUT_ROOT / name).absolute(), 'Unreviewed capture input path')
    maxima = {'inventory': 16 * 1024 * 1024, 'request': 2 * 1024 * 1024,
              'admission': 128 * 1024, 'runtime_lock': 2 * 1024 * 1024}
    snapshots = {key: read_input(path, maxima[key]) for key, path in paths.items()}
    values = {key: parse(value[0]) for key, value in snapshots.items()}
    hashes = {key: sha(value[0]) for key, value in snapshots.items()}
    retained = validate_inputs(values['inventory'], values['request'], values['admission'],
                               values['runtime_lock'], hashes, context)
    require(environment.get('CAPTURE_JOB_STARTED_AT') == values['inventory']['job_started_at'],
            'Inventory and actual first-step clocks differ')
    budget = Budget(values['inventory']['job_started_at'], now=now, monotonic=monotonic)
    location_identity = output_locations(inventory_path, output_path, upload_root)
    runtime_snapshots = {}
    for relative, digest in values['runtime_lock']['files'].items():
        path = PurePosixPath(relative)
        require(isinstance(relative, str) and not path.is_absolute() and '\\' not in relative
                and all(part not in ('', '.', '..') for part in relative.split('/')), 'Unsafe capture runtime path')
        hex_digest(digest)
        snapshot = read_input(repo / relative, 32 * 1024 * 1024)
        require(sha(snapshot[0]) == digest, 'Capture runtime bytes differ from reviewed lock')
        runtime_snapshots[relative] = snapshot
    transport = transport or GitHubTransport()

    def checkpoint(*, result_created=False):
        budget.check()
        require(expected_context(live_environment) == context
                and live_environment.get('CAPTURE_JOB_STARTED_AT') == values['inventory']['job_started_at'],
                'Readback context changed')
        require(output_locations(inventory_path, output_path, upload_root, result_created=result_created) == location_identity,
                'Readback output or upload-root identity changed')
        for key, path in paths.items():
            require(read_input(path, maxima[key]) == snapshots[key], 'Capture input changed during readback')
        for relative, snapshot in runtime_snapshots.items():
            require(read_input(repo / relative, 32 * 1024 * 1024) == snapshot, 'Capture runtime changed during readback')
        return budget.check()

    def api(path):
        checkpoint()
        result = transport.api(path, timeout=min(60, budget.check()))
        checkpoint()
        require(isinstance(result, dict), 'Malformed GitHub metadata response')
        return result

    checkpoint()
    git_identity(repo, context, values['admission'], timeout=min(30, budget.check()), checkpoint=checkpoint,
                 runtime_files=runtime_snapshots)
    checkpoint()
    base = f'repos/{REPOSITORY}'

    def hosted():
        repository = api(base)
        workflow = api(base + '/actions/workflows/financial-statement-capture.yml')
        current = api(base + f"/actions/runs/{context['id']}")
        attempt = api(base + f"/actions/runs/{context['id']}/attempts/1")
        jobs = api(base + f"/actions/runs/{context['id']}/attempts/1/jobs?per_page=100")
        hosted_identity = validate_hosted(repository, workflow, current, attempt, jobs, context, values['admission'], budget)
        artifact = api(base + f'/actions/artifacts/{artifact_id}')
        digest = validate_artifact(artifact, context, artifact_id, artifact_digest, budget)
        checkpoint()
        return hosted_identity, artifact, digest

    hosted_identity, artifact, digest = hosted()
    with tempfile.TemporaryDirectory(prefix='capture-upload-readback-') as directory:
        path = Path(directory) / 'actual-actions.zip'
        checkpoint()
        transport.download(base + f'/actions/artifacts/{artifact_id}/zip', path, timeout=min(120, budget.check()))
        checkpoint()
        require(path.lstat().st_size == artifact['size_in_bytes'], 'Actual upload size differs from hosted metadata')
        result = verify_archive(path, retained, digest)
        checkpoint()
        require(result['hidden_lock_retained'] is True, 'Uploaded capture lost its hidden lock')
    final_identity, final_artifact, final_digest = hosted()
    require(final_identity == hosted_identity and final_artifact == artifact and final_digest == digest,
            'Hosted capture or artifact changed during readback')
    git_identity(repo, context, values['admission'], timeout=min(30, budget.check()), checkpoint=checkpoint,
                 runtime_files=runtime_snapshots)
    checkpoint()
    result = {'schema_version': 'financial-statement-capture-artifact-readback-v1', 'request_id': REQUEST_ID,
              'artifact_id': artifact_id, 'artifact_name': artifact['name'], 'artifact_digest': 'sha256:' + digest,
              'run_id': context['id'], 'run_attempt': 1, 'head_sha': context['head_sha'], **hosted_identity,
              'repository': REPOSITORY, 'repository_id': REPOSITORY_ID, 'workflow': WORKFLOW,
              'branch': BRANCH, 'event': 'push', 'code_tree_sha256': values['admission']['code_tree_sha256'],
              'request_sha256': hashes['request'], 'admission_sha256': hashes['admission'],
              'runtime_lock_sha256': hashes['runtime_lock'], 'inventory_sha256': hashes['inventory'],
              'job_started_at': values['inventory']['job_started_at'],
              'observed_at': now().isoformat().replace('+00:00', 'Z'), 'byte_verification': result,
              'final_retention_verified': retained['final_retention_verified'],
              'phase': 'uploaded_artifact_readback', 'readback_provider_requests': 0,
              'financial_admission': False, 'publication_authority': 'none'}
    content = json.dumps(result, sort_keys=True, indent=2).encode() + b'\n'
    checkpoint()
    # Hold the owned inode through final checks. A rejected renamed output must
    # not survive as detached success evidence, and cleanup never owns a replacement.
    descriptor = None
    directory_fd = os.open(Path(output_path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        checkpoint()
        descriptor = os.open(Path(output_path).name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory_fd)
        offset = 0
        while offset < len(content):
            written = os.write(descriptor, content[offset:])
            require(written > 0, 'Readback result write was incomplete')
            offset += written
            budget.check()
        os.fsync(descriptor)
        created_identity = file_identity(os.fstat(descriptor))
        checkpoint(result_created=True)
        require(read_input(output_path, 2 * 1024 * 1024) == (content, created_identity),
                'Readback output identity changed')
        budget.check()
    except BaseException:
        if descriptor is not None:
            owned = os.fstat(descriptor)
            os.ftruncate(descriptor, 0)
            try:
                named = os.stat(Path(output_path).name, dir_fd=directory_fd, follow_symlinks=False)
                if (named.st_dev, named.st_ino) == (owned.st_dev, owned.st_ino):
                    os.unlink(Path(output_path).name, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        raise
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(directory_fd)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--artifact-id', type=int, required=True)
    parser.add_argument('--artifact-digest', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--upload-root', type=Path, required=True)
    parser.add_argument('--request', type=Path)
    parser.add_argument('--admission', type=Path)
    parser.add_argument('--runtime-lock', type=Path)
    args = parser.parse_args()
    result = run_readback(args.inventory, args.artifact_id, args.artifact_digest, args.output, args.upload_root,
                          request_path=args.request, admission_path=args.admission, runtime_lock_path=args.runtime_lock)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
