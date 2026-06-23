"""Diagnose why IBD's published leaders do (or don't) reach the IBD-50 screen.

The overlap report says *how many* of IBD's leaders the screener catches; this
says *why it misses the rest*. For each symbol in the nearest IBD ground-truth
list it looks up the screener's latest US feature run and prints the stock's
ratings plus a verdict: PASS, MISSING (not in the run / universe), or which
IBD-50 gate(s) excluded it. A roll-up shows how many names clear each gate, so
it is obvious whether low overlap is a gate problem, a data problem, or a
ranking problem.

Read-only and guarded so it can never break the build it runs in.
"""
from __future__ import annotations

import argparse
import os
from datetime import date, datetime
from pathlib import Path

_FIELDS = (
    "eps_rating",
    "rs_rating",
    "ibd_group_rank",
    "smr_rating",
    "acc_dis_rating",
    "composite_rating",
    "week_52_high_distance",
)


def _parse_date(value: str) -> date | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _nearest_reference(references: dict, as_of: date, max_gap_days: int):
    best, best_gap = None, None
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


def _fmt(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.0f}"
    return str(value)


def _gate_failures(row: dict, gates) -> list[str]:
    """Return the IBD-50 gate names this row fails (empty list = passes all)."""
    fails = []
    composite = row.get("composite_rating")
    if composite is None or composite < gates.composite_min:
        fails.append(f"composite<{gates.composite_min:g}")
    rs = row.get("rs_rating")
    if rs is None or rs < gates.rs_min:
        fails.append(f"rs<{gates.rs_min:g}")
    group = row.get("ibd_group_rank")
    if group is None or group > gates.group_max:
        fails.append(f"group>{gates.group_max:g}")
    high = row.get("week_52_high_distance")
    if high is not None and high < gates.high_dist_min:
        fails.append(f"highdist<{gates.high_dist_min:g}")
    return fails


def _run(market: str, reference_dir: str, list_type: str, max_gap_days: int) -> int:
    from app.database import SessionLocal
    from app.infra.db.models.feature_store import FeatureRun, StockFeatureDaily
    from app.interfaces.tasks.feature_store_tasks import (
        _resolve_latest_published_run_for_market,
    )
    from app.services.ibd_calibration import DEFAULT_GATES
    from app.services.ibd_reference import load_reference_lists

    references = load_reference_lists(reference_dir, list_type=list_type)
    if not references:
        _emit(f"### IBD-50 diagnosis ({market})\n\nNo reference lists under `{reference_dir}`.")
        return 0

    with SessionLocal() as db:
        run_id = _resolve_latest_published_run_for_market(db=db, market=market)
        if run_id is None:
            _emit(f"### IBD-50 diagnosis ({market})\n\nNo published feature run.")
            return 0
        run = db.query(FeatureRun).filter(FeatureRun.id == run_id).first()
        as_of = run.as_of_date if run else None
        rows = (
            db.query(StockFeatureDaily.symbol, StockFeatureDaily.details_json)
            .filter(StockFeatureDaily.run_id == run_id)
            .all()
        )

    if as_of is None or not rows:
        _emit(f"### IBD-50 diagnosis ({market})\n\nFeature run {run_id} has no rows.")
        return 0

    reference = _nearest_reference(references, as_of, max_gap_days)
    if reference is None:
        _emit(f"### IBD-50 diagnosis ({market})\n\nNo reference within {max_gap_days}d of {as_of}.")
        return 0

    by_symbol = {symbol: (details or {}) for symbol, details in rows}

    gates = DEFAULT_GATES
    lines = [
        f"### IBD-50 diagnosis ({market})",
        "",
        f"Feature run id={run_id} as_of={as_of.isoformat()} ({len(by_symbol)} rows) "
        f"vs reference {reference.as_of_date} ({len(reference.symbols)} names)",
        "",
        "| sym | in run | comp | eps | rs | grp | smr | acc | hi-dist | verdict |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]

    missing = 0
    passes_all = 0
    gate_fail_counts: dict[str, int] = {}
    present = 0
    for symbol in reference.symbols:
        details = by_symbol.get(symbol)
        if details is None:
            missing += 1
            lines.append(f"| {symbol} | no | - | - | - | - | - | - | - | **MISSING** |")
            continue
        present += 1
        row = {f: details.get(f) for f in _FIELDS}
        fails = _gate_failures(row, gates)
        if not fails:
            passes_all += 1
            verdict = "PASS"
        else:
            verdict = "excl: " + ", ".join(fails)
            for f in fails:
                key = f.split("<")[0].split(">")[0]
                gate_fail_counts[key] = gate_fail_counts.get(key, 0) + 1
        lines.append(
            f"| {symbol} | yes | {_fmt(row['composite_rating'])} | {_fmt(row['eps_rating'])} "
            f"| {_fmt(row['rs_rating'])} | {_fmt(row['ibd_group_rank'])} | {_fmt(row['smr_rating'])} "
            f"| {_fmt(row['acc_dis_rating'])} | {_fmt(row['week_52_high_distance'])} | {verdict} |"
        )

    lines += [
        "",
        f"**Roll-up:** {len(reference.symbols)} IBD names — "
        f"{present} in run, {missing} missing, {passes_all} pass all IBD-50 gates.",
    ]
    if gate_fail_counts:
        breakdown = ", ".join(
            f"{gate}: {count}" for gate, count in sorted(gate_fail_counts.items())
        )
        lines.append(f"Gate exclusions among present names — {breakdown}.")
    _emit("\n".join(lines))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", default="US")
    parser.add_argument("--reference-dir", default=None)
    parser.add_argument("--list-type", default="ibd50")
    parser.add_argument("--max-gap-days", type=int, default=7)
    args = parser.parse_args()

    from app.scripts._runtime import prepare_runtime, repo_root

    prepare_runtime()
    reference_dir = args.reference_dir or str(repo_root() / "data" / "ibd_reference")
    try:
        return _run(
            market=args.market.upper(),
            reference_dir=reference_dir,
            list_type=args.list_type,
            max_gap_days=args.max_gap_days,
        )
    except Exception as exc:  # pragma: no cover - guard so the build never breaks
        _emit(f"### IBD-50 diagnosis ({args.market})\n\nSkipped (error: {exc}).")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
