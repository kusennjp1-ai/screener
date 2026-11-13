# Sector ranks as collect-market-history.py builds them (100*(ETF/SPY)/(ETF.shift(126)/SPY.shift(126)), rank 1 = highest),
# on the upstream bundle's closes (推論: same formula, different retrieval than the Yahoo responses the producer uses).
import gzip, json, sys
SECT = ['XLB','XLC','XLE','XLF','XLI','XLK','XLP','XLRE','XLU','XLV','XLY']
with gzip.open(sys.argv[1], 'rt') as f: rows = json.load(f)['rows']
by = {r['symbol']: {p['date']: p['close'] for p in r['prices']} for r in rows if r['symbol'] in SECT + ['SPY']}
days = sorted(by['SPY'])
def frame(i):
    d, b = days[i], days[i-126]
    vals = {s: 100*(by[s][d]/by['SPY'][d])/(by[s][b]/by['SPY'][b]) for s in SECT}
    return d, sorted(((s, 1+sum(o > v for o in vals.values()), round(v, 2)) for s, v in vals.items()), key=lambda t: t[1])
last = frame(len(days)-1); before = frame(len(days)-1-21)
prior = {s: r for s, r, _ in before[1]}
res = {'date': last[0], 'before': before[0], 'ranks': [{'symbol': s, 'rank': r, 'relativeIndex': v, 'rankMonthAgo': prior[s]} for s, r, v in last[1]]}
json.dump(res, open(sys.argv[2], 'w'), indent=1)
print(res['date'], 'vs', res['before'])
for x in res['ranks']: print(x)
