"""Exact selected EPS inputs are optional and never renew source clocks."""

import json

import pandas as pd
import pytest

from app.services.eps_rating_service import EPSRatingService


def _frame(columns, eps, *, metric="Diluted EPS"):
    return pd.DataFrame([eps], index=[metric], columns=pd.to_datetime(columns))


def _quarterly():
    return _frame(
        ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"],
        [3, 2, 1.5, 1.2, 1, 1],
    )


def _with_context(annual, quarterly):
    service = EPSRatingService()
    legacy = service.calculate_eps_rating_data(annual, quarterly)
    captured = service.calculate_eps_rating_data(annual, quarterly, include_source_context=True)
    contexts = captured.pop("_financial_source_context")
    assert captured == legacy
    assert set(legacy) == {"eps_5yr_cagr", "eps_q1_yoy", "eps_q2_yoy", "eps_raw_score", "eps_years_available"}
    serialized = json.dumps(contexts, allow_nan=False)
    assert "observed_at" not in serialized
    assert "computed_at" not in serialized
    return legacy, contexts


def test_cagr_keeps_actual_fiscal_dates_sort_gaps_and_up_to_five_inputs():
    annual = _frame(
        ["2021-05-29", "2026-05-30", "2018-05-26", "2024-06-01", "2023-05-27", "2019-06-01", "2025-05-31"],
        [2, 8, 0.25, 6, 4, 1, float("nan")], metric="Basic EPS",
    )
    result, contexts = _with_context(annual, _quarterly())
    context = contexts["eps_5yr_cagr"]

    assert result["eps_5yr_cagr"] == 34.59
    assert result["eps_years_available"] == 5
    assert context["metric"] == "Basic EPS"
    assert context["period_end"] == "2026-05-30"
    assert context["comparable_period_end"] == "2019-06-01"
    assert context["periods_used"] == ["2026-05-30", "2024-06-01", "2023-05-27", "2021-05-29", "2019-06-01"]
    assert [item["value"] for item in context["source_inputs"]] == [8, 6, 4, 2, 1]
    assert [item["year"] for item in context["source_inputs"]] == [2026, 2024, 2023, 2021, 2019]
    assert context["elapsed_years"] == 7
    assert context["elapsed_year_rule"] == "latest_fiscal_year_minus_earliest_selected_fiscal_year"
    assert context["basis"] == "annual_eps_cagr/v1"
    assert context["clipping"] == {"minimum": -100.0, "maximum": 500.0}


def test_quarters_have_distinct_actual_positional_dates_and_preferred_diluted_row():
    quarterly = _quarterly()
    quarterly.loc["Basic EPS"] = [30, 20, 15, 12, 10, 10]
    quarterly = quarterly.loc[["Basic EPS", "Diluted EPS"]]
    result, contexts = _with_context(None, quarterly)

    assert result["eps_q1_yoy"] == 200.0
    assert result["eps_q2_yoy"] == 100.0
    assert contexts["eps_q1_yoy"]["periods_used"] == ["2026-06-30", "2025-06-30"]
    assert contexts["eps_q2_yoy"]["periods_used"] == ["2026-03-31", "2025-03-31"]
    assert contexts["eps_q1_yoy"]["column_positions"] == [0, 4]
    assert contexts["eps_q2_yoy"]["column_positions"] == [1, 5]
    assert contexts["eps_q2_yoy"]["metric"] == "Diluted EPS"
    assert contexts["eps_q2_yoy"]["comparable_period_end"] == "2025-03-31"
    assert contexts["eps_q2_yoy"]["basis"] == "quarterly_eps_yoy/v1"


