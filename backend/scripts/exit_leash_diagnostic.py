"""Is our SHIPPED sell advice too tight vs how long Minervini actually holds?

His picks run to +13.3% at 252d B&H (60% win), but our mirror exits average a
~34-day hold. This diagnostic re-runs his 908 picks under the shipped exit
ladder AND several LOOSER leash variants, on the SAME entries, and reports for
each: expectancy, the >=3R tail (which carried 133% of return in C69), average
hold, and the forward return LEFT ON THE TABLE after our exit (did the name keep
running?). Scripts-only, offline, no frozen-metric or shipped-code change — this
is evidence to decide whether to loosen the SellPlanCard advisory.

Leash variants (entry + protective stop identical; only the trend-exit differs):
  base   : shipped — sell next open when close<50DMA on >=1.5x vol
  confirm: require TWO consecutive closes below the 50DMA (whipsaw filter)
  ma65   : lock-phase trail uses the 65-DMA instead of the 50-DMA (looser)
  weekly : 50DMA-break exit only if close is also below the prior 5-day low
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
from collections import defaultdict
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
FWD_HORIZON = 63           # trading days after our exit to check "left on table"


def _load(ticker):
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


def _ladder_stop(close_px, entry, stop0, ma_trail, low20):
    risk = entry - stop0
    if risk <= 0:
        return stop0
    r = (close_px - entry) / risk
    if r >= LADDER_LOCK_GAINS_R:
        stop = entry + risk
        for level in (ma_trail, low20 * 0.999 if low20 == low20 else np.nan):
            if level == level and stop < level < close_px:
                stop = level
    elif r >= LADDER_BREAKEVEN_R:
        stop = entry
    elif r >= LADDER_HALF_RISK_R:
        stop = entry - 0.5 * risk
    else:
        stop = stop0
    return max(stop, stop0)


def simulate(df, t0, variant):
    pos = df.index.searchsorted(pd.Timestamp(t0), side="right")
    if pos < 65 or pos >= len(df) - 2:
        return None
    entry = float(df["Open"].iloc[pos]) * (1 + COST_PER_SIDE)
    if entry <= 0:
        return None
    swing_low = float(df["Low"].iloc[max(0, pos - SWING_LOOKBACK):pos].min())
    stop0 = max(swing_low, entry * (1 - MAX_LOSS_PCT))
    if stop0 >= entry:
        stop0 = entry * (1 - MAX_LOSS_PCT)
    stop = stop0
    ma50s = df["Close"].rolling(50, min_periods=20).mean()
    ma65s = df["Close"].rolling(65, min_periods=25).mean()
    vol50s = df["Volume"].rolling(50, min_periods=20).mean()
    ma_trail_s = ma65s if variant == "ma65" else ma50s
    below_prev = False  # for 'confirm': was prior close below the 50DMA

    exit_i = exit_px = None
    reason = None
    for i in range(pos, len(df)):
        lo = float(df["Low"].iloc[i])
        c = float(df["Close"].iloc[i])
        o = float(df["Open"].iloc[i])
        if i > pos and lo <= stop:
            exit_px = min(o, stop) * (1 - COST_PER_SIDE)
            exit_i, reason = i, "stop"
            break
        ma50 = float(ma50s.iloc[i]) if ma50s.iloc[i] == ma50s.iloc[i] else np.nan
        ma_trail = float(ma_trail_s.iloc[i]) if ma_trail_s.iloc[i] == ma_trail_s.iloc[i] else np.nan
        low20 = float(df["Low"].iloc[max(0, i - 19):i + 1].min())
        stop = _ladder_stop(c, entry, stop0, ma_trail, low20)
        v50 = float(vol50s.iloc[i]) if vol50s.iloc[i] == vol50s.iloc[i] else 0.0
        volr = (float(df["Volume"].iloc[i]) / v50) if v50 else 0.0
        below = ma50 == ma50 and c < ma50
        fire = False
        if below and volr >= BREAKOUT_VOL_RATIO and i < len(df) - 1:
            if variant == "confirm":
                fire = below_prev            # need two consecutive closes below
            elif variant == "weekly":
                low5 = float(df["Low"].iloc[max(0, i - 5):i].min())
                fire = c < low5              # also below the prior 5-day low
            else:
                fire = True                  # base / ma65
        below_prev = below
        if fire:
            exit_px = float(df["Open"].iloc[i + 1]) * (1 - COST_PER_SIDE)
            exit_i, reason = i + 1, "50dma"
            break
    if exit_i is None:
        exit_i = len(df) - 1
        exit_px = float(df["Close"].iloc[-1]) * (1 - COST_PER_SIDE)
        reason = "end"

    risk = entry - stop0
    # forward return still available AFTER our exit (did it keep running?)
    fwd = None
    j = min(exit_i + FWD_HORIZON, len(df) - 1)
    if j > exit_i and exit_px > 0:
        fwd = (float(df["Close"].iloc[j]) / (exit_px / (1 - COST_PER_SIDE)) - 1.0) * 100.0
    return {
        "r": (exit_px - entry) / risk if risk > 0 else 0.0,
        "ret_pct": (exit_px / entry - 1.0) * 100.0,
        "hold": int(exit_i - pos),
        "reason": reason,
        "fwd_after_exit_pct": fwd,
    }


def agg(rs):
    if not rs:
        return {}
    rets = [x["ret_pct"] for x in rs]
    gains = sum(x for x in rets if x > 0)
    losses = -sum(x for x in rets if x < 0)
    tail = [x for x in rs if x["r"] >= 3.0]
    tail_ret = sum(x["ret_pct"] for x in tail)
    fwd = [x["fwd_after_exit_pct"] for x in rs
           if x["fwd_after_exit_pct"] is not None and x["reason"] != "end"]
    reasons = defaultdict(int)
    for x in rs:
        reasons[x["reason"]] += 1
    return {
        "n": len(rs),
        "win_pct": round(100 * sum(1 for x in rets if x > 0) / len(rs), 1),
        "avg_r": round(float(np.mean([x["r"] for x in rs])), 2),
        "expectancy_pct": round(float(np.mean(rets)), 2),
        "profit_factor": round(gains / losses, 2) if losses else None,
        "avg_hold": round(float(np.mean([x["hold"] for x in rs])), 0),
        "tail_3R_n": len(tail),
        "tail_3R_pct_of_return": round(100 * tail_ret / sum(rets), 0) if sum(rets) else None,
        "median_fwd_after_exit_pct": round(float(np.median(fwd)), 1) if fwd else None,
        "mean_fwd_after_exit_pct": round(float(np.mean(fwd)), 1) if fwd else None,
        "exit_reasons": dict(reasons),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="/tmp/exit_leash.json")
    args = ap.parse_args()
    ideas = [r for r in csv.DictReader(open(IDEAS_CSV, encoding="utf-8"))
             if r.get("Ticker") and r.get("Date")]
    variants = ["base", "confirm", "ma65", "weekly"]
    cache = {}
    out = {}
    for v in variants:
        rs = []
        for r in ideas:
            tk = r["Ticker"].upper()
            if tk not in cache:
                cache[tk] = _load(tk)
            df = cache[tk]
            if df is None:
                continue
            res = simulate(df, pd.Timestamp(r["Date"]), v)
            if res:
                rs.append(res)
        out[v] = agg(rs)

    print(f"{'variant':8} {'n':>4} {'win%':>5} {'avgR':>5} {'exp%':>6} "
          f"{'PF':>5} {'hold':>5} {'3Rn':>4} {'tail%':>6} {'fwd_med%':>8}")
    for v in variants:
        a = out[v]
        print(f"{v:8} {a['n']:>4} {a['win_pct']:>5} {a['avg_r']:>5} "
              f"{a['expectancy_pct']:>6} {str(a['profit_factor']):>5} "
              f"{a['avg_hold']:>5} {a['tail_3R_n']:>4} "
              f"{str(a['tail_3R_pct_of_return']):>6} {str(a['mean_fwd_after_exit_pct']):>8}")
    print("\nexit reasons:")
    for v in variants:
        print(f"  {v:8} {out[v]['exit_reasons']}")
    print("\nfwd_after_exit% = mean forward 63d return from OUR exit point "
          "(positive => we left gains on the table)")
    Path(args.output).write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
