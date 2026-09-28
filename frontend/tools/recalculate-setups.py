"""Run the production SetupEngineScanner on validated publication histories.

Results are keyed by a hash of the actual OHLCV input and engine source. Never
reuse pre-repair pivots or detector decisions after an error.
"""
import argparse
from datetime import date, datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sys
import time
from concurrent.futures import ProcessPoolExecutor

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'backend'))
import pandas as pd
import numpy as np
from app.scanners.setup_engine_screener import SetupEngineScanner
from app.scanners.base_screener import StockData
from app.scanners.minervini_scanner import MinerviniScanner
from app.scanners.criteria.relative_strength import RelativeStrengthCalculator

ROOT = REPO / 'frontend/public/static-data'


def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


def write(path, value):
    (ROOT / path).write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'), default=native_scalar), encoding='utf-8')


def native_scalar(value):
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(f'Unsupported export type: {type(value).__name__}')


def validate(bars, as_of):
    if len(bars) < 252 or bars[-1]['date'] != as_of:
        raise ValueError('252 sessions / final session mismatch')
    for i, b in enumerate(bars):
        day = date.fromisoformat(b['date'])
        if day.weekday() > 4 or not all(isinstance(b.get(k), (int, float)) and math.isfinite(b[k]) for k in ('open','high','low','close','volume')):
            raise ValueError('Invalid date / OHLCV')
        if b['low'] <= 0 or b['volume'] < 0 or b['high'] < max(b['open'], b['close'], b['low']) or b['low'] > min(b['open'], b['close']):
            raise ValueError('Incoherent OHLCV')
        if i and (b['date'] <= bars[i-1]['date'] or not .55 < b['close'] / bars[i-1]['close'] < 1.8):
            raise ValueError('Order / split discontinuity')


def frame(bars):
    data = pd.DataFrame(bars).rename(columns={k:k.title() for k in ['open','high','low','close','volume']})
    data.index = pd.to_datetime(data.pop('date'))
    return data


def clear_setup(row):
    for key in list(row):
        if key.startswith(('se_', 'vcp_')):
            row[key] = None
    row.update(se_setup_ready=False, vcp_detected=False, vcp_ready_for_breakout=False)
    row.pop('method_summary', None)
    row.pop('setup_engine', None)
    # These decisions were derived from a different history by other scanners.
    # Do not present them as current when only SE / Minervini was recomputed.
    for key in ('rating', 'rating_explanation', 'execution_state', 'execution_state_reason',
                'risk_plan', 'signal', 'buy_signal', 'breakout_signal'):
        if key in row:
            row[key] = None


def recalculate(row, bars, benchmark, universe):
    clear_setup(row)
    data = StockData(symbol=row['symbol'], price_data=frame(bars), benchmark_data=benchmark,
                     fundamentals={}, market='US', currency='USD', rs_universe_performances=universe)
    result = SetupEngineScanner().scan_stock(row['symbol'], data)
    payload = result.details.get('setup_engine')
    if not payload or result.rating in ('Error', 'Insufficient Data'):
        raise ValueError('Setup Engine did not return a complete report')
    for key, value in payload.items():
        if not isinstance(value, (dict, list)):
            row['se_' + key] = value
    row['setup_engine'] = payload
    # Refresh trend, VCP and price-derived scan columns with the existing scanner.
    technical = MinerviniScanner().scan_stock(row['symbol'], data)
    if technical.rating == 'Error':
        raise ValueError('Minervini technical calculation failed')
    for key, value in technical.details.items():
        if key.startswith(('vcp_', 'ma_', 'ema_', 'perf_', 'beta', 'rs_')) or key in ('passes_template','stage','stage_name','adr_percent','price_change_1d','price_sparkline_data','price_trend','pocket_pivot','power_trend','gap_percent','volume_surge'):
            row[key] = value
    # One canonical pivot. A legacy VCP candidate cannot override the selected SE
    # pattern; absence of a production pivot stays unknown across all surfaces.
    pivot = payload.get('pivot_price')
    if pivot and abs(bars[-1]['close']/pivot-1) > .25:
        pivot = None
        row['se_pivot_price'] = None
        row['se_distance_to_pivot_pct'] = None
        row['se_setup_ready'] = False
    row['vcp_pivot'] = pivot
    row['vcp_ready_for_breakout'] = bool(row.get('vcp_detected') and row.get('se_setup_ready'))
    row['current_price'] = bars[-1]['close']
    row['adv_usd'] = sum(b['close']*b['volume'] for b in bars[-50:]) / 50
    row['volume'] = int(sum(b['volume'] for b in bars[-50:]) / 50) * bars[-1]['close']
    return payload


def worker_init(benchmark, universe):
    global WORKER_BENCHMARK, WORKER_UNIVERSE
    WORKER_BENCHMARK, WORKER_UNIVERSE = benchmark, universe


