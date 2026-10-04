"""Planner → real mocked collector → retained receipt maintenance regression.

Runs when the separately packaged collector is present. The shared collector
harness blocks socket connect and curl perform and supplies synthetic Yahoo
transport responses to the pinned provider's actual statement normalizer.
"""
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

batch = pytest.importorskip("app.services.financial_statement_batch")
helpers = pytest.importorskip("tests.unit.test_financial_statement_batch")

from app.services.financial_source_evidence import FINANCIAL_FIELDS
from app.services.statement_refresh_planning import (
    AcquisitionAttempt, FINANCIAL_HISTORY_TTL, HISTORY_CONTRACT, PROOF_CONTRACT,
    HistoryStatus, ProofStatus, SymbolStatus, VerifiedAcquisition,
    export_statement_batch_plan, plan_statement_refresh,
)


@pytest.fixture
def collector():
    harness = helpers.TestFinancialStatementBatch(methodName="runTest")
    harness.setUp()
    harness.plan, harness.base = helpers.plan_for(("NVDA",))
    try:
        yield harness
    finally:
        harness.doCleanups()


def verified_status(collector):
    """Audit actual retained bytes and existing proofs; never invent a clock."""
    symbol = "NVDA"
    result = collector.result(symbol)
    proof = result["financial_current"]
    acquisitions, contexts = {}, {}
    for attribute in batch.ATTRIBUTES:
        raw = helpers.read(collector.output / f"acquisitions/{symbol}-{attribute}.json")
        _, context, state = batch.validate_acquisition(
            raw, symbol, attribute, now=collector.now, as_of=batch.day(collector.plan["source_data_as_of"]),
        )
        assert state == "current"
        acquisitions[attribute], contexts[attribute] = raw, context

    def receipt(context, contract):
        return VerifiedAcquisition(
            symbol, "US", contract, context["capture_id"], context["raw_payload_sha256"],
            batch.clock(context["observed_at"]), True, True, True,
        )

    def status(fields):
        indexes = [FINANCIAL_FIELDS.index(name) for name in fields]
        assert all(proof["r"][index] in {"0", "f"} for index in indexes)
        expiry_ms = min(proof["p"][str(index)][5] for index in indexes)
        return ProofStatus(
            "nonpositive_proved" if any(proof["r"][index] == "f" for index in indexes) else "proved",
            (receipt(contexts["quarterly_income_stmt"], PROOF_CONTRACT),),
            datetime.fromtimestamp(expiry_ms / 1000, timezone.utc),
        )

    history, diagnostics = batch.history_projection(
        symbol, acquisitions, now=collector.now, as_of=batch.day(collector.plan["source_data_as_of"]),
    )
    assert diagnostics["reasons"] == {"annual": "available", "quarterly": "available"}
    oldest = min(contexts.values(), key=lambda item: batch.clock(item["observed_at"]))
    assert history["retrieved_at"] == oldest["observed_at"]
    return SymbolStatus(
        status(("eps_q1_yoy", "eps_q2_yoy")), status(("sales_growth_qq", "sales_growth_yy")),
        HistoryStatus("available", receipt(oldest, HISTORY_CONTRACT)),
    )


def export(collector, statuses, attempts=(), horizon=None):
    planned = plan_statement_refresh(
        eligible_symbols=("NVDA",), market="US", statuses=statuses, attempts=attempts,
        now=collector.now, refresh_through=horizon,
    )
    if planned.symbols:
        collector.plan = export_statement_batch_plan(
            planned, base_artifact_sha256=batch.digest_bytes(collector.base),
            source_data_as_of="2026-10-02", batch_allowlist=planned.symbols,
        )
    return planned


def test_maintenance_really_reacquires_both_receipts_and_does_not_churn(collector):
    initial_time = collector.now
    export(collector, {})
    summary, code = collector.run_batch()
    assert code == 0 and summary["statement_getter_calls"] == 2
    initial_directory = collector.output
    original_bytes = {attribute: (initial_directory / f"acquisitions/NVDA-{attribute}.json").read_bytes()
                      for attribute in batch.ATTRIBUTES}
    original_state = verified_status(collector)
    attempts = (AcquisitionAttempt("NVDA", "bootstrap", initial_time, "succeeded"),)

    # A missing proof projection can be rebuilt from a genuinely current cache
    # without a provider call. It does not create a new acquisition clock.
    collector.now = initial_time + timedelta(hours=2)
    current = replace(original_state, eps=ProofStatus())
    planned = export(collector, {"NVDA": current})
    assert planned.batch[0].ready_targets == ("eps",)
    summary, code = collector.resume("proof-rebuilt")
    assert code == 0 and summary["statement_getter_calls"] == 0
    assert collector.calls == []
    rebuilt_state = verified_status(collector)
    assert rebuilt_state.annual_history.receipt.observed_at == initial_time

    # Both receipts remain valid NOW, but cannot serve the explicit next-run
    # horizon. Reusing the 7-day quarter here would keep history's oldest clock
    # almost expired and make the next planner run request annual work again.
    collector.now = initial_time + timedelta(hours=66)
    horizon = collector.now + timedelta(hours=12)
    planned = export(collector, {"NVDA": rebuilt_state}, attempts, horizon)
    assert planned.batch[0].ready_targets == ("annual_history",)
    assert collector.plan["required_valid_through"] == batch.timestamp(horizon).replace(".000Z", "Z")
    assert collector.plan["selected"][0]["targets"] == ["annual_history"]
    summary, code = collector.resume("maintenance")
    assert code == 0 and summary["statement_getter_calls"] == 2
    assert collector.calls == [("quarterly_income_stmt", "NVDA"), ("income_stmt", "NVDA")]
    assert summary["counts"]["reused_attributes"] == 0
    maintained = verified_status(collector)
    assert maintained.annual_history.receipt.observed_at == collector.now
    assert horizon - maintained.annual_history.receipt.observed_at <= FINANCIAL_HISTORY_TTL
    for attribute in batch.ATTRIBUTES:
        assert (initial_directory / f"acquisitions/NVDA-{attribute}.json").read_bytes() == original_bytes[attribute]
        raw = helpers.read(collector.output / f"acquisitions/NVDA-{attribute}.json")
        assert batch.clock(raw["source_acquisition_contexts"][attribute]["observed_at"]) == collector.now

    refreshed_at = collector.now
    attempts += (AcquisitionAttempt("NVDA", "maintenance", refreshed_at, "succeeded"),)
    collector.now += timedelta(hours=1)
    next_plan = export(collector, {"NVDA": maintained}, attempts, horizon + timedelta(hours=1))
    assert next_plan.symbols == ()
    assert next_plan.cause_counts == {}
