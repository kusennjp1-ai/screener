#!/usr/bin/env python3
"""Auxiliary Setup Engine readiness probe on the 908 Minervini trade ideas.

NOT a frozen metric. ``scripts/validate_trade_ideas.py`` is the frozen
harness and is neither changed nor called here. Its SETUP% column is the
Markets360 watchlist condition (``Markets360Scanner().passes``). It cannot
see Setup Engine readiness (``setup_ready``), so its "SETUP +52.0pp"
discrimination says nothing about the gates this probe counts (round 3,
finding p1-5).

What it does (offline; reads only the committed 908 bundle):
  * Ideas come from ``data/minervini_trade_ideas.csv`` and bars from
    ``backend/calibration/trade_idea_windows/{TICKER}.csv.gz`` plus
    ``_SPY.csv.gz``, read with the frozen harness's own loaders. They are
    imported, never patched.
  * ENTRY: each idea at its date T0. The stock and the benchmark are both cut
    at T0 before any scanner sees them (zero look-ahead, ``truncate_at``).
  * CONTROL: the same stock CONTROL_OFFSET_BARS (63) bars before T0, as the
    frozen harness does: position = last bar at or before T0, minus 63, kept
    only when that position is >= MIN_PRIOR_BARS (210). A control is
    evaluated only when its entry was.
  * Both run ``MinerviniScanner`` (trend template and Minervini stage) and
    ``SetupEngineScanner`` (setup_ready, failed checks, SE stage, pivot,
    volume ratio) on symbol "X", as the frozen harness does.

Round-2 definitions, kept so the figures stay comparable:
  * An idea is skipped when the stock OR SPY has fewer than 210 bars at T0.
    The frozen harness keeps such an idea and runs it without SPY.
  * "Breakout day" is the engine's own last-bar volume_vs_50d >= 1.4 (the
    50-day mean includes that day) with distance_to_pivot_pct > 0 against
    its primary pivot. It is not the brief's prior-50 crossing rule.
  * Rates use every evaluated row as the denominator. A setup_ready the
    engine did not return (scan error) is counted apart as
    ``ready_unknown_n``, never as a pass or a fail. On short data the engine
    itself returns setup_ready False with no setup score and skips the
    gates; those rows are ``setup_score_none_n`` and their checks are listed
    under "other failed checks". A missing volume ratio or pivot distance
    is ``breakout_day_unknown_n``.
  * "Minervini stage" is ``MinerviniScanner`` details['stage'] (round 2's
    stage-2 share). "SE stage" is the Setup Engine payload's ``stage``
    (``quick_stage_check``), the input to gate 8.

Readiness gates (``app/analysis/patterns/explain_builder.py``): 1 setup
score, 2 quality, 3 readiness, 4 early zone, 5 ATR14, 6 volume dry-up,
7 RS leadership, 8 stage, 9 MA alignment, 10 RS rating. Gate 6's failure
was named ``volume_below_minimum`` before round 2 and is
``volume_above_dryup_cap`` now; both count as gate 6.

Reference (round 2, reproduced at 8849bf9): setup_ready 28/588 entries
vs 23/575 controls (+0.8pp); gate 6 fails 458/588 entries; 0 ready among
the 215 entries on a breakout day. The frozen harness on the same tree
prints "DISCRIMINATION (entry − control): FIRE±5 +25.8pp, SETUP +52.0pp";
that SETUP is Markets360's, not this readiness.

  cd backend
  DATABASE_URL="postgresql://local/none" venv/bin/python \\
      scripts/probe_setup_ready_908.py --json /path/to/probe.json [--rows]

The run takes about 5.5 minutes. The JSON is deterministic (sorted keys,
no timing), so two trees can be diffed; --rows adds every evaluated row.
Exit 2 when the bundle or ``_SPY.csv.gz`` is absent: every 908 figure is
then 未検証 (not verified).
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import numbers
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd

_SCRIPTS = Path(__file__).resolve().parent
_BACKEND = _SCRIPTS.parent
for _p in (str(_BACKEND), str(_SCRIPTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Pure import of the frozen harness's loaders and control-rule constants.
from validate_trade_ideas import (  # noqa: E402
    CONTROL_OFFSET_BARS,
    DEFAULT_BUNDLE,
    MIN_PRIOR_BARS,
    load_ideas,
    read_gz_csv,
)

SYMBOL = "X"  # symbol-blind, as in the frozen harness
BREAKOUT_VOLUME_VS_50D_MIN = 1.4  # round 2's breakout-day volume ratio
BREAKOUT_DISTANCE_TO_PIVOT_MIN_PCT = 0.0  # close strictly above the pivot

# Failed-check name -> readiness gate number (explain_builder.py).
GATE_OF_CHECK: Dict[str, int] = {
    "setup_score_below_threshold": 1,
    "quality_below_threshold": 2,
    "readiness_below_threshold": 3,
    "outside_early_zone": 4,
    "atr14_pct_exceeds_limit": 5,
    "volume_above_dryup_cap": 6,
    "volume_below_minimum": 6,  # gate 6's name before round 2
    "rs_leadership_insufficient": 7,
    "stage_not_ok": 8,
    "ma_alignment_insufficient": 9,
    "rs_rating_insufficient": 10,
}
GATES = tuple(range(1, 11))
SIDES = ("entry", "control")

SKIP_NO_BUNDLE_FILE = "no_bundle_file"
SKIP_SHORT_HISTORY = "short_history"
SKIP_SHORT_SPY = "short_spy"
SKIP_CONTROL_TOO_EARLY = "control_before_min_prior_bars"

# (Minervini scanner factory, Setup Engine scanner factory); injectable for tests.
ScannerFactories = Tuple[Callable[[], object], Callable[[], object]]


# --------------------------------------------------------------------------- #
# pure helpers: look-ahead truncation and control selection
# --------------------------------------------------------------------------- #
def truncate_at(frame: pd.DataFrame, t0: pd.Timestamp) -> pd.DataFrame:
    """Bars dated on or before T0 only."""
    return frame[frame.index <= t0]


def bar_position(index: pd.DatetimeIndex, t0: pd.Timestamp) -> int:
    """Position of the last bar on or before T0 (-1 when T0 precedes all bars)."""
    return int(index.searchsorted(t0, side="right")) - 1


def control_t0(index: pd.DatetimeIndex, t0: pd.Timestamp) -> Optional[pd.Timestamp]:
    """The control's date: CONTROL_OFFSET_BARS bars before T0's bar, or None
    when that bar has fewer than MIN_PRIOR_BARS bars before it."""
    cpos = bar_position(index, t0) - CONTROL_OFFSET_BARS
    if cpos < MIN_PRIOR_BARS:
        return None
    return index[cpos]


# --------------------------------------------------------------------------- #
# one evaluation (everything cut at T0)
# --------------------------------------------------------------------------- #
def default_scanners() -> ScannerFactories:
    from app.scanners.minervini_scanner import MinerviniScanner
    from app.scanners.setup_engine_screener import SetupEngineScanner

    return MinerviniScanner, SetupEngineScanner


def _flag(value) -> Optional[bool]:
    """A real boolean (Python or numpy), else None: missing stays missing."""
    return bool(value) if isinstance(value, (bool, np.bool_)) else None


def _num(value) -> Optional[float]:
    """A finite number, else None (bools, NaN and non-numbers are missing)."""
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, numbers.Real):
        return None
    v = float(value)
    return v if math.isfinite(v) else None


def _stage(value) -> Optional[int]:
    v = _num(value)
    return int(v) if v is not None and v == int(v) else None


def evaluate_point(
    price: pd.DataFrame,
    spy: pd.DataFrame,
    t0: pd.Timestamp,
    scanners: Optional[ScannerFactories] = None,
) -> Tuple[Optional[dict], Optional[str]]:
    """Run both scanners on bars up to T0. Returns (record, None) or (None, skip reason)."""
    from app.scanners.base_screener import StockData

    hist = truncate_at(price, t0)
    if len(hist) < MIN_PRIOR_BARS:
        return None, SKIP_SHORT_HISTORY
    spy_hist = truncate_at(spy, t0)
    if len(spy_hist) < MIN_PRIOR_BARS:
        return None, SKIP_SHORT_SPY

    minervini_factory, setup_engine_factory = scanners or default_scanners()
    sd = StockData(symbol=SYMBOL, price_data=hist, benchmark_data=spy_hist, market="US")
    mv = minervini_factory().scan_stock(SYMBOL, sd).details or {}
    se_details = setup_engine_factory().scan_stock(SYMBOL, sd).details or {}
    se = se_details.get("setup_engine")

    if not isinstance(se, dict):
        se_status = "error" if "error" in se_details else "no_payload"
        se = {}
    else:
        se_status = "ok"
    explain = se.get("explain") or {}
    return {
        "as_of": hist.index[-1].date().isoformat(),
        "se_status": se_status,
        "ready": _flag(se.get("setup_ready")),
        "failed": list(explain.get("failed_checks") or []),
        "setup_score": _num(se.get("setup_score")),
        "se_stage": _stage(se.get("stage")),
        "mv_stage": _stage(mv.get("stage")),
        "tt": _flag(mv.get("passes_template")),
        "primary": se.get("pattern_primary") or None,
        "pivot": _num(se.get("pivot_price")),
        "vol": _num(se.get("volume_vs_50d")),
        "dist": _num(se.get("distance_to_pivot_pct")),
    }, None


# --------------------------------------------------------------------------- #
# run over the bundle
# --------------------------------------------------------------------------- #
def run_probe(
    ideas: Iterable[dict],
    bundle: Path,
    spy: pd.DataFrame,
    scanners: Optional[ScannerFactories] = None,
) -> dict:
    rows: Dict[str, List[dict]] = {side: [] for side in SIDES}
    skips: Dict[str, Counter] = {side: Counter() for side in SIDES}
    cache: Dict[str, Optional[pd.DataFrame]] = {}
    attempted = 0
    for idea in ideas:
        attempted += 1
        ticker = idea["Ticker"].strip().upper()
        if ticker not in cache:
            cache[ticker] = read_gz_csv(bundle / f"{ticker}.csv.gz")
        price = cache[ticker]
        if price is None:
            skips["entry"][SKIP_NO_BUNDLE_FILE] += 1
            continue
        t0 = pd.Timestamp(idea["Date"])
        rec, reason = evaluate_point(price, spy, t0, scanners)
        if rec is None:
            skips["entry"][reason] += 1
            continue
        rec.update(ticker=ticker, idea_date=idea["Date"])
        rows["entry"].append(rec)

        ct0 = control_t0(price.index, t0)
        if ct0 is None:
            skips["control"][SKIP_CONTROL_TOO_EARLY] += 1
            continue
        crec, creason = evaluate_point(price, spy, ct0, scanners)
        if crec is None:
            skips["control"][creason] += 1
            continue
        crec.update(ticker=ticker, idea_date=idea["Date"])
        rows["control"].append(crec)
    return {"attempted": attempted, "rows": rows, "skips": skips}


# --------------------------------------------------------------------------- #
# summary
# --------------------------------------------------------------------------- #
def _pct(k: int, n: int) -> Optional[float]:
    return round(100.0 * k / n, 1) if n else None


def is_breakout_day(rec: dict) -> Optional[bool]:
    """None when the volume ratio or the pivot distance is missing."""
    if rec["vol"] is None or rec["dist"] is None:
        return None
    return rec["vol"] >= BREAKOUT_VOLUME_VS_50D_MIN and rec["dist"] > BREAKOUT_DISTANCE_TO_PIVOT_MIN_PCT


def summarize_side(rs: List[dict]) -> dict:
    n = len(rs)
    ready_n = sum(1 for r in rs if r["ready"] is True)
    gate_fail = {g: 0 for g in GATES}
    other_failed: Counter = Counter()
    all_failed: Counter = Counter()
    for r in rs:
        gates_hit = set()
        for check in r["failed"]:
            all_failed[check] += 1
            gate = GATE_OF_CHECK.get(check)
            if gate is None:
                other_failed[check] += 1
            else:
                gates_hit.add(gate)
        for g in gates_hit:
            gate_fail[g] += 1
    mv_stage = Counter(str(r["mv_stage"]) for r in rs)
    se_stage = Counter(str(r["se_stage"]) for r in rs)
    tt = [r for r in rs if r["tt"] is True]
    bo = [is_breakout_day(r) for r in rs]
    bo_rows = [r for r, b in zip(rs, bo) if b is True]
    ready_vols = [r["vol"] for r in rs if r["ready"] is True and r["vol"] is not None]
    return {
        "n": n,
        "ready_n": ready_n,
        "ready_pct": _pct(ready_n, n),
        "ready_unknown_n": sum(1 for r in rs if r["ready"] is None),
        "se_status": dict(Counter(r["se_status"] for r in rs)),
        "setup_score_none_n": sum(1 for r in rs if r["setup_score"] is None),
        "gate_fail_n": {str(g): gate_fail[g] for g in GATES},
        "gate_fail_pct": {str(g): _pct(gate_fail[g], n) for g in GATES},
        "other_failed_checks": dict(other_failed),
        "failed_checks": dict(all_failed),
        "minervini_stage_counts": dict(mv_stage),
        "minervini_stage2_pct": _pct(mv_stage.get("2", 0), n),
        "minervini_stage3_pct": _pct(mv_stage.get("3", 0), n),
        "minervini_stage_unknown_n": mv_stage.get("None", 0),
        "se_stage_counts": dict(se_stage),
        "se_stage2_pct": _pct(se_stage.get("2", 0), n),
        "se_stage_unknown_n": se_stage.get("None", 0),
        "tt_n": len(tt),
        "minervini_stage2_among_tt_pct": _pct(sum(1 for r in tt if r["mv_stage"] == 2), len(tt)),
        "no_primary_n": sum(1 for r in rs if not r["primary"]),
        "breakout_day_n": len(bo_rows),
        "breakout_day_unknown_n": sum(1 for b in bo if b is None),
        "ready_on_breakout_day_n": sum(1 for r in bo_rows if r["ready"] is True),
        "ready_volume_vs_50d_max": max(ready_vols) if ready_vols else None,
    }


def _delta_pp(k1: int, n1: int, k2: int, n2: int) -> Optional[float]:
    if not n1 or not n2:
        return None
    return round(100.0 * k1 / n1 - 100.0 * k2 / n2, 1)


def summarize(result: dict, include_rows: bool = False) -> dict:
    e_rows, c_rows = result["rows"]["entry"], result["rows"]["control"]
    entry, control = summarize_side(e_rows), summarize_side(c_rows)
    ne, nc = entry["n"], control["n"]
    out = {
        "probe": "probe_setup_ready_908",
        "frozen_metric": False,
        "caveat": (
            "validate_trade_ideas.py SETUP% is Markets360 (Markets360Scanner.passes); "
            "it cannot see Setup Engine setup_ready (p1-5)."
        ),
        "definitions": {
            "min_prior_bars": MIN_PRIOR_BARS,
            "control_offset_bars": CONTROL_OFFSET_BARS,
            "breakout_volume_vs_50d_min": BREAKOUT_VOLUME_VS_50D_MIN,
            "breakout_distance_to_pivot_min_pct": BREAKOUT_DISTANCE_TO_PIVOT_MIN_PCT,
            "gate_of_check": GATE_OF_CHECK,
        },
        "ideas_attempted": result["attempted"],
        "skips": {side: dict(result["skips"][side]) for side in SIDES},
        "entry": entry,
        "control": control,
        "discrimination_pp": {
            "setup_ready": _delta_pp(entry["ready_n"], ne, control["ready_n"], nc),
            "minervini_stage2": _delta_pp(
                entry["minervini_stage_counts"].get("2", 0), ne,
                control["minervini_stage_counts"].get("2", 0), nc),
            "se_stage2": _delta_pp(
                entry["se_stage_counts"].get("2", 0), ne,
                control["se_stage_counts"].get("2", 0), nc),
            "gate_fail": {
                str(g): _delta_pp(entry["gate_fail_n"][str(g)], ne,
                                  control["gate_fail_n"][str(g)], nc)
                for g in GATES
            },
        },
        "ready_ideas": {
            side: [[r["ticker"], r["idea_date"], r["as_of"]]
                   for r in result["rows"][side] if r["ready"] is True]
            for side in SIDES
        },
    }
    if include_rows:
        out["rows"] = result["rows"]
    return out


_GATE_LABEL = {
    1: "setup score", 2: "quality", 3: "readiness", 4: "early zone", 5: "ATR14",
    6: "volume dry-up", 7: "RS leadership", 8: "stage", 9: "MA alignment", 10: "RS rating",
}


def render_text(s: dict) -> str:
    e, c, d = s["entry"], s["control"], s["discrimination_pp"]

    def frac(k, n):
        pct = _pct(k, n)
        return f"{k}/{n} ({'—' if pct is None else f'{pct:.1f}%'})"

    def dpp(v):
        return "—" if v is None else f"{v:+.1f}pp"

    lines = [
        "# Setup Engine readiness on the 908 ideas (auxiliary probe, NOT the frozen harness)",
        f"ideas attempted {s['ideas_attempted']}; skipped entries {s['skips']['entry']}; "
        f"skipped controls {s['skips']['control']}",
        "",
        f"{'':34}{'ENTRY':>18}{'CONTROL (T0-63)':>20}{'DELTA':>10}",
        f"{'setup_ready':34}{frac(e['ready_n'], e['n']):>18}"
        f"{frac(c['ready_n'], c['n']):>20}{dpp(d['setup_ready']):>10}",
        f"{'Minervini stage 2':34}{frac(e['minervini_stage_counts'].get('2', 0), e['n']):>18}"
        f"{frac(c['minervini_stage_counts'].get('2', 0), c['n']):>20}{dpp(d['minervini_stage2']):>10}",
        f"{'SE stage 2 (gate 8 input)':34}{frac(e['se_stage_counts'].get('2', 0), e['n']):>18}"
        f"{frac(c['se_stage_counts'].get('2', 0), c['n']):>20}{dpp(d['se_stage2']):>10}",
        "gate failures (rows failing the gate):",
    ]
    for g in GATES:
        k = str(g)
        lines.append(
            f"{'  G' + k + ' ' + _GATE_LABEL[g]:34}{frac(e['gate_fail_n'][k], e['n']):>18}"
            f"{frac(c['gate_fail_n'][k], c['n']):>20}{dpp(d['gate_fail'][k]):>10}")
    for side, v in (("entry", e), ("control", c)):
        if v["other_failed_checks"]:
            lines.append(f"  other failed checks ({side}): {v['other_failed_checks']}")
    lines += [
        f"breakout day (volume_vs_50d >= {BREAKOUT_VOLUME_VS_50D_MIN}, close above pivot): "
        f"entries {e['breakout_day_n']} (ready {e['ready_on_breakout_day_n']}), "
        f"controls {c['breakout_day_n']} (ready {c['ready_on_breakout_day_n']})",
        f"unknown: ready entry {e['ready_unknown_n']} / control {c['ready_unknown_n']}; "
        f"setup_score None entry {e['setup_score_none_n']} / control {c['setup_score_none_n']}; "
        f"breakout inputs missing entry {e['breakout_day_unknown_n']} "
        f"/ control {c['breakout_day_unknown_n']}",
    ]
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--bundle", default=str(DEFAULT_BUNDLE))
    ap.add_argument("--limit", type=int, default=None, help="first N ideas only")
    ap.add_argument("--json", dest="json_out", default=None)
    ap.add_argument("--rows", action="store_true", help="include every evaluated row in the JSON")
    args = ap.parse_args(argv)

    bundle = Path(args.bundle)
    spy = read_gz_csv(bundle / "_SPY.csv.gz") if bundle.is_dir() else None
    if spy is None:
        print(f"908 bundle or _SPY.csv.gz not found under {bundle}: every 908 figure is "
              "未検証 (not verified). No JSON written.", file=sys.stderr)
        return 2

    ideas = load_ideas()
    if args.limit:
        ideas = ideas[: args.limit]
    previous_disable = logging.root.manager.disable
    logging.disable(logging.WARNING)  # scanner warnings off for the run only
    try:
        started = time.perf_counter()
        summary = summarize(run_probe(ideas, bundle, spy), include_rows=args.rows)
        elapsed = time.perf_counter() - started
    finally:
        logging.disable(previous_disable)
    print(render_text(summary))
    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(summary, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8")
        print(f"json -> {args.json_out}")
    print(f"runtime {elapsed:.1f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
