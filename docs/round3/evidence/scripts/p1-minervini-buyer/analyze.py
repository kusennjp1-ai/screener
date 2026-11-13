"""p1 chart metrics for listed rows (snapshot rows.jsonl). Read-only."""
import json, sys, statistics as st, math
SNAP = sys.argv[1]; OUT = sys.argv[2]; BENCH = sys.argv[3]; FR = sys.argv[4]
spy = {b['date']: b['close'] for b in json.load(open(BENCH))['bars']}
fr = json.load(open(FR))['rows']

def sma(xs, n):
    return sum(xs[-n:]) / n if len(xs) >= n else None

def zigzag(bars, thr):
    """Swing points on highs/lows with a percent reversal threshold."""
    pts = []  # (idx, kind, price)
    if not bars: return pts
    trend = None; ext_i = 0; ext_p = bars[0]['high']; lo_i = 0; lo_p = bars[0]['low']
    hi_i, hi_p = 0, bars[0]['high']
    for i, b in enumerate(bars):
        if trend in (None, 'up'):
            if b['high'] >= hi_p: hi_i, hi_p = i, b['high']
            if b['low'] <= hi_p * (1 - thr):
                pts.append((hi_i, 'H', hi_p)); trend = 'down'; lo_i, lo_p = i, b['low']
                continue
        if trend == 'down':
            if b['low'] <= lo_p: lo_i, lo_p = i, b['low']
            if b['high'] >= lo_p * (1 + thr):
                pts.append((lo_i, 'L', lo_p)); trend = 'up'; hi_i, hi_p = i, b['high']
    return pts

