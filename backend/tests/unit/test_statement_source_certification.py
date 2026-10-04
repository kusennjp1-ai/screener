"""Offline certification semantics. The fixture collector blocks real transports."""
from copy import deepcopy
from datetime import timedelta
import json
from pathlib import Path
import shutil
from unittest.mock import patch
import zipfile

import pytest

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services import statement_source_certification as cert
from tests.unit import test_financial_statement_batch as fixtures
from tests.unit import test_statement_artifact_archive as archive_fixtures


@pytest.fixture
def harness():
    test = archive_fixtures.TestStatementArtifactArchive(methodName='runTest')
    test.setUp()
    try:
        yield test
    finally:
        test.doCleanups()


def bundle(h, *, code=0, latest='batch'):
    root = h.root / 'artifact'
    root.mkdir()
    shutil.copytree(h.directory, root / 'archive')
    shutil.copytree(h.root / latest, root / 'batch')
    (root / 'base.json').write_bytes(h.base)
    batch.write_json(root / 'cohort.json', h.cohort)
    loaded = h.load()
    cycle = {'schema_version':'financial-recovery-cycle-v1', 'phase':'completed', 'dry_run':False, 'published':False,
             'code_revision':'1'*40, 'archive_manifest_sha256':h.sha, 'base_artifact_sha256':batch.digest_bytes(h.base),
             'source_data_as_of':'2026-10-02', 'exit_code':code, 'selected_symbols':json.loads((root / 'batch/summary.json').read_bytes())['selected_symbols'],
             'retained_receipts':len(loaded.manifest['receipts']),
             'retained_symbols':len({e['symbol'] for e in loaded.manifest['receipts'].values()})}
    batch.write_json(root / 'cycle.json', cycle)
    source = {'repository':'kusennjp1-ai/screener', 'workflow':'.github/workflows/financial-statement-recovery.yml',
              'head_sha':'1'*40, 'run_id':12, 'run_attempt':3, 'artifact_id':45,
              'artifact_name':'financial-statement-recovery-'+'1'*40+'-3', 'artifact_sha256':'2'*64,
              'archive_manifest_sha256':h.sha, 'acquisition_base_sha256':batch.digest_bytes(h.base),
              'cohort_sha256':batch.digest_bytes((root / 'cohort.json').read_bytes())}
    conclusion = 'success' if code == 0 else 'failure'
    run = {'id':12, 'run_attempt':3, 'head_sha':'1'*40, 'path':source['workflow'],
           'head_branch':'improve/mandatory-financial-source-recovery', 'event':'push', 'status':'completed',
           'conclusion':conclusion, 'run_started_at':batch.timestamp(fixtures.NOW - timedelta(minutes=1)),
           'repository':{'id':3,'full_name':source['repository']}, 'head_repository':{'id':3,'full_name':source['repository']}}
    job = {'id':67,'name':'statement-recovery','run_id':12,'run_attempt':3,'head_sha':'1'*40,
           'status':'completed','conclusion':conclusion,'started_at':run['run_started_at'],
           'completed_at':batch.timestamp(h.now)}
    artifact = {'id':45,'name':source['artifact_name'],'expired':False,'digest':'sha256:'+source['artifact_sha256'],
                'size_in_bytes':100,'created_at':batch.timestamp(h.now),
                'workflow_run':{'id':12,'head_sha':'1'*40,'head_branch':run['head_branch'],'repository_id':3,'head_repository_id':3}}
    return root, {'schema_version':cert.SCHEMA,'source':source}, {'run':run,'jobs':[job],'artifacts':[artifact]}


def certify(h, inputs, now=None):
    root, request, evidence = inputs
    return cert.certify_directory(root, request, evidence, now=now or h.now,
                                  code_sha='3'*40, api_evidence_sha256='4'*64)


