import importlib.util, json, sys
import pandas as pd, numpy as np
spec = importlib.util.spec_from_file_location('mr', '/home/user/screener/.claude/worktrees/r3-market-audit/backend/app/services/market_regime.py')
mr = importlib.util.module_from_spec(spec); spec.loader.exec_module(mr)
out={}
for name in ('SPY','QQQ'):
    bars = json.load(open(f'{sys.argv[1]}/bundle-market-symbols-{name}.json'))
    df = pd.DataFrame(bars).set_index('date')[['open','high','low','close','volume']]
    df.columns = ['Open','High','Low','Close','Volume']; df.index = pd.to_datetime(df.index)
    tail = df.tail(mr.FTD_LOOKBACK); lows=tail['Low'].to_numpy(); closes=tail['Close'].to_numpy()
    lp=int(lows.argmin()); ph=float(closes[:lp].max()); dec=(ph-closes[lp])/ph
    r = mr.assess_market_regime(df); f = mr.detect_follow_through(df)
    out[name]=dict(window_start=str(tail.index[0].date()), low_date=str(tail.index[lp].date()), sessions_after_low=len(closes)-1-lp, prior_high_close=ph, decline_pct=round(dec*100,2), gate6_pass=bool(dec>=mr.FTD_MIN_DECLINE),
        detect=None if f is None else {k:(str(v) if k=='date' else v) for k,v in f.items()}, regime=r['regime'], exposure=r['exposure_pct'], dist=r['distribution_days'], health=r['health'], above50=bool(r['above_50dma']))
    # what if the 6% gate were absent
    mr.FTD_MIN_DECLINE=0.0; f2=mr.detect_follow_through(df); mr.FTD_MIN_DECLINE=0.06
    out[name]['detect_without_gate']=None if f2 is None else {k:(str(v) if k=='date' else v) for k,v in f2.items()}
json.dump(out, open(sys.argv[2]+'/backend_ftd_probe.json','w'), indent=1); print(json.dumps(out, indent=1))
