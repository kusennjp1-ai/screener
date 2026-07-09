"""
Minervini fundamental bonus — bounded score add-on from cached fundamentals.

SEPA treats technicals as the final arbiter: the Trend Template decides WHAT
is buyable, fundamentals decide WHICH template passers deserve the top of the
list. This module encodes Minervini's own fundamental priorities (with
O'Neil/IBD thresholds where he defers to them) as a capped BONUS:

  1. Code 33 — EPS + sales + margin all accelerating 3 straight quarters
     (Think & Trade Like a Champion). His single most important earnings
     signal; measured +4.0pp catch-rate edge vs control on his own trades.
  2. Quarterly EPS growth — O'Neil "C": >= 25% required, >= 40% ideal.
  3. Quarterly sales growth — earnings must be confirmed by revenue,
     not buybacks/cost cuts (>= 25% strong, >= 10% supportive).
  4. ROE >= 17% — O'Neil/IBD quality floor Minervini cites.
  5. EPS Rating >= 80 — IBD's published buy minimum.

Design contract (frozen-metric safety):
- Pure function of the fundamentals payload; NEVER touches passes_template,
  Stage-2, or setup detection.
- Missing payload or missing fields are NEUTRAL (0 points) — a stock is
  never penalized for data we don't have.
- Total capped at +10 so fundamentals can re-rank template passers but can
  never substitute for price action (base score stays 0-100 dominated).
- The 908-trade harness runs with fundamentals=None, so this bonus is 0
  there by construction and MSCORE is unchanged.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

MAX_FUNDAMENTAL_BONUS = 10.0


def _as_float(value: Any) -> Optional[float]:
    try:
        if value is None or isinstance(value, bool):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_roe_pct(roe: Optional[float]) -> Optional[float]:
    """Normalize ROE to percent.

    finviz (production weekly bundle) stores percent (e.g. 23.4); the legacy
    yfinance fallback stores a fraction (e.g. 0.234). Values in (0, 1) can't
    plausibly be a qualifying percent (17% floor), so read them as fractions.
    """
    if roe is None:
        return None
    if 0 < roe < 1:
        return roe * 100.0
    return roe


def compute_fundamental_bonus(fundamentals: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute the capped Minervini fundamental bonus.

    Args:
        fundamentals: consolidated fundamentals cache payload (or None).

    Returns:
        {"bonus": float, "max_bonus": 10.0, "available": bool,
         "components": {name: {"points": float, "value": Any, "met": bool|None}}}
        ``met`` is None when the input was missing (neutral, not a failure).
    """
    components: Dict[str, Dict[str, Any]] = {}
    bonus = 0.0
    any_input = False

    payload = fundamentals or {}

    # 1. Code 33 (earnings acceleration) — highest-weight signal.
    code33 = payload.get("code33")
    if isinstance(code33, bool):
        any_input = True
        points = 4.0 if code33 else 0.0
        components["code33"] = {"points": points, "value": code33, "met": code33}
        bonus += points
    else:
        components["code33"] = {"points": 0.0, "value": None, "met": None}

    # 2. Quarterly EPS growth YoY (percent, O'Neil "C" thresholds).
    eps_qq = _as_float(payload.get("eps_growth_qq") or payload.get("eps_growth_quarterly"))
    if eps_qq is not None:
        any_input = True
        if eps_qq >= 40:
            points = 2.5
        elif eps_qq >= 25:
            points = 1.5
        else:
            points = 0.0
        components["eps_growth_qq"] = {"points": points, "value": eps_qq, "met": eps_qq >= 25}
        bonus += points
    else:
        components["eps_growth_qq"] = {"points": 0.0, "value": None, "met": None}

    # 3. Quarterly sales growth YoY (percent) — revenue confirmation.
    sales_qq = _as_float(payload.get("sales_growth_qq"))
    if sales_qq is not None:
        any_input = True
        if sales_qq >= 25:
            points = 1.5
        elif sales_qq >= 10:
            points = 0.5
        else:
            points = 0.0
        components["sales_growth_qq"] = {"points": points, "value": sales_qq, "met": sales_qq >= 10}
        bonus += points
    else:
        components["sales_growth_qq"] = {"points": 0.0, "value": None, "met": None}

    # 4. ROE >= 17% (unit-normalized).
    roe = _normalize_roe_pct(_as_float(payload.get("roe")))
    if roe is not None:
        any_input = True
        points = 1.0 if roe >= 17 else 0.0
        components["roe"] = {"points": points, "value": round(roe, 2), "met": roe >= 17}
        bonus += points
    else:
        components["roe"] = {"points": 0.0, "value": None, "met": None}

    # 5. EPS Rating >= 80 (IBD buy minimum).
    eps_rating = _as_float(payload.get("eps_rating"))
    if eps_rating is not None:
        any_input = True
        points = 1.0 if eps_rating >= 80 else 0.0
        components["eps_rating"] = {"points": points, "value": eps_rating, "met": eps_rating >= 80}
        bonus += points
    else:
        components["eps_rating"] = {"points": 0.0, "value": None, "met": None}

    return {
        "bonus": round(min(bonus, MAX_FUNDAMENTAL_BONUS), 2),
        "max_bonus": MAX_FUNDAMENTAL_BONUS,
        "available": any_input,
        "components": components,
    }
