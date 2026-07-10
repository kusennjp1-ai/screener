# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stock screening platform implementing CANSLIM (William O'Neil) and Minervini methodologies, with theme discovery, AI chatbot, and market analysis. Full-stack application with FastAPI backend, React frontend, PostgreSQL, Redis caching, and Celery for background tasks.

**Companion docs (read when relevant):**
- `docs/STATE.md` — the NOW snapshot for the Minervini improvement loop (current cycle, live metric values, next actions, absolute constraints). **Read first when resuming loop work**; overwritten whole each cycle. History: `docs/PROGRESS.md`, spec: `docs/SPEC.md`.
- `CONTEXT.md` — canonical domain vocabulary (Market, MIC, universe, snapshot…). Use these exact terms in code, plans, and reviews.
- `AGENTS.md` — issue tracking via **bd (beads)**: `bd ready` → claim → `bd close`. Check it before inventing ad-hoc TODO lists.
- `trading-skills/` — vendored skill library with its own `CLAUDE.md`; treat it as a sub-project.

## Model & Context Policy

- **Exploration/search** (find code, sweep files): delegate to a read-only subagent — keep transcripts out of the main context.
- **Implementation**: default session model. **Design/audit/hard debugging**: strongest available model with higher effort.
- Heavy outputs (test logs, scans, large diffs) belong in subagents or files, not the main conversation. Prefer `/compact` at natural milestones in long sessions.
- Procedures live in `.claude/skills/` (invoke on demand); only always-true facts belong in this file.

## Development Commands

### Backend
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm run dev      # Vite dev server on :5173
npm run build    # Production build
npm run lint     # ESLint
```

### Celery Workers (required for scans)
```bash
cd backend
./start_celery.sh    # Starts both queues

# Or manually:
./venv/bin/celery -A app.celery_app worker --pool=solo -Q celery -n general@%h
./venv/bin/celery -A app.celery_app worker --pool=solo -Q data_fetch -n datafetch@%h
./venv/bin/celery -A app.celery_app beat --loglevel=info  # Scheduler
```

### Docker Deployment

Three compose scenarios (local / homelab / VPS+HTTPS). Invoke the `deploy`
skill (`.claude/skills/deploy/`) for the full commands, overlay files, and
the non-root `chown` note.

### Running Tests

#### Backend (pytest)
```bash
cd backend
source venv/bin/activate

# Run all tests
pytest

# Run unit tests only
pytest tests/unit/

# Run integration tests (requires running server at localhost:8000)
pytest tests/integration/ -m integration

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/unit/test_canslim_scanner.py
```

#### Frontend (Vitest + React Testing Library)
```bash
cd frontend

# Run all tests once (CI mode)
npm run test:run

# Run tests in watch mode (development)
npm run test

# Run a specific test file
npx vitest run src/components/Scan/ResultsTable.test.jsx

# Lint test files
npm run lint
```

**Note:** Vitest 4.x requires Node 18+. On this machine, the system Node is v14 — use NVM to activate Node 22:
```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

**Test file locations:**
- `frontend/src/components/Scan/` — component tests (ResultsTable, FilterPanel, SetupEngineDrawer)
- `frontend/src/components/Scan/filters/` — filter sub-component tests (CompactRangeInput, CompactCheckbox)
- `frontend/src/utils/` — utility tests (formatUtils)
- `frontend/src/test/fixtures/` — shared test fixtures
- `frontend/src/test/renderWithProviders.jsx` — MUI ThemeProvider test wrapper

### Quality Gates (Setup Engine)
```bash
make help          # List all available targets
make gates         # Run all 5 SE quality gates
make gate-1        # Detector correctness
make gate-2        # Temporal integrity
make gate-3        # Integration coverage
make gate-4        # Performance baselines (advisory)
make gate-5        # Golden regression
make gate-check    # Verify all SE test files are in a gate
make all           # Full CI (backend gates + frontend)
make golden-update # Regenerate golden snapshots
```

