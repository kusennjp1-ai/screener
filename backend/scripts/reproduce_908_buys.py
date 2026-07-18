"""Could the SHIPPED Buy Signal engine have actually BOUGHT Minervini's 908
picks at the time? Stricter than the SETUP/FIRE±5 harness metrics (which ask
'was a setup / near-pivot present'): here we require an ACTIONABLE BUY TRIGGER
— trend template intact AND a close crossing above the VCP/base pivot on >=1.4x
volume — to have fired within a window around his tweet date.

Windows: [tweet - PRE, tweet + POST] trading days (he often tweets after buying,
so we look a little before and a little after). Reports reproduction rate:
  detected   : compute_vcp_footprint 'detected' anywhere in the window
  buy_trigger: an actual pivot-breakout day (the buyable moment) in the window
Offline on the committed 908 windows (no egress).
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

from app.services.markets360.vcp_footprint import compute_vcp_footprint

_BACKEND = Path(__file__).resolve().parents[1]
IDEAS_CSV = _BACKEND.parent / "data" / "minervini_trade_ideas.csv"
WINDOWS = _BACKEND / "calibration" / "trade_idea_windows"
PRE, POST = 15, 5          # trading-day window around the tweet date
BREAKOUT_VOL = 1.4


def _load(ticker):
    p = WINDOWS / f"{ticker.upper()}.csv.gz"
    if not p.exists():
        return None
    try:
        df = pd.read_csv(io.StringIO(gzip.decompress(p.read_bytes()).decode()),
                         index_col="Date", parse_dates=True)
    except Exception:
        return None
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
    df = df[keep].dropna()
    return df if len(df) else None


def _template_ok(c, i):
    if i < 200:
        return False
    ma50, ma150, ma200 = c.iloc[i-50:i].mean(), c.iloc[i-150:i].mean(), c.iloc[i-200:i].mean()
    ma200p = c.iloc[i-221:i-21].mean() if i >= 221 else ma200
    hi, lo, px = c.iloc[max(0, i-252):i+1].max(), c.iloc[max(0, i-252):i+1].min(), c.iloc[i]
    return bool(px > ma50 > ma150 > ma200 and ma200 > ma200p and px >= lo*1.30 and px >= hi*0.75)


def reproduce(df, t0):
    pos = df.index.searchsorted(pd.Timestamp(t0), side="right")
    lo, hi = max(210, pos - PRE), min(len(df) - 1, pos + POST)
    if hi <= lo:
        return None
    c = df["Close"]
    vol50 = df["Volume"].rolling(50).mean()
    detected = False
    trigger = None
    for i in range(lo, hi + 1):
        fp = compute_vcp_footprint(df.iloc[:i+1])
        if fp.get("detected"):
            detected = True
        piv = fp.get("pivot")
        v50 = float(vol50.iloc[i]) if vol50.iloc[i] == vol50.iloc[i] else 0
        volr = float(df["Volume"].iloc[i]) / v50 if v50 else 0
        if (piv is not None and float(c.iloc[i-1]) <= piv < float(c.iloc[i])
                and volr >= BREAKOUT_VOL and _template_ok(c, i)):
            trigger = {"date": str(df.index[i].date()),
                       "offset_days": int(i - pos), "source": fp.get("source")}
    return {"detected": detected, "buy_trigger": trigger}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="/tmp/reproduce_908.json")
    args = ap.parse_args()
    ideas = [r for r in csv.DictReader(open(IDEAS_CSV)) if r.get("Ticker") and r.get("Date")]
    cache = {}
    n = det = trig = 0
    by_year = defaultdict(lambda: [0, 0, 0])   # n, detected, trigger
    src = defaultdict(int)
    for r in ideas:
        tk = r["Ticker"].upper()
        if tk not in cache:
            cache[tk] = _load(tk)
        df = cache[tk]
        if df is None:
            continue
        res = reproduce(df, pd.Timestamp(r["Date"]))
        if res is None:
            continue
        n += 1
        y = by_year[r["Year"]]
        y[0] += 1
        det += res["detected"]; y[1] += res["detected"]
        if res["buy_trigger"]:
            trig += 1; y[2] += 1
            src[res["buy_trigger"]["source"]] += 1
    print(f"window [-{PRE},+{POST}] trading days around each tweet\n")
    print(f"ideas with windows: {n}")
    print(f"  setup DETECTED in window : {det:4d}  ({100*det/n:.1f}%)")
    print(f"  actionable BUY TRIGGER   : {trig:4d}  ({100*trig/n:.1f}%)  <- 'could we have bought it'")
    print(f"  trigger source mix       : {dict(src)}")
    print("\nby year (n | detected% | buy-trigger%):")
    for y in sorted(by_year):
        c0, c1, c2 = by_year[y]
        print(f"  {y}: {c0:4d} | {100*c1/c0:5.1f}% | {100*c2/c0:5.1f}%")
    Path(args.output).write_text(json.dumps(
        {"n": n, "detected_pct": round(100*det/n, 1), "buy_trigger_pct": round(100*trig/n, 1),
         "source_mix": dict(src), "window": [PRE, POST]}, indent=2))


if __name__ == "__main__":
    main()
