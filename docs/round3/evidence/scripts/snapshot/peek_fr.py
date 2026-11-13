import gzip, json, sys
with gzip.open(sys.argv[1], 'rt') as f: d = json.load(f)
print('top keys', list(d.keys()))
print('run', json.dumps(d.get('run'))[:1500])
rows = d['rows']; print('rows', len(rows))
r = rows[0]; print('row keys', list(r.keys()))
dj = r.get('details_json') or {}
print('details keys', sorted(dj.keys()))
def shape(o, depth=0, maxd=3):
    if depth>maxd: return '...'
    if isinstance(o, dict): return {k: shape(v, depth+1, maxd) for k, v in list(o.items())[:60]}
    if isinstance(o, list): return [shape(o[0], depth+1, maxd)] if o else []
    return type(o).__name__
print(json.dumps(shape({k: v for k, v in dj.items() if k in ('screeners','setup_engine')}, 0, 5))[:6000])
