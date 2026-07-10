---
name: sandbox-e2e
description: Stand up the FULL screener stack inside the Claude sandbox (Postgres+Redis+uvicorn+celery+vite), seed real fixture data, run a real scan end-to-end, and browser-verify with Playwright screenshots at 1440px/375px. Use for browser verification of UI changes, reproducing scan-pipeline bugs, or any "see it actually work" request.
---

# Full-stack E2E inside the sandbox

Postgres 16 + Redis are INSTALLED but stopped in the sandbox. Chromium lives
at `/opt/pw-browsers/chromium` (symlink to the real binary — installed
playwright versions may want a newer build; pass `executablePath` explicitly).

## Bring-up (order matters)

```bash
service postgresql start; redis-server --daemonize yes
sudo -u postgres psql -c "CREATE USER stockscanner WITH PASSWORD 'stockscanner' CREATEDB"
sudo -u postgres psql -c "CREATE DATABASE stockscanner OWNER stockscanner"
cd backend && DATABASE_URL=postgresql://stockscanner:stockscanner@localhost:5432/stockscanner \
  python3 -m alembic upgrade head

# Seed 13 near-current tickers (prices via the cache's own write path):
DATABASE_URL=... REDIS_HOST=localhost PYTHONPATH=. \
  python3 scripts/seed_from_realdata.py --data-dir tests/fixtures/markets360

# Backend — auth OFF + freshness gate OFF (fixture data lags today):
DATABASE_URL=... REDIS_HOST=localhost SERVER_AUTH_ENABLED=false \
  SCAN_FRESHNESS_GATE_ENABLED=false CORS_ORIGINS=http://localhost:5173 \
  setsid nohup python3 -m uvicorn app.main:app --port 8000 > /tmp/uvicorn.log 2>&1 &

# Celery — ONE worker on all scan queues:
DATABASE_URL=... REDIS_HOST=localhost CELERY_BROKER_URL=redis://localhost:6379/0 \
  CELERY_RESULT_BACKEND=redis://localhost:6379/1 SCAN_FRESHNESS_GATE_ENABLED=false \
  setsid nohup python3 -m celery -A app.celery_app worker --pool=solo \
  -Q celery,data_fetch,user_scans_us,user_scans_shared,market_jobs_us > /tmp/celery.log 2>&1 &

# Frontend (Node 22 already on PATH at /opt/node22 — NO NVM in this sandbox):
cd frontend && setsid nohup npm run dev > /tmp/vite.log 2>&1 &
```

Kick a scan directly: `POST http://localhost:8000/api/v1/scans` with
`{"universe":"market:US","screeners":[...],"composite_method":"weighted_average","criteria":{...}}`;
poll `GET /api/v1/scans?limit=1` to terminal state; results at
`GET /api/v1/scans/{id}/results`.

## Gotchas that cost hours

- **`pkill` can kill your own shell** (exit 144) and leave targets alive —
  always relaunch with `setsid`, and verify with `ps aux | grep -c '[c]elery'`.
- **Stale bytecode**: a celery worker started before a code edit keeps running
  OLD code; the traceback shows NEW source lines with OLD errors. `pkill -9 -f
  celery` then restart after every backend change.
- **Redis restart empties the price cache** → celery falls back to yfinance
  (blocked, 403) and the scan dies in retries. Re-run seed_from_realdata to
  rewarm, and keep SCAN_FRESHNESS_GATE_ENABLED=false (routes reads through
  `get_many_cached_only`, zero network).
- Missing pip deps at boot (feedparser needs sgmllib3k — pip build fails;
  copy `sgmllib.py` from the sdist into site-packages, then
  `pip install --no-deps feedparser`), plus scipy/litellm/uvicorn as needed.
- Vitest must run from `frontend/` (root cwd loses the config).

## Playwright verification

```js
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// desktop: {width:1440,height:900}; mobile: {width:375,height:812,isMobile:true}
```

The script FILE must live inside `frontend/` (copy in, run, delete) — ESM
resolves `playwright` from the script's own path, not the cwd, so a
scratchpad-located script throws ERR_MODULE_NOT_FOUND even with cwd=frontend.

MUI Select interaction: click `[role="combobox"]`, then click
`[role="option"]` by text (Market → "United States", Universe → "All United
States"). The SCAN button enables only after BOTH are chosen. Screenshot
before/after every visual change and LOOK at the images — never claim a CSS
fix without rendering it.
