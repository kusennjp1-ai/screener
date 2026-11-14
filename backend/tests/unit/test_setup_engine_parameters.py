"""Tests for Setup Engine parameter governance."""

import re
from pathlib import Path

import pytest

from app.analysis.patterns.config import (
    DEFAULT_SETUP_ENGINE_PARAMETERS,
    SETUP_ENGINE_PARAMETER_SPECS,
    SetupEngineParameters,
    build_setup_engine_parameters,
    validate_setup_engine_parameters,
)


def test_specs_match_dataclass_fields():
    spec_names = {spec.name for spec in SETUP_ENGINE_PARAMETER_SPECS}
    param_names = set(DEFAULT_SETUP_ENGINE_PARAMETERS.__dataclass_fields__.keys())
    assert spec_names == param_names


def test_default_parameters_are_valid():
    errors = validate_setup_engine_parameters(DEFAULT_SETUP_ENGINE_PARAMETERS)
    assert errors == []


def test_build_parameters_supports_numeric_override():
    params = build_setup_engine_parameters({"readiness_score_ready_min_pct": 72})
    assert params.readiness_score_ready_min_pct == 72.0


def test_build_parameters_rejects_unknown_key():
    with pytest.raises(KeyError):
        build_setup_engine_parameters({"unknown_threshold": 1.0})


def test_validation_catches_contradictory_strict_relaxed():
    params = SetupEngineParameters(
        three_weeks_tight_max_contraction_pct_strict=2.0,
        three_weeks_tight_max_contraction_pct_relaxed=1.0,
    )
    errors = validate_setup_engine_parameters(params)
    assert any("strict must be <= relaxed" in err for err in errors)


def test_setup_score_min_pct_bounds():
    spec = next(
        s for s in SETUP_ENGINE_PARAMETER_SPECS if s.name == "setup_score_min_pct"
    )
    assert spec.default_value == 65.0
    assert spec.min_value == 30.0
    assert spec.max_value == 95.0
    assert spec.unit == "pct"
    assert spec.profile == "baseline"

    # Out of bounds triggers validation error.
    params = SetupEngineParameters(setup_score_min_pct=10.0)
    errors = validate_setup_engine_parameters(params)
    assert any("setup_score_min_pct" in err for err in errors)


def test_context_ma_alignment_min_pct_bounds():
    spec = next(
        s for s in SETUP_ENGINE_PARAMETER_SPECS if s.name == "context_ma_alignment_min_pct"
    )
    assert spec.default_value == 60.0
    assert spec.min_value == 0.0
    assert spec.max_value == 100.0
    assert spec.unit == "pct"
    assert spec.profile == "baseline"


def test_context_rs_rating_min_bounds():
    spec = next(
        s for s in SETUP_ENGINE_PARAMETER_SPECS if s.name == "context_rs_rating_min"
    )
    assert spec.default_value == 50.0
    assert spec.min_value == 0.0
    assert spec.max_value == 100.0
    assert spec.unit == "pct"
    assert spec.profile == "baseline"


# ── Operational invalidation threshold specs (SE-E7) ──


def test_too_extended_pivot_distance_pct_spec():
    spec = next(
        s for s in SETUP_ENGINE_PARAMETER_SPECS if s.name == "too_extended_pivot_distance_pct"
    )
    assert spec.default_value == 10.0
    assert spec.min_value == 2.0
    assert spec.max_value == 50.0
    assert spec.unit == "pct"


def test_breaks_50d_support_cushion_pct_spec():
    spec = next(
        s for s in SETUP_ENGINE_PARAMETER_SPECS if s.name == "breaks_50d_support_cushion_pct"
    )
    assert spec.default_value == 0.0
    assert spec.min_value == 0.0
    assert spec.max_value == 10.0
    assert spec.unit == "pct"


def test_low_liquidity_adtv_min_usd_spec():
    spec = next(
        s for s in SETUP_ENGINE_PARAMETER_SPECS if s.name == "low_liquidity_adtv_min_usd"
    )
    assert spec.default_value == 1_000_000.0
    assert spec.min_value == 0.0
    assert spec.max_value == 100_000_000.0
    assert spec.unit == "usd"


def test_earnings_soon_window_days_spec():
    spec = next(
        s for s in SETUP_ENGINE_PARAMETER_SPECS if s.name == "earnings_soon_window_days"
    )
    assert spec.default_value == 21.0
    assert spec.min_value == 1.0
    assert spec.max_value == 90.0
    assert spec.unit == "days"


# ── Round 3: constants restated from the brief's JavaScript, pinned so neither side drifts ──

_REPO = Path(__file__).resolve().parents[3]
_BOOK_TECHNICAL = _REPO / "frontend" / "src" / "static" / "bookTechnicalEvidence.js"


def _js_const_line(path, first_name):
    """``name -> number`` from the one ``const A = 1, B = 2;`` declaration that starts with ``first_name``."""
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"^const ({first_name} = [^;]+);", text, re.M)
    assert match, f"{first_name} declaration not found in {path.name}"
    return {name: float(value) for name, value in re.findall(r"(\w+) = ([0-9.]+)", match.group(1))}


def test_contraction_constants_match_book_technical_evidence():
    """R3c contraction_unconfirmed ports bookTechnicalEvidence.js (VCP_METHOD): same values."""
    from app.analysis.patterns import config

    js = _js_const_line(_BOOK_TECHNICAL, "VCP_LOOKBACK")
    assert js == {
        "VCP_LOOKBACK": config.CONTRACTION_LOOKBACK_SESSIONS,
        "ATR_SESSIONS": config.CONTRACTION_ATR_SESSIONS,
        "ATR_MULTIPLE": config.CONTRACTION_ATR_MULTIPLE,
        "DEPTH_FRACTION": config.CONTRACTION_DEPTH_FRACTION,
        "FINAL_FLOOR_PCT": config.CONTRACTION_FINAL_FLOOR_PCT,
        "MAX_LEGS": config.CONTRACTION_MAX_LEGS,
        "REPAIR_FRACTION": config.CONTRACTION_REPAIR_FRACTION,
    }


_PRICE_ACTIVITY = _REPO / "frontend" / "src" / "static" / "priceActivity.js"


def test_price_pinned_constants_match_price_activity():
    """R3a price_pinned ports priceActivity.js (R2(a)): the seven exported constants, same values."""
    from app.analysis.patterns import config

    text = _PRICE_ACTIVITY.read_text(encoding="utf-8")
    js = {name: float(value) for name, value in re.findall(r"^export const (\w+) = ([0-9.]+);", text, re.M)}
    assert js == {
        "PRICE_ACTIVITY_SESSIONS": config.PRICE_ACTIVITY_SESSIONS,
        "LOW_RANGE_PERCENT": config.LOW_RANGE_PERCENT,
        "ACTIVITY_ADR_SESSIONS": config.ACTIVITY_ADR_SESSIONS,
        "LOW_ADR_PERCENT": config.LOW_ADR_PERCENT,
        "GAP_MOVE_PERCENT": config.GAP_MOVE_PERCENT,
        "SINCE_GAP_RANGE_PERCENT": config.SINCE_GAP_RANGE_PERCENT,
        "SINCE_GAP_MIN_SESSIONS": config.SINCE_GAP_MIN_SESSIONS,
    }
