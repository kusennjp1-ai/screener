"""
Markets 360 — buy-signal engine.

Reproduces the staged buy annotations and the "Buying Now!" card seen on a
Minervini Markets 360 chart. MM360's exact trigger logic is proprietary; this
is a documented, self-contained approximation grounded in Minervini's public
SEPA® methodology:

  * ``buy_alert``  — price is approaching a VCP pivot from 3–8% below: a base is
    setting up but has not triggered.
  * ``buy_ready``  — price is within 3% under the pivot with volume drying up:
    the breakout is imminent.
  * ``sepa_buy_point`` — a Stage-2 breakout through the pivot on expanding
    volume (the classic SEPA pivot buy).
  * ``triple_barrel`` — the strongest, "Buying Now!" state: three *independent*
    confirmations fire on the same bar:
        1. Trend barrel    — Trend Template strong (price > 50 > 150 > 200, rising).
        2. Pressure barrel — accumulation pressure is positive (AD-line rising).
        3. Breakout barrel — a fresh pivot breakout on volume with low buy-risk.

The card carries a protective ``stop`` estimated Minervini-style: the breakout
base low, floored at a max tolerable loss from the trigger price.

Everything is defensive — a charting aid must never raise.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# How recent (in bars) the latest breakout must be for the card to read
# "Buying Now!" rather than a historical annotation.
ACTIVE_WINDOW_BARS = 5

# Max tolerable loss from the trigger when the base low would imply a wider stop.
MAX_STOP_LOSS_PCT = 0.10

# Volume expansion multiple that qualifies a breakout bar. Minervini/IBD confirm
# a breakout on volume ~40-50% above average; the canonical line is 1.5x. Kept in
# lockstep with chart.py's overlay threshold so the card and the chart agree.
BREAKOUT_VOL_MULT = 1.5


# 50-DMA breakdown sell signal: a close below the 50-DMA on volume expansion is
# Minervini's primary trend-invalidation tell once a name is extended in Stage 2.
BREAKDOWN_VOL_MULT = 1.3
# Don't cry "exit" on a fresh position breaking down on an isolated bar — give a
# new buy room (Minervini's "the first pullback to the 50-DMA is normal").
MIN_HOLD_FOR_EXIT_BARS = 5


def detect_50dma_breakdown(
    price_data: pd.DataFrame,
    *,
    entry_price: Optional[float] = None,
    position_days_open: int = 0,
) -> Dict[str, object]:
    """Detect a Minervini 50-DMA trend-invalidation breakdown.

    A close below the 50-day SMA on volume >= ``BREAKDOWN_VOL_MULT`` x its 50-day
    average is the classic "the trend has broken" sell tell once a leader is
    extended. This NEVER auto-liquidates — it informs. The recommended action is
    graduated by position maturity (a brand-new buy gets room; a mature position
    that breaks down on volume is told to exit):

      none          no breakdown
      tighten_stop  breakdown, but the position is young / the break is shallow
      exit          a clear breakdown on a matured position

    Returns a JSON-friendly dict; ``breakdown_detected`` False (action 'none')
    on insufficient data. Never raises.
    """
    out: Dict[str, object] = {
        "breakdown_detected": False, "breakdown_price": None, "breakdown_date": None,
        "volume_multiple": None, "below_50dma": None, "recommended_action": "none",
        "confidence": 0.0,
    }
    try:
        if price_data is None or "Close" not in getattr(price_data, "columns", []) or len(price_data) < 50:
            return out
        close = price_data["Close"]
        sma50 = close.rolling(50).mean()
        last_close = float(close.iloc[-1])
        last_sma = float(sma50.iloc[-1])
        if not np.isfinite(last_sma) or last_sma <= 0:
            return out
        below = last_close < last_sma
        out["below_50dma"] = bool(below)

        vol_mult = None
        if "Volume" in price_data.columns and len(price_data) >= 51:
            avg = float(price_data["Volume"].iloc[-51:-1].mean())
            if avg > 0:
                vol_mult = round(float(price_data["Volume"].iloc[-1]) / avg, 2)
                out["volume_multiple"] = vol_mult

        on_volume = vol_mult is not None and vol_mult >= BREAKDOWN_VOL_MULT
        if not (below and on_volume):
            return out

        out["breakdown_detected"] = True
        out["breakdown_price"] = round(last_close, 2)
        ts = price_data.index[-1]
        out["breakdown_date"] = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else None

        # Depth below the 50-DMA scales confidence; volume adds to it.
        depth = (last_sma - last_close) / last_sma
        confidence = min(0.95, 0.45 + depth * 6.0 + max(0.0, vol_mult - BREAKDOWN_VOL_MULT) * 0.15)
        out["confidence"] = round(float(confidence), 2)

        young = position_days_open and 0 < position_days_open < MIN_HOLD_FOR_EXIT_BARS
        # A young position, or a still-profitable one on a shallow break, gets a
        # tighten-stop rather than a hard exit.
        in_profit = entry_price is not None and entry_price > 0 and last_close > entry_price
        if young or (in_profit and depth < 0.02):
            out["recommended_action"] = "tighten_stop"
        else:
            out["recommended_action"] = "exit"
        return out
    except Exception:  # noqa: BLE001 - sell signal must never break the payload
        logger.warning("50-DMA breakdown detection failed", exc_info=True)
        return out


def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high, low, close = df["High"], df["Low"], df["Close"]
    tr = pd.concat(
        [high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


def compute_buy_signal(
    price_data: pd.DataFrame,
    *,
    buy_points: Optional[List[Dict]] = None,
    pressure_state: Optional[str] = None,
    tpr_state: Optional[str] = None,
    buy_risk_state: Optional[str] = None,
    author: str = "Mark Minervini",
) -> Dict[str, object]:
    """Decide the current buy-signal card from the latest bar context.

    Args:
        price_data: OHLCV DataFrame (DatetimeIndex; Open/High/Low/Close/Volume).
        buy_points: the chart's computed ``[{time,type,price}]`` annotations.
            The most recent breakout drives the card.
        pressure_state / tpr_state / buy_risk_state: current band states, reused
            so the engine and the bands agree.
        author: attribution shown on the card.

    Returns a dict shaped for the schema's ``signal`` block; ``active`` is False
    when no fresh trigger is present.
    """
    inactive = {"active": False, "type": None, "label": None}
    if price_data is None or getattr(price_data, "empty", True) or len(price_data) < 60:
        return inactive
    if "Close" not in price_data.columns:
        return inactive

    try:
        close = price_data["Close"]
        last_close = float(close.iloc[-1])
        last_date = price_data.index[-1]

        # The freshest breakout annotation, if any, anchors the card.
        latest_breakout = _latest_breakout(price_data, buy_points)

        # Three independent confirmation "barrels" on the latest bar.
        trend_ok = tpr_state == "strong"
        pressure_ok = pressure_state == "buy"
        # Anchor the breakout to the VCP contraction high when the chart has a
        # fresh VCP-detected pivot (Minervini buys the pivot out of the base, not
        # a detached 30-bar high). Falls back to the 30-bar pivot when no VCP.
        vcp_pivot = None
        if latest_breakout is not None and _is_recent(latest_breakout["idx"], len(close)):
            vcp_pivot = latest_breakout.get("price")
        breakout_ok, trigger_price, base_low = _breakout_now(price_data, vcp_pivot=vcp_pivot)
        risk_ok = buy_risk_state in ("low", "medium")

        barrels = {
            "trend": bool(trend_ok),
            "pressure": bool(pressure_ok),
            "breakout": bool(breakout_ok and risk_ok),
        }
        barrels_passed = sum(barrels.values())

        # Pick the strongest applicable state.
        if barrels_passed == 3:
            sig_type = "triple_barrel"
            label = "Triple Barrel Behavioral Analytic Buy Signal"
        elif latest_breakout and _is_recent(latest_breakout["idx"], len(close)):
            sig_type = latest_breakout["type"]
            label = (
                "SEPA Buy Point"
                if sig_type == "sepa_buy_point"
                else "Buy Point"
                if sig_type == "buy_point"
                else "Buy Ready"
                if sig_type == "buy_ready"
                else "Buy Alert"
            )
        else:
            return {**inactive, "barrels": barrels, "barrels_passed": barrels_passed}

        # Active only when the trigger is fresh.
        active = sig_type == "triple_barrel" or (
            latest_breakout is not None and _is_recent(latest_breakout["idx"], len(close))
        )

        trigger = trigger_price or (latest_breakout["price"] if latest_breakout else last_close)
        stop = _estimate_stop(price_data, trigger=trigger, base_low=base_low or (
            latest_breakout.get("base_low") if latest_breakout else None
        ))

        # Reward:risk targets (2R/3R) off the card's own trigger/stop — SEPA
        # demands a defined R-multiple at entry. Single source of truth in risk.py.
        from app.services.markets360.risk import r_multiple_targets

        targets = r_multiple_targets(trigger, stop) if (trigger and stop is not None) else []

        return {
            "active": bool(active),
            "type": sig_type,
            "label": label,
            "headline": "Buying Now!" if active else "Watch",
            "author": author,
            "as_of": last_date.strftime("%Y-%m-%dT%H:%M:%S") if hasattr(last_date, "strftime") else None,
            "trigger_price": round(float(trigger), 2) if trigger else None,
            "stop": round(float(stop), 2) if stop is not None else None,
            "risk_pct": (
                round((trigger - stop) / trigger * 100.0, 1)
                if (trigger and stop and trigger > 0)
                else None
            ),
            "targets": targets,
            "target_price_2r": next((t["price"] for t in targets if t["r_multiple"] == 2.0), None),
            "target_price_3r": next((t["price"] for t in targets if t["r_multiple"] == 3.0), None),
            "barrels": barrels,
            "barrels_passed": barrels_passed,
        }
    except Exception:  # noqa: BLE001 - signal card must never break the payload
        logger.warning("buy-signal computation failed", exc_info=True)
        return inactive


def _latest_breakout(price_data: pd.DataFrame, buy_points: Optional[List[Dict]]) -> Optional[Dict]:
    """Resolve the most recent breakout annotation to a bar index + price."""
    if not buy_points:
        return None
    breakout_types = ("triple_barrel", "sepa_buy_point", "buy_point", "buy_ready", "buy_alert")
    date_to_idx = {ts.strftime("%Y-%m-%d"): i for i, ts in enumerate(price_data.index)}
    best: Optional[Dict] = None
    for bp in buy_points:
        if bp.get("type") not in breakout_types:
            continue
        idx = date_to_idx.get(bp.get("time"))
        if idx is None:
            continue
        if best is None or idx > best["idx"]:
            best = {
                "idx": idx, "type": bp["type"], "price": bp.get("price"),
                "time": bp.get("time"), "base_low": bp.get("base_low"),
            }
    return best


def _is_recent(idx: int, n: int) -> bool:
    return (n - 1 - idx) <= ACTIVE_WINDOW_BARS


def _breakout_now(
    price_data: pd.DataFrame, vcp_pivot: Optional[float] = None
) -> tuple[bool, Optional[float], Optional[float]]:
    """Did a fresh pivot breakout fire within the active window?

    A breakout = close clearing the pivot on volume expansion, with the bar
    before still under it. The pivot is the VCP contraction high (``vcp_pivot``)
    when supplied — Minervini's actual buy point — otherwise the prior ~30-bar
    consolidation high. Returns ``(ok, pivot_price, base_low)``.
    """
    if len(price_data) < 40:
        return (False, None, None)
    close = price_data["Close"]
    high = price_data["High"]
    vol = price_data["Volume"] if "Volume" in price_data.columns else None
    avgvol = vol.rolling(50).mean() if vol is not None else None

    n = len(close)
    for i in range(n - 1, max(n - 1 - ACTIVE_WINDOW_BARS, 0) - 1, -1):
        if i < 31:
            continue
        # VCP-anchored pivot when available; else the 30-bar consolidation high.
        pivot = float(vcp_pivot) if (vcp_pivot is not None and vcp_pivot > 0) else float(high.iloc[i - 30:i].max())
        base_low = float(price_data["Low"].iloc[i - 30:i].min())
        crossed = float(close.iloc[i]) > pivot and float(close.iloc[i - 1]) <= pivot
        vol_ok = (
            avgvol is not None
            and not pd.isna(avgvol.iloc[i])
            and float(avgvol.iloc[i]) > 0
            and float(vol.iloc[i]) >= BREAKOUT_VOL_MULT * float(avgvol.iloc[i])
        )
        if crossed and vol_ok:
            return (True, pivot, base_low)
    return (False, None, None)


def _estimate_stop(
    price_data: pd.DataFrame, *, trigger: Optional[float], base_low: Optional[float]
) -> Optional[float]:
    """Minervini-style protective stop: the base low, floored at a max loss.

    Prefer the breakout base's low (a logical violation point). If that would
    risk more than ``MAX_STOP_LOSS_PCT`` from the trigger, tighten to that cap.
    Falls back to ~1.5 ATR under the trigger when no base low is available.
    """
    if trigger is None or trigger <= 0:
        return None
    floor = trigger * (1.0 - MAX_STOP_LOSS_PCT)
    if base_low is not None and base_low > 0:
        return max(float(base_low), floor)
    try:
        atr = float(_atr(price_data).iloc[-1])
        if np.isfinite(atr) and atr > 0:
            return max(trigger - 1.5 * atr, floor)
    except Exception:  # noqa: BLE001
        pass
    return floor
