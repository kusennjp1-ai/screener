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
START = '2026-10-11T10:00:00Z'
FIRST_STEP = '2026-10-11T10:00:02Z'
NOW = datetime(2026, 10, 11, 10, 20, tzinfo=timezone.utc)


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
    admission = {'schema_version': 'financial-statement-capture-admission-v1', 'request_id': readback.REQUEST_ID,
                 'execution_enabled': True, 'repository': readback.REPOSITORY, 'repository_id': readback.REPOSITORY_ID,
                 'workflow': readback.WORKFLOW, 'workflow_id': None, 'branch': readback.BRANCH, 'event': 'push',
                 'expected_run_number': 1, 'first_attempt_only': True, 'request_sha256': readback.sha(request_bytes),
                 'runtime_lock_sha256': readback.sha(lock_bytes), 'code_tree_sha256': 'c' * 64,
                 'dispatch_not_before': START, 'dispatch_not_after': '2026-10-11T11:00:00Z',
                 'required_valid_through': '2026-10-11T12:00:00Z', 'maximum_job_seconds': 1500,
                 'finalization_reserve_seconds': 420, 'maximum_preflight_age_seconds': 30}
    admission_bytes = encoded(admission)
    paths = {'request': control / 'request.json', 'admission': control / 'admission.json',
             'runtime_lock': control / 'runtime-lock.json', 'inventory': verification / 'inventory.json'}
    for key, content in [('request', request_bytes), ('admission', admission_bytes), ('runtime_lock', lock_bytes)]:
        paths[key].write_bytes(content)
    files = {'archive/.archive.lock': b'', 'archive/manifest.json': b'original source clock',
             'capture-request.json': request_bytes, 'capture-admission.json': admission_bytes,
             'capture-runtime-lock.json': lock_bytes, 'cycle.json': b'partial capture'}
    retained = {'schema_version': 'financial-successor-retained-inventory-v1', 'final_retention_verified': False,
                'files': {name: {'bytes': len(value), 'sha256': readback.sha(value)} for name, value in files.items()}}
    inventory = {'schema_version': 'financial-statement-capture-retained-inventory-v1',
                 'request_sha256': readback.sha(request_bytes), 'admission_sha256': readback.sha(admission_bytes),
                 'runtime_lock_sha256': readback.sha(lock_bytes), 'run_id': 900, 'run_attempt': 1,
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
    run = {'id': 900, 'head_sha': 'a' * 40, 'run_attempt': 1, 'run_number': 1, 'workflow_id': 700,
           'path': readback.WORKFLOW, 'head_branch': readback.BRANCH, 'event': 'push',
           'status': 'in_progress', 'conclusion': None, 'run_started_at': START,
           'repository': repo_metadata, 'head_repository': repo_metadata}
    job = {'id': 901, 'name': readback.JOB, 'run_id': 900, 'run_attempt': 1, 'head_sha': 'a' * 40,
           'status': 'in_progress', 'conclusion': None, 'started_at': START}
    artifact = {'id': 800, 'expired': False, 'name': 'financial-statement-capture-' + 'a' * 40 + '-1',
                'digest': 'sha256:' + readback.sha(package.read_bytes()), 'size_in_bytes': package.stat().st_size,
                'created_at': '2026-10-11T10:19:00Z', 'expires_at': '2026-10-25T10:19:00Z',
                'workflow_run': {'id': 900, 'head_sha': 'a' * 40, 'head_branch': readback.BRANCH,
                                 'repository_id': readback.REPOSITORY_ID, 'head_repository_id': readback.REPOSITORY_ID}}
    base = 'repos/' + readback.REPOSITORY
    metadata = {base: repo_metadata,
                base + '/actions/workflows/financial-statement-capture.yml': {'id': 700, 'path': readback.WORKFLOW, 'state': 'active'},
                base + '/actions/runs/900': deepcopy(run), base + '/actions/runs/900/attempts/1': deepcopy(run),
                base + '/actions/runs/900/attempts/1/jobs?per_page=100': {'total_count': 1, 'jobs': [job]},
                base + '/actions/artifacts/800': artifact}
    environment = {'GITHUB_REPOSITORY': readback.REPOSITORY, 'GITHUB_REPOSITORY_ID': str(readback.REPOSITORY_ID),
                   'GITHUB_REF_NAME': readback.BRANCH, 'GITHUB_REF': 'refs/heads/' + readback.BRANCH,
                   'GITHUB_EVENT_NAME': 'push', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_RUN_NUMBER': '1',
                   'GITHUB_JOB': readback.JOB, 'GITHUB_WORKFLOW_REF': readback.REPOSITORY + '/' + readback.WORKFLOW + '@refs/heads/' + readback.BRANCH,
                   'GITHUB_RUN_ID': '900', 'GITHUB_SHA': 'a' * 40, 'CAPTURE_JOB_STARTED_AT': FIRST_STEP}
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
            'environment': environment, 'base': base, 'runtime': runtime}


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
    assert len(capture['transport'].calls) == 13


