"""Report the IBD-30 persistence (carry-forward) baseline from the weekly matrix.

Reads an IBD-30 rank x week matrix CSV (leftmost data column = most recent week,
one row per rank) and prints how well last week predicts this week — the
persistence baseline any feature model must beat — plus the weekly churn and a
few top-N "keep only the strongest" priors.

Pure / offline: no DB, no screener features needed.

Usage::

    python -m app.scripts.ibd_persistence_report --matrix data/ibd_reference/ibd30/matrix_2026.csv
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

from app.services.ibd_persistence import (
    evaluate_persistence,
    matrix_from_rows,
    rank_stability,
)


def _load_csv(path: str | Path) -> list[list[str]]:
    with Path(path).open("r", encoding="utf-8", newline="") as handle:
        return [row for row in csv.reader(handle) if row and not row[0].lstrip().startswith("#")]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix", required=True, help="IBD-30 matrix CSV path")
    parser.add_argument(
        "--newest-first",
        dest="newest_first",
        action="store_true",
        default=True,
        help="Leftmost data column is the most recent week (default).",
    )
    parser.add_argument("--oldest-first", dest="newest_first", action="store_false")
    args = parser.parse_args()

    rows = _load_csv(args.matrix)
    weeks = matrix_from_rows(rows, newest_first=args.newest_first)
    weeks = [(label, lst) for label, lst in weeks if lst]  # drop empty columns
    if len(weeks) < 2:
        print(f"Need >=2 non-empty weeks, found {len(weeks)}.")
        return 1

    sizes = ", ".join(f"{label}={len(lst)}" for label, lst in weeks)
    print(f"Loaded {len(weeks)} weeks (oldest->newest): {sizes}\n")

    full = evaluate_persistence(weeks)
    stab = rank_stability(weeks)
    print("Persistence baseline — predict each week = previous week's full list:")
    for s in full["steps"]:
        print(
            f"  {s['from']} -> {s['week']}: overlap {s['overlap']}/{s['actual_count']} "
            f"recall={s['recall']:.2f} precision={s['precision']:.2f} "
            f"(added {s['added']}, dropped {s['dropped']})"
        )
    m = full["mean"]
    print(
        f"  MEAN over {full['n_steps']} steps: recall={m['recall']:.3f} "
        f"precision={m['precision']:.3f} jaccard={m['jaccard']:.3f} f1={m['f1']:.3f}"
    )
    print(
        f"  Weekly churn: +{stab['mean_added_per_week']} new / "
        f"-{stab['mean_dropped_per_week']} dropped per week on average.\n"
    )

    print("Top-N prior — carry forward only the previous week's strongest N:")
    for n in (10, 15, 20):
        r = evaluate_persistence(weeks, top_n=n)["mean"]
        print(f"  top-{n}: recall={r['recall']:.3f} precision={r['precision']:.3f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
