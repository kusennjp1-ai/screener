"""Contract fixtures and adversarial tests for shadow source evidence."""
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path

import pytest

from app.services.financial_source_evidence import (
    FINANCIAL_FIELDS, SCHEMA, field_availability, legacy_financial_evidence,
    make_capture_context, make_derived_record, make_envelope, make_observed_record,
    merge_financial_payloads, observation_id, project_current_financials,
    source_timestamp, validate_envelope, restore_retained_raw_envelope,
)

NOW = "2026-10-03T12:00:00.000Z"


def payload(value=12.5, *, symbol="ACME", market="US", field="eps_growth_qq", at=NOW,
            capture_id="capture-1", basis="quarterly-qoq-v1", unit="percent_points"):
    context = make_capture_context(symbol=symbol, market=market, source="yfinance",
        producer="fixture.statement/v1", provider_symbol=symbol, observed_at=at,
        source_payload={"Diluted EPS": {"2026-06-30": 1.125, "2026-03-31": 1}}, capture_id=capture_id)
    record = make_observed_record(field, value, context, unit=unit, basis=basis,
        period_end="2026-06-30", comparable_period_end="2026-03-31", cadence="quarterly",
        metric="Diluted EPS", period_status="supplied")
    return {"symbol": symbol, "market": market, field: value,
            "financial_source_evidence": make_envelope(symbol=symbol, market=market, fields={field: record})}


def contracts():
    return {field: {("fixture.statement/v1", "quarterly-qoq-v1", "percent_points")} for field in FINANCIAL_FIELDS}


def test_shared_contract_fixtures():
    fixture = json.loads((Path(__file__).resolve().parents[3] / "contracts/financial_source_evidence_v1.json").read_text())
    assert fixture["field_order"] == list(FINANCIAL_FIELDS)
    for case in fixture["projection_cases"]:
        projection = project_current_financials(case["row"], now=case["now"], approved_contracts=contracts())
        field = case["field"]
        assert projection["current"][field] == case["expected_value"], case["name"]
        assert projection["audit"]["availability"][field]["reason"] == case["expected_reason"], case["name"]
        assert projection["audit"]["raw_values"][field] == case["row"][field]


@pytest.mark.parametrize("value", [True, "0", float("inf"), float("nan"), [1, 2], [1, False, 2]])
def test_constructor_rejects_invalid_values(value):
    with pytest.raises(ValueError):
        payload(value, field="annual_eps_growth_3y" if isinstance(value, list) else "eps_growth_qq")


@pytest.mark.parametrize("stamp", ["2026-10-03", "2026-10-03T00:00:00", "2026-02-30T00:00:00Z", "2026-10-03T25:00:00Z", "2026-10-03T00:00:00+24:00"])
def test_new_observations_reject_non_rfc3339_clocks(stamp):
    with pytest.raises(ValueError):
        payload(at=stamp)


def test_naive_utc_is_only_accepted_by_diagnostic_legacy_adapter():
    assert source_timestamp("2026-10-03T00:00:00") is None
    assert source_timestamp("2026-10-03T00:00:00", legacy=True) is not None
    with pytest.raises(ValueError):
        payload(at=datetime(2026, 10, 3))


def test_capture_is_deduplicated_and_hash_binds_source_subset():
    one = payload()
    envelope = one["financial_source_evidence"]
    assert len(envelope["captures"]) == 1
    assert "source_payload" not in envelope["fields"]["eps_growth_qq"]
    bad = deepcopy(envelope)
    bad["captures"]["capture-1"]["source_payload"]["Diluted EPS"]["2026-06-30"] = 999
    with pytest.raises(ValueError, match="subset"):
        validate_envelope(bad)


@pytest.mark.parametrize("key,value", [("value", 11), ("symbol", "OTHER"), ("market", "HK"), ("unit", "fraction"), ("basis", "ttm"), ("period_end", "2026-09-30"), ("observed_at", "2026-10-04T00:00:00Z")])
def test_observation_id_binds_value_identity_semantics_and_clock(key, value):
    record = payload()["financial_source_evidence"]["fields"]["eps_growth_qq"]
    changed = {**record, key: value}
    assert observation_id(changed) != record["observation_id"]


def test_shadow_merge_preserves_old_primary_semantics_even_when_fallback_fresh():
    primary = payload(0, at="2026-01-01T00:00:00Z", capture_id="old")
    fallback = payload(-12, capture_id="fresh")
    result = merge_financial_payloads(primary, fallback)
    assert result["eps_growth_qq"] == 0
    assert "eps_growth_quarterly" not in result
    assert result["financial_source_evidence"]["fields"]["eps_growth_qq"]["capture_id"] == "old"
    assert len(result["financial_source_evidence"]["retained_candidates"]["eps_growth_qq"]) == 2


