"""Where do Minervini's real entries STILL slip past the shipped footprint?

After C70 (MA-tight) + C75 (ATR volatility-contraction), the footprint union
catches ~56% of his 908 entries. This buckets the REMAINING misses by their
dominant characteristic so the next recall lever is chosen from data, not guessed:

  not_near_high   : at T0 the stock is >15% below its 42-bar high (base still
                    forming deep / not a buyable moment) — low value to chase.
  young_no_2x     : near the highs but prior advance < 2x (first base off a low /
                    IPO) — the discrimination guard deliberately excludes these.
  pullback_to_ma  : near highs, 2x advance, NOT tight (wide) but sitting on the
                    21EMA after an advance — a Minervini add-on pullback (B6),
                    a DIFFERENT entry type than a base breakout.
  tight_other     : near highs + 2x + tight leg, but no depth/MA/ATR contraction
                    signal fired — residual base shapes (W / handle / base-on-base).

Offline on the committed 908 windows. Measurement only.
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
BASE_MAX = 42
PRIOR_LOOK = 126


def bucket(w):
    close, high, low = w["Close"], w["High"], w["Low"]
    if len(close) < BASE_MAX + PRIOR_LOOK:
        return "not_near_high"
    piv = float(high.iloc[-BASE_MAX:].max())
    last = float(close.iloc[-1])
    if piv <= 0 or last < 0.85 * piv:
        return "not_near_high"
    prior_low = float(low.iloc[-(BASE_MAX + PRIOR_LOOK):-BASE_MAX].min())
    if not (prior_low > 0 and piv / prior_low >= 2.0):
        return "young_no_2x"
    c10 = close.iloc[-10:]
    tight = (c10.max() - c10.min()) / c10.max() <= 0.10
    if not tight:
        ema21 = close.ewm(span=21).mean().iloc[-1]
        on_ema = abs(last - ema21) / ema21 <= 0.04
        return "pullback_to_ma" if on_ema else "wide_not_on_ma"
    return "tight_other"


def main():
    ideas = [r for r in csv.DictReader(open(IDEAS)) if r.get("Ticker") and r.get("Date")]
    cache = {}
    n = caught = 0
    miss = {}
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
        if pos < MIN_PRIOR:
            continue
        w = df.iloc[:pos]
        n += 1
        if compute_vcp_footprint(w).get("detected"):
            caught += 1
            continue
        b = bucket(w)
        miss[b] = miss.get(b, 0) + 1

    print(f"entries n={n}  caught(union)={caught} ({100*caught/n:.1f}%)  "
          f"missed={n-caught} ({100*(n-caught)/n:.1f}%)\n")
    print("MISS frontier (share of all entries):")
    for k in sorted(miss, key=lambda x: -miss[x]):
        print(f"  {k:16s} {miss[k]:4d}  ({100*miss[k]/n:4.1f}% of all, "
              f"{100*miss[k]/(n-caught):4.1f}% of misses)")


if __name__ == "__main__":
    main()
