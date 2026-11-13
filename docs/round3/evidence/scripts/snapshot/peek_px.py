import gzip, json, sys
with gzip.open(sys.argv[1], 'rt') as f: d = json.load(f)
print({k: (v if not isinstance(v, (list, dict)) else type(v).__name__ + str(len(v))) for k, v in d.items()})
rows = d['rows']; r = rows[0]
print({k: (v if not isinstance(v, (list, dict)) else type(v).__name__ + str(len(v))) for k, v in r.items()})
print(r['prices'][:2], r['prices'][-1])
import collections
lens = collections.Counter(min(len(x.get('prices') or []) // 50 * 50, 600) for x in rows)
print(sorted(lens.items()))
last = collections.Counter((x.get('prices') or [{}])[-1].get('date') for x in rows)
print(last.most_common(5))
spy = [x for x in rows if x['symbol'] == 'SPY']
print('SPY', len(spy), spy and len(spy[0]['prices']), spy and spy[0]['prices'][-1])
