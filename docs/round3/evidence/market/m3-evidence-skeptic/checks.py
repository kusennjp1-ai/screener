import json,sys,numpy as np,pandas as pd
inv=sys.argv[1]; out={}
# 1. backend-style distribution count on real SPY vs backend replay
df=pd.DataFrame(json.load(open(inv+'/bundle-market-symbols-SPY.json'))); C=df.close.values;H=df.high.values;L=df.low.values;V=df.volume.values;n=len(C)
ret=np.r_[np.nan,C[1:]/C[:-1]-1]; vup=np.r_[False,V[1:]>V[:-1]]; rng=H-L
hi25=pd.Series(C).rolling(25,min_periods=1).max().values
D=((ret<=-0.002)&vup)|((ret>0)&(ret<=0.002)&vup&(rng>0)&((C-L)<=0.5*rng)&(C>=0.97*hi25))
cnt={df.date[t]:sum(1 for j in range(max(0,t-24),t+1) if D[j] and not (C[j+1:t+1]>=C[j]*1.05).any()) for t in range(n)}
rep=json.load(open(inv+'/backend-regime-replay.json'))
cmp={d:(v['distribution_days'],int(cnt[d])) for d,v in rep.items() if d in cnt}
out['spy_count_vs_backend']={'days':len(cmp),'equal':sum(a==b for a,b in cmp.values()),'mismatch':{d:v for d,v in cmp.items() if v[0]!=v[1]}}
# 2. robust mean rows in the study
r=json.load(open(inv+'/study-release/results.json')); ind={i['key']:i for i in r['indicators']}
rm=[]
for x in r['tests']['robust']:
    if x['stat']=='mean':
        b=ind[x['key']]['windows'][str(x['h'])]['buckets'][x['bucket']]
        rm.append({'key':x['key'],'bucket':b['key'],'h':x['h'],'est_pp':round(b['mean']['est']*100,2)})
out['robust_mean_rows']=rm
# 3. TT windows on the proxy
d=json.load(open(inv+'/long-history-proxy.json')); ks=sorted(k for k in d if k[:2]=='20')
out['tt_proxy']={'last':[ks[-1],d[ks[-1]]['trendTemplateCount']],'10_back':[ks[-11],d[ks[-11]]['trendTemplateCount']],'21_back':[ks[-22],d[ks[-22]]['trendTemplateCount']]}
# 4. bundle symbols
b=json.load(open(inv+'/bundle-market-symbols.json')); out['bundle_symbols']=json.dumps(b)[:700]
json.dump(out,open(sys.argv[2],'w'),indent=1,ensure_ascii=False); print(json.dumps(out,indent=1,ensure_ascii=False))
