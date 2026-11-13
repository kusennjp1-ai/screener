# Replay of the brief's cap rule (modelMarket + backend assess_market_regime, breadth=None) on index OHLCV since 1990.
# Proxy: the live rule runs on SPY; here the index itself (volume differs) -> 推論.
import json,sys,numpy as np
src=sys.argv[1]; out={}
d=json.load(open(src))
rng=np.random.default_rng(7)
def sma(x,n):
    c=np.cumsum(np.insert(x,0,0.0)); r=np.full(len(x),np.nan); r[n-1:]=(c[n:]-c[:-n])/n; return r
for idx in d['indices']:
    b=[x for x in idx['bars'] if x.get('close') and x.get('volume') is not None and x.get('high') and x.get('low')]
    dates=[x['date'] for x in b]; C=np.array([x['close'] for x in b],float); V=np.array([x['volume'] for x in b],float)
    H=np.array([x['high'] for x in b],float); L=np.array([x['low'] for x in b],float); n=len(C)
    s50=sma(C,50); s200=sma(C,200)
    ret=np.full(n,np.nan); ret[1:]=C[1:]/C[:-1]-1
    volup=np.zeros(n,bool); volup[1:]=V[1:]>V[:-1]
    rmax25=np.array([C[max(0,i-24):i+1].max() for i in range(n)])
    r=H-L; lower=np.where(r>0,(C-L)<=0.5*r,False)
    dist=((ret<=-0.002)&volup)|((ret>0)&(ret<=0.002)&volup&lower&(C>=rmax25*0.97))
    cnt=np.zeros(n,int)
    for t in range(n):
        k=0
        for j in range(max(0,t-24),t+1):
            if dist[j] and not (C[j+1:t+1]>=C[j]*1.05).any(): k+=1
        cnt[t]=k
    valid=np.zeros(n,bool); valid[220:]=True
    rising=np.zeros(n,bool); rising[20:]=s50[20:]>s50[:-20]   # sma50.iloc[-1] > sma50.iloc[-21]
    a50=C>s50; a200=C>s200; trend_ok=a50&(s50>s200)&rising&a200
    cap=np.where(~a200|~a50,0,np.where(trend_ok&(cnt<4),50,25))
    sub=np.where(~a200,'0:below200',np.where(~a50,'0:above200_below50',np.where(cap==50,'50','25')))
    h=21
    fwd=np.full(n,np.nan); dd5=np.full(n,np.nan); dd10=np.full(n,np.nan)
    for t in range(n-h):
        fwd[t]=C[t+h]/C[t]-1; m=C[t+1:t+h+1].min()/C[t]-1; dd5[t]=m<=-0.05; dd10[t]=m<=-0.10
    ok=valid&~np.isnan(fwd); I=np.where(ok)[0]; half=I[len(I)//2]
    res={'n':int(ok.sum()),'first':dates[I[0]],'last':dates[I[-1]],'split':dates[half],
         'baseline':{'mean':float(fwd[ok].mean()),'pDd5':float(dd5[ok].mean()),'pDd10':float(dd10[ok].mean())},'buckets':{}}
    def stats(mask,label):
        m=ok&mask
        if m.sum()==0: return
        runs=int(((mask[1:])&(~mask[:-1])&valid[1:]).sum())
        st=sub_state=None
        e={'n':int(m.sum()),'share':float(m.sum()/ok.sum()),'runs':runs,'mean':float(fwd[m].mean()),'median':float(np.median(fwd[m])),'pUp':float((fwd[m]>0).mean()),
           'pDd5':float(dd5[m].mean()),'pDd10':float(dd10[m].mean())}
        for nm,hm in (('h1',np.arange(n)<half),('h2',np.arange(n)>=half)):
            mm=m&hm; bb=ok&hm
            e[nm]={'n':int(mm.sum()),'dMean':float(fwd[mm].mean()-fwd[bb].mean()) if mm.sum() else None,'dDd5':float(dd5[mm].mean()-dd5[bb].mean()) if mm.sum() else None}
        # rotation placebo (state rotated against outcomes inside the valid span), 399 shifts, margin 343
        idxs=I; mk=mask[idxs]; f=fwd[idxs]; q=dd5[idxs]; N=len(idxs)
        est_m=f[mk].mean()-f.mean(); est_d=q[mk].mean()-q.mean()
        ks=np.linspace(344,N-344,399).astype(int); pm=[];pdv=[]
        for k in ks:
            r2=np.roll(mk,k); pm.append(f[r2].mean()-f.mean()); pdv.append(q[r2].mean()-q.mean())
        pm=np.array(pm);pdv=np.array(pdv)
        e['dMean']=float(est_m); e['dMean_p']=float(((np.abs(pm)>=abs(est_m)).sum()+1)/(len(ks)+1))
        e['dDd5']=float(est_d); e['dDd5_p']=float(((np.abs(pdv)>=abs(est_d)).sum()+1)/(len(ks)+1))
        res['buckets'][label]=e
    for lab in ['50','25','0:above200_below50','0:below200']: stats(sub==lab,lab)
    stats(cap==0,'0:all'); stats(cap>0,'open(25or50)')
    # whipsaw: open(>0) vs closed(0)
    op=(cap>0)[valid]; dv=np.array(dates)[valid]; yrs=len(op)/252
    flips=int((op[1:]!=op[:-1]).sum())
    def runlens(x,val):
        out=[];k=0
        for v in x:
            if v==val:k+=1
            elif k: out.append(k);k=0
        if k: out.append(k)
        return np.array(out)
    z=runlens(op,False); o=runlens(op,True)
    capv=cap[valid]; flips3=int((capv[1:]!=capv[:-1]).sum())
    res['whipsaw']={'years':yrs,'open_closed_flips':flips,'flips_per_year':flips/yrs,'cap_level_changes_per_year':flips3/yrs,
      'zero_runs':int(len(z)),'zero_run_median':float(np.median(z)),'zero_runs_le3_share':float((z<=3).mean()),'zero_runs_le5_share':float((z<=5).mean()),
      'open_runs':int(len(o)),'open_run_median':float(np.median(o)),'open_runs_le3_share':float((o<=3).mean()),
      'share_days_cap0':float((~op).mean())}
    # by year flips, last 3 years
    yy=np.array([x[:4] for x in dv]); res['whipsaw']['flips_by_year_recent']={y:int(((op[1:]!=op[:-1])&(yy[1:]==y)).sum()) for y in ['2022','2023','2024','2025','2026']}
    # distribution threshold conditional on above both MAs: does dist>=4 (25 vs 50) separate?
    # MM-19: +3% up days by MA position
    big=(ret>=0.03)&valid
    res['up3pct_days']={'total':int(big.sum()),'below200':int((big&~a200).sum()),'above200_below50':int((big&a200&~a50).sum()),'above_both':int((big&a200&a50).sum()),
        'share_of_days_below200':float((valid&~a200).sum()/valid.sum())}
    # 6-month lookback count of +3% days as a state: rate per year in each
    out[idx['symbol']]=res
json.dump(out,open('replay-caps.json','w'),indent=1)
for s,r in out.items():
    print(s,r['n'],r['first'],r['last'],'split',r['split'],'base',{k:round(v*100,2) for k,v in r['baseline'].items()})
    for k,e in r['buckets'].items():
        print(f"  {k:22s} n={e['n']:5d} share={e['share']*100:4.1f}% runs={e['runs']:4d} mean={e['mean']*100:5.2f}% pDd5={e['pDd5']*100:4.1f}% pDd10={e['pDd10']*100:4.1f}% | dMean={e['dMean']*100:+.2f} p={e['dMean_p']:.3f} (h1 {e['h1']['dMean']*100:+.2f}, h2 {e['h2']['dMean']*100:+.2f}) | dDd5={e['dDd5']*100:+.1f} p={e['dDd5_p']:.3f} (h1 {e['h1']['dDd5']*100:+.1f}, h2 {e['h2']['dDd5']*100:+.1f})")
    print('  whipsaw',json.dumps(r['whipsaw'])); print('  up3',r['up3pct_days'])
