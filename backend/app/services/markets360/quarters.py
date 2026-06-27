"""
Markets 360 — quarterly EPS / Sales growth strip.

Builds the table that runs along the bottom of the chart: per fiscal quarter,
the actual EPS and Sales with their year-ago comparison and YoY % growth, plus
a trailing "estimate" column for the upcoming report (next earnings date + the
forward growth estimate when the fundamentals feed carries one).

The historical columns come from SEC EDGAR XBRL quarterly series (diluted EPS +
revenue); ``build_quarter_table`` is a pure function over those dicts so it is
trivially testable. The service decides whether EDGAR is reachable and falls
back to a 1–2 column view from cached fundamentals when it is not.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

Quarter = Tuple[int, int]  # (fiscal_year, fiscal_quarter)


def _yoy(actual: Optional[float], prior: Optional[float]) -> Optional[float]:
    """Year-over-year % growth, sign-aware for the loss→profit / profit→loss
    cases the way financial sites display them (e.g. -0.02 -> -0.18 == -800%)."""
    if actual is None or prior is None:
        return None
    if prior == 0:
        return None
    if prior < 0:
        # Growth off a negative base: magnitude of improvement relative to |prior|.
        return round((actual - prior) / abs(prior) * 100.0, 1)
    return round((actual - prior) / prior * 100.0, 1)


def _order_desc(keys) -> List[Quarter]:
    return sorted(keys, key=lambda k: (k[0], k[1]), reverse=True)


def _label(q: Quarter) -> str:
    return f"{q[0]} Q{q[1]}"


def build_quarter_table(
    eps: Dict[Quarter, float],
    revenue: Dict[Quarter, float],
    *,
    max_quarters: int = 4,
    estimate: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Assemble up to ``max_quarters`` actual columns (newest→oldest order kept
    left→right as oldest→newest to match the chart) + an optional estimate col.

    ``estimate`` (when provided) is appended as the right-most column:
        {"label","earnings_date","earnings_timing","eps_est_growth","sales_est_growth"}
    """
    comparable = set(eps) & set(revenue)
    recent = _order_desc(comparable)[:max_quarters]
    cols: List[Dict[str, Any]] = []
    for q in recent:
        prior = (q[0] - 1, q[1])
        eps_actual = eps.get(q)
        eps_prior = eps.get(prior)
        rev_actual = revenue.get(q)
        rev_prior = revenue.get(prior)
        cols.append({
            "label": _label(q),
            "estimate": False,
            "eps_actual": _round(eps_actual, 2),
            "eps_prior": _round(eps_prior, 2),
            "eps_growth": _yoy(eps_actual, eps_prior),
            "sales_actual": _round(rev_actual, 0),
            "sales_prior": _round(rev_prior, 0),
            "sales_growth": _yoy(rev_actual, rev_prior),
        })
    cols.reverse()  # oldest → newest, left → right
    if estimate:
        cols.append({
            "label": estimate.get("label"),
            "estimate": True,
            "earnings_date": estimate.get("earnings_date"),
            "earnings_timing": estimate.get("earnings_timing"),  # "B" before open / "A" after close
            "eps_est_growth": estimate.get("eps_est_growth"),
            "sales_est_growth": estimate.get("sales_est_growth"),
        })
    return cols


def _round(value: Optional[float], digits: int) -> Optional[float]:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return round(f, digits)


def fallback_from_fundamentals(fundamentals: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Degraded quarterly strip from cached fundamentals when EDGAR is absent.

    Cached fundamentals only carry the latest one or two quarters' YoY growth
    (``eps_q1_yoy``, ``eps_q2_yoy``, ``sales_growth_qq``), so we surface those as
    growth-only columns rather than full actual/prior pairs.
    """
    if not fundamentals:
        return []
    cols: List[Dict[str, Any]] = []
    q1 = fundamentals.get("eps_q1_yoy")
    if q1 is not None:
        cols.append({
            "label": "Latest Q",
            "estimate": False,
            "eps_growth": _round(q1, 1),
            "sales_growth": _round(fundamentals.get("sales_growth_qq") or fundamentals.get("revenue_growth"), 1),
        })
    return cols
