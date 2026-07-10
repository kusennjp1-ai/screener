#!/bin/bash
# PostToolUse (Edit|Write): auto-run eslint --fix on touched frontend sources.
# Best-effort and silent — never fails the tool call (always exit 0).
set -uo pipefail

HOOK_PAYLOAD=$(cat) ROOT="$CLAUDE_PROJECT_DIR" python3 - <<'PY' || true
import json, os, subprocess, sys

root = os.environ["ROOT"]
try:
    payload = json.loads(os.environ.get("HOOK_PAYLOAD") or "{}")
except Exception:
    sys.exit(0)

path = (payload.get("tool_input") or {}).get("file_path") or ""
if not path:
    sys.exit(0)
apath = os.path.join(root, path) if not os.path.isabs(path) else path
rel = os.path.relpath(apath, root)
if not rel.startswith(os.path.join("frontend", "src") + os.sep):
    sys.exit(0)
if not rel.endswith((".js", ".jsx")):
    sys.exit(0)
fe = os.path.join(root, "frontend")
if not os.path.isdir(os.path.join(fe, "node_modules")):
    sys.exit(0)  # deps not installed; skip silently

try:
    subprocess.run(
        ["npx", "--no-install", "eslint", "--fix", os.path.relpath(apath, fe)],
        cwd=fe, capture_output=True, timeout=60,
    )
except Exception:
    pass
PY
exit 0
