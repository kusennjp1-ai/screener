"""Synthetic hosted metadata and ZIP fixtures: no network or provider construction."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import zipfile

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('capture_readback', ROOT / '.github/scripts/verify-statement-capture-artifact.py')
readback = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readback)
START = '2026-10-11T14:00:00Z'
FIRST_STEP = '2026-10-11T14:00:02Z'
NOW = datetime(2026, 10, 11, 14, 20, tzinfo=timezone.utc)

FAILED_STEPS = [{'name': 'Set up job',
  'status': 'completed',
  'conclusion': 'success',
  'number': 1,
  'started_at': '2026-10-11T12:52:14Z',
  'completed_at': '2026-10-11T12:52:16Z'},
 {'name': 'Start the actual bounded job clock',
  'status': 'completed',
  'conclusion': 'success',
  'number': 2,
  'started_at': '2026-10-11T12:52:16Z',
  'completed_at': '2026-10-11T12:52:16Z'},
 {'name': 'Run actions/checkout@v4',
  'status': 'completed',
  'conclusion': 'success',
  'number': 3,
  'started_at': '2026-10-11T12:52:16Z',
  'completed_at': '2026-10-11T12:52:18Z'},
 {'name': 'Run actions/setup-node@v4',
  'status': 'completed',
  'conclusion': 'success',
  'number': 4,
  'started_at': '2026-10-11T12:52:18Z',
  'completed_at': '2026-10-11T12:52:19Z'},
 {'name': 'Run actions/setup-python@v5',
  'status': 'completed',
  'conclusion': 'success',
  'number': 5,
  'started_at': '2026-10-11T12:52:19Z',
  'completed_at': '2026-10-11T12:52:19Z'},
 {'name': 'Install the reviewed anonymous statement transport',
  'status': 'completed',
  'conclusion': 'success',
  'number': 6,
  'started_at': '2026-10-11T12:52:19Z',
  'completed_at': '2026-10-11T12:52:27Z'},
 {'name': 'Verify capture boundaries with offline fixtures',
  'status': 'completed',
  'conclusion': 'success',
  'number': 7,
  'started_at': '2026-10-11T12:52:27Z',
  'completed_at': '2026-10-11T12:52:37Z'},
 {'name': 'Restore the exact authenticated unadmitted predecessor',
  'status': 'completed',
  'conclusion': 'failure',
  'number': 8,
  'started_at': '2026-10-11T12:52:37Z',
  'completed_at': '2026-10-11T12:52:40Z'},
 {'name': 'Capture the exact separately admitted annual-history batch',
  'status': 'completed',
  'conclusion': 'skipped',
  'number': 9,
  'started_at': '2026-10-11T12:52:40Z',
  'completed_at': '2026-10-11T12:52:40Z'},
 {'name': 'Retain all original and partial evidence including the empty lock',
  'status': 'completed',
  'conclusion': 'failure',
  'number': 10,
  'started_at': '2026-10-11T12:52:40Z',
  'completed_at': '2026-10-11T12:52:40Z'},
 {'name': 'Read back the actual uploaded artifact or fail closed',
  'status': 'completed',
  'conclusion': 'failure',
  'number': 11,
  'started_at': '2026-10-11T12:52:40Z',
  'completed_at': '2026-10-11T12:52:40Z'},
 {'name': 'Retain external inventory preflight and readback proof',
  'status': 'completed',
  'conclusion': 'failure',
  'number': 12,
  'started_at': '2026-10-11T12:52:40Z',
  'completed_at': '2026-10-11T12:52:40Z'},
 {'name': 'Post Run actions/setup-python@v5',
  'status': 'completed',
  'conclusion': 'skipped',
  'number': 22,
  'started_at': '2026-10-11T12:52:40Z',
  'completed_at': '2026-10-11T12:52:40Z'},
 {'name': 'Post Run actions/setup-node@v4',
  'status': 'completed',
  'conclusion': 'skipped',
  'number': 23,
  'started_at': '2026-10-11T12:52:40Z',
  'completed_at': '2026-10-11T12:52:40Z'},
 {'name': 'Post Run actions/checkout@v4',
  'status': 'completed',
  'conclusion': 'success',
  'number': 24,
  'started_at': '2026-10-11T12:52:40Z',
  'completed_at': '2026-10-11T12:52:41Z'},
 {'name': 'Complete job',
  'status': 'completed',
  'conclusion': 'success',
  'number': 25,
  'started_at': '2026-10-11T12:52:41Z',
  'completed_at': '2026-10-11T12:52:41Z'}]

def failed_metadata():
    binding = readback.RECOVERY_BINDING
    repository = {'id': readback.REPOSITORY_ID, 'full_name': readback.REPOSITORY}
    run = {'id': binding['run_id'], 'run_number': 1, 'run_attempt': 1,
           'repository': repository, 'head_repository': repository, 'workflow_id': readback.WORKFLOW_ID,
           'path': readback.WORKFLOW, 'event': 'push', 'head_branch': readback.BRANCH,
           'head_sha': binding['head_sha'],
           'head_commit': {'id': binding['head_sha'], 'tree_id': binding['tree_sha']},
           'status': 'completed', 'conclusion': 'failure', 'created_at': binding['run_created_at'],
           'run_started_at': binding['run_started_at'], 'updated_at': binding['run_updated_at']}
    attempt = deepcopy(run)
    attempt.update(created_at=binding['attempt_created_at'], updated_at=binding['attempt_updated_at'])
    commit = {'sha': binding['head_sha'], 'tree': {'sha': binding['tree_sha']},
              'parents': [{'sha': binding['parent_sha']}]}
    job = {'id': binding['job_id'], 'run_id': binding['run_id'], 'run_attempt': 1,
           'head_sha': binding['head_sha'], 'name': readback.JOB, 'status': 'completed',
           'conclusion': 'failure', 'started_at': binding['job_started_at'],
           'completed_at': binding['job_completed_at'], 'steps': deepcopy(FAILED_STEPS)}
    artifacts = {'total_count': 0, 'artifacts': []}
    proof = {'schema_version': 'financial-statement-capture-recovery-proof-v1', 'binding': deepcopy(binding),
             'run': deepcopy(run), 'attempt': deepcopy(attempt),
             'commit': {'sha': binding['head_sha'], 'tree_sha': binding['tree_sha'], 'parents': [binding['parent_sha']]},
             'job': deepcopy(job), 'artifact_inventory': deepcopy(artifacts)}
    return run, attempt, commit, {'total_count': 1, 'jobs': [job]}, artifacts, proof


def encoded(value):
    return json.dumps(value, sort_keys=True).encode() + b'\n'


class Clock:
    def __init__(self):
        self.current, self.elapsed = NOW, 0

    def now(self):
        return self.current

    def monotonic(self):
        return self.elapsed


class OfflineTransport:
    def __init__(self, metadata, package):
        self.metadata, self.package = metadata, package
        self.calls, self.after_api, self.after_download = [], None, None

    def api(self, path, *, timeout):
        assert 0 < timeout <= 60
        self.calls.append(path)
        result = deepcopy(self.metadata[path])
        if self.after_api:
            self.after_api(path)
        return result

    def download(self, path, destination, *, timeout):
        assert 0 < timeout <= 120
        self.calls.append(path)
        destination.write_bytes(self.package.read_bytes())
        if self.after_download:
            self.after_download(destination)


@pytest.fixture(autouse=True)
def forbid_real_transport(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('This test attempted real subprocess/network access')
    monkeypatch.setattr(readback.subprocess, 'Popen', forbidden)
    monkeypatch.setattr(readback.subprocess, 'run', forbidden)


@pytest.fixture
def capture(tmp_path, monkeypatch):
    repo = tmp_path / 'repo'
    control = repo / readback.INPUT_ROOT
    control.mkdir(parents=True)
    upload = tmp_path / 'upload'
    upload.mkdir()
    verification = tmp_path / 'verification'
    verification.mkdir()
    request = {'schema_version': 'financial-statement-capture-request-v1', 'request_id': readback.REQUEST_ID}
    runtime = {'.github/scripts/verify-statement-capture-artifact.py': b'new producer wrapper',
               '.github/scripts/verify-successor-artifact.py': b'unchanged inherited ZIP verifier',
               '.github/scripts/run-statement-capture.py': b'capture controller',
               readback.WORKFLOW: b'capture workflow', 'backend/app/__init__.py': b''}
    for relative, content in runtime.items():
        path = repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    lock = {'schema_version': 'financial-statement-capture-runtime-lock-v1',
            'files': {name: readback.sha(content) for name, content in runtime.items()}}
    request_bytes, lock_bytes = encoded(request), encoded(lock)
    admission = {'schema_version': 'financial-statement-capture-run2-admission-v1', 'request_id': readback.REQUEST_ID,
                 'execution_enabled': True, 'repository': readback.REPOSITORY, 'repository_id': readback.REPOSITORY_ID,
                 'workflow': readback.WORKFLOW, 'workflow_id': readback.WORKFLOW_ID, 'branch': readback.BRANCH, 'event': 'push',
                 'expected_run_number': 2, 'first_attempt_only': True, 'request_sha256': readback.sha(request_bytes),
                 'runtime_lock_sha256': readback.sha(lock_bytes), 'code_tree_sha256': 'c' * 64,
                 'dispatch_not_before': START, 'dispatch_not_after': '2026-10-11T15:00:00Z',
                 'required_valid_through': '2026-10-11T16:00:00Z', 'maximum_job_seconds': 1500,
                 'finalization_reserve_seconds': 420, 'maximum_preflight_age_seconds': 30,
                 'expected_parent_sha': readback.RECOVERY_BINDING['head_sha'],
                 'recovery': deepcopy(readback.RECOVERY_BINDING)}
    admission_bytes = encoded(admission)
    paths = {'request': control / 'request.json', 'admission': control / 'admission.json',
             'runtime_lock': control / 'runtime-lock.json', 'inventory': verification / 'inventory.json'}
    for key, content in [('request', request_bytes), ('admission', admission_bytes), ('runtime_lock', lock_bytes)]:
        paths[key].write_bytes(content)
    failed_run, failed_attempt, failed_commit, failed_jobs, failed_artifacts, proof = failed_metadata()
    files = {'capture-recovery.json': json.dumps(proof, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode(),
             'archive/.archive.lock': b'', 'archive/manifest.json': b'original source clock',
             'capture-request.json': request_bytes, 'capture-admission.json': admission_bytes,
             'capture-runtime-lock.json': lock_bytes, 'cycle.json': b'partial capture'}
    retained = {'schema_version': 'financial-successor-retained-inventory-v1', 'final_retention_verified': False,
                'files': {name: {'bytes': len(value), 'sha256': readback.sha(value)} for name, value in files.items()}}
    inventory = {'schema_version': 'financial-statement-capture-retained-inventory-v1',
                 'request_sha256': readback.sha(request_bytes), 'admission_sha256': readback.sha(admission_bytes),
                 'runtime_lock_sha256': readback.sha(lock_bytes), 'run_id': 38140913504, 'run_attempt': 1,
                 'head_sha': 'a' * 40, 'job_started_at': FIRST_STEP, 'retained_inventory': retained}
    paths['inventory'].write_bytes(encoded(inventory))
    package = tmp_path / 'uploaded.zip'
    with zipfile.ZipFile(package, 'w') as writer:
        for name, data in files.items():
            writer.writestr(name, data)
    for name, data in files.items():
        target = upload / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    repo_metadata = {'id': readback.REPOSITORY_ID, 'full_name': readback.REPOSITORY}
    run = {'id': 38140913504, 'head_sha': 'a' * 40, 'run_attempt': 1, 'run_number': 2, 'workflow_id': readback.WORKFLOW_ID,
           'path': readback.WORKFLOW, 'head_branch': readback.BRANCH, 'event': 'push',
           'status': 'in_progress', 'conclusion': None, 'run_started_at': START,
           'created_at': START, 'updated_at': '2026-10-11T14:19:00Z',
           'head_commit': {'id': 'a' * 40, 'tree_id': 'c' * 40},
           'repository': repo_metadata, 'head_repository': repo_metadata}
    job = {'id': 901, 'name': readback.JOB, 'run_id': 38140913504, 'run_attempt': 1, 'head_sha': 'a' * 40,
           'status': 'in_progress', 'conclusion': None, 'started_at': START}
    artifact = {'id': 800, 'expired': False, 'name': 'financial-statement-capture-' + 'a' * 40 + '-1',
                'digest': 'sha256:' + readback.sha(package.read_bytes()), 'size_in_bytes': package.stat().st_size,
                'created_at': '2026-10-11T14:19:00Z', 'expires_at': '2026-10-25T14:19:00Z',
                'workflow_run': {'id': 38140913504, 'head_sha': 'a' * 40, 'head_branch': readback.BRANCH,
                                 'repository_id': readback.REPOSITORY_ID, 'head_repository_id': readback.REPOSITORY_ID}}
    base = 'repos/' + readback.REPOSITORY
    metadata = {base: repo_metadata,
                base + '/actions/workflows/financial-statement-capture.yml': {'id': readback.WORKFLOW_ID, 'path': readback.WORKFLOW, 'state': 'active'},
                base + '/actions/runs/38140913504': deepcopy(run), base + '/actions/runs/38140913504/attempts/1': deepcopy(run),
                base + '/actions/runs/38140913504/attempts/1/jobs?per_page=100': {'total_count': 1, 'jobs': [job]},
                base + '/actions/artifacts/800': artifact}
    failed_path = base + '/actions/runs/' + str(readback.RECOVERY_BINDING['run_id'])
    metadata.update({base + '/git/commits/' + 'a' * 40:
                         {'sha': 'a' * 40, 'tree': {'sha': 'c' * 40}, 'parents': [{'sha': readback.RECOVERY_BINDING['head_sha']}]},
                     failed_path: failed_run, failed_path + '/attempts/1': failed_attempt,
                     base + '/git/commits/' + readback.RECOVERY_BINDING['head_sha']: failed_commit,
                     failed_path + '/attempts/1/jobs?per_page=100': failed_jobs,
                     failed_path + '/artifacts?per_page=100': failed_artifacts,
                     base + f'/actions/workflows/{readback.WORKFLOW_ID}/runs?per_page=100':
                         {'total_count': 2, 'workflow_runs': [deepcopy(run), deepcopy(failed_run)]}})
    environment = {'GITHUB_REPOSITORY': readback.REPOSITORY, 'GITHUB_REPOSITORY_ID': str(readback.REPOSITORY_ID),
                   'GITHUB_REF_NAME': readback.BRANCH, 'GITHUB_REF': 'refs/heads/' + readback.BRANCH,
                   'GITHUB_EVENT_NAME': 'push', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_RUN_NUMBER': '2',
                   'GITHUB_JOB': readback.JOB, 'GITHUB_WORKFLOW_REF': readback.REPOSITORY + '/' + readback.WORKFLOW + '@refs/heads/' + readback.BRANCH,
                   'GITHUB_RUN_ID': '38140913504', 'GITHUB_SHA': 'a' * 40, 'CAPTURE_JOB_STARTED_AT': FIRST_STEP}
    monkeypatch.setattr(readback, 'git_identity', lambda *args, **kwargs: None)
    clock = Clock()
    transport = OfflineTransport(metadata, package)
    output = verification / 'readback.json'
    def invoke():
        return readback.run_readback(paths['inventory'], 800, artifact['digest'], output, upload,
                                     repo=repo, environment=environment, transport=transport,
                                     now=clock.now, monotonic=clock.monotonic)
    return {'invoke': invoke, 'paths': paths, 'repo': repo, 'upload': upload, 'output': output,
            'inventory': inventory, 'admission': admission, 'files': files, 'package': package,
            'metadata': metadata, 'artifact': artifact, 'transport': transport, 'clock': clock,
            'environment': environment, 'base': base, 'runtime': runtime, 'proof': proof,
            'failed_path': failed_path, 'failed_run': failed_run, 'failed_attempt': failed_attempt,
            'failed_commit': failed_commit, 'failed_jobs': failed_jobs, 'failed_artifacts': failed_artifacts}


def reject(capture, match=None):
    with pytest.raises((ValueError, OSError, zipfile.BadZipFile, subprocess.TimeoutExpired), match=match):
        capture['invoke']()
    assert not capture['output'].exists()


def test_complete_actual_upload_readback_preserves_partial_retention(capture):
    result = capture['invoke']()
    assert result['final_retention_verified'] is False
    assert result['byte_verification']['final_retention_verified'] is False
    assert result['byte_verification']['hidden_lock_retained'] is True
    assert result['byte_verification']['retained_files'] == len(capture['files'])
    assert result['financial_admission'] is False and result['publication_authority'] == 'none'
    assert result['readback_provider_requests'] == 0 and result['job_id'] == 901
    assert result['phase'] == 'uploaded_artifact_readback' and 'provider_requests' not in result
    assert json.loads(capture['output'].read_bytes()) == result
    assert len(capture['transport'].calls) == 27


def test_successful_retention_bit_is_not_a_financial_certificate(capture):
    capture['inventory']['retained_inventory']['final_retention_verified'] = True
    capture['paths']['inventory'].write_bytes(encoded(capture['inventory']))
    result = capture['invoke']()
    assert result['final_retention_verified'] is True and result['financial_admission'] is False


@pytest.mark.parametrize('key,value', [('GITHUB_RUN_ID', '0'), ('GITHUB_RUN_ATTEMPT', '2'),
    ('GITHUB_RUN_NUMBER', '1'), ('GITHUB_REPOSITORY_ID', '1'), ('GITHUB_REF_NAME', 'main'),
    ('GITHUB_EVENT_NAME', 'workflow_dispatch'), ('GITHUB_SHA', 'bad'), ('GITHUB_JOB', 'other'),
    ('GITHUB_WORKFLOW_REF', 'forged'), ('CAPTURE_JOB_STARTED_AT', START)])
def test_context_is_closed(capture, key, value):
    capture['environment'][key] = value
    reject(capture)
    assert not capture['transport'].calls


@pytest.mark.parametrize('key', ['request', 'admission', 'runtime_lock', 'inventory'])
@pytest.mark.parametrize('phase', ['metadata', 'download'])
def test_every_input_is_rechecked_after_external_work(capture, key, phase):
    def mutate(*args):
        capture['paths'][key].write_bytes(capture['paths'][key].read_bytes() + b' ')
    setattr(capture['transport'], 'after_api' if phase == 'metadata' else 'after_download', mutate)
    reject(capture, 'input changed')


def test_runtime_helper_is_rechecked_after_download(capture):
    capture['transport'].after_download = lambda _: (capture['repo'] / '.github/scripts/verify-successor-artifact.py').write_text('replaced')
    reject(capture, 'runtime changed')


@pytest.mark.parametrize('phase', ['metadata', 'download', 'zip_verification', 'result_write'])
def test_elapsed_job_deadline_cannot_emit_success(capture, monkeypatch, phase):
    def expire(*args):
        capture['clock'].current = NOW + timedelta(seconds=303)
    if phase in ('metadata', 'download'):
        setattr(capture['transport'], 'after_api' if phase == 'metadata' else 'after_download', expire)
    elif phase == 'zip_verification':
        inherited = readback.verify_archive
        def slow_verify(*args):
            result = inherited(*args)
            expire()
            return result
        monkeypatch.setattr(readback, 'verify_archive', slow_verify)
    else:
        monkeypatch.setattr(readback.os, 'fsync', expire)
    reject(capture, '1500-second')


def test_monotonic_budget_cannot_be_evaded_by_frozen_wall_clock(capture):
    capture['transport'].after_download = lambda _: setattr(capture['clock'], 'elapsed', 303)
    reject(capture, '1500-second')


def test_actual_hosted_job_start_overrides_later_caller_clock(capture):
    jobs = capture['metadata'][capture['base'] + '/actions/runs/38140913504/attempts/1/jobs?per_page=100']
    jobs['jobs'][0]['started_at'] = '2026-10-11T13:59:00Z'
    for suffix in ('/actions/runs/38140913504', '/actions/runs/38140913504/attempts/1'):
        capture['metadata'][capture['base'] + suffix]['run_started_at'] = '2026-10-11T13:59:00Z'
    reject(capture, 'actual hosted job start')


@pytest.mark.parametrize('path,key,value', [
    ('/actions/runs/38140913504', 'run_attempt', 2), ('/actions/runs/38140913504', 'head_sha', 'b' * 40),
    ('/actions/runs/38140913504/attempts/1', 'run_number', 1), ('/actions/runs/38140913504/attempts/1', 'status', 'completed'),
    ('/actions/workflows/financial-statement-capture.yml', 'path', '.github/workflows/other.yml'),
    ('/actions/workflows/financial-statement-capture.yml', 'state', 'disabled_manually'),
    ('/actions/runs/38140913504/attempts/1/jobs?per_page=100', 'total_count', 101),
    ('', 'id', 42)])
def test_authenticated_hosted_caller_must_match(capture, path, key, value):
    capture['metadata'][capture['base'] + path][key] = value
    reject(capture)


@pytest.mark.parametrize('key,value', [('id', 801), ('expired', True), ('name', 'other'),
    ('digest', 'sha256:' + 'b' * 64), ('size_in_bytes', True), ('size_in_bytes', 0),
    ('created_at', '2026-10-11T13:59:00Z'), ('expires_at', '2026-10-11T14:19:00Z')])
def test_uploaded_artifact_metadata_is_exact(capture, key, value):
    capture['artifact'][key] = value
    reject(capture)


def test_actual_uploaded_size_must_equal_metadata(capture):
    capture['artifact']['size_in_bytes'] += 1
    reject(capture, 'size differs')


def test_artifact_owner_must_be_current_attempt(capture):
    capture['artifact']['workflow_run']['id'] = 899
    reject(capture, 'owner changed')


def test_changed_metadata_after_download_is_rejected(capture):
    capture['transport'].after_download = lambda _: capture['artifact'].update(expires_at='2026-10-26T14:19:00Z')
    reject(capture, 'changed during readback')


@pytest.mark.parametrize('attack', ['missing_lock', 'changed_lock', 'missing_file', 'extra_file',
    'changed_source_clock', 'duplicate', 'traversal', 'symlink', 'fifo', 'crc'])
def test_exact_whole_zip_and_crc_are_enforced(capture, attack):
    files = dict(capture['files'])
    if attack == 'missing_lock': del files['archive/.archive.lock']
    elif attack == 'changed_lock': files['archive/.archive.lock'] = b'x'
    elif attack == 'missing_file': del files['cycle.json']
    elif attack == 'extra_file': files['unowned'] = b'x'
    elif attack == 'changed_source_clock': files['archive/manifest.json'] = b'changed source clock'
    elif attack == 'traversal': files['../escape'] = b'x'
    with zipfile.ZipFile(capture['package'], 'w') as writer:
        for name, content in files.items(): writer.writestr(name, content)
        if attack == 'duplicate': writer.writestr('cycle.json', files['cycle.json'])
        if attack in ('symlink', 'fifo'):
            info = zipfile.ZipInfo('unsafe')
            info.create_system = 3
            info.external_attr = ((stat.S_IFLNK if attack == 'symlink' else stat.S_IFIFO) | 0o600) << 16
            writer.writestr(info, b'target')
    if attack == 'crc':
        content = capture['package'].read_bytes().replace(b'original source clock', b'original source clocz', 1)
        capture['package'].write_bytes(content)
    capture['artifact']['digest'] = 'sha256:' + readback.sha(capture['package'].read_bytes())
    capture['artifact']['size_in_bytes'] = capture['package'].stat().st_size
    reject(capture)


def test_missing_expected_hidden_lock_fails_before_external_work(capture):
    del capture['inventory']['retained_inventory']['files']['archive/.archive.lock']
    capture['paths']['inventory'].write_bytes(encoded(capture['inventory']))
    reject(capture, 'Exact empty hidden')
    assert not capture['transport'].calls


def test_no_legacy_globals_are_mutated():
    assert readback.verify_archive is readback._LEGACY.verify_archive
    assert readback._LEGACY.WORKFLOW == '.github/workflows/financial-statement-successor.yml'
    assert readback._LEGACY.BRANCH == 'improve/financial-retention-successor'
    with pytest.raises(ValueError, match='Duplicate'):
        readback.parse(b'{"files":{},"files":{}}')


def test_disabled_admission_cannot_become_readback_success(capture):
    admission = capture['admission']
    admission['execution_enabled'] = False
    content = encoded(admission)
    capture['paths']['admission'].write_bytes(content)
    capture['inventory']['admission_sha256'] = readback.sha(content)
    capture['paths']['inventory'].write_bytes(encoded(capture['inventory']))
    reject(capture, 'permission')
    assert not capture['transport'].calls


def test_inventory_must_stay_outside_upload_root(capture):
    outside = capture['paths']['inventory']
    inside = capture['upload'] / 'inventory.json'
    inside.write_bytes(outside.read_bytes())
    capture['paths']['inventory'] = inside
    reject(capture, 'outside the upload root')


def test_symlinked_input_is_rejected(capture):
    path = capture['paths']['inventory']
    original = path.with_suffix('.original')
    path.rename(original)
    path.symlink_to(original)
    reject(capture, 'Linked')


def test_timeout_or_absent_download_does_not_write_success(capture):
    def missing(*args, **kwargs):
        raise subprocess.TimeoutExpired('offline-fixture', 1)
    capture['transport'].download = missing
    reject(capture)


def test_checkout_and_code_tree_are_checked_again_after_download(capture, monkeypatch):
    calls = []
    def verify(*args, **kwargs):
        calls.append(True)
        if len(calls) == 2:
            raise ValueError('Hosted capture code tree differs from admission')
    monkeypatch.setattr(readback, 'git_identity', verify)
    reject(capture, 'code tree')
    assert len(calls) == 2


@pytest.mark.parametrize('target', ['runtime', 'inventory', 'parent'])
def test_final_result_write_rechecks_runtime_inputs_and_directory_identity(capture, monkeypatch, target):
    moved = capture['output'].parent.with_name('moved-verification')
    def mutate(_):
        if target == 'runtime':
            (capture['repo'] / '.github/scripts/verify-successor-artifact.py').write_bytes(b'replaced')
        elif target == 'inventory':
            capture['paths']['inventory'].write_bytes(capture['paths']['inventory'].read_bytes() + b' ')
        else:
            capture['output'].parent.rename(moved)
            capture['output'].parent.mkdir()
    monkeypatch.setattr(readback.os, 'fsync', mutate)
    reject(capture)
    assert not (moved / capture['output'].name).exists()


def test_hosted_environment_is_rechecked_after_download(capture):
    capture['transport'].after_download = lambda _: capture['environment'].update(GITHUB_SHA='d' * 40)
    reject(capture, 'context changed')


def test_readback_output_cannot_be_overwritten(capture):
    capture['output'].write_bytes(b'old untrusted success')
    with pytest.raises(ValueError, match='already exists'):
        capture['invoke']()
    assert capture['output'].read_bytes() == b'old untrusted success'
    assert not capture['transport'].calls


def test_runtime_hardlinks_are_rejected(capture):
    source = capture['repo'] / '.github/scripts/verify-successor-artifact.py'
    source.with_suffix('.alias').hardlink_to(source)
    reject(capture, 'Unsafe')


def test_inherited_zip_limits_are_applied_without_mutating_legacy(capture):
    # A forged directory header's declared expansion exceeds MAX_MEMBER. The
    # actual ZIP remains tiny, and the shared validator must reject its header.
    content = bytearray(capture['package'].read_bytes())
    start = content.index(b'PK\x01\x02')
    content[start + 24:start + 28] = (readback._LEGACY.MAX_MEMBER + 1).to_bytes(4, 'little')
    capture['package'].write_bytes(content)
    capture['artifact']['digest'] = 'sha256:' + readback.sha(content)
    capture['artifact']['size_in_bytes'] = len(content)
    reject(capture, 'expansion bounds')


def test_authenticated_job_clock_cannot_move_after_download(capture):
    jobs = capture['metadata'][capture['base'] + '/actions/runs/38140913504/attempts/1/jobs?per_page=100']
    capture['transport'].after_download = lambda _: jobs['jobs'][0].update(started_at='2026-10-11T14:00:01Z')
    reject(capture, 'job start changed')


def test_authenticated_workflow_identity_cannot_move_after_download(capture):
    def mutate(_):
        capture['metadata'][capture['base'] + '/actions/workflows/financial-statement-capture.yml']['id'] = 701
        for suffix in ('/actions/runs/38140913504', '/actions/runs/38140913504/attempts/1'):
            capture['metadata'][capture['base'] + suffix]['workflow_id'] = 701
    capture['transport'].after_download = mutate
    reject(capture, 'workflow identity')


@pytest.mark.parametrize('attack', [None, 'wrong_head', 'wrong_tree', 'changed_admission', 'changed_runtime', 'symlink_mode', 'wrong_parent', 'merge_parent', 'no_parent'])
def test_git_identity_binds_committed_control_and_runtime_bytes(tmp_path, monkeypatch, attack):
    repo = tmp_path / 'checkout'
    control = repo / readback.INPUT_ROOT
    control.mkdir(parents=True)
    contents = {str(readback.INPUT_ROOT / 'request.json'): b'{"request":"exact"}',
                str(readback.INPUT_ROOT / 'admission.json'): b'{"execution_enabled":true}',
                str(readback.INPUT_ROOT / 'runtime-lock.json'): b'{"files":{}}',
                '.github/scripts/helper.py': b'unchanged helper'}
    records = []
    for name, content in contents.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        blob = readback.hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
        records.append([name, '100644', blob])
    records.sort()
    reviewed = [item for item in records if item[0] != str(readback.INPUT_ROOT / 'admission.json')]
    admission = {'code_tree_sha256': readback.sha(json.dumps(reviewed, separators=(',', ':')).encode()),
                 'expected_parent_sha': readback.RECOVERY_BINDING['head_sha']}
    if attack == 'wrong_tree': admission['code_tree_sha256'] = 'd' * 64
    if attack == 'changed_admission': (control / 'admission.json').write_bytes(b'{"execution_enabled":false}')
    if attack == 'changed_runtime': (repo / '.github/scripts/helper.py').write_bytes(b'changed helper')
    if attack == 'symlink_mode': records[0][1] = '120000'
    listing = b''.join(f'{mode} blob {blob}\t{name}\0'.encode() for name, mode, blob in records)
    calls, checkpoints = [], []
    def git(arguments, **kwargs):
        calls.append(arguments)
        if arguments[3:] == ['rev-parse', 'HEAD']:
            return subprocess.CompletedProcess(arguments, 0, stdout=(('b' if attack == 'wrong_head' else 'a') * 40 + '\n').encode())
        if arguments[3:] == ['show', '-s', '--format=%P', 'HEAD']:
            parents = [readback.RECOVERY_BINDING['head_sha']]
            if attack == 'wrong_parent': parents = ['b' * 40]
            elif attack == 'merge_parent': parents.append('b' * 40)
            elif attack == 'no_parent': parents = []
            return subprocess.CompletedProcess(arguments, 0, stdout=(' '.join(parents) + '\n').encode())
        assert arguments[3:] == ['ls-tree', '-rz', '--full-tree', 'HEAD']
        return subprocess.CompletedProcess(arguments, 0, stdout=listing)
    def checkpoint():
        checkpoints.append(True)
        return 10
    monkeypatch.setattr(readback.subprocess, 'run', git)
    def invoke():
        readback.git_identity(repo, {'head_sha': 'a' * 40}, admission, timeout=20,
                              checkpoint=checkpoint, runtime_files=['.github/scripts/helper.py'])
    if attack:
        with pytest.raises(ValueError): invoke()
    else:
        invoke()
        assert len(calls) == 3 and len(checkpoints) == 4


def test_rejected_detached_result_is_invalidated_without_deleting_replacement(capture, monkeypatch):
    detached = capture['output'].with_suffix('.detached.json')
    replacement = b'not this attempt output'
    def swap(_):
        capture['output'].rename(detached)
        capture['output'].write_bytes(replacement)
    monkeypatch.setattr(readback.os, 'fsync', swap)
    with pytest.raises(ValueError, match='output identity changed'):
        capture['invoke']()
    assert detached.read_bytes() == b''
    assert capture['output'].read_bytes() == replacement


def refresh_package(capture, *, refresh_inventory=True):
    if refresh_inventory:
        capture['inventory']['retained_inventory']['files'] = {
            name: {'bytes': len(content), 'sha256': readback.sha(content)} for name, content in capture['files'].items()}
        capture['paths']['inventory'].write_bytes(encoded(capture['inventory']))
    with zipfile.ZipFile(capture['package'], 'w') as writer:
        for name, content in capture['files'].items():
            writer.writestr(name, content)
    capture['artifact'].update(digest='sha256:' + readback.sha(capture['package'].read_bytes()),
                               size_in_bytes=capture['package'].stat().st_size)


def update_admission(capture):
    content = encoded(capture['admission'])
    capture['paths']['admission'].write_bytes(content)
    capture['inventory']['admission_sha256'] = readback.sha(content)
    capture['inventory']['retained_inventory']['files']['capture-admission.json'] = {
        'bytes': len(content), 'sha256': readback.sha(content)}
    capture['paths']['inventory'].write_bytes(encoded(capture['inventory']))


@pytest.mark.parametrize('key,value', [
    ('schema_version', 'financial-statement-capture-admission-v1'), ('expected_run_number', 1),
    ('expected_run_number', 3), ('workflow_id', None), ('workflow_id', 381262769),
    ('expected_parent_sha', 'b' * 40), ('maximum_preflight_age_seconds', 31),
    ('maximum_job_seconds', 1501), ('finalization_reserve_seconds', 419), ('extra', 'no')])
def test_run2_admission_is_closed_and_bounds_unchanged(capture, key, value):
    capture['admission'][key] = value
    update_admission(capture)
    reject(capture)
    assert not capture['transport'].calls


@pytest.mark.parametrize('key', list(readback.RECOVERY_BINDING))
def test_every_pinned_failed_binding_field_is_immutable(capture, key):
    value = capture['admission']['recovery'][key]
    capture['admission']['recovery'][key] = value + 1 if type(value) is int else value + '-changed'
    update_admission(capture)
    reject(capture, 'Exact failed-run recovery')
    assert not capture['transport'].calls


@pytest.mark.parametrize('key,value', [('run_number', True), ('artifact_count', False), ('extra', 1)])
def test_failed_binding_rejects_ambiguous_types_and_unknown_fields(capture, key, value):
    capture['admission']['recovery'][key] = value
    update_admission(capture)
    reject(capture, 'Exact failed-run recovery')


@pytest.mark.parametrize('key,value', [('GITHUB_RUN_NUMBER', '3'), ('GITHUB_RUN_ATTEMPT', '2'),
    ('GITHUB_RUN_ID', str(readback.RECOVERY_BINDING['run_id'])), ('GITHUB_SHA', readback.RECOVERY_BINDING['head_sha'])])
def test_current_context_cannot_replay_failed_run_or_request_another_attempt(capture, key, value):
    capture['environment'][key] = value
    reject(capture)
    assert not capture['transport'].calls


@pytest.mark.parametrize('target', ['failed_run', 'failed_attempt'])
@pytest.mark.parametrize('phase', ['before', 'after_download'])
@pytest.mark.parametrize('key,value', [
    ('id', 38140913504), ('run_number', 2), ('run_attempt', 2), ('workflow_id', 381262769),
    ('path', '.github/workflows/other.yml'), ('event', 'workflow_dispatch'), ('head_branch', 'main'),
    ('head_sha', 'b' * 40), ('head_commit', {'id': 'b' * 40, 'tree_id': 'b' * 40}),
    ('repository', {'id': 1, 'full_name': readback.REPOSITORY}),
    ('head_repository', {'id': readback.REPOSITORY_ID, 'full_name': 'other/repo'}),
    ('status', 'in_progress'), ('conclusion', 'success'), ('created_at', '2026-10-11T12:52:12Z'),
    ('run_started_at', '2026-10-11T12:52:11Z'), ('updated_at', '2026-10-11T12:52:45Z')])
def test_failed_run_and_attempt_must_remain_exact_before_and_after_zip(capture, target, phase, key, value):
    def mutate(*_):
        capture[target][key] = value
    if phase == 'before': mutate()
    else: capture['transport'].after_download = mutate
    reject(capture)


@pytest.mark.parametrize('target', ['failed_run', 'failed_attempt'])
@pytest.mark.parametrize('key', readback.RUN_FIELDS)
def test_failed_run_records_cannot_omit_a_whitelisted_field(capture, target, key):
    del capture[target][key]
    reject(capture, 'Incomplete')


@pytest.mark.parametrize('phase', ['before', 'after_download'])
@pytest.mark.parametrize('key,value', [
    ('id', 114474425322), ('run_id', 1), ('run_attempt', 2), ('head_sha', 'b' * 40), ('name', 'other'),
    ('status', 'in_progress'), ('conclusion', 'success'), ('started_at', '2026-10-11T12:52:14Z'),
    ('completed_at', '2026-10-11T12:52:44Z')])
def test_failed_job_identity_state_and_clocks_are_exact(capture, phase, key, value):
    def mutate(*_): capture['failed_jobs']['jobs'][0][key] = value
    if phase == 'before': mutate()
    else: capture['transport'].after_download = mutate
    reject(capture, 'Pinned failed capture job')


@pytest.mark.parametrize('number', range(16))
@pytest.mark.parametrize('field', readback.STEP_FIELDS)
def test_every_failed_step_field_is_fingerprinted(capture, number, field):
    step = capture['failed_jobs']['jobs'][0]['steps'][number]
    step[field] = step[field] + 100 if field == 'number' else 'changed'
    reject(capture)


@pytest.mark.parametrize('attack', ['missing', 'extra', 'duplicate', 'reordered', 'extra_field', 'missing_field',
    'in_progress', 'success', 'failure', 'queued', 'changed_skipped_clock'])
@pytest.mark.parametrize('phase', ['before', 'after_download'])
def test_failed_capture_skipped_metadata_is_not_execution_or_flexible_history(capture, attack, phase):
    def mutate(*_):
        steps = capture['failed_jobs']['jobs'][0]['steps']
        if attack == 'missing': steps.pop()
        elif attack == 'extra': steps.append(deepcopy(steps[-1]))
        elif attack == 'duplicate': steps[-1] = deepcopy(steps[-2])
        elif attack == 'reordered': steps[0], steps[1] = steps[1], steps[0]
        elif attack == 'extra_field': steps[8]['extra'] = True
        elif attack == 'missing_field': del steps[8]['completed_at']
        elif attack in ('in_progress', 'queued'): steps[8]['status'] = attack
        elif attack == 'changed_skipped_clock': steps[8]['started_at'] = None
        else: steps[8]['conclusion'] = attack
    if phase == 'before': mutate()
    else: capture['transport'].after_download = mutate
    reject(capture)


@pytest.mark.parametrize('target', ['failed_jobs', 'failed_artifacts'])
@pytest.mark.parametrize('phase', ['before', 'after_download'])
@pytest.mark.parametrize('attack', ['wrong_count', 'missing_count', 'wrong_type', 'missing_items', 'extra_item'])
def test_failed_inventories_are_complete_and_zero_artifacts(capture, target, phase, attack):
    def mutate(*_):
        inventory = capture[target]
        key = 'jobs' if target == 'failed_jobs' else 'artifacts'
        if attack == 'wrong_count': inventory['total_count'] += 1
        elif attack == 'missing_count': del inventory['total_count']
        elif attack == 'wrong_type': inventory['total_count'] = bool(inventory['total_count'])
        elif attack == 'missing_items': del inventory[key]
        else: inventory[key].append({'id': 1})
    if phase == 'before': mutate()
    else: capture['transport'].after_download = mutate
    reject(capture)


@pytest.mark.parametrize('target', ['current', 'failed'])
@pytest.mark.parametrize('phase', ['before', 'after_download'])
@pytest.mark.parametrize('attack', ['wrong_sha', 'wrong_tree', 'no_parent', 'wrong_parent', 'merge_parent', 'missing_tree'])
def test_current_and_failed_hosted_commits_have_exact_ancestry(capture, target, phase, attack):
    def mutate(*_):
        commit = capture['failed_commit'] if target == 'failed' else capture['metadata'][capture['base'] + '/git/commits/' + 'a' * 40]
        if attack == 'wrong_sha': commit['sha'] = 'b' * 40
        elif attack == 'wrong_tree': commit['tree']['sha'] = 'b' * 40
        elif attack == 'no_parent': commit['parents'] = []
        elif attack == 'wrong_parent': commit['parents'][0]['sha'] = 'b' * 40
        elif attack == 'merge_parent': commit['parents'].append({'sha': 'b' * 40})
        else: del commit['tree']
    if phase == 'before': mutate()
    else: capture['transport'].after_download = mutate
    reject(capture, 'commit tree or sole parent')


@pytest.mark.parametrize('phase', ['before', 'after_download'])
@pytest.mark.parametrize('attack', ['missing_run', 'extra_run', 'duplicate_run', 'incomplete_count', 'unknown_run',
    'replay', 'new_attempt', 'wrong_head', 'wrong_workflow', 'missing_list', 'false_count'])
def test_complete_capture_workflow_inventory_is_exactly_run1_and_run2(capture, phase, attack):
    def mutate(*_):
        inventory = capture['metadata'][capture['base'] + f'/actions/workflows/{readback.WORKFLOW_ID}/runs?per_page=100']
        runs = inventory['workflow_runs']
        if attack == 'missing_run': runs.pop()
        elif attack == 'extra_run': runs.append(deepcopy(runs[0]))
        elif attack == 'duplicate_run': runs[1] = deepcopy(runs[0])
        elif attack == 'incomplete_count': inventory['total_count'] = 101
        elif attack == 'unknown_run': runs[1]['id'] = 899
        elif attack == 'replay': runs[0]['run_number'] = 1
        elif attack == 'new_attempt': runs[1]['run_attempt'] = 2
        elif attack == 'wrong_head': runs[1]['head_sha'] = 'b' * 40
        elif attack == 'wrong_workflow': runs[0]['workflow_id'] += 1
        elif attack == 'missing_list': del inventory['workflow_runs']
        else: inventory['total_count'] = True
    if phase == 'before': mutate()
    else: capture['transport'].after_download = mutate
    reject(capture)


@pytest.mark.parametrize('attack', ['missing_inventory', 'missing_zip', 'oversized', 'changed_binding', 'changed_run',
    'changed_attempt', 'changed_commit', 'changed_job', 'changed_artifacts', 'missing_field', 'extra_field',
    'duplicate_field', 'newline', 'noncanonical', 'changed_original_bytes'])
def test_recovery_proof_must_be_retained_as_exact_original_uploaded_bytes(capture, attack):
    if attack == 'missing_inventory':
        del capture['inventory']['retained_inventory']['files']['capture-recovery.json']
        capture['paths']['inventory'].write_bytes(encoded(capture['inventory']))
    elif attack == 'missing_zip':
        del capture['files']['capture-recovery.json']
        refresh_package(capture, refresh_inventory=False)
    else:
        proof = deepcopy(capture['proof'])
        if attack == 'oversized': content = b' ' * 65537
        elif attack == 'duplicate_field': content = b'{"binding":{},"binding":{}}'
        elif attack == 'changed_original_bytes':
            content = readback.canonical(proof) + b' '
        else:
            if attack == 'changed_binding': proof['binding']['run_attempt'] = 2
            elif attack == 'changed_run': proof['run']['updated_at'] = '2026-10-11T12:52:44Z'
            elif attack == 'changed_attempt': proof['attempt']['created_at'] = proof['run']['created_at']
            elif attack == 'changed_commit': proof['commit']['parents'] = []
            elif attack == 'changed_job': proof['job']['steps'][8]['conclusion'] = 'success'
            elif attack == 'changed_artifacts': proof['artifact_inventory']['artifacts'] = [{'id': 1}]
            elif attack == 'missing_field': del proof['attempt']
            elif attack == 'extra_field': proof['checked_at'] = START
            content = readback.canonical(proof)
            if attack == 'newline': content += b'\n'
            elif attack == 'noncanonical': content = encoded(proof)
        capture['files']['capture-recovery.json'] = content
        refresh_package(capture, refresh_inventory=attack != 'changed_original_bytes')
    reject(capture)


def test_failed_distinct_record_clocks_and_timestamped_skipped_step_are_accepted(capture):
    result = capture['invoke']()
    assert capture['proof']['attempt']['created_at'] > capture['proof']['attempt']['run_started_at']
    assert capture['proof']['run']['updated_at'] < capture['proof']['attempt']['updated_at']
    assert capture['proof']['job']['steps'][8]['started_at'] == capture['proof']['job']['steps'][8]['completed_at']
    assert capture['proof']['job']['steps'][8]['conclusion'] == 'skipped'
    assert result['recovery_proof_sha256'] == readback.sha(capture['files']['capture-recovery.json'])
    assert result['run_number'] == 2 and result['failed_capture_run_id'] == 38140913503
    assert capture['transport'].calls.count(capture['failed_path']) == 2
    assert capture['transport'].calls.count(capture['failed_path'] + '/attempts/1') == 2
    assert capture['transport'].calls.count(capture['failed_path'] + '/artifacts?per_page=100') == 2


def test_each_distinct_failed_record_clock_must_be_at_or_before_postawait_now():
    run, attempt, commit, jobs, artifacts, _ = failed_metadata()
    # Only the attempt update is later than this observation. The canonical run
    # and terminal job have already completed; neither can stand in for it.
    with pytest.raises(ValueError, match='future'):
        readback.validate_failed_recovery(run, attempt, commit, jobs, artifacts,
                                         readback.clock('2026-10-11T12:52:43Z'))
    readback.validate_failed_recovery(run, attempt, commit, jobs, artifacts,
                                     readback.clock('2026-10-11T12:52:44Z'))


@pytest.mark.parametrize('pass_number', [1, 2])
@pytest.mark.parametrize('response_number', range(1, 14))
@pytest.mark.parametrize('clock_type', ['wall', 'monotonic'])
def test_each_metadata_response_has_a_postawait_30_second_clock_check(capture, pass_number, response_number, clock_type):
    calls = 0
    def delay(_):
        nonlocal calls
        calls += 1
        if calls == (pass_number - 1) * 13 + response_number:
            if clock_type == 'wall': capture['clock'].current += timedelta(seconds=31)
            else: capture['clock'].elapsed += 31
    capture['transport'].after_api = delay
    reject(capture, '30-second')


def test_metadata_freshness_is_cumulative_across_response_awaits(capture):
    def delay(_):
        capture['clock'].current += timedelta(seconds=3)
        capture['clock'].elapsed += 3
    capture['transport'].after_api = delay
    reject(capture, '30-second')
    assert len(capture['transport'].calls) == 10


@pytest.mark.parametrize('clock_type', ['wall', 'monotonic'])
def test_final_metadata_freshness_must_survive_result_write(capture, monkeypatch, clock_type):
    def delay(_):
        if clock_type == 'wall': capture['clock'].current += timedelta(seconds=31)
        else: capture['clock'].elapsed += 31
    monkeypatch.setattr(readback.os, 'fsync', delay)
    reject(capture, '30-second')


def test_download_can_use_original_bound_but_final_authority_is_new(capture):
    def delay(_):
        capture['clock'].current += timedelta(seconds=90)
        capture['clock'].elapsed += 90
    capture['transport'].after_download = delay
    result = capture['invoke']()
    assert result['financial_admission'] is False
    assert capture['transport'].calls.count(capture['failed_path']) == 2


@pytest.mark.parametrize('target', ['failed_run', 'failed_attempt', 'failed_commit', 'failed_jobs', 'failed_artifacts', 'inventory'])
def test_failed_authority_is_rechecked_after_zip_verification(capture, monkeypatch, target):
    verify = readback.verify_archive
    def changed(*args):
        result = verify(*args)
        if target in ('failed_run', 'failed_attempt'): capture[target]['run_attempt'] = 2
        elif target == 'failed_commit': capture[target]['parents'] = []
        elif target == 'failed_jobs': capture[target]['jobs'][0]['steps'][8]['conclusion'] = 'success'
        elif target == 'failed_artifacts': capture[target]['artifacts'].append({'id': 1})
        else:
            capture['metadata'][capture['base'] + f'/actions/workflows/{readback.WORKFLOW_ID}/runs?per_page=100']['total_count'] = 3
        return result
    monkeypatch.setattr(readback, 'verify_archive', changed)
    reject(capture)


@pytest.mark.parametrize('created,started,updated', [
    ('2026-10-11T14:00:01Z', START, '2026-10-11T14:19:00Z'),
    (START, START, '2026-10-11T13:59:59Z'),
    (START, START, '2026-10-11T14:20:01Z')])
def test_current_canonical_run_preserves_strict_creation_start_update_order(capture, created, started, updated):
    capture['metadata'][capture['base'] + '/actions/runs/38140913504'].update(
        created_at=created, run_started_at=started, updated_at=updated)
    reject(capture)


def test_current_canonical_creation_is_bound_to_admission_dispatch_window(capture):
    capture['admission']['dispatch_not_before'] = '2026-10-11T14:00:01Z'
    update_admission(capture)
    reject(capture, 'dispatch window')


def test_current_canonical_creation_cannot_drift_within_allowed_dispatch_window(capture):
    capture['admission']['dispatch_not_before'] = '2026-10-11T13:59:00Z'
    update_admission(capture)
    capture['files']['capture-admission.json'] = capture['paths']['admission'].read_bytes()
    refresh_package(capture)
    def change(_):
        capture['metadata'][capture['base'] + '/actions/runs/38140913504']['created_at'] = '2026-10-11T13:59:59Z'
        capture['metadata'][capture['base'] + f'/actions/workflows/{readback.WORKFLOW_ID}/runs?per_page=100']['workflow_runs'][0]['created_at'] = '2026-10-11T13:59:59Z'
    capture['transport'].after_download = change
    reject(capture, 'changed during readback')


def test_current_canonical_start_cannot_drift_within_allowed_clock_order(capture):
    def change(_):
        for suffix in ('/actions/runs/38140913504', '/actions/runs/38140913504/attempts/1'):
            capture['metadata'][capture['base'] + suffix]['run_started_at'] = '2026-10-11T14:00:01Z'
        capture['metadata'][capture['base'] + '/actions/runs/38140913504/attempts/1/jobs?per_page=100']['jobs'][0]['started_at'] = '2026-10-11T14:00:01Z'
        capture['metadata'][capture['base'] + f'/actions/workflows/{readback.WORKFLOW_ID}/runs?per_page=100']['workflow_runs'][0]['run_started_at'] = '2026-10-11T14:00:01Z'
    capture['transport'].after_download = change
    reject(capture, 'job start changed')


def test_recovery_does_not_invoke_acquisition_restore_or_financial_validator(capture, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('Acquisition-only CLI or inherited context must never be invoked')
    monkeypatch.setattr(readback._LEGACY, 'main', forbidden)
    monkeypatch.setattr(readback._LEGACY, 'expected_context', forbidden)
    result = capture['invoke']()
    assert result['financial_admission'] is False
    assert all('/financial-statement-successor' not in call for call in capture['transport'].calls)


def capture_inventory_row(capture, *, failed=False):
    inventory = capture['metadata'][capture['base'] + f'/actions/workflows/{readback.WORKFLOW_ID}/runs?per_page=100']
    run_id = readback.RECOVERY_BINDING['run_id'] if failed else 38140913504
    return next(run for run in inventory['workflow_runs'] if run['id'] == run_id)


def test_current_inventory_update_may_advance_between_sequential_metadata_reads(capture):
    capture_inventory_row(capture)['updated_at'] = '2026-10-11T14:19:01Z'
    def advance(_):
        capture['metadata'][capture['base'] + '/actions/runs/38140913504']['updated_at'] = '2026-10-11T14:19:02Z'
        capture_inventory_row(capture)['updated_at'] = '2026-10-11T14:19:03Z'
    capture['transport'].after_download = advance
    result = capture['invoke']()
    assert result['run_created_at'] == result['run_started_at'] == START
    assert result['financial_admission'] is False


@pytest.mark.parametrize('phase', ['before', 'after_download'])
@pytest.mark.parametrize('key,value', [
    ('updated_at', '2026-10-11T14:20:01Z'),
    ('updated_at', '2026-10-11T13:59:59Z'),
    ('created_at', '2026-10-11T14:00:01Z'),
    ('created_at', '2026-10-11T13:59:59Z'),
    ('run_started_at', '2026-10-11T13:59:59Z'),
    ('run_started_at', '2026-10-11T14:19:01Z')])
def test_current_inventory_independently_rejects_future_or_backward_order_clocks(capture, phase, key, value):
    def mutate(*_): capture_inventory_row(capture)[key] = value
    if phase == 'before': mutate()
    else: capture['transport'].after_download = mutate
    reject(capture)


@pytest.mark.parametrize('phase', ['before', 'after_download'])
@pytest.mark.parametrize('key,value', [
    ('id', 901), ('run_number', 3), ('run_attempt', 2), ('workflow_id', 381262769),
    ('repository', {'id': 1, 'full_name': readback.REPOSITORY}),
    ('head_repository', {'id': readback.REPOSITORY_ID, 'full_name': 'other/repository'}),
    ('path', '.github/workflows/other.yml'), ('event', 'workflow_dispatch'), ('head_branch', 'main'),
    ('head_sha', 'b' * 40), ('head_commit', {'id': 'a' * 40, 'tree_id': 'b' * 40}),
    ('status', 'completed'), ('conclusion', 'success'), ('run_started_at', '2026-10-11T14:00:01Z')])
def test_current_inventory_forward_update_never_relaxes_stable_identity(capture, phase, key, value):
    def mutate(*_):
        row = capture_inventory_row(capture)
        row['updated_at'] = '2026-10-11T14:19:01Z'
        row[key] = value
    if phase == 'before': mutate()
    else: capture['transport'].after_download = mutate
    reject(capture)


@pytest.mark.parametrize('phase', ['before', 'after_download'])
def test_failed_inventory_update_remains_exact_even_while_current_can_advance(capture, phase):
    def mutate(*_):
        capture_inventory_row(capture)['updated_at'] = '2026-10-11T14:19:01Z'
        capture_inventory_row(capture, failed=True)['updated_at'] = '2026-10-11T12:52:44Z'
    if phase == 'before': mutate()
    else: capture['transport'].after_download = mutate
    reject(capture, 'inventory differs')


@pytest.mark.parametrize('run_id', ['1', '900', str(readback.RECOVERY_BINDING['run_id'] - 1),
                                  str(readback.RECOVERY_BINDING['run_id'])])
def test_current_run_id_must_follow_pinned_failed_run_id(capture, run_id):
    capture['environment']['GITHUB_RUN_ID'] = run_id
    reject(capture, 'replay')
    assert not capture['transport'].calls


@pytest.mark.parametrize('phase', ['before', 'after_download'])
@pytest.mark.parametrize('created', ['2026-10-11T12:52:43Z', '2026-10-11T12:52:44Z'])
def test_current_creation_must_strictly_follow_failed_attempt_update(capture, phase, created):
    capture['admission']['dispatch_not_before'] = '2026-10-11T12:52:40Z'
    update_admission(capture)
    capture['files']['capture-admission.json'] = capture['paths']['admission'].read_bytes()
    refresh_package(capture)
    def mutate(*_):
        capture['metadata'][capture['base'] + '/actions/runs/38140913504']['created_at'] = created
        capture_inventory_row(capture)['created_at'] = created
    if phase == 'before': mutate()
    else: capture['transport'].after_download = mutate
    reject(capture, 'after the pinned failed attempt')


@pytest.mark.parametrize('clock_type', ['wall', 'monotonic', 'both'])
@pytest.mark.parametrize('phase', ['output_read', 'post_output_checkpoint_read'])
def test_last_output_read_and_its_checkpoint_cannot_expire_final_metadata(capture, monkeypatch, clock_type, phase):
    original = readback.read_input
    output_read = False
    last_runtime = capture['repo'] / list(sorted(capture['runtime']))[-1]
    def delayed_read(path, maximum):
        nonlocal output_read
        result = original(path, maximum)
        if Path(path) == capture['output']:
            output_read = True
            expire = phase == 'output_read'
        else:
            expire = output_read and phase == 'post_output_checkpoint_read' and Path(path) == last_runtime
        if expire:
            if clock_type in ('wall', 'both'):
                capture['clock'].current += timedelta(seconds=30.001)
            if clock_type in ('monotonic', 'both'):
                capture['clock'].elapsed += 30.001
        return result
    monkeypatch.setattr(readback, 'read_input', delayed_read)
    reject(capture, '30-second')
    assert output_read
