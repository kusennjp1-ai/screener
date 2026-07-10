---
name: diagnose-cache
description: Diagnose and repair the price/fundamentals cache pipeline (Redis DB 2 → PostgreSQL → API) using backend/scripts utilities. Use when scans return stale/empty data, a 409 market_data_stale appears, Redis keys look wrong, or orphaned scans accumulate.
---

# Cache & data-pipeline diagnostics

Utility scripts are in `backend/scripts/`:
```bash
cd backend
source venv/bin/activate

python scripts/inspect_redis.py            # Inspect Redis cache keys
python scripts/cache_diagnostic.py         # Trace cache flow (DB → Redis)
python scripts/check_cache_status.py       # Check price cache status
python scripts/clear_redis_price_cache.py  # Clear Redis cache after config change
python scripts/force_full_cache_refresh.py # Force full cache refresh
python scripts/cleanup_orphaned_scans.py   # Synchronously delete orphaned scans
```

Manual orphaned scan cleanup runs directly:
```bash
python scripts/cleanup_orphaned_scans.py
```

The Celery task `app.tasks.cache_tasks.cleanup_orphaned_scans` remains the scheduled background path and requires a live worker to execute.


## Freshness gate quick-check

Manual scans are cache-only and are rejected with 409 `market_data_stale`
when any resolved symbol's newest `stock_prices.date` is older than
`MarketCalendarService.last_completed_trading_day(market)`. Diagnose with:

```sql
select symbol, max(date) from stock_prices group by symbol order by 2 asc limit 20;
```
