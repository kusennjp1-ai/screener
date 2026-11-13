import json, sys, statistics as st
from collections import Counter
from datetime import date
SNAP = sys.argv[1]
rows = [json.loads(l) for l in open(SNAP + '/rows.jsonl')]
ready = [r for r in rows if r['setup_ready']=='pass']
cross = dict(DJCO='2026-09-14',BWIN='2026-09-15',RMBI='2026-09-17',GLBE='2026-10-20',LARK='2026-10-22',LCNB='2026-10-22',NBTB='2026-10-22',FMAO='2026-10-23',HAFC='2026-10-26',OPK='2026-10-29',PRTH='2026-11-02',MGRC='2026-11-03',ADI='2026-11-03',WSFS='2026-11-04',FCNCA='2026-11-04',IDT='2026-11-04',CZFS='2026-11-04',RNW='2026-11-04')
b5=0; a3=0; a3i=0; det=[]
for r in ready:
    pv=r['pivot']['se_pivot_price']; pd=r['pivot']['pivot_date']
    hi52_in=r['stage']['inputs']['week52_high']
    hi52_b=max(b['high'] for b in r['bars'][-252:])
    after=[b['high'] for b in r['bars'] if b['date']>pd]
    afteri=[b['high'] for b in r['bars'] if b['date']>=pd]
    ah=(max(after)/pv-1)*100 if after else None
    ahi=(max(afteri)/pv-1)*100
    v52=(pv/hi52_in-1)*100; v52b=(pv/hi52_b-1)*100
    if v52 < -5: b5+=1
    if ah is not None and ah>3: a3+=1
    if ahi>3: a3i+=1
    det.append((r['symbol'], pd, pv, round(v52,1), round(v52b,1), None if ah is None else round(ah,1), round(ahi,1), r['setup_engine']['pattern_primary'], r['pivot']['pivot_type']))
print('pivot >5% under 52wk high (stage inputs):', b5, '/37')
print('after-pivot-date high >3% (strict):', a3, ' inclusive:', a3i)
for d in det: print(d)
print()
aft=[s for s,c in cross.items() if c > [r for r in ready if r['symbol']==s][0]['pivot']['pivot_date']]
bef=[s for s,c in cross.items() if c < [r for r in ready if r['symbol']==s][0]['pivot']['pivot_date']]
eq=[s for s,c in cross.items() if c == [r for r in ready if r['symbol']==s][0]['pivot']['pivot_date']]
print('old crossings after pivot date', len(aft), aft); print('before', len(bef), bef); print('equal', eq)
