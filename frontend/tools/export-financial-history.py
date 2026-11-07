"""Current reported financial history, separate from point-in-time SEC evidence.

Do not invent filing dates, adjusted EPS, missing years or Q4 EPS by subtraction.
"""
import argparse
from datetime import date, datetime, timezone
import importlib.util
import json
import math
from pathlib import Path

# One thread-safe limiter for every provider: the SEC tool's (calls at least 1/rate seconds apart).
_spec = importlib.util.spec_from_file_location("sec_financials", Path(__file__).with_name("sec-financials.py"))
_sec = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_sec)
RateLimiter = _sec.RateLimiter

# Self-imposed Yahoo limit: one provider call per second, one worker.
YAHOO_RPS = 1.0
DEPTH_BUCKETS = ('0', '1-4', '5', '6-7', '8+')


def depth_bucket(count):
    return '0' if count <= 0 else '1-4' if count <= 4 else '5' if count == 5 else '6-7' if count <= 7 else '8+'


def quarterly_depth(results):
    """How many quarters Yahoo returned per symbol (measured, never filled)."""
    counts = dict.fromkeys(DEPTH_BUCKETS, 0)
    for value in results.values():
        counts[depth_bucket(len(value.get('quarterly') or []))] += 1
    return counts


def number(value):
    try:
        return float(value) if not isinstance(value, bool) and math.isfinite(float(value)) else None
    except (TypeError, ValueError):
        return None


def normalize_frame(frame, as_of):
    result = []
    if frame is None or frame.empty:
        return result
    for column in sorted(frame.columns):
        end = str(column)[:10]
        if date.fromisoformat(end) > date.fromisoformat(as_of):
            continue
        row = {'end': end}
        for key, metric in [('eps', 'DilutedEPS'), ('revenue', 'TotalRevenue'), ('netIncome', 'NetIncome')]:
            row[key] = number(frame.loc[metric, column]) if metric in frame.index else None
        result.append(row)
    return result


def needs_history(row):
    methods = row.get('methods', {})
    if any((methods.get(method) or {}).get('qualified') for method in ['minervini', 'minervini2', 'ibd']):
        return True
    # The daily brief also lists trend-template rows one condition short with nothing unknown.
    minervini = methods.get('minervini') or {}
    if minervini.get('failed') == 1 and minervini.get('unknown') == 0:
        return True
    # Do not require IBD qualification before acquiring the history required
    # for that very qualification. Include rows missing only this evidence.
    rules = (methods.get('ibd') or {}).get('rules', [])
    other_rules = [r for r in rules if '3年' not in r.get('label', '')]
    return bool(other_rules) and all(r.get('state') == 'pass' for r in other_rules)


def listed(row):
    """A row the daily brief lists for the trend template: qualified, or one condition short with nothing unknown."""
    minervini = (row.get('methods') or {}).get('minervini') or {}
    return bool(minervini.get('qualified')) or (minervini.get('failed') == 1 and minervini.get('unknown') == 0)


def without_sec_quarters(sec, as_of):
    """Symbols whose same-day SEC record carries no quarters (unavailable), or None when there is no same-day SEC file."""
    if not isinstance(sec, dict) or sec.get('as_of_date') != as_of or not isinstance(sec.get('results'), dict):
        return None
    return {symbol for symbol, record in sec['results'].items() if not (isinstance(record, dict) and record.get('status') in ('available', 'partial'))}


def ordered_targets(audit, sec):
    """The rows that need a history, the brief's listed rows without SEC quarters first (their only
    reference is Yahoo), then every other row in the audit's order. Without a same-day SEC file the
    order is unchanged. A listed row missing from the SEC file has no SEC quarters either."""
    as_of = audit['as_of_date']
    eligible = [r for r in audit['results'] if needs_history(r)]
    no_sec = without_sec_quarters(sec, as_of)
    if no_sec is None:
        return [r['symbol'] for r in eligible], 0
    first = [r['symbol'] for r in eligible if listed(r) and (r['symbol'] in no_sec or r['symbol'] not in sec['results'])]
    chosen = set(first)
    return first + [r['symbol'] for r in eligible if r['symbol'] not in chosen], len(first)


def read_sec(root):
    import gzip
    for name in ('book-financials.json.gz', 'book-financials.json'):
        path = root / name
        if path.exists():
            raw = path.read_bytes()
            return json.loads(gzip.decompress(raw) if name.endswith('.gz') else raw)
    return None


def fetch(symbol, as_of, ticker_factory, limiter):
    """One symbol; each of the three provider calls first takes a limiter slot."""
    item = {'symbol': symbol, 'as_of_date': as_of, 'retrieved_at': datetime.now(timezone.utc).isoformat(),
            'source': 'Yahoo Finance via yfinance', 'source_url': f'https://finance.yahoo.com/quote/{symbol}/financials/',
            'basis': 'reported_diluted_eps', 'point_in_time': False,
            'limitations': ['取得時点の報告財務。分析日当時の公表確認・提出日時は未検証',
                            '調整後EPSではない。欠損年・Q4を補間しない']}
    try:
        ticker = ticker_factory(symbol)
        limiter.wait()
        item['annual'] = normalize_frame(ticker.get_income_stmt(freq='yearly'), as_of)
        limiter.wait()
        item['quarterly'] = normalize_frame(ticker.get_income_stmt(freq='quarterly'), as_of)
        # Trading currency must not stand in for the reporting currency.
        limiter.wait()
        item['currency'] = ticker.get_info().get('financialCurrency')
        item['status'] = 'available' if item['annual'] or item['quarterly'] else 'unavailable'
    except Exception as error:
        item.update(status='unavailable', error=type(error).__name__)
    return item


def collect(symbols, as_of, ticker_factory, limiter):
    # One worker: requests stay sequential and at most YAHOO_RPS per second.
    return {symbol: fetch(symbol, as_of, ticker_factory, limiter) for symbol in symbols}


def coverage(results, eligible, requested):
    # The file keeps its four-counter contract (prepare-carry-history writes the same
    # one for --limit 0); the quarterly depth is reported in the log line only.
    return {'eligible': eligible, 'requested': requested, 'available': sum(v['status'] == 'available' for v in results.values()),
            'four_annual_eps': sum(len(v.get('annual', [])) >= 4 and all(p['eps'] is not None for p in v['annual'][-4:]) for v in results.values())}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=200)
    args = parser.parse_args()
    root = Path('public/static-data')
    audit = json.loads(Path('public/qualification-audit.json').read_text(encoding='utf-8'))
    as_of = audit['as_of_date']
    try:
        sec = read_sec(root)
    except (OSError, ValueError) as error:
        print(f'Current financial history: SEC file unreadable ({type(error).__name__}); the audit order is kept', flush=True)
        sec = None
    # Listed rows without SEC quarters first, within the same limit.
    eligible, no_sec_first = ordered_targets(audit, sec)
    symbols = eligible[:max(0, min(args.limit, 500))]
    results = {}
    if symbols:
        import yfinance as yf
        results = collect(symbols, as_of, yf.Ticker, RateLimiter(YAHOO_RPS))
    payload = {'as_of_date': as_of, 'results': results, 'coverage': coverage(results, len(eligible), len(symbols))}
    (root/'financial-history.json').write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    print('Current financial history: ' + json.dumps({**payload['coverage'], 'listed_without_sec_first': no_sec_first, 'listed_without_sec_requested': min(no_sec_first, len(symbols)),
        'quarterly_depth': quarterly_depth(results)}), flush=True)


if __name__ == '__main__':
    main()
