"""NYSE session clock for acquisition scheduling; never infer a session from weekdays.

The two-minute acquisition grace is not a promise of finalized provider data.
https://www.nyse.com/markets/hours-calendars
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from zoneinfo import ZoneInfo


def calendar_at(now, calendar=None):
    import pandas_market_calendars as mcal
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('A timezone-aware evaluation clock is required')
    now = now.astimezone(timezone.utc)
    today = now.astimezone(ZoneInfo('America/New_York')).date()
    exchange = calendar or mcal.get_calendar('NYSE')
    schedule = exchange.schedule(start_date=today-timedelta(days=35), end_date=today+timedelta(days=35))
    completed = schedule[schedule.market_close <= now-timedelta(minutes=2)]
    upcoming = schedule[schedule.market_close > now-timedelta(minutes=2)]
    if completed.empty or upcoming.empty:
        raise ValueError('Calendar cannot establish completed and upcoming sessions')
    stamp = lambda value: value.isoformat().replace('+00:00', 'Z')
    closed = completed.iloc[-1].market_close.to_pydatetime()
    following = upcoming.iloc[0].market_close.to_pydatetime()
    return {
        'schema_version': 'postclose-session-clock-v1',
        'exchange': 'NYSE', 'provider': 'pandas_market_calendars', 'provider_version': mcal.__version__,
        'evaluated_at': stamp(now), 'target_session': completed.index[-1].date().isoformat(),
        'target_close': stamp(closed), 'eligible_at': stamp(closed+timedelta(minutes=2)),
        'next_session': upcoming.index[0].date().isoformat(),
        'next_close': stamp(following), 'next_eligible_at': stamp(following+timedelta(minutes=2)),
        'acquisition_grace_minutes': 2,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--now', help='Explicit UTC clock for reproducible read-only tests')
    args = parser.parse_args()
    now = datetime.fromisoformat(args.now.replace('Z', '+00:00')) if args.now else datetime.now(timezone.utc)
    print(json.dumps(calendar_at(now), separators=(',', ':')))
