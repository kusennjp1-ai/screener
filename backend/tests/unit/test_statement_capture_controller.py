"""Request-bound controller fixtures. No network or genuine provider construction."""
from copy import deepcopy
from datetime import timedelta
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('statement_capture',ROOT/'.github/scripts/run-statement-capture.py')
capture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capture)
NOW = capture.batch.clock('2026-10-11T11:00:00Z')
ENV = {'GITHUB_REPOSITORY':'kusennjp1-ai/screener','GITHUB_REPOSITORY_ID':'1203919607',
    'GITHUB_REF_NAME':'improve/financial-statement-capture','GITHUB_EVENT_NAME':'push','GITHUB_RUN_ATTEMPT':'1',
    'GITHUB_RUN_NUMBER':'1','GITHUB_RUN_ID':'99999999999','GITHUB_SHA':'a'*40,'GITHUB_JOB':'statement-capture',
    'GITHUB_WORKFLOW_REF':'kusennjp1-ai/screener/.github/workflows/financial-statement-capture.yml@refs/heads/improve/financial-statement-capture'}


def request():
    raw = (capture.BUNDLE/'request.json').read_bytes()
    return json.loads(raw),raw


def admission(active=False):
    value = json.loads((capture.BUNDLE/'admission.json').read_bytes())
    value.update(execution_enabled=active,dispatch_not_before=None,dispatch_not_after=None,required_valid_through=None)
    if active:
        value.update(dispatch_not_before='2026-10-11T10:55:00Z',dispatch_not_after='2026-10-11T11:10:00Z',
                     required_valid_through='2026-10-11T12:00:00Z')
    return value


@pytest.fixture(autouse=True)
def forbid_network_and_providers(monkeypatch):
    def blocked(*args,**kwargs):raise AssertionError('Synthetic test forbids external/provider request')
    monkeypatch.setattr('socket.socket.connect',blocked)
    monkeypatch.setattr(capture.batch,'make_session',blocked)


def test_exact_sealed_request_and_all_held_targets():
    value,raw = request()
    capture.validate_request(value,raw)
    assert len(raw) == 42472 and value['proposal']['batch_allowlist'][0] == 'CNH'
    assert value['proposal']['batch_allowlist'][-1] == 'ESTA'
    holds = value['held_selected_requirements']
    assert len(holds) == 21 and len({x['symbol'] for x in holds}) == 19
    assert all(x['requirement']['state'] == 'retry_decision_required' and x['requirement']['not_before'] is None for x in holds)
    assert sum(x['requirement']['target'] == 'eps' for x in holds) == 4
    assert sum(x['requirement']['target'] == 'sales' for x in holds) == 17
    assert value['proposal']['evaluation_time'] == value['proposal']['required_valid_through'] == '2026-10-11T10:33:59.924727Z'
    assert value['original_ledgers']['held_requirement_ledger']['count'] == 420
    assert value['original_ledgers']['retained_unsuccessful_attempts']['count'] == 34


@pytest.mark.parametrize('change', ['extra','reorder','symbol','target','getter','report','base','cohort','archive','clock','retry','resume','hold','ttl','bounds'])
def test_every_request_mutation_rejected(change):
    value,raw = request()
    if change == 'extra':value['extra']=True
    elif change == 'reorder':value['proposal']['selected'].reverse()
    elif change == 'symbol':value['proposal']['selected'][0]['symbol']='RH'
    elif change == 'target':value['proposal']['selected'][0]['targets'].append('eps')
    elif change == 'getter':value['proposal']['selected'][0]['attributes'].reverse()
    elif change == 'report':value['private_report']['bytes']+=1
    elif change in ('base','cohort','archive'):value['source'][{'base':'acquisition_base_sha256','cohort':'cohort_sha256','archive':'archive_manifest_sha256'}[change]]='0'*64
    elif change == 'clock':value['proposal']['evaluation_time']='2026-10-12T00:00:00Z'
    elif change == 'retry':value['retry_decisions']['attempt']='2026-10-11T11:00:00Z'
    elif change == 'resume':value['provider_resume']={}
    elif change == 'hold':value['held_selected_requirements'].pop()
    elif change == 'ttl':value['transform_policy']['ttl_mutable']=True
    elif change == 'bounds':value['bounds']['maximum_getter_calls']=401
    with pytest.raises(ValueError):capture.validate_request(value,capture.canonical(value)+b'\n')


@pytest.mark.parametrize('key,value',[('expected_run_number',2),('first_attempt_only',False),('repository_id',1),
    ('branch','main'),('workflow','.github/workflows/financial-statement-successor.yml'),('event','workflow_dispatch'),
    ('maximum_job_seconds',1501),('finalization_reserve_seconds',419),('maximum_preflight_age_seconds',31),
    ('request_sha256','0'*64),('runtime_lock_sha256','x'),('code_tree_sha256','x'),('execution_enabled','true'),
    ('first_attempt_only',1),('extra',True)])
def test_closed_admission_mutations(key,value):
    a=admission();a[key]=value
    with pytest.raises(ValueError):capture.validate_admission(a,now=NOW,dry_run=True,environment={})


