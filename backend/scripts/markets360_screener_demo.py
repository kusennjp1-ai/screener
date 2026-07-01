#!/usr/bin/env python3
"""End-to-end Markets 360 screener demo over an ETF-excluded universe.

Runs the real ``Markets360Scanner`` over a small universe built from the local
OHLCV fixtures, EXCLUDING ETFs (SPY/QQQ/IBB are dropped), and prints a ranked
table. This proves the screener path runs end-to-end without a database or
network — in production the same scanner runs over the full US universe via the
ScanOrchestrator, with ETFs excluded at the universe query (see
StockUniverse.is_etf and get_active_symbols(exclude_etfs=True)).

  PYTHONPATH=. python3 scripts/markets360_screener_demo.py [--weekly]
"""
from __future__ import annotations

import argparse
import sys
import types
from pathlib import Path

import pandas as pd

# Import the scanner WITHOUT triggering app.scanners.__init__ (which eagerly
# pulls the whole data pipeline). We register a lightweight package stub so the
# real scanner module + its siblings load directly. In production the package
# imports normally.
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

from app.services.security_type import classify_is_etf  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from markets360_band_calibration import _read_csv  # noqa: E402

FIX = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "markets360"
# (symbol, display name) — a stand-in universe; SPY/QQQ/IBB are ETFs.
UNIVERSE = [
    ("LLY", "Eli Lilly & Co."), ("FTNT", "Fortinet Inc."), ("CYRX", "CryoPort Inc."),
    ("MRVL", "Marvell Technology"), ("AA", "Alcoa Corp."), ("COIN", "Coinbase Global"),
    ("GEV", "GE Vernova"), ("PRAX", "Praxis Precision"), ("MSFT", "Microsoft Corp."),
    ("QURE", "uniQure NV"),
    ("SPY", "SPDR S&P 500 ETF"), ("QQQ", "Invesco QQQ Trust"),
    ("IBB", "iShares Biotechnology ETF"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weekly", action="store_true", help="weekly timeframe")
    args = ap.parse_args()
    timeframe = "weekly" if args.weekly else "daily"

    spy = _read_csv(str(FIX / "spy.csv"))
    scanner = Markets360Scanner()

    excluded, results = [], []
    for symbol, name in UNIVERSE:
        if classify_is_etf(symbol, name):
            excluded.append(symbol)
            continue
        csv = FIX / f"{symbol.lower()}.csv"
        if not csv.exists():
            continue
        price = _read_csv(str(csv))
        data = StockData(symbol=symbol, price_data=price, benchmark_data=spy, market="US")
        res = scanner.scan_stock(symbol, data, {"timeframe": timeframe})
        results.append((symbol, res))

    results.sort(key=lambda r: r[1].score, reverse=True)

    print(f"\nMarkets 360 screener — {timeframe} — universe excludes ETFs: {excluded}")
    print(f"scanned {len(results)} stocks (ex-ETF)\n")
    print(f"{'SYM':6s}{'SCORE':>6s}  {'RATING':12s}{'PASS':>5s}  {'TPR':4s}{'PRESS':7s}{'RISK':7s}{'RPR':>4s}")
    print("-" * 60)
    for symbol, r in results:
        d = r.details
        print(f"{symbol:6s}{r.score:6.1f}  {r.rating:12s}{'YES' if r.passes else '  -':>5s}  "
              f"{str(d.get('tpr_letter') or d.get('tpr_state', '?'))[:3]:4s}"
              f"{str(d.get('pressure_state', '?')):7s}{str(d.get('buy_risk_state', '?')):7s}"
              f"{str(d.get('rpr', '-')):>4s}")
    passed = [s for s, r in results if r.passes]
    print(f"\nPASS (buyable SEPA leaders): {passed or 'none in this sample'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
