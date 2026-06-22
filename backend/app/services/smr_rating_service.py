"""
SMR (Sales + Margins + Return on equity) Rating.

Approximates IBD's A–E SMR Rating, which combines three fundamental quality
signals into a single grade that favours profitable, fast-growing companies:

- **S**ales growth (recent revenue growth)
- **M**argins (profitability — net profit margin)
- **R**eturn on equity (capital efficiency)

Methodology (a documented proxy for IBD's proprietary rating): each component
is percentile-ranked across the universe, then the available components are
averaged (equal weight) into a single 0–99 score and an A–E letter grade
(A >= 80, B 60-79, C 40-59, D 20-39, E < 20). Percentile-ranking each component
first makes the blend robust to the very different scales of growth %, margin %
and ROE %.

Like EPS Rating, SMR is inherently cross-sectional, so it is computed in a
universe-wide pass rather than per stock.
"""
from __future__ import annotations

import logging
from typing import Mapping, Optional

import numpy as np

logger = logging.getLogger(__name__)

# Component weights (equal). Missing components are skipped and the remaining
# weights renormalised so a stock is never penalised for an absent field.
COMPONENT_WEIGHTS: dict[str, float] = {
    "sales_growth": 1.0,
    "profit_margin": 1.0,
    "roe": 1.0,
}

_LETTER_CUTOFFS = ((80, "A"), (60, "B"), (40, "C"), (20, "D"))


def letter_for_score(score: int | float | None) -> Optional[str]:
    """Map a 0-99 SMR score onto an A-E letter grade."""
    if score is None:
        return None
    for cutoff, letter in _LETTER_CUTOFFS:
        if score >= cutoff:
            return letter
    return "E"


def _percentile_ranks(values: Mapping[str, float]) -> dict[str, float]:
    """Percentile-rank a {symbol: value} map to 0-99 floats.

    Uses the same "weak" percentile convention as EPSRatingService: the share of
    the population strictly below a value, plus half the ties.
    """
    valid = {s: float(v) for s, v in values.items() if v is not None and np.isfinite(v)}
    if not valid:
        return {}
    symbols = list(valid.keys())
    scores = np.array([valid[s] for s in symbols], dtype="float64")
    ranks: dict[str, float] = {}
    n = len(scores)
    for i, symbol in enumerate(symbols):
        below = float(np.sum(scores < scores[i]))
        equal = float(np.sum(scores == scores[i]))
        percentile = (below + 0.5 * (equal - 1)) / n * 100
        ranks[symbol] = max(0.0, min(99.0, percentile))
    return ranks


class SMRRatingService:
    """Compute universe-wide SMR ratings (0-99) from fundamental components."""

    def calculate_ratings(
        self,
        components: Mapping[str, Mapping[str, float | None]],
    ) -> dict[str, int]:
        """Return {symbol: smr_rating 0-99}.

        Args:
            components: ``{symbol: {"sales_growth": x, "profit_margin": y,
                "roe": z}}``. Any component may be None/missing; a symbol with no
                usable component is omitted from the result.
        """
        if not components:
            return {}

        # Percentile-rank each component independently across the universe.
        per_component_ranks: dict[str, dict[str, float]] = {}
        for component in COMPONENT_WEIGHTS:
            per_component_ranks[component] = _percentile_ranks(
                {symbol: vals.get(component) for symbol, vals in components.items()}
            )

        ratings: dict[str, int] = {}
        for symbol in components:
            weighted_sum = 0.0
            weight_total = 0.0
            for component, weight in COMPONENT_WEIGHTS.items():
                rank = per_component_ranks[component].get(symbol)
                if rank is None:
                    continue
                weighted_sum += weight * rank
                weight_total += weight
            if weight_total <= 0:
                continue
            score = int(round(weighted_sum / weight_total))
            ratings[symbol] = max(0, min(99, score))
        return ratings
