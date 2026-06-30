"""Early-entry technical signals — pocket pivot, power trend, volume surge.

These are the actionable entry tells Minervini and Gil Morales use to time a buy
inside or just out of a base. The definitions mirror the (well-tested) ones in
``app.scanners.minervini_scanner`` but are repackaged here as a pure, chronological
calculator the Markets 360 screener can reuse without importing that scanner's
data plumbing.

  pocket_pivot   an up day whose volume exceeds the largest down-day volume of the
                 prior 10 sessions, with price holding above the 50DMA (Morales/
                 O'Neil early in-base entry). Needs >= 1 prior down day.
  power_trend    Minervini's "power trend": close > 21EMA > 50SMA, 50SMA rising,
                 and 10+ consecutive closes above the 21EMA — a strong, intact
                 Stage-2 advance.
  volume_surge   today's volume / its 50-day average (institutional footprint).

Everything degrades to ``None`` on insufficient data; never raises.
"""
from __future__ import annotations

from typing import Dict, Optional

import numpy as np
import pandas as pd


def compute_entry_signals(price_data: Optional[pd.DataFrame]) -> Dict[str, object]:
    """Compute pocket-pivot / power-trend / volume-surge from chronological OHLCV."""
    out: Dict[str, object] = {
        "pocket_pivot": None, "power_trend": None, "volume_surge": None,
    }
    if (
        price_data is None
        or "Close" not in getattr(price_data, "columns", [])
        or len(price_data) < 12
    ):
        return out

    close = price_data["Close"]
    volume = price_data["Volume"] if "Volume" in price_data.columns else None
    current_price = float(close.iloc[-1])
    ma_50 = float(close.iloc[-50:].mean()) if len(close) >= 50 else float(close.mean())

    # Volume surge: today vs trailing 50-day average.
    if volume is not None and len(volume) >= 51:
        avg_50 = float(volume.iloc[-51:-1].mean())
        if avg_50 > 0:
            out["volume_surge"] = round(float(volume.iloc[-1]) / avg_50, 2)

    # Pocket pivot: up day clearing the largest prior-10-day down-volume, above 50DMA.
    if volume is not None and len(close) >= 12 and len(volume) >= 12:
        is_up_day = current_price > float(close.iloc[-2])
        prior_down_volumes = [
            float(volume.iloc[-i])
            for i in range(2, 12)
            if float(close.iloc[-i]) < float(close.iloc[-i - 1])
        ]
        if not prior_down_volumes:
            out["pocket_pivot"] = False
        else:
            out["pocket_pivot"] = bool(
                is_up_day
                and float(volume.iloc[-1]) > max(prior_down_volumes)
                and current_price >= ma_50
            )

    # Power trend: close > 21EMA > 50SMA, 50SMA rising, 10 closes above 21EMA.
    if len(close) >= 60:
        ema21 = close.ewm(span=21, adjust=False).mean()
        ema21_last = float(ema21.iloc[-1])
        ma_50_prior = float(close.iloc[-55:-5].mean())
        closes_above_21 = bool((close.iloc[-10:] > ema21.iloc[-10:]).all())
        out["power_trend"] = bool(
            current_price > ema21_last
            and ema21_last > ma_50
            and ma_50 > ma_50_prior
            and closes_above_21
        )

    return out
