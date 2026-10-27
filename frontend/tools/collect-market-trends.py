#!/usr/bin/env python3
"""Collect dated index OHLCV and Cboe total option volume; no credentials/proxies.

Sources are retained with response hashes. Cboe's public server-rendered data is
parsed as JSON, never evaluated. A changed page schema fails closed. This is a
data producer, not the IBD editorial distribution-day count.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

CBOE = 'https://www.cboe.com/markets/us/options/market-statistics/daily'

def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=35) as response:
        raw = response.read()
    return raw, {'url': url, 'sha256': hashlib.sha256(raw).hexdigest(),
                 'retrieved_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}

def parse_cboe(raw, day):
    # Next Flight splits large JSON records across string frames. Join only the
    # JSON string values; neither HTML nor downloaded JavaScript is executed.
    frames = []
    for match in re.finditer(r'self\.__next_f\.push\((.*?)\)</script>', raw.decode('utf-8'), re.S):
        frame = json.loads(match.group(1))
        if len(frame) > 1 and isinstance(frame[1], str):
            frames.append(frame[1])
    content = ''.join(frames)
    start = content.index('"optionsData"') - 1
    payload, _ = json.JSONDecoder().raw_decode(content[start:])
    if payload['selectedDate'] != day:
        raise ValueError('Cboe returned a different observation date')
    volumes = [row for row in payload['optionsData']['SUM OF ALL PRODUCTS'] if row['name'] == 'VOLUME']
    if len(volumes) != 1:
        raise ValueError('Cboe total volume is not uniquely identified')
    row = volumes[0]
    if any(type(row[key]) is not int or row[key] < 0 for key in ('call', 'put', 'total')) or row['call'] <= 0 or row['call'] + row['put'] != row['total']:
        raise ValueError('Invalid Cboe total option volume')
    ratio = [item for item in payload['optionsData']['ratios'] if item['name'] == 'TOTAL PUT/CALL RATIO']
    if len(ratio) != 1 or abs(float(ratio[0]['value']) - row['put'] / row['call']) > .0051:
        raise ValueError('Cboe displayed ratio does not match its numerator/denominator')
    return {'date': day, 'calls': row['call'], 'puts': row['put'], 'reported_ratio': float(ratio[0]['value'])}


def reusable_cboe(row, day, now):
    """Reuse older dated observations, never yesterday's ratio for today."""
    try:
        proof=row['provenance'];url=urllib.parse.urlparse(proof['url'])
        stamp=datetime.fromisoformat(proof['retrieved_at'].replace('Z','+00:00'))
        return (row['date']==day and type(row['calls']) is int and row['calls']>0 and type(row['puts']) is int and row['puts']>=0
                and type(row['reported_ratio']) in (int,float) and math.isfinite(row['reported_ratio'])
                and abs(row['reported_ratio']-row['puts']/row['calls'])<=.0051
                and url.scheme=='https' and url.netloc=='www.cboe.com' and url.path=='/markets/us/options/market-statistics/daily'
                and urllib.parse.parse_qs(url.query)=={'dt':[day]} and re.fullmatch('[a-f0-9]{64}',proof['sha256']) is not None
                and stamp.tzinfo is not None and stamp<=now and stamp.date().isoformat()>=day)
    except (KeyError,TypeError,ValueError,OverflowError):return False

