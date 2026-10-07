"""Disabled catch-up admission and real small capture/retention integration.

Enabled objects here are synthetic local fixtures, never live admission.
"""
from copy import deepcopy
from datetime import timedelta
import itertools
import json

import pytest

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from tests.unit import test_postcapture_next_200_collector as collector
from tests.unit.test_postcapture_next_200_collector import finite_cycle, authorization

runner = collector.runner
catchup = runner.catchup
NOW = batch.clock('2026-10-07T16:00:00.000Z')


def enabled(*, deferred=()):
    value = json.loads(catchup.CONTROL.read_bytes())
    value['execution_enabled'] = True
    value['admission'] = {'request_id': 'postcapture-overdue-SYNTHETIC-LOCAL-ONLY', 'expected_run_number': 9,
        'evaluation_time': batch.timestamp(NOW), 'dispatch_not_after': batch.timestamp(NOW + timedelta(minutes=20)),
        'seed_review_sha256': catchup.SEED_REVIEW_SHA256}
    for item in value['prior_dispositions']:
        item['decision'] = 'defer_symbol' if item['symbol'] in deferred else 'reobserve_once'
    return value


@pytest.fixture
def review():
    return catchup.build_review(enabled(), now=NOW)


def test_committed_admission_is_unassigned_and_environment_cannot_enable(monkeypatch):
    value = json.loads(catchup.CONTROL.read_bytes())
    assert value['execution_enabled'] is False and value['admission'] is None
    assert all(item['decision'] == 'pending' for item in value['prior_dispositions'])
    for name in ('NEXT_200_EXECUTION_ENABLED', 'NEXT_200_CATCHUP_ENABLED', 'GITHUB_EVENT_NAME'):
        monkeypatch.setenv(name, 'workflow_run' if name == 'GITHUB_EVENT_NAME' else 'true')
    assert catchup.load_optional_review(now=NOW) is None
    monkeypatch.setattr(runner.batch, 'utc_now', lambda: NOW)
    for name in ('authenticate_execution', 'verify_typed_source'):
        monkeypatch.setattr(runner, name, collector.forbidden)
    monkeypatch.setattr(runner.batch, 'collect', collector.forbidden)
    with pytest.raises(ValueError, match='finite review window'):
        runner.preflight(batch.timestamp(NOW))


@pytest.mark.parametrize('index', range(4))
def test_each_pending_decision_blocks_before_reading_seed(index, monkeypatch):
    value = enabled()
    value['prior_dispositions'][index]['decision'] = 'pending'
    monkeypatch.setattr(catchup, 'historical_seed', collector.forbidden)
    with pytest.raises(ValueError, match='Pending catch-up'):
        catchup.build_review(value, now=NOW)


@pytest.mark.parametrize('key,value', [('event', 'workflow_run'), ('workflow', 'Static Site'),
    ('provider_allowed', True), ('source_is_current', True), ('retry_empty', True)])
def test_arbitrary_opt_in_or_event_labels_rejected(key, value):
    config = enabled()
    config[key] = value
    with pytest.raises(ValueError, match='closed'):
        catchup.build_review(config, now=NOW)
    config = enabled()
    config['admission'][key] = value
    with pytest.raises(ValueError, match='closed'):
        catchup.build_review(config, now=NOW)


@pytest.mark.parametrize('changes', [
    {'evaluation_time': '2026-10-07T16:01:00.000Z'},
    {'dispatch_not_after': '2026-10-07T15:59:59.999Z'},
    {'dispatch_not_after': '2026-10-07T16:00:00.000Z'},
    {'dispatch_not_after': '2026-10-07T16:30:00.001Z'},
    {'evaluation_time': '2026-10-07T16:00:00Z'},
    {'evaluation_time': '2026-10-07T18:00:00.000+02:00'},
    {'expected_run_number': True}, {'expected_run_number': 0},
    {'seed_review_sha256': 'f' * 64}, {'request_id': 'old-approved-request'}])
def test_future_expired_noncanonical_or_unbound_instance_rejected(changes):
    value = enabled()
    value['admission'].update(changes)
    with pytest.raises(ValueError):
        catchup.build_review(value, now=NOW)


def test_catchup_does_not_remove_normal_early_refresh_guarantee():
    seed, _ = catchup.historical_seed()
    end = batch.clock(seed.admission['dispatch_not_after'])
    assert end + timedelta(seconds=1500) == batch.clock(seed.request['first_deadline'])
    with pytest.raises(ValueError, match='finite review window'):
        runner.preparation.load_review(now=NOW)
    config = enabled()
    before_due = batch.clock(seed.request['first_deadline'])
    config['admission'].update(evaluation_time=batch.timestamp(before_due),
        dispatch_not_after=batch.timestamp(before_due + timedelta(minutes=1)))
    with pytest.raises(ValueError, match='actual overdue obligations'):
        catchup.build_review(config, now=before_due)


