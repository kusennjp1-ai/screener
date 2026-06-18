"""Diagnostic: compute the MM360 bands from live data for a set of tickers.

Validates the Pressure / Buy Risk / TPR band module against real prices, so the
output can be compared to a Minervini Markets 360 screenshot (e.g. ARM). Prints
each band's current state + numeric driver and the tail of its per-bar history.

Network: needs Yahoo Finance (yfinance) + the SPY benchmark for TPR's 8th (RS)
condition. Run from CI, not the app sandbox.

Usage:
    python -m scripts.check_bands ARM
    python -m scripts.check_bands ARM NVDA --tail 30 --markdown out.md
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta

import pandas as pd

from app.services.minervini_bands import calculate_bands

BENCHMARK = "SPY"
HISTORY_DAYS = 820


def _download(symbol: str, start: str, end: str):
    import yfinance as yf

    try:
        df = yf.download(symbol, start=start, end=end, auto_adjust=True, progress=False, threads=False)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! download failed for {symbol}: {exc}", file=sys.stderr)
        return None
    if df is None or df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
    return df[keep].dropna()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tickers", nargs="*", default=["ARM"])
    parser.add_argument("--tail", type=int, default=24, help="history bars to show per band")
    parser.add_argument("--markdown", type=str, default=None)
    args = parser.parse_args()
    tickers = args.tickers or ["ARM"]

    target = pd.Timestamp(datetime.utcnow().date())
    start = (target - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")
    end = (target + timedelta(days=2)).strftime("%Y-%m-%d")
    bench = _download(BENCHMARK, start, end)
    bench_close = bench["Close"] if bench is not None and not bench.empty else None

    lines = ["# MM360 band check\n"]
    for t in tickers:
        print(f"{t} ...", file=sys.stderr)
        df = _download(t, start, end)
        if df is None or df.empty:
            lines.append(f"## {t}\n\n_no data_\n")
            continue
        b = calculate_bands(df, benchmark_close=bench_close, with_history=True)
        lines.append(f"## {t}\n")
        lines.append(
            f"- **Pressure**: {b.get('pressure_state')} (value {b.get('pressure_value')})\n"
            f"- **Buy Risk**: {b.get('buy_risk_state')} (ATR-dist {b.get('buy_risk_atr')})\n"
            f"- **TPR**: {b.get('tpr_state')} ({b.get('tpr_score')}/{b.get('tpr_max')})\n"
        )
        for key in ("pressure_history", "buy_risk_history", "tpr_history"):
            hist = b.get(key) or []
            lines.append(f"  - `{key}` (last {args.tail}): {hist[-args.tail:]}")
        lines.append("")
    out = "\n".join(lines) + "\n"
    print(out)
    if args.markdown:
        from pathlib import Path

        Path(args.markdown).write_text(out, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