def collect(as_of, output, allow_unavailable=False):
    import pandas_market_calendars as mcal
    target = date.fromisoformat(as_of)
    now = datetime.now(timezone.utc)
    schedule = mcal.get_calendar('NYSE').schedule(start_date=target-timedelta(days=420), end_date=target)
    if schedule.empty or str(schedule.index[-1].date()) != as_of or schedule.iloc[-1]['market_close'].to_pydatetime() > now:
        raise ValueError('Target must be a completed exchange session')
    sessions = [str(item.date()) for item in schedule.index][-280:]
    destination = Path(output)
    previous = json.loads(destination.read_text(encoding='utf-8')) if destination.exists() else None
    if previous and (previous.get('schema_version') != 'market-trend-source-v1' or previous.get('market') != 'US' or previous.get('as_of_date', '') > as_of):
        raise ValueError('Existing market source identity/date is invalid')
    half_days = [str(day.date()) for day, row in schedule.iterrows() if (row['market_close']-row['market_open']).total_seconds() < 6.5*3600]
    result = {'schema_version': 'market-trend-source-v1', 'market': 'US', 'as_of_date': as_of,
              'calendar': {'provider': 'pandas_market_calendars', 'version': mcal.__version__, 'exchange': 'XNYS', 'sessions': sessions, 'half_days': half_days},
              'indices': [], 'put_call': {'population': 'Cboe SUM OF ALL PRODUCTS (not all US options exchanges)', 'observations': []}}
    # Publish exchange close clocks separately from observations. The browser can
    # identify a missed update after the next close even when this whole bundle
    # is old; a future calendar date never certifies a future price.
    upcoming=mcal.get_calendar('NYSE').schedule(start_date=target-timedelta(days=7),end_date=target+timedelta(days=45))
    result['refresh_schedule']={'provider':'pandas_market_calendars:NYSE','version':mcal.__version__,
                                'generated_at':now.isoformat(timespec='milliseconds').replace('+00:00','Z'),
                                'valid_until':datetime.combine(target+timedelta(days=46),datetime.min.time(),ZoneInfo('America/New_York')).astimezone(timezone.utc).isoformat().replace('+00:00','Z'),
                                'sessions':[{'date':str(day.date()),'close_at':row['market_close'].isoformat().replace('+00:00','Z')} for day,row in upcoming.iterrows()]}
    for symbol in ('^GSPC', '^IXIC'):
        start = int(datetime.fromisoformat(sessions[0]).replace(tzinfo=timezone.utc).timestamp())
        end = int(datetime.combine(target+timedelta(days=1), datetime.min.time(), timezone.utc).timestamp())
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?period1={start}&period2={end}&interval=1d'
        try:
            raw, provenance = fetch(url)
            data = json.loads(raw)['chart']['result'][0]
            if data['meta']['symbol'] != symbol or data['meta']['instrumentType'] != 'INDEX':
                raise ValueError('Index identity mismatch')
            quote = data['indicators']['quote'][0]
            bars = []
            for i, stamp in enumerate(data['timestamp']):
                day = datetime.fromtimestamp(stamp, ZoneInfo('America/New_York')).date().isoformat()
                if day > as_of:
                    continue
                bar = {'date': day, **{key: quote[key][i] for key in ('open','high','low','close','volume')}}
                if not all(type(bar[key]) in (int,float) and math.isfinite(bar[key]) and bar[key] > 0 for key in ('open','high','low','close','volume')):
                    raise ValueError(f'Invalid index bar {day}')
                bars.append(bar)
            if [bar['date'] for bar in bars] != sessions:
                raise ValueError('Index dates differ from independent exchange calendar')
            result['indices'].append({'symbol': symbol, 'source': 'Yahoo Finance index OHLCV', 'volume_basis': 'Provider index volume; not independently reconciled to IBD exchange turnover', 'provenance': provenance, 'bars': bars, 'calendar_sessions': sessions})
        except Exception as error:
            if not allow_unavailable:
                raise
            retained = next((item for item in (previous or {}).get('indices', []) if item.get('symbol') == symbol), None)
            if retained and retained.get('bars'):
                result['indices'].append({**retained, 'calendar_sessions': retained.get('calendar_sessions', previous['calendar']['sessions']), 'unavailable_reason': str(error), 'retained_after_fetch_failure': True})
            else:
                result['indices'].append({'symbol': symbol, 'bars': [], 'unavailable_reason': str(error)})
    def one(day):
        url = CBOE + '?dt=' + day
        retained = next((item for item in (previous or {}).get('put_call', {}).get('observations', []) if reusable_cboe(item,day,now)), None)
        # Refresh three recent sessions for delayed/corrected exchange data.
        # Earlier verified observations and their original timestamps are kept,
        # reducing the routine path from 63 Cboe pages to three plus any gaps.
        if retained and day < sessions[-3]:return retained
        try:
            raw, provenance = fetch(url)
            return {**parse_cboe(raw, day), 'provenance': provenance}
        except Exception as error:
            if not allow_unavailable:
                raise
            if retained:
                return {**retained, 'retained_after_fetch_failure': True}
            return {'date': day, 'calls': None, 'puts': None, 'reported_ratio': None, 'unavailable_reason': str(error)}
    with ThreadPoolExecutor(max_workers=3) as executor:
        refreshed = list(executor.map(one, sessions[-63:]))
    # Retain earlier verified observations as history, without copying their
    # value to a later date. The recent three sessions and gaps are refreshed; the retained
    # source can accumulate up to one year (252 actual exchange sessions).
    older = [item for item in (previous or {}).get('put_call', {}).get('observations', [])
             if sessions[-252] <= item.get('date', '') < sessions[-63]]
    result['put_call']['observations'] = older + refreshed
    path = destination
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(',', ':'))+'\n', encoding='utf-8')
    print(json.dumps({'path': str(path), 'as_of': as_of, 'indices': [(x['symbol'],len(x['bars'])) for x in result['indices']], 'put_call_observations': sum(x['calls'] is not None for x in result['put_call']['observations'])}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--as-of')
    parser.add_argument('--output', default='public/static-data/market-trend-source.json')
    parser.add_argument('--allow-unavailable', action='store_true')
    args = parser.parse_args()
    target = args.as_of
    if not target:
        manifest = json.loads(Path('public/static-data/manifest.json').read_text(encoding='utf-8'))
        target = manifest.get('markets', {}).get('US', manifest)['as_of_date']
    collect(target, args.output, args.allow_unavailable)
