"""Synthetic sparse statements preserve metric, period and receipt ownership."""

from copy import deepcopy

import pandas as pd
import pytest

from app.services.eps_rating_service import EPSRatingService
from app.services.financial_source_capture import _statement_subset, statement_evidence
from app.services.financial_source_evidence import FINANCIAL_FIELDS, make_capture_context, make_envelope, validate_envelope
from app.services.growth_cadence_service import compute_cadence_aware_growth
from app.services.static_financial_evidence import REASON_CODES, build_static_financial_current


PERIODS = ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"]
OBSERVED = "2026-10-01T00:00:00.000Z"
NOW = "2026-10-04T12:00:00.000Z"


def frame(diluted, basic, *, periods=PERIODS):
    return pd.DataFrame([diluted, basic], index=["Diluted EPS", "Basic EPS"], columns=pd.to_datetime(periods), dtype=float)


def calculate(statement, market="US"):
    growth = compute_cadence_aware_growth(statement, market=market, include_source_context=True)
    eps = EPSRatingService().calculate_eps_rating_data(None, statement, include_source_context=True)
    contexts = {**growth.pop("_financial_source_context"), **eps.pop("_financial_source_context")}
    return {**growth, **eps}, contexts


def proof(statement, *, currencies=("USD",)):
    subset = _statement_subset(statement)
    subset["source_rows"] = {row["metric"].lower().replace(" ", ""): {
        "provider_metric": "quarterly" + row["metric"].replace(" ", ""),
        "values": {pd.Timestamp(column).date().isoformat(): value
                   for column, value in zip(subset["columns"], row["values"])},
        "currencies": list(currencies),
    } for row in subset["rows"]}
    capture = make_capture_context(
        symbol="TEST", market="US", source="yfinance",
        producer="yfinance.quarterly_income_stmt/transport-capture-v1",
        provider_symbol="TEST", observed_at=OBSERVED, source_payload=subset,
        capture_id="original-quarterly-receipt",
    )
    capture["transport_payload_sha256"] = "a" * 64
    original = deepcopy(capture)
    payload, contexts = calculate(statement)
    payload.update(symbol="TEST", market="US")
    fields = statement_evidence(payload, contexts, {"quarterly_income_stmt": capture})
    payload["financial_source_evidence"] = make_envelope(symbol="TEST", market="US", fields=fields)
    validate_envelope(payload["financial_source_evidence"])
    assert capture == original
    return payload, build_static_financial_current(payload, now=NOW, as_of_date="2026-10-02", market="US"), capture


def reason(result, field):
    return REASON_CODES[result["r"][FINANCIAL_FIELDS.index(field)]]


@pytest.mark.parametrize("missing", [None, float("nan"), float("inf"), float("-inf")])
def test_missing_latest_cell_selects_one_complete_basic_pair(missing):
    statement = frame([missing, 2., 2., 2., 1., 1.], [6., 3., 2., 2., .5, 1.])
    values, contexts = calculate(statement)
    assert values["eps_growth_qq"] == 100.
    assert values["eps_growth_yy"] == 1100.
    assert values["eps_q1_yoy"] == 500.  # Existing clipping is unchanged.
    for field in ("eps_growth_qq", "eps_growth_yy", "eps_q1_yoy"):
        assert contexts[field]["metric"] == "Basic EPS"
        assert contexts[field]["source_inputs"][0]["value"] == 6.
    assert contexts["eps_q2_yoy"]["metric"] == "Diluted EPS"


def test_each_comparison_keeps_its_own_complete_preferred_pair():
    values, contexts = calculate(frame([6., 4., 2., 2., None, 2.], [8., 3., 2., 2., 2., 1.]))
    assert values["eps_growth_qq"] == 50.
    assert values["eps_growth_yy"] == 300.
    assert values["eps_q1_yoy"] == 300.
    assert values["eps_q2_yoy"] == 100.
    assert contexts["eps_growth_qq"]["metric"] == contexts["eps_q2_yoy"]["metric"] == "Diluted EPS"
    assert contexts["eps_growth_yy"]["metric"] == contexts["eps_q1_yoy"]["metric"] == "Basic EPS"


