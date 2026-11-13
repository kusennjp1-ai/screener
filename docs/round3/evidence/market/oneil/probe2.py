import importlib.util, json, sys, warnings
warnings.simplefilter('ignore')
import pandas as pd
spec = importlib.util.spec_from_file_location('mr', '/home/user/screener/.claude/worktrees/r3-market-audit/backend/app/services/market_regime.py')
mr = importlib.util.module_from_spec(spec); spec.loader.exec_module(mr)
bars = json.load(open(sys.argv[1]+'/bundle-market-symbols-SPY.json'))
df = pd.DataFrame(bars).set_index('date')[['open','high','low','close','volume']]
df.columns = ['Open','High','Low','Close','Volume']; df.index = pd.to_datetime(df.index)
out={}
for lb in (120, 100, 60):
    mr.FTD_LOOKBACK=lb; tail=df.tail(lb); lows=tail['Low'].to_numpy(); c=tail['Close'].to_numpy(); lp=int(lows.argmin())
    out[lb]=dict(low_date=str(tail.index[lp].date()), decline=round((c[:lp].max()-c[lp])/c[:lp].max()*100,2), detect=str(mr.detect_follow_through(df)))
    mr.FTD_MIN_DECLINE=0.0; out[lb]['detect_no_gate']=str(mr.detect_follow_through(df)); mr.FTD_MIN_DECLINE=0.06
# sessions until 06-09 leaves a 120 window
idx=[str(d.date()) for d in df.index]; out['sessions_since_0609']=len(idx)-1-idx.index('2026-06-09')
# hypothetical: 11-11 volume above 11-10 (what if SPY volume leg passed), gate off, lookback 60
d2=df.copy(); d2.loc['2026-11-11','Volume']=d2.loc['2026-11-10','Volume']*1.05
mr.FTD_LOOKBACK=60; mr.FTD_MIN_DECLINE=0.0; out['hyp_vol_up_gate_off_lb60']=str(mr.detect_follow_through(d2)); r=mr.assess_market_regime(d2); out['hyp_regime']=(r['regime'],r['exposure_pct'])
mr.FTD_MIN_DECLINE=0.06; out['hyp_vol_up_gate_on_lb60']=str(mr.detect_follow_through(d2))
json.dump(out,open(sys.argv[2]+'/probe2.json','w'),indent=1); print(json.dumps(out,indent=1))
