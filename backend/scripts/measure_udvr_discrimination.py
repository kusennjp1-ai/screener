"""Compare institutional-demand proxies for how well they discriminate
Minervini's real entries from a T0-63 control:

  acc_dis65   : the shipped CLV money-flow A/D score (0-99) — weak (+1.7 gap,
                everyone clusters at 'C'; scripts/measure_accdis_discrimination.py)
  udvr50/25   : up/down VOLUME ratio = sum(vol on up-days)/sum(vol on down-days)
                over N days — O'Neil's actual accumulation footprint (big players
                move price up on heavy volume). >1.0 = accumulation.
  acc_days50  : (accumulation days - distribution days) over 50 days, where an
                accumulation day = close up on >=1.25x the 50d avg volume, a
                distribution day = close down >=0.2% on >=1.25x volume.

A proxy that separates entry from control carries institutional-demand timing
info -> worth surfacing / ranking on. Offline on the 908 windows. Measurement only.
"""
import csv, gzip, io, sys
from pathlib import Path
import numpy as np, pandas as pd

BACKEND = Path("/home/user/screener/backend")
sys.path.insert(0, str(BACKEND))
from app.scanners.criteria.accumulation_distribution import AccumulationDistributionCalculator  # noqa

IDEAS = Path("/home/user/screener/data/minervini_trade_ideas.csv")
WINDOWS = BACKEND / "calibration" / "trade_idea_windows"
CONTROL_OFFSET = 63
MIN_PRIOR = 80


def udvr(df, n):
    c = df["Close"]; v = df["Volume"]
    ch = c.diff()
    up = v[ch > 0].tail(n).sum()
    dn = v[ch < 0].tail(n).sum()
    return float(up / dn) if dn > 0 else np.nan


def acc_days(df, n=50):
    c = df["Close"]; v = df["Volume"]
    v50 = v.rolling(50).mean()
    ch = c.pct_change()
    seg = df.tail(n)
    idx = seg.index
    acc = dis = 0
    for d in idx:
        vr = v.loc[d] / v50.loc[d] if v50.loc[d] == v50.loc[d] and v50.loc[d] > 0 else 0
        if vr >= 1.25 and ch.loc[d] > 0:
            acc += 1
        elif vr >= 1.25 and ch.loc[d] <= -0.002:
            dis += 1
    return acc - dis


def main():
    calc = AccumulationDistributionCalculator()
    ideas = [r for r in csv.DictReader(open(IDEAS)) if r.get("Ticker") and r.get("Date")]
    cache = {}
    keys = ("acc_dis65", "udvr50", "udvr25", "acc_days50")
    data = {kind: {k: [] for k in keys} for kind in ("entry", "control")}
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
            s = calc.calculate_acc_dis_score(w)
            data[kind]["acc_dis65"].append(s if s is not None else np.nan)
            data[kind]["udvr50"].append(udvr(w, 50))
            data[kind]["udvr25"].append(udvr(w, 25))
            data[kind]["acc_days50"].append(acc_days(w, 50))

    def stat(kind, k):
        a = np.array(data[kind][k], dtype="float64")
        return a[np.isfinite(a)]

    print(f"n entry={len(data['entry']['udvr50'])}  control={len(data['control']['udvr50'])}\n")
    print(f"{'proxy':12} {'entry_med':>10} {'ctrl_med':>10} {'gap':>8} {'entry>thr%':>10} {'ctrl>thr%':>10} {'disc':>7}")
    thr = {"acc_dis65": 60, "udvr50": 1.20, "udvr25": 1.20, "acc_days50": 2}
    for k in keys:
        e, c = stat("entry", k), stat("control", k)
        pe, pc = 100*(e >= thr[k]).mean(), 100*(c >= thr[k]).mean()
        print(f"{k:12} {np.median(e):10.2f} {np.median(c):10.2f} "
              f"{np.median(e)-np.median(c):+8.2f} {pe:10.1f} {pc:10.1f} {pe-pc:+7.1f}")
    print("\n'disc' = entry%>threshold - control%>threshold (higher = more timing signal)")


if __name__ == "__main__":
    main()
