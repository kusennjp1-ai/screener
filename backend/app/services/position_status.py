"""Live status for one open position — Minervini trade management on read.

Given the position's entry/stop and the cached OHLCV, this reuses the
Markets 360 sell engine so the positions view and the Markets 360 sell card
can never disagree:

  - ``compute_sell_plan``: 50-DMA breakdown, climax-run tells, trailing-stop
    ladder, merged into one ``action`` (exit / sell_into_strength /
    tighten_stop / raise_stop / hold)
  - ``r_multiple_targets``: the 2R/3R objectives off the ORIGINAL risk unit

Pure computation — no I/O; the API layer loads prices (cache-only) and stores.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

import numpy as np
import pandas as pd

from app.services.markets360.exit_signals import compute_sell_plan
from app.services.markets360.risk import r_multiple_targets


def _f(v: object) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def compute_position_status(
    price_df: Optional[pd.DataFrame],
    entry_price: Optional[float],
    initial_stop: Optional[float],
) -> Dict[str, Any]:
    """Everything the positions table shows for one open position.

    Returns ``{last_close, last_date, pnl_pct, r_multiple, action, sell_plan,
    targets, stale}``; degrades to Nones (action ``no_data``) when no cached
    prices exist — it must never raise, a dead symbol shouldn't kill the list.
    """
    out: Dict[str, Any] = {
        "last_close": None,
        "last_date": None,
        "pnl_pct": None,
        "r_multiple": None,
        "action": "no_data",
        "sell_plan": None,
        "targets": [],
    }
    entry = _f(entry_price)
    if (
        price_df is None
        or getattr(price_df, "empty", True)
        or "Close" not in getattr(price_df, "columns", [])
        or entry is None
        or entry <= 0
    ):
        return out

    try:
        last_close = _f(price_df["Close"].iloc[-1])
        if last_close is None:
            return out
        out["last_close"] = round(last_close, 2)
        idx = price_df.index[-1]
        out["last_date"] = str(getattr(idx, "date", lambda: idx)())
        out["pnl_pct"] = round((last_close - entry) / entry * 100.0, 2)

        stop = _f(initial_stop)
        sell_plan = compute_sell_plan(price_df, entry=entry, initial_stop=stop)
        out["sell_plan"] = sell_plan
        out["action"] = sell_plan.get("action", "hold")
        trailing = sell_plan.get("trailing") or {}
        out["r_multiple"] = trailing.get("r_multiple")
        if stop is not None:
            out["targets"] = r_multiple_targets(entry, stop)
        return out
    except Exception:  # noqa: BLE001 - one bad symbol must not break the list
        return out
