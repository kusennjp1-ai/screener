import gzip,json,sys,collections
d=json.load(gzip.open(sys.argv[1])); C=collections.Counter
dj=[r['details_json'] if isinstance(r['details_json'],dict) else json.loads(r['details_json'] or '{}') for r in d['rows']]
w=[x for x in dj if x.get('rating')=='Watch']
for k in ('execution_cap_reason','execution_cap_applied','composite_reason','quality_downgrade_reason','execution_state'):
    print(k, C(str(x.get(k))[:90] for x in w).most_common(5))
print('rating_explanation', C(str(x.get('rating_explanation'))[:110] for x in w).most_common(5))
for k in ('minervini_rating','composite_rating','setup_engine_rating'):
    print(k, C(str(x.get(k)) for x in dj).most_common(6))
