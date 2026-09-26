"""Current reported financial history, separate from point-in-time SEC evidence.

Do not invent filing dates, adjusted EPS, missing years or Q4 EPS by subtraction.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path


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
    # Do not require IBD qualification before acquiring the history required
    # for that very qualification. Include rows missing only this evidence.
    rules = (methods.get('ibd') or {}).get('rules', [])
    other_rules = [r for r in rules if '3年' not in r.get('label', '')]
    return bool(other_rules) and all(r.get('state') == 'pass' for r in other_rules)


def main():
    import yfinance as yf
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=200)
    args = parser.parse_args()
    root = Path('public/static-data')
    audit = json.loads(Path('public/qualification-audit.json').read_text(encoding='utf-8'))
    as_of = audit['as_of_date']
    eligible = [r['symbol'] for r in audit['results'] if needs_history(r)]
    symbols = eligible[:max(0, min(args.limit, 300))]
    results = {}

    def fetch(symbol):
        item = {'symbol': symbol, 'as_of_date': as_of, 'retrieved_at': datetime.now(timezone.utc).isoformat(),
                'source': 'Yahoo Finance via yfinance', 'source_url': f'https://finance.yahoo.com/quote/{symbol}/financials/',
                'basis': 'reported_diluted_eps', 'point_in_time': False,
                'limitations': ['取得時点の報告財務。分析日当時の公表確認・提出日時は未検証',
                                '調整後EPSではない。欠損年・Q4を補間しない']}
        try:
            ticker = yf.Ticker(symbol)
            item['annual'] = normalize_frame(ticker.get_income_stmt(freq='yearly'), as_of)
            item['quarterly'] = normalize_frame(ticker.get_income_stmt(freq='quarterly'), as_of)
            # Trading currency must not stand in for the reporting currency.
            item['currency'] = ticker.get_info().get('financialCurrency')
            item['status'] = 'available' if item['annual'] or item['quarterly'] else 'unavailable'
        except Exception as error:
            item.update(status='unavailable', error=type(error).__name__)
        return symbol, item

    with ThreadPoolExecutor(max_workers=2) as pool:
        for symbol, result in pool.map(fetch, symbols):
            results[symbol] = result
    payload = {'as_of_date': as_of, 'results': results, 'coverage': {
        'eligible': len(eligible), 'requested': len(symbols), 'available': sum(v['status'] == 'available' for v in results.values()),
        'four_annual_eps': sum(len(v.get('annual', [])) >= 4 and all(p['eps'] is not None for p in v['annual'][-4:]) for v in results.values())}}
    (root/'financial-history.json').write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    print('Current financial history: ' + json.dumps(payload['coverage']), flush=True)


if __name__ == '__main__':
    main()
