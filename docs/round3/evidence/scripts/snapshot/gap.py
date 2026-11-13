import json, sys, collections
W = sys.argv[1]
ev = {}
for l in open(f'{W}/eval-proxy.jsonl'):
    r = json.loads(l); ev[r['symbol']] = r
c = collections.Counter(); hb = collections.Counter(); samples = collections.defaultdict(list)
for l in open(f'{W}/rows_in.jsonl'):
    r = json.loads(l); e = ev[r['symbol']]
    if e['technical_audit']['valid']: continue
    basis = e['row']['setup_recalculation']['bars_basis']
    why = basis if basis != 'bundle_seed_accepted' and basis != 'bundle_envelope_proxy' else 'audit:' + (e['technical_audit']['errors'] or ['?'])[0][:30]
    f = r['feature']; h = f.get('history_bars')
    ci_had = isinstance(h, (int, float)) and h >= 252 and f.get('passes_template') is not None
    c[(why, ci_had)] += 1
    if ci_had and len(samples[why]) < 5: samples[why].append((r['symbol'], h, f.get('current_price'), f.get('passes_template')))
for k, v in sorted(c.items(), key=lambda x: -x[1]): print(v, k)
print(json.dumps(samples)[:1500])
# feature-run view of the rows CI could chart but this rebuild cannot
miss = []
for l in open(f'{W}/rows_in.jsonl'):
    r = json.loads(l); e = ev[r['symbol']]; f = r['feature']; h = f.get('history_bars')
    if e['technical_audit']['valid']: continue
    if isinstance(h, (int, float)) and h >= 252 and f.get('passes_template') is not None:
        se = f.get('se') or {}
        miss.append((r['symbol'], f.get('passes_template'), se.get('setup_ready'), f.get('current_price'), f.get('avg_dollar_volume')))
print('ci-chartable but not rebuilt:', len(miss), 'feature passes_template:', sum(1 for m in miss if m[1]), 'feature se ready:', sum(1 for m in miss if m[2]))
print([m for m in miss if m[1]])
json.dump([m[0] for m in miss], open(f'{W}/unrebuilt_ci_chartable.json', 'w'))