def worker_calculate(task):
    row,bars,metadata,failure=task
    clear_setup(row)
    try:
        if not bars: raise ValueError(failure or 'No validated history')
        payload=recalculate(row,bars,WORKER_BENCHMARK,WORKER_UNIVERSE)
        metadata.update(status='calculated',reason=' / '.join(payload.get('explain',{}).get('failed_checks') or []) or 'Production detector report available')
    except Exception as error:
        clear_setup(row);metadata.update(status='unavailable',reason=str(error))
        for key in list(row):
            if key.startswith(('ma_', 'ema_', 'perf_', 'beta', 'rs_', 'price_sparkline', 'price_trend')) or key in ('passes_template','stage','stage_name','adr_percent','pocket_pivot','power_trend','gap_percent','volume_surge'):
                row[key] = None
    row['setup_recalculation']=metadata
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--symbols', nargs='*')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    manifest = read('manifest.json'); market = manifest.get('markets', {}).get('US', manifest)
    scan = read(market['pages']['scan']['path']); as_of = scan['as_of_date']
    chunks = [(c['path'], read(c['path'])) for c in scan['chunks']]
    rows = {r['symbol']: r for r in [*scan['initial_rows'], *(r for _, p in chunks for r in p['rows'])]}
    paths = {r['symbol']: r['path'] for r in read(market['assets']['charts']['path'])['symbols']}
    benchmark = frame(read('book-benchmark.json')['bars'])
    engine_files = [*(REPO/'backend/app/analysis/patterns').rglob('*.py'), *(REPO/'backend/app/scanners').rglob('*.py')]
    engine_hash = hashlib.sha256(Path(__file__).read_bytes()+b''.join(p.read_bytes() for p in sorted(engine_files))).hexdigest()
    prices, failures = {}, {}
    for symbol in rows:
        try:
            chart = read(paths[symbol])
            if chart['symbol'] != symbol or chart['as_of_date'] != as_of: raise ValueError('Identity mismatch')
            validate(chart['bars'], as_of)
            prices[symbol] = chart['bars']
        except (KeyError, ValueError, OSError) as error:
            failures[symbol] = str(error)
    calc = RelativeStrengthCalculator(); benchmark_rev = benchmark.Close.iloc[::-1].reset_index(drop=True)
    performances = [calc.calculate_weighted_performance(pd.Series([b['close'] for b in bars][::-1]), benchmark_rev) for bars in prices.values()]
    universe = {'weighted': [n for n in performances if n is not None and math.isfinite(n)]}
    for period in (21,63,252):
        benchmark_return=calc.calculate_return(benchmark_rev,period)
        universe[period]=[]
        for bars in prices.values():
            stock_return=calc.calculate_return(pd.Series([b['close'] for b in bars][::-1]),period)
            if stock_return is not None and benchmark_return is not None:
                universe[period].append(stock_return-benchmark_return)
    context_hash=hashlib.sha256(json.dumps({'universe':universe,'benchmark':benchmark.to_json()}).encode()).hexdigest()
    report = []; started = time.monotonic(); tasks=[]
    for symbol, row in rows.items():
        if args.symbols and symbol not in args.symbols: continue
        bars = prices.get(symbol)
        input_hash = hashlib.sha256(json.dumps(bars, sort_keys=True).encode()).hexdigest()
        prior = row.get('setup_recalculation', {})
        if prior.get('input_sha256') == input_hash and prior.get('engine_sha256') == engine_hash and prior.get('context_sha256') == context_hash and prior.get('status') == 'calculated':
            report.append({'symbol':symbol, **prior}); continue
        metadata = {'as_of_date':as_of, 'input_sha256':input_hash, 'engine_sha256':engine_hash, 'context_sha256':context_hash,'calculated_at':datetime.now(timezone.utc).isoformat()}
        tasks.append((row,bars,metadata,failures.get(symbol)))
    with ProcessPoolExecutor(max_workers=args.workers,initializer=worker_init,initargs=(benchmark,universe)) as pool:
        for row in pool.map(worker_calculate,tasks,chunksize=8):
            symbol=row['symbol'];rows[symbol]=row
            if symbol in paths:
                chart=read(paths[symbol]);chart['stock_data']=row
                chart.update(signal=None,risk_plan=None,vcp_boxes=[])
                write(paths[symbol],chart)
            report.append({'symbol':symbol,**row['setup_recalculation']})
            if len(report)%100==0:print(f'Setup recalculation {len(report)}/{len(rows)} ({time.monotonic()-started:.0f}s)',flush=True)
    scan['initial_rows'] = [rows[r['symbol']] for r in scan['initial_rows']]; write(market['pages']['scan']['path'], scan)
    for path, chunk in chunks:
        chunk['rows'] = [rows[r['symbol']] for r in chunk['rows']]; write(path, chunk)
    write('setup-recalculation-report.json', {'as_of_date':as_of, 'engine_sha256':engine_hash, 'results':report})
    print(f'Setups: {sum(r["status"]=="calculated" for r in report)}/{len(report)} calculated', flush=True)


if __name__ == '__main__':
    main()
