"""Static proof is an additive export contract, never a new source acquisition."""
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path

import pandas as pd
import pytest
import yfinance as yf

from app.services import financial_source_capture as capture
from app.services.eps_rating_service import EPSRatingService
from app.services.financial_source_capture import statement_evidence, _statement_subset
from app.services.financial_source_evidence import (
    FINANCIAL_FIELDS, make_capture_context, make_envelope, make_observed_record,
    observation_id, validate_envelope, _digest,
)
from app.services.growth_cadence_service import compute_cadence_aware_growth
from app.services.static_financial_evidence import (
    CONTRACTS, METRICS, REASON_CODES, VERSION, PROOF_REASON_CODES, COMPARISON_CODES, CALCULATION_CODES,
    add_static_financial_metadata, build_static_financial_current, subset_static_financial_current, comparison_code,
)
from tests.unit.test_financial_source_producers import _statements
from tests.unit.test_financial_source_yahoo_contract import real_transport  # noqa: F401

ROOT = Path(__file__).resolve().parents[3]
NOW = "2026-10-03T16:35:00.000Z"
AS_OF = "2026-10-02"
OBSERVED = "2026-10-01T00:00:00.000Z"


def source_row(*, observed=OBSERVED, quarter_periods=None, annual_periods=None,
               quarter_values=None, annual_values=None, metric="Diluted EPS"):
    """Use actual PR69 arithmetic and evidence producers; no vendor calls."""
    quarter_periods = quarter_periods or ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"]
    annual_periods = annual_periods or ["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31"]
    quarterly = pd.DataFrame([quarter_values or [1., 1., 2., 3., 2., -2.], [100., 100., 120., 130., 110., 150.]],
                             index=[metric, "Total Revenue"], columns=pd.to_datetime(quarter_periods))
    annual = pd.DataFrame([annual_values or [5., 4., 3., 2., 1.]], index=[metric], columns=pd.to_datetime(annual_periods))
    acquisitions = {}
    for attribute, frame in [("quarterly_income_stmt", quarterly), ("income_stmt", annual)]:
        subset = _statement_subset(frame)
        prefix = "annual" if attribute == "income_stmt" else "quarterly"
        subset["source_rows"] = {row["metric"].lower().replace(" ", ""): {
            "provider_metric": prefix + row["metric"].replace(" ", ""),
            "values": {pd.Timestamp(column).date().isoformat(): value for column, value in zip(subset["columns"], row["values"])},
            "currencies": ["USD"],
        } for row in subset["rows"]}
        acquisitions[attribute] = make_capture_context(
            symbol="TEST", market="US", source="yfinance", producer=f"yfinance.{attribute}/transport-capture-v1",
            provider_symbol="TEST", observed_at=observed, source_payload=subset, capture_id=attribute,
        )
    growth = compute_cadence_aware_growth(quarterly, market="US", include_source_context=True)
    eps = EPSRatingService().calculate_eps_rating_data(annual, quarterly, include_source_context=True)
    payload = {**growth, **eps, "symbol": "TEST", "market": "US", "eps_rating": 95,
               "smr_rating": 96, "composite_rating": 97, "composite_rating_score": 97.,
               "composite_score": 90., "rating": "Strong Buy", "passes_template": True,
               "annual_eps_growth_3y": [25., 33., 50.]}
    contexts = {**growth.pop("_financial_source_context"), **eps.pop("_financial_source_context")}
    payload.pop("_financial_source_context", None)
    fields = statement_evidence(payload, contexts, acquisitions)
    # Derived calculation time is diagnostic only, pinned for shared JSON fixtures.
    if "eps_raw_score" in fields:
        fields["eps_raw_score"]["computed_at"] = OBSERVED
        fields["eps_raw_score"]["observation_id"] = observation_id(fields["eps_raw_score"])
    payload["financial_source_evidence"] = make_envelope(symbol="TEST", market="US", fields=fields)
    return payload