def test_old_seeds_are_only_immutable_historical_selection_and_lineage(review):
    seed, _ = catchup.historical_seed()
    assert review.historical_seed['current_validity_attested'] is False
    assert review.historical_seed['kind'] == 'historical_selection_and_lineage_only'
    assert review.historical_seed['first_original_deadline'] == seed.request['first_deadline']
    assert batch.clock(seed.request['first_deadline']) < NOW
    assert review.plan['evaluation_time'] == batch.timestamp(NOW)
    assert review.plan['required_valid_through'] == batch.timestamp(NOW + timedelta(hours=36))
    assert review.plan['source_data_as_of'] == seed.plan['source_data_as_of']
    assert review.plan['verified_us_cohort'] == seed.plan['verified_us_cohort']
    for name in ('collector-plan.json', 'dispatch-review.json', 'dispatch-admission.json'):
        assert review.contents['historical-' + name] == seed.contents[name]
    for name in ('retained-queue.json', 'consumer-queue.json'):
        assert review.contents[name] == seed.contents[name]
    for old, new in zip(seed.selected, review.selected):
        assert new == {key: old[key] for key in new}
    with pytest.raises(TypeError):
        review.queue[0]['retained']['annual_observed_at'] = batch.timestamp(NOW)


@pytest.mark.parametrize('deferred', [tuple(s for s, yes in zip(('BHP', 'BTI', 'BXDC', 'CCEP'), mask) if yes)
    for mask in itertools.product((False, True), repeat=4)])
def test_all_sixteen_explicit_dispositions_preserve_failure_and_exact_bounded_selection(deferred):
    review = catchup.build_review(enabled(deferred=deferred), now=NOW)
    original, _ = catchup.historical_seed()
    assert len(review.plan['selected']) == 200
    assert review.existing_selected_receipts == 396 + len(deferred)
    assert not set(deferred) & set(review.plan['batch_allowlist'])
    if deferred:
        assert review.plan['batch_allowlist'][-len(deferred):] == ['CNA', 'CNC', 'CNH', 'CNI'][:len(deferred)]
    for prior, chosen in zip(original.request['missing_prior_decisions'], review.request['missing_prior_decisions']):
        assert {key: chosen[key] for key in prior if key != 'decision_state'} == {key: prior[key] for key in prior if key != 'decision_state'}
        field = 'deferral' if chosen['symbol'] in deferred else 'reobservation'
        assert chosen[field]['maximum_getter_calls'] == (0 if field == 'deferral' else 1)
        assert chosen[field]['request_id'] == review.admission['request_id']
        assert chosen[field]['expected_run_number'] == 9
    runner.preparation.require_retry_decisions(review, expected_run_number=9)
    with pytest.raises(ValueError, match='request or run'):
        runner.preparation.require_retry_decisions(review, expected_run_number=10)
    assert runner.execution_identity(review)['budget'] == runner.preparation.BUDGET
    assert runner.execution_identity(review)['fresh_work_getters'] == 400
    assert runner.execution_identity(review)['publication_authority'] == 'none'


@pytest.mark.parametrize('mutation', ['plan_clock', 'admission_clock', 'horizon', 'source_clock', 'selected_receipt',
    'contents', 'instance', 'cache', 'queue_replacement'])
def test_tampered_review_is_rejected_before_execution(review, mutation):
    if mutation == 'plan_clock': review.plan['evaluation_time'] = batch.timestamp(NOW + timedelta(seconds=1))
    elif mutation == 'admission_clock': review.admission['dispatch_not_before'] = batch.timestamp(NOW - timedelta(days=1))
    elif mutation == 'horizon': review.plan['required_valid_through'] = batch.timestamp(NOW + timedelta(hours=72))
    elif mutation == 'source_clock': review.historical_seed['source_evaluated_at'] = batch.timestamp(NOW)
    elif mutation == 'selected_receipt': review.selected[0]['annual_receipt'] = 'f' * 64
    elif mutation == 'contents': review.contents['consumer-queue.json'] = b'{}'
    elif mutation == 'instance': review.instance['admission']['expected_run_number'] = 10
    elif mutation == 'cache': review.request['selected_cache_sha256'] = 'f' * 64
    else: review.queue = list(review.queue)
    with pytest.raises(ValueError, match='binding changed'):
        catchup.validate_review(review, now=NOW)


