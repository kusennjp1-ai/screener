"""VCP footprint adapter for the Markets 360 screener.

Minervini's Volatility Contraction Pattern is the *structural* setup that
precedes a buyable breakout: a base built from a sequence of progressively
tighter pullbacks (T1 > T2 > T3 ...), volume drying up into the right side, and
price coiling just under a pivot (the buy point). The crude ``compute_vcp_pct``
range used by the chart chip captures none of that shape — it is just a 10-bar
high/low spread.

This module is a thin, chronological adapter over the already-calibrated
``legacy_vcp_detection.VCPDetector`` (tuned against ~900 of Minervini's own
referenced trades). The legacy detector expects a *most-recent-first* series, so
we reverse here and expose a compact, JSON-friendly footprint the M360 scanner
and chart can consume without knowing the legacy orientation quirk.

Output (all keys always present; ``None``/``False`` on insufficient data):
  detected            VCP structurally present (tightening pullbacks near highs)
  score               0-100 composite quality
  num_contractions    distinct pullbacks (T-count) in the base
  contraction_ratio   fraction of successive pullbacks that tightened
  contractions_pct    each pullback depth %, oldest -> newest
  volume_dryup        volume contracting across the base
  tight_near_highs    price coiled within ~5% of the base high
  pivot               buy-point price (resistance to break)
  distance_to_pivot_pct  +ve = still below pivot, -ve = already through it
  ready_for_breakout  VCP detected AND coiled within 3% under the pivot
  near_pivot          VCP detected AND within 8% under / 5% over the pivot
                      (the 5% chase limit — Minervini never buys further past
                      the buy point)

Both pivot states are gated on ``detected``: proximity to a recent high with no
contraction structure is not a setup, and ungated flags fired on ~96% of random
uptrend days (zero timing information — see scripts/validate_trade_ideas.py).
"""
from __future__ import annotations

from typing import Dict, Optional

import numpy as np
import pandas as pd

from app.analysis.patterns.legacy_vcp_detection import VCPDetector