@pytest.mark.parametrize("annual,quarterly,expected_inputs,cagr_source,acceleration", [
    (_frame(["2025-12-31", "2024-12-31"], [2, 1]), _quarterly(), ["eps_5yr_cagr", "eps_q1_yoy", "eps_q2_yoy"], "eps_5yr_cagr", True),
    (None, _quarterly(), ["eps_q1_yoy", "eps_q2_yoy"], "quarterly_average", True),
    (None, _quarterly().iloc[:, :5], ["eps_q1_yoy"], "quarterly_average", False),
])
def test_raw_score_lists_only_used_inputs_and_versioned_formula(annual, quarterly, expected_inputs, cagr_source, acceleration):
    result, contexts = _with_context(annual, quarterly)
    context = contexts["eps_raw_score"]
    assert context["input_fields"] == expected_inputs
    assert context["provenance_kind"] == "derived"
    assert context["algorithm"] == "eps-rating-raw-score-v1"
    assert context["basis"] == "eps_raw_score/v1"
    assert context["cagr_component_source"] == cagr_source
    assert context["acceleration_enabled"] is acceleration
    assert context["weights"] == {"cagr": 0.4, "quarterly_average": 0.5, "acceleration": 0.1}
    assert context["source_inputs"] == [{"field": field, "value": result[field]} for field in expected_inputs]
    assert context["period_end"] is None
    assert context["period_status"] == "dependency_defined"


def test_q2_only_score_does_not_invent_q1_dependency():
    quarterly = _quarterly()
    quarterly.iloc[0, 0] = float("nan")
    result, contexts = _with_context(None, quarterly)
    assert result["eps_raw_score"] == 90.0
    assert set(contexts) == {"eps_q2_yoy", "eps_raw_score"}
    assert contexts["eps_raw_score"]["input_fields"] == ["eps_q2_yoy"]


def test_absent_quarters_do_not_create_score_even_when_cagr_exists():
    result, contexts = _with_context(_frame(["2025-12-31", "2024-12-31"], [2, 1]), None)
    assert result["eps_5yr_cagr"] == 100.0
    assert result["eps_raw_score"] is None
    assert set(contexts) == {"eps_5yr_cagr"}


@pytest.mark.parametrize("start,end,expected", [(1, 100, 500.0), (1, -1, -50.0), (-1, 2, 60.0), (-2, -1, 25.0), (-1, -2, -25.0), (0.001, 1, 100.0)])
def test_cagr_legacy_edge_rules_and_clipping_survive(start, end, expected):
    result, contexts = _with_context(_frame(["2025-12-31", "2024-12-31"], [end, start]), None)
    assert result["eps_5yr_cagr"] == expected
    assert [item["value"] for item in contexts["eps_5yr_cagr"]["source_inputs"]] == [end, start]


def test_quarterly_clipping_keeps_original_source_values():
    quarterly = _quarterly()
    quarterly.iloc[0, 0] = 100
    quarterly.iloc[0, 1] = -100
    result, contexts = _with_context(None, quarterly)
    assert result["eps_q1_yoy"] == 500.0
    assert result["eps_q2_yoy"] == -100.0
    assert contexts["eps_q1_yoy"]["source_inputs"][0]["value"] == 100
    assert contexts["eps_q2_yoy"]["source_inputs"][0]["value"] == -100
    assert contexts["eps_q1_yoy"]["rounding"] == {"decimal_places": 2}


def test_duplicate_fiscal_years_stay_unavailable_without_cagr_context():
    annual = _frame(["2025-12-31", "2025-06-30", "2024-12-31"], [3, 2, 1])
    result, contexts = _with_context(annual, None)
    assert result["eps_5yr_cagr"] is None
    assert result["eps_years_available"] == 0
    assert contexts == {}


def test_year_only_labels_remain_known_values_with_unsupplied_period_days():
    annual = pd.DataFrame([[2, 1]], index=["Basic EPS"], columns=["2025", "2024"])
    result, contexts = _with_context(annual, None)
    assert result["eps_5yr_cagr"] == 100.0
    assert contexts["eps_5yr_cagr"]["periods_used"] == [None, None]
    assert contexts["eps_5yr_cagr"]["period_status"] == "not_supplied"


def test_nonfinite_selected_source_is_not_certified_after_legacy_clipping():
    quarterly = _quarterly().astype(float)
    quarterly.iloc[0, 0] = float("inf")
    result, contexts = _with_context(None, quarterly)
    assert result["eps_q1_yoy"] == 500.0
    assert "eps_q1_yoy" not in contexts
    assert contexts["eps_raw_score"]["input_fields"] == ["eps_q1_yoy", "eps_q2_yoy"]
