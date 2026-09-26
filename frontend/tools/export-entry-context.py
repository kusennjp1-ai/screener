"""Fetch dated earnings-calendar evidence and the actual exchange-session clock.
Missing/ranged earnings dates stay unknown; never turn a fetch failure into safety.
"""
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor


def normalize_earnings(raw, today):
    dates = sorted({str(value)[:10] for value in (raw or {}).get('Earnings Date', [])})
    if len(dates) != 1:
        return None
    try:
        parsed = date.fromisoformat(dates[0])
    except (ValueError, TypeError):
        return None
    return dates[0] if today <= parsed <= today + timedelta(days=180) else None


def main():
    import yfinance as yf
    import pandas_market_calendars as mcal
    root = Path('public/static-data')
    manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    snapshot = manifest['as_of_date']
    now = datetime.now(timezone.utc)
    from zoneinfo import ZoneInfo
    today = now.astimezone(ZoneInfo('America/New_York')).date()
    schedule = mcal.get_calendar('NYSE').schedule(start_date=today-timedelta(days=14),end_date=today+timedelta(days=14))
    completed = schedule[schedule['market_close'] <= now]
    upcoming = schedule[schedule['market_close'] > now]
    calendar = {'source':'NYSE / pandas_market_calendars','evaluated_at':now.isoformat(),
        'latest_completed_session':str(completed.index[-1].date()),'valid_until':upcoming.iloc[0]['market_close'].isoformat()}
    research = json.loads(Path('public/research-daily.json').read_text(encoding='utf-8'))
    symbols = list(dict.fromkeys(r['symbol'] for method in ['minervini','ibd','minervini2'] for r in research.get('candidates',{}).get(method,[])))[:60]
    def fetch(symbol):
        try:
            raw = yf.Ticker(symbol).get_calendar()
            upcoming = normalize_earnings(raw,today)
            return symbol, {'date':upcoming,'source':'Yahoo Finance via yfinance calendar','checked_at':datetime.now(timezone.utc).isoformat(),'status':'available' if upcoming else 'unavailable_or_range'}
        except Exception:
            return symbol, {'date':None,'source':'Yahoo Finance via yfinance calendar','checked_at':datetime.now(timezone.utc).isoformat(),'status':'fetch_failed'}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = dict(pool.map(fetch,symbols))
    payload = {'as_of_date':snapshot,'calendar':calendar,'earnings':results,'coverage':{'requested':len(symbols),'available':sum(v['date'] is not None for v in results.values())}}
    (root/'entry-context.json').write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
    print(json.dumps(payload['coverage']))


if __name__ == '__main__':
    main()
