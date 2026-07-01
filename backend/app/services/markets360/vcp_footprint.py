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
  ready_for_breakout  within ~3% under the pivot (actionable now)
  near_pivot          within ~8% under the pivot (Minervini buy-zone watch)
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

# A pivot watch: Minervini stalks names coiling just beneath the buy point so the
# trigger can be hit the moment the breakout fires. Tighter than the legacy 3%
# "ready" flag, this 8% band is the "on the radar" zone.
NEAR_PIVOT_PCT = 8.0

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
    near_pivot = (
        dist is not None and 0.0 <= dist <= NEAR_PIVOT_PCT
    ) or bool(pivot_info.get("ready_for_breakout"))

    score = _f(legacy.get("vcp_score"))
    # legacy bases are most-recent-first; reverse to oldest->newest footprint
    depths = [
        _f(d) for d in reversed(legacy.get("bases_depth", []) or []) if _f(d) is not None
    ]
    return {
        "detected": bool(legacy.get("vcp_detected", False)),
        "score": round(score, 1) if score is not None else None,
        "num_contractions": int(legacy.get("num_bases", 0) or 0),
        "contraction_ratio": _f(legacy.get("contraction_ratio")),
        "contractions_pct": depths,
        "volume_dryup": bool(legacy.get("contracting_volume", False)),
        "tight_near_highs": bool(legacy.get("tight_near_highs", False)),
        "pivot": pivot,
        "distance_to_pivot_pct": dist,
        "ready_for_breakout": bool(pivot_info.get("ready_for_breakout", False)),
        "near_pivot": bool(near_pivot),
    }