def test_success_is_integrity_not_qualification_and_full_cohort(harness):
    h = harness
    h.capture(count=2)
    c, data = certify(h, bundle(h))
    p = json.loads(data)
    assert c['result'] == 'certified' and c['source_execution']['producer_run_conclusion'] == 'success'
    assert c['projection']['counts']['eps_growth_yy'] == {'ordinary':2,'nonpositive':0,'source_limited':0,'unknown':4}
    assert set(p['symbols']) == set(h.cohort['symbols'])
    assert not c['projection']['qualification_authority']
    assert not c['source_execution']['further_provider_work_allowed']
    assert not c['published'] and not p['point_in_time']
    assert p['source_data_as_of'] == '2026-10-02'
    assert c['projection']['source_timestamp_bounds']['latest'].startswith('2026-10-04')


def test_empty_200_exit3_can_certify_without_erasing_failure(harness):
    h = harness
    h.collector.reply = lambda symbol, attribute: (200, {'timeseries':{'result':[], 'error':None}}) if symbol == 'AMD' else (200, fixtures.body(symbol, attribute))
    _, _, code = h.capture(count=2)
    assert code == 3
    c, _ = certify(h, bundle(h,code=code))
    assert c['source_execution']['producer_run_conclusion'] == 'failure'
    assert c['source_execution']['producer_exit_code'] == 3
    assert c['source_execution']['empty_getter_count'] == 2
    assert c['source_execution']['provider_failures'] == []
    assert c['source_execution']['provider_state'] == 'no_block_observed'
    assert c['projection']['counts']['eps_growth_yy']['unknown'] == 5


@pytest.mark.parametrize('http_status',[403,429])
def test_preblock_receipts_certify_with_persistent_block(harness,http_status):
    h = harness
    h.collector.reply = lambda symbol, attribute: (http_status,{}) if symbol == 'AMD' else (200,fixtures.body(symbol,attribute))
    _, _, code = h.capture(count=3)
    assert code == 2
    c, _ = certify(h, bundle(h,code=code))
    assert c['source_execution']['provider_state'] == 'blocked'
    assert not c['source_execution']['further_provider_work_allowed']
    assert c['source_execution']['producer_job_conclusion'] == 'failure'
    assert c['source_execution']['provider_failures'][0]['http_statuses'] == [http_status]
    assert c['projection']['counts']['eps_growth_yy']['ordinary'] == 1


def test_corrupted_old_receipt_fails_after_valid_renewal(harness):
    h = harness
    h.capture(count=2)
    old_sha = next(iter(h.load().manifest['receipts']))
    h.now += timedelta(hours=66)
    h.capture(count=2,name='renewal',refresh_through=h.now+timedelta(hours=12))
    inputs = bundle(h,latest='renewal')
    path = inputs[0]/'archive/objects'/f'{old_sha}.json'
    path.write_bytes(path.read_bytes()+b' ')
    with pytest.raises(ValueError,match='digest or length'):
        certify(h,inputs)


def test_expired_proofs_become_unknown_without_source_clock_renewal(harness):
    h = harness
    h.capture(count=2)
    inputs = bundle(h)
    c, data = certify(h,inputs,now=h.now+timedelta(days=8))
    assert c['projection']['counts']['eps_growth_yy']['unknown'] == 6
    assert c['projection']['counts']['annual_history']['unknown'] == 6
    assert c['projection']['source_timestamp_bounds']['latest'] == batch.timestamp(fixtures.NOW)
    assert json.loads(data)['symbols']['AMD']['financial_history']['retrieved_at'] is None


def test_nonpositive_proofs_are_distinct_from_ordinary_growth(harness):
    h = harness
    def response(symbol, attribute):
        payload = fixtures.body(symbol, attribute, negative=True)
        if attribute == 'income_stmt':
            payload['timeseries']['result'][0]['annualDilutedEPS'][3]['reportedValue']['raw'] = -2
        return 200, payload
    h.collector.reply = response
    h.capture(count=2)
    c,_=certify(h,bundle(h))
    assert c['projection']['counts']['eps_growth_yy']['nonpositive'] == 2
    assert c['projection']['counts']['eps_growth_yy']['ordinary'] == 0
    assert c['projection']['counts']['annual_history']['nonpositive'] == 2