def test_no_borrowing_fallback_evidence_even_for_equal_values():
    fallback = payload(10)
    result = merge_financial_payloads({"symbol": "ACME", "market": "US", "eps_growth_qq": 10}, fallback)
    assert result["eps_growth_qq"] == 10
    selected = result["financial_source_evidence"]["fields"]["eps_growth_qq"]
    assert selected["provenance_kind"] == "legacy_canonical_map"
    assert selected["observed_at"] is None


def test_chained_merge_retains_candidates_original_context_and_raw_envelopes():
    first = payload(1, capture_id="a")
    first["financial_source_evidence"]["legacy_statement_context"] = {"context": "quarter-a"}
    second = payload(2, capture_id="b")
    second["financial_source_evidence"]["legacy_statement_context"] = {"context": "quarter-b"}
    third = payload(3, capture_id="c")
    original = deepcopy(first)
    merged = merge_financial_payloads(third, merge_financial_payloads(second, first))
    assert first == original
    envelope = merged["financial_source_evidence"]
    assert {record["capture_id"] for record in envelope["retained_candidates"]["eps_growth_qq"]} == {"a", "b", "c"}
    raw = [restore_retained_raw_envelope(envelope, key) for key in envelope["retained_raw_envelopes"]]
    assert first["financial_source_evidence"] in raw
    assert second["financial_source_evidence"] in raw
    assert set(envelope["captures"]) == {"a", "b", "c"}
    assert json.loads(json.dumps(merged)) == merged


@pytest.mark.parametrize("field,value", [("symbol", "OTHER"), ("market", "HK")])
def test_cross_security_payload_merge_is_rejected(field, value):
    primary = payload()
    fallback = payload()
    fallback[field] = value
    with pytest.raises(ValueError, match="different"):
        merge_financial_payloads(primary, fallback)


def test_mismatched_or_unknown_envelope_is_retained_raw_and_not_attached_to_value():
    primary = payload()
    primary["eps_growth_qq"] = 500
    original = deepcopy(primary["financial_source_evidence"])
    result = merge_financial_payloads(primary, {})
    assert result["eps_growth_qq"] == 500
    assert result["financial_source_evidence"]["fields"]["eps_growth_qq"]["provenance_kind"] == "legacy_canonical_map"
    merged_envelope = result["financial_source_evidence"]
    assert original in [restore_retained_raw_envelope(merged_envelope, key) for key in merged_envelope["retained_raw_envelopes"]]
    primary["financial_source_evidence"]["schema"] = "future-v2"
    assert merge_financial_payloads(primary, {})["financial_source_evidence"]["fields"]["eps_growth_qq"]["provenance_kind"] == "legacy_canonical_map"


def test_legacy_annual_context_is_never_copied_into_each_field_or_refreshed():
    row = {"symbol": "ACME", "market": "US", "eps_q2_yoy": 5, "field_provenance": {"eps_q2_yoy": "yfinance"},
           "yahoo_statements_refreshed_at": "2026-01-01T00:00:00", "updated_at": NOW,
           "recent_quarter_date": "2026-Q3", "growth_metric_basis": "quarterly_qoq"}
    envelope = legacy_financial_evidence(row, symbol="ACME", market="US")
    record = envelope["fields"]["eps_q2_yoy"]
    assert record["period_end"] is None and record["basis"] is None and record["unit"] is None
    assert envelope["legacy_statement_context"]["recent_quarter_date"] == "2026-Q3"
    assert field_availability("eps_q2_yoy", 5, record, NOW)["reason"] == "stale_source"


def test_derived_observation_never_uses_computed_at_for_input_freshness():
    row = payload(12, at="2026-01-01T00:00:00Z")
    envelope = row["financial_source_evidence"]
    dependency = envelope["fields"]["eps_growth_qq"]
    derived = make_derived_record("eps_raw_score", 50, symbol="ACME", market="US", source="calculation",
        producer="fixture.statement/v1", unit="percent_points", basis="quarterly-qoq-v1",
        dependencies=[dependency["observation_id"]], algorithm_version="score-v1", computed_at=NOW)
    envelope["fields"]["eps_raw_score"] = derived
    row["eps_raw_score"] = 50
    result = project_current_financials(row, now=NOW, approved_contracts=contracts())
    assert derived["observed_at"] is None
    assert result["audit"]["availability"]["eps_raw_score"]["reason"] == "unavailable_dependency"


