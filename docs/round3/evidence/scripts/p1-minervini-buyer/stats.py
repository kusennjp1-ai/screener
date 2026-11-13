"""p1 population statistics over the snapshot's 980 listed rows. Read-only."""
import json, sys, statistics as st
from datetime import date
SNAP, MET = sys.argv[1], sys.argv[2]
met = {m['sym']: m for m in map(json.loads, open(MET))}
rows = [json.loads(l) for l in open(SNAP)]
out = {}
def pct(a, b): return f"{a}/{b} ({100*a/b:.1f}%)" if b else f"{a}/0"
ready = [r for r in rows if r['setup_ready'] == 'pass']
fail = [r for r in rows if r['setup_ready'] == 'fail']
print('listed', len(rows), 'ready', len(ready), 'fail', len(fail), 'unknown', len(rows) - len(ready) - len(fail))

# --- A. pinned price signature
def pinned(m): return m['adr20'] < 0.6 and m['r20'] < 3.0
pin_all = [r for r in rows if pinned(met[r['symbol']])]
pin_ready = [r for r in pin_all if r['setup_ready'] == 'pass']
print('\n[A] pinned (ADR20<0.6% and 20-session range<3%):', len(pin_all), 'listed; ready', pct(len(pin_ready), len(pin_all)), '; ready rate non-pinned', pct(len(ready) - len(pin_ready), len(rows) - len(pin_all)))
print('    pinned ready:', [(r['symbol'], r['setup_engine']['pattern_primary'], round(met[r['symbol']]['r60'], 1), r['ui_liquid_rank']) for r in pin_ready])
print('    pinned ready flagged lowRange (range60<5):', [r['symbol'] for r in pin_ready if met[r['symbol']]['r60'] < 5], ' NOT flagged:', [r['symbol'] for r in pin_ready if met[r['symbol']]['r60'] >= 5])
print('    pinned listed (all):', sorted((r['symbol'], r['setup_ready'], r['setup_engine']['pattern_primary']) for r in pin_all))
pat_ready = {}
for r in ready: pat_ready[r['setup_engine']['pattern_primary']] = pat_ready.get(r['setup_engine']['pattern_primary'], 0) + 1
print('    ready by primary pattern:', pat_ready)
p3 = [r for r in ready if r['setup_engine']['pattern_primary'] == 'three_weeks_tight']
print('    three_weeks_tight ready & pinned:', pct(sum(pinned(met[r['symbol']]) for r in p3), len(p3)))
p3all = [r for r in rows if r['setup_engine']['pattern_primary'] == 'three_weeks_tight']
print('    three_weeks_tight primaries (all listed):', len(p3all), 'pinned', sum(pinned(met[r['symbol']]) for r in p3all), 'ready', sum(r['setup_ready']=='pass' for r in p3all))

# --- B. liquidity
liq = [r for r in ready if r['ui_liquid_rank'] is not None]
print('\n[B] ready on liquid lists:', pct(len(liq), len(ready)))
print('    ready under $10:', [r['symbol'] for r in ready if r['close'] < 10], ' ADV<$5M:', [(r['symbol'], round(r['adv_usd']/1e6,1)) for r in ready if r['adv_usd'] < 5e6])

# --- C. pivot staleness: highest high after the pivot date vs pivot; pivot vs 52w high
def after_pivot_high(r):
    pd_ = (r.get('pivot') or {}).get('pivot_date'); pv = (r.get('pivot') or {}).get('se_pivot_price')
    if not pd_ or not pv: return None
    hs = [b['high'] for b in r['bars'] if b['date'] > pd_]
    return (max(hs) / pv - 1) * 100 if hs else None
print('\n[C] pivot geometry on ready rows (pivot vs 52w high; max high after pivot date vs pivot):')
c_below5 = 0; c_crossed = 0
for r in ready:
    m = met[r['symbol']]; a = after_pivot_high(r)
    if m['piv_vs_hi52'] is not None and m['piv_vs_hi52'] < -5: c_below5 += 1
    if a is not None and a > 3: c_crossed += 1
print('    pivot >5% below 52w high:', pct(c_below5, len(ready)))
print('    traded >3% above pivot after pivot date (pivot already broken & retraced):', pct(c_crossed, len(ready)))
print('    detail:', [(r['symbol'], m['piv_vs_hi52'], round(after_pivot_high(r) or 0, 1)) for r in ready for m in [met[r['symbol']]]])