@pytest.mark.parametrize('event', ['workflow_run', 'workflow_dispatch', 'schedule'])
def test_source_request_cannot_opt_in_via_workflow_event_label(review, authorization, event):
    _, _, context = authorization
    execution = {**runner.execution_identity(review), 'execution_enabled': True, 'expected_run_number': 9}
    context['GITHUB_EVENT_NAME'] = event
    with pytest.raises(ValueError, match='Unreviewed repository'):
        runner.validate_execution(execution, review, now=NOW, context=context)


def test_catchup_execution_is_one_run_and_preserves_actual_start_reserve(review, authorization, monkeypatch):
    _, _, context = authorization
    execution = {**runner.execution_identity(review), 'execution_enabled': True, 'expected_run_number': 9}
    wrong = {**execution, 'expected_run_number': 10}
    with pytest.raises(ValueError, match='fixed admission'):
        runner.validate_execution(wrong, review, now=NOW, context={**context, 'GITHUB_RUN_NUMBER': '10'})
    ticks = [0.0]
    monkeypatch.setattr(runner.time, 'monotonic', lambda: ticks[0])
    admitted = NOW + timedelta(minutes=19)
    _, clock = collector.execution_clock_fixture(review, execution, context, job_start=admitted, admitted_at=admitted)
    ticks[0] = 61
    assert clock.remaining(admitted + timedelta(seconds=61)) == 1019
    ticks[0] = 1080
    with pytest.raises(ValueError, match='finalization reserve'):
        clock.remaining(admitted + timedelta(seconds=1080))
    with pytest.raises(ValueError, match='finite admission window'):
        collector.execution_clock_fixture(review, execution, context, job_start=admitted,
            admitted_at=batch.clock(execution['dispatch_not_after']) + timedelta(milliseconds=1))


def overdue_fixture(f):
    f.harness.now = NOW
    f.review.mode = catchup.MODE
    f.review.plan.update(evaluation_time=batch.timestamp(NOW), required_valid_through=batch.timestamp(NOW + timedelta(hours=36)))
    return f


def collect_overdue(f):
    return runner.collect_cycle(f.source_files, f.companion, f.root / 'output', f.review,
        collector.typed_fixture(), b'{"scope":"SYNTHETIC-LOCAL-ONLY"}', {'head_sha': 'c' * 40, 'run_number': 9},
        job_started_at=batch.timestamp(NOW), check_clock=lambda now: None, now_fn=lambda: f.harness.now)


def test_only_actual_new_capture_restores_overdue_validity_with_immutable_old_receipts(finite_cycle):
    f = overdue_fixture(finite_cycle)
    old = {digest: raw for digest, (_, raw) in f.current.objects.items()}
    work = runner.validate_retained_work(f.review, f.current, now=NOW)
    assert all(row.get('required_validity_state') != 'current' for row in work)
    result, code = collect_overdue(f)
    assert code == 0 and len(f.harness.calls) == 4
    assert result['acquisition_counts']['reused_attributes'] == 0
    assert result['retention']['canonical_zip_bytes'] > 0
    current = archive.load_archive(f.root / 'output/archive', result['cycle']['archive_manifest_sha256'],
        base_bytes=(f.source_files / 'base.json').read_bytes(), cohort=f.review.plan['verified_us_cohort'], now=NOW)
    assert all(current.objects[digest][1] == raw for digest, raw in old.items())
    for item in f.review.plan['selected']:
        for attribute in batch.ATTRIBUTES:
            digest = current.manifest['current'][f"{item['symbol']}/{attribute}"]
            receipt = current.acquisitions[digest]
            assert receipt['context']['observed_at'] == batch.timestamp(NOW)
            assert batch.required_validity_state(receipt['raw'], item['symbol'], attribute, item, f.review.plan, now=NOW)['state'] == 'current'
            # The same intact new receipt cannot attest a time before its actual capture.
            assert batch.validate_acquisition(receipt['raw'], item['symbol'], attribute,
                now=NOW - timedelta(seconds=1), as_of=batch.day(f.review.plan['source_data_as_of']))[2] == 'future_source_timestamp'
    assert (f.source_files / 'archive/manifest.json').read_bytes() == f.original_manifest


