#!/usr/bin/env python3
"""Fetch OHLCV windows around Minervini's 908 published trade ideas.

Produces the offline bundle consumed by ``validate_trade_ideas.py`` (the FIXED
ground-truth harness). One gzipped CSV per distinct ticker covering the union
of that ticker's idea windows (T-460..T+130 calendar days), plus the SPY
benchmark over the full 1996..today range, plus a ``manifest.json`` with fetch
stats so coverage is comparable across harness runs.

Network: needs Yahoo Finance. Run in a full-access environment (the app
sandbox blocks market-data vendors); the harness itself then runs anywhere.

  cd backend
  PYTHONPATH=. python3 scripts/fetch_trade_idea_windows.py            # all 696 tickers
  PYTHONPATH=. python3 scripts/fetch_trade_idea_windows.py --since-year 2015 --limit 50
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
IDEAS_CSV = _REPO_ROOT / "data" / "minervini_trade_ideas.csv"
DEFAULT_OUT = Path(__file__).resolve().parents[1] / "calibration" / "trade_idea_windows"

LOOKBACK_DAYS = 460   # ~310 trading days: 200DMA + 52w window + slack
LOOKAHEAD_DAYS = 130  # ~90 trading days: forward returns + fire-window slack


def load_ideas(since_year: int | None) -> list[dict]:
    with open(IDEAS_CSV, newline="", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if r.get("Ticker") and r.get("Date")]
    if since_year:
        rows = [r for r in rows if int(r["Year"]) >= since_year]
    return rows


def ticker_windows(ideas: list[dict]) -> dict[str, tuple[str, str]]:
    """Union (start, end) window per distinct ticker across all its ideas."""
    spans: dict[str, list[datetime]] = defaultdict(list)
    for r in ideas:
        spans[r["Ticker"].strip().upper()].append(datetime.fromisoformat(r["Date"]))
    out: dict[str, tuple[str, str]] = {}
    for t, dates in spans.items():
        start = (min(dates) - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")
        end = (max(dates) + timedelta(days=LOOKAHEAD_DAYS)).strftime("%Y-%m-%d")
        out[t] = (start, end)
    return out


def fetch_one(symbol: str, start: str, end: str):
    import yfinance as yf

    try:
        df = yf.download(symbol, start=start, end=end, auto_adjust=True,
                         progress=False, threads=False)
    except Exception:  # noqa: BLE001
        return None
    if df is None or df.empty:
        return None
    import pandas as pd
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
    df = df[keep].dropna()
    return df if len(df) else None


def write_gz(df, path: Path) -> None:
    buf = io.StringIO()
    df.to_csv(buf, index_label="Date")
    path.write_bytes(gzip.compress(buf.getvalue().encode("utf-8")))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--since-year", type=int, default=None)
    ap.add_argument("--limit", type=int, default=None, help="max distinct tickers")
    ap.add_argument("--sleep", type=float, default=1.0, help="seconds between downloads")
    ap.add_argument("--force", action="store_true", help="re-fetch existing files")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    ideas = load_ideas(args.since_year)
    windows = ticker_windows(ideas)
    tickers = sorted(windows)
    if args.limit:
        tickers = tickers[: args.limit]

    ok, failed, skipped = [], [], []
    for i, t in enumerate(tickers, 1):
        dest = out / f"{t}.csv.gz"
        if dest.exists() and not args.force:
            skipped.append(t)
            continue
        start, end = windows[t]
        df = fetch_one(t, start, end)
        if df is None:
            failed.append(t)
            print(f"  [{i}/{len(tickers)}] {t}: FAILED", file=sys.stderr)
        else:
            write_gz(df, dest)
            ok.append(t)
            print(f"  [{i}/{len(tickers)}] {t}: {len(df)} rows", file=sys.stderr)
        time.sleep(args.sleep)

    # Benchmark: one SPY file spanning everything (idea range 1997..2022 + slack).
    spy_dest = out / "_SPY.csv.gz"
    if not spy_dest.exists() or args.force:
        spy = fetch_one("SPY", "1996-01-01", datetime.now().strftime("%Y-%m-%d"))
        if spy is not None:
            write_gz(spy, spy_dest)
            print(f"  SPY benchmark: {len(spy)} rows", file=sys.stderr)
        else:
            print("  SPY benchmark: FAILED — harness market-gate metrics will be skipped",
                  file=sys.stderr)

    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "ideas_total": len(ideas),
        "tickers_requested": len(tickers),
        "fetched": len(ok),
        "skipped_existing": len(skipped),
        "failed": sorted(failed),
        "lookback_days": LOOKBACK_DAYS,
        "lookahead_days": LOOKAHEAD_DAYS,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nbundle: {out}  fetched={len(ok)} skipped={len(skipped)} failed={len(failed)}",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
