"""Calibrate the VCP detector against Minervini's real trade ideas.

Treats ``calibration/minervini_trade_ideas.csv`` (ticker + date of ~900 setups
William O'Neil-style growth trader Mark Minervini publicly referenced) as
ground truth: for each setup we fetch the daily price history ending at that
date and run our ``VCPDetector`` on the trailing window, then report how many of
those *real* setups our detector would have flagged as a VCP — i.e. the
detector's recall on Minervini's own picks — plus where it falls short.

The detector is instantiated with ``min_bases=2`` so we capture the sub-metrics
even for 2-contraction bases (Minervini trades 2-6 contractions); the report
then simulates several gate variants (stricter/looser ``min_bases``, VCP-score
cutoff, whether volume contraction is mandatory) so we can see which threshold
change recovers the most real setups before touching the production detector.

Network: needs Yahoo Finance (yfinance). Many pre-2015 / delisted tickers won't
fetch; the report shows the fetch success rate. Run from CI, not the sandbox.

Usage:
    python -m scripts.calibrate_vcp --since-year 2016 --limit 400
    python -m scripts.calibrate_vcp --tickers AAPL,CRWD,PANW --markdown out.md
"""
from __future__ import annotations

import argparse
import statistics
import sys
from datetime import timedelta
from pathlib import Path

import pandas as pd

from app.analysis.patterns.legacy_vcp_detection import VCPDetector

CSV_PATH = Path(__file__).resolve().parent.parent / "calibration" / "minervini_trade_ideas.csv"
LOOKBACK_DAYS = 420
MIN_BARS = 90  # need enough history for 3 SMAs / ATR / multiple bases


def _download(symbol: str, start: str, end: str):
    import yfinance as yf

    try:
        df = yf.download(symbol, start=start, end=end, auto_adjust=True, progress=False, threads=False)
    except Exception:  # noqa: BLE001
        return None
    if df is None or df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
    return df[keep].dropna()


def _evaluate(detector: VCPDetector, df: pd.DataFrame) -> dict | None:
    """Run detect_vcp on the trailing window (most-recent-first) of ``df``."""
    if df is None or len(df) < MIN_BARS:
        return None
    close_rev = df["Close"][::-1].reset_index(drop=True)
    vol_rev = df["Volume"][::-1].reset_index(drop=True)
    res = detector.detect_vcp(close_rev, vol_rev)
    high_52w = float(df["Close"].tail(252).max())
    last = float(df["Close"].iloc[-1])
    res["_dist_from_high"] = round((last - high_52w) / high_52w * 100, 1) if high_52w else None
    return res


