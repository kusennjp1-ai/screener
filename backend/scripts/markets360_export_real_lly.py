#!/usr/bin/env python3
"""
Export a Markets 360 chart payload for LLY from REAL OHLCV CSVs.

Runs the actual band/overlay computation (``minervini_bands.calculate_bands`` +
the markets360 chart serializers + rating estimators) on real LLY/SPY daily data
and writes a payload JSON the frontend visual harness can render — so our bands,
computed from real prices, can be placed next to the real MM360 screenshot.

Usage:
  PYTHONPATH=. python3 scripts/markets360_export_real_lly.py \
      --lly lly.csv --spy spy.csv --out ../frontend/tests/smoke/fixtures/lly_real.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.minervini_bands import calculate_bands
from app.services.markets360 import ratings

# Reuse the harness CSV reader (handles yfinance multi-header).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from markets360_band_calibration import _read_csv  # noqa: E402

DISPLAY_BARS = 186  # visible window ~= IMG_2058 (Oct-2025 .. Jun-2026)


def _f(v):
    return None if v is None or (isinstance(v, float) and not np.isfinite(v)) else float(v)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lly", required=True)
    ap.add_argument("--spy", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--display-bars", type=int, default=DISPLAY_BARS)
    args = ap.parse_args()

    lly = _read_csv(args.lly)
    spy = _read_csv(args.spy)
    n = args.display_bars

    # Bands computed on the FULL series (valid MAs), histories trimmed to window.
    bands = calculate_bands(lly, benchmark_close=spy["Close"], with_history=True)
    def tail(key):
        return list(bands.get(key, []))[-n:]

    win = lly.iloc[-n:]
    spy_win = spy.iloc[-n:]
    close = lly["Close"]

    def ma(period):
        m = close.rolling(period).mean().iloc[-n:]
        return [{"time": ts.strftime("%Y-%m-%d"), "value": round(float(v), 2)} for ts, v in m.dropna().items()]

    bars = [{
        "date": ts.strftime("%Y-%m-%d"),
        "open": round(float(r.Open), 2), "high": round(float(r.High), 2),
        "low": round(float(r.Low), 2), "close": round(float(r.Close), 2),
        "volume": int(r.Volume),
    } for ts, r in win.iterrows()]

    last = float(close.iloc[-1]); prev = float(close.iloc[-2])
    payload = {
        "symbol": "LLY", "name": "Eli Lilly & Co.", "exchange": "XNYS", "market": "US",
        "as_of": bars[-1]["date"],
        "quote": {"last": round(last, 2), "bid": None, "ask": None,
                  "change": round(last - prev, 2), "change_pct": round((last - prev) / prev * 100, 2),
                  "volume": int(lly["Volume"].iloc[-1])},
        "ratings": {
            # Computed from real price/benchmark where we can; ER/SR/ESR need
            # fundamentals (not in the CSV) so we carry the chart's printed values.
            "er": 90, "sr": 96,
            "rpr": ratings.compute_rpr(close, spy["Close"]),
            "tpr": ratings.tpr_letter(bands.get("tpr_score"), bands.get("tpr_max")),
            "esr": 97,
            "vcp_pct": _f(ratings.compute_vcp_pct(lly)),
            "vrr_pct": _f(ratings.compute_vrr(lly["Volume"])),
            "dist_20dma_pct": _f(ratings.compute_dist_20dma(close)),
        },
        "states": {
            "trend_stage": {"stage": 2 if bands.get("tpr_state") == "strong" else 3, "label": "", "active": True},
            "pressure": {"state": bands.get("pressure_state")},
            "buy_risk": {"state": bands.get("buy_risk_state")},
            "tpr": {"state": bands.get("tpr_state"), "score": bands.get("tpr_score"), "max": bands.get("tpr_max")},
            "monalert_net": ratings.compute_monalert_net(lly).get("monalert_net"),
        },
        "chart": {
            "period": "1y", "window_days": 270, "benchmark_symbol": "SPY",
            "bars": bars,
            "moving_averages": {"ma21": ma(21), "ma50": ma(50), "ma150": ma(150), "ma200": ma(200)},
            "spy_overlay": [{"time": ts.strftime("%Y-%m-%d"), "value": round(float(c), 2)} for ts, c in spy_win["Close"].items()],
            "rpr_pane": [], "rs_line": [], "blue_dots": [],
            "bands": {"pressure_history": tail("pressure_history"), "buy_risk_history": tail("buy_risk_history"), "tpr_history": tail("tpr_history")},
            "buy_points": [], "vcp_boxes": [], "earnings_markers": [], "monalert": [], "news_markers": [],
        },
        "signal": {"active": False, "type": None, "label": None},
        "quarters": [],
        "degraded_reasons": [],
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(payload))
    print(f"wrote {args.out}  ({len(bars)} bars, last={bars[-1]['date']})")
    print(f"states: pressure={payload['states']['pressure']['state']} buy_risk={payload['states']['buy_risk']['state']} tpr={payload['states']['tpr']['state']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
