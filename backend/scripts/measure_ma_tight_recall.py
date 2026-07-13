"""Prototype: does an MA-tightness base path lift VCP recall without losing
discrimination? Grounded in the 'Studying Historical Winners' interview:
Minervini/Qullamaggie tightness = "multiple tight days on the 10 and/or 20
MA", base "2 weeks to 2 months", "volatility contracting" (NOT strictly
decreasing pullback depths). Measured entry-recall vs T0-63 control fire.
Offline on the committed 908 windows. Shipped detector untouched.
"""
import csv, gzip, io, sys
from pathlib import Path
import numpy as np, pandas as pd

BACKEND = Path("/home/user/screener/backend")
sys.path.insert(0, str(BACKEND))
from app.analysis.patterns.legacy_vcp_detection import VCPDetector  # noqa

IDEAS = Path("/home/user/screener/data/minervini_trade_ideas.csv")
WINDOWS = BACKEND / "calibration" / "trade_idea_windows"
MIN_PRIOR = 210
CONTROL_OFFSET = 63

# MA-tight base params (from the article; measured, not fitted to returns)
BASE_MIN, BASE_MAX = 10, 42          # 2 weeks to 2 months
TIGHT_BARS = 10                      # the tight leg near the pivot
TIGHT_RANGE = 0.12                   # last-10 close range <= 12% (tight consolidation)
MA_HUG = 0.05                        # within 5% of the 10-day MA
HUG_FRAC = 0.5                       # >= half the tight leg hugs the 10DMA
NEAR_HIGH = 0.85                     # close within 15% of the base high
PRIOR_ADV = 1.5                      # prior ~1.5x advance ("double off lows", softened)


def ma_tight_base(close, high, low, require_prior_adv=True):
    if len(close) < BASE_MAX + 126:
        return False
    c = close.iloc[-TIGHT_BARS:]
    piv = float(high.iloc[-BASE_MAX:].max())
    if piv <= 0:
        return False
    # tight consolidation near the highs
    tight = (c.max() - c.min()) / c.max() <= TIGHT_RANGE
    near_high = float(close.iloc[-1]) >= NEAR_HIGH * piv
    # MA hugging (10-day)
    ma10 = close.rolling(10).mean()
    hug = (np.abs(c.values - ma10.iloc[-TIGHT_BARS:].values) / ma10.iloc[-TIGHT_BARS:].values <= MA_HUG)
    hug_ok = np.nanmean(hug) >= HUG_FRAC
    # volatility contraction: later-half daily range < earlier-half (general shrink)
    rng = ((high - low) / close).iloc[-BASE_MAX:]
    h = len(rng) // 2
    vol_shrink = rng.iloc[h:].mean() < rng.iloc[:h].mean()
    # prior advance
    prior_ok = True
    if require_prior_adv:
        base_low = float(low.iloc[-BASE_MAX:].min())
        prior_low = float(low.iloc[-(BASE_MAX + 126):-BASE_MAX].min())
        prior_ok = prior_low > 0 and (piv / prior_low) >= PRIOR_ADV
    return bool(tight and near_high and hug_ok and vol_shrink and prior_ok)


def vcp_hit(close_rev, vol_rev):
    r = VCPDetector().detect_vcp(close_rev, vol_rev)
    return bool(r.get("vcp_detected"))


def main():
    ideas = [r for r in csv.DictReader(open(IDEAS)) if r.get("Ticker") and r.get("Date")]
    cache = {}
    stat = {k: {"n": 0, "vcp": 0, "ma": 0, "ma_np": 0, "either": 0}
            for k in ("entry", "control")}
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
            stat[kind]["n"] += 1
            v = vcp_hit(w["Close"].iloc[::-1].reset_index(drop=True),
                        w["Volume"].iloc[::-1].reset_index(drop=True))
            m = ma_tight_base(w["Close"], w["High"], w["Low"], require_prior_adv=True)
            mnp = ma_tight_base(w["Close"], w["High"], w["Low"], require_prior_adv=False)
            stat[kind]["vcp"] += v
            stat[kind]["ma"] += m
            stat[kind]["ma_np"] += mnp
            stat[kind]["either"] += (v or m)

    for kind in ("entry", "control"):
        s = stat[kind]
        n = s["n"] or 1
        print(f"{kind:8s} n={s['n']:4d} | VCP {100*s['vcp']/n:5.1f}% | "
              f"MA-tight(+prior) {100*s['ma']/n:5.1f}% | MA-tight(no-prior) {100*s['ma_np']/n:5.1f}% | "
              f"VCP∪MA {100*s['either']/n:5.1f}%")
    e, c = stat["entry"], stat["control"]
    ne, nc = e["n"] or 1, c["n"] or 1
    print("\nDISCRIMINATION (entry - control):")
    print(f"  VCP        {100*e['vcp']/ne - 100*c['vcp']/nc:+.1f}pp")
    print(f"  MA-tight   {100*e['ma']/ne - 100*c['ma']/nc:+.1f}pp")
    print(f"  VCP∪MA     {100*e['either']/ne - 100*c['either']/nc:+.1f}pp")


if __name__ == "__main__":
    main()
