"""IBD-50 calibration harness.

Measures how closely the screener's Composite-Rating leadership list matches
IBD's actual published leaders (e.g. the weekly IBD 50 / Leaderboard), and
sweeps the Composite-Rating weights and IBD-50 gate thresholds to maximise that
overlap.

Everything here is pure (no I/O, no DB): it operates on in-memory feature rows
and ground-truth symbol sets, so it is fully unit-testable and can be driven by
the ``ibd_overlap_report`` CLI from an exported scan bundle.

Typical use::

    from app.services.ibd_calibration import (
        DEFAULT_GATES, select_leaders, overlap_metrics, calibrate,
    )

    predicted = select_leaders(feature_rows, weights=None, gates=DEFAULT_GATES)
    metrics = overlap_metrics(predicted, truth_symbols)

    best = calibrate(rows_by_week, truth_by_week)   # grid sweep
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from itertools import product
from typing import Iterable, Mapping, Sequence

from app.services.composite_rating_service import (
    COMPONENT_WEIGHTS,
    CompositeRatingService,
)

# Production IBD-50 gates, mirroring the ``ibd50`` preset in preset_screens.py.
# Calibration sweeps variations of these.


@dataclass(frozen=True)
class Gates:
    """Threshold gates applied before ranking by Composite Rating.

    Defaults mirror the production ``ibd50`` preset (tuned against IBD's
    published list — recall-leaning).
    """

    composite_min: float = 90.0
    rs_min: float = 85.0
    group_max: float = 120.0
    high_dist_min: float = -15.0  # within 15% of the 52-week high

    def passes(self, row: Mapping[str, float | None], composite: int | None) -> bool:
        if composite is None or composite < self.composite_min:
            return False
        rs = row.get("rs_rating")
        if rs is None or rs < self.rs_min:
            return False
        group = row.get("ibd_group_rank")
        if group is None or group > self.group_max:
            return False
        high_dist = row.get("week_52_high_distance")
        if high_dist is not None and high_dist < self.high_dist_min:
            return False
        return True


DEFAULT_GATES = Gates()
DEFAULT_LIMIT = 50

_COMPONENT_KEYS = (
    "eps_rating",
    "rs_rating",
    "ibd_group_rank",
    "smr_rating",
    "acc_dis_rating",
)


def select_leaders(
    feature_rows: Sequence[Mapping[str, float | None]],
    *,
    weights: Mapping[str, float] | None = None,
    gates: Gates = DEFAULT_GATES,
    limit: int = DEFAULT_LIMIT,
) -> list[str]:
    """Return the screener's leadership list (ranked symbols, capped to limit).

    Recomputes Composite Rating over ``feature_rows`` with ``weights`` so the
    same data can be scored under different weightings, applies ``gates``, then
    sorts by Composite descending and caps to ``limit``.
    """
    components = {
        row["symbol"]: {key: row.get(key) for key in _COMPONENT_KEYS}
        for row in feature_rows
        if row.get("symbol")
    }
    scored = CompositeRatingService(weights).calculate_with_scores(components)

    by_symbol = {row["symbol"]: row for row in feature_rows if row.get("symbol")}
    eligible = []
    for symbol in by_symbol:
        entry = scored.get(symbol)
        rating = entry["rating"] if entry else None
        if gates.passes(by_symbol[symbol], rating):
            eligible.append((symbol, entry["score"]))
    # Rank by the raw blend score (full resolution) so saturated 1-99 ratings
    # don't make the top-N cut arbitrary — mirrors the production preset.
    eligible.sort(key=lambda item: item[1], reverse=True)
    return [symbol for symbol, _ in eligible[:limit]]


def overlap_metrics(
    predicted: Sequence[str],
    truth: Iterable[str],
) -> dict[str, float | int]:
    """Overlap statistics between a predicted list and the ground-truth set."""
    predicted_set = set(predicted)
    truth_set = set(truth)
    overlap = len(predicted_set & truth_set)
    union = len(predicted_set | truth_set)
    precision = overlap / len(predicted_set) if predicted_set else 0.0
    recall = overlap / len(truth_set) if truth_set else 0.0
    jaccard = overlap / union if union else 0.0
    denom = min(len(predicted_set), len(truth_set))
    overlap_at_n = overlap / denom if denom else 0.0
    f1 = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )
    return {
        "predicted_count": len(predicted_set),
        "truth_count": len(truth_set),
        "overlap": overlap,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "jaccard": round(jaccard, 4),
        "overlap_at_n": round(overlap_at_n, 4),
        "f1": round(f1, 4),
    }


def evaluate(
    rows_by_week: Mapping[str, Sequence[Mapping[str, float | None]]],
    truth_by_week: Mapping[str, Iterable[str]],
    *,
    weights: Mapping[str, float] | None = None,
    gates: Gates = DEFAULT_GATES,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, object]:
    """Evaluate a (weights, gates) config across every week present in both maps.

    Returns per-week metrics plus the mean of each metric over the shared weeks.
    """
    weeks = sorted(set(rows_by_week) & set(truth_by_week))
    per_week: dict[str, dict[str, float | int]] = {}
    for week in weeks:
        predicted = select_leaders(
            rows_by_week[week], weights=weights, gates=gates, limit=limit
        )
        per_week[week] = overlap_metrics(predicted, truth_by_week[week])

    mean_metrics: dict[str, float] = {}
    if per_week:
        for key in ("precision", "recall", "jaccard", "overlap_at_n", "f1"):
            mean_metrics[key] = round(
                sum(week[key] for week in per_week.values()) / len(per_week), 4
            )
    return {"weeks": weeks, "per_week": per_week, "mean": mean_metrics}


def _normalize(weights: Mapping[str, float]) -> dict[str, float]:
    total = sum(weights.values())
    if total <= 0:
        return dict(weights)
    return {key: value / total for key, value in weights.items()}


def default_weight_grid() -> list[dict[str, float]]:
    """A small grid of EPS/RS-heavy Composite weightings to sweep."""
    grid: list[dict[str, float]] = []
    # Vary the EPS+RS share and how the remainder splits across group/SMR/Acc.
    for eps_rs in (0.30, 0.35, 0.40):  # weight for EACH of EPS and RS
        for group in (0.10, 0.16, 0.22):
            remainder = 1.0 - 2 * eps_rs - group
            if remainder <= 0:
                continue
            for smr_share in (0.4, 0.5, 0.6):
                smr = remainder * smr_share
                acc = remainder - smr
                grid.append(
                    _normalize(
                        {
                            "eps_rating": eps_rs,
                            "rs_rating": eps_rs,
                            "group_strength": group,
                            "smr_rating": smr,
                            "acc_dis_rating": acc,
                        }
                    )
                )
    return grid


def default_gate_grid() -> list[Gates]:
    """A small grid of gate thresholds to sweep."""
    grid: list[Gates] = []
    for composite_min in (85, 90, 93, 95):
        for rs_min in (80, 85, 90):
            for group_max in (60, 120, 150, 197):
                grid.append(
                    Gates(
                        composite_min=composite_min,
                        rs_min=rs_min,
                        group_max=group_max,
                    )
                )
    return grid


def calibrate(
    rows_by_week: Mapping[str, Sequence[Mapping[str, float | None]]],
    truth_by_week: Mapping[str, Iterable[str]],
    *,
    weight_grid: Sequence[Mapping[str, float]] | None = None,
    gate_grid: Sequence[Gates] | None = None,
    limit: int = DEFAULT_LIMIT,
    objective: str = "recall",
) -> dict[str, object]:
    """Grid-search (weights x gates) to maximise mean ``objective`` overlap.

    Returns the best config, its mean metrics, and the ranked leaderboard of all
    evaluated configs (top 10) so trade-offs are visible.
    """
    weight_grid = list(weight_grid or default_weight_grid())
    gate_grid = list(gate_grid or default_gate_grid())

    results: list[dict[str, object]] = []
    for weights, gates in product(weight_grid, gate_grid):
        evaluation = evaluate(
            rows_by_week, truth_by_week, weights=weights, gates=gates, limit=limit
        )
        mean = evaluation["mean"]
        results.append(
            {
                "weights": dict(weights),
                "gates": gates,
                "mean": mean,
                "score": mean.get(objective, 0.0) if mean else 0.0,
            }
        )

    results.sort(key=lambda item: item["score"], reverse=True)
    best = results[0] if results else None
    return {
        "objective": objective,
        "best": best,
        "leaderboard": results[:10],
        "evaluated": len(results),
    }
