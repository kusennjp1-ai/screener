import json,sys
d=json.load(open(sys.argv[1]))
out=[]
def pc(x,fmt='.2f'):
    return 'NA' if x is None else format(x*100,fmt)
def f(x):
    if not x: return 'null'
    h1=(x.get('h1') or {}).get('est'); h2=(x.get('h2') or {}).get('est')
    return f"{pc(x.get('est'),'+.2f')} p={x.get('p')} {x.get('label')} h1={pc(h1,'+.2f')} h2={pc(h2,'+.2f')}"
for i in d['indicators']:
    for h in ('5','21','63'):
        w=i['windows'][h]; b0=w.get('baseline') or {}
        out.append(f"## {i['key']} h={h} n={w.get('n')} {w.get('start')}..{w.get('end')} base mean={pc(b0.get('meanReturn'))}% pDd5={pc(b0.get('pDd5'),'.1f')}% pDd10={pc(b0.get('pDd10'),'.1f')}%")
        for b in w.get('buckets') or []:
            out.append(f"  {b['key']} | n={b.get('n')} ep={b.get('episodes')} | mean={pc(b.get('meanReturn'))}% pDd5={pc(b.get('pDd5'),'.1f')}% pDd10={pc(b.get('pDd10'),'.1f')}% | dMean {f(b.get('mean'))} | dDD5 {f(b.get('dd5'))}")
open('study-table.txt','w').write('\n'.join(out))
print(len(out))
