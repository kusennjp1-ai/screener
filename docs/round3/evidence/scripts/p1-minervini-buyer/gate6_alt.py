"""Stability of gate-6 definitions over the last 20 sessions of the 980 listed rows (snapshot bars). Read-only."""
import json, sys, statistics as st
rows = [json.loads(l) for l in open(sys.argv[1])]
defs = {
  'single day <=0.8 (current gate 6)': lambda v, i, s50: v[i] / s50 <= 0.8,
  '5-session mean <=0.9': lambda v, i, s50: sum(v[i-4:i+1]) / 5 / s50 <= 0.9,
  '10-session mean <=0.9': lambda v, i, s50: sum(v[i-9:i+1]) / 10 / s50 <= 0.9,
  '>=5 of last 10 sessions <0.8': lambda v, i, s50: sum(1 for j in range(i-9, i+1) if v[j] < 0.8 * (sum(v[j-49:j+1]) / 50)) >= 5,
}
res = {}
for name, f in defs.items():
    flips = []; passes = 0; n = 0; today = 0; ready_today = 0
    for r in rows:
        v = [b['volume'] for b in r['bars']]
        if len(v) < 80: continue
        states = []
        for i in range(len(v) - 20, len(v)):
            s50 = sum(v[i-49:i+1]) / 50
            states.append(bool(f(v, i, s50)))
        flips.append(sum(1 for a, b in zip(states, states[1:]) if a != b)); passes += sum(states); n += len(states)
        today += states[-1]
        if r['setup_ready'] == 'pass': ready_today += states[-1]
    res[name] = dict(mean_flips_20=round(st.mean(flips), 2), pass_share=round(100 * passes / n, 1), pass_today=today, ready37_pass_today=ready_today)
for k, v in res.items(): print(f'{k:36s} {v}')
