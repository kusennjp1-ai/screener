#!/usr/bin/env python3
"""
Markets 360 — multi-ticker right-edge band agreement (reproducible).

For each (real chart, real CSV) pair, compares the CURRENT band state our
``calculate_bands`` computes against the band colors read off the right edge of
the real Minervini Markets 360 screenshot. The right edge aligns exactly to a
known date, so this avoids the time-axis ambiguity of full-history comparison.

This is the evidence behind the Buy Risk calibration (BUYRISK_LOW_ATR 4 -> 6):
run before/after to see right-edge agreement move from 67% to 83% across the six
tickers below.

  PYTHONPATH=. python3 scripts/markets360_band_rightedge_eval.py
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

import app.services.minervini_bands as mb
from markets360_band_calibration import _read_csv  # noqa: E402  (sibling script)

FIX = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "markets360"

# Band colors read off the right edge of each reference screenshot (P/B/T), and
# the as-of date the screenshot ends on (None = the CSV's last bar).
REFERENCE = {
    "FTNT": {"real": "GGG", "asof": None},
    "CYRX": {"real": "RGG", "asof": None},
    "IBB": {"real": "GGG", "asof": None},
    "QQQ": {"real": "RGA", "asof": None},
    "MRVL": {"real": "GGG", "asof": "2026-04-10"},  # this screenshot is older
    "LLY": {"real": "GGR", "asof": None},           # TPR read is uncertain (label overlap)
}
STATE_TO_COLOR = {
    "buy": "G", "low": "G", "strong": "G",
    "neutral": "A", "medium": "A", "transition": "A",
    "sell": "R", "high": "R", "weak": "R",
}


def main() -> int:
    spy = _read_csv(str(FIX / "spy.csv"))
    agree = total = 0
    print("tkr   real  ours  match")
    for tkr, spec in REFERENCE.items():
        df = _read_csv(str(FIX / f"{tkr.lower()}.csv"))
        if spec["asof"]:
            df = df[df.index <= pd.Timestamp(spec["asof"])]
        b = mb.calculate_bands(df, benchmark_close=spy["Close"])
        ours = "".join(STATE_TO_COLOR.get(b.get(k), ".") for k in ("pressure_state", "buy_risk_state", "tpr_state"))
        real = spec["real"]
        mark = "".join("o" if ours[i] == real[i] else "x" for i in range(3))
        for i in range(3):
            total += 1
            agree += ours[i] == real[i]
        print(f"{tkr:5s} {real}   {ours}   {mark}")
    print(f"\nright-edge state agreement: {agree}/{total} = {round(agree / total * 100)}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
