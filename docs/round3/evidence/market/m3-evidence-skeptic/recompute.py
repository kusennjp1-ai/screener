# Independent recompute (skeptic). Reads indices.json path from argv; no reuse of quant scripts.
import json,sys
import numpy as np, pandas as pd
d=json.load(open(sys.argv[1])); out={}
for idx in d['indices']:
    df=pd.DataFrame(idx['bars']).dropna(subset=['close','high','low','volume']).reset_index(drop=True)
    df['date']=pd.to_datetime(df['date'])
    c=df.close; s50=c.rolling(50).mean(); s200=c.rolling(200).mean()
    a50=(c>s50); a200=(c>s200)
    rising=s50>s50.shift(20)
    tok=a50&a200&(s50>s200)&rising
    ret=c.pct_change(); vup=df.volume>df.volume.shift(1)
    rng=df.high-df.low; lower=(c-df.low)<=0.5*rng
    hi25=c.rolling(25,min_periods=1).max()
    isd=((ret<=-0.002)&vup)|((ret>0)&(ret<=0.002)&vup&lower&(rng>0)&(c>=0.97*hi25))
    n=len(df); C=c.values; D=isd.values
    cnt=np.zeros(n,int)
    for t in range(n):
        k=0
        for j in range(max(0,t-24),t+1):
            if D[j] and not (C[j+1:t+1]>=C[j]*1.05).any(): k+=1
        cnt[t]=k
    h=21
    fwdmin=pd.Series(C[::-1]).rolling(h).min().values[::-1]  # min of C[t..t+h-1]
    mn=np.full(n,np.nan); mn[:n-h]=[C[t+1:t+h+1].min() for t in range(n-h)]
    dd5=(mn/C-1<=-0.05).astype(float); dd5[np.isnan(mn)]=np.nan
    fwd=np.full(n,np.nan); fwd[:n-h]=C[h:]/C[:-h]-1
    valid=(np.arange(n)>=220)&~np.isnan(fwd)
    a50v=a50.values; a200v=a200.values; tokv=tok.values
    live=a200v&~a50v; openm=a200v&a50v; below=~a200v
    cap=np.where(~a200v|~a50v,0,np.where(tokv&(cnt<4),50,25))
    res={'n':int(valid.sum()),'first':str(df.date[np.where(valid)[0][0]].date()),'last':str(df.date[np.where(valid)[0][-1]].date())}
    def st(m):
        m=m&valid; return {'n':int(m.sum()),'pDd5':round(float(np.nanmean(dd5[m]))*100,1),'mean':round(float(fwd[m].mean())*100,2)}
    res['all']=st(np.ones(n,bool)); res['live_above200_below50']=st(live); res['open_above_both']=st(openm); res['below200']=st(below)
    res['cap50']=st(cap==50); res['cap25']=st((cap==25)); res['above200_all']=st(a200v)
    for lab,m in (('live dist<=3',live&(cnt<=3)),('live dist4-5',live&(cnt>=4)&(cnt<=5)),('live dist>=6',live&(cnt>=6))): res[lab]=st(m)
    # contrast live vs open: circular-shift placebo of the live mask within the above-200 subset is awkward; use
    # block bootstrap on the difference instead (blocks of 63 sessions over the whole valid span).
    I=np.where(valid)[0]; est=np.nanmean(dd5[valid&live])-np.nanmean(dd5[valid&openm])
    rng_=np.random.default_rng(11); B=63; nb=len(I)//B; diffs=[]
    for _ in range(2000):
        pick=rng_.integers(0,nb,nb); ii=np.concatenate([I[p*B:(p+1)*B] for p in pick])
        l=live[ii]; o=openm[ii]
        if l.sum()<50 or o.sum()<50: continue
        diffs.append(dd5[ii][l].mean()-dd5[ii][o].mean())
    diffs=np.array(diffs)
    # rotation placebo (rotate the live/open label series against outcomes, on above-200 days only)
    A=np.where(valid&a200v)[0]; lab=live[A]; q=dd5[A]; e2=q[lab].mean()-q[~lab].mean(); N=len(A)
    ks=np.linspace(344,N-344,399).astype(int); pl=np.array([q[np.roll(lab,k)].mean()-q[~np.roll(lab,k)].mean() for k in ks])
    half=I[len(I)//2]; ar=np.arange(n)
    res['contrast_live_vs_open']={'est_pp':round(est*100,1),'boot_ci95':[round(float(np.percentile(diffs,2.5))*100,1),round(float(np.percentile(diffs,97.5))*100,1)],
       'rotation_p':round(float(((np.abs(pl)>=abs(e2)).sum()+1)/400),4),
       'h1_pp':round(float(np.nanmean(dd5[valid&live&(ar<half)])-np.nanmean(dd5[valid&openm&(ar<half)]))*100,1),
       'h2_pp':round(float(np.nanmean(dd5[valid&live&(ar>=half)])-np.nanmean(dd5[valid&openm&(ar>=half)]))*100,1),
       'mean_diff_pp':round(float(fwd[valid&live].mean()-fwd[valid&openm].mean())*100,2)}
    # whipsaw
    V=np.arange(n)>=220; op=(cap>0)[V]; dts=df.date.values[V]
    fl=op[1:]!=op[:-1]; yrs=V.sum()/252
    runs=[];k=0
    for v in op:
        if not v:k+=1
        elif k: runs.append(k);k=0
    if k: runs.append(k)
    runs=np.array(runs); yy=pd.DatetimeIndex(dts).year[1:]
    res['whipsaw']={'flips':int(fl.sum()),'per_year':round(fl.sum()/yrs,1),'zero_runs':len(runs),'median':float(np.median(runs)),'le3':round(float((runs<=3).mean()),3),'le5':round(float((runs<=5).mean()),3),
      'by_year':{int(y):int(fl[yy==y].sum()) for y in (2022,2023,2024,2025,2026)},
      'share_zero_days_in_runs_le3':round(float(runs[runs<=3].sum()/runs.sum()),3),'share_zero_days_in_runs_le5':round(float(runs[runs<=5].sum()/runs.sum()),3)}
    # confirmation variants: flips per year if the state needs k consecutive closes
    def confirmed(x,k):
        s=x[0]; o=[];run=0
        for v in x:
            if v!=s:
                run+=1
                if run>=k: s=v; run=0
            else: run=0
            o.append(s)
        return np.array(o)
    for k in (2,3):
        o=confirmed(op,k); res['whipsaw'][f'confirm{k}_per_year']=round(float((o[1:]!=o[:-1]).sum()/yrs),1)
    big=(ret.values>=0.03)&V
    res['up3']={'total':int(big.sum()),'below200':int((big&~a200v).sum()),'share_days_below200':round(float((V&~a200v).sum()/V.sum()),3)}
    out[idx['symbol']]=res
json.dump(out,open(sys.argv[2],'w'),indent=1)
print(json.dumps(out,indent=1))
