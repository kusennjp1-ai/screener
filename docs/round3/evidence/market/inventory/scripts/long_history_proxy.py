# Proxy of the published long history's newest sessions: the producer's own build() (collect-market-history.py at 7f0ff13)
# run on the upstream daily price bundle's bars (2 years, not Yahoo's 6) for the snapshot's verified chart universe
# (4421 of the published 4538). 推論: a different universe and retrieval; compared below with the published 11-12 values.
import importlib.util, gzip, json, sys
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location('cmh', '/home/user/screener/.claude/worktrees/r3-market-audit/frontend/tools/collect-market-history.py')
cmh = importlib.util.module_from_spec(spec); spec.loader.exec_module(cmh)
bundle, evalrows, out = sys.argv[1:4]
verified = []
for line in open(evalrows):
    r = json.loads(line)
    ta = r.get('technical_audit') or {}
    if ta.get('valid') is True: verified.append(r['symbol'])
verified = sorted(set(verified))
print('verified symbols', len(verified), flush=True)
with gzip.open(bundle, 'rt') as f: rows = json.load(f)['rows']
by = {r['symbol']: r['prices'] for r in rows}
sessions = sorted(p['date'] for p in by['SPY'])
def record(symbol, prices):
    ts = [int(datetime.fromisoformat(p['date'] + 'T15:00:00+00:00').timestamp()) for p in prices]
    # Envelope repair (as the snapshot's proxy variant): high/low widened to contain open and close; this is a proxy only.
    fixed = []
    for p in prices:
        o, h, l, c, v = (p.get(k) for k in ('open', 'high', 'low', 'close', 'volume'))
        if all(isinstance(x, (int, float)) and x > 0 for x in (o, h, l, c)):
            h, l = max(o, h, l, c), min(o, h, l, c)
        fixed.append({'open': o, 'high': h, 'low': l, 'close': c, 'volume': v if isinstance(v, (int, float)) and v >= 0 else 0})
    q = {k: [p[k] for p in fixed] for k in ('open', 'high', 'low', 'close', 'volume')}
    raw = json.dumps({'chart': {'result': [{'meta': {'symbol': symbol}, 'timestamp': ts, 'indicators': {'quote': [q]}}]}})
    return {'symbol': symbol, 'raw': raw, 'provenance': {'url': 'bundle', 'sha256': cmh.digest(raw.encode()), 'retrieved_at': 'n/a'}}
records = {s: record(s, by[s]) for s in verified if s in by}
print('records', len(records), 'sessions', len(sessions), sessions[0], sessions[-1], flush=True)
res = cmh.build(records, {}, verified, sessions, sessions[-1], None)
keep = {}
for p in res['breadth']:
    if p['date'] >= '2026-10-01':
        e = {k: p[k] for k in ('date','coverage','eligibleUniverse','above50','above50Percent','newHighs','newLows','leaderCount','trendTemplateCount','rs90TemplateCount','above150','above200','above200Percent','stage1','stage2','stage3','stage4','breakouts','breakoutsJudged','breakoutsHeld','leaderCohort','leaderCohortAbove50','stocks_up_4pct','stocks_down_4pct','ratio_10day')}
        keep[p['date']] = e
json.dump(keep, open(out, 'w'), indent=1)
for d in list(keep)[-12:]: print(json.dumps(keep[d]))
