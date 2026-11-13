import json, sys, statistics as st
from collections import Counter, defaultdict
from datetime import date
SNAP = sys.argv[1]
rows = [json.loads(l) for l in open(SNAP + '/rows.jsonl')]
F = lambda r: r['setup_ready_failed_checks']
g3 = [r for r in rows if 'readiness_below_threshold' in F(r)]
print('gate3 fails', len(g3), Counter(r['setup_engine']['pattern_primary'] for r in g3))
for s in ['DRI','WSM','BMO','NDSN','NATL','HUM','HCI','SONO','PRGS','LTC']:
    r=[x for x in rows if x['symbol']==s][0]; se=r['setup_engine']
    c=[x for x in se['candidates'] if x['pattern']==se['pattern_primary']]
    print(s, se['pattern_primary'], round(se['readiness_score'] or -1,1), r['pivot']['pivot_date'], F(r), 'vol50', round(se['volume_vs_50d'],2), 'stage', r['stage']['stage'], r['stage']['se_stage'], 'close', r['close'], 'chg', round((r['bars'][-1]['close']/r['bars'][-2]['close']-1)*100,2))
# CWH by weeks since pivot date
asof=date(2026,11,12); bk=defaultdict(list)
for r in rows:
    se=r['setup_engine']
    if se['pattern_primary']!='cup_with_handle' or se.get('readiness_score') is None or not r['pivot'].get('pivot_date'): continue
    w=(asof-date.fromisoformat(r['pivot']['pivot_date'])).days//7
    bk[min(w,16)].append(se['readiness_score'])
print('cwh n', sum(len(v) for v in bk.values()))
for k in sorted(bk): print(k, len(bk[k]), round(st.median(bk[k]),1), sum(x>=70 for x in bk[k]))
# gate 6
g6=[r for r in rows if 'volume_above_dryup_cap' in F(r)]
up=[r for r in g6 if r['bars'][-1]['close']>r['bars'][-2]['close']]
dn=[r for r in g6 if r['bars'][-1]['close']<r['bars'][-2]['close']]
print('gate6 fails', len(g6), 'up', len(up), 'down', len(dn), 'flat', len(g6)-len(up)-len(dn))
for s in ['HUM','SONO','HTFL']:
    r=[x for x in rows if x['symbol']==s]
    if not r: print(s,'not listed'); continue
    r=r[0]; print(s, round(r['setup_engine']['volume_vs_50d'],2), round((r['bars'][-1]['close']/r['bars'][-2]['close']-1)*100,2), 'g6' , 'volume_above_dryup_cap' in F(r))
flips=[];pas=0;n=0
for r in rows:
    v=[b['volume'] for b in r['bars']]
    st_=[]
    for i in range(len(v)-20,len(v)):
        s50=sum(v[i-49:i+1])/50; st_.append(v[i]/s50<=0.8)
    pas+=sum(st_); n+=len(st_); flips.append(sum(a!=b for a,b in zip(st_,st_[1:])))
print('pass share', pas, n, round(100*pas/n,1), 'flips mean', round(st.mean(flips),2))
ready=[r for r in rows if r['setup_ready']=='pass']
def v10(r):
    v=[b['volume'] for b in r['bars']]; s50=sum(v[-50:])/50; return sum(v[-10:])/10/s50
def cnt(r):
    v=[b['volume'] for b in r['bars']]; n=len(v)
    return sum(1 for j in range(n-10,n) if v[j] < 0.8*sum(v[j-49:j+1])/50)
print('ready v10>0.8', sum(v10(r)>0.8 for r in ready), 'count>=5 pass', sum(cnt(r)>=5 for r in ready))
print('MGRC v10', round(v10([r for r in ready if r['symbol']=='MGRC'][0]),2))
# stage
sn=[r for r in rows if 'stage_not_ok' in F(r)]
print('stage_not_ok', len(sn), Counter((r['stage']['stage'], r['stage']['se_stage']) for r in sn))
s23=[r for r in sn if r['stage']['stage']==2]
print('scanner2 & se3', len(s23), 'close<sma50', sum(r['close']<r['stage']['inputs']['sma50'] for r in s23), 'only stage', [r['symbol'] for r in s23 if F(r)==['stage_not_ok']])
print('all only-stage', [r['symbol'] for r in sn if F(r)==['stage_not_ok']])
r3=[r for r in ready if r['stage']['stage']==3]
for r in r3:
    i=r['stage']['inputs']; ch=(i['sma200']/i['sma200_21_sessions_ago']-1)*100
    print('ready scanner3', r['symbol'], 'SE', r['stage']['se_stage'], '200d 21s chg', round(ch,2))