@pytest.mark.parametrize('baseline',[0,0.01])
def test_zero_small_base_is_source_limited_not_missing_or_ordinary(harness,baseline):
    h=harness
    def response(symbol,attribute):
        body=fixtures.body(symbol,attribute)
        if attribute=='quarterly_income_stmt':body['timeseries']['result'][0]['quarterlyDilutedEPS'][4]['reportedValue']['raw']=baseline
        return 200,body
    h.collector.reply=response
    h.capture(count=2)
    c,_=certify(h,bundle(h))
    assert c['projection']['counts']['eps_growth_yy']['source_limited']==2
    assert c['projection']['counts']['eps_growth_yy']['ordinary']==0


def test_wrong_cohort_fails_even_with_rehashed_cohort_file(harness):
    h=harness;h.capture(count=2)
    inputs=bundle(h);root,request,_=inputs
    cohort=deepcopy(h.cohort);cohort['symbols'].append('EVIL')
    batch.write_json(root/'cohort.json',cohort)
    request['source']['cohort_sha256']=batch.digest_bytes((root/'cohort.json').read_bytes())
    with pytest.raises(ValueError,match='base/cohort'):
        certify(h,inputs)


@pytest.mark.parametrize('mutation',[
    lambda e:e['run'].update(run_attempt=4),
    lambda e:e['jobs'][0].update(run_attempt=4),
    lambda e:e['artifacts'][0].update(id=46),
    lambda e:e['artifacts'][0].update(name='wrong'),
    lambda e:e['artifacts'][0]['workflow_run'].update(head_sha='5'*40),
    lambda e:e['artifacts'][0].update(created_at='2026-10-03T12:00:00Z'),
])
def test_mismatched_attempt_or_artifact_rejected(harness,mutation):
    h=harness;h.capture(count=2)
    inputs=bundle(h);mutation(inputs[2])
    with pytest.raises(ValueError):certify(h,inputs)


def test_normalization_contradiction_rejected_even_with_valid_envelope(harness):
    h=harness;h.capture(count=2)
    loaded=h.load()
    sha=next(sha for sha,entry in loaded.manifest['objects'].items() if entry['kind']=='batch_result')
    loaded.objects[sha][0]['financial_current']['r']='0'*16
    with pytest.raises(ValueError,match='financial_current differs'):
        cert.audit_batches(loaded,now=h.now)


def test_original_observation_clock_cannot_be_renewed(harness):
    h=harness;h.capture(count=2)
    loaded=h.load();value=next(iter(loaded.acquisitions.values()))
    value['context']['observed_at']=batch.timestamp(h.now+timedelta(hours=1))
    with pytest.raises(ValueError,match='original source clock'):
        cert.audit_batches(loaded,now=h.now+timedelta(hours=2))


def test_real_zip_entrypoint_remains_offline_and_exact(harness):
    h=harness;h.capture(count=2)
    root,request,evidence=bundle(h)
    zip_path=h.root/'source.zip'
    with zipfile.ZipFile(zip_path,'w') as z:
        for path in root.rglob('*'):
            if path.is_file():z.write(path,path.relative_to(root))
    sha=batch.digest_bytes(zip_path.read_bytes());request['source']['artifact_sha256']=sha
    evidence['artifacts'][0].update(digest='sha256:'+sha,size_in_bytes=zip_path.stat().st_size)
    request_path=h.root/'request.json';api_path=h.root/'api.json'
    batch.write_json(request_path,request);batch.write_json(api_path,evidence)
    with patch.object(batch,'runtime',side_effect=AssertionError('Provider forbidden')):
        c=cert.certify(request_path=request_path,api_evidence_path=api_path,source_zip=zip_path,output_dir=h.root/'certified',
                       evaluated_at=batch.timestamp(h.now),code_sha='3'*40)
    assert Path(c['certificate_path']).is_file()
    assert c['source']['artifact_sha256']==sha
    output = h.root / 'certified'
    assert batch.digest_bytes((output/'source-api-evidence.json').read_bytes()) == c['bindings']['source_api_evidence_sha256']
    assert batch.digest_bytes((output/'request.json').read_bytes()) == c['bindings']['request_sha256']
    assert batch.digest_bytes((output/'validation-code-manifest.json').read_bytes()) == c['validation']['policy_sha256']


