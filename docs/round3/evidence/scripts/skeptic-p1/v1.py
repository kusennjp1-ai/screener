import json, sys, statistics as st
from collections import Counter
SNAP = sys.argv[1]
rows = [json.loads(l) for l in open(SNAP + '/rows.jsonl')]
print('listed', len(rows), 'ready', sum(r['setup_ready']=='pass' for r in rows))
def m(r):
    b = r['bars']; n = len(b)
    h=[x['high'] for x in b]; l=[x['low'] for x in b]; c=[x['close'] for x in b]; v=[x['volume'] for x in b]
    adr20 = st.mean([(h[i]/l[i]-1)*100 for i in range(n-20,n)])
    r20 = (max(h[-20:])/min(l[-20:])-1)*100
    v50 = sum(v[-50:])/50
    return dict(adr20=adr20, r20=r20, vlast=v[-1]/v50, c=c, v=v, h=h, l=l, b=b)
M = {r['symbol']: m(r) for r in rows}
# volume_vs_50d check
diff = [abs(M[r['symbol']]['vlast'] - r['setup_engine']['volume_vs_50d']) for r in rows if r['setup_engine'].get('volume_vs_50d') is not None]
print('vol_vs_50d mine vs SE: n', len(diff), 'max abs diff', max(diff), 'n>0.01', sum(d>0.01 for d in diff))
pinned = [r for r in rows if M[r['symbol']]['adr20'] < 0.6 and M[r['symbol']]['r20'] < 3]
pr = [r for r in pinned if r['setup_ready']=='pass']
print('pinned', len(pinned), 'ready', len(pr), [r['symbol'] for r in pr])
nonp = [r for r in rows if r not in pinned]
print('nonpinned ready', sum(r['setup_ready']=='pass' for r in nonp), '/', len(nonp))
print('pinned all', sorted(r['symbol'] for r in pinned))
adr_lt = [r for r in rows if M[r['symbol']]['adr20'] < 0.6]
print('adr<0.6 count', len(adr_lt))
tw = [r for r in rows if r['setup_engine'].get('pattern_primary')=='three_weeks_tight']
print('3WT primaries listed', len(tw), 'pinned', sum(r in pinned for r in tw), 'ready', sum(r['setup_ready']=='pass' for r in tw), 'ready&pinned', sum(r['setup_ready']=='pass' and r in pinned for r in tw))
ready = [r for r in rows if r['setup_ready']=='pass']
print('ready by pattern', Counter(r['setup_engine']['pattern_primary'] for r in ready))
# bands
bands=[(0,0.6),(0.6,2),(2,3),(3,4),(4,6),(6,99)]
for lo,hi in bands:
    g=[r for r in rows if lo<=M[r['symbol']]['adr20']<hi]
    rd=sum(r['setup_ready']=='pass' for r in g)
    print(f'ADR {lo}-{hi}: n={len(g)} ready={rd} ({100*rd/len(g):.1f}%)')
# liquidity
liq=[r for r in ready if r.get('ui_liquid_rank') is not None]
print('ready liquid', len(liq), [ (r['symbol'], r['ui_liquid_rank']) for r in liq])
ill=[r for r in ready if r.get('ui_liquid_rank') is None]
print('ready illiquid', len(ill), [(r['symbol'], round(r['close'],2), round(r['adv_usd']/1e6,1)) for r in ill])
print('ADV<5M', [(r['symbol'], round(r['adv_usd']/1e6,1)) for r in ready if r['adv_usd']<5e6])
print('groups ready', sorted(((r['ibd_industry_group'] or '')[:30], r['symbol']) for r in ready))
