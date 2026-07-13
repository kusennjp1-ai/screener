"""Mirror backtest: trade Minervini's ACTUAL tweeted picks with OUR exit rules.

Unlike backtest_minervini_tactics.py (which SCREENS for setups), this takes
Minervini's real Twitter-mentioned buys — ticker + date, from
``data/minervini_trade_ideas.csv`` (the 908-trade ground truth; the Notion
"Minervini's Historical Buys" list is the same dataset) — and asks: if you
mirrored each pick (buy next open after the tweet) and managed it with the
shipped Minervini exit discipline, what would each trade have returned?

Exit discipline (identical to the tactics backtest):
  - initial stop = max(recent 15-bar low, entry * (1 - 8%))
  - trailing ladder: +1R -> half risk, +2R -> breakeven, +3R -> lock +1R and
    trail the higher of the 50-DMA / 20-bar low
  - 50-DMA breakdown on >= 1.5x volume -> sell next open
  - window end -> mark out at last close

Offline: reads the committed per-ticker OHLCV windows in
``calibration/trade_idea_windows/`` — no market egress. Coverage is whatever
windows are committed (a liquid-name subset of the 908).

Benchmark: buy-and-hold each pick for a fixed horizon, to show whether the
exit rules add value over naively holding the same picks.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.markets360.exit_signals import (
    LADDER_BREAKEVEN_R,
    LADDER_HALF_RISK_R,
    LADDER_LOCK_GAINS_R,
)

_BACKEND = Path(__file__).resolve().parents[1]
IDEAS_CSV = _BACKEND.parent / "data" / "minervini_trade_ideas.csv"
WINDOWS = _BACKEND / "calibration" / "trade_idea_windows"

COST_PER_SIDE = 0.001
MAX_LOSS_PCT = 0.08
SWING_LOOKBACK = 15
BREAKOUT_VOL_RATIO = 1.5
HOLD_HORIZONS = (21, 63, 126, 252)  # ~1m / 3m / 6m / 12m for the B&H benchmark


def _ladder_stop(close_px, entry, stop0, ma50, low20):
    risk = entry - stop0
    if risk <= 0:
        return stop0
    r = (close_px - entry) / risk
    if r >= LADDER_LOCK_GAINS_R:
        stop = entry + risk
        for level in (ma50, low20 * 0.999 if low20 == low20 else np.nan):
            if level == level and stop < level < close_px:
                stop = level
    elif r >= LADDER_BREAKEVEN_R:
        stop = entry
    elif r >= LADDER_HALF_RISK_R:
        stop = entry - 0.5 * risk
    else:
        stop = stop0
    return max(stop, stop0)


def _load_window(ticker: str):
    p = WINDOWS / f"{ticker.upper()}.csv.gz"
    if not p.exists():
        return None
    try:
        raw = gzip.decompress(p.read_bytes()).decode("utf-8")
        df = pd.read_csv(io.StringIO(raw), index_col="Date", parse_dates=True)
    except Exception:
        return None
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
    df = df[keep].dropna()
    return df if len(df) else None


def simulate_pick(df: pd.DataFrame, t0: pd.Timestamp):
    """Enter next open after t0, manage with the shipped exit rules."""
    pos = df.index.searchsorted(pd.Timestamp(t0), side="right")
    if pos < 30 or pos >= len(df) - 2:
        return None  # need history for stops/50DMA and room to trade forward
    entry = float(df["Open"].iloc[pos]) * (1 + COST_PER_SIDE)
    if entry <= 0:
        return None
    swing_low = float(df["Low"].iloc[max(0, pos - SWING_LOOKBACK):pos].min())
    stop0 = max(swing_low, entry * (1 - MAX_LOSS_PCT))
    if stop0 >= entry:
        stop0 = entry * (1 - MAX_LOSS_PCT)
    stop = stop0
    ma50s = df["Close"].rolling(50, min_periods=20).mean()
    vol50s = df["Volume"].rolling(50, min_periods=20).mean()

    for i in range(pos, len(df)):
        lo = float(df["Low"].iloc[i])
        c = float(df["Close"].iloc[i])
        o = float(df["Open"].iloc[i])
        # intraday protective stop
        if i > pos and lo <= stop:
            px = min(o, stop) * (1 - COST_PER_SIDE)
            return _result(entry, stop0, px, i - pos, "stop")
        # close management: ladder + 50DMA breakdown
        ma50 = float(ma50s.iloc[i]) if ma50s.iloc[i] == ma50s.iloc[i] else np.nan
        low20 = float(df["Low"].iloc[max(0, i - 19):i + 1].min())
        stop = _ladder_stop(c, entry, stop0, ma50, low20)
        v50 = float(vol50s.iloc[i]) if vol50s.iloc[i] == vol50s.iloc[i] else 0.0
        volr = (float(df["Volume"].iloc[i]) / v50) if v50 else 0.0
        if ma50 == ma50 and c < ma50 and volr >= BREAKOUT_VOL_RATIO and i < len(df) - 1:
            px = float(df["Open"].iloc[i + 1]) * (1 - COST_PER_SIDE)
            return _result(entry, stop0, px, i + 1 - pos, "50dma")
    # window ran out — mark out at last close
    px = float(df["Close"].iloc[-1]) * (1 - COST_PER_SIDE)
    return _result(entry, stop0, px, len(df) - 1 - pos, "end")


def _result(entry, stop0, px, hold, reason):
    risk = entry - stop0
    return {
        "entry": entry, "exit": px, "hold_days": int(hold), "reason": reason,
        "r": (px - entry) / risk if risk > 0 else 0.0,
        "ret_pct": (px / entry - 1.0) * 100.0,
    }


def buy_and_hold(df: pd.DataFrame, t0: pd.Timestamp, horizon: int):
    pos = df.index.searchsorted(pd.Timestamp(t0), side="right")
    if pos < 1 or pos >= len(df):
        return None
    entry = float(df["Open"].iloc[pos])
    j = min(pos + horizon, len(df) - 1)
    exit_px = float(df["Close"].iloc[j])
    return (exit_px / entry - 1.0) * 100.0 if entry > 0 else None


def agg(rs):
    if not rs:
        return {}
    wins = [x for x in rs if x["ret_pct"] > 0]
    gains = sum(x["ret_pct"] for x in rs if x["ret_pct"] > 0)
    losses = -sum(x["ret_pct"] for x in rs if x["ret_pct"] < 0)
    return {
        "n": len(rs),
        "win_pct": round(100 * len(wins) / len(rs), 1),
        "avg_r": round(float(np.mean([x["r"] for x in rs])), 2),
        "median_r": round(float(np.median([x["r"] for x in rs])), 2),
        "avg_ret_pct": round(float(np.mean([x["ret_pct"] for x in rs])), 1),
        "median_ret_pct": round(float(np.median([x["ret_pct"] for x in rs])), 1),
        "profit_factor": round(gains / losses, 2) if losses > 0 else None,
        "avg_hold_days": round(float(np.mean([x["hold_days"] for x in rs])), 0),
        "expectancy_pct": round(float(np.mean([x["ret_pct"] for x in rs])), 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--since-year", type=int, default=0)
    ap.add_argument("--output", default="/tmp/minervini_picks_report.json")
    args = ap.parse_args()

    ideas = [r for r in csv.DictReader(open(IDEAS_CSV, encoding="utf-8"))
             if r.get("Ticker") and r.get("Date")]
    cache: dict = {}
    managed, by_year = [], {}
    bh = {h: [] for h in HOLD_HORIZONS}
    attempted = skipped_nowin = skipped_short = 0

    for r in ideas:
        if int(r["Year"]) < args.since_year:
            continue
        tkr = r["Ticker"].upper()
        if tkr not in cache:
            cache[tkr] = _load_window(tkr)
        df = cache[tkr]
        if df is None:
            skipped_nowin += 1
            continue
        attempted += 1
        t0 = pd.Timestamp(r["Date"])
        res = simulate_pick(df, t0)
        if res is None:
            skipped_short += 1
            continue
        res["ticker"] = tkr
        res["date"] = r["Date"]
        res["year"] = r["Year"]
        managed.append(res)
        by_year.setdefault(r["Year"], []).append(res)
        for h in HOLD_HORIZONS:
            v = buy_and_hold(df, t0, h)
            if v is not None:
                bh[h].append(v)

    out = {
        "universe": {
            "ideas_total": len(ideas), "attempted": attempted,
            "no_window": skipped_nowin, "too_short": skipped_short,
            "simulated": len(managed),
        },
        "managed_exit_rules": agg(managed),
        "exit_reason_mix": {k: sum(1 for x in managed if x["reason"] == k)
                            for k in ("stop", "50dma", "end")},
        "buy_and_hold_benchmark": {
            f"{h}d": {"n": len(bh[h]),
                      "avg_ret_pct": round(float(np.mean(bh[h])), 1) if bh[h] else None,
                      "median_ret_pct": round(float(np.median(bh[h])), 1) if bh[h] else None,
                      "win_pct": round(100 * sum(1 for v in bh[h] if v > 0) / len(bh[h]), 1) if bh[h] else None}
            for h in HOLD_HORIZONS},
        "by_year": {y: agg(v) for y, v in sorted(by_year.items())},
    }
    Path(args.output).write_text(json.dumps(out, indent=2))
    Path(args.output).with_suffix(".trades.json").write_text(json.dumps(managed, indent=2))
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
