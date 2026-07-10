#!/bin/bash
# PreToolUse guard (Bash): block plain force-pushes. --force-with-lease is
# allowed (it fails safe when the remote moved); bare --force / -f is not.
# Exit 2 = block the tool call and surface stderr to Claude.
set -uo pipefail

HOOK_PAYLOAD=$(cat) python3 - <<'PY'
import json, os, re, sys

try:
    payload = json.loads(os.environ.get("HOOK_PAYLOAD") or "{}")
except Exception:
    sys.exit(0)

cmd = (payload.get("tool_input") or {}).get("command") or ""
if not re.search(r"\bgit\b[^\n;|&]*\bpush\b", cmd):
    sys.exit(0)
# Strip the safe variant, then look for the bare flag.
stripped = cmd.replace("--force-with-lease", "")
if re.search(r"(^|\s)(--force|-f)(\s|$)", stripped):
    sys.stderr.write(
        "BLOCKED: bare `git push --force` rewrites remote history unsafely. "
        "Use --force-with-lease (aborts if the remote moved), and only with "
        "explicit user approval.\n"
    )
    sys.exit(2)
PY
exit $?
