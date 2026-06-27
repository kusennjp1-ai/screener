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

# Band colors read off the right edge of each reference screenshot (P/B/T;
# '?' = unreadable/uncertain), and the as-of date the screenshot ends on
# (None = the CSV's last bar). Twelve daily tickers spanning uptrends, pullbacks,
# tops and a downtrend/crash (COIN, QURE).
#
# Findings across these 12, after calibrating all three bands to the real charts:
#   * Buy Risk  12/12 (100%) — BUYRISK_LOW_ATR 4->6 (clean monotone threshold).
#   * TPR       10/10 (100%) — perfect-template-but-rolling-over demotion isolates
#     QQQ (+19% history flips, under cap).
#   * Pressure  10/11 (91%) — crash + distribution sell-overrides catch GEV/QURE
#     (+7% history flips). Only CYRX (a high-and-tight stall, not distribution)
#     remains; fixing it needs a stall rule that floods green leaders -> rejected.
#   * Overall   32/33 (97%), up from 29/33 (88%) pre-Pressure/TPR calibration.
# An adversarial audit (5 agents) confirmed the labels (PIL re-extraction 15/15),
# the Buy Risk plateau, and that these are the only safe gains.
REFERENCE = {
    "FTNT": {"real": "GGG", "asof": None},
    "CYRX": {"real": "RGG", "asof": None},
    "IBB": {"real": "GGG", "asof": None},
    "QQQ": {"real": "RGA", "asof": None},
    "MRVL": {"real": "GGG", "asof": "2026-04-10"},  # older screenshot
    "LLY": {"real": "GG?", "asof": None},           # TPR read uncertain (label overlap)
    "AA": {"real": "GGG", "asof": "2026-03-02"},
    "COIN": {"real": "RRR", "asof": "2026-02-06"},   # downtrend
    "GEV": {"real": "RGG", "asof": "2026-02-05"},    # top pullback (-5.78% day)
    "PRAX": {"real": "GGG", "asof": "2026-01-14"},
    "QURE": {"real": "RR?", "asof": "2025-11-05"},   # parabolic top, -14% day (close ~26)
    "MSFT": {"real": "?GG", "asof": "2025-10-28"},   # Pressure read uncertain (chop->breakout)
}
STATE_TO_COLOR = {
    "buy": "G", "low": "G", "strong": "G",
    "neutral": "A", "medium": "A", "transition": "A",
    "sell": "R", "high": "R", "weak": "R",
}


def main() -> int:
    spy = _read_csv(str(FIX / "spy.csv"))
    agree = total = 0
    tally = [[0, 0], [0, 0], [0, 0]]  # per-band [correct, counted]
    print("tkr   real  ours  match")
    for tkr, spec in REFERENCE.items():
        df = _read_csv(str(FIX / f"{tkr.lower()}.csv"))
        if spec["asof"]:
            df = df[df.index <= pd.Timestamp(spec["asof"])]
        b = mb.calculate_bands(df, benchmark_close=spy["Close"])
        ours = "".join(STATE_TO_COLOR.get(b.get(k), ".") for k in ("pressure_state", "buy_risk_state", "tpr_state"))
        real = spec["real"]
        mark = "".join("o" if real[i] == ours[i] else ("-" if real[i] == "?" else "x") for i in range(3))
        per = [0, 0, 0]  # P, B, T correct (this row)
        for i in range(3):
            if real[i] == "?":
                continue
            total += 1
            ok = ours[i] == real[i]
            agree += ok
            tally[i][0] += ok
            tally[i][1] += 1
        print(f"{tkr:5s} {real}   {ours}   {mark}")
    band_str = "  ".join(
        f"{name} {tally[i][0]}/{tally[i][1]}={round(tally[i][0] / max(tally[i][1], 1) * 100)}%"
        for i, name in enumerate(("Pressure", "BuyRisk", "TPR"))
    )
    print(f"\nper-band: {band_str}")
    print(f"overall right-edge state agreement: {agree}/{total} = {round(agree / total * 100)}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
