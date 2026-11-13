import json,sys,pandas as pd,numpy as np
out={}
for sym,path in (('SPY',sys.argv[1]),('^GSPC_study',None)):
    if path:
        df=pd.DataFrame(json.load(open(path)))
    else:
        d=json.load(open(sys.argv[2])); df=pd.DataFrame([i for i in d['indices'] if i['symbol']=='^GSPC'][0]['bars'])
    df['date']=pd.to_datetime(df['date']); c=df.close
    op=((c>c.rolling(50).mean())&(c>c.rolling(200).mean()))
    ok=c.rolling(200).mean().notna()
    x=df[ok&(df.date>='2026-01-01')].assign(op=op[ok])
    fl=(x.op!=x.op.shift()).iloc[1:]
    runs=[];k=0
    for v in x.op:
        if not v:k+=1
        elif k: runs.append(k);k=0
    if k: runs.append(k)
    out[sym]={'from':str(x.date.iloc[0].date()),'to':str(x.date.iloc[-1].date()),'sessions':len(x),'flips':int(fl.sum()),'zero_runs':runs,'zero_days':int((~x.op).sum()),
      'flip_dates':[str(d.date()) for d in x.date.iloc[1:][fl.values]],
      'last30':''.join('1' if v else '0' for v in x.op.tail(30))}
json.dump(out,open(sys.argv[3],'w'),indent=1); print(json.dumps(out,indent=1))
