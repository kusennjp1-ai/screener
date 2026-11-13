# Supplement: cap-flip split, no-stalling counts on a common window, live distribution dates of the real indices at 11-03.
import json, sys
INV, OUT = sys.argv[1], sys.argv[2]
c = json.load(open(OUT + '/check.json'))
ser = {'SPY': json.load(open(INV+'/bundle-market-symbols-SPY.json'))}
for ix in json.load(open(INV+'/study-release/indices.json'))['indices']: ser[ix['symbol']] = ix['bars'][-800:]
def live(bars, upto, expiry):
    out = []
    for i in range(upto-24, upto+1):
        b, p = bars[i], bars[i-1]
        if b['close']/p['close']-1 <= -0.002 and b['volume'] > p['volume']:
            later = bars[i+1:upto+1]
            if any((x['close'] if expiry == 'close' else x['high']) >= b['close']*1.05 for x in later): continue
            out.append(b['date'])
    return out
res = {}
for name in ser:
    bars = ser[name]; end = next(i for i, b in enumerate(bars) if b['date'] == '2026-11-03')
    counts = [len(live(bars, i, 'close')) for i in range(end-249, end+1)]
    res[name] = dict(window_end='2026-11-03', n=250, no_stall_share_ge4=round(sum(x >= 4 for x in counts)/250, 3), share_ge5=round(sum(x >= 5 for x in counts)/250, 3), share_ge7=round(sum(x >= 7 for x in counts)/250, 3),
        live_1103_close5=live(bars, end, 'close'), live_1103_high5=live(bars, end, 'high'))
import importlib.util, pandas as pd
print(json.dumps(res, indent=1))
json.dump(res, open(OUT+'/check2.json', 'w'), indent=1)
