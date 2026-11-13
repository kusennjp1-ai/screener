# Display-definition distribution count (strict < -0.2%, higher volume, age<25, later HIGH >= 5% above close removes), by MA position.
import json,sys,numpy as np,pandas as pd
d=json.load(open(sys.argv[1])); out={}
for idx in d['indices']:
    df=pd.DataFrame(idx['bars']).dropna(subset=['close','high','low','volume']).reset_index(drop=True)
    C=df.close.values; H=df.high.values; V=df.volume.values; n=len(C)
    ret=np.r_[np.nan,C[1:]/C[:-1]-1]; D=(ret<-0.002)&(np.r_[False,V[1:]>V[:-1]])
    cnt=np.zeros(n,int)
    for t in range(n):
        cnt[t]=sum(1 for j in range(max(0,t-24),t+1) if D[j] and not (H[j+1:t+1]>=C[j]*1.05).any())
    s50=df.close.rolling(50).mean().values; s200=df.close.rolling(200).mean().values
    h=21; mn=np.full(n,np.nan); mn[:n-h]=[C[t+1:t+h+1].min() for t in range(n-h)]
    dd=(mn/C-1<=-0.05).astype(float); ok=(np.arange(n)>=220)&~np.isnan(mn)
    a50=C>s50; a200=C>s200; half=np.where(ok)[0][ok.sum()//2]; ar=np.arange(n)
    r={}
    def st(lab,m):
        m=m&ok
        r[lab]={'n':int(m.sum()),'pDd5':round(float(dd[m].mean())*100,1) if m.sum() else None,
                'h1':round(float(dd[m&(ar<half)].mean())*100,1) if (m&(ar<half)).sum() else None,'h2':round(float(dd[m&(ar>=half)].mean())*100,1) if (m&(ar>=half)).sum() else None}
    st('all',np.ones(n,bool))
    for lo,hi,l in ((0,4,'<=4'),(5,6,'5-6'),(7,99,'7+')):
        st('all '+l,(cnt>=lo)&(cnt<=hi)); st('above50&200 '+l,a50&a200&(cnt>=lo)&(cnt<=hi)); st('above200_below50 '+l,a200&~a50&(cnt>=lo)&(cnt<=hi)); st('below200 '+l,~a200&(cnt>=lo)&(cnt<=hi))
    out[idx['symbol']]=r
json.dump(out,open(sys.argv[2],'w'),indent=1)
for s,r in out.items():
    print(s)
    for k,v in r.items(): print('  ',k,v)
