"""Risk & exit plan — the half of Minervini's method most screeners omit.

Minervini is emphatic that the *buy* is only half a trade: the entry, the stop,
and the position size are one decision. "The stop defines the size." This module
turns a candidate's price structure + VCP pivot into a concrete, JSON-friendly
plan the dashboard can show next to the buy signal:

  entry            the actionable buy point (VCP pivot if available, else last close)
  stop_loss        the protective stop — the TIGHTER (higher) of:
                     - the Minervini hard cap: entry * (1 - max_loss_pct)   (~7-8%)
                     - just under the most-recent contraction low (the base's
                       right-side low — a logical place price shouldn't revisit)
  stop_pct         loss % from entry to stop (always <= max_loss_pct)
  risk_per_share   entry - stop_loss, in price terms
  targets          profit objectives at fixed reward:risk multiples (2R, 3R)
  position_size_pct  capital to allocate so that being stopped costs only
                     ``account_risk_pct`` of the account (size = risk_budget / stop%)

Everything degrades to ``None`` on insufficient data; never raises.
"""
from __future__ import annotations

from typing import Dict, Optional

import numpy as np
import pandas as pd

# Minervini's universal backstop: never let a loss exceed ~7-8%.
MAX_LOSS_PCT = 0.08
# Account heat per trade: risking 1.25% of equity per position is a common
# Minervini/O'Neil setting (he flexes 0.5-1.25% with conviction & market health).
ACCOUNT_RISK_PCT = 1.25
# Reward:risk objectives to surface (he targets >= 2-3:1 and sells into strength).
TARGET_R_MULTIPLES = (2.0, 3.0)


def _f(v: object) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def _recent_swing_low(price_data: pd.DataFrame, lookback: int = 15) -> Optional[float]:
    """The right-side base low — the lowest Low over the last ``lookback`` bars,
    the natural place to hide a stop just beneath."""
    if "Low" not in price_data.columns or len(price_data) < lookback:
        return None
    return _f(price_data["Low"].tail(lookback).min())


def compute_risk_plan(
    price_data: Optional[pd.DataFrame],
    pivot: Optional[float] = None,
    max_loss_pct: float = MAX_LOSS_PCT,
    account_risk_pct: float = ACCOUNT_RISK_PCT,
) -> Dict[str, object]:
    """Build an entry/stop/target/size plan from price structure + VCP pivot."""
    empty: Dict[str, object] = {
        "entry": None, "stop_loss": None, "stop_pct": None,
        "risk_per_share": None, "targets": [], "position_size_pct": None,
        "stop_basis": None,
    }
    if price_data is None or "Close" not in getattr(price_data, "columns", []) or len(price_data) < 20:
        return empty

    last = _f(price_data["Close"].iloc[-1])
    if last is None or last <= 0:
        return empty

    # Entry: trade the pivot if we have one and it's near/above price; otherwise
    # the last close (already-extended names just plan from here).
    pivot = _f(pivot)
    entry = pivot if (pivot is not None and pivot > 0) else last

    hard_stop = entry * (1.0 - max_loss_pct)
    swing_low = _recent_swing_low(price_data)
    # Tighten the stop to just under the base low when that's *inside* the hard cap
    # (a closer logical stop = smaller risk). A swing low below the hard cap would
    # exceed the max loss, so it's ignored in favour of the cap.
    if swing_low is not None and hard_stop < swing_low < entry:
        stop_loss = swing_low * 0.999  # a hair under the low
        stop_basis = "base_low"
    else:
        stop_loss = hard_stop
        stop_basis = "max_loss_cap"

    risk_per_share = entry - stop_loss
    if risk_per_share <= 0:
        return empty
    stop_pct = risk_per_share / entry * 100.0

    targets = [
        {
            "r_multiple": r,
            "price": round(entry + r * risk_per_share, 2),
            "gain_pct": round(r * stop_pct, 1),
        }
        for r in TARGET_R_MULTIPLES
    ]
    # Position size so a stop-out costs exactly account_risk_pct of equity:
    #   size%_of_capital = account_risk% / stop%   (capped at 100%)
    position_size_pct = round(min(100.0, account_risk_pct / (stop_pct / 100.0)), 1)

    return {
        "entry": round(entry, 2),
        "stop_loss": round(stop_loss, 2),
        "stop_pct": round(stop_pct, 2),
        "risk_per_share": round(risk_per_share, 2),
        "targets": targets,
        "position_size_pct": position_size_pct,
        "stop_basis": stop_basis,
    }