@pytest.mark.parametrize("location", ["selected", "retained_candidate"])
@pytest.mark.parametrize("damage", ["missing", "tampered"])
def test_derived_observation_requires_its_dependencies_retained_source(location, damage):
    row = payload()
    envelope = row["financial_source_evidence"]
    dependency = envelope["fields"]["eps_growth_qq"]
    derived = make_derived_record("eps_raw_score", 50, symbol="ACME", market="US", source="calculation",
        producer="fixture.statement/v1", unit="percent_points", basis="quarterly-qoq-v1",
        dependencies=[dependency["observation_id"]], algorithm_version="score-v1", computed_at=NOW)
    envelope["fields"]["eps_raw_score"] = derived
    row["eps_raw_score"] = 50
    if location == "retained_candidate":
        envelope["retained_candidates"]["eps_growth_qq"] = [envelope["fields"].pop("eps_growth_qq")]
    assert project_current_financials(row, now=NOW, approved_contracts=contracts())["current"]["eps_raw_score"] == 50
    if damage == "missing":
        envelope["captures"] = {}
    else:
        envelope["captures"][dependency["capture_id"]]["source_payload"] = {"wrong": "source"}
    result = project_current_financials(row, now=NOW, approved_contracts=contracts())
    assert result["current"]["eps_raw_score"] is None
    assert result["audit"]["availability"]["eps_raw_score"]["reason"] == "unavailable_dependency"


def test_stage_one_has_no_approved_semantic_contract_or_implicit_projection():
    row = payload()
    merged = merge_financial_payloads(row, {})
    assert merged["eps_growth_qq"] == row["eps_growth_qq"]
    projected = project_current_financials(merged, now=NOW)
    assert projected["current"]["eps_growth_qq"] is None
    assert projected["audit"]["availability"]["eps_growth_qq"]["reason"] == "unapproved_semantic_contract"


def test_nonfinancial_fallback_values_and_null_scoped_fields_preserve_old_behavior():
    result = merge_financial_payloads({"symbol": "ACME", "eps_growth_qq": None, "market_cap": None},
                                      {**payload(0), "market_cap": 42, "description": "Original"})
    assert result["eps_growth_qq"] == 0 and result["market_cap"] == 42
    assert result["description"] == "Original"


@pytest.mark.parametrize("bad", [None, [], "unsupported", {"schema": "future-v2"},
    {"schema": SCHEMA, "symbol": "ACME", "market": "US", "fields": None, "captures": None},
    {"schema": SCHEMA, "symbol": "ACME", "market": "US", "fields": [], "captures": []},
    {"schema": SCHEMA, "symbol": "ACME", "market": "US", "fields": {"eps_growth_qq": 5}, "retained_candidates": {"eps_growth_qq": None}},
    {"schema": SCHEMA, "symbol": "ACME", "market": "US", "fields": {}, "captures": [], "retained_candidates": []}])
def test_malformed_json_envelopes_remain_raw_unknown_without_breaking_merge(bad):
    row = {"symbol": "ACME", "market": "US", "eps_growth_qq": 5, "financial_source_evidence": bad}
    merged = merge_financial_payloads(row, {})
    assert merged["eps_growth_qq"] == 5
    assert merged["financial_source_evidence"]["fields"]["eps_growth_qq"]["provenance_kind"] == "legacy_canonical_map"
    if bad is not None:
        envelope = merged["financial_source_evidence"]
        assert bad in [restore_retained_raw_envelope(envelope, key) for key in envelope["retained_raw_envelopes"]]
    assert project_current_financials(row, now=NOW)["current"]["eps_growth_qq"] is None


def test_shadow_merge_preserves_contradictory_alias_values_exactly():
    primary = {**payload(10), "eps_growth_quarterly": 999, "eps_growth_annual": 55}
    fallback = {"symbol": "ACME", "market": "US", "eps_growth_yy": 8}
    merged = merge_financial_payloads(primary, fallback)
    for key in ("eps_growth_qq", "eps_growth_quarterly", "eps_growth_annual", "eps_growth_yy"):
        assert merged[key] == (primary.get(key) if primary.get(key) is not None else fallback.get(key))
    assert merged["financial_source_evidence"]["fields"]["eps_growth_qq"]["provenance_kind"] == "legacy_canonical_map"
    alias_only = merge_financial_payloads({"symbol": "ACME", "eps_growth_quarterly": 5}, {})
    assert "eps_growth_qq" not in alias_only
    assert alias_only["eps_growth_quarterly"] == 5


