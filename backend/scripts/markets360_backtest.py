#!/usr/bin/env python3
"""Walk-forward validation of the Markets 360 screener — does it surface winners?

For each as-of date, the screener is run using ONLY data up to that date (no
look-ahead); the names it flags are then scored by their forward return over a
horizon, and compared with the universe-average forward return (the baseline a
dart-throw would get) and the benchmark. This measures the screen's edge and,
crucially, the value of Minervini's market-timing gate (buyable_now) versus the
raw watchlist (passes).

Runs on the local OHLCV fixtures (no DB/network). In production, point it at a
real universe + history.

  PYTHONPATH=. python3 scripts/markets360_backtest.py
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import numpy as np
import pandas as pd

_PKG = "app.scanners"
if _PKG not in sys.modules:
    stub = types.ModuleType(_PKG)
    stub.__path__ = [str(Path(__file__).resolve().parents[1] / "app" / "scanners")]
    sys.modules[_PKG] = stub
import importlib  # noqa: E402

base = importlib.import_module("app.scanners.base_screener")
scanner_mod = importlib.import_module("app.scanners.markets360_scanner")
StockData = base.StockData
Markets360Scanner = scanner_mod.Markets360Scanner

sys.path.insert(0, str(Path(__file__).resolve().parent))
from markets360_band_calibration import _read_csv  # noqa: E402

FIX = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "markets360"
STOCKS = ["lly", "ftnt", "cyrx", "mrvl", "aa", "coin", "gev", "prax", "msft", "qure"]
HORIZON = 40          # ~2 months forward
MIN_BARS = 210
N_ASOF = 8            # evenly-spaced as-of dates across the usable range
STOP_PCT = -8.0       # Minervini cuts losers at ~7-8% below entry


def _fwd_return(df: pd.DataFrame, as_of: pd.Timestamp, horizon: int, stop_pct: float = None):
    """Forward % return over the horizon. With ``stop_pct`` set, models a hard
    stop: if intraday Low breaches entry*(1+stop_pct/100) the trade exits at the
    stop (faithful to Minervini's asymmetric cut-losers/let-winners-run P&L)."""
    fut = df[df.index > as_of]
    if len(fut) < horizon:
        return None
    c0 = float(df[df.index <= as_of]["Close"].iloc[-1])
    if c0 <= 0:
        return None
    window = fut.iloc[:horizon]
    if stop_pct is not None:
        stop_level = c0 * (1 + stop_pct / 100.0)
        breached = window[window["Low"] <= stop_level]
        if len(breached) > 0:
            return stop_pct          # exited at the stop
    return (float(window["Close"].iloc[-1]) / c0 - 1) * 100


def main() -> int:
    data = {s: _read_csv(str(FIX / f"{s}.csv")) for s in STOCKS}
    spy = _read_csv(str(FIX / "spy.csv"))
    scanner = Markets360Scanner()

    # common date axis from SPY; as-of dates need >=MIN_BARS history and >=HORIZON future
    dates = spy.index
    lo, hi = MIN_BARS, len(dates) - HORIZON - 1
    asof_idx = np.linspace(lo, hi, N_ASOF).astype(int)
    asof_dates = [dates[i] for i in asof_idx]

    buckets = {"buyable_now": [], "passes_only": [], "baseline": []}
    regime_counts = {}
    for as_of in asof_dates:
        spy_hist = spy[spy.index <= as_of]
        flagged_buyable, flagged_pass = [], []
        for s, df in data.items():
            hist = df[df.index <= as_of]
            if len(hist) < MIN_BARS:
                continue
            res = scanner.scan_stock(s.upper(), StockData(symbol=s.upper(), price_data=hist,
                                                          benchmark_data=spy_hist, market="US"))
            fr = _fwd_return(df, as_of, HORIZON, stop_pct=STOP_PCT)
            if fr is None:
                continue
            buckets["baseline"].append(fr)        # every scanned name = dart-throw baseline
            if res.passes:
                flagged_pass.append((s, fr))
            if res.details.get("buyable_now"):
                flagged_buyable.append((s, fr))
            reg = res.details.get("market_regime")
        regime_counts[reg] = regime_counts.get(reg, 0) + 1
        buckets["passes_only"] += [fr for _, fr in flagged_pass]
        buckets["buyable_now"] += [fr for _, fr in flagged_buyable]

    def stats(xs):
        if not xs:
            return "n=0"
        a = np.array(xs)
        return (f"n={len(a):3d}  avg={a.mean():+6.2f}%  median={np.median(a):+6.2f}%  "
                f"hit={100*(a > 0).mean():4.0f}%  best={a.max():+.0f}%  worst={a.min():+.0f}%")

    print(f"Walk-forward validation — {N_ASOF} as-of dates, {HORIZON}-day horizon, {STOP_PCT:.0f}% stop\n")
    print("  CAVEAT: the 10-name fixture set was hand-picked to stress the color")
    print("  bands (parabolic tops, crashes), so it is NOT a representative universe")
    print("  and these numbers are illustrative only — point the harness at a real")
    print("  universe + history for a meaningful edge readout.\n")
    print(f"  as-of market regimes seen: {regime_counts}\n")
    base_avg = np.mean(buckets["baseline"]) if buckets["baseline"] else 0.0
    print(f"  {'BASELINE (all scanned)':24s} {stats(buckets['baseline'])}")
    print(f"  {'WATCHLIST (passes)':24s} {stats(buckets['passes_only'])}")
    print(f"  {'BUYABLE NOW (timed)':24s} {stats(buckets['buyable_now'])}")
    for key in ("passes_only", "buyable_now"):
        if buckets[key]:
            edge = np.mean(buckets[key]) - base_avg
            print(f"    -> {key} edge vs baseline: {edge:+.2f}% per trade")
    print("\nEdge > 0 means the screen's flagged names beat a random pick over the horizon.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
