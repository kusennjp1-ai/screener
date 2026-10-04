"""Offline planner tests. No provider, database or runtime integration needed."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from app.services.statement_refresh_planning import (
    AcquisitionAttempt, FINANCIAL_HISTORY_TTL, HISTORY_CONTRACT, PROOF_CONTRACT,
    ProofStatus, HistoryStatus, ProviderResume, SOURCE_TTL, SymbolStatus,
    VerifiedAcquisition, plan_statement_refresh, statement_refresh_capacity,
)

NOW = datetime(2026, 10, 4, 10, tzinfo=timezone.utc)


def receipt(symbol="AAPL", observed_at=NOW, contract=PROOF_CONTRACT, **changes):
    return replace(VerifiedAcquisition(
        symbol, "US", contract, f"receipt:{symbol}:{contract}", "a" * 64, observed_at,
        original_receipt_verified=True, identity_verified=True, contract_verified=True,
    ), **changes)


def valid(symbol="AAPL", observed_at=NOW, *, proof_state="proved"):
    proof = ProofStatus(proof_state, (receipt(symbol, observed_at),), observed_at + SOURCE_TTL)
    return SymbolStatus(proof, proof, HistoryStatus("available", receipt(symbol, observed_at, HISTORY_CONTRACT)))


def plan(symbols=("AAPL",), statuses=None, attempts=(), **changes):
    args = dict(eligible_symbols=symbols, market="US", statuses=statuses or {},
                attempts=attempts, now=NOW)
    return plan_statement_refresh(**(args | changes))


def test_1894_bootstrap_is_ten_nonoverlapping_batches_and_continues_after_restart():
    cohort = tuple(f"STK{i:04}" for i in range(1894))
    statuses, attempts, selected = {}, [], []
    sizes = []
    for batch in range(10):
        now = NOW + timedelta(hours=batch)
        result = plan(tuple(reversed(cohort)), statuses, tuple(attempts), now=now)
        sizes.append(len(result.symbols))
        # A restart using the same persisted state returns exactly the same plan.
        assert result == plan(cohort, dict(statuses), tuple(attempts), now=now)
        assert not set(result.symbols).intersection(selected)
        for symbol in result.symbols:
            statuses[symbol] = valid(symbol, now)
            attempts.append(AcquisitionAttempt(symbol, f"try:{symbol}", now, "succeeded"))
        selected.extend(result.symbols)
    assert sizes == [200] * 9 + [94]
    assert set(selected) == set(cohort)
    assert plan(cohort, statuses, attempts, now=NOW + timedelta(hours=10)).symbols == ()


def test_72_hour_history_expiry_is_independent_of_seven_day_proof():
    statuses = {"AAPL": valid()}
    assert plan(statuses=statuses, now=NOW + FINANCIAL_HISTORY_TTL).symbols == ()
    expired = plan(statuses=statuses, now=NOW + FINANCIAL_HISTORY_TTL + timedelta(microseconds=1))
    assert expired.symbols == ("AAPL",)
    assert expired.batch[0].ready_targets == ("annual_history",)
    assert expired.cause_counts == {"annual_history_expired": 1}
    all_expired = plan(statuses=statuses, now=NOW + SOURCE_TTL + timedelta(seconds=1))
    assert all_expired.batch[0].ready_targets == ("eps", "sales", "annual_history")


def test_previous_success_does_not_block_new_history_expiry():
    attempts = (AcquisitionAttempt("AAPL", "a1", NOW, "succeeded"),)
    result = plan(statuses={"AAPL": valid()}, attempts=attempts,
                  now=NOW + FINANCIAL_HISTORY_TTL + timedelta(seconds=1))
    assert result.symbols == ("AAPL",)


def test_no_cohort_all_valid_and_partial_unknown_are_distinct():
    assert plan(()).eligible_count == 0
    assert plan(()).symbols == ()
    assert plan(statuses={"AAPL": valid()}).required_work == ()
    partial = replace(valid(), sales=ProofStatus())
    result = plan(statuses={"AAPL": partial})
    assert result.cause_counts == {"sales_proof_gap": 1}
    assert result.batch[0].ready_targets == ("sales",)
    unknown = plan()
    assert unknown.batch[0].ready_targets == ("eps", "sales", "annual_history")


def test_source_valid_nonpositive_and_quarantined_rating_create_no_refill_demand():
    state = replace(valid(proof_state="nonpositive_proved"), quarantined_derived_rating=True)
    result = plan(statuses={"AAPL": state})
    assert result.symbols == ()
    assert result.required_work == ()
    assert result.cause_counts == {
        "eps_nonpositive_proved": 1, "sales_nonpositive_proved": 1, "quarantined_derived_rating": 1,
    }


def test_nonpositive_without_proof_remains_unknown():
    state = replace(valid(), eps=ProofStatus("nonpositive_proved"))
    result = plan(statuses={"AAPL": state})
    assert result.cause_counts == {"eps_proof_gap": 1}


@pytest.mark.parametrize("changes", [
    {"observed_at": NOW + timedelta(seconds=1)}, {"symbol": "MSFT"}, {"market": "HK"},
    {"contract": "unsupported"}, {"original_receipt_verified": False},
    {"identity_verified": False}, {"contract_verified": False}, {"payload_sha256": "bad"},
    {"receipt_id": ""}, {"observed_at": NOW.replace(tzinfo=None)},
])
def test_invalid_acquisitions_do_not_count_as_proof_or_history(changes):
    state = valid()
    bad_proof = replace(state.eps, receipts=(replace(state.eps.receipts[0], **changes),))
    bad_history = replace(state.annual_history, receipt=replace(state.annual_history.receipt, **changes))
    result = plan(statuses={"AAPL": replace(state, eps=bad_proof, annual_history=bad_history)})
    assert result.batch[0].ready_targets == ("eps", "annual_history")
    assert result.invalid_receipts == ("AAPL:eps", "AAPL:annual_history")


def test_all_proof_receipts_must_be_valid_and_original_clock_bounds_expiry():
    state = valid()
    mixed = replace(state.eps, receipts=state.eps.receipts + (receipt(symbol="MSFT"),))
    assert plan(statuses={"AAPL": replace(state, eps=mixed)}).cause_counts == {"eps_proof_gap": 1}
    too_long = replace(state.eps, expires_at=NOW + SOURCE_TTL + timedelta(seconds=1))
    assert plan(statuses={"AAPL": replace(state, eps=too_long)}).cause_counts == {"eps_proof_gap": 1}


def test_existing_reporting_period_expiry_is_honored_without_new_age_policy():
    state = valid()
    earlier_expiry = NOW + timedelta(hours=1)
    state = replace(state, eps=replace(state.eps, expires_at=earlier_expiry))
    result = plan(statuses={"AAPL": state}, now=earlier_expiry + timedelta(microseconds=1))
    assert result.cause_counts == {"eps_proof_gap": 1}


def test_cache_clock_cannot_launder_history_freshness_or_rotation():
    old = NOW - timedelta(days=4)
    state = valid(observed_at=old)
    original = plan(("MSFT", "AAPL"), {"AAPL": state})
    # Adapter persists the trusted receipt unchanged when rewriting a cache.
    cache = {"updated_at": NOW, "cache_written_at": NOW, "retrieved_at": NOW, "status": state}
    rewritten = plan(("AAPL", "MSFT"), {"AAPL": cache["status"]})
    assert rewritten == original
    assert rewritten.symbols == ("MSFT", "AAPL")
    assert rewritten.cause_counts["annual_history_expired"] == 1
    with pytest.raises(TypeError):
        VerifiedAcquisition(**(state.annual_history.receipt.__dict__ | {"updated_at": NOW}))


def test_oldest_real_service_then_symbol_orders_coverage_and_attempts():
    early = NOW - timedelta(days=5)
    late = NOW - timedelta(days=4)
    statuses = {"AAPL": valid(observed_at=late), "MSFT": valid("MSFT", early)}
    assert plan(("MSFT", "NVDA", "AAPL"), statuses).symbols == ("NVDA", "MSFT", "AAPL")
    attempts = (AcquisitionAttempt("NVDA", "tried-nvda", NOW - timedelta(hours=2), "failed",
                                   retry_not_before=NOW - timedelta(hours=1)),)
    assert plan(("MSFT", "NVDA", "AAPL"), statuses, attempts).symbols == ("MSFT", "AAPL", "NVDA")


@pytest.mark.parametrize("outcome", ["failed", "succeeded", "in_flight", "source_period_missing"])
def test_attempt_without_resolved_evidence_needs_explicit_retry_decision(outcome):
    attempt = AcquisitionAttempt("AAPL", "attempt", NOW, outcome)
    result = plan(attempts=(attempt,))
    assert result.symbols == ()
    assert len(result.required_work) == 1
    assert {r.state for r in result.required_work[0].requirements} == {"retry_decision_required"}


def test_explicit_finite_retry_deadline_prevents_immediate_failure_retry():
    deadline = NOW + timedelta(hours=2)
    attempt = AcquisitionAttempt("AAPL", "attempt", NOW, "failed", deadline)
    result = plan(attempts=(attempt,))
    assert result.symbols == ()
    assert result.next_wake_at == deadline
    assert plan(attempts=(attempt,), now=deadline).symbols == ("AAPL",)


def test_verified_missing_period_is_deferred_without_suppressing_other_targets():
    state = replace(valid(), eps=ProofStatus("source_period_missing", (receipt(),)), sales=ProofStatus())
    result = plan(statuses={"AAPL": state})
    assert result.cause_counts == {"eps_source_period_missing": 1, "sales_proof_gap": 1}
    assert result.batch[0].ready_targets == ("sales",)
    assert result.batch[0].requirements[0].state == "retry_decision_required"


def test_missing_annual_period_is_not_an_acquisition_gap_or_endless_retry():
    deadline = NOW + timedelta(days=1)
    state = replace(valid(), annual_history=HistoryStatus(
        "source_period_missing", receipt(contract=HISTORY_CONTRACT), deadline,
    ))
    result = plan(statuses={"AAPL": state})
    assert result.cause_counts == {"annual_history_source_period_missing": 1}
    assert result.symbols == ()
    assert plan(statuses={"AAPL": state}, now=deadline).batch[0].ready_targets == ("annual_history",)


def test_unverified_missing_period_is_unknown_not_an_indefinite_suppression():
    state = replace(valid(), eps=ProofStatus("source_period_missing"))
    assert plan(statuses={"AAPL": state}).batch[0].ready_targets == ("eps",)


@pytest.mark.parametrize("http_status", [403, 429])
def test_blocked_provider_stops_entire_cohort_until_explicit_bound_recovery(http_status):
    deadline = NOW + timedelta(hours=6)
    blocked = AcquisitionAttempt("AAPL", "blocked", NOW, "failed", deadline, http_status)
    result = plan(("AAPL", "MSFT"), attempts=(blocked,))
    assert result.symbols == ()
    assert result.provider_state == "provider_cooldown"
    assert all(r.state == "provider_stopped" for w in result.required_work for r in w.requirements)
    # Elapsed time alone is not a provider recovery decision.
    assert plan(("AAPL", "MSFT"), attempts=(blocked,), now=deadline).provider_state == "provider_resume_required"
    wrong = ProviderResume("other-block", deadline)
    assert plan(("AAPL", "MSFT"), attempts=(blocked,), now=deadline, provider_resume=wrong).symbols == ()
    recovered = plan(("AAPL", "MSFT"), attempts=(blocked,), now=deadline,
                     provider_resume=ProviderResume("blocked", deadline))
    assert recovered.symbols == ("MSFT", "AAPL")


def test_blocked_provider_without_cooldown_does_not_guess_one_or_auto_retry():
    blocked = AcquisitionAttempt("AAPL", "blocked", NOW, "provider_blocked")
    assert plan(attempts=(blocked,)).provider_state == "provider_retry_decision_required"
    assert plan(attempts=(blocked,), now=NOW + timedelta(days=99)).symbols == ()


@pytest.mark.parametrize("symbols,statuses,attempts", [
    (("AAPL", "AAPL"), {}, ()), (("aapl",), {}, ()), ((" AAPL",), {}, ()),
    (("AAPL",), {"MSFT": valid("MSFT")}, ()),
    (("AAPL",), {}, (AcquisitionAttempt("MSFT", "a", NOW, "failed"),)),
])
def test_duplicate_noncanonical_and_foreign_symbols_rejected(symbols, statuses, attempts):
    with pytest.raises(ValueError):
        plan(symbols, statuses, attempts)


@pytest.mark.parametrize("limit", [0, -1, 201, 300, True, 1.5])
def test_batch_limit_never_silently_expands_or_coerces_scope(limit):
    with pytest.raises(ValueError):
        plan(batch_limit=limit)


def test_batch_bound_is_symbols_not_number_of_statement_targets():
    cohort = tuple(f"STK{i:04}" for i in range(250))
    result = plan(cohort)
    assert len(result.required_work) == 250
    assert len(result.batch) == 200
    assert all(item.ready_targets == ("eps", "sales", "annual_history") for item in result.batch)
    assert len(plan(cohort, batch_limit=1).symbols) == 1


def test_future_attempt_naive_clock_and_immediate_retry_are_rejected():
    with pytest.raises(ValueError):
        plan(now=NOW.replace(tzinfo=None))
    with pytest.raises(ValueError):
        plan(attempts=(AcquisitionAttempt("AAPL", "a", NOW + timedelta(seconds=1), "failed"),))
    with pytest.raises(ValueError):
        plan(attempts=(AcquisitionAttempt("AAPL", "a", NOW, "failed", NOW),))


def test_capacity_is_honest_about_72_hours_and_provider_failures():
    once = statement_refresh_capacity(1894, batches_per_day=1)
    four = statement_refresh_capacity(1894, batches_per_day=4)
    assert once["bootstrap_batches"] == four["bootstrap_batches"] == 10
    assert once["nominal_capacity_within_history_ttl"] is False
    assert four["nominal_symbols_per_day"] == 800
    assert four["required_average_symbols_per_day"] == pytest.approx(1894 / 3)
    assert four["nominal_capacity_within_history_ttl"] is True
    assert four["guaranteed_coverage"] is False


def test_provider_stop_survives_changed_cohort_and_conflicts_fail_closed():
    from app.services.statement_refresh_planning import ProviderStop

    deadline = NOW + timedelta(hours=1)
    stop = ProviderStop("old-symbol-block", NOW, 429, deadline)
    result = plan(("MSFT",), provider_stop=stop)
    assert result.provider_state == "provider_cooldown"
    assert result.symbols == ()
    conflicting = AcquisitionAttempt("MSFT", "old-symbol-block", NOW, "failed", None, 429)
    with pytest.raises(ValueError):
        plan(("MSFT",), attempts=(conflicting,), provider_stop=stop)


def test_explicit_refresh_horizon_prevents_gaps_at_four_successful_batches_daily():
    cohort = tuple(f"STK{i:04}" for i in range(1894))
    statuses, attempts = {}, []
    for batch in range(40):
        now = NOW + timedelta(hours=6 * batch)
        result = plan(cohort, statuses, attempts, now=now, refresh_through=now + timedelta(hours=6))
        assert len(result.symbols) <= 200
        for symbol in result.symbols:
            statuses[symbol] = valid(symbol, now)
            attempts.append(AcquisitionAttempt(symbol, f"try:{batch}:{symbol}", now, "succeeded"))
        if batch >= 9:
            assert len(statuses) == 1894
            # Successful original receipts retain coverage until the next run.
            assert all(now + timedelta(hours=6) - s.annual_history.receipt.observed_at <= FINANCIAL_HISTORY_TTL
                       for s in statuses.values())
    assert plan(statuses={"AAPL": valid()}, refresh_through=NOW + FINANCIAL_HISTORY_TTL).cause_counts == {
        "annual_history_expiring": 1,
    }
    with pytest.raises(ValueError):
        plan(refresh_through=NOW - timedelta(seconds=1))


def test_export_binds_exact_cohort_base_clock_allowlist_and_attributes():
    from app.services.statement_refresh_planning import export_statement_batch_plan

    statuses = {"AAPL": replace(valid(), sales=ProofStatus())}
    result = plan(("MSFT", "AAPL"), statuses)
    payload = export_statement_batch_plan(result, base_artifact_sha256="b" * 64,
                                          source_data_as_of="2026-10-02", batch_allowlist=result.symbols)
    assert payload == {
        "schema_version": "financial-statement-batch-plan-v1",
        "verified_us_cohort": {"symbols": ["AAPL", "MSFT"], "base_artifact_sha256": "b" * 64},
        "batch_allowlist": ["MSFT", "AAPL"], "evaluation_time": "2026-10-04T10:00:00Z",
        "required_valid_through": "2026-10-04T10:00:00Z",
        "source_data_as_of": "2026-10-02",
        "selected": [
            {"symbol": "MSFT", "attributes": ["quarterly_income_stmt", "income_stmt"],
             "targets": ["eps", "sales", "annual_history"]},
            {"symbol": "AAPL", "attributes": ["quarterly_income_stmt"], "targets": ["sales"]},
        ],
    }


@pytest.mark.parametrize("changes", [
    {"base_artifact_sha256": "invalid"}, {"source_data_as_of": "2026-10-05"},
    {"source_data_as_of": "2026-10-99"}, {"batch_allowlist": []},
    {"batch_allowlist": ["AAPL", "AAPL"]}, {"batch_allowlist": ["MSFT"]},
])
def test_export_rejects_unbound_selected_scope(changes):
    from app.services.statement_refresh_planning import export_statement_batch_plan

    args = dict(base_artifact_sha256="b" * 64, source_data_as_of="2026-10-02", batch_allowlist=["AAPL"])
    with pytest.raises(ValueError):
        export_statement_batch_plan(plan(), **(args | changes))


def test_annual_eps_proof_gap_exports_annual_getter_without_hidden_scope():
    from app.services.statement_refresh_planning import export_statement_batch_plan

    state = replace(valid(), eps=ProofStatus(attributes=("income_stmt",)))
    result = plan(statuses={"AAPL": state})
    payload = export_statement_batch_plan(result, base_artifact_sha256="b" * 64,
                                          source_data_as_of="2026-10-02", batch_allowlist=result.symbols)
    assert payload["selected"] == [{"symbol": "AAPL", "attributes": ["income_stmt"], "targets": ["eps"]}]
    for attributes in [("info",), ("income_stmt", "quarterly_income_stmt"), (),
                       ("quarterly_income_stmt", "quarterly_income_stmt")]:
        with pytest.raises(ValueError):
            plan(statuses={"AAPL": replace(state, eps=ProofStatus(attributes=attributes))})


def test_capacity_reports_whole_cycle_plus_explicit_run_budget():
    capacity = statement_refresh_capacity(1894, batches_per_day=4, bounded_run_budget=timedelta(hours=1))
    assert capacity["nominal_cycle_hours"] == 60
    assert capacity["cycle_budget_hours"] == 61
    assert capacity["nominal_capacity_within_history_ttl"] is True
    assert statement_refresh_capacity(1894, batches_per_day=4, bounded_run_budget=timedelta(hours=12))[
        "nominal_capacity_within_history_ttl"] is False
    assert statement_refresh_capacity(2400, batches_per_day=4)["nominal_capacity_within_history_ttl"] is False
    assert statement_refresh_capacity(1894, batches_per_day=0)["cycle_budget_hours"] is None


def test_early_maintenance_failure_respects_retry_before_original_expiry():
    deadline = NOW + timedelta(hours=3)
    attempt = AcquisitionAttempt("AAPL", "maintenance", NOW, "failed", deadline)
    result = plan(statuses={"AAPL": valid()}, attempts=(attempt,),
                  refresh_through=NOW + FINANCIAL_HISTORY_TTL)
    assert result.symbols == ()
    assert result.required_work[0].requirements[0].state == "cooldown"


def test_success_without_new_receipt_does_not_repeatedly_refill_early_maintenance():
    state = valid(observed_at=NOW - timedelta(hours=1))
    attempt = AcquisitionAttempt("AAPL", "partial", NOW, "succeeded")
    result = plan(statuses={"AAPL": state}, attempts=(attempt,),
                  refresh_through=NOW + FINANCIAL_HISTORY_TTL)
    assert result.symbols == ()
    assert result.required_work[0].requirements[0].state == "retry_decision_required"


def test_attempt_scope_does_not_suppress_unattempted_statement_attribute():
    state = replace(valid(), eps=ProofStatus(attributes=("income_stmt",)))
    attempt = AcquisitionAttempt("AAPL", "quarter-failed", NOW, "failed",
                                 attributes=("quarterly_income_stmt",))
    result = plan(statuses={"AAPL": state}, attempts=(attempt,))
    assert result.symbols == ("AAPL",)
    assert result.batch[0].attributes == ("income_stmt",)


def test_explicit_market_cannot_relabel_foreign_symbol_as_us():
    with pytest.raises(ValueError):
        plan(("0700.HK",))
    with pytest.raises(ValueError):
        plan(("AAPL",), market="HK")
    assert plan(("0700.HK",), market="HK").symbols == ("0700.HK",)


@pytest.mark.parametrize("http_status", ["429", 429.0, True, 999])
def test_malformed_http_status_cannot_silently_skip_provider_stop(http_status):
    with pytest.raises(ValueError):
        plan(attempts=(AcquisitionAttempt("AAPL", "blocked", NOW, "failed", http_status=http_status),))


def test_export_preserves_maintenance_horizon_and_only_ready_targets():
    from app.services.statement_refresh_planning import export_statement_batch_plan

    now = NOW + timedelta(hours=66)
    horizon = now + timedelta(hours=12)
    state = replace(valid(), eps=ProofStatus("source_period_missing", (receipt(),)))
    result = plan(statuses={"AAPL": state}, now=now, refresh_through=horizon)
    exported = export_statement_batch_plan(result, base_artifact_sha256="b" * 64,
                                           source_data_as_of="2026-10-02", batch_allowlist=result.symbols)
    assert exported["required_valid_through"] == horizon.isoformat().replace("+00:00", "Z")
    assert exported["selected"] == [{
        "symbol": "AAPL", "attributes": ["quarterly_income_stmt", "income_stmt"],
        "targets": ["annual_history"],
    }]
    with pytest.raises(ValueError):
        export_statement_batch_plan(replace(result, required_valid_through=now - timedelta(seconds=1)),
                                    base_artifact_sha256="b" * 64, source_data_as_of="2026-10-02",
                                    batch_allowlist=result.symbols)


def test_export_rejects_horizon_beyond_selected_acquisition_lifetime():
    from app.services.statement_refresh_planning import export_statement_batch_plan

    args = dict(base_artifact_sha256="b" * 64, source_data_as_of="2026-10-02", batch_allowlist=["AAPL"])
    with pytest.raises(ValueError):
        export_statement_batch_plan(plan(refresh_through=NOW + FINANCIAL_HISTORY_TTL + timedelta(seconds=1)), **args)
    quarter_only = plan(statuses={"AAPL": replace(valid(), eps=ProofStatus())})
    assert export_statement_batch_plan(replace(quarter_only, required_valid_through=NOW + SOURCE_TTL), **args)
    with pytest.raises(ValueError):
        export_statement_batch_plan(replace(quarter_only, required_valid_through=NOW + SOURCE_TTL + timedelta(seconds=1)), **args)
