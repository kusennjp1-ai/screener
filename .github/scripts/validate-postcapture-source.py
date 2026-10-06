"""Validate one exact failed producer artifact without acquisition or admission.

The caller supplies read-only GitHub snapshots. They are cross-checked with local
code bytes, but a future controller must authenticate the eventual validator run.
No result from this program asserts successful GitHub execution or publication.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / '.github/financial-source-postcapture'
FROZEN = BUNDLE / 'frozen'
MAX_METADATA = 16 * 1024 * 1024
MAX_PROJECTION = 256 * 1024 * 1024
DEPENDENCIES = {'yfinance':'0.2.66', 'pandas':'2.2.0', 'numpy':'1.26.3', 'curl_cffi':'0.16.3', 'requests':'2.31.0', 'jsonschema':'4.23.0'}
CODE_PATHS = (
    '.github/scripts/validate-postcapture-source.py',
    '.github/scripts/validate-postcapture-source.test.py',
    '.github/scripts/restore-postcapture-source.mjs',
    '.github/scripts/restore-postcapture-source.test.mjs',
    '.github/scripts/publication-gate.mjs',
    '.github/workflows/financial-source-postcapture-validation.yml',
)
BOUNDARY_REASON = 'Producer conclusion must retain actual cycle failure'
REQUEST_SHA256 = 'd8f06454c41eda4cd7707cdd69a10236b34b690ccd0370fcdcf396d444758e43'
DENIED = []
BOOTSTRAP_DENIED = []
_BOOTSTRAP = True
_SELF_TEST = False
_INSTALLED = False


class InvalidValidation(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InvalidValidation(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()


def sha(content):
    return hashlib.sha256(content).hexdigest()


def digest(value):
    return sha(canonical(value))


def blob_sha(content):
    return hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()


def exact(value, keys, label):
    require(isinstance(value, dict) and set(value) == set(keys), 'Invalid closed ' + label)


def parse(content):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(content, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(InvalidValidation('Nonfinite JSON')))


def safe(path):
    path = Path(path).absolute()
    for item in [path, *path.parents]:
        if item.exists() or item.is_symlink():
            mode = item.lstat().st_mode
            require(not stat.S_ISLNK(mode) and (stat.S_ISREG(mode) or stat.S_ISDIR(mode)), 'Unsafe local path')
    return path


def read_bytes(path, maximum=MAX_METADATA):
    path = safe(path)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= maximum, 'Input is not a bounded single-link regular file')
        content = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        visible = path.stat(follow_symlinks=False)
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_nlink)
        require(identity(info) == identity(after) == identity(visible) and stat.S_ISREG(visible.st_mode)
                and len(content) == info.st_size, 'Input changed while reading')
    return content


def read_json(path, maximum=MAX_METADATA):
    content = read_bytes(path, maximum)
    return parse(content), content


def clock(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})', value), 'Invalid timezone-aware clock')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None, 'Clock has no timezone')
    return result


def positive(value):
    return type(value) is int and 0 < value <= 9007199254740991


def deny(label):
    def blocked(*args, **kwargs):
        if not _SELF_TEST:
            (BOOTSTRAP_DENIED if _BOOTSTRAP else DENIED).append(label)
        raise RuntimeError('Postcapture validation prohibits ' + label)
    return blocked


def install_offline_boundary():
    global _INSTALLED, _BOOTSTRAP, _SELF_TEST
    if _INSTALLED:
        return
    _INSTALLED = True
    def audit(event, args):
        if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.spawn', 'os.fork', 'os.forkpty', 'os.exec'}:
            deny(event)()
    sys.addaudithook(audit)
    import socket
    import subprocess
    # Preserve a socket type for ssl.SSLSocket's import-time subclassing.
    class BlockedSocket(socket.socket):
        def __new__(cls, *args, **kwargs):
            return deny('socket.socket')(*args, **kwargs)
    socket.socket = BlockedSocket
    socket.create_connection = deny('socket.create_connection')
    socket.getaddrinfo = deny('socket.getaddrinfo')
    subprocess.Popen = deny('subprocess.Popen')
    import requests
    requests.sessions.Session.request = deny('requests.Session.request')
    import curl_cffi
    curl_cffi.Curl.perform = deny('curl_cffi.Curl.perform')
    curl_cffi.AsyncCurl.add_handle = deny('curl_cffi.AsyncCurl.add_handle')
    from curl_cffi import requests as curl_requests
    curl_requests.Session.request = deny('curl_cffi.Session.request')
    curl_requests.AsyncSession.request = deny('curl_cffi.AsyncSession.request')
    import yfinance
    yfinance.Ticker = deny('yfinance.Ticker')
    yfinance.Tickers = deny('yfinance.Tickers')
    yfinance.download = deny('yfinance.download')
    from yfinance.data import YfData
    for method in ('get', 'post', 'cache_get', 'get_raw_json', '_make_request'):
        if hasattr(YfData, method):
            setattr(YfData, method, deny('YfData.' + method))
    _SELF_TEST = True
    try:
        for function in (socket.socket, socket.getaddrinfo, subprocess.Popen, requests.sessions.Session.request,
                         curl_cffi.Curl.perform, curl_requests.Session.request, yfinance.Ticker):
            try:
                function()
            except RuntimeError as exc:
                require(str(exc).startswith('Postcapture validation prohibits '), 'Offline self-test failed')
            else:
                raise InvalidValidation('Offline self-test did not reject acquisition')
    finally:
        _SELF_TEST = False
        _BOOTSTRAP = False


def validate_schema(value, schema):
    from jsonschema import Draft202012Validator, FormatChecker
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(value)


def load_policy():
    request, request_bytes = read_json(BUNDLE / 'request.json')
    require(sha(request_bytes) == REQUEST_SHA256, 'Closed exact-source request bytes changed')
    schema, schema_bytes = read_json(BUNDLE / 'request.schema.json')
    validate_schema(request, schema)
    frozen, frozen_bytes = read_json(BUNDLE / 'frozen-inventory.json')
    require(sha(frozen_bytes) == request['frozen_validator']['inventory_sha256'], 'Frozen inventory hash mismatch')
    exact(frozen, ['schema_version','reviewed_commit','reviewed_tree','policy_sha256','policy_paths','files'], 'frozen inventory')
    for key in ('reviewed_commit', 'reviewed_tree', 'policy_sha256'):
        require(frozen[key] == request['frozen_validator'][key], 'Frozen review identity mismatch')
    require(len(frozen['files']) == request['frozen_validator']['files'] == 40, 'Frozen closure file count mismatch')
    actual = {str(path.relative_to(FROZEN)) for path in FROZEN.rglob('*') if path.is_file()}
    require(actual == set(frozen['files']), 'Frozen closure has missing or extra files')
    for relative, entry in frozen['files'].items():
        require(not PurePosixPath(relative).is_absolute() and '..' not in PurePosixPath(relative).parts, 'Unsafe frozen relative path')
        content = read_bytes(FROZEN / relative)
        require(sha(content) == entry['sha256'] and blob_sha(content) == entry['git_blob_sha'], 'Frozen file changed: ' + relative)
    require(digest({path:frozen['files'][path]['sha256'] for path in frozen['policy_paths']}) == frozen['policy_sha256'], 'Frozen policy digest mismatch')
    captured, captured_bytes = read_json(BUNDLE / 'captured-inventory.json')
    require(sha(captured_bytes) == request['captured_inventory']['sha256'], 'Captured inventory sidecar changed')
    exact(captured, ['schema_version','artifact_sha256','expanded_bytes','files','member_count'], 'captured inventory')
    require(captured['schema_version'] == 'postcapture-artifact-inventory-v1' and captured['artifact_sha256'] == request['source']['artifact_sha256']
            and captured['member_count'] == len(captured['files']) == request['captured_inventory']['files']
            and captured['expanded_bytes'] == request['captured_inventory']['expanded_bytes'], 'Captured inventory scope mismatch')
    for name, expected in request['diagnosis'].items():
        require(sha(read_bytes(BUNDLE / 'diagnosis' / name)) == expected, 'Reproduction evidence changed')
    return request, request_bytes, schema_bytes, frozen, captured, captured_bytes


def code_inventory(frozen):
    paths = set(CODE_PATHS)
    paths.update('.github/financial-source-postcapture/' + path for path in ('request.json','request.schema.json','receipt.schema.json','frozen-inventory.json','captured-inventory.json'))
    paths.update('.github/financial-source-postcapture/diagnosis/' + path for path in ('lock-path-reproduction.json','actual-data-lock-repair-final-replay.json'))
    paths.update('.github/financial-source-postcapture/frozen/' + path for path in frozen['files'])
    return {path:{'sha256':sha(content), 'git_blob_sha':blob_sha(content), 'bytes':len(content)}
            for path in sorted(paths) for content in [read_bytes(ROOT / path)]}


def verify_validator(request, evidence, inventory, now):
    exact(evidence, ['run','job','commit','tree'], 'validator API evidence')
    run, job, commit, tree = (evidence[key] for key in ('run','job','commit','tree'))
    expected = request['validator']
    require(isinstance(run, dict) and isinstance(job, dict) and isinstance(commit, dict) and isinstance(tree, dict), 'Invalid validator API objects')
    require(positive(run.get('id')) and run.get('run_attempt') == expected['run_attempt'] and run.get('event') == 'push'
            and run.get('path') == expected['workflow'] and run.get('head_branch') == expected['branch']
            and run.get('status') == 'in_progress' and run.get('conclusion') is None
            and run.get('repository', {}).get('full_name') == request['source']['repository']
            and run.get('head_repository', {}).get('full_name') == request['source']['repository']
            and run.get('repository', {}).get('id') == expected['repository_id']
            and run.get('head_repository', {}).get('id') == expected['repository_id'], 'Validator attempt identity mismatch')
    require(positive(job.get('id')) and job.get('run_id') == run['id'] and job.get('run_attempt') == run['run_attempt']
            and job.get('head_sha') == run['head_sha'] and job.get('name') == expected['job']
            and job.get('status') == 'in_progress' and job.get('conclusion') is None, 'Validator job is not exact current execution')
    require(clock(run['run_started_at']) <= clock(job['started_at']) <= now, 'Validator evaluation outside current attempt')
    require(isinstance(run.get('head_sha'), str) and re.fullmatch(r'[a-f0-9]{40}', run['head_sha'])
            and commit.get('sha') == run['head_sha'] and commit.get('tree', {}).get('sha') == tree.get('sha')
            and run.get('head_commit', {}).get('id') == run['head_sha']
            and run.get('head_commit', {}).get('tree_id') == tree.get('sha')
            and isinstance(commit.get('parents'), list) and len(commit['parents']) == 1
            and commit['parents'][0].get('sha') == expected['first_parent_sha'], 'Validator commit/tree/parent binding mismatch')
    require(isinstance(tree.get('sha'), str) and re.fullmatch(r'[a-f0-9]{40}', tree['sha'])
            and tree.get('truncated') is False and isinstance(tree.get('tree'), list) and len(tree['tree']) <= 100000, 'Incomplete validator code tree')
    entries = {}
    for entry in tree['tree']:
        require(isinstance(entry, dict) and isinstance(entry.get('path'), str) and entry['path'] not in entries, 'Duplicate or malformed code tree entry')
        entries[entry['path']] = entry
    for path, local in inventory.items():
        item = entries.get(path, {})
        require(item.get('type') == 'blob' and item.get('mode') == '100644' and item.get('sha') == local['git_blob_sha'], 'Validator local code differs from official tree: ' + path)
    gate = expected['publication_gate']
    require(inventory[gate['path']]['sha256'] == gate['sha256'] and inventory[gate['path']]['git_blob_sha'] == gate['git_blob_sha'], 'Existing Node API helper changed')
    return {'run_id':run['id'], 'run_attempt':run['run_attempt'], 'job_id':job['id'], 'status':'in_progress',
            'authentication':'provided_api_snapshot_requires_independent_authentication', 'successful_run_attested':False}


def verify_zip_inventory(source_zip, request, inventory):
    content = read_bytes(source_zip, 128 * 1024 * 1024)
    require(len(content) == request['artifact_size_bytes'] and sha(content) == request['source']['artifact_sha256'], 'Exact source ZIP length/hash mismatch')
    with zipfile.ZipFile(source_zip) as zipped:
        infos = zipped.infolist()
        require(len(infos) == inventory['member_count'], 'Source ZIP inventory count mismatch')
        seen, total = set(), 0
        for info in infos:
            name, mode = info.filename, info.external_attr >> 16
            require(name not in seen and not PurePosixPath(name).is_absolute() and '\\' not in name
                    and all(part not in ('','.', '..') for part in name.split('/')) and not info.is_dir()
                    and not info.flag_bits & 1 and not stat.S_ISLNK(mode)
                    and (not stat.S_IFMT(mode) or stat.S_ISREG(mode)), 'Unsafe, duplicate or special source ZIP member')
            expected = inventory['files'].get(name)
            require(isinstance(expected, dict) and set(expected) == {'bytes','sha256'}
                    and info.file_size == expected['bytes'] and 0 <= info.file_size <= 32 * 1024 * 1024, 'Source member identity or size mismatch')
            body = zipped.read(info)
            require(sha(body) == expected['sha256'], 'Source member digest mismatch: ' + name)
            seen.add(name); total += len(body)
        require(seen == set(inventory['files']) and total == inventory['expanded_bytes'], 'Source inventory incomplete')
    return sha(content)


def verify_execution(request, source_evidence, cycle, base, summary, log, now):
    run = source_evidence['run']
    jobs = [job for job in source_evidence['jobs'] if job.get('name') == 'statement-recovery']
    require(len(jobs) == 1, 'Missing or duplicate producer job')
    job = jobs[0]
    boundary = request['failure_boundary']
    require(run['conclusion'] == job['conclusion'] == 'failure' and job['id'] == request['producer_job_id']
            and run.get('head_commit', {}).get('tree_id') == request['producer_tree_sha'], 'Original failed producer identity changed')
    require(isinstance(job.get('steps'), list) and all(isinstance(step, dict) and step.get('status') == 'completed'
            and step.get('conclusion') in {'success','failure','skipped'} for step in job['steps']), 'Incomplete producer step inventory')
    failed = [step for step in job['steps'] if step['conclusion'] == 'failure']
    require(len(failed) == 1 and failed[0]['number'] == boundary['failed_step_number'] and failed[0]['name'] == boundary['failed_step_name'], 'Unexpected original failure boundary')
    require(len(log) == boundary['job_log_bytes'] and sha(log) == boundary['job_log_sha256'], 'Exact failed-job log mismatch')
    text = log.decode('utf-8')
    require(text.count('Traceback (most recent call last):') == 1 and text.count('##[error]Process completed with exit code 1.') == 1
            and 'retention_report = retention_guard.verify_final()' in text
            and 'RetentionIntegrityError: Unowned retained source addition' in text, 'Failed log does not preserve guard exception')
    source = request['source']
    require(cycle.get('schema_version') == 'financial-recovery-cycle-v1' and cycle.get('phase') == 'completed'
            and cycle.get('dry_run') is False and cycle.get('published') is False and cycle.get('code_revision') == source['head_sha']
            and cycle.get('archive_manifest_sha256') == source['archive_manifest_sha256']
            and cycle.get('base_artifact_sha256') == source['acquisition_base_sha256']
            and cycle.get('source_data_as_of') == base.get('as_of_date')
            and cycle.get('previous_archive_manifest_sha256') == request['baseline']['manifest_sha256'], 'Incomplete or contradictory completed cycle')
    require(type(cycle.get('exit_code')) is int and cycle['exit_code'] == 0
            and type(cycle.get('selected_symbols')) is int and cycle['selected_symbols'] == 200, 'Original cycle exit/count changed')
    require(type(summary.get('exit_code')) is int and summary['exit_code'] == 0 and summary.get('selected_symbols') == 200
            and summary.get('provider_stop') is None and summary.get('execution_stop') is None
            and summary.get('statement_getter_calls') == 400 and summary.get('transport_calls') == 408
            and summary.get('counts', {}).get('captured_attributes') == 400
            and summary['counts'].get('failed_attributes') == 0 and summary['counts'].get('reused_attributes') == 0,
            'Exact successful captured batch scope changed')
    require(clock(job['started_at']) <= clock(summary['evaluation_time'])
            < clock('2026-10-06T14:39:54.9908123Z') <= clock(failed[0]['completed_at']) <= clock(job['completed_at']) <= now,
            'Postcapture failure clocks mismatch')


def verify_retention(root, manifest, request):
    expected = request['baseline']
    old, old_bytes = read_json(root / 'archive/manifests' / (expected['manifest_sha256'] + '.json'))
    require(sha(old_bytes) == expected['manifest_sha256'], 'Original embedded snapshot digest mismatch')
    for category, count in expected['counts'].items():
        require(isinstance(old.get(category), dict) and len(old[category]) == count, 'Original snapshot inventory mismatch')
    for category in ('objects','receipts','attempts','batches'):
        require(all(manifest[category].get(key) == value for key, value in old[category].items()), 'Original retained entries changed: ' + category)
    for object_sha, entry in old['objects'].items():
        content = read_bytes(root / 'archive/objects' / (object_sha + '.json'), 32 * 1024 * 1024)
        require(len(content) == entry['bytes'] and sha(content) == object_sha, 'Original object changed')
    require(len(expected['snapshot_sha256']) == 12 and len(set(expected['snapshot_sha256'])) == 12, 'Original snapshot inventory not closed')
    for snapshot_sha in expected['snapshot_sha256']:
        require(sha(read_bytes(root / 'archive/manifests' / (snapshot_sha + '.json'))) == snapshot_sha, 'Original immutable snapshot changed')
    require({k:len(manifest[k]) for k in request['refresh']['archive_counts']} == request['refresh']['archive_counts'], 'Captured archive counts mismatch')
    return old


def verify_refresh(loaded, old, plan, summary, attempts, request):
    manifest = loaded.manifest
    ids = sorted(set(manifest['receipts']) - set(old['receipts']))
    receipt_inventory = [{'sha256':key, **manifest['receipts'][key]} for key in ids]
    expected = request['refresh']
    require(len(ids) == expected['new_receipts'] and digest(ids) == expected['new_receipt_ids_sha256']
            and digest(receipt_inventory) == expected['new_receipt_inventory_sha256'], 'Exact fresh receipt identities changed')
    unchanged = {key:value for key,value in old['current'].items() if manifest['current'].get(key) == value}
    require(set(manifest['current']) == set(old['current']) and len(unchanged) == expected['unchanged_current_slots']
            and digest(unchanged) == expected['unchanged_current_sha256'], 'Untargeted current slots changed')
    changed = {key:value for key,value in manifest['current'].items() if key not in unchanged}
    require(changed == {entry['symbol'] + '/' + entry['attribute']:entry['sha256'] for entry in receipt_inventory}, 'Fresh receipts do not match exact changed current slots')
    selected = plan['selected']
    selected_pairs = {(entry['symbol'], attribute) for entry in selected for attribute in entry['attributes']}
    require(len(selected) == 200 and len({entry['symbol'] for entry in selected}) == 200 and len(selected_pairs) == 400
            and selected_pairs == {(entry['symbol'],entry['attribute']) for entry in receipt_inventory}, 'Selected cohort does not bind fresh receipts')
    require(len(attempts) == 400 and all(a['outcome'] == 'succeeded' for a in attempts)
            and {(a['symbol'],a['attribute']) for a in attempts} == selected_pairs
            and len({a['attempt_id'] for a in attempts}) == 400, 'Fresh getter attempt identity/outcome mismatch')
    by_capture = {(entry['symbol'],entry['attribute'],entry['capture_id']) for entry in receipt_inventory}
    require({(a['symbol'],a['attribute'],a['capture_id']) for a in attempts} == by_capture, 'Fresh getter capture IDs mismatch')
    events = [event for key in ids for event in loaded.objects[key][0]['transport_events']]
    require(len(events) == summary['transport_calls'] == 408, 'Fresh HTTP event inventory mismatch')
    return receipt_inventory


def verify_diagnosis(request):
    reproduction, _ = read_json(BUNDLE / 'diagnosis/lock-path-reproduction.json')
    final, _ = read_json(BUNDLE / 'diagnosis/actual-data-lock-repair-final-replay.json')
    require(reproduction['new_paths_after_exact_writer'] == ['archive/.archive.lock'] and reproduction['initial_hidden_lock_omitted'] is True
            and reproduction['archive_manifest_unchanged'] is True and reproduction['final_guard_error'] == 'Unowned retained source addition', 'Reproduced boundary changed')
    require(reproduction['lock'] == {'path':'archive/.archive.lock','bytes':0,'regular':True,'nlink':1,'mode':'0o644','sha256':sha(b'')}, 'Reproduced lock shape changed')
    repair = request['reviewed_lock_repair']
    require(repair['parent_tree'] == request['producer_tree_sha']
            and repair['files']['backend/app/services/statement_retention_budget.py']['unchanged_from_original_producer_tree'] is True
            and repair['files']['backend/app/services/statement_retention_budget.py']['sha256'] == repair['files']['backend/app/services/statement_retention_budget.py']['original_producer_tree_sha256'], 'Repair changed original retention guard')
    require(final['archive_helper_sha256'] == repair['files']['backend/app/services/statement_artifact_archive.py']['sha256']
            and final['original_artifact_sha256'] == request['source']['artifact_sha256'] and final['source_files_compared'] == 10055
            and final['original_source_lock_still_absent'] is True and final['new_control_path'] == 'archive/.archive.lock'
            and final['new_control_bytes'] == 0 and final['provider_calls'] == 0 and final['original_run_conclusion'] == 'failure'
            and type(final['original_cycle_exit_code']) is int and final['original_cycle_exit_code'] == 0
            and final['final_guard']['actual_actions_artifact_readback_required'] is True, 'Final reproduced diagnosis changed')


def projection_guard(projection_bytes, contract, certifier):
    require(len(projection_bytes) <= MAX_PROJECTION, 'Projection exceeds bound')
    require(contract.get('schema_version') == certifier.SCHEMA and contract.get('projection_policy') == certifier.POLICY, 'Frozen certification contract mismatch')


def write_verified_output(path, content, *, receipt=False):
    path = safe(path)
    created = False
    try:
        with path.open('xb') as stream:
            created = True
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        require(read_bytes(path, max(MAX_METADATA, len(content))) == content, 'Output readback mismatch: ' + path.name)
    except Exception:
        if receipt and created:
            path.unlink(missing_ok=True)
        raise


def validate(*, source_zip, api_evidence, job_log, output, now=None):
    # Tests may inject a direct datetime. The command line has no clock override.
    now = datetime.now(timezone.utc) if now is None else now
    require(isinstance(now, datetime) and now.tzinfo is not None, 'Explicit UTC evaluation required')
    install_offline_boundary()
    dependencies = {name:importlib.metadata.version(name) for name in DEPENDENCIES}
    require(dependencies == DEPENDENCIES and sys.version_info[:2] in {(3,11),(3,12)}, 'Unreviewed validator dependency/runtime version')
    request, request_bytes, request_schema_bytes, frozen, captured, captured_bytes = load_policy()
    before_code = code_inventory(frozen)
    evidence, evidence_bytes = read_json(api_evidence)
    exact(evidence, ['run','jobs','artifacts','validator'], 'complete API evidence')
    validator_context = verify_validator(request, evidence['validator'], before_code, now)
    source_evidence = {key:evidence[key] for key in ('run','jobs','artifacts')}
    log = read_bytes(job_log)
    output = safe(output)
    require(not output.exists() and output.parent.is_dir(), 'Output must be a new directory with an existing parent')
    zip_sha = verify_zip_inventory(source_zip, request, captured)
    verify_diagnosis(request)
    require(not any(name == 'app' or name.startswith('app.') for name in sys.modules), 'Unreviewed app module already imported')
    sys.path.insert(0, str(FROZEN / 'backend'))
    from app.services import statement_source_certification as certifier
    from app.services import statement_artifact_archive as archive
    from app.services import financial_statement_batch as batch
    source = certifier.parse_request({'schema_version':certifier.SCHEMA, 'source':request['source']})
    run, job, artifact = certifier.verify_source_api(source, source_evidence, now)
    require(artifact['size_in_bytes'] == request['artifact_size_bytes'], 'GitHub artifact size mismatch')
    with tempfile.TemporaryDirectory(prefix='postcapture-source-', dir=output.parent) as temporary:
        root = Path(temporary)
        certifier.extract_zip(source_zip, root, zip_sha)
        cycle, cycle_bytes = certifier.read(root / 'cycle.json')
        base, base_bytes = certifier.read(root / 'base.json', batch.MAX_BASE_BYTES)
        cohort, cohort_bytes = certifier.read(root / 'cohort.json')
        summary, summary_bytes = certifier.read(root / 'batch/summary.json')
        require(sha(cycle_bytes) == request['failure_boundary']['cycle_sha256'] and sha(summary_bytes) == request['failure_boundary']['batch_summary_sha256'], 'Captured cycle/summary identity mismatch')
        require(sha(base_bytes) == source['acquisition_base_sha256'] and sha(cohort_bytes) == source['cohort_sha256'], 'Base/cohort digest mismatch')
        verify_execution(request, source_evidence, cycle, base, summary, log, now)
        try:
            certifier.certify_directory(root, {'schema_version':certifier.SCHEMA,'source':source}, source_evidence,
                now=now, code_sha=frozen['reviewed_commit'], api_evidence_sha256=digest(source_evidence))
        except certifier.InvalidCertification as exc:
            require(str(exc) == BOUNDARY_REASON, 'Unexpected frozen v1 rejection')
        else:
            raise InvalidValidation('Frozen v1 unexpectedly accepted this producer outcome')
        loaded = archive.load_archive(root / 'archive', source['archive_manifest_sha256'], base_bytes=base_bytes, cohort=cohort, now=now)
        certifier.audit_archive_storage(loaded)
        require(cycle['retained_receipts'] == len(loaded.manifest['receipts']) and cycle['retained_symbols'] == len({entry['symbol'] for entry in loaded.manifest['receipts'].values()}), 'Cycle archive inventory mismatch')
        require(loaded.manifest['binding'] == {'base_artifact_sha256':source['acquisition_base_sha256'],'source_data_as_of':base['as_of_date']}, 'Archive base binding mismatch')
        old = verify_retention(root, loaded.manifest, request)
        failures, attempts, migrations, unavailable = certifier.audit_batches(loaded, now=now)
        require(loaded.objects[sha(summary_bytes)][1] == summary_bytes and summary['exit_code'] == cycle['exit_code']
                and summary['selected_symbols'] == cycle['selected_symbols'], 'Latest summary not exactly retained')
        plan = certifier._object(loaded, summary['plan_sha256'], 'batch_plan')
        batch.validate_plan(plan, base_bytes)
        require(batch.clock(job['started_at']) <= batch.clock(plan['run_started_at']) <= batch.clock(summary['evaluation_time'])
                <= batch.clock(loaded.manifest['committed_at']) <= batch.clock(artifact['created_at']), 'Latest batch producer-clock mismatch')
        require(plan['verified_us_cohort']['base_artifact_sha256'] == cohort['base_artifact_sha256'] and set(plan['verified_us_cohort']['symbols']) == set(cohort['symbols']), 'Full cohort differs from producer plan')
        latest_attempts = certifier._object(loaded, summary['attempts_sha256'], 'attempt_journal')['attempts']
        fresh = verify_refresh(loaded, old, plan, summary, latest_attempts, request)
        projection, counts, bounds = certifier.current_projection(loaded, cohort, now=now, as_of=base['as_of_date'], historical_unavailable=unavailable)
        projection['bindings'] = {key:source[key] for key in ('archive_manifest_sha256','acquisition_base_sha256','cohort_sha256')}
        projection_bytes = certifier.canonical(projection)
        contract, _ = certifier.read(certifier.CONTRACT_PATH)
        projection_guard(projection_bytes, contract, certifier)
        projection_sha = sha(projection_bytes)
        projection_summary = {'path':'projections/' + projection_sha + '.json', 'sha256':projection_sha, 'bytes':len(projection_bytes),
            'schema_version':certifier.PROJECTION_SCHEMA, 'counts':counts, 'source_timestamp_bounds':bounds, 'cohort_count':len(cohort['symbols']),
            'receipt_inventory_sha256':digest(projection['receipt_inventory']), 'retained_receipts':len(loaded.manifest['receipts']),
            'source_data_as_of':base['as_of_date'], 'knowledge_basis':certifier.KNOWLEDGE, 'point_in_time':False, 'source_publication_date':None, 'qualification_authority':False}
    require(before_code == code_inventory(frozen), 'Validation code changed during replay')
    require(not DENIED, 'Acquisition attempt occurred during validation')
    require(sha(read_bytes(source_zip,128*1024*1024)) == zip_sha and read_bytes(api_evidence) == evidence_bytes and read_bytes(job_log) == log, 'Captured inputs changed during replay')
    receipt_schema, receipt_schema_bytes = read_json(BUNDLE / 'receipt.schema.json')
    receipt = {'schema_version':'financial-source-postcapture-validation-v1', 'kind':'captured_source_integrity_validation',
        'result':'validated_retained_artifact', 'evaluated_at':batch.timestamp(now), 'source':source,
        'producer_execution':{'producer_run_conclusion':'failure','producer_job_conclusion':'failure','producer_job_id':job['id'],
            'producer_cycle_exit_code':0,'producer_batch_exit_code':0,'failed_step_number':10,'original_final_guard_result':'failed','original_outcomes_retained':True},
        'validation':{'code_sha':evidence['validator']['run']['head_sha'], 'tree_sha':evidence['validator']['tree']['sha'],
            'request_sha256':sha(request_bytes),'request_canonical_sha256':digest(request),'request_schema_sha256':sha(request_schema_bytes),
            'receipt_schema_sha256':sha(receipt_schema_bytes),'code_manifest_path':'validation-code-manifest.json','code_manifest_sha256':digest(before_code),
            'frozen_validator':request['frozen_validator'],'source_api_evidence_sha256':digest(source_evidence),'api_evidence_sha256':sha(evidence_bytes),
            'producer_job_log_sha256':sha(log),'validator_api_snapshot':validator_context,'dependencies':dependencies},
        'artifact_inventory':request['captured_inventory'],
        'original_retention':{'baseline':request['baseline'],'archive_counts':request['refresh']['archive_counts'],'all_original_entries_retained':True,'all_original_objects_verified':True,'all_original_snapshots_verified':True},
        'refresh':{**request['refresh'],'new_receipt_inventory_path':'fresh-receipts.json'},
        'projection':projection_summary,
        'retained_failures':{'path':'retained-failures.json','sha256':digest(failures),'count':len(failures),'categories':dict(sorted(Counter(f['category'] for f in failures).items()))},
        'reviewed_projector_migrations':{'path':'reviewed-projector-migrations.json','sha256':digest(migrations),'count':len(migrations)},
        'diagnosis':{'classification':'reproduced_postcapture_archive_lock_boundary','evidence_sha256':request['diagnosis'],
            'reviewed_lock_repair':request['reviewed_lock_repair'],'integrity_scope':'exact_retained_uploaded_artifact_bytes',
            'failed_runtime_inode_captured':False,'failed_runtime_inventory_complete_attested':False,'original_final_guard_pass_attested':False},
        'frozen_v1_certification':{'result':'rejected','reason':BOUNDARY_REASON},'authority':request['authority'],'published':False,
        'offline_boundary':{'self_test_passed':True,'acquisition_attempts':DENIED,'dependency_bootstrap_denials':BOOTSTRAP_DENIED}}
    validate_schema(receipt, receipt_schema)
    output.mkdir()
    outputs = {'request.json':request_bytes,'api-evidence.json':evidence_bytes,'source-api-evidence.json':canonical(source_evidence),'producer-job.log':log,
        'validation-code-manifest.json':canonical(before_code),'captured-inventory.json':captured_bytes,'fresh-receipts.json':canonical(fresh),
        'retained-failures.json':canonical(failures),'reviewed-projector-migrations.json':canonical(migrations),projection_summary['path']:projection_bytes}
    for name, content in outputs.items():
        destination = safe(output / name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        write_verified_output(destination, content)
    require(before_code == code_inventory(frozen), 'Validation code changed during output creation')
    require(sha(read_bytes(source_zip,128*1024*1024)) == zip_sha and read_bytes(api_evidence) == evidence_bytes and read_bytes(job_log) == log, 'Captured input changed during output creation')
    # The success receipt is written exclusively and last, after verified outputs.
    write_verified_output(output / 'receipt.json', canonical(receipt), receipt=True)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source-zip','api-evidence','job-log','output'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    result = validate(source_zip=args.source_zip, api_evidence=args.api_evidence, job_log=args.job_log, output=args.output)
    print(json.dumps({'result':result['result'], 'receipt_sha256':sha((args.output/'receipt.json').read_bytes()),
                      'producer_conclusion':'failure', 'publication_authority':False, 'github_job_success_attested':False}))


if __name__ == '__main__':
    main()
