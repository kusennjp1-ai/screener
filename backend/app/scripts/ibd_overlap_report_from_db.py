"""Report IBD-50 overlap from the latest published feature run (runs in CI).

This is the in-build half of the weekly calibration loop. The static-site build
computes Composite Rating for the latest US feature run; this script reads that
run straight from the database, matches it to the nearest IBD ground-truth list
under ``data/ibd_reference/``, and prints the overlap (precision / recall /
Jaccard / overlap@N) — plus, with ``--calibrate``, the weight/gate config that
would maximise it — to stdout and the GitHub step summary.

It is intentionally read-only and guarded: any failure prints a notice and exits
0 so it can never break the build it piggybacks on.
"""
from __future__ import annotations

import argparse
import os
from datetime import date, datetime
from pathlib import Path

from app.scripts._runtime import prepare_runtime, repo_root

_HARNESS_FIELDS = (
    "eps_rating",
    "rs_rating",
    "ibd_group_rank",
    "smr_rating",
    "acc_dis_rating",
    "week_52_high_distance",
)


def _parse_date(value: str) -> date | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _nearest_reference(references: dict, as_of: date, max_gap_days: int):
    """Pick the reference whose date is closest to ``as_of`` within the gap."""
    best = None
    best_gap = None
    for date_str, ref in references.items():
        ref_date = _parse_date(date_str)
        if ref_date is None:
            continue
        gap = abs((ref_date - as_of).days)
        if gap <= max_gap_days and (best_gap is None or gap < best_gap):
            best, best_gap = ref, gap
    return best


def _emit(text: str) -> None:
    print(text)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as handle:
            handle.write(text + "\n")


def _run(market: str, reference_dir: str, list_type: str, max_gap_days: int,
         limit: int, do_calibrate: bool) -> int:
    from app.database import SessionLocal
    from app.infra.db.models.feature_store import FeatureRun, StockFeatureDaily
    from app.interfaces.tasks.feature_store_tasks import (
        _resolve_latest_published_run_for_market,
    )
    from app.services.ibd_calibration import DEFAULT_GATES, calibrate, evaluate
    from app.services.ibd_reference import load_reference_lists

    references = load_reference_lists(reference_dir, list_type=list_type)
    if not references:
        _emit(f"### IBD-50 overlap ({market})\n\nNo reference lists under "
              f"`{reference_dir}` — add weekly files to enable measurement.")
        return 0

    with SessionLocal() as db:
        run_id = _resolve_latest_published_run_for_market(db=db, market=market)
        if run_id is None:
            _emit(f"### IBD-50 overlap ({market})\n\nNo published feature run found.")
            return 0
        run = db.query(FeatureRun).filter(FeatureRun.id == run_id).first()
        as_of = run.as_of_date if run else None
        rows = (
            db.query(StockFeatureDaily.symbol, StockFeatureDaily.details_json)
            .filter(StockFeatureDaily.run_id == run_id)
            .all()
        )

    if as_of is None or not rows:
        _emit(f"### IBD-50 overlap ({market})\n\nFeature run {run_id} has no rows.")
        return 0

    reference = _nearest_reference(references, as_of, max_gap_days)
    if reference is None:
        _emit(f"### IBD-50 overlap ({market})\n\nNo reference within "
              f"{max_gap_days}d of feature run date {as_of.isoformat()}.")
        return 0

    feature_rows = []
    for symbol, details in rows:
        d = details or {}
        row = {"symbol": symbol}
        row.update({field: d.get(field) for field in _HARNESS_FIELDS})
        feature_rows.append(row)

    rows_by_week = {reference.as_of_date: feature_rows}
    truth_by_week = {reference.as_of_date: reference.symbol_set}

    current = evaluate(rows_by_week, truth_by_week, gates=DEFAULT_GATES, limit=limit)
    m = current["per_week"][reference.as_of_date]
    _emit(
        f"### IBD-50 overlap ({market})\n\n"
        f"- Feature run: id={run_id}, as_of={as_of.isoformat()} "
        f"({len(feature_rows)} rows)\n"
        f"- Reference: {reference.as_of_date} ({reference.list_type}, "
        f"{len(reference.symbols)} names)\n"
        f"- **Overlap {m['overlap']}/{m['truth_count']}** — "
        f"precision={m['precision']:.2f} recall={m['recall']:.2f} "
        f"jaccard={m['jaccard']:.2f} overlap@N={m['overlap_at_n']:.2f}"
    )

    if do_calibrate:
        result = calibrate(rows_by_week, truth_by_week, limit=limit, objective="recall")
        best = result["best"]
        if best:
            g = best["gates"]
            bm = best["mean"]
            weights = ", ".join(f"{k}={v:.2f}" for k, v in best["weights"].items())
            _emit(
                f"\n**Best (max recall, {result['evaluated']} configs):** "
                f"recall={bm['recall']:.2f} precision={bm['precision']:.2f}\n"
                f"- weights: {weights}\n"
                f"- gates: composite>={g.composite_min} rs>={g.rs_min} "
                f"group<={g.group_max} high_dist>={g.high_dist_min}"
            )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", default="US")
    parser.add_argument("--reference-dir", default=None)
    parser.add_argument("--list-type", default="ibd50")
    parser.add_argument("--max-gap-days", type=int, default=7)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--calibrate", action="store_true")
    args = parser.parse_args()

    prepare_runtime()
    reference_dir = args.reference_dir or str(repo_root() / "data" / "ibd_reference")
    try:
        return _run(
            market=args.market.upper(),
            reference_dir=reference_dir,
            list_type=args.list_type,
            max_gap_days=args.max_gap_days,
            limit=args.limit,
            do_calibrate=args.calibrate,
        )
    except Exception as exc:  # pragma: no cover - guard so the build never breaks
        _emit(f"### IBD-50 overlap ({args.market})\n\nSkipped (error: {exc}).")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
