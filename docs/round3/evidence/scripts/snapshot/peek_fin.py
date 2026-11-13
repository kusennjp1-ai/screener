import gzip, json, sys
with gzip.open(sys.argv[1], 'rt') as f: d = json.load(f)
want = set(sys.argv[2].split(','))
for r in d['rows']:
    if r['symbol'] in want:
        dj = r['details_json']
        print(r['symbol'], json.dumps({k: dj.get(k) for k in ('financial_source_evidence', 'fundamental_bonus_detail', 'eps_growth_qq', 'eps_growth_yy', 'data_status')})[:1500])
