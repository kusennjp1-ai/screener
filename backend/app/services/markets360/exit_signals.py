"""Sell-timing engine — the exit half of Minervini's SEPA method.

Minervini's exits come in exactly two flavours, and a complete system needs
both plus a rule for ratcheting the stop in between:

  1. **Sell into strength** (climax run): after an extended Stage-2 advance the
     stock goes parabolic — this is where Minervini unloads while buyers still
     pay up. Public tells (Momentum Masters / Think & Trade Like a Champion):
       - price stretched far above the 200-DMA (leaders top 70-100% above it)
       - 8+ up days out of 10 after an extended move
       - the largest single-day gain of the whole advance appearing late
       - an exhaustion gap after the stock is already extended
  2. **Sell into weakness** (trend invalidation): a close below the 50-DMA on
     expanding volume — delegated to ``signals.detect_50dma_breakdown`` so the
     two callers can never disagree.
  3. **Trailing-stop ladder**: as the trade earns R-multiples, the stop only
     ever moves UP:
       < 1R   initial stop stands (the trade hasn't earned a tighter leash)
       >= 1R  cut the open risk in half (stop -> entry - 0.5R)
       >= 2R  breakeven (stop -> entry): the trade can no longer lose money
       >= 3R  lock gains: stop -> at least entry + 1R, raised further to the
              higher of the 50-DMA and the 20-bar swing low when those sit above

``compute_sell_plan`` merges all three into one JSON-friendly dict with a
single ``action`` resolved by precedence:
    exit > sell_into_strength > tighten_stop > raise_stop_* > hold

Everything degrades gracefully on missing data; never raises.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from .signals import detect_50dma_breakdown

logger = logging.getLogger(__name__)

# --- climax-run thresholds (documented public heuristics) --------------------
# Leaders typically top 70-100% above the 200-DMA (Minervini, O'Neil).
CLIMAX_EXT_200DMA_PCT = 70.0
# 8-of-10 up days after an extended advance marks a buying frenzy.
CLIMAX_UP_DAYS = 8
# A single-day gain this large, late in an advance, is an exhaustion tell.
CLIMAX_LARGEST_GAIN_PCT = 5.0
# Opening gap size that counts as an exhaustion gap once extended.
CLIMAX_GAP_PCT = 2.0
# "Extended" prerequisite for the frenzy tells: >= 25% above the 50-DMA.
EXTENDED_ABOVE_50DMA_PCT = 25.0
# How many recent bars the late-stage tells are searched over.
CLIMAX_RECENT_BARS = 5

# --- trailing ladder rungs ----------------------------------------------------
LADDER_HALF_RISK_R = 1.0
LADDER_BREAKEVEN_R = 2.0
LADDER_LOCK_GAINS_R = 3.0


def _f(v: object) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def detect_climax_run(price_data: Optional[pd.DataFrame]) -> Dict[str, object]:
    """Score sell-into-strength (climax) tells on the latest bars.

    Returns ``{active, score, flags: [str], extension_200dma_pct, up_days_10}``.
    ``score`` is 0-100; ``active`` when the stock is extended AND at least two
    independent frenzy tells fire together (one tell alone is just strength).
    """
    out: Dict[str, object] = {
        "active": False, "score": 0, "flags": [],
        "extension_200dma_pct": None, "up_days_10": None,
    }
    try:
        if (
            price_data is None
            or "Close" not in getattr(price_data, "columns", [])
            or len(price_data) < 60
        ):
            return out
        close = price_data["Close"]
        last = float(close.iloc[-1])
        flags: List[str] = []
        score = 0.0

        # Extension above the 200-DMA (or full mean when history is short).
        ma200 = float(close.iloc[-200:].mean()) if len(close) >= 200 else float(close.mean())
        ext_200 = (last / ma200 - 1.0) * 100.0 if ma200 > 0 else None
        if ext_200 is not None:
            out["extension_200dma_pct"] = round(ext_200, 1)

        # Prerequisite: the advance must already be extended before frenzy
        # tells mean "climax" rather than "healthy breakout".
        ma50 = float(close.iloc[-50:].mean()) if len(close) >= 50 else float(close.mean())
        ext_50 = (last / ma50 - 1.0) * 100.0 if ma50 > 0 else 0.0
        extended = ext_50 >= EXTENDED_ABOVE_50DMA_PCT or (
            ext_200 is not None and ext_200 >= CLIMAX_EXT_200DMA_PCT
        )

        if ext_200 is not None and ext_200 >= CLIMAX_EXT_200DMA_PCT:
            flags.append("extended_above_200dma")
            score += 30

        # Up-day frenzy: 8+ up days in the last 10.
        rets = close.pct_change()
        up_10 = int((rets.iloc[-10:] > 0).sum()) if len(rets) >= 10 else None
        out["up_days_10"] = up_10
        if extended and up_10 is not None and up_10 >= CLIMAX_UP_DAYS:
            flags.append("up_day_frenzy")
            score += 25

        # Largest daily gain of the visible advance arriving in the last bars.
        if extended and len(rets.dropna()) >= 30:
            recent_max = float(rets.iloc[-CLIMAX_RECENT_BARS:].max()) * 100.0
            prior_max = float(rets.iloc[:-CLIMAX_RECENT_BARS].max()) * 100.0
            if recent_max >= CLIMAX_LARGEST_GAIN_PCT and recent_max > prior_max:
                flags.append("largest_up_day_late")
                score += 25

        # Exhaustion gap: a big opening gap up while already extended.
        if (
            extended
            and "Open" in price_data.columns
            and len(price_data) >= CLIMAX_RECENT_BARS + 1
        ):
            opens = price_data["Open"].iloc[-CLIMAX_RECENT_BARS:]
            prev_closes = close.shift(1).iloc[-CLIMAX_RECENT_BARS:]
            gaps = (opens / prev_closes - 1.0) * 100.0
            if float(gaps.max()) >= CLIMAX_GAP_PCT:
                flags.append("exhaustion_gap")
                score += 20

        out["flags"] = flags
        out["score"] = int(min(100, round(score)))
        # One tell is strength; two or more together (while extended) is climax.
        out["active"] = bool(extended and len(flags) >= 2)
        return out
    except Exception:  # noqa: BLE001 - sell tells must never break the payload
        logger.warning("climax-run detection failed", exc_info=True)
        return out


def compute_trailing_stop(
    price_data: Optional[pd.DataFrame],
    entry: Optional[float],
    initial_stop: Optional[float],
) -> Dict[str, object]:
    """Ratchet the protective stop up as the trade earns R-multiples.

    The stop NEVER moves down. Returns ``{r_multiple, stop, basis, raised}``;
    all-None when entry/stop context is missing or risk is non-positive.
    """
    out: Dict[str, object] = {"r_multiple": None, "stop": None, "basis": None, "raised": False}
    entry, initial_stop = _f(entry), _f(initial_stop)
    if (
        price_data is None
        or "Close" not in getattr(price_data, "columns", [])
        or len(price_data) < 2
        or entry is None
        or initial_stop is None
    ):
        return out
    risk = entry - initial_stop
    if risk <= 0 or entry <= 0:
        return out

    last = _f(price_data["Close"].iloc[-1])
    if last is None:
        return out
    r_mult = (last - entry) / risk
    out["r_multiple"] = round(r_mult, 2)

    if r_mult >= LADDER_LOCK_GAINS_R:
        stop = entry + risk  # lock at least +1R
        basis = "lock_1r"
        # Trail higher when structure allows: 50-DMA or the 20-bar swing low.
        close = price_data["Close"]
        candidates = []
        if len(close) >= 50:
            candidates.append((float(close.iloc[-50:].mean()), "trail_50dma"))
        if "Low" in price_data.columns and len(price_data) >= 20:
            candidates.append((float(price_data["Low"].iloc[-20:].min()) * 0.999, "trail_20bar_low"))
        for level, name in candidates:
            if stop < level < last:
                stop, basis = level, name
    elif r_mult >= LADDER_BREAKEVEN_R:
        stop, basis = entry, "breakeven"
    elif r_mult >= LADDER_HALF_RISK_R:
        stop, basis = entry - 0.5 * risk, "half_risk"
    else:
        stop, basis = initial_stop, "initial"

    stop = max(stop, initial_stop)  # a ladder only ever raises the stop
    out["stop"] = round(stop, 2)
    out["basis"] = basis
    out["raised"] = bool(stop > initial_stop)
    return out


def compute_sell_plan(
    price_data: Optional[pd.DataFrame],
    entry: Optional[float] = None,
    initial_stop: Optional[float] = None,
) -> Dict[str, object]:
    """The unified sell decision for one symbol (informational — never trades).

    Merges the 50-DMA breakdown, the climax-run score, and the trailing-stop
    ladder into one dict with a single ``action``:

      exit                 trend invalidated (mature breakdown on volume)
      sell_into_strength   climax tells clustered while extended — unload strength
      tighten_stop         breakdown on a young/shallow break
      raise_stop           the R-ladder moved the stop up
      hold                 nothing actionable
    """
    breakdown = detect_50dma_breakdown(price_data, entry_price=entry) if price_data is not None else None
    climax = detect_climax_run(price_data)
    trail = compute_trailing_stop(price_data, entry, initial_stop)

    if breakdown and breakdown.get("recommended_action") == "exit":
        action = "exit"
    elif climax.get("active"):
        action = "sell_into_strength"
    elif breakdown and breakdown.get("recommended_action") == "tighten_stop":
        action = "tighten_stop"
    elif trail.get("raised"):
        action = "raise_stop"
    else:
        action = "hold"

    return {
        "action": action,
        "climax": climax,
        "breakdown": breakdown,
        "trailing": trail,
    }
