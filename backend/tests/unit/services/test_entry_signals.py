"""Tests for the Markets 360 early-entry signals."""
import numpy as np
import pandas as pd

from app.services.markets360.entry_signals import compute_entry_signals


def _frame(close, vol) -> pd.DataFrame:
    close = np.asarray(close, dtype="float64")
    vol = np.asarray(vol, dtype="float64")
    n = len(close)
    idx = pd.bdate_range("2023-01-02", periods=n)
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) * 1.01
    low = np.minimum(open_, close) * 0.99
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx
    )


def test_insufficient_data_is_all_none():
    r = compute_entry_signals(_frame(np.linspace(10, 11, 5), np.full(5, 1e6)))
    assert r == {"pocket_pivot": None, "power_trend": None, "volume_surge": None}


def test_none_input_is_safe():
    assert compute_entry_signals(None)["power_trend"] is None


def test_power_trend_in_clean_stage2():
    n = 120
    close = np.linspace(20, 80, n)          # steady advance above rising MAs
    r = compute_entry_signals(_frame(close, np.full(n, 1e6)))
    assert r["power_trend"] is True


def test_no_power_trend_in_downtrend():
    n = 120
    close = np.linspace(80, 30, n)
    r = compute_entry_signals(_frame(close, np.full(n, 1e6)))
    assert r["power_trend"] is False


def test_pocket_pivot_fires_on_up_day_clearing_down_volume():
    n = 80
    close = list(np.linspace(40, 60, n - 6))
    # craft last 6 bars: a few down days on modest volume, then a strong up day
    close += [61, 60, 61, 60, 60.5, 62]    # ends on an up day
    close = np.array(close, dtype="float64")
    vol = np.full(n, 1_000_000.0)
    vol[-6:] = [900_000, 1_100_000, 950_000, 1_200_000, 1_000_000, 3_000_000]  # surge today
    r = compute_entry_signals(_frame(close, vol))
    assert r["pocket_pivot"] is True
    assert r["volume_surge"] > 1.5


def test_volume_surge_value():
    n = 80
    vol = np.full(n, 1_000_000.0)
    vol[-1] = 2_500_000.0
    r = compute_entry_signals(_frame(np.linspace(20, 60, n), vol))
    assert abs(r["volume_surge"] - 2.5) < 0.05