def test_disabled_is_not_genuine_caller_or_execution_authority():
    a=admission()
    capture.validate_admission(a,now=NOW,dry_run=True,environment={})
    with pytest.raises(ValueError,match='disabled'):capture.validate_admission(a,now=NOW,dry_run=False,environment=ENV)
    with pytest.raises(ValueError,match='disabled admission'):capture.validate_admission(admission(True),now=NOW,dry_run=True,environment={})


@pytest.mark.parametrize('key,value',[('GITHUB_RUN_ATTEMPT','2'),('GITHUB_RUN_NUMBER','2'),('GITHUB_RUN_ID','0'),
    ('GITHUB_SHA','bad'),('GITHUB_REPOSITORY_ID','1'),('GITHUB_EVENT_NAME','pull_request'),
    ('GITHUB_REF_NAME','main'),('GITHUB_JOB','publish'),('GITHUB_WORKFLOW_REF','other'),('GITHUB_REPOSITORY','other/repo')])
def test_wrong_hosted_context_rejected(key,value):
    with pytest.raises(ValueError):capture.validate_admission(admission(True),now=NOW,dry_run=False,environment={**ENV,key:value})


@pytest.mark.parametrize('when',['2026-10-11T10:54:59Z','2026-10-11T11:10:01Z'])
def test_expired_future_window(when):
    with pytest.raises(ValueError,match='window'):capture.validate_admission(admission(True),now=capture.batch.clock(when),dry_run=False,environment=ENV)


@pytest.mark.parametrize('key,value',[('dispatch_not_after','2026-10-11T12:00:00Z'),
    ('required_valid_through','2026-10-11T11:34:59Z'),('required_valid_through','2026-10-15T00:00:00Z')])
def test_horizon_and_window_cannot_extend_policy(key,value):
    a=admission(True);a[key]=value
    with pytest.raises(ValueError):capture.validate_admission(a,now=NOW,dry_run=False,environment=ENV)


def test_setup_cost_and_reserve_exact_boundaries():
    assert capture.acquisition_allowance('2026-10-11T11:00:00Z',now=NOW)==1080
    assert capture.acquisition_allowance('2026-10-11T10:55:00Z',now=NOW)==780
    assert capture.acquisition_allowance('2026-10-11T10:42:01Z',now=NOW)==1
    for start in (None,'2026-10-11T11:00:01Z','2026-10-11T10:42:00Z','2026-10-11T10:35:00Z'):
        with pytest.raises(ValueError):capture.acquisition_allowance(start,now=NOW)
    assert capture.whole_job_remaining('2026-10-11T10:35:01Z',now=NOW)==1


@pytest.mark.parametrize('outcome,status',[('provider_blocked',None),('succeeded',403),('failed',429),('in_flight',None)])
def test_entire_attempt_ledger_provider_barrier_outside_cohort(outcome,status):
    loaded=SimpleNamespace(manifest={'attempts':{'outside':{'symbol':'OUTSIDE','outcome':outcome,'http_status':status}}})
    with pytest.raises(ValueError,match='barrier'):capture.provider_barrier(loaded)


def test_ordinary_failed_attempt_not_erased_or_automatically_retried():
    loaded=SimpleNamespace(manifest={'attempts':{'old':{'outcome':'failed','http_status':None}}})
    capture.provider_barrier(loaded)
    assert loaded.manifest['attempts']['old']['outcome']=='failed'


def ready_plan(req, *, extra_target=False):
    work=[]
    for x in req['proposal']['selected']:
        annual=SimpleNamespace(target='annual_history',state='ready',attributes=tuple(capture.batch.ATTRIBUTES))
        other=SimpleNamespace(target='eps',state='ready' if extra_target else 'retry_decision_required',attributes=('quarterly_income_stmt',))
        work.append(SimpleNamespace(symbol=x['symbol'],requirements=[annual,other]))
    return SimpleNamespace(provider_state='available',invalid_receipts=[],required_work=work,batch=['DO_NOT_USE'])


def test_revalidate_exact_annual_work_does_not_compare_ready_union_or_reselect():
    req,_=request();loaded=SimpleNamespace(manifest={'attempts':{}}); planned=ready_plan(req,extra_target=True)
    with patch.object(capture.archive,'plan_archive',return_value=(planned,{'selected':['wrong']},{})) as planner:
        assert capture.revalidate_selected(req,loaded,base=b'base',cohort={},now=NOW,horizon=NOW)==planned
    assert planner.call_args.kwargs.get('retry_decisions') is None
    assert all(x['targets']==['annual_history'] for x in req['proposal']['selected'])
    assert len(req['held_selected_requirements'])==21


@pytest.mark.parametrize('change',['held','missing','attributes','invalid','provider'])
def test_selected_annual_revalidation_fail_closed(change):
    req,_=request();loaded=SimpleNamespace(manifest={'attempts':{}}); planned=ready_plan(req)
    if change=='held':planned.required_work[0].requirements[0].state='retry_decision_required'
    if change=='missing':planned.required_work.pop(0)
    if change=='attributes':planned.required_work[0].requirements[0].attributes=('income_stmt',)
    if change=='invalid':planned.invalid_receipts=['bad']
    if change=='provider':planned.provider_state='blocked'
    with patch.object(capture.archive,'plan_archive',return_value=(planned,{},{})),pytest.raises(ValueError):
        capture.revalidate_selected(req,loaded,base=b'base',cohort={},now=NOW,horizon=NOW)