### Diagnostic Scripts

Cache/pipeline debugging utilities live in `backend/scripts/`. Invoke the
`diagnose-cache` skill (`.claude/skills/diagnose-cache/`) for the script
catalogue and the freshness-gate playbook.

## Architecture

### Backend Structure
- **FastAPI** application in `backend/app/main.py`
- **API routes** in `backend/app/api/v1/` - RESTful endpoints for stocks, scans, themes, chatbot, signals
- **Services** in `backend/app/services/` - Business logic layer (70+ service files)
- **Scanners** in `backend/app/scanners/` - Stock screening implementations
- **Tasks** in `backend/app/tasks/` - Celery background tasks
- **Models** in `backend/app/models/` - SQLAlchemy ORM models
- **Schemas** in `backend/app/schemas/` - Pydantic request/response schemas

### Key Architectural Patterns

**Multi-Screener Orchestrator** (`scanners/scan_orchestrator.py`):
- Coordinates Minervini, CANSLIM, IPO, Volume Breakthrough, and Custom screeners
- All screeners extend `BaseStockScreener` abstract class
- Data fetched once and shared across screeners
- Composite scoring via configurable aggregation (weighted_average, maximum, minimum)

**Two-Queue Celery Architecture**:
- `celery` queue: General compute tasks (4 workers local; Docker concurrency follows the deployed worker topology)
- `data_fetch` queue: API calls (1 worker, serialized to respect rate limits)
- All external API tasks route to `data_fetch` to prevent rate limit violations

**Per-Market Scan Queues**:
- Manual user scans (`run_bulk_scan`) route to market-specific queues: `user_scans_us`, `user_scans_hk`, `user_scans_jp`, `user_scans_tw` (with `user_scans_shared` as fallback when no market is set)
- `start_celery.sh` spawns one worker per market queue, so US and HK scans run in parallel on separate workers
- `@serialized_market_workload` (see `tasks/workload_coordination.py`) holds a Redis lock keyed by market, so scans targeting the same market serialize while different markets remain independent
- Manual scans run in **cache-only mode** — they do not fall back to yfinance/Finviz. The API boundary rejects scans with `409 market_data_stale` when cached prices haven't caught up to the last completed trading day for the market (see `services/market_data_freshness.py::check_symbol_freshness`)

**Redis Caching Strategy** (three-tier: Redis → PostgreSQL → API):
- DB 0: Celery broker
- DB 1: Celery results (24h TTL, auto-cleanup)
- DB 2: Application cache via shared connection pool (`services/redis_pool.py`)
  - Price cache: 7d TTL, stores 5 years of OHLCV (required for Volume Breakthrough Scanner)
  - Fundamentals cache: 7d TTL with DB fallback on Redis miss
  - Benchmark (SPY): 24h TTL with distributed locking to prevent thundering herd

**LLM Integration** (`services/chatbot/`):
- Supported provider path: Groq for chatbot/research, Minimax for primary theme extraction/merge, Z.AI fallback for extraction/merge
- Agent orchestrator with tool executor pattern
- Research mode with web search (Tavily, Serper)

### Frontend Structure
- **React 18** with Vite
- **Material-UI** for components
- **React Query** (TanStack) for data fetching
- **TanStack Table** for results display
- Pages in `frontend/src/pages/`: ScanPage, ChatbotPage, ThemesPage, GroupRankingsPage, BreadthPage, SignalsPage

### Frontend API Client Convention

**CRITICAL: API paths must NOT include the `/api` prefix** — `client.js`
supplies it via `baseURL`; including it yields `/api/api/v1/...` (404) in
Docker. Use `/v1/...` paths and `BASE_PATH` constants without `/api`.
Full contract with examples: `.claude/rules/frontend-api.md` (auto-scoped
to `frontend/**`).

