"""Snapshot step B: replay frontend/tools/recalculate-setups.py (main 8849bf9) on the rebuilt charts.

The functions validate/frame/benchmark_frame/recalculate are imported from the archived tool itself, so the
Setup Engine, the Minervini technicals, the RS universe and the +-25% pivot clear are the publication's code.
Only the inputs differ from CI: bundle bars instead of the CI price cache, and the bundle's SPY instead of
yfinance's (both auto_adjust=False closes).

variant 'strict': bars only for symbols the CI seed import accepted (bundle bars == CI DB bars).
variant 'proxy' : also symbols the seed import rejected as invalid_ohlcv (CI refilled them from Yahoo at run time,
                  which this sandbox cannot reach); their bundle bars are used with each bar's high/low widened
                  to cover its own open/close (closes and volumes untouched). Counting only; flagged per row.
"""
import importlib.util, json, math, sys, time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

SRC = Path(sys.argv[1]); WORK = Path(sys.argv[2]); VARIANT = sys.argv[3]
spec = importlib.util.spec_from_file_location('recalc_tool', SRC / 'frontend/tools/recalculate-setups.py')
tool = importlib.util.module_from_spec(spec); sys.modules['recalc_tool'] = tool; spec.loader.exec_module(tool)
import pandas as pd
from app.scanners.criteria.relative_strength import RelativeStrengthCalculator
AS_OF = '2026-11-12'


def envelope(bars):
    out = []
    for b in bars:
        o, h, l, c = b['open'], b['high'], b['low'], b['close']
        out.append({**b, 'high': max(o, h, c, l), 'low': min(o, l, c, h)})
    return out


def choose(rec):
    b = rec.get('bundle'); bars = rec.get('bars')
    if not b or not bars: return None, 'no_bundle_bars'
    if b['seed_ok']: return bars, 'bundle_seed_accepted'
    if VARIANT == 'proxy' and b['seed_reason'] == 'invalid_ohlcv':
        return envelope(bars), 'bundle_envelope_proxy'
    return None, f"bundle_seed_rejected:{b['seed_reason']}"


def native(o):
    if isinstance(o, dict): return {k: native(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [native(v) for v in o]
    if hasattr(o, 'item'): return o.item()
    if isinstance(o, float) and not math.isfinite(o): return None
    return o


def work(task):
    symbol, bars, basis, failure = task
    row = {'symbol': symbol}
    meta = {'as_of_date': AS_OF, 'bars_basis': basis}
    try:
        if not bars: raise ValueError(failure or 'No validated history')
        payload = tool.recalculate(row, bars, tool.WORKER_BENCHMARK, tool.WORKER_UNIVERSE)
        meta.update(status='calculated', reason=' / '.join(payload.get('explain', {}).get('failed_checks') or []) or 'Production detector report available')
    except Exception as error:
        tool.clear_setup(row); meta.update(status='unavailable', reason=str(error))
        for key in list(row):
            if key.startswith(('ma_', 'ema_', 'perf_', 'beta', 'rs_', 'price_sparkline', 'price_trend')) or key in ('passes_template', 'stage', 'stage_name', 'adr_percent', 'pocket_pivot', 'power_trend', 'gap_percent', 'volume_surge'):
                row[key] = None
    row['setup_recalculation'] = meta
    row.pop('price_sparkline_data', None)
    return native(row)


def main():
    recs = [json.loads(l) for l in open(WORK / 'rows_in.jsonl')]
    benchmark = tool.benchmark_frame(json.load(open(WORK / 'benchmark.json')), AS_OF)
    prices, failures, basis = {}, {}, {}
    for r in recs:
        bars, why = choose(r); basis[r['symbol']] = why
        try:
            if bars is None: raise ValueError(why)
            tool.validate(bars, AS_OF); prices[r['symbol']] = bars
        except (KeyError, ValueError) as e:
            failures[r['symbol']] = str(e)
    calc = RelativeStrengthCalculator(); benchmark_rev = benchmark.Close.iloc[::-1].reset_index(drop=True)
    perf = [calc.calculate_weighted_performance(pd.Series([b['close'] for b in bars][::-1]), benchmark_rev) for bars in prices.values()]
    universe = {'weighted': [n for n in perf if n is not None and math.isfinite(n)]}
    for period in (21, 63, 252):
        br = calc.calculate_return(benchmark_rev, period); universe[period] = []
        for bars in prices.values():
            sr = calc.calculate_return(pd.Series([b['close'] for b in bars][::-1]), period)
            if sr is not None and br is not None: universe[period].append(sr - br)
    tasks = [(r['symbol'], prices.get(r['symbol']), basis[r['symbol']], failures.get(r['symbol'])) for r in recs]
    started = time.monotonic(); out = []
    with ProcessPoolExecutor(max_workers=4, initializer=tool.worker_init, initargs=(benchmark, universe)) as pool:
        for row in pool.map(work, tasks, chunksize=8):
            out.append(row)
            if len(out) % 500 == 0: print(f'{len(out)}/{len(tasks)} {time.monotonic()-started:.0f}s', flush=True)
    with open(WORK / f'recalc-{VARIANT}.jsonl', 'w') as o:
        for row in out: o.write(json.dumps(row, allow_nan=False) + '\n')
    calc_n = sum(r['setup_recalculation']['status'] == 'calculated' for r in out)
    print(json.dumps({'variant': VARIANT, 'rows': len(out), 'valid_charts': len(prices), 'calculated': calc_n,
                      'rs_universe_weighted': len(universe['weighted']), 'seconds': round(time.monotonic() - started)}))


if __name__ == '__main__':
    main()