def metrics(r):
    bars = r['bars']; n = len(bars)
    c = [b['close'] for b in bars]; h = [b['high'] for b in bars]; l = [b['low'] for b in bars]; v = [b['volume'] for b in bars]
    close = c[-1]
    s50, s150, s200 = sma(c, 50), sma(c, 150), sma(c, 200)
    s200_21 = sma(c[:-21], 200) if n >= 221 else None
    s200_105 = sma(c[:-105], 200) if n >= 305 else None  # ~5 months
    ext50 = (close / s50 - 1) * 100 if s50 else None
    adr20 = st.mean([(h[i] / l[i] - 1) * 100 for i in range(n - 20, n)])
    def rng(a, b):  # sessions [n-a, n-b)
        hh = max(h[n - a:n - b] if b else h[n - a:]); ll = min(l[n - a:n - b] if b else l[n - a:])
        return (hh / ll - 1) * 100
    r10 = rng(10, 0); r20 = rng(20, 0); r60 = rng(60, 0)
    r_11_30 = rng(30, 10); r_31_60 = rng(60, 30)
    # biggest one-day move in last 60 sessions
    moves = [((c[i] / c[i - 1] - 1) * 100, bars[i]['date'], v[i]) for i in range(n - 60, n)]
    big = max(moves, key=lambda x: abs(x[0]))
    # sessions since that move and range since
    bi = [b['date'] for b in bars].index(big[1])
    since = bars[bi:]
    rng_since = (max(b['high'] for b in since) / min(b['low'] for b in since) - 1) * 100
    # volume
    v50 = sma(v, 50)
    vlast = v[-1] / v50 if v50 else None
    v10 = st.mean(v[-10:]) / v50 if v50 else None
    v5 = st.mean(v[-5:]) / v50 if v50 else None
    quiet10 = sum(1 for x in v[-10:] if v50 and x < 0.8 * v50)
    upv = sum(v[i] for i in range(n - 20, n) if c[i] > c[i - 1]); dnv = sum(v[i] for i in range(n - 20, n) if c[i] < c[i - 1])
    ud20 = upv / dnv if dnv else None
    # 52w
    hi52 = max(h[-252:]); lo52 = min(l[-252:])
    off_hi = (close / hi52 - 1) * 100
    # base: from the highest high of the last 130 sessions? use zigzag on last 130 bars
    win = bars[-130:]
    # base start = index of max high in last 130 sessions that precedes the current consolidation
    hmax_i = max(range(len(win)), key=lambda i: win[i]['high'])
    zz = zigzag(win[hmax_i:], 0.04) if hmax_i < len(win) - 1 else []
    # contraction depths: after base high, each H->L drop
    seq = [(hmax_i, 'H', win[hmax_i]['high'])] + [(hmax_i + i, k, p) for i, k, p in zz if i > 0]
    depths = []
    for j in range(len(seq) - 1):
        if seq[j][1] == 'H' and seq[j + 1][1] == 'L':
            depths.append(round((1 - seq[j + 1][2] / seq[j][2]) * 100, 1))
    # trailing drop from last swing high to the lowest low since
    last_h = [p for p in seq if p[1] == 'H'][-1]
    tail = win[last_h[0]:]
    tail_depth = (1 - min(b['low'] for b in tail) / last_h[2]) * 100
    sessions_since_base_high = len(win) - 1 - hmax_i
    # prior advance: low in the 130 sessions before base high vs base high
    pre = bars[max(0, n - 130 + hmax_i - 130): n - 130 + hmax_i + 1]
    prior_adv = (win[hmax_i]['high'] / min(b['low'] for b in pre) - 1) * 100 if pre else None
    # RS line vs SPY
    rsl = [(b['date'], b['close'] / spy[b['date']]) for b in bars if b['date'] in spy]
    rs_now = rsl[-1][1]; rs_max252 = max(x[1] for x in rsl[-252:])
    rs_off = (rs_now / rs_max252 - 1) * 100
    rs65 = (rs_now / rsl[-66][1] - 1) * 100 if len(rsl) > 66 else None
    rs20 = (rs_now / rsl[-21][1] - 1) * 100 if len(rsl) > 21 else None
    # pivot geometry
    pv = (r.get('pivot') or {}).get('se_pivot_price')
    piv_vs_hi10 = (pv / max(h[-10:]) - 1) * 100 if pv else None
    piv_vs_hi60 = (pv / max(h[-60:]) - 1) * 100 if pv else None
    piv_vs_hi52 = (pv / hi52 - 1) * 100 if pv else None
    # largest volume day last 30 sessions and its date
    vmax_i = max(range(n - 30, n), key=lambda i: v[i])
    # earnings proxy: biggest volume day between 2026-10-13 and 2026-11-12 with |move| >=3% or vol >= 2.5x
    ep = None
    for i in range(n - 1, n - 45, -1):
        if bars[i]['date'] < '2026-10-13': break
        vr = v[i] / (sma(v[:i], 50) or 1)
        mv = abs(c[i] / c[i - 1] - 1) * 100
        if vr >= 2.5 or (vr >= 1.8 and mv >= 4):
            if ep is None or vr > ep[1]: ep = (bars[i]['date'], round(vr, 1), round((c[i] / c[i - 1] - 1) * 100, 1))
    se = r['setup_engine']
    frr = fr.get(r['symbol'], {}).get('details_json', {}) if r['symbol'] in fr else {}
    return dict(
        sym=r['symbol'], rank=r.get('ui_liquid_rank'), ready=r['setup_ready'], failed=r['setup_ready_failed_checks'],
        listed=r['listed_as'], basis=r['bars_basis'], close=close, adv_m=round(r['adv_usd'] / 1e6, 1) if r.get('adv_usd') else None,
        stage=r['stage']['stage'], s200_up21=(s200 > s200_21) if s200_21 else None, s200_up105=(s200 > s200_105) if s200_105 else None,
        ext50=round(ext50, 1), off_hi=round(off_hi, 1), adr20=round(adr20, 2), r10=round(r10, 1), r20=round(r20, 1), r60=round(r60, 1),
        r_11_30=round(r_11_30, 1), r_31_60=round(r_31_60, 1),
        big_move=round(big[0], 1), big_date=big[1], big_vol_x=round(big[2] / v50, 1) if v50 else None, rng_since_big=round(rng_since, 1), sess_since_big=n - 1 - bi,
        vlast=round(vlast, 2), v5=round(v5, 2), v10=round(v10, 2), quiet10=quiet10, ud20=round(ud20, 2) if ud20 else None,
        base_hi_sessions_ago=sessions_since_base_high, depths=depths, tail_depth=round(tail_depth, 1), prior_adv=round(prior_adv, 1) if prior_adv else None,
        rs_est=round(r['rs_estimate']['value'], 1) if r.get('rs_estimate') and r['rs_estimate'].get('value') is not None else None,
        rs_line_high=(r.get('rs_line_high') or {}).get('value'), rs_off_high=round(rs_off, 1), rs65=round(rs65, 1) if rs65 is not None else None, rs20=round(rs20, 1) if rs20 is not None else None,
        pattern=se.get('pattern_primary'), conf=se.get('pattern_confidence'), setup=round(se.get('setup_score') or 0, 1), quality=round(se.get('quality_score') or 0, 1),
        readiness=round(se.get('readiness_score'), 1) if se.get('readiness_score') is not None else None,
        base_wk=se.get('base_length_weeks'), base_depth=round(se.get('base_depth_pct'), 1) if se.get('base_depth_pct') is not None else None,
        se_vol=round(se.get('volume_vs_50d'), 2) if se.get('volume_vs_50d') is not None else None, atr=round(se.get('atr14_pct'), 2) if se.get('atr14_pct') is not None else None,
        pivot=pv, pivot_type=(r.get('pivot') or {}).get('pivot_type'), pivot_date=(r.get('pivot') or {}).get('pivot_date'),
        dist=round((r.get('pivot') or {}).get('distance_to_pivot_pct'), 2) if (r.get('pivot') or {}).get('distance_to_pivot_pct') is not None else None,
        piv_vs_hi10=round(piv_vs_hi10, 1) if piv_vs_hi10 is not None else None, piv_vs_hi60=round(piv_vs_hi60, 1) if piv_vs_hi60 is not None else None, piv_vs_hi52=round(piv_vs_hi52, 1) if piv_vs_hi52 is not None else None,
        earn_proxy=ep,
        fr_eps_qq=frr.get('eps_growth_qq'), fr_sales_qq=frr.get('sales_growth_qq'), fr_mcap_b=round(frr['market_cap_usd'] / 1e9, 2) if frr.get('market_cap_usd') else None,
        group=r.get('ibd_industry_group'), sector=r.get('gics_sector'),
    )

out = open(OUT, 'w')
for line in open(SNAP):
    r = json.loads(line)
    try:
        m = metrics(r)
    except Exception as e:
        m = {'sym': r['symbol'], 'error': repr(e)}
    out.write(json.dumps(m) + '\n')
