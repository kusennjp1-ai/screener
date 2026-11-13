# Replay backend assess_market_regime (worktree code, 7f0ff13) on the bundle's SPY bars, at 11-12 and on each session
# since 10-01, to compare with the feature run's published fields (correction / 6 / 20 / 58.7).
import importlib.util, json, sys
import pandas as pd
spec = importlib.util.spec_from_file_location('mr', '/home/user/screener/.claude/worktrees/r3-market-audit/backend/app/services/market_regime.py')
mr = importlib.util.module_from_spec(spec); spec.loader.exec_module(mr)
bars = json.load(open(sys.argv[1]))
df = pd.DataFrame(bars).set_index('date')[['open','high','low','close','volume']]
df.columns = ['Open','High','Low','Close','Volume']; df.index = pd.to_datetime(df.index)
out = {}
for d in [x for x in df.index if x >= pd.Timestamp('2026-09-01')]:
    r = mr.assess_market_regime(df.loc[:d])
    out[str(d.date())] = {k: r[k] for k in ('regime','health','exposure_pct','distribution_days','above_50dma','above_200dma','fifty_above_200','pct_from_high')} | {'ftd': r['components']['follow_through'], 'trend_ok': r['components']['trend_ok'], 'fifty_rising': r['components']['fifty_rising']}
json.dump(out, open(sys.argv[2], 'w'), indent=1, default=str)
for k, v in out.items(): print(k, v)
