# Minervini-trader recompute on the 11-12 daily price bundle (2y bars). Universe: technical_audit.valid symbols of the snapshot (proxy of the published 4538).
import gzip, json, sys
import numpy as np, pandas as pd
bundle, evalrows, feat, out = sys.argv[1:5]
ver=set()
for line in open(evalrows):
    r=json.loads(line)
    if (r.get('technical_audit') or {}).get('valid') is True: ver.add(r['symbol'])
rows=json.load(gzip.open(bundle,'rt'))['rows']
by={r['symbol']:r['prices'] for r in rows}
sessions=sorted(p['date'] for p in by['SPY'])
syms=sorted(s for s in ver if s in by)
def frame(k):
    d={}
    for s in syms+['SPY','QQQ','IWM']:
        d[s]=pd.Series({p['date']:p.get(k) for p in by[s]},dtype=float)
    return pd.DataFrame(d).reindex(sessions)
C,H,L,V,Op=frame('close'),frame('high'),frame('low'),frame('volume'),frame('open')
H=pd.concat([H,C,Op]).groupby(level=0).max(); L=pd.concat([L,C,Op]).groupby(level=0).min()
idx=C[['SPY','QQQ','IWM']]; C=C[syms];H=H[syms];L=L[syms];V=V[syms]
ch=C/C.shift(1); bad=(ch>=1.8)|(ch<=.55)
C=C.mask(bad);H=H.mask(bad);L=L.mask(bad);V=V.mask(bad)
good=C.rolling(253,min_periods=253).count().eq(253)
ma=lambda n:C.rolling(n,min_periods=n).mean()
m50,m150,m200=ma(50),ma(150),ma(200)
hi=H.rolling(252,min_periods=252).max(); lo=L.rolling(252,min_periods=252).min()
score=sum((C/C.shift(l)-1)*w for l,w in [(63,.4),(126,.2),(189,.2),(252,.2)]).where(good)
n=score.notna().sum(axis=1)
rs=1+98*(score.rank(axis=1)-1).div(np.maximum(n-1,1),axis=0)
pt=(C>m150)&(C>m200)&(m150>m200)&(m200>m200.shift(21))&(m50>m150)&(m50>m200)&(C>m50)&(C/hi>=.75)&(C/lo>=1.30)&good
tt=pt&(rs>=70); tt90=pt&(rs>=90)
# stage replay (producer rule)
chg=(m200-m200.shift(19))/m200.shift(19)*100
x=np.arange(60.); 
def slope(col):
    return col.rolling(60,min_periods=60).apply(lambda a:np.polyfit(x,a,1)[0]/a.mean()*100,raw=True)
last=sessions[-1]
# stage only for the last session and 30 sessions back (cheap)
def stage_at(i):
    d=sessions[i]; w=C.iloc[i-59:i+1]
    sl=pd.Series({s:(np.polyfit(x,w[s].values,1)[0]/w[s].mean()*100 if w[s].notna().all() else np.nan) for s in syms})
    c=C.loc[d]; m=m200.loc[d]; g=chg.loc[d]
    above=c>m; rising=g>=1; falling=g<=-1; flat=g.abs()<1; up=sl>.05; down=sl<-.05
    st=pd.Series(np.select([above&rising&up,~above&falling&down,above&(flat|falling),above&rising,flat,~above&(flat|rising)],[2,4,3,3,1,1],default=np.where(above,3,4)),index=syms)
    known=g.notna()&sl.notna()&c.notna()&m.notna()&good.loc[d]
    return st.where(known)