def test_transform_changes_only_two_clocks_and_hash_binds_exact_plan():
    req,_=request();original=deepcopy(req);a=admission(True)
    with patch.object(capture.batch,'validate_plan'),patch.object(capture,'revalidate_selected'):
        plan,transform=capture.execution_plan(req,a,None,base=b'base',cohort={'symbols':req['proposal']['verified_us_cohort']['symbols']},
            now=NOW,job_started_at='2026-10-11T10:59:00Z')
    assert req==original
    assert plan['evaluation_time']=='2026-10-11T11:00:00.000Z'
    assert plan['required_valid_through']=='2026-10-11T12:00:00.000Z'
    assert transform['execution_plan_sha256']==capture.sha(capture.batch._json_bytes(plan))
    for k,v in req['proposal'].items():
        if k not in ('evaluation_time','required_valid_through'):assert plan[k]==v
    assert transform['source_observations_changed'] is transform['ttl_changed'] is transform['selection_changed'] is False


@pytest.mark.parametrize('change',['before_proposal','too_long','too_short'])
def test_transform_clock_rejection(change):
    req,_=request();a=admission(True);now=NOW;start='2026-10-11T10:59:00Z'
    if change=='before_proposal':now=capture.batch.clock('2026-10-11T10:33:00Z')
    if change=='too_long':a['required_valid_through']='2026-10-15T00:00:00Z'
    if change=='too_short':a['required_valid_through']='2026-10-11T11:10:00Z'
    with pytest.raises(ValueError):capture.execution_plan(req,a,None,base=b'',cohort={},now=now,job_started_at=start)


def test_fixed_runtime_closure_and_pinned_versions():
    a=json.loads((capture.BUNDLE/'admission.json').read_bytes());lock,raw=capture.read(capture.BUNDLE/'runtime-lock.json')
    assert capture.sha(raw)==a['runtime_lock_sha256']
    capture.verify_runtime(ROOT,lock,a)
    assert capture.REQUIRED_RUNTIME<=set(lock['files'])


@pytest.mark.parametrize('change',['remove_owner','wrong_schema','wrong_version','unsafe','file_mutation'])
def test_runtime_closure_mutation(change):
    lock,_=capture.read(capture.BUNDLE/'runtime-lock.json')
    if change=='remove_owner':lock['files'].pop('.github/scripts/run-statement-capture.py')
    if change=='wrong_schema':lock['schema_version']='financial-successor-runtime-lock-v1'
    if change=='wrong_version':lock['versions']['yfinance']='99'
    if change=='unsafe':lock['files']['../escape']='0'*64
    if change=='file_mutation':lock['files']['.github/scripts/run-statement-capture.py']='0'*64
    with pytest.raises(ValueError):capture.verify_runtime(ROOT,lock,admission())


def test_live_metadata_bindings_and_post_await_clocks():
    contents={'capture-request.json':b'request','capture-admission.json':b'admission','capture-runtime-lock.json':b'lock'}
    proof={'schema_version':'financial-statement-capture-source-check-v1','request_sha256':capture.sha(b'request'),
        'admission_sha256':capture.sha(b'admission'),'runtime_lock_sha256':capture.sha(b'lock'),
        'checked_at':'2026-10-11T11:00:00Z','current':{'id':int(ENV['GITHUB_RUN_ID']),'head_sha':ENV['GITHUB_SHA']}}
    for mutation in ('none','stale','future','run','sha','request','admission','lock','schema'):
        p=deepcopy(proof);now=NOW
        if mutation=='stale':now+=timedelta(seconds=31)
        elif mutation=='future':now-=timedelta(seconds=1)
        elif mutation=='run':p['current']['id']+=1
        elif mutation=='sha':p['current']['head_sha']='b'*40
        elif mutation in ('request','admission','lock'):p[{'lock':'runtime_lock_sha256'}.get(mutation,mutation+'_sha256')]='0'*64
        elif mutation=='schema':p['schema_version']='financial-successor-source-check-v1'
        with patch.object(capture.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps(p))),patch.object(capture,'utc_now',return_value=now):
            if mutation=='none':assert capture.live_preflight(contents,environment=ENV)==p
            else:
                with pytest.raises(ValueError):capture.live_preflight(contents,environment=ENV)


def test_disabled_stops_before_live_source_output_or_provider(tmp_path):
    a=admission();req,raw=request()
    with patch.object(capture,'read',side_effect=[(req,raw),(a,b'fixture')]),patch.object(capture,'live_preflight') as live, \
         patch.object(capture,'validate_restored') as source,patch.object(capture.batch,'collect') as collector:
        with pytest.raises(ValueError,match='disabled'):capture.run(tmp_path/'source',tmp_path/'out',tmp_path/'inventory')
    live.assert_not_called();source.assert_not_called();collector.assert_not_called()
    assert not (tmp_path/'out').exists()


