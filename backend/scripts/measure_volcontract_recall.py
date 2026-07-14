"""Prototype: does an ATR volatility-contraction base path add VCP recall
OVER the shipped union (VCPDetector ∪ MA-tight) without eroding discrimination?

Grounded in Minervini's literal definition (the 'Studying Historical Winners'
interview): a VCP is "volatility contracting" — NOT strictly decreasing pullback
depths (that monotonic-depth gate, ratio>=0.6, kills 50.7% of his real entries;
scratchpad/vcp_recall_pareto.py). MA-tight (C70, shipped) recovers many via a
10DMA-hug; this VCB path is DISTINCT — it requires ATR to contract from its
in-base peak and the final leg to be tight near the highs, with NO MA-hug, so it
can catch setups that consolidate a bit above the 10DMA. The 2x prior-advance
gate (his "double off lows") is kept as the discrimination guard.

Measures entry-recall vs a T0-63 control. Offline on the committed 908 windows.
Shipped detector/footprint UNTOUCHED — this is measurement only.
"""
import csv, gzip, io, sys
from pathlib import Path
import numpy as np, pandas as pd

BACKEND = Path("/home/user/screener/backend")
sys.path.insert(0, str(BACKEND))
from app.analysis.patterns.legacy_vcp_detection import VCPDetector  # noqa
from app.services.markets360.vcp_footprint import _ma_tight_base  # shipped MA-tight

IDEAS = Path("/home/user/screener/data/minervini_trade_ideas.csv")
WINDOWS = BACKEND / "calibration" / "trade_idea_windows"
MIN_PRIOR = 210
CONTROL_OFFSET = 63

# VCB (volatility-contraction base) params — measured against his tape, grounded
# in the interview, NOT fitted to returns.
BASE_MAX = 42            # up to ~2 months
ATR_LOOK = 10
VCB_ATR_RATIO = 0.70     # end-of-base ATR <= 0.70x its in-base peak (contracting)
VCB_TIGHT_RANGE = 0.10   # last-10 close range <= 10% (tight leg near pivot)
VCB_NEAR_HIGH = 0.85     # close within 15% of the base high
VCB_PRIOR_ADV = 2.0      # "double off lows" — discrimination guard (same as shipped)
VCB_PRIOR_LOOK = 126


def _atr(high, low, close, n=ATR_LOOK):
    pc = close.shift(1)
    tr = pd.concat([(high - low),
                    (high - pc).abs(),
                    (low - pc).abs()], axis=1).max(axis=1)
    return (tr / close).rolling(n).mean()


def vcb_base(close, high, low):
    if len(close) < BASE_MAX + VCB_PRIOR_LOOK:
        return False
    piv = float(high.iloc[-BASE_MAX:].max())
    if piv <= 0:
        return False
    near_high = float(close.iloc[-1]) >= VCB_NEAR_HIGH * piv
    c10 = close.iloc[-10:]
    tight = (c10.max() - c10.min()) / c10.max() <= VCB_TIGHT_RANGE
    atr = _atr(high, low, close).iloc[-BASE_MAX:]
    if atr.isna().all():
        return False
    atr_peak = float(np.nanmax(atr.values))
    atr_now = float(atr.iloc[-1])
    contracting = atr_peak > 0 and (atr_now / atr_peak) <= VCB_ATR_RATIO
    base_low = float(low.iloc[-BASE_MAX:].min())
    prior_low = float(low.iloc[-(BASE_MAX + VCB_PRIOR_LOOK):-BASE_MAX].min())
    prior_ok = prior_low > 0 and (piv / prior_low) >= VCB_PRIOR_ADV
    return bool(near_high and tight and contracting and prior_ok)


def vcp_hit(close_rev, vol_rev):
    return bool(VCPDetector().detect_vcp(close_rev, vol_rev).get("vcp_detected"))


def ma_hit(df_slice):
    # shipped MA-tight path (operates on an OHLC frame, oldest-first)
    return bool(_ma_tight_base(df_slice))


def main():
    ideas = [r for r in csv.DictReader(open(IDEAS)) if r.get("Ticker") and r.get("Date")]
    cache = {}
    keys = ("vcp", "ma", "vcb", "union2", "union3")
    stat = {k: {"n": 0, **{x: 0 for x in keys}} for k in ("entry", "control")}
    # incremental: entries the shipped union missed but VCB catches
    inc_entry = inc_control = 0
    for r in ideas:
        tk = r["Ticker"].upper()
        if tk not in cache:
            p = WINDOWS / f"{tk}.csv.gz"
            cache[tk] = (pd.read_csv(io.StringIO(gzip.decompress(p.read_bytes()).decode()),
                         index_col="Date", parse_dates=True).dropna() if p.exists() else None)
        df = cache[tk]
        if df is None:
            continue
        t0 = pd.Timestamp(r["Date"])
        pos = df.index.searchsorted(t0, side="right")
        for kind, at in (("entry", pos), ("control", pos - CONTROL_OFFSET)):
            if at < MIN_PRIOR:
                continue
            w = df.iloc[:at]
            s = stat[kind]
            s["n"] += 1
            v = vcp_hit(w["Close"].iloc[::-1].reset_index(drop=True),
                        w["Volume"].iloc[::-1].reset_index(drop=True))
            m = ma_hit(w[["Open", "High", "Low", "Close", "Volume"]]
                       if "Open" in w.columns else w)
            b = vcb_base(w["Close"], w["High"], w["Low"])
            u2 = v or m
            u3 = u2 or b
            s["vcp"] += v; s["ma"] += m; s["vcb"] += b
            s["union2"] += u2; s["union3"] += u3
            if b and not u2:
                if kind == "entry":
                    inc_entry += 1
                else:
                    inc_control += 1

    def pct(s, k):
        return 100 * s[k] / (s["n"] or 1)

    for kind in ("entry", "control"):
        s = stat[kind]
        print(f"{kind:8s} n={s['n']:4d} | VCP {pct(s,'vcp'):5.1f} | MA {pct(s,'ma'):5.1f} | "
              f"VCB {pct(s,'vcb'):5.1f} | ∪(VCP,MA) {pct(s,'union2'):5.1f} | "
              f"∪(VCP,MA,VCB) {pct(s,'union3'):5.1f}")
    e, c = stat["entry"], stat["control"]
    print("\nDISCRIMINATION (entry - control):")
    for k, lbl in (("vcp", "VCP     "), ("ma", "MA-tight"), ("vcb", "VCB     "),
                   ("union2", "∪2(ship)"), ("union3", "∪3(+VCB)")):
        print(f"  {lbl}  {pct(e,k)-pct(c,k):+.1f}pp   (entry {pct(e,k):.1f} / control {pct(c,k):.1f})")
    print(f"\nVCB INCREMENTAL over shipped union: entry +{inc_entry} caught, "
          f"control +{inc_control} false  "
          f"(net signal { '+' if inc_entry>inc_control else '' }{inc_entry-inc_control})")


if __name__ == "__main__":
    main()
