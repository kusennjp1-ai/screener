import json, sys, collections
kinds = collections.Counter(); ex = []
rounded_ok = 0; n = 0; disc = 0
for line in open(sys.argv[1]):
    r = json.loads(line); b = r['bundle']
    if not b or b['seed_ok'] or b['seed_reason'] != 'invalid_ohlcv' or not r['bars']: continue
    n += 1
    bad = []
    for x in r['bars']:
        o,h,l,c,v = x['open'],x['high'],x['low'],x['close'],x['volume']
        if not (l > 0 and v >= 0 and h >= max(o,c,l) and l <= min(o,c)): bad.append(x)
    if not bad: rounded_ok += 1
    else:
        kinds['bad_in_window_after_round'] += 1
        if len(ex) < 6: ex.append((r['symbol'], bad[:2]))
print('invalid_ohlcv scan rows with bars', n, 'ok after window+2dp rounding', rounded_ok)
print(kinds); print(json.dumps(ex)[:3000])
