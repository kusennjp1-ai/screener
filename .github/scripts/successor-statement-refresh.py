"""One explicitly reviewed successor capture; no historical admission reuse."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services.statement_retention_budget import StatementRetentionBudget

REVIEW_FILES = {
    'review.json': '01da520ff246f13b20af9fbd61ad3ab04a70562ccca5fc748661ebf6eb933ad7',
    'collector-plan.json': '65990368a2026d8742f108e9bf8f5b0223eb3f39263d246eaa8183fde6776b6d',
    'proposed-source-rechecks.json': 'bebbc2655c3fe3febfc9ecc7d125da9ab34de7fd268c1ff86344305e92c4cc86',
    'proposed-attempt-retry-decisions.json': 'a5be2e3da4bf676b3b94ba278818dab9aaa1eef3ff66a0b0514591e9f32997eb',
    'original-attempt-bindings.json': 'b3404ab9da64a6a9b30a8232b68b16ec500014ad995141909107205f3158eddb',
}
RUNTIME_LOCK_SHA256 = '77ac8a4d0922734cca425c3652036e30854555393163780f93e1653635a4969a'
BASE_SHA256 = '2524eeac36bcb79d3ebe75f7f57d5672e91e1dafcd80a23d180ae39de867b932'
COHORT_SHA256 = '36a83c34c33b0158f1d246226d8d538797c6c6e6494669c6feacefa82da12580'
ARCHIVE_SHA256 = '2593d2c737724da007a72091b7b85d6007530e0fb6fc7e4e0765d75692b007d0'
CACHE_SHA256 = '7bbb52b477569e454a7a88d8fe5b5252d4e9aa753657402d25f43b5952b8c03d'
CASES = ('NVDA', 'FUTU', 'AAOI', 'ALH', 'AVT')
EXCLUDED = frozenset(('BITU', 'ETHE', 'SBIT'))
SOURCE_CORE = {'repository':'kusennjp1-ai/screener', 'run_id':37478731832, 'run_attempt':1,
    'head_sha':'4715b218cc25720d1d3be455930554e1e6282136', 'artifact_id':11420873789,
    'artifact_sha256':'266b2118cefe4a51dcf0981b4e60c35ba76524e1f35cf9633f8c26691f68d2bd'}
SOURCE_DETAILS = {'workflow':'.github/workflows/financial-statement-recovery.yml',
    'workflow_id':374552819, 'head_branch':'improve/mandatory-financial-source-recovery',
    'run_number':4, 'status':'completed', 'conclusion':'failure',
    'artifact_name':'financial-statement-recovery-4715b218cc25720d1d3be455930554e1e6282136-1',
    'artifact_size_in_bytes':33424519, 'archive_manifest_sha256':ARCHIVE_SHA256,
    'acquisition_base_sha256':BASE_SHA256, 'cohort_sha256':COHORT_SHA256,
    'retained_receipts':4154, 'retained_symbols':1887}
ADMISSION_FIXED = {'schema_version':'financial-statement-successor-admission-v1',
    'request_id':'retention-repair-37478731832-attempt-1-20261010',
    'repository':'kusennjp1-ai/screener', 'repository_id':1203919607,
    'workflow':'.github/workflows/financial-statement-successor.yml', 'workflow_id':None,
    'branch':'improve/financial-retention-successor', 'event':'push', 'expected_run_number':1,
    'first_attempt_only':True, 'dispatch_not_before':'2026-10-10T09:30:00.000Z',
    'dispatch_not_after':'2026-10-10T10:30:00.000Z', 'required_valid_through':'2026-10-11T21:30:00Z',
    'selected_symbols':200, 'selected_getters':369, 'maximum_statement_getter_calls':400,
    'maximum_transport_requests':1000, 'maximum_acquisition_seconds':1080,
    'job_timeout_seconds':1500, 'finalization_reserve_seconds':420,
    'publication_authority':'none', 'additional_identity_requests':0, 'price_refresh_requests':0}
VERSIONS = {'yfinance':'0.2.66', 'curl_cffi':'0.16.3', 'pandas':'2.2.0', 'numpy':'1.26.3', 'requests':'2.31.0'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def utc_now():
    return datetime.now(timezone.utc)


def pinned(path, expected, maximum=2*1024*1024):
    value, content = batch.read_json(archive._safe(path), maximum)
    require(sha256(content) == expected, f'Pinned successor bytes changed: {Path(path).name}')
    return value, content


def check_clock(admission, now):
    require(batch.clock(admission['dispatch_not_before']) <= now <= batch.clock(admission['dispatch_not_after']),
            'Successor dispatch window expired or has not opened; regenerate the review')
    require(now + timedelta(seconds=admission['job_timeout_seconds'])
            <= batch.clock(admission['required_valid_through']), 'Successor horizon cannot cover this job')


def validate_admission(value, *, now, dry_run, environment):
    fixed = {**ADMISSION_FIXED, 'review_files':REVIEW_FILES, 'runtime_lock_sha256':RUNTIME_LOCK_SHA256,
             'source':{**SOURCE_CORE, **SOURCE_DETAILS}}
    require(isinstance(value, dict) and set(value) == set(fixed) | {'execution_enabled'}, 'Closed successor admission required')
    require(all(type(value[k]) is type(v) and value[k] == v for k,v in fixed.items()),
            'Successor admission identity, scope or source changed')
    require(type(value['execution_enabled']) is bool, 'Invalid successor execution permission')
    require(dry_run or value['execution_enabled'] is True, 'Successor execution is not enabled by the reviewed admission')
    check_clock(value, now)
    if not dry_run:
        expected = {'GITHUB_REPOSITORY':value['repository'], 'GITHUB_REF_NAME':value['branch'],
            'GITHUB_EVENT_NAME':value['event'], 'GITHUB_RUN_ATTEMPT':'1',
            'GITHUB_RUN_NUMBER':str(value['expected_run_number'])}
        require(all(environment.get(k) == v for k,v in expected.items()), 'Unadmitted successor workflow context')
        require(__import__('re').fullmatch(r'[a-f0-9]{40}', environment.get('GITHUB_SHA','')) is not None,
                'Missing exact successor commit identity')
        require(environment.get('GITHUB_RUN_ID','').isdigit() and int(environment['GITHUB_RUN_ID']) > 0,
                'Missing positive successor run identity')


def verify_runtime(repo, lock_path):
    lock, _ = pinned(lock_path, RUNTIME_LOCK_SHA256)
    require(set(lock) == {'schema_version','python','versions','files'}
            and lock['schema_version'] == 'financial-successor-runtime-lock-v1'
            and lock['python'] == '3.11' and lock['versions'] == VERSIONS, 'Malformed successor runtime lock')
    require(sys.version_info[:2] == (3,11), 'Reviewed successor requires Python 3.11')
    require(all(importlib.metadata.version(k) == v for k,v in VERSIONS.items()), 'Unreviewed statement transport version')
    require(isinstance(lock['files'],dict) and lock['files'], 'Missing successor runtime inventory')
    for relative, expected in lock['files'].items():
        path = PurePosixPath(relative)
        require(not path.is_absolute() and '..' not in path.parts and '\\' not in relative,
                'Unsafe runtime inventory path')
        require(relative.startswith(('backend/app/','.github/scripts/','.github/workflows/')),
                'Out-of-scope runtime inventory member')
        data = archive._safe(repo / relative).read_bytes()
        require(sha256(data) == expected, f'Unreviewed runtime source: {relative}')


def load_bundle(admission_path, *, now, dry_run, environment):
    admission, admission_bytes = archive._read(admission_path)
    validate_admission(admission, now=now, dry_run=dry_run, environment=environment)
    root = Path(admission_path).parent
    values, contents = {}, {}
    for name, expected in REVIEW_FILES.items():
        values[name], contents[name] = pinned(root/name, expected)
    require(values['review.json']['dispatch_approved'] is False
            and values['review.json']['execution_enabled'] is False, 'Historical private review was rewritten')
    require(values['collector-plan.json']['required_valid_through'] == admission['required_valid_through'],
            'Plan horizon changed')
    return admission, admission_bytes, values, contents


def validate_restored(restored, *, now):
    provenance, provenance_bytes = archive._read(restored/'restored.json')
    require(all(provenance.get(k) == v for k,v in SOURCE_CORE.items())
            and provenance.get('kind') == 'recovery_archive'
            and provenance.get('schema_version') == 'financial-source-restore-v1', 'Wrong successor retained source')
    files = restored/'files'
    base = archive._safe(files/'base.json').read_bytes()
    cohort, cohort_bytes = archive._read(files/'cohort.json')
    require(sha256(base) == BASE_SHA256 and sha256(cohort_bytes) == COHORT_SHA256,
            'Original acquisition base or ordered cohort bytes changed')
    cycle, _ = archive._read(files/'cycle.json')
    require(cycle.get('schema_version') == 'financial-recovery-cycle-v1' and cycle.get('phase') == 'completed'
            and cycle.get('archive_manifest_sha256') == ARCHIVE_SHA256 and cycle.get('code_revision') == SOURCE_CORE['head_sha']
            and cycle.get('base_artifact_sha256') == BASE_SHA256 and cycle.get('published') is False,
            'Retained failed-job cycle identity changed')
    loaded = archive.load_archive(files/'archive', ARCHIVE_SHA256, base_bytes=base, cohort=cohort, now=now)
    require(len(loaded.manifest['receipts']) == 4154, 'Retained source receipt count changed')
    return base, cohort, cohort_bytes, loaded, provenance_bytes


def validate_plan_sources(values, loaded, *, base, cohort, now):
    plan = values['collector-plan.json']
    batch.validate_plan(plan, base)
    # Keep original cohort.json order and bytes. The pinned exporter plan uses
    # canonical sorted membership; neither is silently rewritten to match.
    full = plan['verified_us_cohort']
    require(len(cohort['symbols']) == len(set(cohort['symbols'])) == 1894
            and full['symbols'] == sorted(cohort['symbols'])
            and full['base_artifact_sha256'] == cohort['base_artifact_sha256'] == BASE_SHA256,
            'Successor full-cohort membership or canonical plan order changed')
    rechecks = values['proposed-source-rechecks.json']
    retries = values['proposed-attempt-retry-decisions.json']
    bindings = values['original-attempt-bindings.json']
    require(set(rechecks) == {f'{s}/annual_history' for s in ('FUTU','ALH','AVT')}
            and len(retries) == len(bindings) == 6, 'Unbounded successor recheck scope')
    expected_attempts = {}
    for symbol in ('FUTU','ALH','AVT'):
        receipt = loaded.manifest['current'][f'{symbol}/income_stmt']
        context = loaded.acquisitions[receipt]['context']
        require(rechecks[f'{symbol}/annual_history'] == {'receipt_id':context['capture_id'],
            'recheck_after':ADMISSION_FIXED['dispatch_not_before']}, 'Annual recheck does not bind the current original receipt')
        for attribute in batch.ATTRIBUTES:
            choices = [a for a in loaded.manifest['attempts'].values()
                       if a['symbol'] == symbol and attribute in a['attributes']]
            latest = max(choices, key=lambda a:(a['attempted_at'],a['attempt_id']))
            require(latest['outcome'] == 'succeeded' and latest['http_status'] is None,
                    'A source denial or failure cannot be silently converted to a retry')
            expected_attempts[latest['attempt_id']] = latest
    require(set(retries) == set(expected_attempts)
            and all(value == ADMISSION_FIXED['dispatch_not_before'] for value in retries.values()),
            'Retry proposal is not the exact latest six getter attempts')
    require({x['original_attempt']['attempt_id']:x['original_attempt'] for x in bindings} == expected_attempts,
            'Original getter attempt metadata changed')
    planned, _, _ = archive.plan_archive(loaded, base_bytes=base, cohort=cohort, now=now,
        batch_limit=200, refresh_through=batch.clock(plan['required_valid_through']),
        source_rechecks=rechecks, retry_decisions=retries)
    require(planned.provider_state == 'available' and not planned.invalid_receipts,
            'Provider barrier or invalid original receipt stops successor acquisition')
    ready = [x for x in planned.required_work if x.ready_targets and x.symbol not in EXCLUDED]
    by_symbol = {x.symbol:x for x in ready}
    require(all(s in by_symbol and 'annual_history' in by_symbol[s].ready_targets for s in CASES),
            'The five reviewed verification cases are no longer ready')
    selected = [by_symbol[s] for s in CASES] + [x for x in ready if x.symbol not in CASES][:195]
    expected = [{'symbol':x.symbol,'attributes':list(x.attributes),'targets':list(x.ready_targets)} for x in selected]
    require(plan['selected'] == expected and plan['batch_allowlist'] == [x.symbol for x in selected]
            and len(expected) == 200 and sum(len(x['attributes']) for x in expected) == 369,
            'Current selected work differs from the exact reviewed 200/369 priority and order')
    return plan


def acquisition_allowance(started_at, *, now):
    require(isinstance(started_at,str) and started_at, 'An actual job-started-at clock is required')
    elapsed = (now-batch.clock(started_at)).total_seconds()
    require(0 <= elapsed < 1080, 'Actual setup time exhausted the bounded job allowance')
    allowance = min(1080,1500-elapsed-420)
    require(allowance > 0, 'Finalization reserve cannot be used for acquisition')
    return allowance


def live_preflight(admission_path, admission_bytes, *, now, environment):
    helper = Path(__file__).with_name('restore-successor-statement-source.mjs')
    result = subprocess.run(['node',str(helper),'--admission',str(admission_path),'--check-only'],
        check=True,capture_output=True,text=True,timeout=90)
    value = json.loads(result.stdout)
    require(value.get('admission_sha256') == sha256(admission_bytes), 'Fresh metadata check belongs to another admission')
    checked_at = batch.clock(value.get('checked_at'))
    ready = utc_now()
    require(0 <= (ready-checked_at).total_seconds() <= 30, 'Successor run inventory check is stale')
    require(str(value.get('current',{}).get('id')) == environment['GITHUB_RUN_ID']
            and value.get('current',{}).get('head_sha') == environment['GITHUB_SHA'],
            'Fresh inventory does not bind this successor run')
    return value, ready


def write_inventory(guard, path, *, verified):
    measured = guard.snapshot(force_bytes=True)
    entries = {name:{'bytes':item.size,'sha256':item.sha256} for name,item in measured['files'].items()}
    content = batch._json_bytes({'schema_version':'financial-successor-retained-inventory-v1',
        'final_retention_verified':verified,'files':entries})
    path.parent.mkdir(parents=True,exist_ok=True)
    archive._write_immutable(path,content)
    return sha256(content)


def admit_first_provider(admission_path, admission_bytes, admission, preflight_path, *, job_started_at, environment):
    # Called once by the collector, after its cache/runtime/retention setup.
    # There is no caller-supplied clock and no renewal on later getters.
    validate_admission(admission,now=utc_now(),dry_run=False,environment=environment)
    preflight,_ = live_preflight(admission_path,admission_bytes,now=utc_now(),environment=environment)
    archive._write_immutable(preflight_path,batch._json_bytes(preflight))
    ready_at = utc_now()
    require(0 <= (ready_at-batch.clock(preflight.get('checked_at'))).total_seconds() <= 30,
            'Successor run inventory check is stale at first provider construction')
    validate_admission(admission,now=ready_at,dry_run=False,environment=environment)
    acquisition_allowance(job_started_at,now=ready_at)


def run(admission_path, restored, output, inventory_path, *, dry_run=False, job_started_at=None):
    now = utc_now()
    admission, admission_bytes, values, contents = load_bundle(admission_path,now=now,dry_run=dry_run,environment=os.environ)
    repo = Path(__file__).resolve().parents[2]
    verify_runtime(repo,Path(admission_path).parent/'runtime-lock.json')
    if not dry_run:
        acquisition_allowance(job_started_at,now=now)
    base, cohort, cohort_bytes, original, provenance_bytes = validate_restored(restored,now=now)
    plan = validate_plan_sources(values,original,base=base,cohort=cohort,now=now)
    require(not output.exists(), 'Successor output must be new')
    require(output.resolve() not in inventory_path.resolve().parents and output.resolve() != inventory_path.resolve(),
            'Readback inventory must be outside the retained upload root')
    output.mkdir(parents=True)
    (output/'base.json').write_bytes(base)
    (output/'cohort.json').write_bytes(cohort_bytes)
    (output/'source-provenance.json').write_bytes(provenance_bytes)
    for name,content in contents.items():
        (output/name).write_bytes(content)
    (output/'successor-admission.json').write_bytes(admission_bytes)
    (output/'plan.json').write_bytes(contents['collector-plan.json'])
    shutil.copytree(original.root,output/'archive')
    cache, cache_sha = archive.export_cache(original,plan,base,output/'selected-cache',now=now)
    require(cache_sha == CACHE_SHA256,'Selected original cache identity changed')
    batch.write_json(output/'cycle.json',{'schema_version':'financial-recovery-cycle-v1','phase':'prepared',
        'dry_run':dry_run,'archive_manifest_sha256':ARCHIVE_SHA256,'base_artifact_sha256':BASE_SHA256,'published':False})
    if dry_run:
        summary, code = batch.collect(plan,base,output/'batch',cache_manifest=cache,cache_sha256=cache_sha,dry_run=True,
            acquisition_budget_seconds=1080,max_statement_getter_calls=400,max_transport_requests=1000)
        require(code == 0 and summary.get('mode') == 'dry_run','Successor dry run rejected')
        return {'mode':'dry_run','provider_requests':0,'selected_symbols':200,'selected_getters':369,
                'admission_enabled':admission['execution_enabled'],'published':False},0
    guard = StatementRetentionBudget(output,selected_symbols=200,max_transport_requests=1000)
    final_verified = False
    try:
        guard.check('initial')
        # Collector setup can also be expensive. Recheck immutable runtime now,
        # then admit only at its one-shot first-provider boundary below.
        verify_runtime(repo,Path(admission_path).parent/'runtime-lock.json')
        allowance = acquisition_allowance(job_started_at,now=utc_now())
        def first_provider():
            admit_first_provider(admission_path,admission_bytes,admission,inventory_path.parent/'successor-preflight.json',
                job_started_at=job_started_at,environment=os.environ)
        result, code = batch.collect(plan,base,output/'batch',cache_manifest=cache,cache_sha256=cache_sha,
            acquisition_budget_seconds=allowance,max_statement_getter_calls=400,max_transport_requests=1000,
            retention_guard=guard,before_first_provider=first_provider)
        guard.before_merge()
        digest = archive.merge_batch(output/'archive',ARCHIVE_SHA256,batch_dir=output/'batch',
            summary_sha256=sha256((output/'batch/summary.json').read_bytes()),base_bytes=base,cohort=cohort,now=utc_now(),
            maximum_manifest_bytes=guard.maximum_manifest_bytes)
        checked = archive.load_archive(output/'archive',digest,base_bytes=base,cohort=cohort,now=utc_now())
        cycle = {'schema_version':'financial-recovery-cycle-v1','phase':'completed','dry_run':False,
            'code_revision':os.environ['GITHUB_SHA'],'source_data_as_of':'2026-10-02','base_artifact_sha256':BASE_SHA256,
            'previous_archive_manifest_sha256':ARCHIVE_SHA256,'archive_manifest_sha256':digest,
            'retained_receipts':len(checked.manifest['receipts']),
            'retained_symbols':len({x['symbol'] for x in checked.manifest['receipts'].values()}),
            'selected_symbols':200,'provider_state_before':'available','exit_code':code,'published':False,
            'successor_request_id':admission['request_id'],'source_run_id':SOURCE_CORE['run_id'],
            'source_run_attempt':1,'source_run_conclusion':'failure'}
        cycle_sha = batch.write_json(output/'cycle.json',cycle)
        guard.authorize_finalization(archive_manifest_sha256=digest,cycle_sha256=cycle_sha,
            archive_object_sha256s=checked.manifest['objects'])
        retention = guard.verify_final()
        final_verified = True
        return {**cycle,'retention':retention,'acquisition_counts':result.get('counts')},code
    finally:
        # A partial or failed capture remains failed. Its exact bytes can still
        # be downloaded/read back; this marker never upgrades its conclusion.
        write_inventory(guard,inventory_path,verified=final_verified)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--admission',type=Path,required=True)
    parser.add_argument('--restored',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--inventory',type=Path,required=True)
    parser.add_argument('--job-started-at')
    parser.add_argument('--dry-run',action='store_true')
    args = parser.parse_args()
    summary, code = run(args.admission,args.restored,args.output,args.inventory,
        dry_run=args.dry_run,job_started_at=args.job_started_at)
    print(json.dumps(summary,sort_keys=True))
    raise SystemExit(code)