def test_partial_failure_inventory_cannot_be_upgraded_and_measurement_clock_is_charged(tmp_path):
    contents={'capture-request.json':b'r','capture-admission.json':b'a','capture-runtime-lock.json':b'l'}
    measure={'files':{'archive/.archive.lock':SimpleNamespace(size=0,sha256=capture.sha(b''))}}
    guard=SimpleNamespace(snapshot=lambda **_:measure)
    with patch.object(capture,'utc_now',return_value=NOW):
        v=capture.write_inventory(guard,tmp_path/'partial.json',contents=contents,environment=ENV,
            job_started_at='2026-10-11T10:59:00Z',verified=False)
    assert v['retained_inventory']['final_retention_verified'] is False
    with patch.object(capture,'utc_now',return_value=NOW),pytest.raises(ValueError):
        capture.write_inventory(guard,tmp_path/'timeout.json',contents=contents,environment=ENV,
            job_started_at='2026-10-11T10:35:00Z',verified=True)
    assert json.loads((tmp_path/'timeout.json').read_bytes())['retained_inventory']['final_retention_verified'] is False
    with patch.object(capture,'utc_now',side_effect=[NOW-timedelta(seconds=1),NOW]),pytest.raises(ValueError):
        capture.write_inventory(guard,tmp_path/'crossed.json',contents=contents,environment=ENV,
            job_started_at='2026-10-11T10:35:30Z',budget_started_at='2026-10-11T10:35:00Z',verified=True)
    assert json.loads((tmp_path/'crossed.json').read_bytes())['retained_inventory']['final_retention_verified'] is False


def test_no_new_provider_in_offline_controller_path():
    source=(ROOT/'.github/scripts/run-statement-capture.py').read_text()
    dry=source.split('        if dry_run:\n',1)[1].split('        verify_runtime',1)[0]
    assert 'batch.collect' not in dry and 'batch.load_cache' in dry
    assert 'genuine_hosted_caller' in dry and 'provider_requests' in dry


def test_exact_transport_package_abi_native_and_ca_closure():
    raw=(capture.BUNDLE/'transport-lock.json').read_bytes()
    capture.verify_transport_runtime(raw)
    value=json.loads(raw)
    assert value['maximum_native_admissions']==1000 and value['maximum_admissions_per_perform']==1
    assert value['packages']['curl_cffi']['files']['curl_cffi/_wrapper.abi3.so']=='79c9faa1630b25a5c0b7bd3d8fd19356fb3e98aa7ebf594a8fe3809ac65b75f0'
    assert value['packages']['certifi']['files']['certifi/cacert.pem']=='9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f'


@pytest.mark.parametrize('mutation',['version','native','ca','inventory','abi','platform','limit','redirect'])
def test_transport_dependency_mutations_fail_closed(mutation):
    value=json.loads((capture.BUNDLE/'transport-lock.json').read_bytes())
    if mutation=='version':value['packages']['curl_cffi']['version']='0.16.4'
    if mutation=='native':value['packages']['curl_cffi']['files']['curl_cffi/_wrapper.abi3.so']='0'*64
    if mutation=='ca':value['packages']['certifi']['files']['certifi/cacert.pem']='0'*64
    if mutation=='inventory':value['packages']['yfinance']['files'].pop(next(iter(value['packages']['yfinance']['files'])))
    if mutation=='abi':value['cffi_backend']['sha256']='0'*64
    if mutation=='platform':value['platform']='linux-aarch64'
    if mutation=='limit':value['maximum_native_admissions']=1001
    if mutation=='redirect':value['redirect_policy']='follow'
    with pytest.raises(ValueError):capture.verify_transport_runtime(capture.canonical(value))


def test_private_collector_seam_keeps_shared_runtime_unchanged_and_cache_ephemeral(monkeypatch):
    import logging
    import sys
    from yfinance import cache as yf_cache
    from yfinance.data import YfData
    # Explicit fresh-process fixture: inherited tests can leave a synthetic
    # singleton in this pytest process. Production rejects it rather than resets.
    monkeypatch.setattr(type(YfData),'_instances',{})
    for manager in (yf_cache._TzDBManager,yf_cache._CookieDBManager,yf_cache._ISINDBManager):
        monkeypatch.setattr(manager,'_db',None)
        monkeypatch.setattr(manager,'_cache_dir',manager._cache_dir)
    for manager,attribute in ((yf_cache._TzCacheManager,'_tz_cache'),
        (yf_cache._CookieCacheManager,'_Cookie_cache'),(yf_cache._ISINCacheManager,'_isin_cache')):
        monkeypatch.setattr(manager,attribute,None)
    original=capture.batch.runtime
    policy=SimpleNamespace(session_class=lambda requests:object)
    logger=logging.getLogger('yfinance');before=(logger.disabled,logger.level,logger.propagate)
    with capture.owned_collector(policy) as owned:
        assert owned is not capture.batch and capture.batch.runtime is original
        assert owned.collect.__code__.co_filename==capture.batch.collect.__code__.co_filename
        components=owned.runtime()
        assert components[1].Session is object and capture.batch.runtime is original
        location=Path(yf_cache._CookieDBManager.get_location())
        assert location.is_dir() and not list(location.iterdir())
        assert logger.disabled
        with pytest.raises(ValueError,match='replayed'):owned.runtime()
    assert not location.exists() and capture.batch.runtime is original
    assert 'app.services._statement_capture_owned_collector' not in sys.modules
    assert (logger.disabled,logger.level,logger.propagate)==before