def test_reduced_valid_subset_is_not_the_full_bound_cohort(harness):
    h = harness; h.capture(count=2)
    inputs = bundle(h); root, request, _ = inputs
    cohort = deepcopy(h.cohort); cohort['symbols'] = cohort['symbols'][:2]
    batch.write_json(root / 'cohort.json', cohort)
    request['source']['cohort_sha256'] = batch.digest_bytes((root / 'cohort.json').read_bytes())
    with pytest.raises(ValueError, match='full cohort'):
        certify(h, inputs)


def test_output_obeys_closed_json_schema(harness):
    import jsonschema
    h = harness; h.capture(count=2)
    result, _ = certify(h, bundle(h))
    schema = json.loads((cert.ROOT / 'contracts/financial_source_certification_v1.schema.json').read_bytes())
    jsonschema.Draft202012Validator(schema).validate(result)
    result['source']['producer_conclusion'] = 'success'
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.Draft202012Validator(schema).validate(result)


def test_latest_batch_cannot_belong_to_another_producer_time(harness):
    h = harness; h.capture(count=2)
    inputs = bundle(h)
    inputs[2]['run']['run_started_at'] = batch.timestamp(h.now + timedelta(hours=1))
    inputs[2]['jobs'][0]['started_at'] = batch.timestamp(h.now + timedelta(hours=1))
    inputs[2]['jobs'][0]['completed_at'] = batch.timestamp(h.now + timedelta(hours=2))
    inputs[2]['artifacts'][0]['created_at'] = batch.timestamp(h.now + timedelta(hours=2))
    with pytest.raises(ValueError, match='Latest batch clocks'):
        certify(h, inputs, now=h.now + timedelta(hours=2))


def migration_inputs(symbol):
    root = Path(__file__).parents[1] / 'fixtures/statement_source_migration_v1'
    metadata = json.loads((root / 'manifest.json').read_bytes())
    entry = metadata['symbols'][symbol]
    original = json.loads((root / f'{symbol}-envelope.json').read_bytes())
    result = json.loads((root / f'{symbol}-result.json').read_bytes())
    evaluated = batch.clock(result['evaluation_time'])
    acquisitions = {}
    for attribute, receipt in entry['acquisitions'].items():
        raw_bytes = (root / f'{symbol}-{attribute}.json').read_bytes()
        assert batch.digest_bytes(raw_bytes) == receipt['sha256']
        raw = json.loads(raw_bytes)
        frame, context, reason = batch.validate_acquisition(raw, symbol, attribute, now=evaluated, as_of=batch.day(metadata['as_of']))
        acquisitions[attribute] = {'raw':raw,'bytes':raw_bytes,'frame':frame,'context':context,'reason':reason,'origin_binding':receipt['origin_binding']}
    assert batch.digest_bytes((root / f'{symbol}-envelope.json').read_bytes()) == entry['envelope_sha256']
    _, projected = archive.project_symbol(symbol, acquisitions, now=evaluated, as_of=metadata['as_of'])
    kwargs = {'symbol':symbol,'summary_sha':metadata['summary_sha256'],'envelope_sha':entry['envelope_sha256'],
              'evaluated':evaluated,'as_of':metadata['as_of'],'derivation_deadline':batch.clock(metadata['summary_evaluation_time'])}
    return original, projected, acquisitions, kwargs, result


