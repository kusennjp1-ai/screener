"""Snapshot step A: rebuild the publication's scan rows and chart bars for 2026-11-12 from release inputs.

Replays, from the archived main 8849bf9 code paths (copied logic, cited inline):
- static_site_export_service._export_scan_bundle: rows = feature-run rows minus ibd_industry_group 'Finance-ETF / ETN'.
- daily_price_bundle_service seed import -> price_cache._store_batch_in_database -> _coherent_history_decision on
  the full raw bundle frame (accept / reject per symbol).
- static_site_export_service._serialize_chart_bars: bars with date >= export time - 450 days (first bar 2025-08-21,
  310 sessions for a full history), OHLC rounded to 2dp, int volume, through the analysis date.
- export-book-benchmark.py export_session_calendar: XNYS sessions from target - 730 days.
Nothing is invented: a symbol without bundle bars has no chart here.
"""
import gzip, json, math, sys
from datetime import date, timedelta
import numpy as np
import pandas as pd
import pandas_market_calendars as mcal

fr_path, px_path, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
TARGET = '2026-11-12'
CHART_START = '2025-08-21'  # export ran ~09:0xZ 2026-11-13; minus 450 days -> 2025-08-20T09Z; first daily stamp >= cutoff
EXCLUDED = {'Finance-ETF / ETN'}


def coherent_decision(prices):
    # backend/app/services/cache/price_history_integrity.py::_coherent_history_decision on _build_batch_dataframe
    frame = pd.DataFrame({'Date': pd.to_datetime([p['date'] for p in prices]), 'Open': [p.get('open') for p in prices],
                          'High': [p.get('high') for p in prices], 'Low': [p.get('low') for p in prices],
                          'Close': [p.get('close') for p in prices], 'Volume': [p.get('volume') for p in prices]}).set_index('Date')
    if frame.empty: return False, 'empty_history'
    values = frame[['Open', 'High', 'Low', 'Close', 'Volume']]
    if not np.isfinite(values.to_numpy(dtype=float)).all(): return False, 'nonfinite_values'
    if not frame.index.is_unique or not frame.index.is_monotonic_increasing: return False, 'invalid_index'
    ratios = frame['Close'].iloc[1:].to_numpy() / frame['Close'].iloc[:-1].to_numpy()
    if not ((ratios > .55) & (ratios < 1.8)).all(): return False, 'price_discontinuity'
    valid = bool((frame['Low'] > 0).all() and (frame['Volume'] >= 0).all()
                 and (frame['High'] >= frame[['Open', 'Close', 'Low']].max(axis=1)).all()
                 and (frame['Low'] <= frame[['Open', 'Close']].min(axis=1)).all())
    return valid, None if valid else 'invalid_ohlcv'


def chart_bars(prices):
    out = []
    for p in prices:
        d = p.get('date')
        if not d or d < CHART_START or d > TARGET: continue
        try:
            out.append({'date': d, 'open': round(float(p['open']), 2), 'high': round(float(p['high']), 2), 'low': round(float(p['low']), 2),
                        'close': round(float(p['close']), 2), 'volume': int(p['volume'])})
        except (TypeError, ValueError, KeyError, OverflowError):
            return None  # the DB frame would not serialize this either; leave the chart absent, never patched
    return out


with gzip.open(fr_path, 'rt') as f: fr = json.load(f)
assert fr['run']['as_of_date'] == TARGET
feature = {}
for r in fr['rows']:
    dj = r.get('details_json') or {}
    if dj.get('ibd_industry_group') in EXCLUDED: continue
    se = dj.get('setup_engine') if isinstance(dj.get('setup_engine'), dict) else None
    ex = (se or {}).get('explain') or {}
    mini = ((dj.get('details') or {}).get('screeners') or {}).get('minervini') or {}
    fa = (mini.get('details') or {}).get('full_analysis') if isinstance(mini.get('details'), dict) else None
    feature[r['symbol']] = {
        'company_name': dj.get('company_name'), 'ibd_industry_group': dj.get('ibd_industry_group'), 'ibd_group_rank': dj.get('ibd_group_rank'),
        'gics_sector': dj.get('gics_sector'), 'current_price': dj.get('current_price'), 'avg_dollar_volume': dj.get('avg_dollar_volume'),
        'passes_template': dj.get('passes_template'), 'stage': dj.get('stage'), 'stage_name': dj.get('stage_name'),
        'rs_rating': dj.get('rs_rating'), 'ma_alignment': dj.get('ma_alignment'), 'adr_percent': dj.get('adr_percent'),
        'market_regime': dj.get('market_regime'), 'eps_growth_yy': dj.get('eps_growth_yy'), 'sales_growth_yy': dj.get('sales_growth_yy'),
        'se': None if se is None else {k: se.get(k) for k in ('setup_ready', 'setup_score', 'quality_score', 'readiness_score', 'pattern_primary',
              'pattern_confidence', 'pivot_price', 'pivot_type', 'pivot_date', 'distance_to_pivot_pct', 'in_early_zone', 'extended_from_pivot',
              'base_length_weeks', 'base_depth_pct', 'volume_vs_50d', 'stage', 'rs', 'rs_rating', 'ma_alignment_score', 'atr14_pct')},
        'se_failed_checks': ex.get('failed_checks') if isinstance(ex, dict) else None,
        'minervini_full_analysis': fa,
        'history_bars': dj.get('history_bars'), 'result_status': dj.get('result_status'), 'data_status': dj.get('data_status'),
    }