@pytest.mark.parametrize('mutation', ['retime_old', 'future_observation', 'global_cooldown'])
def test_old_receipt_retiming_future_capture_and_global_cooldown_block(finite_cycle, mutation):
    f = overdue_fixture(finite_cycle)
    if mutation == 'global_cooldown':
        f.current.manifest['attempts']['outside-cohort'] = {'symbol': 'OUTSIDE', 'outcome': 'provider_blocked', 'http_status': 429}
    else:
        receipt = f.review.selected[0]['annual_receipt']
        f.current.acquisitions[receipt]['context']['observed_at'] = batch.timestamp(NOW + timedelta(seconds=1) if mutation == 'future_observation' else NOW)
    with pytest.raises(ValueError):
        runner.validate_retained_work(f.review, f.current, now=NOW)
    assert f.harness.calls == []


def test_repeated_empty_remains_failed_with_one_getter_and_original_journal(finite_cycle):
    f = overdue_fixture(finite_cycle)
    f.harness.reply = lambda symbol, attribute: (200, {'timeseries': {'error': None, 'result': []}}) if (symbol, attribute) == ('BHP', 'quarterly_income_stmt') else (200, collector.fixtures.body(symbol, attribute))
    result, code = collect_overdue(f)
    assert code == 3 and len(f.harness.calls) == 4
    assert result['acquisition_counts']['failed_attributes'] == 1
    assert result['acquisition_counts']['reused_attributes'] == 0
    summary = json.loads((f.root / 'output/batch/summary.json').read_bytes())
    assert summary['statement_getter_calls'] == summary['transport_calls'] == 4
    raw = json.loads((f.root / 'output/batch/acquisitions/BHP-quarterly_income_stmt.json').read_bytes())
    assert raw['failure'] == {'kind': 'empty_getter_result', 'may_include_swallowed_provider_error': True}
    assert raw['source_acquisition_contexts'] == {} and raw['full_http_bodies_archived'] is False
    current = archive.load_archive(f.root / 'output/archive', result['cycle']['archive_manifest_sha256'],
        base_bytes=(f.source_files / 'base.json').read_bytes(), cohort=f.review.plan['verified_us_cohort'], now=NOW)
    assert 'BHP/quarterly_income_stmt' not in current.manifest['current']
    assert all(current.manifest['attempts'][key] == value for key, value in f.current.manifest['attempts'].items())


def test_explicit_deferral_omits_both_symbol_getters_and_preserves_its_prior_failure(finite_cycle):
    f = overdue_fixture(finite_cycle)
    f.review.plan['batch_allowlist'] = ['BBNX']
    f.review.plan['selected'] = f.review.plan['selected'][:1]
    f.review.selected = f.review.selected[:1]
    decision = f.review.request['missing_prior_decisions'][0]
    scope = decision.pop('reobservation')
    decision.update(decision_state='deferred_for_this_visit',
        deferral={key: scope[key] for key in ('request_id', 'expected_run_number')})
    decision['deferral']['maximum_getter_calls'] = 0
    _, digest = archive.export_cache(f.current, f.review.plan, (f.source_files / 'base.json').read_bytes(),
        f.root / 'deferred-cache', now=NOW)
    f.review.request['selected_cache_sha256'] = digest
    result, code = collect_overdue(f)
    assert code == 0 and len(f.harness.calls) == 2
    assert result['cycle']['retained_receipts'] == 5
    current = archive.load_archive(f.root / 'output/archive', result['cycle']['archive_manifest_sha256'],
        base_bytes=(f.source_files / 'base.json').read_bytes(), cohort=f.review.plan['verified_us_cohort'], now=NOW)
    assert 'BHP/quarterly_income_stmt' not in current.manifest['current']
    assert current.manifest['attempts'][decision['attempt_id']] == f.current.manifest['attempts'][decision['attempt_id']]


@pytest.mark.parametrize('mutation', ['ordinary_mode', 'getter_cap', 'selected_symbol', 'cooldown', 'request'])
def test_deferral_cannot_bypass_scope_or_cooldown(mutation):
    review = catchup.build_review(enabled(deferred=('BHP',)), now=NOW)
    decision = review.request['missing_prior_decisions'][0]
    if mutation == 'ordinary_mode': review.mode = 'early_refresh'
    elif mutation == 'getter_cap': decision['deferral']['maximum_getter_calls'] = 1
    elif mutation == 'selected_symbol': review.plan['batch_allowlist'].append('BHP')
    elif mutation == 'cooldown': decision['retry_not_before'] = batch.timestamp(NOW)
    else: decision['deferral']['request_id'] = 'unrelated'
    with pytest.raises(ValueError):
        runner.preparation.require_retry_decisions(review, expected_run_number=9)