@pytest.mark.parametrize('symbol',['APLD','AUB','AVAV'])
def test_reviewed_migration_replays_original_selector_and_preserves_exact_receipts(symbol):
    original, projected, acquisitions, kwargs, result = migration_inputs(symbol)
    before = deepcopy(acquisitions)
    legacy, migration = cert.reviewed_migration(original, projected, acquisitions, **kwargs)
    assert migration['original_source_clocks_preserved']
    assert migration['derived_ratings_remain_quarantined']
    for field in ('financial_current','financial_history','source_diagnostics','history_source_diagnostics'):
        assert legacy[field] == result[field]
    assert {attribute:value['bytes'] for attribute,value in acquisitions.items()} == {attribute:value['bytes'] for attribute,value in before.items()}
    assert projected['financial_current']['r'][fixtures.FINANCIAL_FIELDS.index('eps_raw_score')] == 'b'
    if symbol == 'APLD':
        assert projected['financial_current']['r'][fixtures.FINANCIAL_FIELDS.index('eps_q2_yoy')] == 'a'


@pytest.mark.parametrize('mutation',[
    lambda o,p,a,k:p['envelope'].update(sales_growth_yy=999),
    lambda o,p,a,k:p['envelope']['financial_source_evidence']['fields']['eps_q2_yoy'].update(observed_at='2026-10-04T12:00:00Z'),
    lambda o,p,a,k:p['envelope']['financial_source_evidence']['fields']['eps_q2_yoy']['source_inputs'][0].update(value=-0.37),
    lambda o,p,a,k:k.update(summary_sha='0'*64),
    lambda o,p,a,k:k.update(envelope_sha='0'*64),
])
def test_migration_rejects_extra_field_changed_receipt_clock_input_or_batch(mutation):
    original, projected, acquisitions, kwargs, _ = migration_inputs('APLD')
    mutation(original, projected, acquisitions, kwargs)
    with pytest.raises(ValueError):
        cert.reviewed_migration(original, projected, acquisitions, **kwargs)


def test_selected_zero_cannot_hide_full_cohort_or_present_batch(harness):
    h = harness; h.capture(count=2)
    root, request, evidence = bundle(h)
    cycle = json.loads((root/'cycle.json').read_bytes()); cycle['selected_symbols'] = 0
    batch.write_json(root/'cycle.json',cycle)
    cohort = deepcopy(h.cohort); cohort['symbols'] = cohort['symbols'][:1]
    batch.write_json(root/'cohort.json',cohort)
    request['source']['cohort_sha256'] = batch.digest_bytes((root/'cohort.json').read_bytes())
    with pytest.raises(ValueError,match='no-op cycles'):
        certify(h,(root,request,evidence))


def test_unindexed_acquisition_is_not_ignored(harness):
    h = harness; h.capture(count=2)
    loaded = h.load(); sha = next(iter(loaded.manifest['receipts']))
    loaded.manifest['receipts'].pop(sha)
    with pytest.raises(ValueError,match='Unindexed'):
        cert.audit_batches(loaded,now=h.now)


def test_attempt_cannot_complete_after_its_result(harness):
    h = harness; h.capture(count=2)
    loaded = h.load(); attempt_id = next(iter(loaded.manifest['attempts']))
    journal_sha = loaded.manifest['attempts'][attempt_id]['source_object_sha256']
    attempt = next(a for a in loaded.objects[journal_sha][0]['attempts'] if a['attempt_id'] == attempt_id)
    attempt['completed_at'] = batch.timestamp(h.now+timedelta(hours=1))
    with pytest.raises(ValueError,match='Result precedes'):
        cert.audit_batches(loaded,now=h.now+timedelta(hours=2))


