"""Does institutional-demand (Accumulation/Distribution) discriminate Minervini's
real entries from a control? Tests the idea behind the REDFORD 'fund-inflow
buy-list' post using the DAILY price/volume proxy already in the codebase
(AccumulationDistributionCalculator — a CLV*volume money-flow A/D rating, IBD's
"I"/institutional-demand concept). True 13F "$ invested" is quarterly + egress-
gated; the daily A/D rating is its tape-readable proxy and is what we can grade.

For each of the 908 ideas, compute the A/D score at the entry vs a T0-63 control
and report the entry-vs-control gap. A meaningful gap = accumulation carries
timing information about his entries -> worth surfacing / ranking on. Offline on
the committed 908 windows. Measurement only.
"""
import csv, gzip, io, sys
from pathlib import Path
import numpy as np, pandas as pd

BACKEND = Path("/home/user/screener/backend")
sys.path.insert(0, str(BACKEND))
from app.scanners.criteria.accumulation_distribution import (  # noqa
    AccumulationDistributionCalculator, DEFAULT_PERIOD, letter_for_score,
)

IDEAS = Path("/home/user/screener/data/minervini_trade_ideas.csv")
WINDOWS = BACKEND / "calibration" / "trade_idea_windows"
MIN_PRIOR = DEFAULT_PERIOD + 5
CONTROL_OFFSET = 63
STRONG = 70   # ~A/B grade = "under accumulation"


def main():
    calc = AccumulationDistributionCalculator()
    ideas = [r for r in csv.DictReader(open(IDEAS)) if r.get("Ticker") and r.get("Date")]
    cache = {}
    rows = {k: [] for k in ("entry", "control")}
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
            s = calc.calculate_acc_dis_score(df.iloc[:at])
            if s is not None:
                rows[kind].append(s)

    e, c = np.array(rows["entry"]), np.array(rows["control"])
    print(f"n entry={len(e)}  control={len(c)}\n")
    print(f"{'metric':28s} {'entry':>8} {'control':>8} {'gap':>8}")
    print(f"{'mean A/D score':28s} {e.mean():8.1f} {c.mean():8.1f} {e.mean()-c.mean():+8.1f}")
    print(f"{'median A/D score':28s} {np.median(e):8.1f} {np.median(c):8.1f} {np.median(e)-np.median(c):+8.1f}")
    for thr in (60, STRONG, 80):
        pe, pc = 100*(e >= thr).mean(), 100*(c >= thr).mean()
        print(f"{'%% score >= '+str(thr):28s} {pe:8.1f} {pc:8.1f} {pe-pc:+8.1f}")
    # letter-grade distribution at entry
    from collections import Counter
    dist = Counter(letter_for_score(int(x)) for x in e)
    tot = sum(dist.values())
    print("\nentry letter-grade mix: " +
          "  ".join(f"{g}:{100*dist.get(g,0)/tot:.0f}%" for g in "ABCDE"))


if __name__ == "__main__":
    main()
