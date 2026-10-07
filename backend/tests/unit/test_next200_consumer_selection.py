"""Disabled finite consumer-expiry correction: semantic negative checks."""
from copy import deepcopy
from datetime import timedelta
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('next200_consumer_selection', ROOT / '.github/scripts/run-postcapture-next-200.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
prep = runner.preparation
NOW = prep.batch.clock('2026-10-07T03:00:00Z')

@pytest.fixture
def review():
    return prep.load_review(now=NOW)

def consumer_queue(review):
    return json.loads(review.contents['consumer-queue.json'])

def test_exact_consumer_selection_includes_nineteen_partial_histories(review):
    value = consumer_queue(review)
    due = prep.validate_consumer_queue(value, review.queue, review.plan, review.request)
    selected = due[:200]
    assert [x['symbol'] for x in selected] == review.plan['batch_allowlist']
    assert selected[0]['symbol'] == 'ADP' and selected[-1]['symbol'] == 'CMS'
    assert [x['symbol'] for x in selected if x['history_reason'] == 'valid_incomplete_annual_history'] == [
        'ADP','AEHR','AFRM','AIT','ALH','AMBQ','ANDG','APLD','ARXS','AVEX','AVT','BETA','BLLN','BRUN','BVN','BXDC','CDNL','CLS','CLX']
    assert len(due) == 1693 and len(value['rows']) == 1891
    assert len([x for x in value['rows'] if x['consumer_timer'] is None]) == 12
    assert sum(len(x['source_receipts']) for x in selected) == 396

def test_new_cutoff_is_inclusive_and_has_full_job_reserve(review):
    cutoff = prep.batch.clock('2026-10-07T11:12:21.221Z')
    assert cutoff + timedelta(seconds=1500) == prep.batch.clock(review.request['first_deadline'])
    prep.load_review(now=cutoff)
    with pytest.raises(ValueError, match='finite review window'):
        prep.load_review(now=cutoff + timedelta(milliseconds=1))

@pytest.mark.parametrize('mutate', [
    lambda q: q['rows'].reverse(),
    lambda q: q['rows'][0].update(consumer_timer='2026-10-07T11:37:21.221Z'),
    lambda q: q['rows'][0].update(consumer_deadline=False),
    lambda q: q['rows'][-1].update(consumer_deadline=0),
    lambda q: q['rows'][0]['source_receipts'][0].update(observed_at='2026-10-04T11:37:21.222Z'),
    lambda q: q['rows'][0]['source_receipts'].pop(),
    lambda q: q['rows'][0]['financial_identity'].update(identifiers_bound_to_price=True),
    lambda q: q.update(source_evaluated_at='2026-10-07T03:00:00Z'),
    lambda q: q['rows'][0].update(optional_trust=True),
])
def test_consumer_queue_rejects_order_clock_identity_receipt_and_schema_mutation(review, mutate):
    queue = consumer_queue(review)
    mutate(queue)
    with pytest.raises(ValueError):
        prep.validate_consumer_queue(queue, review.queue, review.plan, review.request)

def test_fresh_historical_retry_decisions_are_never_inferred_from_elapsed_time(review, tmp_path):
    assert all(x['decision_state'] == 'retry_decision_required' and x['retry_not_before'] is None
               for x in review.request['missing_prior_decisions'])
    with patch.object(runner.archive, 'load_archive', side_effect=AssertionError('source must not be read')), \
         patch.object(runner.batch, 'collect', side_effect=AssertionError('provider must not be constructed')), \
         pytest.raises(ValueError, match='retry decisions are required'):
        runner.collect_cycle(tmp_path/'missing', tmp_path/'companion', tmp_path/'output', review,
            {}, b'{}', {}, job_started_at=prep.batch.timestamp(NOW), check_clock=lambda now: None, now_fn=lambda:NOW)
    assert not (tmp_path/'output').exists()


def test_next200_execution_remains_disabled_without_next200_registry_authority(review):
    value, _ = prep.read_pinned(runner.EXECUTION_PATH, runner.EXECUTION_SHA256)
    assert value == {**runner.execution_identity(review), 'execution_enabled':False, 'expected_run_number':None}
    assert value['existing_selected_receipts'] == 396 and value['fresh_work_getters'] == 400
    policy = json.loads((ROOT/'contracts/financial_source_postcapture_restore_v1.json').read_bytes())
    trust = json.loads((ROOT/'contracts/financial_source_postcapture_trust_v1.json').read_bytes())
    assert_registries_have_only_historical_authority(policy, trust)
    with pytest.raises(ValueError, match='execution is disabled'):
        runner.validate_execution(value, review, now=NOW, context={})


def assert_registries_have_only_historical_authority(policy, trust):
    # Restoration of the exact historical failed producer is separate authority.
    # It must not make this disabled future request look enabled, or vice versa.
    historical = json.loads((ROOT/'.github/scripts/fixtures/postcapture-restore-review.fixture.json').read_bytes())
    for registry in (policy, trust):
        assert registry['reviewed_requests'] in ([], [historical])


@pytest.mark.parametrize('historical_admitted', [False, True])
def test_registry_fixture_allows_separately_admitted_historical_source(review, historical_admitted):
    policy = json.loads((ROOT/'contracts/financial_source_postcapture_restore_v1.json').read_bytes())
    trust = json.loads((ROOT/'contracts/financial_source_postcapture_trust_v1.json').read_bytes())
    historical = json.loads((ROOT/'.github/scripts/fixtures/postcapture-restore-review.fixture.json').read_bytes())
    policy.update(restore_enabled=historical_admitted, reviewed_requests=[historical] if historical_admitted else [])
    trust['reviewed_requests'] = [deepcopy(historical)] if historical_admitted else []
    assert_registries_have_only_historical_authority(policy, trust)
    value, _ = prep.read_pinned(runner.EXECUTION_PATH, runner.EXECUTION_SHA256)
    assert value['execution_enabled'] is False and value['expected_run_number'] is None
    with pytest.raises(ValueError, match='execution is disabled'):
        runner.validate_execution(value, review, now=NOW, context={})
    policy['reviewed_requests'] = [{'request_id': review.admission['request_id']}]
    with pytest.raises(AssertionError):
        assert_registries_have_only_historical_authority(policy, trust)
