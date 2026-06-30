"""Relative-strength line analysis — Minervini's "RS line at new high" tell.

The RS line is the stock's price divided by the benchmark (here the same
benchmark the bands use). Minervini and O'Neil weight it heavily: a *leader*
drives its RS line to a new high — frequently **before** price itself breaks out
("RS line in new-high ground"), the cleanest sign institutions are accumulating
relative to the market. A breakout confirmed by an RS line already at new highs
is far higher quality than one where the RS line lags.

This module distills the RS line into a few JSON-friendly signals off price +
benchmark alone:

  rs_new_high          RS line at a new high over the lookback (leadership)
  rs_pct_from_high     how far the RS line sits below its lookback high (0 = at high)
  rs_rising            RS line above its own 21-period average and sloping up
  rs_line_blue_dot     RS line at new high while price is NOT yet at a new high —
                       O'Neil's "blue dot": leadership ahead of the price breakout
  rs_slope_pct         % change of the RS line over the recent slope window

Everything degrades to ``None``/``False`` on insufficient data; never raises.
"""
from __future__ import annotations

from typing import Dict, Optional

import numpy as np
import pandas as pd

RS_HIGH_LOOKBACK = 252     # ~52 weeks of new-high ground
RS_NEW_HIGH_TOL = 0.005    # within 0.5% of the high counts as "at new high"
RS_SLOPE_BARS = 21         # ~1 month slope window
PRICE_HIGH_TOL = 0.02      # price "at new high" if within 2% of its 252-bar high


def _empty() -> Dict[str, object]:
    return {
        "rs_new_high": False,
        "rs_pct_from_high": None,
        "rs_rising": False,
        "rs_line_blue_dot": False,
        "rs_slope_pct": None,
    }


def compute_rs_line_signals(
    close: Optional[pd.Series],
    benchmark_close: Optional[pd.Series],
    lookback: int = RS_HIGH_LOOKBACK,
) -> Dict[str, object]:
    """Relative-strength-line signals from chronological close + benchmark close."""
    if close is None or benchmark_close is None or len(close) < 60:
        return _empty()

    bench = benchmark_close.reindex(close.index).ffill()
    if bench.isna().all():
        return _empty()
    rs = (close / bench).dropna()
    if len(rs) < 60:
        return _empty()

    win = rs.tail(lookback)
    rs_now = float(rs.iloc[-1])
    rs_high = float(win.max())
    if rs_high <= 0:
        return _empty()
    pct_from_high = (rs_high - rs_now) / rs_high
    rs_new_high = pct_from_high <= RS_NEW_HIGH_TOL

    ema21 = rs.ewm(span=21, adjust=False).mean()
    rising = bool(rs_now > float(ema21.iloc[-1]))
    if len(rs) > RS_SLOPE_BARS:
        prev = float(rs.iloc[-1 - RS_SLOPE_BARS])
        slope_pct = (rs_now / prev - 1.0) * 100.0 if prev > 0 else None
        rising = rising and (slope_pct is not None and slope_pct > 0)
    else:
        slope_pct = None

    # Blue dot: RS line leads price — RS at new high while price is NOT yet there.
    price_win = close.tail(lookback)
    price_high = float(price_win.max())
    price_now = float(close.iloc[-1])
    price_at_high = price_high > 0 and (price_high - price_now) / price_high <= PRICE_HIGH_TOL
    blue_dot = bool(rs_new_high and not price_at_high)

    return {
        "rs_new_high": bool(rs_new_high),
        "rs_pct_from_high": round(float(pct_from_high) * 100.0, 2),
        "rs_rising": bool(rising),
        "rs_line_blue_dot": blue_dot,
        "rs_slope_pct": round(float(slope_pct), 2) if slope_pct is not None and np.isfinite(slope_pct) else None,
    }
