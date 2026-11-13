# O'Neil/IBD market-direction recompute. Inputs: SPY/QQQ bars (bundle, to 11-12), real ^GSPC/^IXIC (study release, to 11-03).
import json, sys
I, O = sys.argv[1], sys.argv[2]
ser = {'SPY': json.load(open(I+'/bundle-market-symbols-SPY.json')), 'QQQ': json.load(open(I+'/bundle-market-symbols-QQQ.json'))}
for ix in json.load(open(I+'/study-release/indices.json'))['indices']:
    ser[ix['symbol']] = ix['bars']
N = 46
out = {}
def analyse(name, bars):
    n = len(bars); rows = []
    for i in range(n-N, n):
        b, p = bars[i], bars[i-1]
        ret = b['close']/p['close']-1; volup = b['volume'] > p['volume']; volr = b['volume']/p['volume']
        rng = b['high']-b['low']; pos = (b['close']-b['low'])/rng if rng > 0 else None
        hi25 = max(x['close'] for x in bars[i-24:i+1])
        v50 = sum(x['volume'] for x in bars[i-50:i])/50
        rows.append(dict(i=i, date=b['date'], close=round(b['close'],2), low=round(b['low'],2), high=round(b['high'],2), ret=round(ret*100,3), volr=round(volr,3), vol_vs50=round(b['volume']/v50,2), rangepos=None if pos is None else round(pos,2),
            near_hi=b['close'] >= hi25*0.97,
            dd_incl=ret <= -0.002 and volup, dd_strict=ret < -0.002-1e-12 and volup, price_leg=ret <= -0.002,
            stall_app=(0 < ret <= 0.002) and volup and pos is not None and pos <= 0.5 and b['close'] >= hi25*0.97,
            stall_wide=(0 <= ret <= 0.004) and volup and pos is not None and pos <= 0.5 and b['close'] >= hi25*0.97,
            borderline=abs(abs(ret)-0.002) < 0.0005))
    return rows
def count(bars, upto, rule, stall=None, expiry='close5', window=25):
    # count live DDs on session index `upto`
    live = []
    for i in range(upto-window+1, upto+1):
        b, p = bars[i], bars[i-1]; ret = b['close']/p['close']-1; volup = b['volume'] > p['volume']
        is_dd = volup and (ret <= -0.002 if rule == 'incl' else ret < -0.002-1e-12)
        is_st = False
        if stall and not is_dd:
            rng = b['high']-b['low']; pos = (b['close']-b['low'])/rng if rng > 0 else 1
            hi25 = max(x['close'] for x in bars[i-24:i+1])
            lim = 0.002 if stall == 'app' else 0.004
            is_st = (0 < ret <= lim) and volup and pos <= 0.5 and b['close'] >= hi25*0.97
        if not (is_dd or is_st): continue
        later = bars[i+1:upto+1]
        if expiry == 'close5' and any(x['close'] >= b['close']*1.05 for x in later): continue
        if expiry == 'high5' and any(x['high'] >= b['close']*1.05 for x in later): continue
        if expiry == 'high6' and any(x['high'] >= b['close']*1.06 for x in later): continue
        live.append(bars[i]['date'] + ('(S)' if is_st else ''))
    return live
def rally(bars, peak_from, upto):
    # peak = highest close since peak_from; low = lowest intraday low after peak; day1 = first up close after (or on?) low session (after), restart on undercut of low
    idx = [i for i in range(len(bars)) if bars[i]['date'] >= peak_from and i <= upto]
    pk = max(idx, key=lambda i: bars[i]['close'])
    log = []; low = None; day1 = None
    for i in range(pk+1, upto+1):
        b, p = bars[i], bars[i-1]
        if low is None or b['low'] < bars[low]['low']:
            if day1 is not None: log.append(dict(date=b['date'], ev='undercut -> attempt reset', was_day=i-day1+1))
            low = i; day1 = None
            # O'Neil + Co variant: an up close on the low session itself can be Day 1
            continue
        if day1 is None and b['close'] > p['close']:
            day1 = i; log.append(dict(date=b['date'], ev='Day 1'))
        if day1 is not None:
            d = i-day1+1; g = b['close']/p['close']-1
            if d >= 3 and g >= 0.01:
                log.append(dict(date=b['date'], ev='FTD price-leg candidate', day=d, gain=round(g*100,2), vol_ratio_prev=round(b['volume']/p['volume'],3),
                    vol_higher=b['volume'] > p['volume'], passes={str(t): g >= t/100 for t in (1.0,1.2,1.25,1.5,1.7,2.0)}))
    res = dict(peak=dict(date=bars[pk]['date'], close=bars[pk]['close']), low=dict(date=bars[low]['date'], low=bars[low]['low'], close=bars[low]['close']) if low else None,
        decline_close_to_lowclose=round((1-bars[low]['close']/bars[pk]['close'])*100,2) if low else None,
        decline_close_to_intraday_low=round((1-bars[low]['low']/bars[pk]['close'])*100,2) if low else None,
        maxdd_closing=round((1-min(bars[i]['close'] for i in range(pk, upto+1))/bars[pk]['close'])*100,2),
        day1=bars[day1]['date'] if day1 else None, day_count_on_last=(upto-day1+1) if day1 else None, log=log)
    return res
for name, bars in ser.items():
    n = len(bars); rows = analyse(name, bars)
    variants = {}
    for rule in ('incl','strict'):
        for stall in (None,'app','wide'):
            for ex in ('close5','high5','high6'):
                variants[f'{rule}|stall={stall}|{ex}'] = count(bars, n-1, rule, stall, ex)
    hist = [dict(date=bars[u]['date'], backend_like=len(count(bars,u,'incl','app','close5')), classic_incl=len(count(bars,u,'incl',None,'close5')), frontend_like=len(count(bars,u,'strict',None,'high5'))) for u in range(n-N, n)]
    c = [b['close'] for b in bars]; s50 = sum(c[-50:])/50; s200 = sum(c[-200:])/200; s50_21 = sum(c[-71:-21])/50
    out[name] = dict(last=bars[-1]['date'], rows=rows, variants={k: dict(n=len(v), days=v) for k, v in variants.items()}, hist=hist,
        rally=rally(bars, '2026-09-01', n-1), ma=dict(close=c[-1], sma50=round(s50,2), sma200=round(s200,2), vs50=round((c[-1]/s50-1)*100,2), vs200=round((c[-1]/s200-1)*100,2), sma50_rising_21=s50 > s50_21,
        hi252=max(c[-252:]), from_high=round((1-c[-1]/max(c[-252:]))*100,2)))
json.dump(out, open(O+'/recompute.json','w'), indent=1)
for name in out:
    r = out[name]; print('=====', name, 'last', r['last'], r['ma'])
    print('date        ret%   volr v/50 pos  DDi DDs St StW bord')
    for x in r['rows'][-32:]:
        print(x['date'], f"{x['ret']:7.3f} {x['volr']:5.2f} {x['vol_vs50']:4.2f} {x['rangepos']}", 'D' if x['dd_incl'] else ('p' if x['price_leg'] else '.'), 'D' if x['dd_strict'] else '.', 'S' if x['stall_app'] else '.', 'S' if x['stall_wide'] else '.', 'B' if x['borderline'] else '')
    for k, v in r['variants'].items(): print(' ', k, v['n'], v['days'])
    print(' rally', json.dumps(r['rally']))
    print(' hist', [(h['date'][5:], h['backend_like'], h['classic_incl'], h['frontend_like']) for h in r['hist'][-30:]])