def summary(row, now=NOW, as_of=AS_OF):
    return build_static_financial_current(row, now=now, as_of_date=as_of)


def reason(result, field):
    return REASON_CODES[result["r"][FINANCIAL_FIELDS.index(field)]]


def recertify(row, field, **changes):
    record = row["financial_source_evidence"]["fields"][field]
    record.update(changes)
    record["observation_id"] = observation_id(record)
    return row


def fixture_cases():
    fresh = source_row()
    cases = []

    def add(name, row, now=NOW, as_of=AS_OF):
        proof = summary(row, now, as_of)
        values = {field: (deepcopy(row.get(field)) if proof["r"][i] == "0" else None) for i, field in enumerate(FINANCIAL_FIELDS)}
        cases.append({"id": name, "now": now, "as_of_date": as_of, "row": row, "expected": {
            "values": values, "reasons": {field: reason(proof, field) for field in FINANCIAL_FIELDS},
            "compact": proof, "next_expiry_at": min((p[5] for p in proof["p"].values()), default=None),
        }})

    add("fresh-zero-and-negative", fresh)
    for name, recent, baseline in [
        ("loss-narrowing", -.2, -.4), ("loss-widening", -.4, -.2), ("loss-unchanged", -.2, -.2),
        ("turnaround", .1, -.2), ("zero-baseline", .1, 0.), ("new-loss", -.1, .2),
        ("profit-to-zero", 0., .2), ("break-even", 0., -.2), ("profitable-growth", .3, .2),
        ("profitable-decline", .1, .2), ("profitable-unchanged", .2, .2),
        ("clipped-growth", 2., .1), ("clipped-new-loss", -2., .1),
    ]:
        add(name, source_row(quarter_values=[recent, recent, 1., 1., baseline, baseline]))
    add("basic-eps-growth", source_row(quarter_values=[.3, .3, 1., 1., .2, .2], metric="Basic EPS"))
    add("source-exact-seven-day-boundary", source_row(observed="2026-09-26T16:35:00.000Z"))
    add("source-one-millisecond-expired", source_row(observed="2026-09-26T16:34:59.999Z"))
    add("future-source", source_row(observed="2026-10-03T16:35:00.001Z"))
    row = deepcopy(fresh); row.pop("financial_source_evidence"); add("legacy-missing-envelope", row)
    row = deepcopy(fresh); row["financial_source_evidence"] = {"schema": "old"}; add("old-envelope", row)
    row = deepcopy(fresh); row["financial_source_evidence"]["fields"]["eps_growth_yy"]["value"] = 1.; add("record-hash-tamper", row)
    row = deepcopy(fresh); row["financial_source_evidence"]["captures"]["quarterly_income_stmt"]["source_payload"]["rows"][0]["values"][0] = 99.; add("capture-hash-tamper", row)
    row = deepcopy(fresh); row["symbol"] = "OTHER"; add("cross-symbol", row)
    row = deepcopy(fresh); row["market"] = "HK"; add("cross-market", row)
    row = deepcopy(fresh); row["eps_growth_yy"] = 1.; add("same-row-value-mismatch", row)
    row = deepcopy(fresh); row["eps_growth_quarterly"] = 8.; add("alias-conflict-with-zero", row)
    row = deepcopy(fresh); row["eps_growth_quarterly"] = 0.; add("alias-zero-is-preserved", row)
    row = deepcopy(fresh); recertify(row, "eps_growth_yy", unit="fraction"); add("wrong-unit", row)
    row = deepcopy(fresh); recertify(row, "eps_growth_yy", basis="finviz.eps_yoy_ttm/v1"); add("ttm-is-not-quarter-yoy", row)
    row = deepcopy(fresh); recertify(row, "eps_growth_yy", cadence="semiannual"); add("semiannual-not-quarter-yoy", row)
    row = deepcopy(fresh); recertify(row, "eps_q1_yoy", basis="positional_eps_growth/v1"); add("positional-not-quarter-yoy", row)
    row = deepcopy(fresh); recertify(row, "eps_growth_yy", period_end="2026-02-30"); add("invalid-calendar-period", row)
    add("future-period", source_row(quarter_periods=["2026-12-31", "2026-09-30", "2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30"]))
    add("gapped-quarter-history", source_row(quarter_periods=["2026-06-30", "2026-03-31", "2025-10-01", "2025-09-30", "2025-06-30", "2025-03-31"]))
    add("gapped-annual-history", source_row(annual_periods=["2025-12-31", "2024-12-31", "2023-12-31", "2021-12-31", "2020-12-31"]))
    add("turnaround-is-not-positive-cagr", source_row(annual_values=[5., 4., 3., 2., -1.]))
    add("quarter-period-exact-expiry", fresh, now="2026-10-07T23:59:59.999Z", as_of="2026-10-07")
    add("quarter-period-next-day", source_row(observed="2026-10-05T00:00:00.000Z"), now="2026-10-08T00:00:00.000Z", as_of="2026-10-08")
    add("annual-period-exact-expiry", source_row(observed="2027-07-01T00:00:00.000Z"), now="2027-07-04T23:59:59.999Z", as_of="2027-07-04")
    add("annual-period-next-day", source_row(observed="2027-07-01T00:00:00.000Z"), now="2027-07-05T00:00:00.000Z", as_of="2027-07-05")
    add("invalid-evaluation-time", fresh, now="2026-02-30T00:00:00Z")
    add("future-as-of", fresh, as_of="2026-10-04")
    row = deepcopy(fresh)
    context = make_capture_context(symbol="TEST", market="US", source="yfinance", producer="yfinance.info/transport-capture-v1", provider_symbol="TEST", observed_at=OBSERVED, source_payload={"profitMargins": -.1}, capture_id="info")
    record = make_observed_record("profit_margin", -.1, context, unit="fraction", basis="yfinance.financialData.profitMargins/v1", metric="profitMargins")
    info = make_envelope(symbol="TEST", market="US", fields={"profit_margin": record})
    row["profit_margin"] = -.1
    row["financial_source_evidence"]["fields"].update(info["fields"])
    row["financial_source_evidence"]["captures"].update(info["captures"])
    add("margin-without-exact-period", row)
    return cases


