"""Tests for the Markets 360 RS-line analysis."""
import numpy as np
import pandas as pd

from app.services.markets360.rs_line import compute_rs_line_signals, _empty


def _series(vals: np.ndarray) -> pd.Series:
    idx = pd.bdate_range("2023-01-02", periods=len(vals))
    return pd.Series(np.asarray(vals, dtype="float64"), index=idx)


def test_insufficient_data_is_safe():
    s = _series(np.linspace(10, 11, 30))
    assert compute_rs_line_signals(s, s) == _empty()
    assert compute_rs_line_signals(None, s) == _empty()


def test_leader_makes_rs_new_high():
    """Stock far outpacing a flat benchmark drives its RS line to a new high and
    rising."""
    n = 300
    stock = _series(np.linspace(20, 130, n))
    bench = _series(np.linspace(100, 103, n))
    r = compute_rs_line_signals(stock, bench)
    assert r["rs_new_high"] is True
    assert r["rs_rising"] is True
    assert r["rs_pct_from_high"] <= 0.5
    assert r["rs_slope_pct"] > 0


def test_laggard_is_not_a_new_high():
    """Stock underperforming a rising benchmark has a falling RS line, no new high."""
    n = 300
    stock = _series(np.linspace(100, 108, n))
    bench = _series(np.linspace(100, 160, n))
    r = compute_rs_line_signals(stock, bench)
    assert r["rs_new_high"] is False
    assert r["rs_rising"] is False
    assert r["rs_pct_from_high"] > 0.5


def test_blue_dot_when_rs_leads_price():
    """RS line at a new high while price is NOT yet at a new high -> O'Neil blue
    dot. Build a stock that recently pulled back in price but whose benchmark fell
    harder, so relative strength is at a high though absolute price is not."""
    n = 300
    base = np.linspace(20, 120, n - 20)
    # last 20 bars: price eases ~6% off its high (not at a new price high)
    price = np.concatenate([base, np.linspace(120, 113, 20)])
    # benchmark falls much harder over the same tail -> RS line still at new high
    bench_base = np.linspace(100, 130, n - 20)
    bench = np.concatenate([bench_base, np.linspace(130, 100, 20)])
    r = compute_rs_line_signals(_series(price), _series(bench))
    assert r["rs_new_high"] is True
    assert r["rs_line_blue_dot"] is True


def test_keys_always_present():
    s = _series(np.linspace(10, 50, 120))
    r = compute_rs_line_signals(s, _series(np.linspace(100, 100, 120)))
    assert set(r.keys()) == set(_empty().keys())