res={'universe':len(syms),'last':last}
st=stage_at(len(sessions)-1); t=tt.loc[last]
res['stage_counts_last']=st.value_counts().sort_index().to_dict()
res['tt_last']=int(t.sum()); res['tt_by_stage_last']=st[t].value_counts().sort_index().to_dict()
res['tt90_last']=int(tt90.loc[last].sum())
# stage-2-base exception: flat 60d slope, rising 200d, close above, 150>200, within 25% of high
# time series
prior_high=H.shift(1).rolling(251,min_periods=251).max(); pv=V.shift(1).rolling(50,min_periods=50).mean()
bo=good&pt&(C>prior_high)&(V>=1.4*pv)
nh=good&(H>prior_high); nl=good&(L<L.shift(1).rolling(251,min_periods=251).min())
a50=(good&(C>m50)).sum(axis=1)/good.sum(axis=1)*100; a200=(good&(C>m200)).sum(axis=1)/good.sum(axis=1)*100
ts=[]
spy=idx['SPY']; s50=spy.rolling(50).mean(); s200=spy.rolling(200).mean()
for i in range(len(sessions)-45,len(sessions)):
    d=sessions[i]
    # fresh breakouts of the prior 10 sessions (excluding today): share now closing below their pivot (prior high at breakout), share that hit -7% low
    fresh=[];
    for j in range(i-10,i):
        dj=sessions[j]
        for s in bo.columns[bo.iloc[j].values]:
            piv=prior_high.at[dj,s]; bc=C.at[dj,s]
            fresh.append((C.at[d,s]<piv, L[s].iloc[j+1:i+1].min()<=bc*.93, C.at[d,s]/bc-1))
    # producer-like: breakouts dated 10..29 sessions earlier, held
    judged=held=0
    for j in range(i-29,i-9):
        dj=sessions[j]
        for s in bo.columns[bo.iloc[j].values]:
            bc=C.at[dj,s]; ll=L[s].iloc[j+1:j+11].min()
            judged+=1; held+= ll>bc*.93
    coh=tt.iloc[i-20]&good.iloc[i]; coh90=tt90.iloc[i-20]&good.iloc[i]
    ts.append({'date':d,'spy':round(float(spy[d]),2),'spy_vs50':round(float(spy[d]/s50[d]-1)*100,2),'spy_vs200':round(float(spy[d]/s200[d]-1)*100,2),
      'tt':int(tt.iloc[i].sum()),'tt90':int(tt90.iloc[i].sum()),'above50':round(float(a50[d]),1),'above200':round(float(a200[d]),1),
      'nh':int(nh.iloc[i].sum()),'nl':int(nl.iloc[i].sum()),'new_breakouts':int(bo.iloc[i].sum()),
      'fresh10_n':len(fresh),'fresh10_below_pivot_pct':round(100*np.mean([f[0] for f in fresh]),1) if fresh else None,'fresh10_hit7_pct':round(100*np.mean([f[1] for f in fresh]),1) if fresh else None,
      'fresh10_median_gain_pct':round(100*float(np.median([f[2] for f in fresh])),2) if fresh else None,
      'judged':judged,'held_pct':round(100*held/judged,1) if judged else None,
      'cohort':int(coh.sum()),'cohort_above50_pct':round(100*float((coh&(C.iloc[i]>m50.iloc[i])).sum()/max(coh.sum(),1)),1),
      'cohort90':int(coh90.sum()),'cohort90_above50_pct':round(100*float((coh90&(C.iloc[i]>m50.iloc[i])).sum()/max(coh90.sum(),1)),1),
      'cohort90_off10pct_from_high_pct':round(100*float((coh90&(C.iloc[i]/H.iloc[i-20:i+1].max()<=.9)).sum()/max(coh90.sum(),1)),1)})
res['series']=ts
# liquid-leader view: TT names with price>=10 and 50d avg dollar vol >=20M
adv=(C*V).rolling(50).mean().loc[last]; liquid=(C.loc[last]>=10)&(adv>=2e7)
res['tt_liquid_last']=int((t&liquid).sum()); res['tt90_liquid_last']=int((tt90.loc[last]&liquid).sum())
res['tt_within5pct_of_52wh_last']=int((t&(C.loc[last]/hi.loc[last]>=.95)).sum())
res['tt_liquid_within5pct_last']=int((t&liquid&(C.loc[last]/hi.loc[last]>=.95)).sum())
# feature run
fr=json.load(gzip.open(feat,'rt'))['rows']
import collections
c=collections.Counter(); stg=collections.Counter(); rat=collections.Counter(); ttstage=collections.Counter()
setups=0; scanned=0; near=[]
for r in fr:
    d=r['details_json']
    if not d.get('market_regime'): continue
    scanned+=1
    c[str(d.get('passes_template'))]+=1; stg[str(d.get('stage'))]+=1; rat[str(d.get('rating'))]+=1
    if d.get('passes_template') is True: ttstage[str(d.get('stage'))]+=1
res['feature_run']={'rows_with_regime':scanned,'passes_template':dict(c),'stage':dict(stg),'rating':dict(rat),'tt_by_stage':dict(ttstage)}
bt=set(r['symbol'] for r in fr if r['details_json'].get('passes_template') is True)
res['feature_run']['tt_in_proxy_universe']=len(bt&set(syms)); res['feature_run']['overlap_with_recomputed_tt']=len(bt&set(t.index[t]))
json.dump(res,open(out,'w'),indent=1,default=str)
print(json.dumps({k:v for k,v in res.items() if k!='series'},indent=1,default=str))
for p in ts: print(p)
