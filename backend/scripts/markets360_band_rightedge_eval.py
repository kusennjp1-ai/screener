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
# '?' = unreadable/uncertain), and the as-of date the screenshot ends on.
# IMPORTANT: the as-of must be the bar the SCREENSHOT actually ends on, not the
# CSV's last bar. Most captures are intraday of the CSV's final bar (asof=None is
# correct: LLY/FTNT/CYRX), but two were taken earlier — QQQ ends 2026-06-15 and
# IBB ends 2026-06-23. An earlier audit wrongly anchored QQQ to the CSV tail
# (06-26), where our bands happen to read RGA and matched; at the true 06-15 edge
# our bands read GGG, so the match is only Buy Risk. Always verify the screenshot
# close+%change against the CSV before trusting an anchor.
#
# This is a RIGHT-EDGE (single most-recent bar) metric — it says nothing about
# how well the *whole* strip matches. The full-strip per-bar agreement is far
# lower (~49%) because the regime boundaries come from our estimated formulas, not
# MM360's proprietary ones. What the smoothing layer (minervini_bands debounce)
# fixes is the band's SMOOTHNESS: our raw bands flipped ~2-3x more often than the
# real charts; after smoothing the flip density matches (~10 per band per window),
# so the strip reads as MM360-style blocks instead of bar-to-bar chop.
#
# Findings across these 12 (with the debounce smoothing on):
#   * Buy Risk  12/12 (100%) — BUYRISK_LOW_ATR 4->6 (clean monotone threshold).
#   * TPR        8/10 (80%) — rolling-over demotion handles the tops; QQQ's
#     V-bounce correctly reads transition. Residual lag at IBB/MSFT right edges.
#   * Pressure   9/11 (82%) — crash/distribution sell + breakout buy overrides
#     flip hard through the smoothing. QQQ now matches (RGA); misses are AA/PRAX.
#   * Overall   29/33 (88%) with smoothing, vs 30/33 raw — smoothing trades ~1
#     right-edge call for matching the real charts' block structure. The headline
#     regime calls (uptrend/top/downtrend/crash) all match; the residual is the
#     inherent lag of a smoothed state vs a freshly-turned bar.
# An adversarial audit (5 agents) confirmed the labels (PIL re-extraction 15/15)
# and the Buy Risk plateau. The QQQ/IBB anchor-date correction and the band
# smoothing came afterward.
REFERENCE = {
    "FTNT": {"real": "GGG", "asof": None},      # intraday capture of the last CSV bar
    "CYRX": {"real": "RGG", "asof": None},      # intraday capture of the last CSV bar
    "IBB": {"real": "GGG", "asof": "2026-06-23"},  # screenshot ends 06-23 (C~178), not the CSV's 06-26
    "QQQ": {"real": "RGA", "asof": "2026-06-15"},   # screenshot ends 06-15 (C 743 V-bounce), not 06-26
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