def test_contract_registry_matches_runtime():
    contract = json.loads((ROOT / "contracts/static_financial_current_v1.json").read_text())
    assert contract["field_order"] == list(FINANCIAL_FIELDS)
    assert contract["reason_codes"] == REASON_CODES
    assert contract["contracts"] == CONTRACTS
    assert contract["metrics"] == METRICS
    assert contract["version"] == VERSION == 2
    assert contract["proof_reason_codes"] == PROOF_REASON_CODES
    assert contract["comparison_codes"] == COMPARISON_CODES
    assert contract["calculation_codes"] == CALCULATION_CODES
    assert len(contract["proof_tuple"]) == 8


def test_shared_producer_fixtures_match_python():
    fixtures = json.loads((ROOT / "contracts/static_financial_current_fixtures_v1.json").read_text())
    assert fixtures["field_order"] == list(FINANCIAL_FIELDS)
    for case in fixtures["cases"]:
        before = deepcopy(case["row"])
        assert summary(case["row"], case["now"], case["as_of_date"]) == case["expected"]["compact"], case["id"]
        assert case["row"] == before
    assert fixtures["cases"] == fixture_cases()


def test_fresh_supported_values_and_all_derived_remain_honest():
    row = source_row()
    proof = summary(row)
    assert set(proof["p"]) == {"0", "1", "2", "3", "5", "6", "7"}
    assert proof["p"]["0"][0] == 0.
    assert proof["p"]["1"][0] == -50.
    assert reason(proof, "eps_raw_score") == "unverified_derivation_and_cohort"
    assert all(reason(proof, field) == "unverified_derivation_and_cohort" for field in FINANCIAL_FIELDS[-4:])
    assert reason(proof, "annual_eps_growth_3y") == "missing_evidence"


