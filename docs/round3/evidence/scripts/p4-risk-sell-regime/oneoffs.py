"""p4-risk-sell-regime: the one-off measurements behind the report, in one re-runnable script.

Usage: python3 -I oneoffs.py <P4 dir> <SNAP dir>
Reads only: SNAP/rows.jsonl, SNAP/build/work/benchmark.json, P4/serve/research.json, P4/serve/charts/*.json,
P4/work/sell-eval.jsonl. Prints each measurement under its heading.
"""
import json
import sys
from collections import Counter

P4, SNAP = sys.argv[1], sys.argv[2]
rows = [json.loads(l) for l in open(f"{SNAP}/rows.jsonl")]
ev = [json.loads(l) for l in open(f"{P4}/work/sell-eval.jsonl")]
evs = {r["symbol"]: r for r in ev}
research = {r["symbol"]: r for r in json.load(open(f"{P4}/serve/research.json"))["rows"]}

print("== 1. SPY (bundle) on 2026-11-12: SMAs and distribution days in 25 sessions")
bars = json.load(open(f"{SNAP}/build/work/benchmark.json"))["bars"]
c = [b["close"] for b in bars]
v = [b["volume"] for b in bars]
sma = lambda n, i: sum(c[i - n + 1:i + 1]) / n
i = len(c) - 1
print(" close", c[i], "sma50 %.2f" % sma(50, i), "sma200 %.2f" % sma(200, i), "60d high close %.2f" % max(c[-60:]))
dd = [bars[j]["date"] for j in range(len(c) - 25, len(c)) if (c[j] / c[j - 1] - 1) <= -0.002 and v[j] > v[j - 1]]
print(" distribution days", len(dd), dd)

print("== 2. Analysis-day volume: round lots (x100) by date, seed-accepted listed rows")
by = Counter()
tot = Counter()
for r in rows:
    if r["bars_basis"] != "bundle_seed_accepted":
        continue
    for b in r["bars"][-8:]:
        tot[b["date"]] += 1
        by[b["date"]] += b["volume"] % 100 == 0
for d in sorted(tot):
    print(" ", d, tot[d], "round", by[d])

print("== 3. Failed-breakout hits: crossing before the pivot bar (strict) / on or before se_pivot_date (soft)")
soft = strict = n = 0
for r in ev:
    hit = [x for x in (r["sells"] or {}).get("weakness", []) if x["key"] == "failedBreakout" and x["state"] == "hit"]
    if not hit:
        continue
    n += 1
    h = hit[0]
    pd = research[r["symbol"]].get("se_pivot_date")
    cb = json.load(open(f"{P4}/serve/charts/{r['symbol']}.json"))["bars"]
    pb = [b["date"] for b in cb if round(b["high"] * 100) == round(r["pivot"] * 100) and (pd is None or b["date"] <= pd)]
    s1 = pd is not None and h["crossDate"] <= pd
    s2 = bool(pb) and h["crossDate"] < pb[-1]
    soft += s1
    strict += s2
    if s1 or s2:
        print(" ", r["symbol"], r["liquidRank"], research[r["symbol"]].get("se_pivot_type"), "pivot", r["pivot"], "pivot date", pd, "pivot bar", pb[-1] if pb else None, "claimed breakout", h["crossDate"])
print(" hits", n, "soft", soft, "strict", strict)

print("== 4. Structural stop and ADR on certified zone/near rows with a plan")
sel = [r for r in ev if r["certified"] and r["position"] in ("zone", "near") and r["plan"] and "structural" in r["plan"]]
print(" rows", len(sel), Counter(r["plan"]["structural"]["state"] for r in sel), "stopInsideBase", Counter(r["plan"]["stopInsideBase"] for r in sel))
ad = sorted(r["plan"]["adrPercent"] for r in sel if r["plan"]["adrPercent"] is not None)
print(" ADR20 p10/p50/p90 %.2f/%.2f/%.2f" % (ad[len(ad) // 10], ad[len(ad) // 2], ad[9 * len(ad) // 10]))

print("== 5. Pinned-looking listed rows: ADR20, 20/60-session range, largest open gap in 60 sessions")
flag = []
for r in rows:
    b = r["bars"]
    if len(b) < 60:
        continue
    w = b[-20:]
    adr = sum(x["high"] / x["low"] - 1 for x in w) / 20 * 100
    r20 = (max(x["high"] for x in w) / min(x["low"] for x in w) - 1) * 100
    r60 = (max(x["high"] for x in b[-60:]) / min(x["low"] for x in b[-60:]) - 1) * 100
    gap = max(((b[k]["open"] / b[k - 1]["close"] - 1) * 100 for k in range(len(b) - 60, len(b))), key=abs)
    low_now = r60 < 5  # the existing guard (price_activity.lowRange, 60 sessions)
    proposed = adr < 0.5 or r20 < 3  # the example 20-session test
    e = evs.get(r["symbol"], {})
    if proposed and not low_now:
        flag.append((r["symbol"], r["ui_liquid_rank"], r["setup_ready"], r["bars_basis"], e.get("position"), round(adr, 2), round(r20, 2), round(r60, 1), round(gap, 1)))
print(" newly flagged by ADR20<0.5% or range20<3% (not already lowRange):", len(flag))
for f in sorted(flag, key=lambda x: x[5]):
    print("  ", f)
