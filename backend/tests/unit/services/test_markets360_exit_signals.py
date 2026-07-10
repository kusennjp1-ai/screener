"""Tests for the Markets 360 sell-timing engine (climax + trailing ladder)."""
import numpy as np
import pandas as pd

from app.services.markets360.exit_signals import (
    compute_sell_plan,
    compute_trailing_stop,
    detect_climax_run,
)


def _frame(close, volume=None, open_=None) -> pd.DataFrame:
    close = np.asarray(close, dtype="float64")
    n = len(close)
    idx = pd.bdate_range("2023-01-02", periods=n)
    if open_ is None:
        open_ = np.concatenate([[close[0]], close[:-1]])
    open_ = np.asarray(open_, dtype="float64")
    high = np.maximum(open_, close) * 1.01
    low = np.minimum(open_, close) * 0.99
    vol = np.asarray(volume, dtype="float64") if volume is not None else np.full(n, 1_000_000.0)
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx
    )


# --- climax run ---------------------------------------------------------------

def test_climax_none_and_short_data_are_safe():
    assert detect_climax_run(None)["active"] is False
    assert detect_climax_run(_frame(np.linspace(10, 11, 20)))["active"] is False


def test_quiet_uptrend_is_not_a_climax():
    """A steady, modest uptrend never clusters two frenzy tells."""
    close = np.linspace(50, 60, 250)  # +20% over a year, hugging its MAs
    out = detect_climax_run(_frame(close))
    assert out["active"] is False
    assert out["score"] <= 30


def test_parabolic_run_fires_the_climax():
    """A long advance ending in a parabolic melt-up (all up days, its largest
    daily gains at the very end, far above the 200-DMA) is a sell-into-strength."""
    base = np.linspace(20, 60, 230)
    # 20 final bars compounding ~6%/day: extended + up-day frenzy + largest gain late
    blowoff = 60 * np.cumprod(np.full(20, 1.06))
    out = detect_climax_run(_frame(np.concatenate([base, blowoff])))
    assert out["active"] is True
    assert out["score"] >= 50
    assert "up_day_frenzy" in out["flags"]
    assert out["up_days_10"] == 10
    assert out["extension_200dma_pct"] > 70


def test_early_breakout_strength_is_not_punished():
    """A fresh breakout with strong up days but little extension must NOT read
    as climax (Minervini sells climaxes, not new breakouts)."""
    flat = np.full(240, 50.0)
    breakout = 50 * np.cumprod(np.full(10, 1.015))  # +16%, up days but barely extended
    out = detect_climax_run(_frame(np.concatenate([flat, breakout])))
    assert out["active"] is False


# --- trailing-stop ladder -------------------------------------------------------

def _trend_frame(last_close: float, n: int = 120) -> pd.DataFrame:
    return _frame(np.linspace(last_close * 0.7, last_close, n))


def test_ladder_requires_entry_context():
    out = compute_trailing_stop(_trend_frame(100), None, None)
    assert out["stop"] is None and out["r_multiple"] is None


def test_ladder_below_1r_keeps_the_initial_stop():
    df = _trend_frame(102)  # entry 100, stop 92 -> risk 8; +0.25R
    out = compute_trailing_stop(df, 100.0, 92.0)
    assert out["basis"] == "initial"
    assert out["stop"] == 92.0
    assert out["raised"] is False


def test_ladder_1r_halves_the_risk():
    df = _trend_frame(109)  # +1.125R
    out = compute_trailing_stop(df, 100.0, 92.0)
    assert out["basis"] == "half_risk"
    assert out["stop"] == 96.0
    assert out["raised"] is True


def test_ladder_2r_moves_to_breakeven():
    df = _trend_frame(117)  # +2.125R
    out = compute_trailing_stop(df, 100.0, 92.0)
    assert out["basis"] == "breakeven"
    assert out["stop"] == 100.0


def test_ladder_3r_locks_at_least_1r():
    df = _trend_frame(130)  # +3.75R
    out = compute_trailing_stop(df, 100.0, 92.0)
    assert out["stop"] >= 108.0  # entry + 1R minimum
    assert out["basis"] in ("lock_1r", "trail_50dma", "trail_20bar_low")
    assert out["stop"] < 130.0  # never above price


def test_ladder_never_lowers_the_stop():
    """Even if structure levels sit below the initial stop, the ladder can only
    raise it."""
    df = _trend_frame(101)
    out = compute_trailing_stop(df, 100.0, 99.5)  # tiny risk; +3R already
    assert out["stop"] >= 99.5


# --- unified plan ----------------------------------------------------------------

def test_sell_plan_holds_on_a_healthy_trend():
    plan = compute_sell_plan(_trend_frame(100), entry=98.0, initial_stop=90.0)
    assert plan["action"] == "hold"
    assert plan["climax"]["active"] is False


def test_sell_plan_prefers_exit_over_climax():
    """A mature 50-DMA breakdown on volume wins over everything else."""
    close = np.concatenate([np.linspace(50, 100, 240), np.linspace(98, 80, 10)])
    vol = np.full(250, 1_000_000.0)
    vol[-1] = 2_500_000.0  # breakdown bar on 2.5x volume
    plan = compute_sell_plan(_frame(close, volume=vol), entry=60.0, initial_stop=55.0)
    assert plan["breakdown"]["breakdown_detected"] is True
    assert plan["action"] == "exit"


def test_sell_plan_flags_sell_into_strength():
    base = np.linspace(20, 60, 230)
    blowoff = 60 * np.cumprod(np.full(20, 1.06))
    plan = compute_sell_plan(_frame(np.concatenate([base, blowoff])))
    assert plan["action"] == "sell_into_strength"


def test_sell_plan_raise_stop_when_ladder_moves():
    df = _trend_frame(117)  # 2R earned, no breakdown, no climax
    plan = compute_sell_plan(df, entry=100.0, initial_stop=92.0)
    assert plan["action"] == "raise_stop"
    assert plan["trailing"]["stop"] == 100.0


def test_sell_plan_none_input_is_safe():
    plan = compute_sell_plan(None)
    assert plan["action"] == "hold"
