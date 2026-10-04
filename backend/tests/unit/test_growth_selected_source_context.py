"""Shadow provenance follows the legacy growth selector without changing it."""

import json

import pandas as pd
import pytest

from app.services.growth_cadence_service import compute_cadence_aware_growth


def _frame(columns, eps, revenue, *, eps_row="Diluted EPS"):
    return pd.DataFrame([eps, revenue], index=[eps_row, "Total Revenue"], columns=pd.to_datetime(columns))


def _with_context(frame, market="US"):
    legacy = compute_cadence_aware_growth(frame, market=market)
    captured = compute_cadence_aware_growth(frame, market=market, include_source_context=True)
    contexts = captured.pop("_financial_source_context")
    assert captured == legacy
    assert "_financial_source_context" not in legacy
    serialized = json.dumps(contexts, allow_nan=False)
    assert "observed_at" not in serialized
    assert "computed_at" not in serialized
    return legacy, contexts


def test_growth_context_follows_selected_row_and_distinct_qoq_yoy_columns():
    frame = _frame(
        ["2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31", "2024-12-31"],
        [1.2, 1.0, 0.9, 0.8, 0.6], [120, 110, 108, 100, 90], eps_row="Basic EPS",
    )
    # Growth's legacy selector takes the first EPS row. Capture must not switch
    # to diluted just because the EPS rating helper prefers it.
    frame.loc["Diluted EPS"] = [9, 8, 7, 6, 5]
    result, contexts = _with_context(frame)

    assert result["eps_growth_qq"] == 20.0
    assert result["eps_growth_yy"] == 100.0
    qoq = contexts["eps_growth_qq"]
    yoy = contexts["eps_growth_yy"]
    assert qoq["metric"] == "Basic EPS"
    assert qoq["basis"] == "quarterly_qoq/v1"
    assert qoq["periods_used"] == ["2025-12-31", "2025-09-30"]
    assert qoq["period_end"] == "2025-12-31"
    assert qoq["comparable_period_end"] == "2025-09-30"
    assert qoq["source_inputs"][1]["value"] == 1.0
    assert yoy["basis"] == "comparable_period_yoy/v1"
    assert yoy["comparable_period_end"] == "2024-12-31"
    assert yoy["source_inputs"][1]["value"] == 0.6
    assert contexts["sales_growth_qq"]["metric"] == "Total Revenue"
    assert qoq["cadence"] == "quarterly"
    assert qoq["remapped_to_qq"] is False


@pytest.mark.parametrize("market", ["HK", "JP"])
def test_comparable_period_remap_retains_actual_basis_and_dates(market):
    frame = _frame(
        ["2025-12-31", "2025-06-30", "2024-12-31"],
        [1.2, 1.0, 0.8], [120, 110, 100],
    )
    result, contexts = _with_context(frame, market)
    assert result["eps_growth_qq"] == 50.0
    for field in ("eps_growth_qq", "sales_growth_qq"):
        assert contexts[field]["basis"] == "comparable_period_yoy/v1"
        assert contexts[field]["periods_used"] == ["2025-12-31", "2024-12-31"]
        assert contexts[field]["cadence"] == "semiannual"
        assert contexts[field]["remapped_to_qq"] is True
    assert contexts["eps_growth_yy"]["remapped_to_qq"] is False


def test_comparable_selector_uses_actual_nearest_column_not_fixed_offset():
    frame = _frame(
        ["2025-12-31", "2025-09-30", "2025-03-31", "2024-12-29", "2024-09-30"],
        [4, 2, 1.5, 1, 0.5], [400, 200, 150, 100, 50],
    )
    result, contexts = _with_context(frame)
    assert result["eps_growth_yy"] == 300.0
    assert contexts["eps_growth_yy"]["comparable_period_end"] == "2024-12-29"


def test_us_semiannual_null_qoq_has_no_context_and_zero_negative_values_survive():
    frame = _frame(
        ["2025-12-31", "2025-06-30", "2024-12-31"],
        [-2, -1, -2], [0, 10, 100],
    )
    result, contexts = _with_context(frame)
    assert result["eps_growth_qq"] is None
    assert set(contexts) == {"eps_growth_yy", "sales_growth_yy"}
    assert result["eps_growth_yy"] == 0.0
    assert result["sales_growth_yy"] == -100.0
    assert contexts["eps_growth_yy"]["source_inputs"][0]["value"] == -2.0


@pytest.mark.parametrize("frame", [None, pd.DataFrame(), pd.DataFrame({pd.Timestamp("2025-12-31"): [1]}, index=["Diluted EPS"])])
def test_missing_history_adds_only_empty_opt_in_context(frame):
    _, contexts = _with_context(frame)
    assert contexts == {}


def test_invalid_or_too_small_inputs_have_no_observation_context():
    frame = _frame(
        ["2025-12-31", "2025-09-30", "2024-12-31"],
        [1, 0.05, 0], [100, float("nan"), 50],
    )
    result, contexts = _with_context(frame)
    assert result["eps_growth_qq"] is None
    assert result["eps_growth_yy"] is None
    assert set(contexts) == {"sales_growth_yy"}


def test_year_only_columns_do_not_get_invented_period_days():
    frame = pd.DataFrame([[2.0, 1.0]], index=["Diluted EPS"], columns=["2025", "2024"])
    _, contexts = _with_context(frame, "HK")
    context = contexts["eps_growth_qq"]
    assert context["period_end"] is None
    assert context["comparable_period_end"] is None
    assert context["period_status"] == "not_supplied"
    assert context["source_inputs"][0]["column"] == "2025"
