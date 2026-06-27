"""Time-alignment tests for the MM360 color bands.

Verifies the *real* band computation (``minervini_bands.calculate_bands``) that
feeds the Markets 360 chart: the Pressure / Buy Risk / TPR strips must color
each bar by that bar's price state, so an uptrend reads green, a downtrend reads
red, and a decline-then-recovery flips weak→strong at the turn — exactly the
behaviour the reference screenshots show.
"""
import numpy as np
import pandas as pd

from app.services.minervini_bands import calculate_bands


def _frame(close: np.ndarray) -> pd.DataFrame:
    """Build a daily OHLCV frame from a close path.

    Bars are shaped so the close sits near the bar high on up days and near the
    low on down days — i.e. a positive close-location value when advancing and
    negative when declining. This is what the Pressure (accumulation/
    distribution) band keys off, so flat mid-range bars (CLV=0) would make every
    day read "neutral" and defeat the test.
    """
    n = len(close)
    idx = pd.bdate_range("2023-01-02", periods=n)
    close = np.asarray(close, dtype="float64")
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.empty(n)
    low = np.empty(n)
    for i in range(n):
        if close[i] >= open_[i]:           # up day: close near the high
            high[i] = close[i] * 1.001
            low[i] = close[i] * 0.98
        else:                               # down day: close near the low
            high[i] = close[i] * 1.02
            low[i] = close[i] * 0.999
    vol = np.full(n, 1_000_000.0)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx)


def test_sustained_uptrend_reads_green():
    df = _frame(np.linspace(50, 160, 320))
    bands = calculate_bands(df, with_history=True)
    assert bands["tpr_state"] == "strong"
    assert bands["pressure_state"] == "buy"
    assert bands["buy_risk_state"] in ("low", "medium")
    # The trailing strip is green (strong) at the most recent bars.
    assert bands["tpr_history"][-1] == "strong"
    assert bands["pressure_history"][-1] == "buy"


def test_sustained_downtrend_reads_red():
    df = _frame(np.linspace(160, 50, 320))
    bands = calculate_bands(df, with_history=True)
    assert bands["tpr_state"] == "weak"
    assert bands["pressure_state"] == "sell"
    assert bands["buy_risk_state"] == "high"  # below the 50DMA -> high risk
    assert bands["tpr_history"][-1] == "weak"
    assert bands["pressure_history"][-1] == "sell"


def test_decline_then_recovery_flips_weak_to_strong():
    # First half declines (160 -> 80), second half recovers to new highs (-> 200).
    decline = np.linspace(160, 80, 200)
    recover = np.linspace(80, 200, 200)
    df = _frame(np.concatenate([decline, recover]))
    bands = calculate_bands(df, with_history=True)

    tpr_hist = bands["tpr_history"]
    pres_hist = bands["pressure_history"]
    # End state is a clean uptrend.
    assert bands["tpr_state"] == "strong"
    assert tpr_hist[-1] == "strong"
    assert pres_hist[-1] == "buy"
    # Early in the trailing window (still in the decline) it is not yet strong.
    assert tpr_hist[0] in ("weak", "transition")
    # The strip actually transitions: a weak/transition stretch precedes a strong tail.
    assert any(s in ("weak", "transition") for s in tpr_hist[: len(tpr_hist) // 2])
    assert tpr_hist[-20:].count("strong") >= 10


def test_buy_risk_low_zone_calibrated_to_six_atr():
    """Locks the multi-ticker calibration: the 'low' buy-risk zone reaches ~6
    ATRs above the 50DMA (real MM360 charts read extended leaders like FTNT/MRVL
    at ~5 ATRs as low/green). A 4-ATR cutoff flipped them to amber too early."""
    from app.services.minervini_bands import _risk_from_extension

    assert _risk_from_extension(3.0, False) == "low"
    assert _risk_from_extension(5.0, False) == "low"     # was "medium" before calibration
    assert _risk_from_extension(7.0, False) == "medium"
    assert _risk_from_extension(9.0, False) == "high"


def test_history_length_matches_window():
    df = _frame(np.linspace(50, 160, 320))
    bands = calculate_bands(df, with_history=True)
    # All three strips span the same trailing window so the row has no black gap.
    assert len(bands["pressure_history"]) == len(bands["buy_risk_history"]) == len(bands["tpr_history"])
    assert len(bands["tpr_history"]) <= 252
