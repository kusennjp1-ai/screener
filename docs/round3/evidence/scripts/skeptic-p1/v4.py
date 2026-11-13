import json, sys
R={}
for l in open(sys.argv[1]+'/rows.jsonl'):
    r=json.loads(l); R[r['symbol']]=r
spy={b['date']:b['close'] for b in json.load(open(sys.argv[1]+'/build/work/benchmark.json'))['bars']}
def bars(s): return R[s]['bars']
def chg(b,d):
    i=[x['date'] for x in b].index(d); v=[x['volume'] for x in b]
    return round((b[i]['close']/b[i-1]['close']-1)*100,1), round(v[i]/(sum(v[-50:])/50),2), round(v[i]/(sum(v[i-50:i])/50),2)
def rsoff(s):
    b=bars(s); rl=[x['close']/spy[x['date']] for x in b if x['date'] in spy]
    return round((rl[-1]/max(rl[-252:])-1)*100,1)
def ext50(s):
    i=R[s]['stage']['inputs']; return round((R[s]['close']/i['sma50']-1)*100,1)
def fr(s):
    f=R[s].get('feature_run') or {}; return f
for s in ['SWKS','GLBE','EMR','EQH','MGRC','WSFS','FCNCA','IDT','IQV','GEO','ADI','DJCO','SIG','RDNT','BB','NBTB']:
    r=R[s]; i=r['stage']['inputs']; b=bars(s); v=[x['volume'] for x in b]
    print(s, 'pv', r['pivot']['se_pivot_price'], 'hi52', i['week52_high'], 'close', r['close'], 'below_hi', round(i['below_52w_high_pct'],1), 'rs_est', round(r['rs_estimate']['value'],1), 'rsoff', rsoff(s), 'ext50', ext50(s), 'v10/50', round(sum(v[-10:])/10/(sum(v[-50:])/50),2), 'avgshares50', round(sum(v[-50:])/50), 'stage', r['stage']['stage'], r['stage']['se_stage'])
b=bars('GLBE'); print('GLBE 10-20', chg(b,'2026-10-20'), 'max high after 10-20', max(x['high'] for x in b if x['date']>='2026-10-20'))
b=bars('EQH'); print('EQH 11-05', chg(b,'2026-11-05'))
b=bars('MGRC'); print('MGRC 11-02', chg(b,'2026-11-02'), '11-03', chg(b,'2026-11-03'), [ (x['date'],x['open'],x['high'],x['low'],x['close'],x['volume']) for x in b[-10:]])
b=bars('ADI'); print('ADI 11-05', chg(b,'2026-11-05'))
b=bars('SIG'); print('SIG max high 30', max(x['high'] for x in b[-30:]))
b=bars('IDT'); print('IDT max high 30', max(x['high'] for x in b[-30:]), [x['date'] for x in b[-30:] if x['high']==max(y['high'] for y in b[-30:])])
b=bars('IQV'); print('IQV max high 45', max(x['high'] for x in b[-45:]))
b=bars('DJCO'); print('DJCO max high 60', max(x['high'] for x in b[-60:]))
i=R['RDNT']['stage']['inputs']; print('RDNT 200d chg', round((i['sma200']/i['sma200_21_sessions_ago']-1)*100,3), [ (x['label'],x['state']) for x in R['RDNT']['trend_template']['rules'] if x['state']!='pass'])
print('BB close vs 52w hi', round((R['BB']['close']/R['BB']['stage']['inputs']['week52_high']-1)*100,1))
for s in ['SWKS','EMR','FCNCA','DRI','IDT']:
    f=R[s]['feature_run']; print(s, 'fr keys', [k for k in f.keys()][:20])
