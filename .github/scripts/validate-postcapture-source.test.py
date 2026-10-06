"""Focused local guards; synthetic validator snapshots never assert a real run."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import zipfile

import pytest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('postcapture_adapter', HERE / 'validate-postcapture-source.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
REQUEST = json.loads((adapter.BUNDLE / 'request.json').read_bytes())
REQUEST_SCHEMA = json.loads((adapter.BUNDLE / 'request.schema.json').read_bytes())
NOW = datetime(2026, 10, 6, 16, 0, tzinfo=timezone.utc)


def validator_fixture(inventory=None):
    """Deliberately synthetic current-run metadata for local predicate tests."""
    head, tree, run_id, job_id = 'a' * 40, 'b' * 40, 12345, 23456
    expected = REQUEST['validator']
    identity = {'id':expected['repository_id'],'full_name':REQUEST['source']['repository']}
    run = {'id':run_id,'run_attempt':1,'event':'push','path':expected['workflow'],'head_branch':expected['branch'],
           'status':'in_progress','conclusion':None,'repository':identity,'head_repository':identity,'head_sha':head,
           'head_commit':{'id':head,'tree_id':tree},'run_started_at':'2026-10-06T15:00:00Z'}
    job = {'id':job_id,'run_id':run_id,'run_attempt':1,'head_sha':head,'name':expected['job'],'status':'in_progress','conclusion':None,'started_at':'2026-10-06T15:00:01Z'}
    gate = expected['publication_gate']
    inventory = inventory or {gate['path']:{'sha256':gate['sha256'],'git_blob_sha':gate['git_blob_sha'],'bytes':1}}
    return {'run':run,'job':job,'commit':{'sha':head,'tree':{'sha':tree},'parents':[{'sha':expected['first_parent_sha']}]},
            'tree':{'sha':tree,'truncated':False,'tree':[{'path':path,'type':'blob','mode':'100644','sha':info['git_blob_sha']} for path,info in inventory.items()]}}, inventory


def mutate(value, path, replacement):
    result = deepcopy(value)
    cursor = result
    for key in path[:-1]:
        cursor = cursor[key]
    cursor[path[-1]] = replacement
    return result


@pytest.mark.parametrize('path,value', [
    (['source','run_id'],37478731833),(['source','run_attempt'],2),(['source','head_sha'],'0'*40),
    (['source','artifact_id'],1),(['source','artifact_sha256'],'0'*64),(['artifact_size_bytes'],1),
    (['producer_tree_sha'],'0'*40),(['producer_job_id'],1),(['failure_boundary','job_log_sha256'],'0'*64),
    (['failure_boundary','producer_cycle_exit_code'],1),(['authority','publication'],True),
    (['authority','github_job_success'],True),(['frozen_validator','inventory_sha256'],'0'*64),
    (['captured_inventory','sha256'],'0'*64),(['baseline','manifest_sha256'],'0'*64),
    (['refresh','new_receipt_ids_sha256'],'0'*64),(['refresh','unchanged_current_slots'],3353),
    (['reviewed_lock_repair','commit'],'0'*40),(['reviewed_lock_repair','tree'],'0'*40),
    (['diagnosis','actual-data-lock-repair-final-replay.json'],'0'*64),
])
def test_closed_request_rejects_changed_binding(path, value):
    with pytest.raises(Exception):
        adapter.validate_schema(mutate(REQUEST,path,value), REQUEST_SCHEMA)


def test_closed_request_rejects_extra_fields():
    changed = deepcopy(REQUEST); changed['allow_failure'] = True
    with pytest.raises(Exception): adapter.validate_schema(changed, REQUEST_SCHEMA)
    changed = deepcopy(REQUEST); changed['source']['fallback'] = True
    with pytest.raises(Exception): adapter.validate_schema(changed, REQUEST_SCHEMA)


@pytest.mark.parametrize('raw', [b'{"source":{},"source":{}}', b'{"a":NaN}', b'{"a":Infinity}'])
def test_strict_json_rejects_ambiguous_data(raw):
    with pytest.raises(ValueError): adapter.parse(raw)


@pytest.mark.parametrize('path,value', [
    (['run','conclusion'],'success'),(['run','status'],'completed'),(['run','run_attempt'],2),
    (['run','head_branch'],'main'),(['run','event'],'workflow_dispatch'),(['run','path'],'other.yml'),
    (['run','repository','id'],1),(['run','head_commit','tree_id'],'c'*40),
    (['job','conclusion'],'success'),(['job','status'],'completed'),(['job','run_id'],1),
    (['job','head_sha'],'c'*40),(['job','name'],'statement-recovery'),
    (['commit','parents',0,'sha'],'c'*40),(['commit','tree','sha'],'c'*40),
    (['tree','truncated'],True),(['tree','tree',0,'sha'],'c'*40),
    (['tree','tree',0,'mode'],'120000'),(['job','started_at'],'2026-10-07T15:00:00Z'),
])
def test_current_validator_identity_guards(path, value):
    value_fixture, inventory = validator_fixture()
    with pytest.raises(ValueError): adapter.verify_validator(REQUEST, mutate(value_fixture,path,value), inventory,NOW)


def test_validator_snapshot_does_not_attest_success():
    evidence, inventory = validator_fixture()
    actual = adapter.verify_validator(REQUEST,evidence,inventory,NOW)
    assert actual['successful_run_attested'] is False
    assert actual['authentication'] == 'provided_api_snapshot_requires_independent_authentication'
    evidence['tree']['tree'].append(deepcopy(evidence['tree']['tree'][0]))
    with pytest.raises(ValueError): adapter.verify_validator(REQUEST,evidence,inventory,NOW)


def test_frozen_closure_and_diagnosis_are_exact():
    request,*_ = adapter.load_policy()
    adapter.verify_diagnosis(request)
    changed = deepcopy(request); changed['reviewed_lock_repair']['files']['backend/app/services/statement_retention_budget.py']['unchanged_from_original_producer_tree'] = False
    with pytest.raises(ValueError): adapter.verify_diagnosis(changed)


@pytest.mark.parametrize('member', ['../escape.json','/absolute.json','dir//file','dir\\file','folder/'])
def test_source_zip_rejects_unsafe_names(tmp_path, member):
    path = tmp_path/'source.zip'
    with zipfile.ZipFile(path,'w') as out: out.writestr(member,b'{}')
    request = deepcopy(REQUEST); request['artifact_size_bytes'] = path.stat().st_size; request['source']['artifact_sha256'] = adapter.sha(path.read_bytes())
    inventory = {'member_count':1,'files':{member:{'bytes':2,'sha256':adapter.sha(b'{}')}},'expanded_bytes':2}
    with pytest.raises(ValueError): adapter.verify_zip_inventory(path,request,inventory)


def test_source_zip_rejects_missing_duplicate_and_changed_files(tmp_path):
    path = tmp_path/'source.zip'
    with zipfile.ZipFile(path,'w') as out: out.writestr('cycle.json',b'{}')
    request = deepcopy(REQUEST); request['artifact_size_bytes'] = path.stat().st_size; request['source']['artifact_sha256'] = adapter.sha(path.read_bytes())
    inventory = {'member_count':1,'files':{'cycle.json':{'bytes':2,'sha256':adapter.sha(b'{}')}},'expanded_bytes':2}
    assert adapter.verify_zip_inventory(path,request,inventory) == request['source']['artifact_sha256']
    inventory['files']['cycle.json']['sha256'] = '0'*64
    with pytest.raises(ValueError): adapter.verify_zip_inventory(path,request,inventory)
    inventory['member_count'] = 2
    with pytest.raises(ValueError): adapter.verify_zip_inventory(path,request,inventory)


def test_new_receipt_and_current_slot_bindings_reject_mutations():
    # Small semantic fixture uses the same set/digest checks, without finance math.
    a,b,c = 'a'*64,'b'*64,'c'*64
    old = {'receipts':{a:{}},'current':{'OLD/income_stmt':a}}
    loaded = SimpleNamespace(manifest={'receipts':{a:{}},'current':{'OLD/income_stmt':a}},objects={})
    with pytest.raises(ValueError,match='fresh receipt identities'):
        adapter.verify_refresh(loaded,old,{'selected':[]},{},[],REQUEST)
    loaded.manifest['receipts'][b] = {'symbol':'X','attribute':'income_stmt','capture_id':'x'}
    request = deepcopy(REQUEST); request['refresh']['new_receipts'] = 1; request['refresh']['new_receipt_ids_sha256'] = adapter.digest([b]); request['refresh']['new_receipt_inventory_sha256'] = adapter.digest([{'sha256':b,**loaded.manifest['receipts'][b]}])
    loaded.manifest['current']['OLD/income_stmt'] = c
    with pytest.raises(ValueError,match='Untargeted current slots'):
        adapter.verify_refresh(loaded,old,{'selected':[]},{},[],request)


def test_projection_contract_and_bound_fail_closed():
    certifier = SimpleNamespace(SCHEMA='expected',POLICY='policy')
    adapter.projection_guard(b'{}',{'schema_version':'expected','projection_policy':'policy'},certifier)
    with pytest.raises(ValueError): adapter.projection_guard(b'{}',{'schema_version':'wrong','projection_policy':'policy'},certifier)
    class Oversized:
        def __len__(self): return adapter.MAX_PROJECTION + 1
    with pytest.raises(ValueError): adapter.projection_guard(Oversized(),{'schema_version':'expected','projection_policy':'policy'},certifier)


def test_cli_has_no_clock_or_code_override(tmp_path):
    result = subprocess.run([sys.executable,str(HERE/'validate-postcapture-source.py'),'--help'],capture_output=True,text=True,check=True)
    assert all(flag in result.stdout for flag in ['--source-zip','--api-evidence','--job-log','--output'])
    assert all(flag not in result.stdout for flag in ['--now','--code-sha','--trust','--evaluated-at'])
    result = subprocess.run([sys.executable,str(HERE/'validate-postcapture-source.py'),'--now','2026-10-06T14:45:03Z'],capture_output=True,text=True)
    assert result.returncode != 0


def test_acquisition_boundary_blocks_before_frozen_imports():
    code = f'''import importlib.util
s=importlib.util.spec_from_file_location("adapter",{str(HERE/'validate-postcapture-source.py')!r});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.install_offline_boundary()
import socket, subprocess, yfinance
for function in (socket.socket,subprocess.Popen,yfinance.Ticker):
 try: function()
 except RuntimeError: pass
 else: raise AssertionError("acquisition allowed")
assert m.DENIED == ["socket.socket","subprocess.Popen","yfinance.Ticker"]
print("blocked")
'''
    result = subprocess.run([sys.executable,'-c',code],capture_output=True,text=True,check=True)
    assert result.stdout.strip() == 'blocked'


def execution_fixture():
    request = deepcopy(REQUEST)
    log = b'Traceback (most recent call last):\nretention_report = retention_guard.verify_final()\nRetentionIntegrityError: Unowned retained source addition\n##[error]Process completed with exit code 1.\n'
    request['failure_boundary']['job_log_sha256'] = adapter.sha(log)
    request['failure_boundary']['job_log_bytes'] = len(log)
    evidence = {'run':{'conclusion':'failure','head_commit':{'tree_id':request['producer_tree_sha']}},'jobs':[
        {'name':'statement-recovery','id':request['producer_job_id'],'conclusion':'failure','started_at':'2026-10-06T14:24:48Z','completed_at':'2026-10-06T14:40:09Z',
         'steps':[{'status':'completed','conclusion':'failure','name':request['failure_boundary']['failed_step_name'],'number':10,'completed_at':'2026-10-06T14:39:56Z'}]}]}
    cycle = {'schema_version':'financial-recovery-cycle-v1','phase':'completed','dry_run':False,'published':False,
             'code_revision':request['source']['head_sha'],'archive_manifest_sha256':request['source']['archive_manifest_sha256'],
             'base_artifact_sha256':request['source']['acquisition_base_sha256'],'source_data_as_of':'2026-10-02',
             'previous_archive_manifest_sha256':request['baseline']['manifest_sha256'],'exit_code':0,'selected_symbols':200}
    summary = {'exit_code':0,'selected_symbols':200,'provider_stop':None,'execution_stop':None,'statement_getter_calls':400,'transport_calls':408,
               'counts':{'captured_attributes':400,'failed_attributes':0,'reused_attributes':0},'evaluation_time':'2026-10-06T14:39:21.413Z'}
    return {'request':request,'source_evidence':evidence,'cycle':cycle,'base':{'as_of_date':'2026-10-02'},'summary':summary,'log':log,'now':NOW}


@pytest.mark.parametrize('path,value', [
    (['cycle','exit_code'],False),(['cycle','exit_code'],1),(['cycle','selected_symbols'],200.0),
    (['cycle','source_data_as_of'],'2026-10-03'),(['cycle','published'],True),(['cycle','phase'],'failed'),
    (['summary','provider_stop'],{'reason':'blocked'}),(['summary','execution_stop'],{'reason':'budget'}),
    (['summary','statement_getter_calls'],399),(['summary','transport_calls'],407),(['summary','counts','reused_attributes'],1),
    (['source_evidence','run','conclusion'],'success'),(['source_evidence','jobs',0,'steps',0,'number'],9),
])
def test_original_execution_boundary_negatives(path,value):
    fixture = execution_fixture()
    adapter.verify_execution(**fixture)
    with pytest.raises(ValueError): adapter.verify_execution(**mutate(fixture,path,value))


def test_request_raw_bytes_are_pinned(monkeypatch):
    original = adapter.read_json
    def changed(path,*args):
        value,body = original(path,*args)
        return (value,body+b' ') if Path(path).name == 'request.json' else (value,body)
    monkeypatch.setattr(adapter,'read_json',changed)
    with pytest.raises(ValueError,match='request bytes changed'): adapter.load_policy()


def test_verified_output_is_exclusive_and_partial_receipt_removed(tmp_path,monkeypatch):
    path = tmp_path/'ordinary.json'
    adapter.write_verified_output(path,b'{}')
    with pytest.raises(FileExistsError): adapter.write_verified_output(path,b'other')
    assert path.read_bytes() == b'{}'
    monkeypatch.setattr(adapter,'read_bytes',lambda *args:b'wrong')
    receipt = tmp_path/'receipt.json'
    with pytest.raises(ValueError,match='readback'): adapter.write_verified_output(receipt,b'{}',receipt=True)
    assert not receipt.exists()
    # A failed exclusive open must never delete a pre-existing file.
    with pytest.raises(FileExistsError): adapter.write_verified_output(path,b'other',receipt=True)
    assert path.read_bytes() == b'{}'


def test_frozen_current_projection_keeps_expired_receipt_unknown():
    result = subprocess.run([sys.executable,str(Path(__file__).resolve()),'--expiry-probe'],capture_output=True,text=True,check=True)
    actual = json.loads(result.stdout)
    assert actual == {'fresh':'ordinary','expired':'unknown','source_clock_preserved':True,'provider_calls':0}


def expiry_probe():
    adapter.install_offline_boundary()
    adapter.load_policy()
    sys.path.insert(0,str(adapter.FROZEN/'backend'))
    from app.services import statement_source_certification as certifier
    from app.services import financial_statement_batch as batch
    raw = json.loads(EXPIRY_RECEIPT)
    receipt_sha = adapter.sha(EXPIRY_RECEIPT.encode())
    assert receipt_sha == 'f6377d5e77eada3c89e3acb03252cc82a1b91f84156600db29cb5009455af4b0'
    fresh_now = datetime(2026,10,6,15,0,tzinfo=timezone.utc)
    expired_now = datetime(2026,10,19,15,0,tzinfo=timezone.utc)
    assert expired_now < adapter.clock('2026-10-20T14:39:58Z')
    frame,context,reason = batch.validate_acquisition(raw,'NVDA','quarterly_income_stmt',now=fresh_now,as_of=batch.day('2026-10-02'))
    entry = {'symbol':'NVDA','attribute':'quarterly_income_stmt','capture_id':context['capture_id'],'observed_at':context['observed_at'],'origin_binding':{'base_artifact_sha256':REQUEST['source']['acquisition_base_sha256'],'source_data_as_of':'2026-10-02'}}
    loaded = SimpleNamespace(manifest={'receipts':{receipt_sha:entry},'current':{'NVDA/quarterly_income_stmt':receipt_sha}},acquisitions={receipt_sha:{'raw':raw,'bytes':EXPIRY_RECEIPT.encode(),'frame':frame,'context':context,'reason':reason,'origin_binding':entry['origin_binding']}})
    original = adapter.canonical(loaded.manifest)
    first,_,_ = certifier.current_projection(loaded,{'symbols':['NVDA']},now=fresh_now,as_of='2026-10-02')
    second,_,_ = certifier.current_projection(loaded,{'symbols':['NVDA']},now=expired_now,as_of='2026-10-02')
    assert adapter.canonical(loaded.manifest) == original and first['receipt_inventory'] == second['receipt_inventory']
    assert not adapter.DENIED
    print(json.dumps({'fresh':first['symbols']['NVDA']['availability_classification']['eps_growth_yy'],
                      'expired':second['symbols']['NVDA']['availability_classification']['eps_growth_yy'],
                      'source_clock_preserved':second['receipt_inventory'][0]['observed_at']==context['observed_at'],'provider_calls':0}))


# Verbatim single captured quarterly receipt, publicly reported NVDA data.
# It is an immutable source fixture, not an acquisition result generated by tests.
EXPIRY_RECEIPT = '{\n  "attribute": "quarterly_income_stmt",\n  "failure": null,\n  "full_http_bodies_archived": false,\n  "getter_completed_at": "2026-10-06T14:26:52.150Z",\n  "original_frame_cells": {\n    "columns": [\n      "2026-07-31 00:00:00",\n      "2026-04-30 00:00:00",\n      "2026-01-31 00:00:00",\n      "2025-10-31 00:00:00",\n      "2025-07-31 00:00:00"\n    ],\n    "format": "original-yfinance-frame-cells-v1",\n    "rows": [\n      {\n        "metric": "Tax Effect Of Unusual Items",\n        "values": [\n          1282215000.0,\n          0.0,\n          0.0,\n          0.0,\n          343791000.0\n        ]\n      },\n      {\n        "metric": "Tax Rate For Calcs",\n        "values": [\n          0.165,\n          0.165687,\n          0.147585,\n          0.158846,\n          0.153304\n        ]\n      },\n      {\n        "metric": "Normalized EBITDA",\n        "values": [\n          65090000000.0,\n          71002000000.0,\n          51283000000.0,\n          38748000000.0,\n          29690000000.0\n        ]\n      },\n      {\n        "metric": "Total Unusual Items",\n        "values": [\n          7771000000.0,\n          {\n            "non_finite_number": "NaN"\n          },\n          {\n            "non_finite_number": "NaN"\n          },\n          {\n            "non_finite_number": "NaN"\n          },\n          2247000000.0\n        ]\n      },\n      {\n        "metric": "Total Unusual Items Excluding Goodwill",\n        "values": [\n          7771000000.0,\n          {\n            "non_finite_number": "NaN"\n          },\n          {\n            "non_finite_number": "NaN"\n          },\n          {\n            "non_finite_number": "NaN"\n          },\n          2247000000.0\n        ]\n      },\n      {\n        "metric": "Net Income From Continuing Operation Net Minority Interest",\n        "values": [\n          59688000000.0,\n          58321000000.0,\n          42960000000.0,\n          31910000000.0,\n          26422000000.0\n        ]\n      },\n      {\n        "metric": "Reconciled Depreciation",\n        "values": [\n          1127000000.0,\n          997000000.0,\n          812000000.0,\n          751000000.0,\n          669000000.0\n        ]\n      },\n      {\n        "metric": "Reconciled Cost Of Revenue",\n        "values": [\n          24079000000.0,\n          20458000000.0,\n          17034000000.0,\n          15157000000.0,\n          12890000000.0\n        ]\n      },\n      {\n        "metric": "EBITDA",\n        "values": [\n          72861000000.0,\n          71002000000.0,\n          51283000000.0,\n          38748000000.0,\n          31937000000.0\n        ]\n      },\n      {\n        "metric": "EBIT",\n        "values": [\n          71734000000.0,\n          70005000000.0,\n          50471000000.0,\n          37997000000.0,\n          31268000000.0\n        ]\n      },\n      {\n        "metric": "Net Interest Income",\n        "values": [\n          269000000.0,\n          438000000.0,\n          495000000.0,\n          563000000.0,\n          530000000.0\n        ]\n      },\n      {\n        "metric": "Interest Expense",\n        "values": [\n          227000000.0,\n          102000000.0,\n          73000000.0,\n          61000000.0,\n          62000000.0\n        ]\n      },\n      {\n        "metric": "Interest Income",\n        "values": [\n          496000000.0,\n          540000000.0,\n          568000000.0,\n          624000000.0,\n          592000000.0\n        ]\n      },\n      {\n        "metric": "Normalized Income",\n        "values": [\n          53199215000.0,\n          58321000000.0,\n          42960000000.0,\n          31910000000.0,\n          24518791000.0\n        ]\n      },\n      {\n        "metric": "Net Income From Continuing And Discontinued Operation",\n        "values": [\n          59688000000.0,\n          58321000000.0,\n          42960000000.0,\n          31910000000.0,\n          26422000000.0\n        ]\n      },\n      {\n        "metric": "Total Expenses",\n        "values": [\n          32487000000.0,\n          28079000000.0,\n          23828000000.0,\n          20996000000.0,\n          18303000000.0\n        ]\n      },\n      {\n        "metric": "Total Operating Income As Reported",\n        "values": [\n          63734000000.0,\n          53536000000.0,\n          44299000000.0,\n          36010000000.0,\n          28440000000.0\n        ]\n      },\n      {\n        "metric": "Diluted Average Shares",\n        "values": [\n          24285000000.0,\n          24391000000.0,\n          24432000000.0,\n          24483000000.0,\n          24532000000.0\n        ]\n      },\n      {\n        "metric": "Basic Average Shares",\n        "values": [\n          24190000000.0,\n          24286000000.0,\n          24304000000.0,\n          24327000000.0,\n          24366000000.0\n        ]\n      },\n      {\n        "metric": "Diluted EPS",\n        "values": [\n          2.46,\n          2.39,\n          1.76,\n          1.3,\n          1.08\n        ]\n      },\n      {\n        "metric": "Basic EPS",\n        "values": [\n          2.47,\n          2.4,\n          1.77,\n          1.31,\n          1.08\n        ]\n      },\n      {\n        "metric": "Diluted NI Availto Com Stockholders",\n        "values": [\n          59688000000.0,\n          58321000000.0,\n          42960000000.0,\n          31910000000.0,\n          26422000000.0\n        ]\n      },\n      {\n        "metric": "Net Income Common Stockholders",\n        "values": [\n          59688000000.0,\n          58321000000.0,\n          42960000000.0,\n          31910000000.0,\n          26422000000.0\n        ]\n      },\n      {\n        "metric": "Net Income",\n        "values": [\n          59688000000.0,\n          58321000000.0,\n          42960000000.0,\n          31910000000.0,\n          26422000000.0\n        ]\n      },\n      {\n        "metric": "Net Income Including Noncontrolling Interests",\n        "values": [\n          59688000000.0,\n          58321000000.0,\n          42960000000.0,\n          31910000000.0,\n          26422000000.0\n        ]\n      },\n      {\n        "metric": "Net Income Continuous Operations",\n        "values": [\n          59688000000.0,\n          58321000000.0,\n          42960000000.0,\n          31910000000.0,\n          26422000000.0\n        ]\n      },\n      {\n        "metric": "Tax Provision",\n        "values": [\n          11819000000.0,\n          11582000000.0,\n          7438000000.0,\n          6026000000.0,\n          4784000000.0\n        ]\n      },\n      {\n        "metric": "Pretax Income",\n        "values": [\n          71507000000.0,\n          69903000000.0,\n          50398000000.0,\n          37936000000.0,\n          31206000000.0\n        ]\n      },\n      {\n        "metric": "Other Income Expense",\n        "values": [\n          7504000000.0,\n          15929000000.0,\n          5604000000.0,\n          1363000000.0,\n          2236000000.0\n        ]\n      },\n      {\n        "metric": "Other Non Operating Income Expenses",\n        "values": [\n          -267000000.0,\n          15929000000.0,\n          5604000000.0,\n          1363000000.0,\n          -11000000.0\n        ]\n      },\n      {\n        "metric": "Gain On Sale Of Security",\n        "values": [\n          7771000000.0,\n          {\n            "non_finite_number": "NaN"\n          },\n          {\n            "non_finite_number": "NaN"\n          },\n          {\n            "non_finite_number": "NaN"\n          },\n          2247000000.0\n        ]\n      },\n      {\n        "metric": "Net Non Operating Interest Income Expense",\n        "values": [\n          269000000.0,\n          438000000.0,\n          495000000.0,\n          563000000.0,\n          530000000.0\n        ]\n      },\n      {\n        "metric": "Interest Expense Non Operating",\n        "values": [\n          227000000.0,\n          102000000.0,\n          73000000.0,\n          61000000.0,\n          62000000.0\n        ]\n      },\n      {\n        "metric": "Interest Income Non Operating",\n        "values": [\n          496000000.0,\n          540000000.0,\n          568000000.0,\n          624000000.0,\n          592000000.0\n        ]\n      },\n      {\n        "metric": "Operating Income",\n        "values": [\n          63734000000.0,\n          53536000000.0,\n          44299000000.0,\n          36010000000.0,\n          28440000000.0\n        ]\n      },\n      {\n        "metric": "Operating Expense",\n        "values": [\n          8408000000.0,\n          7621000000.0,\n          6794000000.0,\n          5839000000.0,\n          5413000000.0\n        ]\n      },\n      {\n        "metric": "Research And Development",\n        "values": [\n          7054000000.0,\n          6321000000.0,\n          5512000000.0,\n          4705000000.0,\n          4291000000.0\n        ]\n      },\n      {\n        "metric": "Selling General And Administration",\n        "values": [\n          1354000000.0,\n          1300000000.0,\n          1282000000.0,\n          1134000000.0,\n          1122000000.0\n        ]\n      },\n      {\n        "metric": "Gross Profit",\n        "values": [\n          72142000000.0,\n          61157000000.0,\n          51093000000.0,\n          41849000000.0,\n          33853000000.0\n        ]\n      },\n      {\n        "metric": "Cost Of Revenue",\n        "values": [\n          24079000000.0,\n          20458000000.0,\n          17034000000.0,\n          15157000000.0,\n          12890000000.0\n        ]\n      },\n      {\n        "metric": "Total Revenue",\n        "values": [\n          96221000000.0,\n          81615000000.0,\n          68127000000.0,\n          57006000000.0,\n          46743000000.0\n        ]\n      },\n      {\n        "metric": "Operating Revenue",\n        "values": [\n          96221000000.0,\n          81615000000.0,\n          68127000000.0,\n          57006000000.0,\n          46743000000.0\n        ]\n      }\n    ]\n  },\n  "point_in_time": false,\n  "source_acquisition_contexts": {\n    "quarterly_income_stmt": {\n      "capture_id": "b6a1d047-d4cb-42ad-bee6-6c36acb813e3",\n      "market": "US",\n      "observed_at": "2026-10-06T14:26:52.131Z",\n      "producer": "yfinance.quarterly_income_stmt/transport-capture-v1",\n      "provider_symbol": "NVDA",\n      "raw_payload_availability": "retained_normalized_subset",\n      "raw_payload_sha256": "cbc881a18ab28c2caec9166fd07e997536fd2111447c0eee477c4b2ea5c6e843",\n      "source": "yfinance",\n      "source_payload": {\n        "columns": [\n          "2026-07-31 00:00:00",\n          "2026-04-30 00:00:00",\n          "2026-01-31 00:00:00",\n          "2025-10-31 00:00:00",\n          "2025-07-31 00:00:00"\n        ],\n        "format": "yfinance-income-selected-rows-v1",\n        "rows": [\n          {\n            "metric": "Reconciled Cost Of Revenue",\n            "values": [\n              24079000000.0,\n              20458000000.0,\n              17034000000.0,\n              15157000000.0,\n              12890000000.0\n            ]\n          },\n          {\n            "metric": "Diluted EPS",\n            "values": [\n              2.46,\n              2.39,\n              1.76,\n              1.3,\n              1.08\n            ]\n          },\n          {\n            "metric": "Basic EPS",\n            "values": [\n              2.47,\n              2.4,\n              1.77,\n              1.31,\n              1.08\n            ]\n          },\n          {\n            "metric": "Cost Of Revenue",\n            "values": [\n              24079000000.0,\n              20458000000.0,\n              17034000000.0,\n              15157000000.0,\n              12890000000.0\n            ]\n          },\n          {\n            "metric": "Total Revenue",\n            "values": [\n              96221000000.0,\n              81615000000.0,\n              68127000000.0,\n              57006000000.0,\n              46743000000.0\n            ]\n          },\n          {\n            "metric": "Operating Revenue",\n            "values": [\n              96221000000.0,\n              81615000000.0,\n              68127000000.0,\n              57006000000.0,\n              46743000000.0\n            ]\n          }\n        ],\n        "source_rows": {\n          "basiceps": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyBasicEPS",\n            "values": {\n              "2025-07-31": 1.08,\n              "2025-10-31": 1.31,\n              "2026-01-31": 1.77,\n              "2026-04-30": 2.4,\n              "2026-07-31": 2.47\n            }\n          },\n          "basicepsothergainslosses": {\n            "currencies": [],\n            "provider_metric": "quarterlyBasicEPSOtherGainsLosses",\n            "values": {}\n          },\n          "continuinganddiscontinuedbasiceps": {\n            "currencies": [],\n            "provider_metric": "quarterlyContinuingAndDiscontinuedBasicEPS",\n            "values": {}\n          },\n          "continuinganddiscontinueddilutedeps": {\n            "currencies": [],\n            "provider_metric": "quarterlyContinuingAndDiscontinuedDilutedEPS",\n            "values": {}\n          },\n          "costofrevenue": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyCostOfRevenue",\n            "values": {\n              "2025-07-31": 12890000000.0,\n              "2025-10-31": 15157000000.0,\n              "2026-01-31": 17034000000.0,\n              "2026-04-30": 20458000000.0,\n              "2026-07-31": 24079000000.0\n            }\n          },\n          "dilutedeps": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyDilutedEPS",\n            "values": {\n              "2025-07-31": 1.08,\n              "2025-10-31": 1.3,\n              "2026-01-31": 1.76,\n              "2026-04-30": 2.39,\n              "2026-07-31": 2.46\n            }\n          },\n          "dilutedepsothergainslosses": {\n            "currencies": [],\n            "provider_metric": "quarterlyDilutedEPSOtherGainsLosses",\n            "values": {}\n          },\n          "normalizedbasiceps": {\n            "currencies": [],\n            "provider_metric": "quarterlyNormalizedBasicEPS",\n            "values": {}\n          },\n          "normalizeddilutedeps": {\n            "currencies": [],\n            "provider_metric": "quarterlyNormalizedDilutedEPS",\n            "values": {}\n          },\n          "operatingrevenue": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyOperatingRevenue",\n            "values": {\n              "2025-07-31": 46743000000.0,\n              "2025-10-31": 57006000000.0,\n              "2026-01-31": 68127000000.0,\n              "2026-04-30": 81615000000.0,\n              "2026-07-31": 96221000000.0\n            }\n          },\n          "reconciledcostofrevenue": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyReconciledCostOfRevenue",\n            "values": {\n              "2025-07-31": 12890000000.0,\n              "2025-10-31": 15157000000.0,\n              "2026-01-31": 17034000000.0,\n              "2026-04-30": 20458000000.0,\n              "2026-07-31": 24079000000.0\n            }\n          },\n          "reportednormalizedbasiceps": {\n            "currencies": [],\n            "provider_metric": "quarterlyReportedNormalizedBasicEPS",\n            "values": {}\n          },\n          "reportednormalizeddilutedeps": {\n            "currencies": [],\n            "provider_metric": "quarterlyReportedNormalizedDilutedEPS",\n            "values": {}\n          },\n          "taxlosscarryforwardbasiceps": {\n            "currencies": [],\n            "provider_metric": "quarterlyTaxLossCarryforwardBasicEPS",\n            "values": {}\n          },\n          "taxlosscarryforwarddilutedeps": {\n            "currencies": [],\n            "provider_metric": "quarterlyTaxLossCarryforwardDilutedEPS",\n            "values": {}\n          },\n          "totalrevenue": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyTotalRevenue",\n            "values": {\n              "2025-07-31": 46743000000.0,\n              "2025-10-31": 57006000000.0,\n              "2026-01-31": 68127000000.0,\n              "2026-04-30": 81615000000.0,\n              "2026-07-31": 96221000000.0\n            }\n          }\n        }\n      },\n      "source_revision": null,\n      "symbol": "NVDA",\n      "transport_payload_sha256": "ee8b447c92b8a69c8bf4b65c53b17d35a34d449a3557e27b45af5d409d14309c"\n    }\n  },\n  "source_publication_date": null,\n  "source_publication_date_status": "unknown",\n  "symbol": "NVDA",\n  "transport_events": [\n    {\n      "attribute": "quarterly_income_stmt",\n      "completed_at": "2026-10-06T14:26:51.589Z",\n      "endpoint": "https://fc.yahoo.com",\n      "http_status": 404,\n      "method": "GET",\n      "sequence": 1,\n      "started_at": "2026-10-06T14:26:51.438Z",\n      "symbol": "NVDA"\n    },\n    {\n      "attribute": "quarterly_income_stmt",\n      "completed_at": "2026-10-06T14:26:51.796Z",\n      "endpoint": "https://query1.finance.yahoo.com/v1/test/getcrumb",\n      "http_status": 200,\n      "method": "GET",\n      "sequence": 2,\n      "started_at": "2026-10-06T14:26:51.643Z",\n      "symbol": "NVDA"\n    },\n    {\n      "attribute": "quarterly_income_stmt",\n      "completed_at": "2026-10-06T14:26:52.129Z",\n      "endpoint": "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/NVDA",\n      "http_status": 200,\n      "method": "GET",\n      "retained_source_subset": {\n        "columns": [\n          "2026-07-31 00:00:00",\n          "2026-04-30 00:00:00",\n          "2026-01-31 00:00:00",\n          "2025-10-31 00:00:00",\n          "2025-07-31 00:00:00"\n        ],\n        "rows": {\n          "basiceps": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyBasicEPS",\n            "values": {\n              "2025-07-31": 1.08,\n              "2025-10-31": 1.31,\n              "2026-01-31": 1.77,\n              "2026-04-30": 2.4,\n              "2026-07-31": 2.47\n            }\n          },\n          "basicepsothergainslosses": {\n            "currencies": [],\n            "provider_metric": "quarterlyBasicEPSOtherGainsLosses",\n            "values": {}\n          },\n          "continuinganddiscontinuedbasiceps": {\n            "currencies": [],\n            "provider_metric": "quarterlyContinuingAndDiscontinuedBasicEPS",\n            "values": {}\n          },\n          "continuinganddiscontinueddilutedeps": {\n            "currencies": [],\n            "provider_metric": "quarterlyContinuingAndDiscontinuedDilutedEPS",\n            "values": {}\n          },\n          "costofrevenue": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyCostOfRevenue",\n            "values": {\n              "2025-07-31": 12890000000.0,\n              "2025-10-31": 15157000000.0,\n              "2026-01-31": 17034000000.0,\n              "2026-04-30": 20458000000.0,\n              "2026-07-31": 24079000000.0\n            }\n          },\n          "dilutedeps": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyDilutedEPS",\n            "values": {\n              "2025-07-31": 1.08,\n              "2025-10-31": 1.3,\n              "2026-01-31": 1.76,\n              "2026-04-30": 2.39,\n              "2026-07-31": 2.46\n            }\n          },\n          "dilutedepsothergainslosses": {\n            "currencies": [],\n            "provider_metric": "quarterlyDilutedEPSOtherGainsLosses",\n            "values": {}\n          },\n          "normalizedbasiceps": {\n            "currencies": [],\n            "provider_metric": "quarterlyNormalizedBasicEPS",\n            "values": {}\n          },\n          "normalizeddilutedeps": {\n            "currencies": [],\n            "provider_metric": "quarterlyNormalizedDilutedEPS",\n            "values": {}\n          },\n          "operatingrevenue": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyOperatingRevenue",\n            "values": {\n              "2025-07-31": 46743000000.0,\n              "2025-10-31": 57006000000.0,\n              "2026-01-31": 68127000000.0,\n              "2026-04-30": 81615000000.0,\n              "2026-07-31": 96221000000.0\n            }\n          },\n          "reconciledcostofrevenue": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyReconciledCostOfRevenue",\n            "values": {\n              "2025-07-31": 12890000000.0,\n              "2025-10-31": 15157000000.0,\n              "2026-01-31": 17034000000.0,\n              "2026-04-30": 20458000000.0,\n              "2026-07-31": 24079000000.0\n            }\n          },\n          "reportednormalizedbasiceps": {\n            "currencies": [],\n            "provider_metric": "quarterlyReportedNormalizedBasicEPS",\n            "values": {}\n          },\n          "reportednormalizeddilutedeps": {\n            "currencies": [],\n            "provider_metric": "quarterlyReportedNormalizedDilutedEPS",\n            "values": {}\n          },\n          "taxlosscarryforwardbasiceps": {\n            "currencies": [],\n            "provider_metric": "quarterlyTaxLossCarryforwardBasicEPS",\n            "values": {}\n          },\n          "taxlosscarryforwarddilutedeps": {\n            "currencies": [],\n            "provider_metric": "quarterlyTaxLossCarryforwardDilutedEPS",\n            "values": {}\n          },\n          "totalrevenue": {\n            "currencies": [\n              "USD"\n            ],\n            "provider_metric": "quarterlyTotalRevenue",\n            "values": {\n              "2025-07-31": 46743000000.0,\n              "2025-10-31": 57006000000.0,\n              "2026-01-31": 68127000000.0,\n              "2026-04-30": 81615000000.0,\n              "2026-07-31": 96221000000.0\n            }\n          }\n        }\n      },\n      "sequence": 3,\n      "source_subset_status": "retained",\n      "started_at": "2026-10-06T14:26:51.849Z",\n      "symbol": "NVDA",\n      "transport_payload_bytes": 39178,\n      "transport_payload_sha256": "ee8b447c92b8a69c8bf4b65c53b17d35a34d449a3557e27b45af5d409d14309c"\n    }\n  ]\n}'

if __name__ == '__main__' and sys.argv[1:] == ['--expiry-probe']:
    expiry_probe()
