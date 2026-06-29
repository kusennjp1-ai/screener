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
# lower because the regime boundaries come from our estimated formulas, not
# MM360's proprietary ones. To measure the strip honestly we pixel-aligned the
# IBB screenshot exactly (month-label x-anchors -> x = 14.56*baridx, residual
# <1px) and read the real band color above every bar (see scripts/markets360_
# band_calibration.py --date-aligned-ibb). That ground truth drove three changes:
#   - debounce smoothing: raw bands flipped ~2-3x more than the real charts;
#     smoothing brings the flip density onto theirs.
#   - Buy Risk downtrend-gating: forcing "high" on every dip under the 50DMA
#     over-reddened healthy pullbacks. Gating it on a broken trend (under the
#     200DMA too) lifted IBB's full-strip Buy Risk agreement 58% -> 82%.
#   - Pressure phase de-lag: a lag scan (shift OURS by k bars; agreement peaked
#     at lag -5) showed CONFIRM=6 turned the band ~5 bars LATE — flip-count
#     matched but PHASE did not. Dropping to CONFIRM=3 removed the lag, lifting
#     IBB full-strip Pressure 55% -> 75%. Lesson: tune CONFIRM to per-bar
#     agreement, not to flip density.
#   - Pressure indicator swap: a supervised bake-off of nine money-flow indicators
#     (trained on IBB+LLY full strips, tested on 11 held-out right edges) found
#     the Accumulation/Distribution-line slope was simply the wrong indicator.
#     Elder's Force Index (price change * volume, EMA-13) won decisively: IBB
#     full-strip Pressure 75% -> 85%, LLY 67% -> 87%, held-out right edges
#     6/11 -> 9/11. This is the "reverse-engineering" payoff — a better indicator,
#     not a tweak — and it generalised across tickers, so it is not overfitting.
#
# Findings across these 12 (right-edge), with the date-aligned IBB full strip:
#   * Buy Risk  11/12 right-edge; full strip 82%. The one right-edge regression
#     is QURE, a parabolic blow-off where the old below-50DMA rule reddened it
#     only incidentally.
#   * Pressure   9/11 right-edge; full strip 85% IBB / 87% LLY (was ~66% with the
#     AD-slope, then 75% after de-lagging, then 85% after the Force Index swap).
#   * TPR        10/10 right-edge; full strip 58% IBB / 61% LLY (was ~46%/44%).
#     A clean re-extraction (full-band mode, RPR-line removed) showed the gap was
#     real, not noise: the confusion was a heavy bias to amber (real weak/strong
#     borderline bars read transition). Fix: the static 7-cond score saturates a
#     wide 5-6 middle that MM360 splits by trend DIRECTION (advancing->strong,
#     declining->weak). Adding that tiebreak lifted full strip ~50% -> ~60% and
#     right-edge 8/10 -> 10/10. Decisive strong-vs-weak agreement is ~75-78%; the
#     residual is the inherently fuzzy transition boundary (a judgment zone).
#   * Overall    30/33 right-edge. Four systematic, generalizable improvements were
#     found here (Buy Risk semantics, Pressure phase, Pressure indicator swap, TPR
#     direction) — reverse-engineering was NOT at its limit. Per-bar full-strip
#     agreement: Pressure 66->85%, Buy Risk 58->82%, TPR 46->58% (IBB).
# An adversarial audit (5 agents) confirmed the labels (PIL re-extraction 15/15).
# The QQQ/IBB anchor-date correction, band smoothing, and the date-aligned
# full-strip Buy Risk fix came afterward.
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