def _f(v: object) -> Optional[float]:
    """Coerce numpy/None to a JSON-safe Python float (or None)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None

# --- MA-tightness base path (C70) -------------------------------------------
# The legacy cup detector keys on strictly-tightening pullback DEPTHS and
# misses ~64% of Minervini's real entries (measured on the 908 windows). Per
# the "Studying Historical Winners" interview, Minervini/Qullamaggie define
# tightness as "multiple tight days on the 10 and/or 20-day MA" over a base of
# "2 weeks to 2 months" with "volatility contracting" (not monotonic depths),
# preceded by a "double off the lows". Adding this as a PARALLEL detection path
# lifted recall 36% -> 64% AND improved entry-vs-control discrimination
# +20.1pp -> +26.3pp offline (scripts/measure_ma_tight_recall.py) — i.e. it
# catches flat bases / cup-without-handle / base-on-base the cup model rejects,
# without loosening into noise. Numbers are article-grounded, not return-fit.
MA_BASE_MAX = 42        # 2-month base window
MA_TIGHT_BARS = 10      # the tight leg into the pivot
MA_TIGHT_RANGE = 0.12   # last-10 close range <= 12%
MA_HUG_PCT = 0.05       # within 5% of the 10-day MA
MA_HUG_FRAC = 0.5       # >= half the tight leg hugs the 10DMA
MA_NEAR_HIGH = 0.85     # close within 15% of the base high
MA_PRIOR_ADV = 2.0      # prior 2x advance — the article's literal "double off
#                         the lows"; halves control fires vs a softened 1.5x
#                         while keeping entry recall high (discrimination-safe).
MA_PRIOR_LOOKBACK = 126


def _ma_tight_base(price_data: pd.DataFrame) -> Optional[Dict[str, float]]:
    """Chronological MA-tightness base detector (returns pivot/dist or None).

    Faithful port of the offline-validated logic. Requires a tight leg hugging
    the 10-DMA near the highs, general volatility contraction over the base,
    and a prior ~1.5x advance. Never raises.
    """
    try:
        close = price_data["Close"]
        high = price_data["High"]
        low = price_data["Low"]
        if len(close) < MA_BASE_MAX + MA_PRIOR_LOOKBACK:
            return None
        piv = float(high.iloc[-MA_BASE_MAX:].max())
        last = float(close.iloc[-1])
        if piv <= 0 or last <= 0:
            return None
        c = close.iloc[-MA_TIGHT_BARS:]
        if (c.max() - c.min()) / c.max() > MA_TIGHT_RANGE:      # tight leg
            return None
        if last < MA_NEAR_HIGH * piv:                            # near the highs
            return None
        ma10 = close.rolling(10).mean().iloc[-MA_TIGHT_BARS:]
        hug = np.abs(c.values - ma10.values) / ma10.values <= MA_HUG_PCT
        if np.nanmean(hug) < MA_HUG_FRAC:                        # hugs the 10DMA
            return None
        rng = ((high - low) / close).iloc[-MA_BASE_MAX:]
        h = len(rng) // 2
        if not (rng.iloc[h:].mean() < rng.iloc[:h].mean()):      # volatility shrink
            return None
        base_low = float(low.iloc[-MA_BASE_MAX:].min())
        prior_low = float(low.iloc[-(MA_BASE_MAX + MA_PRIOR_LOOKBACK):-MA_BASE_MAX].min())
        if not (prior_low > 0 and (piv / prior_low) >= MA_PRIOR_ADV):  # double off lows
            return None
        dist = (piv - last) / last * 100.0
        return {"pivot": piv, "dist": dist, "base_low": base_low}
    except Exception:  # pragma: no cover - never break a scan
        return None


# A pivot watch: Minervini stalks names coiling just beneath the buy point so the
# trigger can be hit the moment the breakout fires. Tighter than the legacy 3%
# "ready" flag, this 8% band is the "on the radar" zone.
NEAR_PIVOT_PCT = 8.0
# Minervini's chase limit: a breakout bought more than ~5% above the pivot is a
# chase, so the radar zone extends at most 5% PAST the pivot (negative distance).
MAX_PAST_PIVOT_PCT = 5.0

_EMPTY: Dict[str, object] = {
    "detected": False,
    "score": None,
    "num_contractions": 0,
    "contraction_ratio": None,
    "contractions_pct": [],
    "volume_dryup": False,
    "tight_near_highs": False,
    "pivot": None,
    "distance_to_pivot_pct": None,
    "ready_for_breakout": False,
    "near_pivot": False,
    "source": None,
}


def compute_vcp_footprint(
    price_data: Optional[pd.DataFrame],
    min_bars: int = 120,
) -> Dict[str, object]:
    """Compute the VCP footprint from chronological (oldest->newest) OHLCV.

    Never raises: any shortfall or detector error degrades to the empty
    footprint so a single symbol can't break a scan.
    """
    if (
        price_data is None
        or "Close" not in getattr(price_data, "columns", [])
        or len(price_data) < min_bars
    ):
        return dict(_EMPTY)

    # Legacy detector consumes a most-recent-first series.
    close = price_data["Close"].iloc[::-1].reset_index(drop=True)
    if "Volume" in price_data.columns:
        volume = price_data["Volume"].iloc[::-1].reset_index(drop=True)
    else:
        volume = None

    try:
        legacy = VCPDetector().detect_vcp(close, volume)
    except Exception:  # pragma: no cover - defensive; never crash a scan
        return dict(_EMPTY)

    pivot_info = legacy.get("pivot_info") or {}
    if not isinstance(pivot_info, dict):
        pivot_info = {}

    pivot = _f(pivot_info.get("pivot"))
    dist = _f(pivot_info.get("distance_pct"))  # +ve => current price below pivot
    detected = bool(legacy.get("vcp_detected", False))
    ma_source = False
    if not detected:
        # Parallel MA-tightness base path (C70): catches flat-base /
        # base-on-base setups the cup detector's monotonic-depth gate rejects.
        ma = _ma_tight_base(price_data)
        if ma is not None:
            detected = True
            ma_source = True
            pivot = ma["pivot"]
            dist = ma["dist"]
    # Actionable pivot states require the VCP STRUCTURE, not just proximity to a
    # recent high: without the `detected` gate, any uptrending stock sat "near
    # pivot" ~96% of the time (measured on the fixtures via the trade-idea
    # harness control), which carries zero timing information. Minervini's
    # radar zone = a completed contraction coiling within 8% under the pivot,
    # or a fresh breakout no more than the ~5% chase limit above it.
    near_pivot = detected and (
        dist is not None and -MAX_PAST_PIVOT_PCT <= dist <= NEAR_PIVOT_PCT
    )
    if ma_source:
        # MA-tight bases have no legacy pivot_info; "ready" = coiled within 3%
        # under the pivot (same threshold the legacy detector uses).
        ready = dist is not None and 0.0 <= dist <= 3.0
    else:
        ready = detected and bool(pivot_info.get("ready_for_breakout", False))

    score = _f(legacy.get("vcp_score"))
    # legacy bases are most-recent-first; reverse to oldest->newest footprint
    depths = [
        _f(d) for d in reversed(legacy.get("bases_depth", []) or []) if _f(d) is not None
    ]
    return {
        "detected": detected,
        "score": round(score, 1) if score is not None else None,
        "num_contractions": int(legacy.get("num_bases", 0) or 0),
        "contraction_ratio": _f(legacy.get("contraction_ratio")),
        "contractions_pct": depths,
        "volume_dryup": bool(legacy.get("contracting_volume", False)),
        "tight_near_highs": bool(legacy.get("tight_near_highs", False)),
        "pivot": pivot,
        "distance_to_pivot_pct": dist,
        "ready_for_breakout": ready,
        "near_pivot": bool(near_pivot),
        "source": "ma_tight" if ma_source else ("vcp" if detected else None),
    }