def test_successful_retention_bit_is_not_a_financial_certificate(capture):
    capture['inventory']['retained_inventory']['final_retention_verified'] = True
    capture['paths']['inventory'].write_bytes(encoded(capture['inventory']))
    result = capture['invoke']()
    assert result['final_retention_verified'] is True and result['financial_admission'] is False


@pytest.mark.parametrize('key,value', [('GITHUB_RUN_ID', '0'), ('GITHUB_RUN_ATTEMPT', '2'),
    ('GITHUB_RUN_NUMBER', '2'), ('GITHUB_REPOSITORY_ID', '1'), ('GITHUB_REF_NAME', 'main'),
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
        capture['clock'].current = NOW + timedelta(seconds=301)
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
    jobs = capture['metadata'][capture['base'] + '/actions/runs/900/attempts/1/jobs?per_page=100']
    jobs['jobs'][0]['started_at'] = '2026-10-11T09:59:00Z'
    for suffix in ('/actions/runs/900', '/actions/runs/900/attempts/1'):
        capture['metadata'][capture['base'] + suffix]['run_started_at'] = '2026-10-11T09:59:00Z'
    reject(capture, 'actual hosted job start')


@pytest.mark.parametrize('path,key,value', [
    ('/actions/runs/900', 'run_attempt', 2), ('/actions/runs/900', 'head_sha', 'b' * 40),
    ('/actions/runs/900/attempts/1', 'run_number', 2), ('/actions/runs/900/attempts/1', 'status', 'completed'),
    ('/actions/workflows/financial-statement-capture.yml', 'path', '.github/workflows/other.yml'),
    ('/actions/workflows/financial-statement-capture.yml', 'state', 'disabled_manually'),
    ('/actions/runs/900/attempts/1/jobs?per_page=100', 'total_count', 101),
    ('', 'id', 42)])
def test_authenticated_hosted_caller_must_match(capture, path, key, value):
    capture['metadata'][capture['base'] + path][key] = value
    reject(capture)


@pytest.mark.parametrize('key,value', [('id', 801), ('expired', True), ('name', 'other'),
    ('digest', 'sha256:' + 'b' * 64), ('size_in_bytes', True), ('size_in_bytes', 0),
    ('created_at', '2026-10-11T09:59:00Z'), ('expires_at', '2026-10-11T10:19:00Z')])
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
    capture['transport'].after_download = lambda _: capture['artifact'].update(expires_at='2026-10-26T10:19:00Z')
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
    jobs = capture['metadata'][capture['base'] + '/actions/runs/900/attempts/1/jobs?per_page=100']
    capture['transport'].after_download = lambda _: jobs['jobs'][0].update(started_at='2026-10-11T10:00:01Z')
    reject(capture, 'job start changed')


def test_authenticated_workflow_identity_cannot_move_after_download(capture):
    def mutate(_):
        capture['metadata'][capture['base'] + '/actions/workflows/financial-statement-capture.yml']['id'] = 701
        for suffix in ('/actions/runs/900', '/actions/runs/900/attempts/1'):
            capture['metadata'][capture['base'] + suffix]['workflow_id'] = 701
    capture['transport'].after_download = mutate
    reject(capture, 'changed during readback')


@pytest.mark.parametrize('attack', [None, 'wrong_head', 'wrong_tree', 'changed_admission', 'changed_runtime', 'symlink_mode'])
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
    admission = {'code_tree_sha256': readback.sha(json.dumps(reviewed, separators=(',', ':')).encode())}
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
        assert len(calls) == 2 and len(checkpoints) == 3


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
