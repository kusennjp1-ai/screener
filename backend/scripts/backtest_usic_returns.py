"""Forward-return backtest of Minervini's USIC-style entries WITH stop discipline.

For each real USIC entry (ticker + buy date in calibration/minervini_trade_ideas.csv)
it simulates: buy at the entry-day close, apply a hard stop-loss, and otherwise
hold up to a max horizon (optionally exiting on a 50-DMA trend break), then
reports the outcome distribution — win rate, median/mean return, how often the
stop fired — WITH vs WITHOUT the stop, and against SPY over the same windows.

This measures how the leadership-entry style behaved on his actual picks and how
much the stop-loss rule mattered. Caveat: these are names he *selected* (a
favourable, survivorship-tinged sample), so it is a study of entry + risk
discipline, not a turnkey strategy you could blindly run on the whole universe.

Network: needs Yahoo Finance (yfinance). CI-only.

Usage:
    python -m scripts.backtest_usic_returns --since-year 2016 --stop 8 --horizon 126
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
    return df.dropna()


def _simulate(df: pd.DataFrame, entry_date: pd.Timestamp, *, stop_pct: float, horizon: int,
              trend_exit: bool) -> dict | None:
    """Buy at the first close on/after entry_date; exit on stop / 50-DMA break / horizon."""
    fwd = df[df.index >= entry_date]
    if len(fwd) < 5:
        return None
    entry = float(fwd["Close"].iloc[0])
    if entry <= 0:
        return None
    stop_level = entry * (1 - stop_pct / 100.0)
    sma50 = df["Close"].rolling(50).mean()

    held = fwd.iloc[1 : horizon + 1]
    if held.empty:
        return None
    for i, (ts, row) in enumerate(held.iterrows(), start=1):
        if float(row["Low"]) <= stop_level:
            return {"ret": -stop_pct, "days": i, "exit": "stop"}
        if trend_exit and not pd.isna(sma50.get(ts, np.nan)) and float(row["Close"]) < float(sma50.loc[ts]):
            return {"ret": (float(row["Close"]) - entry) / entry * 100, "days": i, "exit": "trend"}
    last = float(held["Close"].iloc[-1])
    return {"ret": (last - entry) / entry * 100, "days": len(held), "exit": "time"}


def _agg(rets: list[float]) -> str:
    if not rets:
        return "n/a"
    wins = [r for r in rets if r > 0]
    return (f"n={len(rets)}, win {round(100*len(wins)/len(rets))}%, "
            f"median {round(statistics.median(rets),1)}%, mean {round(statistics.mean(rets),1)}%, "
            f"avg win {round(statistics.mean(wins),1) if wins else 0}%, "
            f"avg loss {round(statistics.mean([r for r in rets if r<=0]) if any(r<=0 for r in rets) else 0,1)}%")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--since-year", type=int, default=2016)
    p.add_argument("--limit", type=int, default=400)
    p.add_argument("--stop", type=float, default=8.0, help="hard stop-loss %")
    p.add_argument("--horizon", type=int, default=126, help="max holding (trading days)")
    p.add_argument("--trend-exit", action="store_true", help="also exit on a 50-DMA close break")
    p.add_argument("--markdown", type=str, default=None)
    args = p.parse_args()

    rows = pd.read_csv(CSV_PATH).drop_duplicates(subset=["Ticker", "Date"])
    rows = rows[rows["Year"] >= args.since_year].head(args.limit)

    with_stop: list[float] = []
    no_stop: list[float] = []
    bench: list[float] = []
    exits = {"stop": 0, "trend": 0, "time": 0}
    fetched = 0

    spy_cache: dict[str, pd.DataFrame] = {}

    def spy_window(d0, d1):
        df = _download("SPY", d0, d1)
        return df

    for _, r in rows.iterrows():
        ticker = str(r["Ticker"]).strip()
        date = pd.Timestamp(r["Date"])
        start = (date - timedelta(days=80)).strftime("%Y-%m-%d")   # warmup for 50-DMA
        end = (date + timedelta(days=int(args.horizon * 1.6) + 10)).strftime("%Y-%m-%d")
        df = _download(ticker, start, end)
        if df is None or len(df) < 60:
            continue
        sim = _simulate(df, date, stop_pct=args.stop, horizon=args.horizon, trend_exit=args.trend_exit)
        if sim is None:
            continue
        fetched += 1
        with_stop.append(sim["ret"])
        exits[sim["exit"]] += 1
        # no-stop: pure horizon return
        ns = _simulate(df, date, stop_pct=100.0, horizon=args.horizon, trend_exit=False)
        if ns:
            no_stop.append(ns["ret"])
        # SPY same window
        spy = _download("SPY", date.strftime("%Y-%m-%d"), end)
        if spy is not None and len(spy) > args.horizon:
            s0 = float(spy["Close"].iloc[0]); s1 = float(spy["Close"].iloc[min(args.horizon, len(spy) - 1)])
            if s0 > 0:
                bench.append((s1 - s0) / s0 * 100)
        print(f"  {ticker} {date.date()}: {round(sim['ret'],1)}% via {sim['exit']} ({sim['days']}d)", file=sys.stderr)

    lines = [f"# USIC-entry forward-return backtest (stop {args.stop}%, horizon {args.horizon}d"
             f"{', 50-DMA exit' if args.trend_exit else ''})\n",
             f"- entries simulated: **{fetched}** (of {len(rows)} considered)\n"]
    if fetched:
        lines.append("\n## Outcome\n")
        lines.append(f"- WITH stop:  {_agg(with_stop)}")
        lines.append(f"- NO stop:    {_agg(no_stop)}")
        lines.append(f"- SPY same window: median {round(statistics.median(bench),1) if bench else 'n/a'}%, "
                     f"mean {round(statistics.mean(bench),1) if bench else 'n/a'}%")
        tot = sum(exits.values()) or 1
        lines.append(f"- exits: stop {exits['stop']} ({round(100*exits['stop']/tot)}%), "
                     f"trend {exits['trend']}, time {exits['time']}")
        edge = (statistics.mean(with_stop) - statistics.mean(bench)) if bench else None
        if edge is not None:
            lines.append(f"- mean excess vs SPY (with stop): **{round(edge,1)}pp**")

    out = "\n".join(lines) + "\n"
    print(out)
    if args.markdown:
        Path(args.markdown).write_text(out, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
