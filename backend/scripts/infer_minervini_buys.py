"""Infer likely buy dates + reasons for Minervini's live-holdings tweet by
running each name through the shipped Buy Signal engine day-by-day.

The 2026-07-14 post groups the book into: best-performers-from-buy-points,
open-losses, and still-flattish new positions. We don't have his dates, but we
have OHLCV through 2026-07-10 (the backtest bundle) and the very engine the
screener uses. For each ticker we scan the last ~30 sessions and locate the
breakout day (close clears the VCP/base pivot on volume with the trend
template intact) — the actionable buy point — and describe why. The post's own
grouping is the ground-truth check: best performers should show a breakout
that then advanced; new "flattish" names should be coiling near a pivot.

Offline: reads the committed backtest bundle (no egress).
"""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.markets360.vcp_footprint import compute_vcp_footprint

BEST = ["KRYS", "MATX", "MNST", "FTNT", "CRWD", "CSX", "PACS"]   # up from buy points
LOSS = ["BUD", "GEV"]                                            # open losses
NEW = ["EBAY", "LLY", "HSBC", "BATRK", "XMTR"]                   # still flattish
GROUP = {t: "best" for t in BEST} | {t: "loss" for t in LOSS} | {t: "new" for t in NEW}

SCAN_SESSIONS = 50       # look back this many sessions for the buy point
BREAKOUT_VOL = 1.4


def _panel(bundle_path: Path):
    payload = json.loads(gzip.open(bundle_path).read())
    out = {}
    for row in payload["rows"]:
        if row["symbol"] not in GROUP and row["symbol"] != "SPY":
            continue
        df = pd.DataFrame(row["prices"])
        if "adj_close" not in df or df["adj_close"].isna().all():
            continue
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
        f = df["adj_close"] / df["close"]
        out[row["symbol"]] = pd.DataFrame({
            "Open": df["open"] * f, "High": df["high"] * f, "Low": df["low"] * f,
            "Close": df["adj_close"], "Volume": df["volume"].astype(float),
        })
    return out, payload.get("as_of_date")


def _template_ok(df, i):
    c = df["Close"]
    if i < 200:
        return False
    ma50 = c.iloc[i - 50:i].mean()
    ma150 = c.iloc[i - 150:i].mean()
    ma200 = c.iloc[i - 200:i].mean()
    ma200_prev = c.iloc[i - 221:i - 21].mean() if i >= 221 else ma200
    hi = c.iloc[max(0, i - 252):i + 1].max()
    lo = c.iloc[max(0, i - 252):i + 1].min()
    px = c.iloc[i]
    return bool(px > ma50 > ma150 > ma200 and ma200 > ma200_prev
               and px >= lo * 1.30 and px >= hi * 0.75)


def infer(df: pd.DataFrame):
    """Return the most recent buy-point day + reason within the scan window."""
    n = len(df)
    if n < 210:
        return None
    ma50 = df["Close"].rolling(50).mean()
    vol50 = df["Volume"].rolling(50).mean()
    events = []
    for i in range(n - SCAN_SESSIONS, n):
        if i < 210:
            continue
        w = df.iloc[:i + 1]
        fp = compute_vcp_footprint(w)
        piv = fp.get("pivot")
        c, cprev = float(df["Close"].iloc[i]), float(df["Close"].iloc[i - 1])
        v = float(df["Volume"].iloc[i])
        v50 = float(vol50.iloc[i]) if vol50.iloc[i] == vol50.iloc[i] else 0
        volr = v / v50 if v50 else 0
        tmpl = _template_ok(df, i)
        # breakout day = crossed above the (VCP/base) pivot on volume, template intact
        crossed = piv is not None and cprev <= piv < c and volr >= BREAKOUT_VOL and tmpl
        if crossed:
            events.append({
                "date": str(df.index[i].date()), "type": "breakout",
                "px": round(c, 2), "pivot": round(piv, 2), "volr": round(volr, 1),
                "source": fp.get("source"), "above_50d": bool(c > ma50.iloc[i]),
            })
    last = df.iloc[-1]
    fp_now = compute_vcp_footprint(df)
    state = {
        "last_date": str(df.index[-1].date()),
        "last_close": round(float(last["Close"]), 2),
        "vcp_detected": fp_now.get("detected"),
        "source": fp_now.get("source"),
        "near_pivot": fp_now.get("near_pivot"),
        "ready": fp_now.get("ready_for_breakout"),
        "pivot": round(fp_now["pivot"], 2) if fp_now.get("pivot") else None,
        "dist_to_pivot_pct": round(fp_now["distance_to_pivot_pct"], 1) if fp_now.get("distance_to_pivot_pct") is not None else None,
        "pct_from_50d": round(100 * (float(last["Close"]) / ma50.iloc[-1] - 1), 1) if ma50.iloc[-1] == ma50.iloc[-1] else None,
        "template_ok": _template_ok(df, len(df) - 1),
    }
    return {"buy_events": events, "state_now": state}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--output", default="/tmp/minervini_buys.json")
    args = ap.parse_args()
    panel, as_of = _panel(Path(args.bundle))
    print(f"bundle as_of {as_of}\n")
    result = {}
    for t in BEST + LOSS + NEW:
        if t not in panel:
            print(f"{t:6s} [{GROUP[t]:4s}]  (not in bundle)")
            continue
        r = infer(panel[t])
        result[t] = r
        if r is None:
            print(f"{t:6s} [{GROUP[t]:4s}]  (insufficient history)")
            continue
        s = r["state_now"]
        ev = r["buy_events"]
        last_ev = ev[-1] if ev else None
        buy = (f"BUY {last_ev['date']} @{last_ev['px']} (pivot {last_ev['pivot']}, "
               f"vol {last_ev['volr']}x, src={last_ev['source']})") if last_ev else "no clean breakout in window"
        print(f"{t:6s} [{GROUP[t]:4s}]  {buy}")
        print(f"        now {s['last_date']} close {s['last_close']} | +{s['pct_from_50d']}% vs 50DMA | "
              f"vcp={s['vcp_detected']}({s['source']}) near_pivot={s['near_pivot']} dist={s['dist_to_pivot_pct']}% tmpl={s['template_ok']}")
    Path(args.output).write_text(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