def test_mixed_currency_receipt_remains_unknown_audit_reference(harness):
    h = harness
    def response(symbol, attribute):
        payload = fixtures.body(symbol, attribute)
        for row in payload['timeseries']['result']:
            field = row['meta']['type'][0]
            row[field][-1]['currencyCode'] = 'CAD'
        return 200, payload
    h.collector.reply = response
    h.capture(count=2)
    result, data = certify(h, bundle(h))
    projected = json.loads(data)['symbols']['AMD']
    index = fixtures.FINANCIAL_FIELDS.index('eps_growth_yy')
    assert projected['financial_current']['r'][index] == 'e'
    assert str(index) not in projected['financial_current']['p']
    assert projected['availability_classification']['eps_growth_yy'] == 'unknown'
    assert projected['certification_limitations']['eps_growth_yy'].startswith('mixed_or_missing_source_currency')
    assert result['projection']['counts']['eps_growth_yy']['ordinary'] == 0
    assert result['projection']['counts']['eps_growth_yy']['unknown'] == 6


def test_consistent_currency_cannot_hide_arithmetic_contradiction(harness):
    from app.services.static_financial_evidence import build_static_financial_current
    h = harness; h.capture(count=2)
    loaded = h.load(); symbol = 'AMD'
    acquisitions = {attribute:loaded.acquisitions[loaded.manifest['current'][f'{symbol}/{attribute}']] for attribute in batch.ATTRIBUTES}
    status, projection = archive.project_symbol(symbol, acquisitions, now=h.now, as_of='2026-10-02')
    field = 'eps_growth_yy'
    record = projection['envelope']['financial_source_evidence']['fields'][field]
    record['value'] += 1
    record['observation_id'] = cert.observation_id(record)
    projection['envelope'][field] = record['value']
    projection['financial_current'] = build_static_financial_current(projection['envelope'],now=h.now,as_of_date='2026-10-02',market='US')
    index = fixtures.FINANCIAL_FIELDS.index(field)
    assert projection['financial_current']['r'][index] == 'e'
    assert not cert.currency_only_limitation(field,projection,now=h.now,as_of='2026-10-02')
    with patch.object(archive,'project_symbol',return_value=(status,projection)):
        with pytest.raises(ValueError,match='Contradictory current proof'):
            cert.current_projection(loaded,{'symbols':[symbol]},now=h.now,as_of='2026-10-02',
                                    historical_unavailable={(symbol,field,record['capture_id'])})


def test_corrupt_old_manifest_snapshot_is_not_ignored(harness):
    h = harness; h.capture(count=2)
    inputs = bundle(h)
    snapshots = list((inputs[0]/'archive/manifests').glob('*.json'))
    old = next(path for path in snapshots if path.stem != h.sha)
    old.write_bytes(old.read_bytes()+b' ')
    with pytest.raises(ValueError,match='snapshot hash'):
        certify(h,inputs)


def test_detected_429_transport_exception_stays_blocked(harness):
    h = harness
    h.collector.reply = lambda symbol, attribute: (None, RuntimeError('429 rate limited')) if symbol == 'AMD' else (200,fixtures.body(symbol,attribute))
    _, _, code = h.capture(count=2)
    assert code == 2
    result, _ = certify(h,bundle(h,code=code))
    assert result['source_execution']['provider_state'] == 'blocked'
    assert result['source_execution']['provider_failures'][0]['http_statuses'] == [429]
    assert result['source_execution']['unknown_failure_count'] == 0


def test_original_producer_batch_counts_are_separate_from_cumulative(harness):
    h = harness
    h.collector.reply = lambda symbol, attribute: (200,{'timeseries':{'error':None,'result':[]}}) if symbol == 'AMD' else (200,fixtures.body(symbol,attribute))
    h.capture(count=2)
    h.capture(count=2,name='second')
    result, _ = certify(h,bundle(h,latest='second'))
    assert result['source_execution']['empty_getter_count'] == 2
    assert result['source_execution']['producer_batch']['empty_getter_count'] == 0
    assert result['source_execution']['failure_inventory_scope'] == 'cumulative_archive'
