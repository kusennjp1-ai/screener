"""Successor admission and execution boundaries; no provider is constructed."""
from copy import deepcopy
from datetime import timedelta
import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('successor_refresh', ROOT/'.github/scripts/successor-statement-refresh.py')
successor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(successor)
BUNDLE = ROOT/'.github/bounded-refresh-successor'
NOW = successor.batch.clock('2026-10-10T09:45:00.000Z')
ENV = {'GITHUB_REPOSITORY':'kusennjp1-ai/screener','GITHUB_REF_NAME':'improve/financial-retention-successor',
    'GITHUB_EVENT_NAME':'push','GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_NUMBER':'1','GITHUB_RUN_ID':'99999999999',
    'GITHUB_SHA':'a'*40}


def admission():
    return json.loads((BUNDLE/'admission.json').read_bytes())


def test_private_candidate_is_disabled_and_dry_run_is_not_admission():
    value = admission()
    # Exercise a disabled fixture even when a separately reviewed rollout
    # explicitly enables the repository admission. Tests confer no permission.
    value['execution_enabled'] = False
    successor.validate_admission(value,now=NOW,dry_run=True,environment={})
    with pytest.raises(ValueError,match='not enabled'):
        successor.validate_admission(value,now=NOW,dry_run=False,environment=ENV)
    value['execution_enabled'] = True
    successor.validate_admission(value,now=NOW,dry_run=False,environment=ENV)


@pytest.mark.parametrize('key,value', [
    ('expected_run_number',2),('first_attempt_only',False),('repository_id',42),
    ('branch','main'),('workflow','.github/workflows/financial-statement-recovery.yml'),
    ('dispatch_not_after','2027-01-01T00:00:00Z'),('maximum_transport_requests',1001),
    ('maximum_statement_getter_calls',401),('selected_symbols',201),('selected_getters',400),
    ('additional_identity_requests',1),('price_refresh_requests',1),('publication_authority','publish'),
    ('execution_enabled','true'),('runtime_lock_sha256','0'*64),('first_attempt_only',1),
])
def test_admission_mutation_rejected(key,value):
    request = admission()
    request[key] = value
    with pytest.raises(ValueError):
        successor.validate_admission(request,now=NOW,dry_run=True,environment=ENV)


@pytest.mark.parametrize('key,value', [('run_id',1),('run_attempt',2),('conclusion','success'),
    ('artifact_id',1),('artifact_sha256','0'*64),('archive_manifest_sha256','0'*64),
    ('cohort_sha256','0'*64),('acquisition_base_sha256','0'*64)])
def test_source_mutation_rejected(key,value):
    request = admission()
    request['source'][key] = value
    with pytest.raises(ValueError):
        successor.validate_admission(request,now=NOW,dry_run=True,environment=ENV)


@pytest.mark.parametrize('when', ['2026-10-10T09:29:59.999Z','2026-10-10T10:30:00.001Z','2026-10-11T00:00:00Z'])
def test_expired_or_future_plan_cannot_be_revived_by_dry_run(when):
    with pytest.raises(ValueError,match='window'):
        successor.validate_admission(admission(),now=successor.batch.clock(when),dry_run=True,environment={})


@pytest.mark.parametrize('key,value', [('GITHUB_RUN_ATTEMPT','2'),('GITHUB_RUN_NUMBER','4'),
    ('GITHUB_REF_NAME','improve/mandatory-financial-source-recovery'),('GITHUB_EVENT_NAME','workflow_dispatch'),
    ('GITHUB_REPOSITORY','other/screener'),('GITHUB_SHA','fake'),('GITHUB_RUN_ID','0')])
def test_historical_or_unbound_execution_context_rejected(key,value):
    request = admission()
    request['execution_enabled'] = True
    env = {**ENV,key:value}
    with pytest.raises(ValueError):
        successor.validate_admission(request,now=NOW,dry_run=False,environment=env)


def test_closed_admission_and_pinned_bundle(tmp_path):
    request = admission()
    request['ignore_retention'] = True
    with pytest.raises(ValueError,match='Closed'):
        successor.validate_admission(request,now=NOW,dry_run=True,environment={})
    value,_,_,contents = successor.load_bundle(BUNDLE/'admission.json',now=NOW,dry_run=True,environment={})
    assert len(contents) == 5 and type(value['execution_enabled']) is bool
    import shutil
    shutil.copytree(BUNDLE,tmp_path/'bundle')
    path = tmp_path/'bundle/collector-plan.json'
    path.write_bytes(path.read_bytes()+b'\n')
    with pytest.raises(ValueError,match='Pinned successor bytes changed'):
        successor.load_bundle(tmp_path/'bundle/admission.json',now=NOW,dry_run=True,environment={})


def test_actual_setup_time_is_charged_and_finalization_reserve_cannot_be_used():
    assert successor.acquisition_allowance('2026-10-10T09:40:00Z',now=NOW) == 780
    assert successor.acquisition_allowance('2026-10-10T09:45:00Z',now=NOW) == 1080
    for when in (None,'2026-10-10T09:46:00Z','2026-10-10T09:27:00Z'):
        with pytest.raises(ValueError):
            successor.acquisition_allowance(when,now=NOW)


