"""Fetch sector ETF proxies and SPY together with an identical adjustment policy."""
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import math

def main():
    import yfinance as yf
    import pandas_market_calendars as mcal
    root=Path('public/static-data')
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    as_of=manifest['markets']['US']['as_of_date']
    target=date.fromisoformat(as_of)
    start=target-timedelta(days=240)
    schedule=mcal.get_calendar('NYSE').schedule(start_date=start,end_date=target)
    if schedule.empty or schedule.index[-1].date()!=target or schedule.iloc[-1]['market_close'].to_pydatetime()>datetime.now(timezone.utc):
        raise ValueError('Sector analysis date is not a completed trading session')
    expected=[t.date().isoformat() for t in schedule.index]
    result={'as_of_date':as_of,'retrieved_at':datetime.now(timezone.utc).isoformat(),'source':'Yahoo Finance via yfinance','adjustment':'split-adjusted-close-no-dividend','calendar':'NYSE','series':{},'errors':{}}
    for symbol in ['SPY','XLB','XLC','XLE','XLF','XLI','XLK','XLP','XLRE','XLU','XLV','XLY']:
        try:
            frame=yf.Ticker(symbol).history(start=start.isoformat(),end=(target+timedelta(days=1)).isoformat(),auto_adjust=False,actions=False,timeout=25)
            bars=[{'date':stamp.date().isoformat(),'close':round(float(row['Close']),6)} for stamp,row in frame.iterrows()]
            if [b['date'] for b in bars]!=expected or any(not math.isfinite(b['close']) or b['close']<=0 for b in bars):
                raise ValueError('Session coverage/price validation failed')
            result['series'][symbol]=bars
        except Exception as error:
            result['errors'][symbol]=str(error)
    # Failure replaces, rather than silently reusing, a stale optional series.
    (root/'sector-prices.json').write_text(json.dumps(result,ensure_ascii=False,allow_nan=False,separators=(',',':')),encoding='utf-8')
    print(f"Sector prices {as_of}: {len(result['series'])}/12 series; missing {list(result['errors'])}")

if __name__=='__main__': main()
