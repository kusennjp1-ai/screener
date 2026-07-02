"""Unit tests for the MM360-style color bands (Pressure / Buy Risk / TPR).

Pure computation over synthetic OHLCV — no network. Verifies the categorical
states for clearly-strong vs clearly-weak tapes, the 8-vs-7 condition TPR
fallback (benchmark supplied or not), and that the per-bar *_history arrays are
the right length with only valid labels.
"""
import numpy as np
import pandas as pd

from app.services.minervini_bands import (
    BAND_HISTORY_BARS,
    calculate_bands,
    compute_buy_risk,
    compute_pressure,
    compute_tpr,
)

_PRESSURE_LABELS = {"buy", "sell", "neutral"}
_RISK_LABELS = {"low", "medium", "high"}
_TPR_LABELS = {"strong", "transition", "weak"}


def _ohlcv(close: np.ndarray, *, high_off=0.2, low_off=1.0, volume=1_000_000) -> pd.DataFrame:
    """Build an OHLCV frame from a close path. Default offsets close *near the
    high* of each bar (positive close-location value -> buying pressure)."""
    idx = pd.date_range("2024-01-01", periods=len(close), freq="B")
    return pd.DataFrame(
        {
            "Open": close,
            "High": close + high_off,
            "Low": close - low_off,
            "Close": close,
            "Volume": np.full(len(close), volume, dtype=float),
        },
        index=idx,
    )


def _strong_uptrend(n=300) -> pd.DataFrame:
    return _ohlcv(np.linspace(50.0, 150.0, n))


def _downtrend(n=300) -> pd.DataFrame:
    return _ohlcv(np.linspace(150.0, 50.0, n))


def _benchmark(n=300) -> pd.Series:
    # Rises much slower than the strong uptrend, so the stock's RS line is rising.
    idx = pd.date_range("2024-01-01", periods=n, freq="B")
    return pd.Series(np.linspace(400.0, 430.0, n), index=idx)


# --- TPR -------------------------------------------------------------------

def test_tpr_strong_uptrend_with_benchmark_uses_8_conditions():
    out = compute_tpr(_strong_uptrend(), benchmark_close=_benchmark())
    assert out["tpr_state"] == "strong"
    assert out["tpr_max"] == 8
    assert out["tpr_score"] >= 8


def test_tpr_falls_back_to_7_conditions_without_benchmark():
    out = compute_tpr(_strong_uptrend(), benchmark_close=None)
    assert out["tpr_max"] == 7
    assert out["tpr_state"] == "strong"


def test_tpr_weak_on_downtrend():
    out = compute_tpr(_downtrend(), benchmark_close=None)
    assert out["tpr_state"] == "weak"


def test_tpr_insufficient_history_returns_none():
    out = compute_tpr(_ohlcv(np.linspace(50.0, 60.0, 120)))
    assert out == {"tpr_state": None, "tpr_score": None}


# --- Buy Risk --------------------------------------------------------------

def test_buy_risk_high_below_50dma():
    # Price beneath its rising-then-falling 50DMA -> always high risk.
    out = compute_buy_risk(_downtrend())
    assert out["buy_risk_state"] == "high"


def test_buy_risk_label_valid_on_uptrend():
    out = compute_buy_risk(_strong_uptrend())
    assert out["buy_risk_state"] in _RISK_LABELS
    assert out["buy_risk_atr"] is not None


# --- Pressure --------------------------------------------------------------

def test_pressure_buy_when_closing_near_highs():
    # Closes sit near each bar's high (positive CLV) with steady volume -> AD
    # line rises -> buying pressure.
    out = compute_pressure(_strong_uptrend())
    assert out["pressure_state"] == "buy"


def test_pressure_sell_on_sustained_decline():
    # The calibrated band is Force-Index driven (close-to-close change x
    # volume), so distribution is falling CLOSES, not intrabar position: a
    # monotonic decline keeps the force negative -> selling pressure.
    df = _ohlcv(np.linspace(150.0, 50.0, 300), high_off=1.0, low_off=0.2)
    out = compute_pressure(df)
    assert out["pressure_state"] == "sell"


# --- history arrays --------------------------------------------------------

def test_history_arrays_have_valid_labels_and_lengths():
    bands = calculate_bands(_strong_uptrend(), benchmark_close=_benchmark(), with_history=True)

    # All three band strips share BAND_HISTORY_BARS so they span the same chart
    # window (Pressure used to be only PRESSURE_LOOKBACK=50, leaving a black gap).
    assert len(bands["pressure_history"]) == BAND_HISTORY_BARS
    assert set(bands["pressure_history"]) <= _PRESSURE_LABELS

    assert len(bands["buy_risk_history"]) == BAND_HISTORY_BARS
    assert set(bands["buy_risk_history"]) <= _RISK_LABELS

    assert len(bands["tpr_history"]) == BAND_HISTORY_BARS
    assert set(bands["tpr_history"]) <= _TPR_LABELS


def test_calculate_bands_omits_history_by_default():
    bands = calculate_bands(_strong_uptrend(), benchmark_close=_benchmark())
    assert "pressure_history" not in bands
    assert "buy_risk_history" not in bands
    assert "tpr_history" not in bands
    # but states are present
    assert bands["pressure_state"] in _PRESSURE_LABELS
    assert bands["buy_risk_state"] in _RISK_LABELS
    assert bands["tpr_state"] in _TPR_LABELS


def test_calculate_bands_empty_frame_returns_empty():
    assert calculate_bands(pd.DataFrame()) == {}
