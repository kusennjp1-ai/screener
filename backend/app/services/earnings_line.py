"""Earnings line (収益ライン) computation, shared by the static chart export and
the diagnostic harness so the two never drift.

The line is a *fair-value* line in price units: trailing-twelve-month (TTM)
diluted EPS scaled by the stock's own median valuation multiple. To read like
an IBD / MarketSurge earnings line (smooth, no quarterly steps, no flat right
edge) it:
  * interpolates TTM EPS GEOMETRICALLY (log-linear) between quarter ends, so a
    turnaround grows as a smooth exponential rather than in additive steps;
  * PROJECTS the trailing edge past the last report using the recent annual
    EPS log-growth (capped), so the line keeps its slope instead of flatlining;
  * lightly smooths the result to remove kinks at the anchor joins.

Limitation: with only EDGAR trailing actuals (no analyst forward estimates), a
deeply unprofitable name (negative TTM throughout) gets no line, and the
over/under-valuation read is more conservative than IBD's forward-EPS line.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

_NS_PER_YEAR = 365.25 * 24 * 3600 * 1e9


def _ttm_anchors(pairs, ttm_window_days: int) -> tuple[np.ndarray, np.ndarray]:
    """(anchor_time_ns, ttm_eps) for each quarter end with 4 consecutive quarters."""
    dates = [pd.Timestamp(d) for d, _ in pairs]
    eps = [float(v) for _, v in pairs]
    ax: list[float] = []
    ay: list[float] = []
    for i in range(3, len(pairs)):
        if (dates[i] - dates[i - 3]).days > ttm_window_days:
            continue
        ax.append(float(dates[i].value))
        ay.append(float(sum(eps[i - 3 : i + 1])))
    return np.array(ax, dtype="float64"), np.array(ay, dtype="float64")


def _recent_log_growth(ax: np.ndarray, ay: np.ndarray) -> float:
    """Annual log-growth of TTM EPS over the last ~1y span, capped to a sane band."""
    if ay[-1] <= 0:
        return 0.0
    last_t = ax[-1]
    prior = 0
    for j in range(len(ax) - 1, -1, -1):
        if last_t - ax[j] >= _NS_PER_YEAR * 0.75 and ay[j] > 0:
            prior = j
            break
    if ay[prior] <= 0 or ax[-1] <= ax[prior]:
        return 0.0
    yrs = (ax[-1] - ax[prior]) / _NS_PER_YEAR
    if yrs <= 0:
        return 0.0
    g = float(np.log(ay[-1] / ay[prior]) / yrs)
    return float(np.clip(g, -0.5, 1.0))  # -50% .. +170% annual


def compute_earnings_line(
    px_index, close, pairs, *, ttm_window_days: int = 400
) -> Optional[dict]:
    """Return ``{"line", "pos", "ttm_daily", "multiple"}`` or ``None``.

    ``px_index`` is the price DatetimeIndex, ``close`` the close array, ``pairs``
    is ``[(YYYY-MM-DD, quarterly_diluted_eps), ...]`` oldest-first. ``line`` is a
    numpy array aligned to ``px_index`` (NaN where EPS is non-positive), ``pos``
    a boolean mask of drawable bars.
    """
    ax, ay = _ttm_anchors(pairs, ttm_window_days)
    if ax.size < 2:
        return None

    x_px = np.array([pd.Timestamp(d).value for d in px_index], dtype="float64")
    close = np.asarray(close, dtype="float64")
    if x_px.shape[0] != close.shape[0]:
        return None

    g = _recent_log_growth(ax, ay)
    ttm_daily = np.empty_like(x_px)
    for k, xv in enumerate(x_px):
        if xv <= ax[0]:
            ttm_daily[k] = ay[0]
        elif xv >= ax[-1]:
            yrs = (xv - ax[-1]) / _NS_PER_YEAR
            ttm_daily[k] = ay[-1] * np.exp(g * yrs) if ay[-1] > 0 else ay[-1]
        else:
            j = int(np.searchsorted(ax, xv))
            x0, x1, y0, y1 = ax[j - 1], ax[j], ay[j - 1], ay[j]
            frac = (xv - x0) / (x1 - x0) if x1 > x0 else 0.0
            if y0 > 0 and y1 > 0:  # geometric (smooth exponential)
                ttm_daily[k] = float(np.exp(np.log(y0) + frac * (np.log(y1) - np.log(y0))))
            else:  # linear near a zero crossing
                ttm_daily[k] = y0 + frac * (y1 - y0)

    pos = (ttm_daily > 0) & np.isfinite(close) & (close > 0)
    if not pos.any():
        return None
    multiple = float(np.median(close[pos] / ttm_daily[pos]))
    if not np.isfinite(multiple) or multiple <= 0:
        return None

    line = ttm_daily * multiple
    # Light smoothing (centered 5-bar mean) to remove anchor-join kinks; edges
    # use whatever points are available so the right edge isn't pulled down.
    line = pd.Series(line).rolling(5, center=True, min_periods=1).mean().to_numpy()
    line = np.where(pos, line, np.nan)
    return {"line": line, "pos": pos, "ttm_daily": ttm_daily, "multiple": multiple}