def test_metadata_is_additive_and_does_not_refresh_or_mutate_raw():
    row = source_row()
    raw_json = json.dumps(row, sort_keys=True)
    enriched = add_static_financial_metadata(row, now=NOW, as_of_date=AS_OF)
    assert json.dumps({key: enriched[key] for key in row}, sort_keys=True) == raw_json
    assert json.dumps(row, sort_keys=True) == raw_json
    assert enriched["financial_reference"]["values"]["eps_growth_qq"] == 0.
    assert enriched["financial_reference"]["values"]["eps_growth_yy"] == -50.
    assert enriched["financial_source_evidence"] == row["financial_source_evidence"]
    assert add_static_financial_metadata(enriched, now=NOW, as_of_date=AS_OF) == enriched


@pytest.mark.parametrize("value", [float("nan"), float("inf"), True, "25", 10**400])
def test_invalid_raw_values_do_not_become_current(value):
    row = source_row(); row["eps_growth_yy"] = value
    assert reason(summary(row), "eps_growth_yy") == "missing_or_invalid_value"


def test_subset_keeps_exact_available_group_fields_only():
    row = source_row()
    group = {"symbol": "TEST", "eps_growth_yy": -50., "sales_growth_yy": row["sales_growth_yy"]}
    narrow = subset_static_financial_current(summary(row), group)
    assert set(narrow["p"]) == {"1", "3"}
    assert narrow["p"]["1"] == summary(row)["p"]["1"]


def test_wrong_provider_identity_and_self_consistent_arithmetic_forgery_fail_closed():
    row = source_row(); recertify(row, "eps_growth_yy", provider_symbol="WRONG")
    assert reason(summary(row), "eps_growth_yy") == "identity_mismatch"
    row = source_row(); row["eps_growth_yy"] = 99.; recertify(row, "eps_growth_yy", value=99.)
    assert reason(summary(row), "eps_growth_yy") == "invalid_source_inputs"


@pytest.mark.parametrize("invalid", [None, 123, [], {}])
def test_digest_valid_but_malformed_provider_metric_is_unknown(invalid):
    row = source_row()
    envelope = row["financial_source_evidence"]
    capture = envelope["captures"]["quarterly_income_stmt"]
    capture["source_payload"]["source_rows"]["dilutedeps"]["provider_metric"] = invalid
    capture["raw_payload_sha256"] = _digest(capture["source_payload"])
    for record in envelope["fields"].values():
        if record.get("capture_id") == "quarterly_income_stmt":
            record["raw_payload_sha256"] = capture["raw_payload_sha256"]
            record["observation_id"] = observation_id(record)
    validate_envelope(envelope)
    assert reason(summary(row), "eps_growth_yy") == "invalid_source_inputs"


def test_digest_valid_inline_records_with_malformed_capture_map_are_unknown():
    row = source_row()
    envelope = row["financial_source_evidence"]
    for record in envelope["fields"].values():
        if record.get("capture_id"):
            record["source_payload"] = deepcopy(envelope["captures"][record["capture_id"]]["source_payload"])
    envelope["captures"] = []
    validate_envelope(envelope)
    assert summary(row)["p"] == {}
    assert reason(summary(row), "eps_growth_yy") == "invalid_envelope"


