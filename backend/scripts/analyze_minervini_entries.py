"""What do Mark Minervini's real entries have in common (beyond VCP)?

Loads calibration/minervini_trade_ideas.csv (~900 ticker+date setups he publicly
referenced) and, for each entry, measures a broad feature set from the trailing
daily price window, then reports the distributions. The goal is to surface the
*statistically common DNA* of his entries — which can then inform new screening
filters (e.g. "within X% of the 52w high", "above the 200-DMA", "ADR band",
"N-month momentum").

Network: needs Yahoo Finance (yfinance); pre-2015 / delisted tickers often fail
(the report shows the fetch rate). CI-only.

Usage:
    python -m scripts.analyze_minervini_entries --since-year 2010 --limit 600
"""
from __future__ import annotations

import argparse
import statistics
import sys
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd

CSV_PATH = Path(__file__).resolve().parent.parent / "calibration" / "minervini_trade_ideas.csv"
LOOKBACK_DAYS = 460
MIN_BARS = 210  # need ~200d SMA + a little


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


def _features(df: pd.DataFrame) -> dict | None:
    if df is None or len(df) < MIN_BARS:
        return None
    close = df["Close"]
    high = df["High"]
    low = df["Low"]
    vol = df["Volume"]
    c = float(close.iloc[-1])
    if c <= 0:
        return None

    sma50 = close.rolling(50).mean().iloc[-1]
    sma150 = close.rolling(150).mean().iloc[-1]
    sma200 = close.rolling(200).mean().iloc[-1]
    hi52 = float(high.tail(252).max())
    lo52 = float(low.tail(252).min())

    # ADR% (avg daily high/low range over 20 sessions).
    adr = float((high.tail(20) / low.tail(20)).mean() - 1.0) * 100

    # ATR(14) extension above the 50-DMA.
    tr = pd.concat([high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()], axis=1).max(axis=1)
    atr = tr.ewm(span=14, adjust=False).mean().iloc[-1]
    ext_atr = float((c - sma50) / atr) if atr and not pd.isna(atr) else None

    def ret(nbars):
        if len(close) <= nbars:
            return None
        base = float(close.iloc[-1 - nbars])
        return (c / base - 1.0) * 100 if base > 0 else None

    vol50 = float(vol.tail(50).mean())
    return {
        "dist_high": (c - hi52) / hi52 * 100 if hi52 else None,
        "above_low_pct": (c - lo52) / lo52 * 100 if lo52 else None,
        "above_sma50": bool(not pd.isna(sma50) and c > sma50),
        "above_sma150": bool(not pd.isna(sma150) and c > sma150),
        "above_sma200": bool(not pd.isna(sma200) and c > sma200),
        "stack_ok": bool(not any(pd.isna(x) for x in (sma50, sma150, sma200)) and c > sma50 > sma150 > sma200),
        "adr": adr,
        "ext_atr": ext_atr,
        "ret_1m": ret(21),
        "ret_3m": ret(63),
        "ret_6m": ret(126),
        "vol_surge": float(vol.iloc[-1] / vol50) if vol50 > 0 else None,
        "near_high_5": bool(hi52 and (c - hi52) / hi52 >= -0.05),
    }


def _pct(xs, p):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    return round(xs[min(len(xs) - 1, int(p / 100 * len(xs)))], 1)


def _med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 1) if xs else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since-year", type=int, default=2010)
    parser.add_argument("--limit", type=int, default=600)
    parser.add_argument("--markdown", type=str, default=None)
    args = parser.parse_args()

    rows = pd.read_csv(CSV_PATH).drop_duplicates(subset=["Ticker", "Date"])
    rows = rows[rows["Year"] >= args.since_year].head(args.limit)

    recs: list[dict] = []
    for _, r in rows.iterrows():
        date = pd.Timestamp(r["Date"])
        start = (date - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")
        end = (date + timedelta(days=1)).strftime("%Y-%m-%d")
        f = _features(_download(str(r["Ticker"]).strip(), start, end))
        if f is None:
            continue
        recs.append(f)
        print(f"  {r['Ticker']} {date.date()}: dHigh={f['dist_high'] and round(f['dist_high'],1)}% "
              f"sma200>{f['above_sma200']} ADR={round(f['adr'],1)}% ret6m={f['ret_6m'] and round(f['ret_6m'])}",
              file=sys.stderr)

    n = len(recs)
    lines = ["# Minervini entry DNA — common factors across his real trades\n",
             f"- setups fetched OK: **{n}** (of {len(rows)} considered)\n"]
    if not recs:
        lines.append("\n_No data fetched._\n")
        print("\n".join(lines))
        return 0

    def share(key):
        return round(100 * sum(1 for r in recs if r.get(key)) / n)

    lines.append("\n## Trend / location at entry\n")
    lines.append(f"- above 50-DMA: **{share('above_sma50')}%**, above 150-DMA: **{share('above_sma150')}%**, "
                 f"above 200-DMA: **{share('above_sma200')}%**")
    lines.append(f"- full stack (price>50>150>200): **{share('stack_ok')}%**")
    lines.append(f"- within 5% of 52w high: **{share('near_high_5')}%**")
    lines.append(f"- distance from 52w high: median {_med([r['dist_high'] for r in recs])}% "
                 f"(p25 {_pct([r['dist_high'] for r in recs],25)} / p75 {_pct([r['dist_high'] for r in recs],75)})")
    lines.append(f"- above 52w low: median {_med([r['above_low_pct'] for r in recs])}%")

    lines.append("\n## Volatility / extension\n")
    lines.append(f"- ADR%: p25 {_pct([r['adr'] for r in recs],25)} / median {_med([r['adr'] for r in recs])} / "
                 f"p75 {_pct([r['adr'] for r in recs],75)}")
    lines.append(f"- extension above 50-DMA (ATRs): median {_med([r['ext_atr'] for r in recs])} "
                 f"(p75 {_pct([r['ext_atr'] for r in recs],75)})")
    lines.append(f"- entry-day volume vs 50d avg: median {_med([r['vol_surge'] for r in recs])}x")

    lines.append("\n## Prior momentum\n")
    lines.append(f"- 1-month return: median {_med([r['ret_1m'] for r in recs])}%")
    lines.append(f"- 3-month return: median {_med([r['ret_3m'] for r in recs])}%")
    lines.append(f"- 6-month return: median {_med([r['ret_6m'] for r in recs])}% "
                 f"(p25 {_pct([r['ret_6m'] for r in recs],25)} / p75 {_pct([r['ret_6m'] for r in recs],75)})")

    out = "\n".join(lines) + "\n"
    print(out)
    if args.markdown:
        Path(args.markdown).write_text(out, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