def test_disabled_candidate_fails_before_runtime_source_or_provider(tmp_path):
    request = admission()
    request['execution_enabled'] = False
    disabled = tmp_path/'disabled-admission.json'
    disabled.write_text(json.dumps(request))
    with patch.object(successor,'utc_now',return_value=NOW), patch.object(successor,'verify_runtime') as runtime, \
            patch.object(successor,'validate_restored') as source, patch.object(successor.batch,'collect') as collect:
        with pytest.raises(ValueError,match='not enabled'):
            successor.run(disabled,tmp_path/'missing',tmp_path/'output',tmp_path/'inventory.json',
                job_started_at='2026-10-10T09:45:00Z')
    runtime.assert_not_called()
    source.assert_not_called()
    collect.assert_not_called()
    assert not (tmp_path/'output').exists()


def test_fresh_preflight_binds_admission_exact_commit_and_clock():
    raw = (BUNDLE/'admission.json').read_bytes()
    response = {'admission_sha256':successor.sha256(raw),'checked_at':'2026-10-10T09:45:00Z',
        'current':{'id':int(ENV['GITHUB_RUN_ID']),'head_sha':ENV['GITHUB_SHA']}}
    from types import SimpleNamespace
    for mutation in ('valid','stale','wrong_admission','wrong_run','wrong_commit','future'):
        value = deepcopy(response)
        ready = NOW
        if mutation == 'stale':ready += timedelta(seconds=31)
        if mutation == 'future':ready -= timedelta(seconds=1)
        if mutation == 'wrong_admission':value['admission_sha256'] = '0'*64
        if mutation == 'wrong_run':value['current']['id'] += 1
        if mutation == 'wrong_commit':value['current']['head_sha'] = 'b'*40
        with patch.object(successor.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps(value))), \
                patch.object(successor,'utc_now',return_value=ready):
            if mutation == 'valid':
                assert successor.live_preflight(BUNDLE/'admission.json',raw,now=NOW,environment=ENV)[0] == value
            else:
                with pytest.raises(ValueError):
                    successor.live_preflight(BUNDLE/'admission.json',raw,now=NOW,environment=ENV)


def test_runtime_lock_covers_capture_and_retention_and_rejects_changes(tmp_path):
    successor.verify_runtime(ROOT,BUNDLE/'runtime-lock.json')
    lock = json.loads((BUNDLE/'runtime-lock.json').read_bytes())
    assert 'backend/app/services/statement_retention_budget.py' in lock['files']
    assert 'backend/app/services/financial_statement_batch.py' in lock['files']
    assert '.github/scripts/restore-successor-statement-source.mjs' in lock['files']
    assert '.github/workflows/financial-statement-successor.yml' in lock['files']
    bad = tmp_path/'runtime-lock.json'
    bad.write_bytes((BUNDLE/'runtime-lock.json').read_bytes()+b'\n')
    with pytest.raises(ValueError,match='Pinned'):
        successor.verify_runtime(ROOT,bad)


def test_workflow_has_hidden_upload_readback_and_no_publishing():
    workflow = (ROOT/'.github/workflows/financial-statement-successor.yml').read_text()
    assert 'include-hidden-files: true' in workflow
    assert 'verify-successor-artifact.py' in workflow and 'steps.upload.outputs.artifact-digest' in workflow
    assert 'group: financial-statement-recovery' in workflow and 'cancel-in-progress: false' in workflow
    assert 'timeout-minutes: 25' in workflow
    assert 'contents: read' in workflow and 'actions: read' in workflow
    assert 'contents: write' not in workflow and 'pages: write' not in workflow


@pytest.mark.parametrize('delay,initial,expected', [
    (0,'2026-10-10T10:29:59Z',None),
    (2,'2026-10-10T10:29:59Z','window'),
    (31,'2026-10-10T10:20:00Z','stale'),
    (0,'2026-10-10T10:30:01Z','window'),
])
def test_first_provider_gate_rechecks_actual_clock_after_preflight_persistence(tmp_path,delay,initial,expected):
    request = admission()
    request['execution_enabled'] = True
    clock = [successor.batch.clock(initial)]
    response = {'checked_at':initial}
    def persist(*args):
        clock[0] += timedelta(seconds=delay)
    with patch.object(successor,'utc_now',lambda:clock[0]), \
            patch.object(successor,'live_preflight',return_value=(response,clock[0])) as preflight, \
            patch.object(successor.archive,'_write_immutable',persist):
        call = lambda:successor.admit_first_provider(BUNDLE/'admission.json',b'fixture',request,tmp_path/'preflight.json',
            job_started_at=successor.batch.timestamp(clock[0]-timedelta(seconds=5)),environment=ENV)
        if expected:
            with pytest.raises(ValueError,match=expected):call()
        else:call()
    assert preflight.call_count == (0 if initial.endswith('10:30:01Z') else 1)


def test_slow_collector_setup_cannot_cross_dispatch_boundary(tmp_path):
    from tests.unit.test_financial_statement_batch import plan_for
    request = admission()
    request['execution_enabled'] = True
    clock = [successor.batch.clock('2026-10-10T10:29:59Z')]
    class SlowGuard:
        def check(self,stage):
            if stage == 'initial':clock[0] += timedelta(seconds=2)
    plan,base = plan_for(('NVDA',))
    def admit():
        successor.admit_first_provider(BUNDLE/'admission.json',b'fixture',request,tmp_path/'preflight.json',
            job_started_at='2026-10-10T10:29:00Z',environment=ENV)
    with patch.object(successor,'utc_now',lambda:clock[0]), patch.object(successor.batch,'utc_now',lambda:clock[0]), \
            patch.object(successor,'live_preflight') as preflight, patch.object(successor.batch,'make_session') as provider:
        with pytest.raises(ValueError,match='window'):
            successor.batch.collect(plan,base,tmp_path/'out',retention_guard=SlowGuard(),before_first_provider=admit)
    provider.assert_not_called()
    preflight.assert_not_called()