@pytest.mark.parametrize("case_id,field,expected", [
    ("source-exact-seven-day-boundary", "eps_growth_yy", "available"),
    ("source-one-millisecond-expired", "eps_growth_yy", "stale_source"),
    ("future-source", "eps_growth_yy", "future_source_timestamp"),
    ("legacy-missing-envelope", "eps_growth_yy", "missing_evidence"),
    ("capture-hash-tamper", "eps_growth_yy", "invalid_envelope"),
    ("cross-symbol", "eps_growth_yy", "identity_mismatch"),
    ("same-row-value-mismatch", "eps_growth_yy", "value_mismatch"),
    ("alias-conflict-with-zero", "eps_growth_qq", "alias_conflict"),
    ("wrong-unit", "eps_growth_yy", "unsupported_contract"),
    ("semiannual-not-quarter-yoy", "eps_growth_yy", "unsupported_contract"),
    ("gapped-quarter-history", "eps_growth_yy", "invalid_reporting_period"),
    ("gapped-annual-history", "eps_5yr_cagr", "invalid_reporting_period"),
    ("future-period", "eps_growth_yy", "invalid_reporting_period"),
    ("turnaround-is-not-positive-cagr", "eps_5yr_cagr", "unsupported_contract"),
    ("quarter-period-exact-expiry", "eps_q2_yoy", "nonpositive_comparison_base"),
    ("quarter-period-next-day", "eps_q2_yoy", "stale_reporting_period"),
    ("annual-period-exact-expiry", "eps_5yr_cagr", "available"),
    ("annual-period-next-day", "eps_5yr_cagr", "stale_reporting_period"),
    ("margin-without-exact-period", "profit_margin", "unsupported_contract"),
])
def test_shared_cases_have_explicit_semantic_outcomes(case_id, field, expected):
    cases = {case["id"]: case for case in fixture_cases()}
    case = cases[case_id]
    assert reason(summary(case["row"], case["now"], case["as_of_date"]), field) == expected


def test_pinned_vendor_normalization_reaches_static_proof_without_reclocking(real_transport, monkeypatch):
    from app.services import financial_source_capture as capture

    monkeypatch.setattr(capture, "_utc_now", lambda: datetime(2026, 10, 1, tzinfo=timezone.utc))

    def row_from_acquisition():
        frame, contexts = capture.acquire_yahoo_value(yf.Ticker("AAPL"), "quarterly_income_stmt")
        growth = compute_cadence_aware_growth(frame, market="US", include_source_context=True)
        details = growth.pop("_financial_source_context")
        fields = capture.statement_evidence(growth, details, contexts)
        return {**growth, "symbol": "AAPL", "market": "US",
                "financial_source_evidence": make_envelope(symbol="AAPL", market="US", fields=fields)}

    first = row_from_acquisition()
    proof = summary(first)
    assert proof["p"]["0"][0] == 100.0 and proof["p"]["2"][0] == 100.0
    monkeypatch.setattr(capture, "_utc_now", lambda: datetime(2026, 10, 9, tzinfo=timezone.utc))
    cached = row_from_acquisition()
    cached["yahoo_statements_refreshed_at"] = "2026-10-09T00:00:00Z"
    cached["last_updated"] = "2026-10-09T00:00:00Z"
    late = summary(cached, now="2026-10-09T00:00:00Z", as_of="2026-10-08")
    assert cached["financial_source_evidence"] == first["financial_source_evidence"]
    assert late["r"][0] == "7" and late["r"][2] == "7" and not late["p"]
    assert len(real_transport["calls"]) == 1


@pytest.mark.parametrize("recent,baseline,state", [
    (-.2, -.4, "loss_narrowing"), (.1, -.2, "turnaround"), (.1, 0., "undefined_base"),
    (-.1, .2, "new_loss"), (.3, .2, "profitable_growth"), (.1, .2, "profitable_decline"),
    (.2, .2, "profitable_unchanged"), (0., -.2, "break_even"), (0., .2, "profit_to_zero"),
    (-.4, -.2, "loss_widening"), (-.2, -.2, "loss_unchanged"),
])
def test_comparison_classifies_explicit_finite_cells(recent, baseline, state):
    assert COMPARISON_CODES[comparison_code(recent, baseline)] == state
    row = source_row(quarter_values=[recent, recent, 1., 1., baseline, baseline])
    before = deepcopy(row)
    proof = summary(row)
    if baseline == 0:
        # The existing producer supplies no finite percentage or observed field.
        # Do not invent an EPS pair from a percentage or unrelated retained rows.
        assert row["eps_growth_yy"] is None
        assert "eps_growth_yy" not in row["financial_source_evidence"]["fields"]
        assert reason(proof, "eps_growth_yy") == "missing_or_invalid_value"
        assert "1" not in proof["p"]
    else:
        entry = proof["p"]["1"]
        assert entry[0] == row["eps_growth_yy"]
        assert COMPARISON_CODES[entry[6]] == state
        assert CALCULATION_CODES[entry[7]] == "rounded_percent_change"
        assert reason(proof, "eps_growth_yy") == ("nonpositive_comparison_base" if baseline < 0 else "available")
    assert row == before


