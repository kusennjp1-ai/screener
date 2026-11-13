import gzip,json,sys,collections
d=json.load(gzip.open(sys.argv[1]))
rows=d['rows']
C=collections.Counter
dj=[ (r, r['details_json'] if isinstance(r['details_json'],dict) else json.loads(r['details_json'] or '{}')) for r in rows]
r0=[x for x in dj if x[1].get('market_regime')][0][1]
print(sorted(k for k in r0.keys()))
print('market keys', {k:r0[k] for k in r0 if k.startswith('market')})
print('rating', C(r['overall_rating'] for r,_ in dj))
print('rating field in details', C(str(x.get('rating')) for _,x in dj).most_common(8))
tt=[x for _,x in dj if x.get('passes_template')]
print('TT',len(tt))
for k in ('exchange','ibd_industry_group','gics_sector','mic','market_breadth_pct_above_200dma','breadth_pct_above_200dma'):
    print(k, C(str(x.get(k))[:30] for x in tt).most_common(6))
allr=[x for _,x in dj if x.get('market_regime')]
print('exchange all', C(str(x.get('exchange')) for x in allr).most_common(8))
# breadth above 200 among scan
vals=[x.get('above_200dma') for x in allr]
print(C(str(v) for v in vals).most_common(4))
for k in r0:
    if 'breadth' in k or 'guard' in k or 'downgrad' in k or 'original' in k: print(k,r0[k])
print(json.dumps(d['run'].get('stats_json'))[:1500])