def test_owned_collector_rejects_preexisting_yahoo_singleton(monkeypatch):
    from yfinance.data import YfData
    sentinel=object()
    monkeypatch.setattr(type(YfData),'_instances',{YfData:sentinel})
    with capture.owned_collector(SimpleNamespace(session_class=lambda requests:object)) as owned:
        with pytest.raises(ValueError,match='Preexisting Yahoo singleton'):owned.runtime()
    assert type(YfData)._instances[YfData] is sentinel


def test_native_ledger_reservation_and_no_shared_collector_mutation_static():
    source=(ROOT/'.github/scripts/run-statement-capture.py').read_text()
    assert 'batch.runtime =' not in source and 'batch.make_session =' not in source
    assert 'collector.collect(' in source
    assert "'expanded_bytes':4*1024*1024" in source
    assert "'compressed_bytes':3*1024*1024" in source
    assert "native-http-summary.json" in source and 'transport_calls_semantics' in source
    assert "verify_transport_runtime(contents['capture-transport-lock.json'])" in source


def test_native_space_reservation_covers_2001_events_and_atomic_mirror():
    report={'expanded_headroom_bytes':4*1024*1024,'compressed_headroom_bytes':3*1024*1024,'member_headroom':8}
    actual=capture.reserve_native_journal(report)
    assert actual['native_journal_reservation']['maximum_events']==2001
    assert actual['expanded_headroom_after_native_reserve']==actual['compressed_headroom_after_native_reserve']==0
    for key in report:
        with pytest.raises(ValueError,match='reservation'):capture.reserve_native_journal({**report,key:report[key]-1})


def test_native_journal_durable_append_uses_same_owned_descriptor(tmp_path,monkeypatch):
    calls=[];fsync=capture.os.fsync
    monkeypatch.setattr(capture.os,'fsync',lambda fd:(calls.append(capture.os.fstat(fd).st_mode),fsync(fd))[-1])
    def forbidden(*args,**kwargs):raise AssertionError('Journal must never replace, rename or unlink')
    monkeypatch.setattr(capture.os,'replace',forbidden)
    monkeypatch.setattr(capture.os,'unlink',forbidden)
    path=tmp_path/'native.jsonl'
    first=capture.persist_native_journal(path,b'first\n')
    second=capture.persist_native_journal(path,b'first\nsecond\n',first)
    assert first is second and path.read_bytes()==second['bytes']
    assert len(calls)==4 and not list(tmp_path.glob('*.pending'))
    capture.verify_native_journal(path,second)
    capture.close_native_journal(second)


@pytest.mark.parametrize('mutation',['same_bytes_inode','parent_inode','hardlink','bytes'])
def test_native_journal_actual_issuance_rechecks_ownership(tmp_path,mutation):
    parent=tmp_path/'batch';parent.mkdir();path=parent/'native.jsonl'
    token=capture.persist_native_journal(path,b'original\n')
    try:
        if mutation=='same_bytes_inode':path.rename(parent/'old');path.write_bytes(b'original\n')
        if mutation=='parent_inode':parent.rename(tmp_path/'old');parent.mkdir();capture.os.rename(tmp_path/'old/native.jsonl',path)
        if mutation=='hardlink':capture.os.link(path,parent/'link')
        if mutation=='bytes':path.write_bytes(b'mutated!\n')
        with pytest.raises(ValueError):capture.verify_native_journal(path,token)
    finally:capture.close_native_journal(token)


@pytest.mark.parametrize('mutation',['prior_bytes','prior_inode','output_swap','directory_swap','fsync_failure','before_write_swap','partial_write'])
def test_native_journal_mutation_and_persistence_failure_abort(tmp_path,monkeypatch,mutation):
    parent=tmp_path/'batch';parent.mkdir();path=parent/'native.jsonl'
    first=capture.persist_native_journal(path,b'original\n')
    if mutation=='prior_bytes':path.write_bytes(b'changed\n')
    if mutation=='prior_inode':path.rename(parent/'detached-old');path.write_bytes(b'original\n')
    fsync=capture.os.fsync;write=capture.os.write;done=[]
    def attack(fd):
        info=capture.os.fstat(fd)
        if not done:
            if mutation=='fsync_failure':done.append(1);raise OSError('Synthetic fsync failure')
            if mutation=='output_swap' and capture.stat.S_ISREG(info.st_mode):
                path.rename(parent/'detached-new');path.write_bytes(b'foreign');done.append(1)
            if mutation=='directory_swap' and capture.stat.S_ISDIR(info.st_mode):
                parent.rename(tmp_path/'detached-directory');parent.mkdir();(parent/'native.jsonl').write_bytes(b'foreign');done.append(1)
        return fsync(fd)
    def write_attack(fd,content):
        if mutation=='before_write_swap' and not done:
            path.rename(parent/'detached-new');path.write_bytes(b'foreign');done.append(1)
        if mutation=='partial_write':
            if done:raise OSError('Synthetic partial append failure')
            done.append(1);return write(fd,content[:3])
        return write(fd,content)
    monkeypatch.setattr(capture.os,'fsync',attack);monkeypatch.setattr(capture.os,'write',write_attack)
    try:
        with pytest.raises((ValueError,OSError)):capture.persist_native_journal(path,b'original\nupdated\n',first)
        if mutation in ('output_swap','directory_swap','before_write_swap'):assert path.read_bytes()==b'foreign'
        if mutation in ('output_swap','before_write_swap'):assert (parent/'detached-new').read_bytes()==b'original\nupdated\n'
        if mutation=='partial_write':assert path.read_bytes()==b'original\nupd'
        if mutation=='fsync_failure':assert path.read_bytes()==b'original\nupdated\n'
    finally:capture.close_native_journal(first)