@pytest.mark.parametrize("recent,baseline", [(None, 1), (1, None), (True, 1), (1, False), (float("inf"), 1), (1, float("nan")), (".1", -.2)])
def test_comparison_does_not_coerce_or_infer_source_cells(recent, baseline):
    assert comparison_code(recent, baseline) is None


def test_clipping_and_annual_heuristics_are_not_mislabeled_as_exact_growth():
    for recent, expected, state in [(2., 500., "profitable_growth"), (-2., -100., "new_loss")]:
        row = source_row(quarter_values=[recent, recent, 1., 1., .1, .1])
        proof = summary(row)
        assert proof["p"]["6"][0] == expected
        assert COMPARISON_CODES[proof["p"]["6"][6]] == state
        assert CALCULATION_CODES[proof["p"]["6"][7]] == "clipped_percent_change"
        assert CALCULATION_CODES[proof["p"]["1"][7]] == "rounded_percent_change"
        assert row["eps_growth_yy"] != expected
    row = source_row(annual_values=[5., 4., 3., 2., -.1])
    raw = row["eps_5yr_cagr"]
    enriched = add_static_financial_metadata(row, now=NOW, as_of_date=AS_OF)
    assert reason(enriched["financial_current"], "eps_5yr_cagr") == "unsupported_contract"
    assert enriched["financial_reference"]["values"]["eps_5yr_cagr"] == raw
    assert enriched["financial_source_evidence"] == row["financial_source_evidence"]


def test_negative_base_reference_proof_survives_group_subsetting_without_becoming_available():
    row = source_row(quarter_values=[-.2, -.2, 1., 1., -.4, -.4])
    narrow = subset_static_financial_current(summary(row), {"eps_growth_yy": row["eps_growth_yy"]})
    assert set(narrow["p"]) == {"1"}
    assert reason(narrow, "eps_growth_yy") == "nonpositive_comparison_base"
    assert narrow["p"]["1"][6] == "l"


def test_positive_cagr_clipping_keeps_explicit_calculation_kind():
    row = source_row(annual_values=[10000., 4., 3., 2., .1])
    entry = summary(row)["p"]["5"]
    assert entry[0] == 500.
    assert COMPARISON_CODES[entry[6]] == "profitable_growth"
    assert CALCULATION_CODES[entry[7]] == "clipped_positive_cagr"


# Annual proof follows finite EPS selection without inventing source years.
PERIODS = [f"{year}-12-31" for year in range(2025, 2019, -1)]
FIELD = "eps_5yr_cagr"


@pytest.mark.parametrize("count,trailing", [(2, 3), (3, 2), (4, 1), (4, 0), (5, 0), (5, 1)])
@pytest.mark.parametrize("metric", ["Diluted EPS", "Basic EPS"])
def test_producer_annual_chain_accepts_only_used_years(count, trailing, metric):
    values = [float(2 ** (count - index - 1)) for index in range(count)]
    row = source_row(annual_periods=PERIODS[:count + trailing],
                     annual_values=values + [None] * trailing, metric=metric)
    before = deepcopy(row)
    record = row["financial_source_evidence"]["fields"][FIELD]
    proof = summary(row)
    assert row[FIELD] == 100.0
    assert row["eps_years_available"] == count
    assert record["elapsed_years"] == count - 1
    assert record["periods_used"] == PERIODS[:count]
    assert reason(proof, FIELD) == "available"
    assert proof["p"]["5"][0] == 100.0
    assert proof["p"]["5"][3] == PERIODS[:count]
    assert record["observed_at"] == OBSERVED
    assert row == before


