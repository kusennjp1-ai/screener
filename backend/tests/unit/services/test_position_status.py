"""Unit tests for the position-status computation (sell engine on read)."""
import numpy as np
import pandas as pd
import pytest

from app.services.position_status import compute_position_status


def _df(closes, lows=None):
    n = len(closes)
    idx = pd.date_range("2026-01-02", periods=n, freq="B")
    closes = pd.Series(closes, index=idx, dtype=float)
    lows = pd.Series(lows if lows is not None else [c * 0.99 for c in closes], index=idx, dtype=float)
    return pd.DataFrame({
        "Open": closes.shift(1).fillna(closes.iloc[0]),
        "High": closes * 1.01,
        "Low": lows,
        "Close": closes,
        "Volume": np.full(n, 1_000_000.0),
    })


def test_no_data_degrades_not_raises():
    out = compute_position_status(None, 100.0, 92.0)
    assert out["action"] == "no_data"
    assert out["last_close"] is None
    assert out["targets"] == []
    # empty frame and missing entry behave the same
    assert compute_position_status(_df([100.0]).iloc[0:0], 100.0, 92.0)["action"] == "no_data"
    assert compute_position_status(_df([100.0, 101.0]), None, 92.0)["action"] == "no_data"


def test_flat_position_holds_with_targets_off_original_risk():
    # ~flat around the 100 entry: no ladder trigger, no breakdown, no climax.
    df = _df([100.0 + 0.1 * (i % 3) for i in range(60)])
    out = compute_position_status(df, 100.0, 92.0)
    assert out["action"] == "hold"
    assert out["last_close"] == pytest.approx(df["Close"].iloc[-1], abs=0.01)
    assert out["pnl_pct"] is not None
    # 1R = 8 -> 2R target 116, 3R target 124 (single source of truth: risk.py)
    assert [t["price"] for t in out["targets"]] == [116.0, 124.0]


def test_winner_raises_stop_and_reports_r_multiple():
    # Steady climb from 100 to ~130: > 2R earned on an 8-point risk unit ->
    # the trailing ladder locks gains and the action becomes raise_stop.
    df = _df(list(np.linspace(100.0, 130.0, 80)))
    out = compute_position_status(df, 100.0, 92.0)
    assert out["r_multiple"] is not None and out["r_multiple"] >= 2.0
    assert out["sell_plan"]["trailing"]["raised"] is True
    assert out["sell_plan"]["trailing"]["stop"] >= 100.0  # at least breakeven lock
    assert out["action"] in ("raise_stop", "sell_into_strength")


def test_without_stop_sell_plan_still_computes_but_no_targets():
    df = _df(list(np.linspace(100.0, 120.0, 60)))
    out = compute_position_status(df, 100.0, None)
    assert out["action"] in ("hold", "raise_stop", "sell_into_strength", "tighten_stop", "exit")
    assert out["targets"] == []
    assert out["r_multiple"] is None  # no risk unit without a stop
