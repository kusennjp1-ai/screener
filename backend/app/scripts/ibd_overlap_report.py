"""Report how closely the screener's IBD-50 list matches IBD's published leaders.

Loads IBD ground-truth reference lists (``data/ibd_reference/``) and a snapshot
of screener feature rows per week, then prints the overlap (precision / recall /
Jaccard / overlap@N) under the current Composite-Rating config. With
``--calibrate`` it sweeps Composite weights and gate thresholds and prints the
config that maximises mean overlap, so the production blend can be tuned.

Feature rows are supplied as JSON via ``--features`` in either shape::

    {"2026-06-18": [{"symbol": "FIX", "eps_rating": 95, "rs_rating": 96,
                     "ibd_group_rank": 12, "smr_rating": 80,
                     "acc_dis_rating": 70, "week_52_high_distance": -4}, ...]}

or a flat list of rows that each carry an ``as_of_date`` key.

Examples::

    python -m app.scripts.ibd_overlap_report \
        --reference-dir data/ibd_reference --list-type ibd50 \
        --features /tmp/feature_rows.json

    python -m app.scripts.ibd_overlap_report \
        --reference-dir data/ibd_reference --features /tmp/feature_rows.json \
        --calibrate --objective recall
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from app.services.ibd_calibration import (
    DEFAULT_GATES,
    DEFAULT_LIMIT,
    calibrate,
    evaluate,
)
from app.services.ibd_reference import load_reference_lists


def _load_feature_rows(path: str | Path) -> dict[str, list[dict[str, Any]]]:
    """Load feature rows grouped by week from a JSON file (map or flat list)."""
    with Path(path).open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    if isinstance(data, dict):
        return {str(week): list(rows or []) for week, rows in data.items()}

    if isinstance(data, list):
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in data:
            if not isinstance(row, dict):
                continue
            week = str(row.get("as_of_date") or "").strip()
            if not week:
                continue
            grouped.setdefault(week, []).append(row)
        return grouped

    raise ValueError("Unsupported --features JSON shape (expected object or list)")


def _print_evaluation(title: str, evaluation: dict[str, Any]) -> None:
    print(f"\n{title}")
    print("-" * len(title))
    for week in evaluation["weeks"]:
        m = evaluation["per_week"][week]
        print(
            f"  {week}: overlap {m['overlap']}/{m['truth_count']} "
            f"(pred {m['predicted_count']})  "
            f"precision={m['precision']:.2f} recall={m['recall']:.2f} "
            f"jaccard={m['jaccard']:.2f} overlap@N={m['overlap_at_n']:.2f}"
        )
    mean = evaluation.get("mean") or {}
    if mean:
        print(
            f"  MEAN: precision={mean['precision']:.3f} recall={mean['recall']:.3f} "
            f"jaccard={mean['jaccard']:.3f} overlap@N={mean['overlap_at_n']:.3f} "
            f"f1={mean['f1']:.3f}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-dir", default="data/ibd_reference")
    parser.add_argument("--list-type", default="ibd50")
    parser.add_argument("--features", required=True, help="JSON of feature rows by week")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--calibrate", action="store_true")
    parser.add_argument(
        "--objective",
        default="recall",
        choices=("recall", "precision", "jaccard", "overlap_at_n", "f1"),
    )
    args = parser.parse_args()

    references = load_reference_lists(args.reference_dir, list_type=args.list_type)
    if not references:
        print(
            f"No reference lists found under {args.reference_dir!r} "
            f"(list_type={args.list_type!r}). Add weekly files first — see "
            f"data/ibd_reference/README.md."
        )
        return 1
    truth_by_week = {date: ref.symbol_set for date, ref in references.items()}

    rows_by_week = _load_feature_rows(args.features)

    shared = sorted(set(truth_by_week) & set(rows_by_week))
    if not shared:
        print(
            "No overlapping weeks between reference lists "
            f"({sorted(truth_by_week)}) and feature rows ({sorted(rows_by_week)})."
        )
        return 1
    print(f"Evaluating {len(shared)} week(s): {', '.join(shared)}")

    current = evaluate(
        rows_by_week, truth_by_week, gates=DEFAULT_GATES, limit=args.limit
    )
    _print_evaluation("Current production config", current)

    if args.calibrate:
        result = calibrate(
            rows_by_week, truth_by_week, limit=args.limit, objective=args.objective
        )
        best = result["best"]
        print(
            f"\nCalibration (objective={args.objective}, "
            f"{result['evaluated']} configs evaluated)"
        )
        print("=" * 48)
        if best:
            gates = best["gates"]
            weights = best["weights"]
            mean = best["mean"]
            print("Best weights:")
            for key, value in weights.items():
                print(f"  {key:15s} {value:.3f}")
            print(
                f"Best gates: composite>={gates.composite_min} rs>={gates.rs_min} "
                f"group<={gates.group_max} high_dist>={gates.high_dist_min}"
            )
            print(
                f"Mean: recall={mean['recall']:.3f} precision={mean['precision']:.3f} "
                f"jaccard={mean['jaccard']:.3f} f1={mean['f1']:.3f}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