@pytest.mark.parametrize("identity", [{"symbol": "OTHER", "market": "US"}, {"symbol": "ACME", "market": "HK"}])
def test_derived_inputs_cannot_cross_security_identity(identity):
    foreign = payload(**identity)["financial_source_evidence"]["fields"]["eps_growth_qq"]
    derived = make_derived_record("eps_raw_score", 5, symbol="ACME", market="US", source="calculation",
        producer="fixture.statement/v1", unit="percent_points", basis="quarterly-qoq-v1",
        dependencies=[foreign["observation_id"]], algorithm_version="test-v1", computed_at=NOW)
    result = field_availability("eps_raw_score", 5, derived, NOW, approved_contracts=contracts(),
                               observations={foreign["observation_id"]: foreign})
    assert result["reason"] == "unverified_dependency_identity"


def test_reconciliation_reads_are_idempotent_and_do_not_grow_audit():
    normalized = merge_financial_payloads(payload(), {})
    assert merge_financial_payloads(normalized, {}) == normalized


@pytest.mark.parametrize("value,label", [(float("nan"), "NaN"), (float("inf"), "Infinity"), (float("-inf"), "-Infinity")])
def test_nonfinite_legacy_scalars_remain_raw_without_breaking_shadow_merge(value, label):
    import math
    row = {"symbol": "ACME", "market": "US", "profit_margin": value}
    merged = merge_financial_payloads(row, {})
    assert math.isnan(merged["profit_margin"]) if label == "NaN" else merged["profit_margin"] == value
    assert "profit_margin" not in merged["financial_source_evidence"]["fields"]
    assert merged["financial_source_evidence"]["raw_values"]["profit_margin"] == {"non_finite_number": label}
    json.dumps(merged["financial_source_evidence"], allow_nan=False)


def test_retention_is_linear_and_each_source_subset_is_stored_once():
    sizes = {}
    merged = {"symbol": "ACME", "market": "US"}
    for count in range(1, 101):
        row = payload(count, capture_id=f"capture-{count}")
        merged = merge_financial_payloads(row, merged)
        if count in (20, 100):
            sizes[count] = len(json.dumps(merged["financial_source_evidence"]))
    envelope = merged["financial_source_evidence"]
    assert len(envelope["captures"]) == 100
    # Each original normalized subset lives only in the capture pool.
    assert json.dumps(envelope).count('"Diluted EPS": {') == 100
    assert sizes[100] < sizes[20] * 5.2
    archives = len(envelope["retained_raw_envelopes"])
    for revision in range(20):
        merged["financial_source_evidence"]["storage_revision"] = revision
        merged = merge_financial_payloads(row, merged)
    assert len(merged["financial_source_evidence"]["retained_raw_envelopes"]) == archives
    assert len(merged["financial_source_evidence"]["captures"]) == 100


@pytest.mark.parametrize("key,value", [("period_end", None), ("comparable_period_end", "2026-02-30"),
                                        ("metric", None), ("period_status", "not_supplied")])
def test_approved_statement_contract_still_requires_actual_period_evidence(key, value):
    row = payload()
    record = row["financial_source_evidence"]["fields"]["eps_growth_qq"]
    record[key] = value
    record["observation_id"] = observation_id(record)
    projected = project_current_financials(row, now=NOW, approved_contracts=contracts())
    assert projected["audit"]["availability"]["eps_growth_qq"]["reason"] == "unverified_reporting_period"


def test_current_projection_schema_is_opt_in_and_envelope_survives_api_schema():
    from app.schemas.stock import StockFundamentals
    row = payload()
    row["field_provenance"] = {"eps_growth_qq": "yfinance"}
    parsed = StockFundamentals(**row).model_dump(by_alias=True)
    assert parsed["financial_source_evidence"] == {**row["financial_source_evidence"], "legacy_statement_context": None}
    assert parsed["field_provenance"] == row["field_provenance"]


def test_raw_score_cannot_be_certified_as_new_vendor_observation():
    row = payload(75, field="eps_raw_score")
    result = project_current_financials(row, now=NOW, approved_contracts=contracts())
    assert result["audit"]["availability"]["eps_raw_score"]["reason"] == "unverified_derivation"


def test_boolean_inside_legacy_annual_array_cannot_bind_numeric_evidence():
    row = payload([1, 1, 3], field="annual_eps_growth_3y")
    row["annual_eps_growth_3y"] = [1, True, 3]
    merged = merge_financial_payloads(row, {})
    assert merged["annual_eps_growth_3y"] == [1, True, 3]
    assert "annual_eps_growth_3y" not in merged["financial_source_evidence"]["fields"]