def test_producer_still_selects_first_five_when_six_annual_cells_are_finite():
    row = source_row(annual_periods=PERIODS, annual_values=[16., 8., 4., 2., 1., .5])
    assert row[FIELD] == 100.0
    assert row["eps_years_available"] == 5
    assert summary(row)["p"]["5"][3] == PERIODS[:5]


@pytest.mark.parametrize("values", [
    [None, 8., 4., 2., 1.],  # Missing latest statement EPS cannot use an older prefix.
    [16., None, 4., 2., 1.],  # An internal null is not an annual chain.
    [16., 8., 4., None, 1.],
    [16., 8., None, None, 1.],
])
def test_producer_annual_chain_rejects_missing_latest_and_internal_nulls(values):
    row = source_row(annual_values=values)
    assert row[FIELD] is not None  # The legacy scalar remains a reference.
    assert reason(summary(row), FIELD) == "invalid_reporting_period"


def _select_record_inputs(row, start, stop):
    """Make a digest-valid alternate selection with correct endpoint arithmetic."""
    inputs = row["financial_source_evidence"]["fields"][FIELD]["source_inputs"][start:stop]
    elapsed = inputs[0]["year"] - inputs[-1]["year"]
    value = round(((inputs[0]["value"] / inputs[-1]["value"]) ** (1 / elapsed) - 1) * 100, 2)
    row[FIELD] = value
    recertify(row, FIELD, value=value, source_inputs=inputs,
              period_end=inputs[0]["period_end"], comparable_period_end=inputs[-1]["period_end"],
              periods_used=[item["period_end"] for item in inputs], elapsed_years=elapsed)
    validate_envelope(row["financial_source_evidence"])


@pytest.mark.parametrize("start,stop", [(1, 5), (0, 4), (0, 2)])
def test_digest_valid_selection_cannot_omit_available_finite_annual_cells(start, stop):
    row = source_row()
    _select_record_inputs(row, start, stop)
    assert reason(summary(row), FIELD) == "invalid_reporting_period"


def test_gapped_fiscal_years_keep_actual_elapsed_arithmetic_but_no_contiguous_proof():
    row = source_row(annual_periods=["2025-12-31", "2024-12-31", "2021-12-31", "2019-12-31", "2018-12-31"],
                     annual_values=[8., 5., 2., 1., None])
    assert row[FIELD] == 41.42
    assert row["financial_source_evidence"]["fields"][FIELD]["elapsed_years"] == 6
    assert reason(summary(row), FIELD) == "invalid_reporting_period"


@pytest.mark.parametrize("changes,expected", [
    ({"basis": "other/v1"}, "unsupported_contract"),
    ({"cadence": "quarterly"}, "unsupported_contract"),
    ({"elapsed_years": 4}, "unsupported_contract"),
    ({"algorithm": "other/v1"}, "unsupported_contract"),
    ({"value": 99.}, "invalid_source_inputs"),
])
def test_shorter_annual_chain_preserves_contract_and_arithmetic_checks(changes, expected):
    row = source_row(annual_values=[8., 4., 2., 1., None])
    recertify(row, FIELD, **changes)
    if "value" in changes:
        row[FIELD] = changes["value"]
    assert reason(summary(row), FIELD) == expected