def _gate(res: dict, *, min_bases: int, min_score: float, require_volume: bool) -> bool:
    if int(res.get("num_bases", 0) or 0) < min_bases:
        return False
    if float(res.get("vcp_score", 0) or 0) < min_score:
        return False
    if not res.get("contracting_depth"):
        return False
    if not res.get("tight_near_highs"):
        return False
    if require_volume and not res.get("contracting_volume"):
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since-year", type=int, default=2016)
    parser.add_argument("--limit", type=int, default=400, help="max setups to evaluate")
    parser.add_argument("--tickers", type=str, default=None, help="comma-separated override list")
    parser.add_argument("--markdown", type=str, default=None)
    args = parser.parse_args()

    rows = pd.read_csv(CSV_PATH)
    rows = rows.drop_duplicates(subset=["Ticker", "Date"])
    if args.tickers:
        wanted = {t.strip().upper() for t in args.tickers.split(",")}
        rows = rows[rows["Ticker"].str.upper().isin(wanted)]
    else:
        rows = rows[rows["Year"] >= args.since_year]
    rows = rows.head(args.limit)

    detector = VCPDetector(min_bases=2)  # capture metrics for 2+ contraction bases

    records: list[dict] = []
    fetched = 0
    for _, r in rows.iterrows():
        ticker = str(r["Ticker"]).strip()
        date = pd.Timestamp(r["Date"])
        start = (date - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")
        end = (date + timedelta(days=1)).strftime("%Y-%m-%d")
        df = _download(ticker, start, end)
        res = _evaluate(detector, df)
        if res is None:
            print(f"  skip {ticker} {date.date()} (no/short data)", file=sys.stderr)
            continue
        fetched += 1
        records.append(res)
        print(f"  {ticker} {date.date()}: score={res.get('vcp_score')} bases={res.get('num_bases')} "
              f"depth={res.get('contracting_depth')} vol={res.get('contracting_volume')} "
              f"tight={res.get('tight_near_highs')} dHigh={res.get('_dist_from_high')}%", file=sys.stderr)

    lines = ["# VCP detector calibration vs Minervini trade ideas\n"]
    lines.append(f"- setups considered: **{len(rows)}**, fetched OK: **{fetched}**\n")
    if not records:
        lines.append("\n_No data fetched — try a later --since-year or specific --tickers._\n")
        out = "\n".join(lines)
        print(out)
        if args.markdown:
            Path(args.markdown).write_text(out, encoding="utf-8")
        return 0

    scores = [float(r.get("vcp_score", 0) or 0) for r in records]
    bases = [int(r.get("num_bases", 0) or 0) for r in records]
    dist = [r["_dist_from_high"] for r in records if r.get("_dist_from_high") is not None]

    def pct(xs, p):
        xs = sorted(xs)
        return round(xs[min(len(xs) - 1, int(p / 100 * len(xs)))], 1)

    lines.append("\n## Distributions over real setups\n")
    lines.append(f"- VCP score: p25 {pct(scores,25)} / median {round(statistics.median(scores),1)} / p75 {pct(scores,75)}")
    lines.append(f"- num_bases: median {int(statistics.median(bases))}, "
                 f"2-base {sum(b==2 for b in bases)}, 3-base {sum(b==3 for b in bases)}, "
                 f"4+ {sum(b>=4 for b in bases)}, <2 {sum(b<2 for b in bases)}")
    if dist:
        lines.append(f"- distance from 52w high at entry: median {round(statistics.median(dist),1)}% "
                     f"(within 5%: {sum(d>=-5 for d in dist)}, within 10%: {sum(d>=-10 for d in dist)})")

    # Which sub-gate is the binding constraint (over fetched setups).
    lines.append("\n## Sub-condition pass rate (of fetched)\n")
    for key, label in (("contracting_depth", "contracting depth"),
                       ("contracting_volume", "volume drying up"),
                       ("tight_near_highs", "tight near highs (<=5%)")):
        n = sum(1 for r in records if r.get(key))
        lines.append(f"- {label}: {n}/{fetched} ({round(100*n/fetched)}%)")
    n65 = sum(1 for s in scores if s >= 65)
    n55 = sum(1 for s in scores if s >= 55)
    lines.append(f"- vcp_score >= 65: {n65}/{fetched} ({round(100*n65/fetched)}%); "
                 f">= 55: {n55}/{fetched} ({round(100*n55/fetched)}%)")

    # Recall under gate variants — how many real Minervini setups we'd flag.
    lines.append("\n## Detector recall under gate variants\n")
    lines.append("| gate | recall |")
    lines.append("|---|---|")
    variants = [
        ("production (bases>=2, score>=55, depth+tight, vol in score)", dict(min_bases=2, min_score=55, require_volume=False)),
        ("legacy (bases>=3, score>=65, vol required)", dict(min_bases=3, min_score=65, require_volume=True)),
        ("bases>=2, score>=55, vol required", dict(min_bases=2, min_score=55, require_volume=True)),
        ("bases>=2, score>=50, vol optional", dict(min_bases=2, min_score=50, require_volume=False)),
        ("bases>=2, score>=45, vol optional", dict(min_bases=2, min_score=45, require_volume=False)),
    ]
    for label, kw in variants:
        hit = sum(1 for r in records if _gate(r, **kw))
        lines.append(f"| {label} | {hit}/{fetched} ({round(100*hit/fetched)}%) |")

    out = "\n".join(lines) + "\n"
    print(out)
    if args.markdown:
        Path(args.markdown).write_text(out, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
