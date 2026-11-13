import json, sys
I, O = sys.argv[1], sys.argv[2]
ser = {'SPY': json.load(open(I+'/bundle-market-symbols-SPY.json')), 'QQQ': json.load(open(I+'/bundle-market-symbols-QQQ.json'))}
for ix in json.load(open(I+'/study-release/indices.json'))['indices']: ser[ix['symbol']] = ix['bars']
def cnt(b, u, strict=False):
    n=0
    for i in range(u-24, u+1):
        r=b[i]['close']/b[i-1]['close']-1
        if (r < -0.002 if strict else r <= -0.002) and b[i]['volume']>b[i-1]['volume'] and not any(x['close']>=b[i]['close']*1.05 for x in b[i+1:u+1]): n+=1
    return n
out={}
for k,b in ser.items():
    n=len(b); us=range(n-250,n); cs=[cnt(b,u) for u in us]
    c=[x['close'] for x in b]
    ma=lambda u,w: sum(c[u-w+1:u+1])/w
    out[k]=dict(last=b[-1]['date'], sessions=250, share_ge4=round(sum(x>=4 for x in cs)/250,3), share_ge5=round(sum(x>=5 for x in cs)/250,3), share_ge6=round(sum(x>=6 for x in cs)/250,3), median=sorted(cs)[125], max=max(cs),
      vs50={b[u]['date']: round((c[u]/ma(u,50)-1)*100,2) for u in range(n-22,n)})
    print(k, {x:out[k][x] for x in out[k] if x!='vs50'}); print('  vs50', out[k]['vs50'])
# same-session SPY vs ^GSPC and QQQ vs ^IXIC returns and volume-direction agreement over the last 120 common sessions to 11-03
for e,ix in (('SPY','^GSPC'),('QQQ','^IXIC')):
    eb={x['date']:i for i,x in enumerate(ser[e])}; ib=ser[ix]; rows=[]
    for j in range(len(ib)-120,len(ib)):
        d=ib[j]['date']; i=eb[d]
        re=ser[e][i]['close']/ser[e][i-1]['close']-1; ri=ib[j]['close']/ib[j-1]['close']-1
        rows.append((d, re-ri, (ser[e][i]['volume']>ser[e][i-1]['volume'])==(ib[j]['volume']>ib[j-1]['volume'])))
    out[e+'_vs_'+ix]=dict(n=120, max_abs_ret_diff_pt=round(max(abs(r[1]) for r in rows)*100,3), mean_abs_ret_diff_pt=round(sum(abs(r[1]) for r in rows)/120*100,3), volume_direction_agree=sum(r[2] for r in rows))
    print(e,ix,out[e+'_vs_'+ix])
json.dump(out,open(O+'/supp.json','w'),indent=1)