def test_journal_cannot_reopen_closed_or_foreign_file(tmp_path):
    path=tmp_path/'native.jsonl';owned=capture.persist_native_journal(path,b'first\n')
    capture.close_native_journal(owned)
    with pytest.raises(ValueError):capture.persist_native_journal(path,b'first\nsecond\n',owned)
    with pytest.raises(FileExistsError):capture.persist_native_journal(path,b'foreign\n')
    assert path.read_bytes()==b'first\n'


# Fresh interpreters contain only synthetic protected modules for these probes.
_SOURCE_GUARD_SCRIPT = r'''"""Offline subprocess regressions; no provider construction/network/package edits.

Usage: /workspace/shared/financial-retention-repair/venv/bin/python this-file.py
All synthetic module, cached bytecode and mutation fixtures live in temporary dirs.
"""
import hashlib
import importlib
import importlib.machinery
import importlib.util
import json
import marshal
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
from types import ModuleType
import unittest

GUARD = Path(sys.argv[2])


def child(case):
    ns = {'__name__':'source_guard_probe','__file__':str(GUARD)}
    source = GUARD.read_bytes().split(b'_SOURCE_GUARD =',1)[0]
    exec(compile(source,str(GUARD),'exec'),ns)
    Guard = ns['CaptureSourceGuard']
    with tempfile.TemporaryDirectory(prefix='capture-source-guard-test-') as directory:
        root = Path(directory)
        app = root / 'app'
        app.mkdir()
        (app / '__init__.py').write_text('VALUE = "reviewed package"\n')
        source = app / 'reviewed.py'
        source.write_text('VALUE = "reviewed source"\n')
        marker = root / 'unreviewed-code-ran'
        digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        bindings = {'app': (app / '__init__.py', digest(app / '__init__.py'), True),
                    'app.reviewed': (source, digest(source), False)}
        sys.path.insert(0, str(root))

        def install():
            guard = Guard(bindings)
            sys.meta_path.insert(0, guard)
            return guard

        def rejected(callback, contains=None):
            try:
                callback()
            except (ImportError, OSError) as error:
                if contains is not None:
                    assert contains in str(error), str(error)
                assert not marker.exists(), 'unreviewed fixture executed'
                return
            raise AssertionError('unsafe import/check was accepted')

        def malicious_cache(path, legacy=False):
            state = path.stat()
            payload = compile(f'from pathlib import Path\nPath({str(marker)!r}).write_text("unsafe")\n'
                              'VALUE = "unreviewed bytecode"\n', str(path), 'exec')
            cache = path.with_suffix('.pyc') if legacy else Path(importlib.util.cache_from_source(str(path)))
            cache.parent.mkdir(exist_ok=True)
            cache.write_bytes(importlib.util.MAGIC_NUMBER
                              + struct.pack('<III', 0, int(state.st_mtime), state.st_size)
                              + marshal.dumps(payload))
            return cache

        if case in ('admission_bound_bootstrap', 'runtime_lock_mutation_rejected',
                    'transport_lock_mutation_rejected'):
            bundle = root / '.github' / 'financial-statement-capture'
            bundle.mkdir(parents=True)
            native = Path(importlib.machinery.PathFinder.find_spec('_cffi_backend').origin)
            transport = {'schema_version': 'statement-capture-transport-lock-v1',
                         'packages': {}, 'cffi_backend': {'filename': native.name, 'sha256': digest(native)}}
            for name, version in {'curl_cffi': '0.16.3', 'yfinance': '0.2.66',
                                  'certifi': '2026.7.22', 'cffi': '2.1.1'}.items():
                distribution = ns['importlib'].metadata.distribution(name)
                relative = name + '/__init__.py'
                transport['packages'][name] = {'version': version,
                    'files': {relative: digest(Path(distribution.locate_file(relative)))}}
            (bundle / 'transport-lock.json').write_text(json.dumps(transport))
            runtime = {'schema_version': 'financial-statement-capture-runtime-lock-v1',
                'files': {'.github/financial-statement-capture/transport-lock.json': digest(bundle / 'transport-lock.json'),
                          'backend/app/services/financial_statement_batch.py': '0' * 64,
                          '.github/scripts/statement-capture-transport.py': '0' * 64}}
            (bundle / 'runtime-lock.json').write_text(json.dumps(runtime))
            (bundle / 'admission.json').write_text(json.dumps({'runtime_lock_sha256': digest(bundle / 'runtime-lock.json')}))
            install_bundle = lambda: ns['install_source_guard'](root, bundle)
            if case == 'admission_bound_bootstrap':
                guard = install_bundle()
                assert not any(guard.protected(name) for name in sys.modules)
                assert len(guard.bindings) == 6
                guard.verify_loaded()
            else:
                target = 'runtime-lock.json' if case.startswith('runtime_') else 'transport-lock.json'
                with (bundle / target).open('a') as stream:
                    stream.write(' ')
                rejected(install_bundle, 'bytes changed')
        elif case == 'valid_pyc_ignored':
            cache = malicious_cache(source)
            original = source.read_bytes()
            guard = install()
            sys.dont_write_bytecode = True
            module = importlib.import_module('app.reviewed')
            assert module.VALUE == 'reviewed source' and source.read_bytes() == original
            assert not marker.exists() and cache.exists()
            guard.verify_loaded()
            assert isinstance(module.__loader__, ns['HashBoundSourceLoader'])
        elif case == 'baseline_proves_valid_pyc':
            malicious_cache(source)
            sys.dont_write_bytecode = True
            module = importlib.import_module('app.reviewed')
            assert module.VALUE == 'unreviewed bytecode' and marker.exists()
        elif case == 'preloaded_rejected':
            sys.modules['app'] = ModuleType('app')
            rejected(install, 'already loaded')
        elif case == 'unbound_rejected':
            (app / 'unbound.py').write_text(f'from pathlib import Path\nPath({str(marker)!r}).touch()\n')
            install()
            rejected(lambda: importlib.import_module('app.unbound'), 'unbound name')
        elif case == 'sourceless_rejected':
            malicious_cache(source, legacy=True)
            source.unlink()
            install()
            rejected(lambda: importlib.import_module('app.reviewed'), 'alternate origin')
        elif case == 'source_mutation_rejected':
            install()
            source.write_text(f'from pathlib import Path\nPath({str(marker)!r}).touch()\n')
            rejected(lambda: importlib.import_module('app.reviewed'), 'bytes changed')
        elif case == 'loaded_mutation_rejected':
            guard = install()
            importlib.import_module('app.reviewed')
            source.write_text('VALUE = "changed later"\n')
            rejected(guard.verify_loaded, 'bytes changed')
        elif case == 'alternate_origin_rejected':
            other = root / 'shadow'
            (other / 'app').mkdir(parents=True)
            (other / 'app' / '__init__.py').write_text(f'from pathlib import Path\nPath({str(marker)!r}).touch()\n')
            sys.path.insert(0, str(other))
            install()
            rejected(lambda: importlib.import_module('app'), 'alternate origin')
        elif case == 'alternate_package_route_rejected':
            install()
            module = importlib.import_module('app')
            module.__path__.append(str(root / 'extra'))
            rejected(lambda: importlib.import_module('app.reviewed'), 'alternate package route')
        elif case == 'injected_identity_rejected':
            guard = install()
            importlib.import_module('app.reviewed')
            sys.modules['app.reviewed'] = ModuleType('app.reviewed')
            rejected(guard.verify_loaded, 'loaded identity changed')
        elif case == 'bypass_loader_rejected':
            guard = install()
            module = importlib.import_module('app')
            foreign = ModuleType('app.foreign')
            sys.modules['app.foreign'] = foreign
            rejected(guard.verify_loaded, 'bypassed the guard')
        elif case == 'guard_removal_rejected':
            guard = install()
            importlib.import_module('app.reviewed')
            sys.meta_path.remove(guard)
            rejected(guard.verify_loaded, 'guard was removed')
        elif case == 'reload_rejected':
            install()
            module = importlib.import_module('app.reviewed')
            rejected(lambda: importlib.reload(module), 'reload')
        elif case == 'symlink_rejected':
            reviewed = root / 'safe.py'
            source.rename(reviewed)
            source.symlink_to(reviewed)
            install()
            rejected(lambda: importlib.import_module('app.reviewed'))
        elif case == 'hardlink_rejected':
            (root / 'other-link.py').hardlink_to(source)
            install()
            rejected(lambda: importlib.import_module('app.reviewed'), 'single-link')
        elif case == 'native_hash_rejected_before_dlopen':
            native = root / ('_cffi_backend' + importlib.machinery.EXTENSION_SUFFIXES[0])
            native.write_bytes(b'This is not an extension; attempting dlopen would give another error.')
            bindings['_cffi_backend'] = (native, '0' * 64, False)
            install()
            rejected(lambda: importlib.import_module('_cffi_backend'), 'bytes changed')
        elif case == 'reviewed_native_loads':
            spec = importlib.machinery.PathFinder.find_spec('_cffi_backend')
            native = Path(spec.origin)
            bindings['_cffi_backend'] = (native, digest(native), False)
            guard = install()
            module = importlib.import_module('_cffi_backend')
            assert isinstance(module.__loader__, ns['HashBoundExtensionLoader'])
            guard.verify_loaded()
        elif case == 'bound_alias_ignores_pyc':
            malicious_cache(source)
            guard = Guard(bindings, {'app.reviewed_alias': (source, digest(source), False)})
            sys.meta_path.insert(0, guard)
            importlib.import_module('app')
            module = guard.load_bound_alias('app.reviewed_alias')
            assert module.VALUE == 'reviewed source' and not marker.exists()
            guard.verify_loaded()
            rejected(lambda: guard.load_bound_alias('app.reviewed_alias'), 'replayed alias')
        else:
            raise AssertionError(case)
        print(json.dumps({'case': case, 'passed': True, 'provider_construction': False}))


CASES = ('admission_bound_bootstrap', 'runtime_lock_mutation_rejected',
         'transport_lock_mutation_rejected', 'baseline_proves_valid_pyc', 'valid_pyc_ignored', 'preloaded_rejected',
         'unbound_rejected', 'sourceless_rejected', 'source_mutation_rejected',
         'loaded_mutation_rejected', 'alternate_origin_rejected',
         'alternate_package_route_rejected', 'injected_identity_rejected',
         'bypass_loader_rejected', 'guard_removal_rejected', 'reload_rejected',
         'symlink_rejected', 'hardlink_rejected', 'native_hash_rejected_before_dlopen',
         'reviewed_native_loads', 'bound_alias_ignores_pyc')


child(sys.argv[1])
'''

