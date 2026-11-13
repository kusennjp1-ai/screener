# SCRATCH (audit3 p3): summarise the settled render probe (charts/probe-reduce.json) per width and period.
import json, sys, collections, statistics
P = sys.argv[1]
d = json.load(open(f'{P}/charts/probe-reduce.json'))
R = d['renders']
UNVER = {r['symbol'] for r in R if r['unverified']}
print('unverified (excluded from label stats):', sorted(UNVER))
num = lambda s: s.replace(',', '').replace('−', '-')
def isnum(s):
    try: float(num(s)); return True
    except: return False
out = collections.defaultdict(lambda: collections.defaultdict(list))
rows = []
for r in R:
    key = (r['width'], r['period'])
    cert = r['symbol'] not in UNVER
    texts = [t for t in r['texts'] if t['vis'] and t['text']]
    pb = r['plotBottom']
    axis = [t for t in texts if t['cls'] == 'bc-axis']
    grid_vals = [float(num(t['text'])) for t in axis if isnum(t['text'])]
    nG = len(r['gridlines']); nShown = len(axis)
    priced_tags = [t for t in r['tags'] if any(isnum(p.strip()) for p in t['text'].split('/'))]
    # which gridlines are hidden, and by which tag
    hidden = []
    shown_y = sorted([(t['y0'] + t['y1']) / 2 for t in axis])
    for g in r['gridlines']:
        if any(abs(g['y'] - (sy)) < 6 for sy in shown_y): continue
        near = min(r['tags'], key=lambda t: abs(t['at'] - g['y'])) if r['tags'] else None
        hidden.append({'y': round(g['y'], 1), 'by': near['key'] if near else None, 'tag_text': near['text'] if near else None})
    forced = [t for t in texts if t['forced']]
    fcls = collections.Counter(t['cls'].split()[0] if t['cls'] else '?' for t in forced)
    h52_line = r['lines']['high52']
    h52_label = [t for t in texts if 'bc-high52-text' in (t['cls'] or '')]
    h52_tag = [t for t in r['tags'] if t['key'] == 'high52']
    other_lines = [l['y'] for k in ('pivot', 'stop', 'plan') for l in r['lines'][k]]
    trace = None
    if h52_line:
        ly = h52_line[0]['y']
        if h52_label:
            t = h52_label[0]; c = (t['y0'] + t['y1']) / 2
            between = [y for y in other_lines if min(c, ly) - 0.5 < y < max(c, ly) + 0.5 and abs(y - ly) > 1.5]
            closer = [y for y in other_lines if abs(y - c) < abs(ly - c) and abs(y - ly) > 1.5]
            trace = {'how': 'label', 'dy': round(c - ly, 1), 'x0': t['x0'], 'between': len(between), 'closer_other_line': len(closer), 'forced': t['forced']}
        elif h52_tag:
            t = h52_tag[0]; trace = {'how': 'nametag', 'leader': round(abs(t['at'] - t['y']), 1)}
        else: trace = {'how': 'line-only'}
    else:
        trace = {'how': 'not-in-range'}
    legs = r['legs']; depth_texts = [t for t in texts if t['depth'] is not None]
    depth_ok = all(str(round(abs(float(t['depth'])))) in t['text'] for t in depth_texts) if depth_texts else None
    notices = [t['text'] for t in texts if (t['cls'] or '').startswith('bc-notice')]
    minc = [t['contrast'] for t in texts if t['contrast'] is not None and 'bc-tagtext' not in (t['cls'] or '') and t['cls'] != 'bc-ylabel']
    lowc = [(t['cls'], t['text'], t['contrast']) for t in texts if t['contrast'] is not None and t['contrast'] < 4.5 and 'bc-tagtext' not in (t['cls'] or '')]
    row = dict(sym=r['symbol'], w=r['width'], p=r['period'], cert=cert, nG=nG, nShown=nShown, hidden=hidden, priced_tags=[t['key'] for t in priced_tags],
               forced=len(forced), fcls=dict(fcls), trace=trace, legs=len(legs), depth_ok=depth_ok, notices=notices, minc=min(minc) if minc else None, lowc=lowc,
               dry=r['dry'], rs=r['rs'], rsHigh=r['rsHigh'], rsLead=r['rsLead'], earn=r['earn'], breakout=r['breakout'], sells=r['sells'], zone=r['zone'],
               stop=bool(r['lines']['stop']), pivot=bool(r['lines']['pivot']), tags=[t['key'] for t in r['tags']], fs=sorted({t['fs'] for t in texts}),
               card_h=r['card_h'], W=r['W'], legendHidden=r['legendHidden'], aria=r['aria'])
    rows.append(row)