# --- D. gate 6 (single-day volume/50d)
g6 = [r for r in rows if 'volume_above_dryup_cap' in r['setup_ready_failed_checks']]
g6_only = [r for r in g6 if r['setup_ready_failed_checks'] == ['volume_above_dryup_cap']]
dry10 = [r for r in g6 if met[r['symbol']]['v10'] <= 0.8]
updays = [r for r in g6 if r['bars'][-1]['close'] > r['bars'][-2]['close']]
print('\n[D] gate 6 fails:', len(g6), '; sole failure:', len(g6_only), [r['symbol'] for r in g6_only][:40])
print('    of gate-6 fails, 10-day avg volume <= 0.8x (base dry, one loud day):', pct(len(dry10), len(g6)))
print('    of gate-6 fails, the day was an UP close:', pct(len(updays), len(g6)))
# base rate & flip rate over the last 20 sessions, all listed rows
flips = []; passdays = 0; ndays = 0
for r in rows:
    v = [b['volume'] for b in r['bars']]
    if len(v) < 70: continue
    states = []
    for i in range(len(v) - 20, len(v)):
        s50 = sum(v[i-49:i+1]) / 50
        states.append(v[i] / s50 <= 0.8)
    passdays += sum(states); ndays += len(states)
    flips.append(sum(1 for a, b in zip(states, states[1:]) if a != b))
print('    share of row-days (last 20 sessions, listed rows) where gate 6 passes:', pct(passdays, ndays))
print('    mean gate-6 state flips per row in 20 sessions:', round(st.mean(flips), 2), ' median', st.median(flips))
# what-if: 10-day mean volume instead of the single day (rows whose ONLY failure is gate 6)
wi = [r['symbol'] for r in g6_only if met[r['symbol']]['v10'] <= 0.8]
print('    what-if 10-day mean <=0.8 instead of one day: sole-gate-6 rows that would pass:', len(wi), wi)
# ready rows that pass gate 6 although the 10-day mean is > 0.8 (loud base, one quiet day)
rq = [(r['symbol'], met[r['symbol']]['vlast'], met[r['symbol']]['v10']) for r in ready if met[r['symbol']]['v10'] > 0.8]
print('    ready rows passing gate 6 on one quiet day while the 10-day mean > 0.8x:', len(rq), rq)

# --- E. readiness_score vs handle age for cup_with_handle primaries
asof = date(2026, 11, 12)
cup = [r for r in rows if r['setup_engine']['pattern_primary'] == 'cup_with_handle' and r['setup_engine'].get('readiness_score') is not None and (r.get('pivot') or {}).get('pivot_date')]
buckets = {}
for r in cup:
    wk = (asof - date.fromisoformat(r['pivot']['pivot_date'])).days // 7
    b = min(wk, 16)
    buckets.setdefault(b, []).append(r['setup_engine']['readiness_score'])
print('\n[E] cup_with_handle primaries:', len(cup), ' readiness_score by weeks since pivot (handle) date:')
for b in sorted(buckets):
    xs = buckets[b]
    print(f'    {b:2d}{"+" if b==16 else " "}wk n={len(xs):3d} median={st.median(xs):5.1f} pass>=70={sum(x>=70 for x in xs)}')
rbt = [r for r in rows if 'readiness_below_threshold' in r['setup_ready_failed_checks']]
pats = {}
for r in rbt: pats[r['setup_engine']['pattern_primary']] = pats.get(r['setup_engine']['pattern_primary'], 0) + 1
print('    readiness_below_threshold fails by pattern:', pats)

# --- F. early zone side
oz = [r for r in rows if 'outside_early_zone' in r['setup_ready_failed_checks']]
above = [r for r in oz if (r['pivot'] or {}).get('distance_to_pivot_pct') is not None and r['pivot']['distance_to_pivot_pct'] > 3]
below = [r for r in oz if (r['pivot'] or {}).get('distance_to_pivot_pct') is not None and r['pivot']['distance_to_pivot_pct'] < -2]
none_ = [r for r in oz if (r['pivot'] or {}).get('distance_to_pivot_pct') is None]
print('\n[F] outside_early_zone:', len(oz), ' above +3%:', len(above), ' below -2%:', len(below), ' no distance:', len(none_))
# re-based candidates: above +3% from SE pivot, but within 3% of the 15-session high after a 3-8 week tight area (range<=12%)
reb = []
for r in above:
    b = r['bars'][-25:]
    hi = max(x['high'] for x in b); lo = min(x['low'] for x in b)
    if (hi / lo - 1) * 100 <= 12 and r['close'] >= hi * 0.97 and r['setup_ready_failed_checks'] in (['outside_early_zone'], ['outside_early_zone', 'volume_above_dryup_cap']):
        reb.append((r['symbol'], round(r['pivot']['distance_to_pivot_pct'], 1), round((hi / lo - 1) * 100, 1), r['ui_liquid_rank']))
print('    extended from the SE pivot but sitting at the top of a <=12% 25-session area (possible new base the engine did not re-pivot):', len(reb), reb[:25])

# --- G. stage disagreement on ready rows
print('\n[G] ready rows whose recomputed MinerviniScanner stage is 3:', [r['symbol'] for r in ready if r['stage']['stage'] == 3], ' (SE stage on those:', [r['stage']['se_stage'] for r in ready if r['stage']['stage'] == 3], ')')
# --- H. chart contraction note on ready rows