@pytest.mark.parametrize("case",('admission_bound_bootstrap', 'runtime_lock_mutation_rejected', 'transport_lock_mutation_rejected', 'baseline_proves_valid_pyc', 'valid_pyc_ignored', 'preloaded_rejected', 'unbound_rejected', 'sourceless_rejected', 'source_mutation_rejected', 'loaded_mutation_rejected', 'alternate_origin_rejected', 'alternate_package_route_rejected', 'injected_identity_rejected', 'bypass_loader_rejected', 'guard_removal_rejected', 'reload_rejected', 'symlink_rejected', 'hardlink_rejected', 'native_hash_rejected_before_dlopen', 'reviewed_native_loads', 'bound_alias_ignores_pyc'))
def test_source_only_import_regression_in_fresh_process(case):
    result=capture.subprocess.run([capture.sys.executable,"-I","-B","-c",_SOURCE_GUARD_SCRIPT,case,str(ROOT/".github/scripts/run-statement-capture.py")],capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stdout+result.stderr
    assert json.loads(result.stdout)["passed"] is True


@pytest.mark.parametrize("mutation",["none","foreign_preinsert","foreign_replace","owner_replace","foreign_extra"])
def test_actual_source_only_bootstrap_and_both_direct_aliases_without_provider(mutation):
    script = """
import sys,socket
from pathlib import Path
root=Path(sys.argv[1]);entry=root/'.github/scripts/run-statement-capture.py'
def denied(*a,**k):raise AssertionError('Source-only smoke forbids provider/network')
socket.socket.connect=denied;socket.socket.connect_ex=denied
ns={'__name__':'source_guard_probe','__file__':str(entry)}
exec(compile(entry.read_bytes().split(b'_SOURCE_GUARD =',1)[0],str(entry),'exec'),ns)
sys.path.insert(0,str(root/'backend'))
mutation=sys.argv[2]
if mutation=='foreign_preinsert':
    sys.modules['curl_cffi._wrapper.lib']=object()
    try:ns['install_source_guard'](root,root/'.github/financial-statement-capture')
    except ImportError:
        print('verified without provider construction');raise SystemExit(0)
    raise AssertionError('Preinserted native export was accepted')
g=ns['install_source_guard'](root,root/'.github/financial-statement-capture')
import curl_cffi
curl_cffi.Curl.perform=denied
from curl_cffi import requests
requests.Session.__init__=denied
from app.services import financial_statement_batch,statement_artifact_archive,statement_retention_budget
collector=g.load_bound_alias('app.services._statement_capture_owned_collector')
assert collector.runtime()[0].__version__=='0.2.66'
g.load_bound_alias('statement_capture_transport')
g.verify_loaded()
assert len(g.bindings)==600 and len(g._ledger)>=20
if mutation!='none':
    if mutation=='foreign_replace':sys.modules['curl_cffi._wrapper.lib']=object()
    if mutation=='owner_replace':sys.modules['curl_cffi._wrapper'].lib=object()
    if mutation=='foreign_extra':sys.modules['curl_cffi._wrapper.foreign']=object()
    try:g.verify_loaded()
    except ImportError:pass
    else:raise AssertionError('Foreign native export identity accepted')
print('verified without provider construction')
"""
    result=capture.subprocess.run([capture.sys.executable,'-I','-B','-c',script,str(ROOT),mutation],capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stdout+result.stderr
    assert result.stdout.strip()=='verified without provider construction'


def test_imported_controller_has_no_provider_execution_without_cli_bootstrap():
    with pytest.raises(ValueError,match='source-only CLI'):capture.verify_executed_runtime()