## Data Sources & Rate Limits
- **yfinance**: 1 req/sec (self-imposed)
- **Finviz**: Rate-limited via wrapper
- **Alpha Vantage**: 25 req/day free tier
- **SEC EDGAR**: 10 req/sec (150ms between requests)

## Environment Variables

**Local development**: `backend/.env` (see `backend/.env.example`)
**Docker deployment**: `.env.docker` in project root (see `.env.docker.example`)

**Required for chatbot** (at least one supported LLM provider):
- `GROQ_API_KEY`, `GROQ_API_KEYS` - Groq (fast inference, free tier)
- `MINIMAX_API_KEY` - Minimax (primary theme extraction)
- `ZAI_API_KEY`, `ZAI_API_KEYS` - Z.AI (theme extraction/merge fallback)

**Web search** (enables research mode):
- `TAVILY_API_KEY`, `SERPER_API_KEY`

**Data sources**:
- `ALPHA_VANTAGE_API_KEY` - Fundamental data (25 req/day free tier)

**Infrastructure**:
- `DATABASE_URL` - PostgreSQL connection string (e.g., `postgresql://user:pass@localhost/stockscanner`)
- `REDIS_HOST`, `CELERY_BROKER_URL` - Redis/Celery configuration
- `CORS_ORIGINS` - Comma-separated allowed origins (for production)

**LLM routing** (optional):
- `LLM_DEFAULT_PROVIDER` - Optional override for sanctioned primary paths (Groq chatbot/research, Minimax extraction/merge)
- `LLM_CHATBOT_MODEL`, `LLM_RESEARCH_MODEL` - Model overrides (LiteLLM format)
- `LLM_FALLBACK_ENABLED` - Enable automatic provider fallback

## Database

**CRITICAL: Database Location**
- **Supported database**: PostgreSQL referenced by `DATABASE_URL`
- `docker-data/postgres/` holds the Docker Postgres data directory
- `data/` remains for non-database state such as caches, backups, and Celery beat state
- If you see an empty database or missing data, verify `DATABASE_URL` points to the intended PostgreSQL instance

**Persistent data paths:**
- `docker-data/postgres/` - PostgreSQL data directory (Docker)
- `backend/celerybeat-schedule.db` - Celery Beat scheduler state (legacy local path)

**Key tables:**
- `stock_prices`, `stock_fundamentals`, `stock_universe` - Core stock data
- `scans`, `scan_results` - Scan metadata and results with multi-screener scores
- `ibd_groups`, `ibd_group_ranks` - Industry group rankings
- `theme_clusters`, `theme_constituents` - Theme discovery
- `signals` - Technical signal detections
- `chat_sessions`, `chat_messages` - Chatbot conversation history

Migrations are versioned under `backend/alembic/`. PostgreSQL is the supported database for development and Docker deployment.

## Screening Methodologies

**Minervini Template**: RS Rating > 70-80, Stage 2 uptrend, MA alignment (50 > 150 > 200), price 30%+ above 52-week low

**CANSLIM**: Current quarterly EPS > 25%, Annual EPS growth > 25% 3yr, new highs, volume patterns, RS > 70, institutional ownership 40-70%

## macOS Development Note
For Celery on macOS, use `--pool=solo` (set via `start_celery.sh`) to avoid fork() crashes with curl_cffi. Also set:
```bash
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
export TOKENIZERS_PARALLELISM=false
```

## Git Conventions

This project uses **Conventional Commits** for all commit messages. Format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring (no feature or fix)
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `build`: Build system or dependency changes
- `ci`: CI/CD configuration changes
- `chore`: Maintenance tasks (deps, configs)

**Examples:**
```
feat(scanner): add volume breakthrough screener
fix(chatbot): handle empty response from LLM provider
docs: update API endpoint documentation
refactor(api): consolidate stock data fetching logic
test(canslim): add unit tests for EPS calculation
```

**Scopes** (optional): `api`, `scanner`, `chatbot`, `frontend`, `celery`, `db`, `cache`, `themes`, `signals`
