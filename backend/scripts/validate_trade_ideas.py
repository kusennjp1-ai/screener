#!/usr/bin/env python3
"""THE fixed ground-truth harness — score the screener against Minervini's own
908 published trade ideas (1997-2022, 696 tickers).

Every improvement cycle runs THIS script with THIS metric set and THIS table
format, so numbers are comparable across cycles. The metric set is FROZEN —
adding a new metric to claim improvement is forbidden (docs/SPEC.md §Validation).

Frozen metrics (all measured at the idea date T0 with data truncated at T0 —
zero look-ahead):

  COV%     ideas analyzable (>=210 prior bars in the bundle) / ideas attempted
  TT%      Minervini scanner Trend Template pass (details.passes_template)
  S2%      Markets360 TPR band == strong (Stage-2 trend read)
  SETUP%   Markets360 watchlist condition (passes: TPR strong + RPR>=70 +
           pressure buy/neutral + buy-risk low/medium)
  RS70%    Minervini RS rating >= 70
  FIRE±5%  an actionable entry tell fires within T-5..T+5 trading days:
           VCP near_pivot / ready_for_breakout, or pocket pivot
  MSCORE   median Markets360 composite score
  GATE%    buyable_now with the market-regime gate (needs SPY in the bundle)

Plus a CONTROL row: every idea re-evaluated at T0 - 63 trading days (one
quarter earlier, same stock). The DISCRIMINATION of each metric is
(entry-row - control-row): a signal that fires just as often a quarter before
Minervini's entry as at the entry carries no timing information. Hit rates
alone can be gamed by an always-on signal; the control delta cannot.

Interpretation: these ideas are what Minervini HIMSELF bought/flagged. A
faithful SEPA screener should clear TT/S2/SETUP on a large majority of them
AND show a positive control delta on the timing metrics (FIRE±5, SETUP).

Inputs (offline; no network):
  --bundle DIR    per-ticker {TICKER}.csv.gz + _SPY.csv.gz from
                  scripts/fetch_trade_idea_windows.py (default
                  backend/calibration/trade_idea_windows)
  --fixtures      SMOKE mode: run mechanics on tests/fixtures/markets360 with
                  pseudo idea dates (mechanics check only — NOT a truth metric)

  cd backend
  PYTHONPATH=. python3 scripts/validate_trade_ideas.py
  PYTHONPATH=. python3 scripts/validate_trade_ideas.py --fixtures
  PYTHONPATH=. python3 scripts/validate_trade_ideas.py --json report.json
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

_BACKEND = Path(__file__).resolve().parents[1]
_REPO_ROOT = _BACKEND.parent
sys.path.insert(0, str(_BACKEND))

IDEAS_CSV = _REPO_ROOT / "data" / "minervini_trade_ideas.csv"
DEFAULT_BUNDLE = _BACKEND / "calibration" / "trade_idea_windows"
FIXTURES_DIR = _BACKEND / "tests" / "fixtures" / "markets360"

MIN_PRIOR_BARS = 210         # 200DMA + slack
FIRE_WINDOW = 5              # trading days each side of T0 for FIRE±5
CONTROL_OFFSET_BARS = 63     # control sample: same stock, one quarter earlier


# --------------------------------------------------------------------------- #
# data loading
# --------------------------------------------------------------------------- #
def read_gz_csv(path: Path) -> Optional[pd.DataFrame]:
    try:
        raw = gzip.decompress(path.read_bytes()).decode("utf-8")
        df = pd.read_csv(io.StringIO(raw), index_col="Date", parse_dates=True)
    except Exception:  # noqa: BLE001
        return None
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
    df = df[keep].dropna()
    return df if len(df) else None


def read_fixture_csv(path: Path) -> Optional[pd.DataFrame]:
    """yfinance multi-header fixture format used by tests/fixtures/markets360."""
    try:
        df = pd.read_csv(path, header=[0, 1], index_col=0)
        df.index = pd.to_datetime(df.index)
        df.columns = df.columns.get_level_values(0)
    except Exception:  # noqa: BLE001
        return None
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
    df = df[keep].dropna()
    return df if len(df) else None


def load_ideas() -> List[dict]:
    with open(IDEAS_CSV, newline="", encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if r.get("Ticker") and r.get("Date")]


# --------------------------------------------------------------------------- #
# per-idea evaluation (pure; everything truncated at T0 — no look-ahead)
# --------------------------------------------------------------------------- #
def evaluate_idea(
    price: pd.DataFrame,
    spy: Optional[pd.DataFrame],
    t0: pd.Timestamp,
) -> Optional[Dict[str, object]]:
    """Evaluate one idea at T0. Returns None when < MIN_PRIOR_BARS history."""
    from app.scanners.base_screener import StockData
    from app.scanners.minervini_scanner import MinerviniScanner
    from app.scanners.markets360_scanner import Markets360Scanner
    from app.services.markets360.vcp_footprint import compute_vcp_footprint
    from app.services.markets360.entry_signals import compute_entry_signals

    hist = price[price.index <= t0]
    if len(hist) < MIN_PRIOR_BARS:
        return None
    spy_hist = spy[spy.index <= t0] if spy is not None else None
    if spy_hist is not None and len(spy_hist) < MIN_PRIOR_BARS:
        spy_hist = None

    sd = StockData(symbol="X", price_data=hist, benchmark_data=spy_hist, market="US")

    m360 = Markets360Scanner().scan_stock("X", sd)
    tt_pass = rs70 = None
    if spy_hist is not None:
        minv = MinerviniScanner().scan_stock("X", sd)
        d = minv.details or {}
        if d.get("reason") != "insufficient_price_history" and "passes_template" in d:
            tt_pass = bool(d.get("passes_template"))
            rs = d.get("rs_rating")
            rs70 = bool(rs is not None and rs >= 70)

    det = m360.details or {}
    s2 = det.get("tpr_state") == "strong" if det.get("tpr_state") is not None else None

    # FIRE±5: walk T-5..T+5 bars; cheap pure signals only (footprint + pocket pivot).
    idx = price.index
    pos = idx.searchsorted(t0, side="right") - 1
    fired = False
    for p in range(max(0, pos - FIRE_WINDOW), min(len(idx) - 1, pos + FIRE_WINDOW) + 1):
        w = price.iloc[: p + 1]
        if len(w) < MIN_PRIOR_BARS:
            continue
        vcp = compute_vcp_footprint(w)
        if vcp.get("near_pivot") or vcp.get("ready_for_breakout"):
            fired = True
            break
        if compute_entry_signals(w).get("pocket_pivot"):
            fired = True
            break

    return {
        "tt": tt_pass,
        "s2": s2,
        "setup": bool(m360.passes),
        "rs70": rs70,
        "fire": fired,
        "score": float(m360.score),
        "gate": det.get("buyable_now") if spy_hist is not None else None,
    }


# --------------------------------------------------------------------------- #
# aggregation — FROZEN table format
# --------------------------------------------------------------------------- #
def _pct(vals: List[Optional[bool]]) -> Optional[float]:
    known = [v for v in vals if v is not None]
    return round(100.0 * sum(known) / len(known), 1) if known else None


def aggregate(rows: List[dict], attempted: int) -> Dict[str, object]:
    return {
        "n": len(rows),
        "cov_pct": round(100.0 * len(rows) / attempted, 1) if attempted else None,
        "tt_pct": _pct([r["tt"] for r in rows]),
        "s2_pct": _pct([r["s2"] for r in rows]),
        "setup_pct": _pct([r["setup"] for r in rows]),
        "rs70_pct": _pct([r["rs70"] for r in rows]),
        "fire_pct": _pct([r["fire"] for r in rows]),
        "mscore": round(float(np.median([r["score"] for r in rows])), 1) if rows else None,
        "gate_pct": _pct([r["gate"] for r in rows]),
    }


def render_table(overall: Dict, per_year: Dict[str, Dict],
                 control: Optional[Dict] = None) -> str:
    cols = ["n", "cov_pct", "tt_pct", "s2_pct", "setup_pct", "rs70_pct",
            "fire_pct", "mscore", "gate_pct"]
    hdr = ["year", "n", "COV%", "TT%", "S2%", "SETUP%", "RS70%", "FIRE±5%", "MSCORE", "GATE%"]

    def fmt(v):
        return "—" if v is None else (f"{v:.1f}" if isinstance(v, float) else str(v))

    lines = ["| " + " | ".join(hdr) + " |",
             "|" + "---|" * len(hdr)]
    lines.append("| **ALL** | " + " | ".join(fmt(overall[c]) for c in cols) + " |")
    if control is not None:
        lines.append("| CONTROL (T0−63) | " + " | ".join(fmt(control[c]) for c in cols) + " |")
    for y in sorted(per_year):
        lines.append(f"| {y} | " + " | ".join(fmt(per_year[y][c]) for c in cols) + " |")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# runners
# --------------------------------------------------------------------------- #
def run_bundle(bundle: Path, since_year: Optional[int], limit: Optional[int],
               json_out: Optional[str]) -> int:
    ideas = load_ideas()
    if since_year:
        ideas = [r for r in ideas if int(r["Year"]) >= since_year]
    if limit:
        ideas = ideas[:limit]
    if not bundle.exists():
        print(f"bundle not found: {bundle}\n"
              "run scripts/fetch_trade_idea_windows.py in a network-enabled "
              "environment first, or use --fixtures for a mechanics smoke run.",
              file=sys.stderr)
        return 2

    spy = read_gz_csv(bundle / "_SPY.csv.gz")
    cache: Dict[str, Optional[pd.DataFrame]] = {}
    results: List[dict] = []
    controls: List[dict] = []
    year_rows: Dict[str, List[dict]] = defaultdict(list)
    year_attempted: Dict[str, int] = defaultdict(int)
    attempted = 0

    for r in ideas:
        t = r["Ticker"].strip().upper()
        if t not in cache:
            cache[t] = read_gz_csv(bundle / f"{t}.csv.gz")
        price = cache[t]
        attempted += 1
        year_attempted[r["Year"]] += 1
        if price is None:
            continue
        t0 = pd.Timestamp(r["Date"])
        ev = evaluate_idea(price, spy, t0)
        if ev is None:
            continue
        ev["year"] = r["Year"]
        results.append(ev)
        year_rows[r["Year"]].append(ev)

        # Deterministic control: same stock, one quarter before the entry.
        pos = price.index.searchsorted(t0, side="right") - 1
        cpos = pos - CONTROL_OFFSET_BARS
        if cpos >= MIN_PRIOR_BARS:
            cev = evaluate_idea(price, spy, price.index[cpos])
            if cev is not None:
                controls.append(cev)

    overall = aggregate(results, attempted)
    control = aggregate(controls, len(controls)) if controls else None
    per_year = {y: aggregate(rows, year_attempted[y]) for y, rows in year_rows.items()}

    print("# Trade-idea ground-truth validation (908 Minervini ideas)\n")
    print(f"bundle: {bundle}  ideas attempted: {attempted}\n")
    print(render_table(overall, per_year, control=control))
    if control:
        d_fire = (overall["fire_pct"] or 0) - (control["fire_pct"] or 0)
        d_setup = (overall["setup_pct"] or 0) - (control["setup_pct"] or 0)
        print(f"\nDISCRIMINATION (entry − control): FIRE±5 {d_fire:+.1f}pp, "
              f"SETUP {d_setup:+.1f}pp")
    if json_out:
        Path(json_out).write_text(json.dumps(
            {"overall": overall, "control": control, "per_year": per_year}, indent=2))
        print(f"\njson -> {json_out}")
    return 0


def run_fixtures_smoke() -> int:
    """Mechanics-only smoke on the committed fixtures (NOT a truth metric)."""
    spy = read_fixture_csv(FIXTURES_DIR / "spy.csv")
    results: List[dict] = []
    attempted = 0
    for p in sorted(FIXTURES_DIR.glob("*.csv")):
        if p.stem == "spy":
            continue
        price = read_fixture_csv(p)
        if price is None:
            continue
        # pseudo idea dates: 60% and 95% through the fixture window
        for frac in (0.6, 0.95):
            attempted += 1
            t0 = price.index[int(len(price) * frac) - 1]
            ev = evaluate_idea(price, spy, t0)
            if ev is not None:
                results.append(ev)
    overall = aggregate(results, attempted)
    print("# SMOKE (fixtures, pseudo dates — mechanics only, NOT ground truth)\n")
    print(render_table(overall, {}))
    return 0


def main() -> int:
    import logging
    logging.basicConfig(level=logging.ERROR)  # keep the fixed report clean
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", default=str(DEFAULT_BUNDLE))
    ap.add_argument("--fixtures", action="store_true", help="mechanics smoke on fixtures")
    ap.add_argument("--since-year", type=int, default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--json", dest="json_out", default=None)
    args = ap.parse_args()

    if args.fixtures:
        return run_fixtures_smoke()
    return run_bundle(Path(args.bundle), args.since_year, args.limit, args.json_out)


if __name__ == "__main__":
    raise SystemExit(main())
