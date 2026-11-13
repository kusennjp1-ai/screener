# Which market-environment series exist in the upstream daily price bundle (by symbol), and their last bar.
import gzip, json, sys
path, out = sys.argv[1], sys.argv[2]
with gzip.open(path, 'rt') as f:
    d = json.load(f)
rows = d['rows']
print('rows', len(rows), 'row keys', sorted(rows[0].keys()))
want = ['SPY','QQQ','IWM','DIA','MDY','RSP','^GSPC','^IXIC','^DJI','^RUT','^VIX','VIX','^NDX','^SPX','XLB','XLC','XLE','XLF','XLI','XLK','XLP','XLRE','XLU','XLV','XLY','SMH','SOXX','IBB','XBI','ARKK','GLD','TLT','HYG','UUP']
by = {r.get('symbol'): r for r in rows}
res = {}
for s in want:
    r = by.get(s)
    if r is None: res[s] = None; continue
    p = r.get('prices') or []
    res[s] = {'bars': len(p), 'first': p[0]['date'] if p else None, 'last': p[-1]['date'] if p else None, 'last_close': p[-1]['close'] if p else None, 'last_volume': p[-1].get('volume') if p else None, 'exchange': r.get('exchange'), 'other_keys': sorted(k for k in r if k!='prices')}
for s,v in res.items(): print(s, v)
json.dump(res, open(out,'w'), indent=1)
# also emit SPY bars for regime replay
if by.get('SPY'):
    json.dump(by['SPY']['prices'], open(out.replace('.json','-SPY.json'),'w'))
if by.get('QQQ'):
    json.dump(by['QQQ']['prices'], open(out.replace('.json','-QQQ.json'),'w'))
