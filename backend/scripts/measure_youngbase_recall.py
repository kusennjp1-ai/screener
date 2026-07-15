"""Prototype: recover the 'young_no_2x' miss population (72% of residual misses,
scripts/vcp_miss_frontier.py) by swapping the arbitrary 2x 'double off the lows'
discrimination guard for Minervini's ACTUAL gate — the Stage-2 trend template.

His documented entries include first-bases / early leaders that never doubled;
the 2x guard excludes them. A young tight base near the highs that is ALSO in a
confirmed Stage 2 (price > 50 > 150 > 200 DMA, 200DMA rising, 30% off the low,
within 25% of the high) is a valid Minervini setup. Question: does a
trend-template-gated young-base path add entry recall over the shipped footprint
WITHOUT eroding entry-vs-control discrimination? (The control is the guard's job.)

Baseline union = the SHIPPED compute_vcp_footprint (VCP ∪ MA-tight ∪ VCB).
Offline on the 908 windows. Measurement only.
"""
import csv, gzip, io, sys
from pathlib import Path
import numpy as np, pandas as pd

BACKEND = Path("/home/user/screener/backend")
sys.path.insert(0, str(BACKEND))
from app.services.markets360.vcp_footprint import compute_vcp_footprint  # noqa

IDEAS = Path("/home/user/screener/data/minervini_trade_ideas.csv")
WINDOWS = BACKEND / "calibration" / "trade_idea_windows"
MIN_PRIOR = 210
CONTROL_OFFSET = 63
BASE_MAX = 42
YB_TIGHT = 0.10
YB_NEAR_HIGH = 0.85
YB_ATR_LOOK = 10
YB_ATR_RATIO = 0.75    # a bit looser than VCB's 0.70 (no 2x means we lean on the template)


def trend_template_ok(close):
    c = close.values
    if len(c) < 252:
        return False
    px = c[-1]
    ma50, ma150, ma200 = c[-50:].mean(), c[-150:].mean(), c[-200:].mean()
    ma200_prev = c[-221:-21].mean() if len(c) >= 221 else ma200
    lo252, hi252 = c[-252:].min(), c[-252:].max()
    return bool(px > ma50 > ma150 > ma200 and ma200 > ma200_prev
                and px >= lo252 * 1.30 and px >= hi252 * 0.75)


def young_base(w):
    close, high, low = w["Close"], w["High"], w["Low"]
    if len(close) < 252:
        return False
    piv = float(high.iloc[-BASE_MAX:].max())
    last = float(close.iloc[-1])
    if piv <= 0 or last < YB_NEAR_HIGH * piv:
        return False
    c10 = close.iloc[-10:]
    if (c10.max() - c10.min()) / c10.max() > YB_TIGHT:
        return False
    pc = close.shift(1)
    tr = pd.concat([(high - low), (high - pc).abs(), (low - pc).abs()], axis=1).max(axis=1)
    atr = (tr / close).rolling(YB_ATR_LOOK).mean().iloc[-BASE_MAX:]
    if atr.isna().all():
        return False
    contracting = float(np.nanmax(atr.values)) > 0 and \
        float(atr.iloc[-1]) / float(np.nanmax(atr.values)) <= YB_ATR_RATIO
    return bool(contracting and trend_template_ok(close))


def main():
    ideas = [r for r in csv.DictReader(open(IDEAS)) if r.get("Ticker") and r.get("Date")]
    cache = {}
    stat = {k: {"n": 0, "union": 0, "yb": 0, "union2": 0} for k in ("entry", "control")}
    inc_e = inc_c = 0
    for r in ideas:
        tk = r["Ticker"].upper()
        if tk not in cache:
            p = WINDOWS / f"{tk}.csv.gz"
            cache[tk] = (pd.read_csv(io.StringIO(gzip.decompress(p.read_bytes()).decode()),
                         index_col="Date", parse_dates=True).dropna() if p.exists() else None)
        df = cache[tk]
        if df is None:
            continue
        pos = df.index.searchsorted(pd.Timestamp(r["Date"]), side="right")
        for kind, at in (("entry", pos), ("control", pos - CONTROL_OFFSET)):
            if at < MIN_PRIOR:
                continue
            w = df.iloc[:at]
            s = stat[kind]
            s["n"] += 1
            u = bool(compute_vcp_footprint(w).get("detected"))
            y = young_base(w)
            s["union"] += u
            s["yb"] += y
            s["union2"] += (u or y)
            if y and not u:
                if kind == "entry":
                    inc_e += 1
                else:
                    inc_c += 1

    def pct(s, k):
        return 100 * s[k] / (s["n"] or 1)

    for kind in ("entry", "control"):
        s = stat[kind]
        print(f"{kind:8s} n={s['n']:4d} | union(ship) {pct(s,'union'):5.1f} | "
              f"YoungBase {pct(s,'yb'):5.1f} | union+YB {pct(s,'union2'):5.1f}")
    e, c = stat["entry"], stat["control"]
    print("\nDISCRIMINATION (entry - control):")
    for k, lbl in (("union", "union(ship)"), ("yb", "YoungBase  "), ("union2", "union+YB   ")):
        print(f"  {lbl}  {pct(e,k)-pct(c,k):+.1f}pp   (entry {pct(e,k):.1f} / control {pct(c,k):.1f})")
    print(f"\nYoungBase INCREMENTAL over shipped union: entry +{inc_e}, control +{inc_c}  "
          f"(net {'+' if inc_e>=inc_c else ''}{inc_e-inc_c}, "
          f"precision {100*inc_e/((inc_e+inc_c) or 1):.0f}%)")


if __name__ == "__main__":
    main()