@pytest.mark.parametrize("baseline,expected_growth,expected_rating", [
    (0., None, None), (.005, None, None), (.01, None, None),
    (.05, None, 500.), (-2., 200., 200.), (4., -50., -50.),
])
def test_finite_preferred_pair_never_switches_for_a_threshold_or_sign(baseline, expected_growth, expected_rating):
    values, contexts = calculate(frame([2., baseline, 1., 1., baseline, baseline], [100., 1., 1., 1., 1., 1.]))
    assert values["eps_growth_qq"] == expected_growth
    assert values["eps_growth_yy"] == expected_growth
    assert values["eps_q1_yoy"] == expected_rating
    for field in ("eps_growth_qq", "eps_growth_yy", "eps_q1_yoy", "eps_q2_yoy"):
        if field in contexts:
            assert contexts[field]["metric"] == "Diluted EPS"


def test_existing_producer_preferences_remain_when_basic_row_comes_first():
    statement = frame([6., 3., 2., 2., 2., 1.], [8., 2., 2., 2., 1., 1.]).iloc[::-1]
    values, contexts = calculate(statement)
    assert values["eps_growth_yy"] == 700.
    assert contexts["eps_growth_yy"]["metric"] == "Basic EPS"
    assert values["eps_q1_yoy"] == 200.
    assert contexts["eps_q1_yoy"]["metric"] == "Diluted EPS"


def test_incomplete_alternate_never_mixes_diluted_current_and_basic_baseline():
    values, contexts = calculate(frame([6., 3., 2., 2., None, None], [None, None, 2., 2., 2., 1.]))
    for field in ("eps_growth_yy", "eps_q1_yoy", "eps_q2_yoy"):
        assert values[field] is None
        assert field not in contexts


def test_adjusted_eps_is_not_a_supported_fallback():
    statement = frame([6., 3., 2., 2., None, None], [None] * 6)
    statement.loc["Normalized Basic EPS"] = [8., 4., 2., 2., 2., 1.]
    values, contexts = calculate(statement)
    assert values["eps_growth_yy"] is values["eps_q1_yoy"] is values["eps_q2_yoy"] is None
    assert "eps_growth_yy" not in contexts


def test_no_sixth_quarter_or_comparable_period_is_invented():
    statement = frame([6., 3., 2., 2., None], [8., 4., 2., 2., 2.], periods=PERIODS[:5])
    values, contexts = calculate(statement)
    assert values["eps_q1_yoy"] == 300.
    assert values["eps_q2_yoy"] is None
    assert "eps_q2_yoy" not in contexts
    values, contexts = calculate(statement.iloc[:, :4])
    assert values["eps_growth_yy"] is None
    assert "eps_growth_yy" not in contexts


def test_valid_pair_does_not_switch_to_escape_invalid_calendar_spacing():
    periods = ["2026-06-30", "2026-03-31", "2025-12-31", "2025-06-30", "2025-03-31", "2024-12-31"]
    values, contexts = calculate(frame([6., 3., 2., 2., 2., 1.], [8., 4., 2., 2., 1., 1.], periods=periods))
    assert contexts["eps_q1_yoy"]["metric"] == "Diluted EPS"
    assert contexts["eps_q1_yoy"]["basis"] == "positional_eps_growth/v1"
    assert contexts["eps_q1_yoy"]["periods_used"] == [periods[0], periods[4]]


