#!/bin/bash
# PreToolUse guard (Edit|Write): block edits to EXISTING alembic migrations.
# Applied migrations are immutable history — editing one desyncs every
# deployed database. Creating a NEW migration file is always allowed.
# Exit 2 = block the tool call and surface stderr to Claude.
set -uo pipefail

HOOK_PAYLOAD=$(cat) ROOT="$CLAUDE_PROJECT_DIR" python3 - <<'PY'
import json, os, subprocess, sys

root = os.environ["ROOT"]
try:
    payload = json.loads(os.environ.get("HOOK_PAYLOAD") or "{}")
except Exception:
    sys.exit(0)  # malformed input: never brick the session

path = (payload.get("tool_input") or {}).get("file_path") or ""
if not path:
    sys.exit(0)
rel = os.path.relpath(os.path.join(root, path) if not os.path.isabs(path) else path, root)
if not rel.startswith(os.path.join("backend", "alembic", "versions") + os.sep):
    sys.exit(0)

# Only existing, git-tracked migrations are protected (new files pass).
tracked = subprocess.run(
    ["git", "-C", root, "ls-files", "--error-unmatch", rel],
    capture_output=True,
).returncode == 0
if tracked:
    sys.stderr.write(
        f"BLOCKED: {rel} is an applied alembic migration — migrations are "
        "immutable once committed. Create a NEW revision instead "
        "(cd backend && alembic revision -m \"...\").\n"
    )
    sys.exit(2)
PY
exit $?
