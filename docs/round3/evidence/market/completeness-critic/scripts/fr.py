import gzip,json,sys,collections
p=sys.argv[1]
d=json.load(gzip.open(p))
print(type(d), list(d.keys())[:30] if isinstance(d,dict) else len(d))
rows=d.get('rows') or d.get('results') or d.get('data')
if isinstance(d,dict):
    for k,v in d.items():
        if isinstance(v,list): print(k,len(v)); rows=v if len(v)>1000 else rows
        elif isinstance(v,dict): print(k, list(v.keys())[:40])
        else: print(k, str(v)[:100])
r=rows[0]
print(sorted(r.keys()) if isinstance(r,dict) else r)
