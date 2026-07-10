"""
Markets 360 — proprietary-style rating estimators.

These reproduce the *behaviour* of the rating chips shown on a Minervini
Markets 360 chart (ER / SR / RPR / TPR / ESR / VRR / VCP% / ±20DMA / MonAlert
Net). MM360's exact formulas are not published, so each rating here is a
self-contained, documented estimate built from price + benchmark + fundamental
inputs the platform already has. They are intentionally decoupled from the
existing screener pipeline (the Markets 360 view is a standalone module).

Every rating maps a raw driver onto MM360's display scale:
  * 0–99 percentile-style chips (ER, SR, RPR, ESR) via a calibrated monotonic
    curve, so a single symbol can be scored without a universe snapshot.
  * a letter grade A–E (TPR) from the 8-point Trend Template count.
  * signed percentages (VRR, ±20DMA) read straight off price/volume.

All functions are defensive: missing data yields ``None`` rather than raising,
so the dashboard simply renders a dash.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Calibration helper
# ---------------------------------------------------------------------------
def _curve(x: Optional[float], points: Sequence[Tuple[float, float]]) -> Optional[int]:
    """Piecewise-linear map of a raw driver ``x`` onto a 0–99 chip value.

    ``points`` is an ascending list of ``(raw, score)`` anchors. Values below
    the first / above the last anchor clamp to the end scores. This lets each
    rating expose a hand-calibrated, monotonic transfer curve without needing
    a cross-sectional universe to percentile-rank against.
    """
    if x is None or (isinstance(x, float) and (np.isnan(x) or np.isinf(x))):
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    if x <= xs[0]:
        return int(round(ys[0]))
    if x >= xs[-1]:
        return int(round(ys[-1]))
    val = float(np.interp(x, xs, ys))
    return int(round(val))


def _safe_last(series: pd.Series) -> Optional[float]:
    if series is None or len(series) == 0:
        return None
    v = series.iloc[-1]
    if pd.isna(v):
        return None
    return float(v)


def _pct_return(close: pd.Series, lookback: int) -> Optional[float]:
    if close is None or len(close) <= lookback:
        return None
    now = float(close.iloc[-1])
    then = float(close.iloc[-1 - lookback])
    if then <= 0:
        return None
    return (now / then - 1.0) * 100.0


# ---------------------------------------------------------------------------
# RPR — Relative Price Rating (0–99)
# ---------------------------------------------------------------------------
# IBD-style RS Rating analogue: a volume of multi-window relative performance
# vs. the benchmark, weighted toward the most recent quarter (the classic
# 2x weight on the trailing 3 months). Mapped to 0–99 by a calibrated curve.
RPR_WEIGHTS = ((63, 0.40), (126, 0.20), (189, 0.20), (252, 0.20))


def compute_rpr(
    close: pd.Series,
    benchmark_close: Optional[pd.Series],
    universe_performances: Optional[Sequence[float]] = None,
) -> Optional[int]:
    """Relative Price Rating (0-99).

    When ``universe_performances`` (the recency-weighted relative-outperformance
    of every stock in the same-market universe) is supplied, RPR is an authentic
    Minervini-style **percentile rank** of this stock's outperformance against
    it. When None (the standalone single-symbol Markets 360 view), it falls back
    to a calibrated monotonic curve so a stock can still be scored without a
    cross-sectional snapshot.
    """
    if close is None or len(close) < 70:
        return None
    bench = None
    if benchmark_close is not None and len(benchmark_close) > 0:
        bench = benchmark_close.reindex(close.index).ffill()

    weighted = 0.0
    wsum = 0.0
    for lookback, weight in RPR_WEIGHTS:
        stock_ret = _pct_return(close, lookback)
        if stock_ret is None:
            continue
        rel = stock_ret
        if bench is not None:
            bench_ret = _pct_return(bench, lookback)
            if bench_ret is not None:
                rel = stock_ret - bench_ret
        weighted += rel * weight
        wsum += weight
    if wsum == 0:
        return None
    score = weighted / wsum  # relative outperformance %, recency-weighted

    # Authentic Minervini/IBD: percentile-rank against the (same-market) universe.
    if universe_performances:
        vals = [float(p) for p in universe_performances if p is not None and np.isfinite(p)]
        if vals:
            better = sum(1 for p in vals if p < score)
            return int(round(better / len(vals) * 100))

    # Fallback (single-symbol view): calibrated so market performers land near
    # 70-75 and strong leaders 90+.
    return _curve(
        score,
        [(-60, 1), (-30, 10), (-10, 30), (0, 55), (10, 72), (25, 85), (45, 93), (80, 99)],
    )


# ---------------------------------------------------------------------------
# ER — Earnings Rating (0–99)
# ---------------------------------------------------------------------------
# Blends the most recent quarter YoY EPS growth, the prior quarter (for
# acceleration), and a multi-year EPS CAGR when available. Estimate built from
# whatever the fundamentals payload carries; partial data degrades gracefully.
def compute_er(fundamentals: Optional[Dict]) -> Optional[int]:
    if not fundamentals:
        return None
    q1 = _first_num(fundamentals, ["eps_q1_yoy", "eps_growth_quarterly", "eps_growth_yy"])
    q2 = _first_num(fundamentals, ["eps_q2_yoy"])
    cagr = _first_num(fundamentals, ["eps_5yr_cagr", "eps_growth_annual"])
    if q1 is None and cagr is None:
        return None

    parts: List[Tuple[float, float]] = []  # (value%, weight)
    if q1 is not None:
        parts.append((q1, 0.55))
    if q2 is not None:
        # Acceleration bonus: reward q1 > q2.
        parts.append((q2, 0.20))
    if cagr is not None:
        parts.append((cagr, 0.25))
    total_w = sum(w for _, w in parts)
    if total_w == 0:
        return None
    blended = sum(v * w for v, w in parts) / total_w
    if q1 is not None and q2 is not None and q1 > q2:
        blended += min((q1 - q2) * 0.10, 10.0)  # acceleration kicker, capped

    return _curve(
        blended,
        [(-50, 1), (-20, 8), (0, 25), (15, 50), (25, 68), (40, 82), (70, 92), (120, 99)],
    )


# ---------------------------------------------------------------------------
# SR — Sales Rating (0–99)
# ---------------------------------------------------------------------------
def compute_sr(fundamentals: Optional[Dict]) -> Optional[int]:
    if not fundamentals:
        return None
    q1 = _first_num(fundamentals, ["sales_growth_qq", "sales_growth_yy", "revenue_growth"])
    if q1 is None:
        return None
    return _curve(
        q1,
        [(-30, 1), (-10, 10), (0, 28), (8, 50), (18, 70), (30, 84), (55, 94), (90, 99)],
    )


# ---------------------------------------------------------------------------
# ESR — Earnings Stability / Surprise Rating (0–99)
# ---------------------------------------------------------------------------
# MM360's ESR rewards consistent, accelerating, low-volatility earnings. With
# no surprise feed, estimate it from the stability of the quarterly EPS YoY
# series plus a growth level term: high, steady growth -> high ESR.
def compute_esr(
    fundamentals: Optional[Dict],
    quarterly_eps_growth: Optional[Sequence[float]] = None,
) -> Optional[int]:
    if quarterly_eps_growth:
        vals = [float(v) for v in quarterly_eps_growth if v is not None and np.isfinite(v)]
    else:
        vals = []
        for key in ("eps_q1_yoy", "eps_q2_yoy"):
            v = _first_num(fundamentals or {}, [key])
            if v is not None:
                vals.append(v)
    if not vals:
        # Fall back to ER's level if there is at least a current growth read.
        er = compute_er(fundamentals)
        return None if er is None else max(1, er - 8)

    level = float(np.mean(vals))
    # Lower dispersion -> steadier earnings -> higher ESR.
    dispersion = float(np.std(vals)) if len(vals) > 1 else 0.0
    steadiness = max(0.0, 1.0 - min(dispersion / 40.0, 1.0))  # 0..1
    level_score = _curve(
        level,
        [(-30, 5), (0, 30), (15, 55), (30, 75), (60, 90), (110, 99)],
    )
    if level_score is None:
        return None
    # Blend: 70% growth level, 30% steadiness bonus.
    return int(round(min(99, level_score * (0.70 + 0.30 * steadiness))))


# ---------------------------------------------------------------------------
# TPR — Trend Phase Rating (A–E)
# ---------------------------------------------------------------------------
# Maps the 8-point Trend Template score (already computed by minervini_bands)
# to a letter grade, matching the MM360 chip (A strongest .. E weakest).
def tpr_letter(tpr_score: Optional[int], tpr_max: Optional[int]) -> Optional[str]:
    if tpr_score is None:
        return None
    mx = tpr_max or 8
    # Normalise to an 8-point scale so 7-condition results still grade fairly.
    norm = tpr_score * (8.0 / mx)
    if norm >= 7.5:
        return "A"
    if norm >= 6.0:
        return "B"
    if norm >= 4.0:
        return "C"
    if norm >= 2.0:
        return "D"
    return "E"


# ---------------------------------------------------------------------------
# VRR — Volume Rate Rating (signed %)
# ---------------------------------------------------------------------------
# Today's volume relative to its ~50-day average, as a signed percentage.
# +54% means today is running 54% above normal. Drives the green/red chip.
def compute_vrr(volume: pd.Series, window: int = 50) -> Optional[float]:
    if volume is None or len(volume) < window + 1:
        return None
    avg = float(volume.iloc[-window - 1:-1].mean())
    today = float(volume.iloc[-1])
    if avg <= 0:
        return None
    return round((today / avg - 1.0) * 100.0, 1)


# ---------------------------------------------------------------------------
# ±20DMA — distance of price from the 20-day moving average (signed %)
# ---------------------------------------------------------------------------
def compute_dist_20dma(close: pd.Series, window: int = 20) -> Optional[float]:
    if close is None or len(close) < window:
        return None
    sma = float(close.iloc[-window:].mean())
    last = float(close.iloc[-1])
    if sma <= 0:
        return None
    return round((last / sma - 1.0) * 100.0, 1)


# ---------------------------------------------------------------------------
# VCP% — tightness of the most recent N bars (signed %, smaller = tighter)
# ---------------------------------------------------------------------------
# NOTE: this is a *recent-range* tightness metric — (high-low)/close over the
# last ``window`` bars — NOT a VCP pattern detector. It says nothing about a
# contraction sequence or volume dry-up. For authentic VCP quality (the multi-
# contraction footprint Minervini describes) use ``compute_vcp_score`` below.
def compute_vcp_pct(price_data: pd.DataFrame, window: int = 10) -> Optional[float]:
    if price_data is None or len(price_data) < window or "High" not in price_data.columns:
        return None
    recent = price_data.tail(window)
    hi = float(recent["High"].max())
    lo = float(recent["Low"].min())
    last = float(price_data["Close"].iloc[-1])
    if last <= 0:
        return None
    return round((hi - lo) / last * 100.0, 1)


# ---------------------------------------------------------------------------
# VCP score — authentic Minervini VCP pattern quality (0-100)
# ---------------------------------------------------------------------------
# Unlike compute_vcp_pct (a single recent-range read), this delegates to the
# Minervini-calibrated ``VCPDetector`` which validates the real footprint:
# 2-4 progressively tighter pullbacks, volume drying up, price coiled near the
# highs — composite depth(35%)/volume(25%)/tightness(25%)/ATR(15%). Returns the
# 0-100 quality score (None on insufficient data); never raises.
def compute_vcp_score(price_data: pd.DataFrame) -> Optional[float]:
    if (
        price_data is None
        or "Close" not in getattr(price_data, "columns", [])
        or len(price_data) < 30
    ):
        return None
    try:
        from app.analysis.patterns.legacy_vcp_detection import VCPDetector

        prices = price_data["Close"].iloc[::-1].reset_index(drop=True)
        volumes = (
            price_data["Volume"].iloc[::-1].reset_index(drop=True)
            if "Volume" in price_data.columns
            else None
        )
        result = VCPDetector().detect_vcp(prices, volumes)
        score = result.get("vcp_score")
        return round(float(score), 1) if score is not None else None
    except Exception:  # pragma: no cover - chip must never break the payload
        return None


# ---------------------------------------------------------------------------
# MonAlert Net — net momentum-alert oscillator around zero
# ---------------------------------------------------------------------------
# A Stockbee-style "net" of momentum impulses: per bar, +1 for a >4% up move on
# rising volume, -1 for a >4% down move; smoothed into a net series that lives
# around zero (the histogram beneath the chart). The current value drives the
# MonAlert Net chip.
def compute_monalert_net(
    price_data: pd.DataFrame,
    history_bars: int = 252,
    threshold_pct: float = 4.0,
    smooth: int = 5,
) -> Dict[str, object]:
    out: Dict[str, object] = {"monalert_net": None, "monalert_history": []}
    if price_data is None or len(price_data) < smooth + 2 or "Close" not in price_data.columns:
        return out
    close = price_data["Close"]
    ret = close.pct_change(fill_method=None) * 100.0
    impulse = pd.Series(0.0, index=close.index)
    impulse[ret >= threshold_pct] = 1.0
    impulse[ret <= -threshold_pct] = -1.0
    net = impulse.rolling(smooth).sum().fillna(0.0)

    hist = net.tail(history_bars)
    out["monalert_history"] = [
        {"time": ts.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
        for ts, v in hist.items()
    ]
    out["monalert_net"] = int(round(float(net.iloc[-1])))
    return out


# ---------------------------------------------------------------------------
# small utilities
# ---------------------------------------------------------------------------
def _first_num(d: Dict, keys: Sequence[str]) -> Optional[float]:
    for k in keys:
        if d is None:
            return None
        v = d.get(k)
        if v is None:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if np.isfinite(f):
            return f
    return None
