"""Print actual NYSE close and close+one-hour target; no external mutations."""
import argparse
from datetime import date, datetime, timezone
import json

from app.services.close_price_contract import CloseSession
from app.services.market_calendar_service import MarketCalendarService


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", required=True, type=date.fromisoformat)
    parser.add_argument("--now", type=datetime.fromisoformat)
    args = parser.parse_args()
    session = CloseSession.for_us(args.session, MarketCalendarService())
    print(json.dumps(session.status(args.now or datetime.now(timezone.utc)), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
