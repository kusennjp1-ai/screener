import gzip, json, sys
import numpy as np, pandas as pd
bundle, evalrows, out = sys.argv[1:4]
ver=set()
for line in open(evalrows):
    r=json.loads(line)
    if (r.get('technical_audit') or {}).get('valid') is True: ver.add(r['symbol'])
rows=json.load(gzip.open(bundle,'rt'))['rows']
by={r['symbol']:r['prices'] for r in rows}
sessions=sorted(p['date'] for p in by['SPY'])
syms=sorted(s for s in ver if s in by)
def frame(k):
    return pd.DataFrame({s:pd.Series({p['date']:p.get(k) for p in by[s]},dtype=float) for s in syms}).reindex(sessions)
C,H,L,V,Op=frame('close'),frame('high'),frame('low'),frame('volume'),frame('open')
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
tt=pt&(rs>=70)
res={'universe':len(syms),'bars':len(sessions)}
i=len(sessions)-1; d=sessions[i]
# stage on last day
chg=((m200-m200.shift(19))/m200.shift(19)*100).loc[d]
x=np.arange(60.); w=C.iloc[i-59:i+1]
sl=pd.Series({s:(np.polyfit(x,w[s].values,1)[0]/w[s].mean()*100 if w[s].notna().all() else np.nan) for s in syms})
c=C.loc[d]; m=m200.loc[d]
above=c>m; rising=chg>=1; falling=chg<=-1; flat=chg.abs()<1; up=sl>.05; down=sl<-.05
st=pd.Series(np.select([above&rising&up,~above&falling&down,above&(flat|falling),above&rising,flat,~above&(flat|rising)],[2,4,3,3,1,1],default=np.where(above,3,4)),index=syms)
known=chg.notna()&sl.notna()&c.notna()&m.notna()&good.loc[d]
st=st.where(known); t=tt.loc[d]
s3=t&(st==3)
base=(c>m150.loc[d])&(m150.loc[d]>m)&(c>=.75*hi.loc[d])
exc=s3&above&rising&(~up)&(~down)&base
res['stage']={'counts':st.value_counts().sort_index().to_dict(),'tt':int(t.sum()),'tt_stage3':int(s3.sum()),
 'tt_stage3_ma200_flat(<1%/20d)':int((s3&flat).sum()),'tt_stage3_rising_sideways_base_exception':int(exc.sum()),
 'tt_stage3_rising_down_slope':int((s3&rising&down).sum()),
 'all_stage3_meeting_exception':int(((st==3)&above&rising&(~up)&(~down)&base).sum())}
ph=H.shift(1).rolling(251,min_periods=251).max(); pv=V.shift(1).rolling(50,min_periods=50).mean()
bo=good&pt&(C>ph)&(V>=1.4*pv)
nh=good&(H>ph)
for dd in ['2026-11-04','2026-11-05','2026-11-12']:
    k=nh.loc[dd]
    res['nh_'+dd]={'intraday_nh':int(k.sum()),'close_above_prior_high':int((k&(C.loc[dd]>ph.loc[dd])).sum()),
      'open_above_prior_high':int((k&(Op.loc[dd]>ph.loc[dd])).sum()),'close_down_on_day':int((k&(C.loc[dd]<C.shift(1).loc[dd])).sum()),
      'nh_also_on_prev_session':int((k&nh.shift(1).loc[dd].fillna(False).astype(bool)).sum())}
ts=[]
for i in range(len(sessions)-45,len(sessions)):
    d=sessions[i]; fn=fh=fp=0
    for j in range(i-10,i):
        dj=sessions[j]
        for s in bo.columns[bo.iloc[j].values]:
            bc=C.at[dj,s]; fn+=1; fh+= L[s].iloc[j+1:i+1].min()<=bc*.93; fp+= C.at[d,s]<ph.at[dj,s]
    judged=held=0
    for j in range(i-29,i-9):
        dj=sessions[j]
        for s in bo.columns[bo.iloc[j].values]:
            bc=C.at[dj,s]; judged+=1; held+= L[s].iloc[j+1:j+11].min()>bc*.93
    ts.append({'date':d,'fresh_n':fn,'fresh_fail7':round(100*fh/fn,1),'fresh_below_pivot':round(100*fp/fn,1),'matured_n':judged,'matured_fail7':round(100-100*held/judged,1)})
res['series']=ts
df=pd.DataFrame(ts)
res['fresh_gt_matured_days']=int((df.fresh_fail7>df.matured_fail7).sum())
res['fresh_peak']=df.loc[df.fresh_fail7.idxmax()].to_dict(); res['matured_peak']=df.loc[df.matured_fail7.idxmax()].to_dict()
res['lead_sessions_peak']=int(df.matured_fail7.idxmax()-df.fresh_fail7.idxmax())
json.dump(res,open(out,'w'),indent=1,default=str)
print(json.dumps({k:v for k,v in res.items() if k!='series'},indent=1,default=str))
for p in ts: print(p)