n_feature_rows = len(fr['rows']); del fr

with gzip.open(px_path, 'rt') as f: px = json.load(f)
assert px['as_of_date'] == TARGET
seed = {'accepted': 0, 'rejected': 0, 'reasons': {}}
bundle = {}
spy = None
for r in px['rows']:
    sym = str(r.get('symbol') or '').strip().upper(); prices = r.get('prices') or []
    if not sym or not prices: continue
    ok, why = coherent_decision(prices)
    seed['accepted' if ok else 'rejected'] += 1
    if not ok: seed['reasons'][why] = seed['reasons'].get(why, 0) + 1
    if sym == 'SPY':
        spy = [{'date': p['date'], **{k: round(float(p[k]), 8) for k in ('open', 'high', 'low', 'close', 'volume')}} for p in prices]
    if sym in feature:
        bundle[sym] = {'seed_ok': ok, 'seed_reason': why, 'bars': chart_bars(prices), 'raw_last': prices[-1].get('date'), 'raw_n': len(prices)}
del px

start = date.fromisoformat(TARGET) - timedelta(days=730)
sched = mcal.get_calendar('NYSE').schedule(start_date=start, end_date=TARGET)
sessions = [s.date().isoformat() for s in sched.index]
assert sessions[-1] == TARGET
cal = {'schema_version': 'market-sessions-v1', 'market': 'US', 'exchange': 'XNYS', 'provider': 'pandas_market_calendars',
       'provider_version': mcal.__version__, 'as_of_date': TARGET, 'range_start': start.isoformat(), 'range_end': TARGET, 'sessions': sessions,
       'generated_at': '2026-11-13T09:40:00+00:00', 'completed_session_close': sched.iloc[-1]['market_close'].isoformat()}
json.dump(cal, open(f'{out_dir}/calendar.json', 'w'))
spy_sessions = [s for s in sessions if s >= start.isoformat()]
json.dump({'schema_version': 'book-benchmark-v1', 'symbol': 'SPY', 'as_of_date': TARGET, 'bars': [b for b in spy if b['date'] >= start.isoformat()],
           'source': {'provider': 'daily-price-us-20261112 bundle (xang1234/stock-screener daily-price-data); CI used Yahoo Finance via yfinance, auto_adjust=False'}},
          open(f'{out_dir}/benchmark.json', 'w'))

with open(f'{out_dir}/rows_in.jsonl', 'w') as o:
    for sym, f in feature.items():
        b = bundle.get(sym)
        o.write(json.dumps({'symbol': sym, 'feature': f, 'bundle': None if b is None else {k: b[k] for k in ('seed_ok', 'seed_reason', 'raw_last', 'raw_n')},
                            'bars': None if b is None else b['bars']}) + '\n')
print(json.dumps({'feature_rows': n_feature_rows, 'scan_rows_non_etf': len(feature), 'bundle_seed': seed, 'scan_rows_in_bundle': len(bundle),
                  'scan_rows_seed_ok': sum(1 for b in bundle.values() if b['seed_ok']),
                  'bars_310': sum(1 for b in bundle.values() if b['bars'] and len(b['bars']) == 310),
                  'spy_bars_730d': sum(1 for b in spy if b['date'] >= start.isoformat()), 'sessions': len(sessions)}))