def test_missing_fifth_eps_cannot_be_fabricated_in_source_inputs():
    row = source_row(annual_values=[8., 4., 2., 1., None])
    record = row["financial_source_evidence"]["fields"][FIELD]
    inputs = record["source_inputs"] + [{"column": "2021-12-31 00:00:00", "period_end": "2021-12-31", "year": 2021, "value": .5}]
    recertify(row, FIELD, source_inputs=inputs, comparable_period_end=PERIODS[4],
              periods_used=PERIODS[:5], elapsed_years=4)
    assert reason(summary(row), FIELD) == "invalid_source_inputs"


def test_normalized_null_cannot_hide_a_finite_provider_eps_year():
    row = source_row(annual_values=[8., 4., 2., 1., None])
    envelope = row["financial_source_evidence"]
    annual = envelope["captures"]["income_stmt"]
    annual["source_payload"]["source_rows"]["dilutedeps"]["values"][PERIODS[4]] = .5
    annual["raw_payload_sha256"] = _digest(annual["source_payload"])
    recertify(row, FIELD, raw_payload_sha256=annual["raw_payload_sha256"])
    validate_envelope(envelope)
    assert reason(summary(row), FIELD) == "invalid_source_inputs"


@pytest.mark.parametrize("observed,now,as_of,expected", [
    ("2026-09-26T16:35:00.000Z", NOW, "2026-10-02", "available"),
    ("2026-09-26T16:34:59.999Z", NOW, "2026-10-02", "stale_source"),
    ("2026-10-03T16:35:00.001Z", NOW, "2026-10-02", "future_source_timestamp"),
    ("2027-07-01T00:00:00.000Z", "2027-07-04T23:59:59.999Z", "2027-07-04", "available"),
    ("2027-07-01T00:00:00.000Z", "2027-07-05T00:00:00.000Z", "2027-07-05", "stale_reporting_period"),
])
def test_shorter_annual_chain_preserves_source_and_reporting_expiry(observed, now, as_of, expected):
    row = source_row(observed=observed, annual_values=[8., 4., 2., 1., None])
    assert reason(summary(row, now=now, as_of=as_of), FIELD) == expected


def test_offline_vendor_normalization_to_proof_with_null_fifth_year_and_five_quarters(real_transport, monkeypatch):
    monkeypatch.setattr(capture, "_utc_now", lambda: datetime(2026, 10, 1, tzinfo=timezone.utc))
    # Another metric supplies the fifth year, so yfinance retains its column
    # while EPS has only four provider observations, as in the pilot captures.
    real_transport["annual_statement"] = _statements("annual", PERIODS[:5], [8., 4., 2., 1.])
    quarters = ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30"]
    real_transport["statement"] = _statements("quarterly", quarters, [2., 1., 1., 1., 1.])
    ticker = yf.Ticker("AAPL")
    annual, annual_contexts = capture.acquire_yahoo_value(ticker, "income_stmt")
    quarterly, quarterly_contexts = capture.acquire_yahoo_value(ticker, "quarterly_income_stmt")
    assert len(annual.columns) == 5 and pd.isna(annual.loc["Diluted EPS"].iloc[4])
    row = EPSRatingService().calculate_eps_rating_data(annual, quarterly, include_source_context=True)
    contexts = row.pop("_financial_source_context")
    fields = capture.statement_evidence(row, contexts, {**annual_contexts, **quarterly_contexts})
    row.update(symbol="AAPL", market="US", financial_source_evidence=make_envelope(symbol="AAPL", market="US", fields=fields))
    proof = summary(row)
    assert row[FIELD] == 100.0 and row["eps_years_available"] == 4
    assert fields[FIELD]["elapsed_years"] == 3
    assert fields[FIELD]["observed_at"] == OBSERVED
    assert reason(proof, FIELD) == "available"
    assert reason(proof, "eps_q1_yoy") == "available"
    assert row["eps_q2_yoy"] is None and "eps_q2_yoy" not in fields
    assert reason(proof, "eps_q2_yoy") == "missing_or_invalid_value"
    assert len(real_transport["calls"]) == 2
