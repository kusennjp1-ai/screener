#!/bin/bash
# SessionStart hook — install backend + frontend dependencies so tests and
# linters work in Claude Code on the web. Mirrors .github/workflows/ci.yml.
#
# Resilient by design: a single flaky transitive wheel must NOT hard-abort
# session startup, so each step warns-and-continues instead of using `set -e`.
# In a standard CI-like Linux env the full install succeeds (CI proves it); in a
# leaner env the session still starts with whatever installed + env configured.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# `wheel` helps build the few sdist-only transitive deps (feedparser's sgmllib3k etc.).
python3 -m pip install --quiet --disable-pip-version-check --upgrade pip wheel \
  || echo "[session-start] WARN: pip/wheel upgrade failed; continuing."

echo "[session-start] installing backend Python deps (app + tests)..."
python3 -m pip install --disable-pip-version-check \
  -r backend/requirements.txt -r backend/requirements-test.txt \
  || echo "[session-start] WARN: some backend deps failed to install; continuing."

echo "[session-start] installing frontend deps..."
( cd frontend && npm install --no-audit --no-fund --loglevel=error ) \
  || echo "[session-start] WARN: frontend npm install failed; continuing."

# The app settings / test suite require DATABASE_URL to import; mirror CI's dummy
# value so pytest, scripts and `make gate-*` load without a live DB.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export DATABASE_URL="postgresql://ci:ci@localhost/ci_unused"' >> "$CLAUDE_ENV_FILE"
fi

echo "[session-start] done."