@pytest.mark.parametrize("market", ["HK", "JP"])
def test_non_us_quarterly_fallback_preserves_cadence_and_existing_preferences(market):
    values, contexts = calculate(frame([None, 2., 2., 2., 1., 1.], [6., 3., 2., 2., 2., 1.]), market)
    assert values["eps_growth_qq"] == 100.
    assert values["eps_growth_yy"] == 200.
    assert contexts["eps_growth_qq"]["basis"] == "quarterly_qoq/v1"
    assert contexts["eps_q1_yoy"]["basis"] == "quarterly_eps_yoy/v1"
    assert contexts["eps_q2_yoy"]["metric"] == "Diluted EPS"


@pytest.mark.parametrize("market", ["HK", "JP"])
def test_non_us_semiannual_fallback_still_uses_comparable_year(market):
    statement = frame([None, 2., 1.], [6., 3., 2.], periods=["2026-06-30", "2025-12-31", "2025-06-30"])
    values, contexts = calculate(statement, market)
    assert values["eps_growth_qq"] == values["eps_growth_yy"] == 200.
    assert contexts["eps_growth_qq"]["basis"] == "comparable_period_yoy/v1"
    assert contexts["eps_growth_qq"]["cadence"] == "semiannual"
    assert contexts["eps_growth_qq"]["remapped_to_qq"] is True
    assert contexts["eps_growth_qq"]["source_inputs"][1]["value"] == 2.
    assert values["eps_q1_yoy"] is values["eps_q2_yoy"] is None


def test_fallback_evidence_retains_original_receipt_and_selected_inputs_atomically():
    statement = frame([None, 2., 2., 2., 1., 1.], [6., 3., 2., 2., 2., 1.])
    payload, result, capture = proof(statement)
    for field in ("eps_growth_qq", "eps_growth_yy", "eps_q1_yoy"):
        record = payload["financial_source_evidence"]["fields"][field]
        assert reason(result, field) == "available"
        assert record["metric"] == "Basic EPS"
        assert result["p"][str(FINANCIAL_FIELDS.index(field))][2] == "Basic EPS"
        assert record["unit"] == "percent_points"
        for key in ("capture_id", "observed_at", "raw_payload_sha256", "transport_payload_sha256", "source", "producer"):
            assert record[key] == capture[key]
        assert record["source_inputs"][0]["value"] == 6.
        assert record["period_end"] == PERIODS[0]
    earlier = build_static_financial_current(payload, now="2026-09-30T23:59:59Z", as_of_date="2026-09-30", market="US")
    assert reason(earlier, "eps_growth_yy") != "available"


def test_negative_alternate_base_is_a_clipped_reference_not_ordinary_growth():
    payload, result, _ = proof(frame([6., 3., 2., 2., 2., None], [8., -6., 2., 2., 2., -2.]))
    assert payload["eps_q2_yoy"] == -100.
    assert payload["financial_source_evidence"]["fields"]["eps_q2_yoy"]["metric"] == "Basic EPS"
    assert reason(result, "eps_q2_yoy") == "nonpositive_comparison_base"


def test_alternate_pair_cannot_relax_currency_contract():
    _, result, _ = proof(frame([None, 2., 2., 2., 1., 1.], [6., 3., 2., 2., 2., 1.]), currencies=("USD", "EUR"))
    assert reason(result, "eps_growth_yy") != "available"


def test_annual_row_selection_and_revenue_selection_do_not_change():
    statement = frame([6., 3., 2., 2., None, 1.], [8., 4., 2., 2., 2., 1.])
    statement.loc["Total Revenue"] = [100., 90., 80., 70., None, 50.]
    statement.loc["Operating Revenue"] = [100., 90., 80., 70., 60., 50.]
    values, _ = calculate(statement)
    assert values["sales_growth_yy"] is None
    annual = pd.DataFrame([[8., None, 2., 1.], [16., 8., 4., 2.]],
                          index=["Diluted EPS", "Basic EPS"], columns=pd.to_datetime(["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31"]))
    context = {}
    assert EPSRatingService().extract_annual_eps_history(annual, source_context=context) == [(2025, 8.), (2023, 2.), (2022, 1.)]
    assert context["metric"] == "Diluted EPS"