json.dump(rows, open(f'{P}/charts/probe-summary.json', 'w'), ensure_ascii=False, indent=0)
def summary(sel, name):
    s = [x for x in rows if sel(x)]
    if not s: return
    n = len(s)
    c = collections.Counter
    print(f'\n== {name}: {n} views')
    print('  font sizes:', c(tuple(x['fs']) for x in s).most_common(3))
    print('  min contrast (non-tag text):', min(x['minc'] for x in s if x['minc']), ' views with any <4.5:', sum(1 for x in s if x['lowc']), c(l[0] for x in s for l in x['lowc']).most_common(5))
    print('  grid numbers shown per view:', c(x['nShown'] for x in s).most_common(), ' gridlines:', c(x['nG'] for x in s).most_common())
    print('  views hiding >=1 grid number:', sum(1 for x in s if x['hidden']), ' hidden by tag:', c(h['by'] for x in s for h in x['hidden']).most_common())
    print('  views with <=1 grid number shown:', sum(1 for x in s if x['nShown'] <= 1), ' with 0:', sum(1 for x in s if x['nShown'] == 0))
    print('  52wk-high:', c(x['trace']['how'] for x in s).most_common())
    lab = [x['trace'] for x in s if x['trace']['how'] == 'label']
    if lab:
        print('    label |dy| px: median', statistics.median(abs(t['dy']) for t in lab), 'max', max(abs(t['dy']) for t in lab), ' other line between:', sum(1 for t in lab if t['between']), ' other line closer:', sum(1 for t in lab if t['closer_other_line']), ' forced:', sum(1 for t in lab if t['forced']))
    nt = [x['trace'] for x in s if x['trace']['how'] == 'nametag']
    if nt: print('    nametag leader px:', sorted(t['leader'] for t in nt))
    print('  forced labels: views', sum(1 for x in s if x['forced']), 'total', sum(x['forced'] for x in s), 'by class', sum((c(x['fcls']) for x in s), c()).most_common())
    print('  notices:', c(nn for x in s for nn in x['notices']).most_common(6))
    print('  legs drawn: views with >=1', sum(1 for x in s if x['legs']), ' depth text ok:', c(x['depth_ok'] for x in s).most_common())
    print('  dry-up bracket:', sum(1 for x in s if x['dry']), ' RS line:', sum(1 for x in s if x['rs']), ' RS new high tag:', sum(1 for x in s if x['rsHigh']), ' RS lead underline:', sum(1 for x in s if x['rsLead']))
    print('  earnings flag:', sum(1 for x in s if x['earn']), ' breakout:', c(x['breakout'] for x in s).most_common(), ' sells:', sum(1 for x in s if x['sells']))
    print('  zone:', sum(1 for x in s if x['zone']), ' pivot line:', sum(1 for x in s if x['pivot']), ' stop line:', sum(1 for x in s if x['stop']), ' tags:', c(t for x in s for t in x['tags']).most_common())
    print('  card heights:', c(x['card_h'] for x in s).most_common(4))
for w in (320, 390, 1440):
    for p in ('3m', '6m', '1y', 'weekly'):
        summary(lambda x, w=w, p=p: x['w'] == w and x['p'] == p and x['cert'], f'{w} {p} certified')
