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


def test_pressure_crash_override_forces_sell():
    """A capitulation bar (<=-6% on >=2x avg volume) reads sell even if the
    smooth AD-line slope is still positive from the prior advance."""
    close = np.concatenate([np.linspace(50, 100, 80), [93.0]])  # uptrend then -7% day
    df = _frame(close)
    df.loc[df.index[-1], "Volume"] = 5_000_000  # >= 2x the 1M baseline
    assert calculate_bands(df)["pressure_state"] == "sell"


def test_pressure_distribution_override_forces_sell():
    """A cluster of down-on-volume bars >=5% off the recent high reads sell."""
    close = np.concatenate([np.linspace(50, 100, 70), [99, 97, 95, 94, 93, 92]])
    df = _frame(close)
    df.iloc[-6:, df.columns.get_loc("Volume")] = 3_000_000  # elevated down-volume
    assert calculate_bands(df)["pressure_state"] == "sell"


def test_pressure_stays_buy_in_clean_uptrend():
    """The overrides must NOT fire on a steady advance (no crash, not off highs)."""
    df = _frame(np.linspace(50, 160, 120))
    assert calculate_bands(df)["pressure_state"] == "buy"


def test_tpr_demotes_strong_to_transition_on_rollover():
    """A full-template name materially fading from highs (5-bar <=-3%, 10-bar
    <=-1%) reads transition, not strong; one sitting at highs stays strong."""
    rolling = np.concatenate([np.linspace(50, 200, 294), [200, 196, 193, 190, 187, 185]])
    assert calculate_bands(_frame(rolling))["tpr_state"] == "transition"

    at_highs = np.linspace(50, 200, 300)
    assert calculate_bands(_frame(at_highs))["tpr_state"] == "strong"


def _flips(seq):
    return sum(1 for i in range(1, len(seq)) if seq[i] != seq[i - 1])


def test_smoothing_paints_blocks_not_chop():
    """The hysteresis layer must remove bar-to-bar chop: on a noisy series the
    debounced band history flips far fewer times than the raw (confirm=1) one.
    This is what makes the strip read as smooth MM360-style regime blocks."""
    from app.services.minervini_bands import (
        compute_pressure,
        compute_buy_risk,
        compute_tpr,
    )

    rng = np.random.RandomState(0)
    t = np.arange(360)
    # Choppy sideways tape: a gentle drift with oscillation + noise so the raw
    # per-bar signals cross their thresholds repeatedly.
    close = 100 + t * 0.05 + np.sin(t * 0.6) * 7 + rng.randn(360) * 2.5
    df = _frame(close)

    for fn, key in (
        (compute_pressure, "pressure_history"),
        (compute_buy_risk, "buy_risk_history"),
        (compute_tpr, "tpr_history"),
    ):
        raw = fn(df, with_history=True, confirm_bars=1)[key]
        smooth = fn(df, with_history=True)[key]
        assert _flips(smooth) < _flips(raw), f"{key} not smoothed"


def test_breakout_to_new_high_flips_pressure_buy_fast():
    """A break to fresh highs on up-volume flips Pressure green immediately,
    even right after a shakeout fired the distribution sell-override — the band
    must not lag a genuine breakout (matches MM360)."""
    up = np.linspace(50, 100, 80)
    pull = np.array([97.0, 94, 92, 90, 89])         # off-highs distribution
    breakout = np.array([95.0, 99, 103])            # reclaim + new high
    df = _frame(np.concatenate([up, pull, breakout]))
    df.iloc[80:85, df.columns.get_loc("Volume")] = 2_000_000   # down-volume
    df.iloc[-1, df.columns.get_loc("Volume")] = 3_000_000      # breakout volume
    assert calculate_bands(df)["pressure_state"] == "buy"


def test_buy_risk_pullback_in_uptrend_is_not_high():
    """A dip under the 50DMA while the broader trend is intact (price still well
    above the 200DMA) is a low-extension entry, not "high" risk — MM360 paints
    those pullbacks green. Only a broken trend (under the 200DMA too) is high."""
    rise = np.linspace(50, 130, 260)
    pull = np.linspace(130, 118, 14)   # under the 50DMA, far above the 200DMA
    df = _frame(np.concatenate([rise, pull]))
    bands = calculate_bands(df, with_history=True)
    assert bands["buy_risk_state"] in ("low", "medium")
    # but a name under BOTH MAs is a broken trend -> high
    down = _frame(np.linspace(160, 70, 320))
    assert calculate_bands(down)["buy_risk_state"] == "high"


def test_history_length_matches_window():
    df = _frame(np.linspace(50, 160, 320))
    bands = calculate_bands(df, with_history=True)
    # All three strips span the same trailing window so the row has no black gap.
    assert len(bands["pressure_history"]) == len(bands["buy_risk_history"]) == len(bands["tpr_history"])
    assert len(bands["tpr_history"]) <= 252
