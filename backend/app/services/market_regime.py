"""General-market regime assessment — Minervini's first rule.

Minervini/O'Neil: *only buy when the general market is in a confirmed uptrend, and
scale exposure to market health.* This module scores the market from the index
(benchmark) OHLCV alone — no external feed — so the screener can gate and
down-weight buy signals by regime.

Signals (all from the index daily OHLCV):
- Trend: close > 50DMA > 200DMA with a rising 50DMA  (the index in its own Stage 2)
- Distribution days: O'Neil's institutional-selling tell — index down >= 0.2% on
  volume above the prior session, counted over the last ~25 sessions. 5+ = under
  pressure, 6+ = topping/correction risk.
- Position vs the 21EMA / 50DMA and drawdown from the recent high.

Output is a label, a 0-100 health score, and a suggested equity exposure %, which
the screener maps onto each candidate.
"""
from __future__ import annotations

from typing import Dict, Optional

import numpy as np
import pandas as pd

DIST_WINDOW = 25            # sessions to count distribution days over
DIST_DOWN_PCT = -0.002      # a down day of >= 0.2% counts
DIST_UNDER_PRESSURE = 4     # >= this many = uptrend under pressure
DIST_CORRECTION = 6         # >= this many = distribution-driven correction risk

REGIME_EXPOSURE = {
    "confirmed_uptrend": 100,
    "uptrend_under_pressure": 55,
    "correction": 20,
    "downtrend": 0,
}


def _distribution_days(close: pd.Series, volume: pd.Series, window: int = DIST_WINDOW) -> int:
    ret = close.pct_change(fill_method=None)
    vol_up = volume > volume.shift(1)
    dist = (ret <= DIST_DOWN_PCT) & vol_up
    return int(dist.tail(window).sum())


def assess_market_regime(index_ohlcv: Optional[pd.DataFrame]) -> Dict[str, object]:
    """Assess the general-market regime from the index/benchmark OHLCV.

    Returns: {regime, health (0-100), exposure_pct (0-100), distribution_days,
    above_50dma, above_200dma, fifty_above_200, pct_from_high, components}.
    All keys are None/empty when there is insufficient data.
    """
    empty = {
        "regime": None, "health": None, "exposure_pct": None,
        "distribution_days": None, "above_50dma": None, "above_200dma": None,
        "fifty_above_200": None, "pct_from_high": None,
    }
    if index_ohlcv is None or "Close" not in getattr(index_ohlcv, "columns", []) or len(index_ohlcv) < 200:
        return empty

    close = index_ohlcv["Close"]
    volume = index_ohlcv["Volume"] if "Volume" in index_ohlcv.columns else pd.Series(1.0, index=close.index)
    sma50 = close.rolling(50).mean()
    sma200 = close.rolling(200).mean()
    ema21 = close.ewm(span=21, adjust=False).mean()

    c = float(close.iloc[-1])
    s50, s200 = float(sma50.iloc[-1]), float(sma200.iloc[-1])
    s50_rising = bool(sma50.iloc[-1] > sma50.iloc[-21]) if len(sma50.dropna()) > 21 else True
    above_50 = c > s50
    above_200 = c > s200
    fifty_above_200 = s50 > s200
    above_21 = c > float(ema21.iloc[-1])
    hi = float(close.tail(252).max())
    pct_from_high = (hi - c) / hi if hi > 0 else 0.0
    dist = _distribution_days(close, volume)

    trend_ok = above_50 and fifty_above_200 and s50_rising and above_200

    if trend_ok and dist < DIST_UNDER_PRESSURE:
        regime = "confirmed_uptrend"
    elif trend_ok and dist < DIST_CORRECTION:
        regime = "uptrend_under_pressure"
    elif above_200 and not (c < s200 and s50 < s200):
        # above the 200DMA but trend not clean, or distribution piling up
        regime = "correction" if (dist >= DIST_CORRECTION or not above_50) else "uptrend_under_pressure"
    else:
        regime = "downtrend"

    # 0-100 health: trend structure (50) + distribution penalty (30) + drawdown (20).
    health = 0.0
    health += 25 if above_200 else 0
    health += 10 if fifty_above_200 else 0
    health += 8 if above_50 else 0
    health += 7 if above_21 else 0
    health += max(0.0, 30.0 * (1.0 - dist / float(DIST_CORRECTION + 2)))
    health += max(0.0, 20.0 * (1.0 - pct_from_high / 0.15))  # full marks within ~0% of high, 0 at >=15% off
    health = float(max(0.0, min(100.0, health)))

    return {
        "regime": regime,
        "health": round(health, 1),
        "exposure_pct": REGIME_EXPOSURE[regime],
        "distribution_days": dist,
        "above_50dma": above_50,
        "above_200dma": above_200,
        "fifty_above_200": fifty_above_200,
        "pct_from_high": round(float(pct_from_high) * 100, 2),
        "components": {
            "trend_ok": trend_ok, "above_21ema": above_21, "fifty_rising": s50_rising,
        },
    }
