"""Unit tests for the MM360-style color bands (Pressure / Buy Risk / TPR).

Pure computation over synthetic OHLCV — no network. Verifies the categorical
states for clearly-strong vs clearly-weak tapes, the 8-vs-7 condition TPR
fallback (benchmark supplied or not), and that the per-bar *_history arrays are
the right length with only valid labels.
"""
import numpy as np
import pandas as pd
import pytest

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


def _noisy_tape(n=460, seed=7, tight_tail=15) -> pd.DataFrame:
    """A realistic tape: random walk with two injected regime changes (so all
    three bands change state several times), ending in a TIGHT consolidation.

    The tight tail matters: Buy Risk widens its "low" zone on a contracting
    base, so a tight *ending* is exactly the whole-series fact that must not be
    allowed to leak backwards onto older bars.
    """
    rng = np.random.default_rng(seed)
    steps = rng.normal(0.0007, 0.017, n)
    steps[180:240] -= 0.007          # a distribution phase
    steps[300:340] += 0.009          # a breakout leg
    if tight_tail:
        steps[-tight_tail:] = rng.normal(0.0, 0.0015, tight_tail)
    close = 60.0 * np.exp(np.cumsum(steps))
    idx = pd.date_range("2023-01-02", periods=n, freq="B")
    span = np.abs(rng.normal(0.012, 0.006, n)) * close
    if tight_tail:
        span[-tight_tail:] = np.abs(rng.normal(0.002, 0.001, tight_tail)) * close[-tight_tail:]
    return pd.DataFrame(
        {
            "Open": close,
            "High": close + span,
            "Low": close - span,
            "Close": close,
            "Volume": rng.uniform(0.6e6, 2.4e6, n),
        },
        index=idx,
    )


def _noisy_benchmark(n=460, seed=11) -> pd.Series:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2023-01-02", periods=n, freq="B")
    return pd.Series(400.0 * np.exp(np.cumsum(rng.normal(0.0003, 0.008, n))), index=idx)


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


def test_tpr_breakdown_is_opt_in_and_matches_score():
    # Default output carries NO breakdown key — frozen band/golden callers unchanged.
    base = compute_tpr(_strong_uptrend(), benchmark_close=_benchmark())
    assert "tpr_conditions" not in base

    out = compute_tpr(_strong_uptrend(), benchmark_close=_benchmark(), with_breakdown=True)
    conds = out["tpr_conditions"]
    # 8 with a benchmark (7 price/MA + RS line); each is a labeled boolean.
    assert len(conds) == 8
    for c in conds:
        assert set(c) == {"key", "label", "passed"}
        assert isinstance(c["passed"], bool)
    # A strong uptrend passes every condition, so the passed-count == the score.
    assert sum(c["passed"] for c in conds) == out["tpr_score"]
    assert all(c["passed"] for c in conds)


def test_tpr_breakdown_drops_rs_condition_without_benchmark():
    out = compute_tpr(_strong_uptrend(), benchmark_close=None, with_breakdown=True)
    conds = out["tpr_conditions"]
    assert len(conds) == 7
    assert not any(c["key"] == "rs_line_rising" for c in conds)


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


# --- causality (no look-ahead) ---------------------------------------------
#
# The band strips are a HISTORY: the color painted above a 2023 bar claims to be
# what an operator would have seen live on that bar. That only holds if every
# bar's color depends solely on data up to that bar. The operational test is
# truncation-invariance: computing the bands on a prefix of the tape must give
# the same color on every date the two runs share. Anything computed once over
# the whole series and applied to every bar (e.g. a single VCP tightness flag)
# breaks this — a 2023 bar would be colored using 2024 information.

_HISTORY_KEYS = ("pressure_history", "buy_risk_history", "tpr_history")


def _histories_by_date(df: pd.DataFrame, bench: pd.Series) -> dict:
    """{band_key: {date: color}} for one run, so two runs can be date-aligned."""
    bands = calculate_bands(df, benchmark_close=bench, with_history=True)
    out = {}
    for key in _HISTORY_KEYS:
        hist = bands.get(key)
        assert hist, f"{key} missing/empty"
        out[key] = dict(zip(df.index[-len(hist):], hist))
    return out


@pytest.mark.parametrize("seed", [7, 14, 35])
def test_band_history_is_causal_under_truncation(seed):
    df = _noisy_tape(seed=seed)
    bench = _noisy_benchmark()
    full = _histories_by_date(df, bench)

    for k in (380, 420):
        prefix = _histories_by_date(df.iloc[:k], bench.iloc[:k])
        for key in _HISTORY_KEYS:
            shared = sorted(set(full[key]) & set(prefix[key]))
            assert len(shared) > 100, f"{key}: prefix k={k} shares too few dates"
            mismatches = [
                (d.date(), prefix[key][d], full[key][d])
                for d in shared
                if prefix[key][d] != full[key][d]
            ]
            assert not mismatches, (
                f"{key}: look-ahead — {len(mismatches)}/{len(shared)} shared bars change "
                f"colour when later data is appended (k={k}, seed={seed}); "
                f"first 5 (date, live, restated): {mismatches[:5]}"
            )


def test_live_badge_equals_last_history_bar_at_every_endpoint():
    """The current-state badge must be exactly the last painted history bar, at
    any endpoint — i.e. the strip is a record of past live badges."""
    df = _noisy_tape()
    bench = _noisy_benchmark()
    for k in (380, 420, len(df)):
        bands = calculate_bands(df.iloc[:k], benchmark_close=bench.iloc[:k], with_history=True)
        assert bands["pressure_state"] == bands["pressure_history"][-1]
        assert bands["buy_risk_state"] == bands["buy_risk_history"][-1]
        assert bands["tpr_state"] == bands["tpr_history"][-1]
