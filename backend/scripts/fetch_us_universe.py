#!/usr/bin/env python3
"""Fetch real US OHLCV into per-symbol CSVs for the W3.2 calibration.

Ready-to-fire ingestion: the moment this environment's network policy permits
outbound to Yahoo, this pulls daily OHLCV for a US (ex-ETF) symbol list plus the
SPY benchmark and writes one ``<SYMBOL>.csv`` per name into ``--out-dir`` — the
exact directory layout ``calibrate_rs_weights.py --source csv`` consumes. It does
NOT bypass any control: if egress is blocked it fails loudly and tells you to open
the environment's network policy (it never routes around the proxy).

  # 1) (after the env network policy allows Yahoo) fetch the universe
  PYTHONPATH=. python3 scripts/fetch_us_universe.py --symbols-file syms.txt --out-dir realdata
  # 2) calibrate on the real universe
  PYTHONPATH=. python3 scripts/calibrate_rs_weights.py --source csv --data-dir realdata
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import List

# A small, liquid, ex-ETF default so the script is runnable without a list; in
# production pass --symbols-file with the full resolved US ex-ETF universe (the
# same one universe_resolver returns).
DEFAULT_SYMBOLS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AVGO", "LLY", "JPM", "V",
    "UNH", "XOM", "MA", "COST", "HD", "PG", "JNJ", "ABBV", "CRM", "MRK",
    "AMD", "NFLX", "ADBE", "PEP", "KO", "WMT", "TMO", "CSCO", "ORCL", "ACN",
]
BENCHMARK = "SPY"


def _read_symbols(path: str | None) -> List[str]:
    if not path:
        return list(DEFAULT_SYMBOLS)
    lines = Path(path).read_text().splitlines()
    syms = [s.strip().upper() for s in lines if s.strip() and not s.startswith("#")]
    if not syms:
        raise SystemExit(f"--symbols-file {path} had no usable tickers")
    return syms


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols-file", default=None, help="one ticker per line (default: a small liquid set)")
    ap.add_argument("--out-dir", default="realdata")
    ap.add_argument("--period", default="5y")
    ap.add_argument("--benchmark", default=BENCHMARK)
    args = ap.parse_args()

    try:
        import yfinance as yf
    except ImportError:
        raise SystemExit("yfinance is not installed: pip install yfinance")

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    symbols = _read_symbols(args.symbols_file)
    all_syms = [args.benchmark] + [s for s in symbols if s != args.benchmark]

    ok, failed = 0, []
    for sym in all_syms:
        try:
            df = yf.download(sym, period=args.period, interval="1d",
                             auto_adjust=True, progress=False)
        except Exception as e:  # noqa: BLE001
            failed.append((sym, repr(e)[:120]))
            continue
        if df is None or df.empty:
            failed.append((sym, "no data (delisted or egress-blocked)"))
            continue
        # write benchmark as spy.csv (lowercased stem the calibrator expects)
        stem = "spy" if sym == args.benchmark else sym
        df.to_csv(out / f"{stem}.csv")
        ok += 1

    print(f"wrote {ok} CSVs to {out}/  (failed: {len(failed)})")
    for sym, why in failed[:10]:
        print(f"  FAIL {sym}: {why}")
    if ok <= 1:
        print("\nNothing usable was fetched. If every symbol failed with a CONNECT/403,")
        print("this environment's network policy is blocking Yahoo — open it in the")
        print("environment settings (https://code.claude.com/docs/en/claude-code-on-the-web).")
        print("Do NOT bypass the proxy; reconfigure the environment instead.")
        return 1
    print(f"\nNext: PYTHONPATH=. python3 scripts/calibrate_rs_weights.py "
          f"--source csv --data-dir {out} --benchmark spy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
