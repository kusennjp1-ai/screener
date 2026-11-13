# m2-oneil skeptic recompute. Inputs are data only (run with python3 -I).
import importlib.util, json, sys
import pandas as pd, numpy as np
INV, OUT = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location('mr', '/home/user/screener/.claude/worktrees/r3-market-audit/backend/app/services/market_regime.py')
mr = importlib.util.module_from_spec(spec); spec.loader.exec_module(mr)
def frame(bars):
    df = pd.DataFrame(bars).set_index('date')[['open','high','low','close','volume']]
    df.columns = ['Open','High','Low','Close','Volume']; df.index = pd.to_datetime(df.index); return df
ser = {'SPY': frame(json.load(open(INV+'/bundle-market-symbols-SPY.json'))), 'QQQ': frame(json.load(open(INV+'/bundle-market-symbols-QQQ.json')))}
for ix in json.load(open(INV+'/study-release/indices.json'))['indices']:
    ser[ix['symbol']] = frame(ix['bars'][-800:])
res = {}
CAP = {'confirmed_uptrend': 50, 'uptrend_under_pressure': 25}
def cap(r):
    if r['above_200dma'] is False or r['above_50dma'] is False: return 0
    return CAP.get(r['regime'], 0)
def replay(name, end, n=250):
    df = ser[name].loc[:end]; rows = []
    for d in df.index[-n:]:
        r = mr.assess_market_regime(df.loc[:d])
        rows.append(dict(date=str(d.date()), regime=r['regime'], dist=r['distribution_days'], a50=r['above_50dma'], a200=r['above_200dma'], trend_ok=r['components']['trend_ok'], from_high_pct=round(r['pct_from_high'],2), cap=cap(r), ftd=str(r['components']['follow_through'])))
    return rows
def summ(rows):
    n = len(rows); tk = [x for x in rows if x['trend_ok']]
    flips = dict(zero_to_open=sum(1 for a, b in zip(rows, rows[1:]) if (a['cap']==0)!=(b['cap']==0)), open_25_50=sum(1 for a, b in zip(rows, rows[1:]) if a['cap']!=b['cap'] and a['cap']>0 and b['cap']>0))
    return dict(n=n, first=rows[0]['date'], last=rows[-1]['date'], share_ge4=round(sum(x['dist']>=4 for x in rows)/n,3), share_ge5=round(sum(x['dist']>=5 for x in rows)/n,3),
        trend_ok=len(tk), trend_ok_lt4=sum(x['dist']<4 for x in tk), caps={c: sum(x['cap']==c for x in rows) for c in (0,25,50)}, cap_flips=flips,
        regimes={k: sum(x['regime']==k for x in rows) for k in set(x['regime'] for x in rows)})
# 1) backend replay on SPY to 11-12 and on a common window to 11-03 for SPY vs ^GSPC (backend rule incl. stalling)
spy = replay('SPY', '2026-11-12'); res['spy_1112'] = summ(spy)
res['spy_recent'] = [x for x in spy if x['date'] >= '2026-10-01']
res['spy_1103'] = summ(replay('SPY', '2026-11-03')); res['gspc_1103'] = summ(replay('^GSPC', '2026-11-03'))
res['qqq_1112_last'] = replay('QQQ', '2026-11-12', 1)[0]
# 2) FTD anchor: lows in the 120 window, and what the anchor becomes as 06-09 rolls out (holding later bars fixed = hypothetical)
t = ser['SPY'].tail(120); lows = t['Low']
order = lows.sort_values().head(8)
res['spy_window_lows'] = [dict(date=str(d.date()), low=round(v,2), pos=int(t.index.get_loc(d))) for d, v in order.items()]
res['spy_1105_low'] = round(float(ser['SPY'].loc['2026-11-05','Low']),2)
anch = []
for k in (120, 109, 108, 100, 90, 80, 70, 60, 50, 40):
    tt = ser['SPY'].tail(k); lp = int(tt['Low'].to_numpy().argmin()); c = tt['Close'].to_numpy()
    ph = c[:lp].max() if lp >= 1 else None
    anch.append(dict(window=k, low_date=str(tt.index[lp].date()), decline=None if ph is None else round((ph-c[lp])/ph*100,2)))
res['spy_anchor_by_window'] = anch
# 3) SPY / QQQ / indices day table and drawdowns
def tab(name, start):
    df = ser[name]; r = df['Close'].pct_change()*100; v = df['Volume']/df['Volume'].shift(1)
    return [dict(date=str(d.date()), ret=round(r[d],3), volr=round(v[d],3), close=round(df.loc[d,'Close'],2), low=round(df.loc[d,'Low'],2)) for d in df.loc[start:].index]
for nme in ser: res['tab_'+nme] = tab(nme, '2026-10-28')
for nme in ser:
    df = ser[nme].tail(60); pk = df['Close'].idxmax(); after = df.loc[pk:]
    lo = after['Low'].idxmin(); res['leg_'+nme] = dict(peak=str(pk.date()), peak_close=round(df.loc[pk,'Close'],2), low_date=str(lo.date()), decline_close=round((1-after.loc[lo,'Close']/df.loc[pk,'Close'])*100,2), last=str(df.index[-1].date()), last_from_peak=round((1-df['Close'].iloc[-1]/df.loc[pk,'Close'])*100,2))
# 4) QQQ vs ^IXIC, SPY vs ^GSPC: return gaps and volume-direction agreement (120 sessions to 11-03), plus on big up days
for a, b in (('QQQ','^IXIC'), ('SPY','^GSPC')):
    x, y = ser[a].loc[:'2026-11-03'], ser[b].loc[:'2026-11-03']
    idx = x.index.intersection(y.index)[-121:]
    ra, rb = x.loc[idx,'Close'].pct_change().dropna()*100, y.loc[idx,'Close'].pct_change().dropna()*100
    va, vb = (x.loc[idx,'Volume'].diff().dropna() > 0), (y.loc[idx,'Volume'].diff().dropna() > 0)
    big = rb[rb >= 1.0]
    res[f'gap_{a}_{b}'] = dict(n=len(ra), mean_abs=round(float((ra-rb).abs().mean()),3), max_abs=round(float((ra-rb).abs().max()),3), vol_dir_agree=int((va==vb).sum()),
        up1pct_days=[dict(date=str(d.date()), idx=round(rb[d],2), etf=round(ra[d],2), idx_vol_up=bool(vb[d]), etf_vol_up=bool(va[d])) for d in big.index])
json.dump(res, open(OUT, 'w'), indent=1, default=str)
for k in ('spy_1112','spy_1103','gspc_1103','qqq_1112_last','spy_window_lows','spy_1105_low','spy_anchor_by_window','leg_SPY','leg_QQQ','leg_^GSPC','leg_^IXIC','gap_QQQ_^IXIC','gap_SPY_^GSPC'): print(k, json.dumps(res[k], default=str))
for x in res['spy_recent']: print(x)
for nme in ('SPY','QQQ'):
    print(nme); [print(' ', x) for x in res['tab_'+nme]]
