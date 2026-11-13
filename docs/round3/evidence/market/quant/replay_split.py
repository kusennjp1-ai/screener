# Post-hoc descriptive split of the cap buckets (not pre-registered; ^GSPC proxy for SPY).
import json,sys,numpy as np
d=json.load(open(sys.argv[1])); out={}
def sma(x,n):
    c=np.cumsum(np.insert(x,0,0.0)); r=np.full(len(x),np.nan); r[n-1:]=(c[n:]-c[:-n])/n; return r
for idx in d['indices']:
    b=[x for x in idx['bars'] if x.get('close') and x.get('volume') is not None and x.get('high') and x.get('low')]
    C=np.array([x['close'] for x in b],float); V=np.array([x['volume'] for x in b],float); H=np.array([x['high'] for x in b],float); L=np.array([x['low'] for x in b],float); n=len(C)
    s50=sma(C,50); s200=sma(C,200); ret=np.full(n,np.nan); ret[1:]=C[1:]/C[:-1]-1
    volup=np.zeros(n,bool); volup[1:]=V[1:]>V[:-1]
    rmax25=np.array([C[max(0,i-24):i+1].max() for i in range(n)]); r=H-L; lower=np.where(r>0,(C-L)<=0.5*r,False)
    dist=((ret<=-0.002)&volup)|((ret>0)&(ret<=0.002)&volup&lower&(C>=rmax25*0.97))
    cnt=np.array([sum(1 for j in range(max(0,t-24),t+1) if dist[j] and not (C[j+1:t+1]>=C[j]*1.05).any()) for t in range(n)])
    valid=np.zeros(n,bool); valid[220:]=True
    rising=np.zeros(n,bool); rising[20:]=s50[20:]>s50[:-20]
    a50=C>s50; a200=C>s200; tok=a50&(s50>s200)&rising&a200
    h=21; fwd=np.full(n,np.nan); dd5=np.full(n,np.nan)
    for t in range(n-h): fwd[t]=C[t+h]/C[t]-1; dd5[t]=(C[t+1:t+h+1].min()/C[t]-1)<=-0.05
    ok=valid&~np.isnan(fwd); I=np.where(ok)[0]; half=I[len(I)//2]; ar=np.arange(n)
    res={}
    def st(mask,lab):
        m=ok&mask
        if not m.sum(): return
        ep=int((mask[1:]&~mask[:-1]&valid[1:]).sum())
        res[lab]={'n':int(m.sum()),'runs':ep,'mean':round(float(fwd[m].mean())*100,2),'pDd5':round(float(dd5[m].mean())*100,1),
          'pDd5_h1':round(float(dd5[m&(ar<half)].mean())*100,1) if (m&(ar<half)).sum() else None,'pDd5_h2':round(float(dd5[m&(ar>=half)].mean())*100,1) if (m&(ar>=half)).sum() else None}
    both=a50&a200
    st(both&tok&(cnt<4),'cap50: trend_ok, dist<4')
    st(both&tok&(cnt>=4),'cap25a: trend_ok, dist>=4')
    st(both&~tok,'cap25b: above both, trend not ok')
    st(both&~tok&(cnt<4),'cap25b dist<4'); st(both&~tok&(cnt>=4),'cap25b dist>=4')
    for lo,hi,l in ((0,3,'0-3'),(4,5,'4-5'),(6,99,'6+')): st(both&tok&(cnt>=lo)&(cnt<=hi),'trend_ok dist '+l)
    live=a200&~a50
    for lo,hi,l in ((0,4,'<=4'),(5,99,'>=5'),(6,99,'>=6')): st(live&(cnt>=lo)&(cnt<=hi),'above200_below50 dist '+l)
    res['baseline']={'pDd5':round(float(dd5[ok].mean())*100,1),'mean':round(float(fwd[ok].mean())*100,2)}
    out[idx['symbol']]=res
json.dump(out,open('replay-split.json','w'),indent=1,ensure_ascii=False)
for s,r in out.items():
    print(s)
    for k,v in r.items(): print('  ',k,v)
