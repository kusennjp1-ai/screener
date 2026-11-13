# Read the feature run bundle and tally every market_* field across rows (per market).
import gzip, json, sys, collections
path = sys.argv[1]
with gzip.open(path, 'rt') as f:
    d = json.load(f)
print('top keys', list(d.keys()))
rows = d.get('rows') or d.get('features') or []
print('rows', len(rows), 'type', type(rows))
first = rows[0]
print('row keys sample', list(first.keys())[:40])
def get(r):
    # fields may be nested under details/feature payload
    for k in ('details_json','details','payload','features','result'):
        if isinstance(r.get(k), dict): return {**r, **r[k]}
    return r
tallies = collections.defaultdict(collections.Counter)
mk = collections.Counter()
for r in rows:
    g = get(r)
    m = g.get('market') or r.get('market')
    mk[m]+=1
    if m not in (None,'US'): continue
    for k,v in g.items():
        if k.startswith('market_') or k in ('market_regime',):
            tallies[k][json.dumps(v)]+=1
print('markets', mk)
for k in sorted(tallies):
    print(k, tallies[k].most_common(6))
