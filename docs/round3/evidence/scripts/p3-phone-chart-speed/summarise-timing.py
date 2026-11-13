# SCRATCH (audit3 p3): summarise timing.spec.mjs output. For each run: the longest task, and the "chart task" = the long
# task that ends at the first candle in the right pane (the candle mark falls within [start, start+dur+2ms]).
import json, sys, statistics, collections
d = json.load(open(sys.argv[1]))
def chart_task(run):
    c = run['marks'].get('candle')
    if c is None: return None
    hits = [t for t in run['tasks'] if t[0] - 1 <= c <= t[0] + t[1] + 2]
    return hits[0][1] if hits else 0.0  # 0 = the draw was not a long task (<50ms)
out = collections.defaultdict(dict)
for s in d:
    runs = s['runs']
    L = [r['longest_at_first_candidate_ms'] for r in runs]
    Ls = [r['longest_settled_ms'] for r in runs]
    C = [chart_task(r) for r in runs]
    first = [r['first_candidate_ms'] for r in runs]
    cal = [r.get('calib_ms') for r in runs]
    panes = sorted({r['pane'] for r in runs}); left = all(r['leftToday'] for r in runs)
    longest_is_chart = sum(1 for r, c in zip(runs, C) if c and abs(c - r['longest_settled_ms']) < 0.05)
    tags = sorted({k for r in runs for k in r['nametags']})
    out[s['target']][s['tree']] = dict(n=len(runs), longest_first=L, longest_settled=Ls, chart=C, first=first, calib=cal, panes=panes, leftToday=left, longest_is_chart=longest_is_chart, tags=tags,
        med_longest=statistics.median(L), med_chart=statistics.median([c for c in C if c is not None]) if any(c is not None for c in C) else None, med_first=statistics.median(first), labels=sorted({r['labels'] for r in runs}), forced=sorted({r['forced'] for r in runs}), errors=s['errors'][:3])
json.dump(out, open(sys.argv[2], 'w'), indent=1)
trees = ['8bddb88', '5645ff0', '8849bf9']
for target, by in out.items():
    row = [target]
    for t in trees:
        if t in by: row.append(f"{t}: longest {by[t]['med_longest']} chart {by[t]['med_chart']} (pane {','.join(by[t]['panes'])}, labels {by[t]['labels']}, tags {by[t]['tags']})")
    print(' | '.join(row))
