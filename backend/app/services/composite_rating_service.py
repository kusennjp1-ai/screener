"""
IBD-style Composite Rating.

Approximates IBD's 1–99 Composite Rating, which blends a stock's five core
leadership signals — with EPS Rating and RS Rating weighted most heavily — into
a single percentile so the strongest growth leaders rise to the top:

- EPS Rating (earnings strength)         — heaviest
- RS Rating (price relative strength)    — heaviest
- Industry Group strength (rank 1-197)   — medium
- SMR Rating (sales/margins/ROE)         — light
- Acc/Dis Rating (institutional flow)    — light

Methodology (a documented proxy for IBD's proprietary blend): each stock's
available components are combined with the weights below into a raw score, then
the raw scores are percentile-ranked across the universe to a 1–99 Composite
Rating. Missing components are skipped and the remaining weights renormalised,
so partial data degrades gracefully instead of zeroing a stock out.

This blend is cross-sectional (the group rank and the final percentile both need
the universe), so it runs as a post-scan enrichment pass over a feature run.
"""
from __future__ import annotations

import logging
from typing import Mapping, Optional

import numpy as np

logger = logging.getLogger(__name__)

# EPS and RS dominate, matching IBD's emphasis on earnings and price strength.
COMPONENT_WEIGHTS: dict[str, float] = {
    "eps_rating": 0.32,
    "rs_rating": 0.32,
    "group_strength": 0.16,
    "smr_rating": 0.10,
    "acc_dis_rating": 0.10,
}

# IBD's group universe is ~197 industry groups (rank 1 = strongest).
MAX_GROUP_RANK = 197


def group_strength_from_rank(group_rank: float | int | None) -> Optional[float]:
    """Convert an IBD group rank (1=best..197=worst) to a 0-99 strength score."""
    if group_rank is None or not np.isfinite(group_rank):
        return None
    rank = max(1.0, min(float(MAX_GROUP_RANK), float(group_rank)))
    return (MAX_GROUP_RANK - rank) / (MAX_GROUP_RANK - 1) * 99.0


def _raw_score(
    components: Mapping[str, float | None],
    weights: Mapping[str, float] = COMPONENT_WEIGHTS,
) -> Optional[float]:
    """Weighted blend of a stock's available components, renormalised."""
    weighted_sum = 0.0
    weight_total = 0.0
    for name, weight in weights.items():
        value = components.get(name)
        if value is None or not np.isfinite(value):
            continue
        weighted_sum += weight * float(value)
        weight_total += weight
    if weight_total <= 0:
        return None
    return weighted_sum / weight_total


class CompositeRatingService:
    """Compute universe-wide Composite Ratings (1-99) from component ratings."""

    def __init__(self, weights: Mapping[str, float] | None = None):
        """Args:
            weights: Optional override for the component blend (same keys as
                ``COMPONENT_WEIGHTS``). Used by the calibration harness to sweep
                weightings; defaults to the production blend.
        """
        self.weights = dict(weights) if weights else dict(COMPONENT_WEIGHTS)

    def calculate_ratings(
        self,
        rows: Mapping[str, Mapping[str, float | None]],
    ) -> dict[str, int]:
        """Return {symbol: composite_rating 1-99}.

        Args:
            rows: ``{symbol: {"eps_rating", "rs_rating", "ibd_group_rank",
                "smr_rating", "acc_dis_rating"}}``. ``ibd_group_rank`` is the raw
                1-197 rank; it is converted to a 0-99 group-strength internally.
                Components may be None; a symbol with no usable component is
                omitted.
        """
        if not rows:
            return {}

        raw_scores: dict[str, float] = {}
        for symbol, values in rows.items():
            components = {
                "eps_rating": values.get("eps_rating"),
                "rs_rating": values.get("rs_rating"),
                "group_strength": group_strength_from_rank(values.get("ibd_group_rank")),
                "smr_rating": values.get("smr_rating"),
                "acc_dis_rating": values.get("acc_dis_rating"),
            }
            raw = _raw_score(components, self.weights)
            if raw is not None:
                raw_scores[symbol] = raw

        if not raw_scores:
            return {}

        symbols = list(raw_scores.keys())
        scores = np.array([raw_scores[s] for s in symbols], dtype="float64")
        n = len(scores)
        ratings: dict[str, int] = {}
        for i, symbol in enumerate(symbols):
            below = float(np.sum(scores < scores[i]))
            equal = float(np.sum(scores == scores[i]))
            percentile = (below + 0.5 * (equal - 1)) / n * 100
            # IBD's Composite Rating is reported on a 1-99 scale.
            ratings[symbol] = max(1, min(99, int(round(percentile))))
        return ratings
