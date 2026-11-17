#!/bin/bash
# SCRATCH (ui-abc S1-P0): the yard's deterministic tools on main 01066ebe (worktree ui-plan, port 4462), twice, then the
# byte-identity record. run1 is main's baseline (yard/main/base), run2 the determinism re-run (yard/main/rerun).
# Usage: main-yard.sh [step...]   steps: v1 s1 v2 s2 l2 p cmp  (default all, in that order). Log: yard/main/yard.log
set -uo pipefail
Y=$SCRATCH/ui-abc/yard
W=/home/user/screener/.claude/worktrees/ui-plan; PORT=4462; LOG=$Y/main/yard.log
export PATH=/opt/node22/bin:$PATH
s() { echo "### $* | load $(cut -d' ' -f1-3 /proc/loadavg) | $(TZ=Asia/Tokyo date '+%F %T JST')" >> "$LOG"; "$@" >> "$LOG" 2>&1; echo "### rc=$? $(TZ=Asia/Tokyo date '+%T')" >> "$LOG"; }
STEPS=${*:-v1 s1 v2 s2 l2 p cmp}
cd "$Y"
for step in $STEPS; do case $step in
  v1) s node values.mjs run "$W" $PORT "$Y/main/base" ;;
  s1) s node surfaces.mjs run "$W" $PORT "$Y/main/base" ;;
  v2) s node values.mjs run "$W" $PORT "$Y/main/rerun" ;;
  s2) s node surfaces.mjs run "$W" $PORT "$Y/main/rerun" ;;
  l2) s node --max-old-space-size=8192 ledger.mjs run "$W" "$Y/main/ledger2" ;;
  p) s node phrases.mjs scan "$Y/main/base"; s node phrases.mjs scan "$Y/main/rerun" ;;
  cmp) { echo "### byte identity"; for f in matrix.json values.json surfaces.json phrases.json; do cmp "$Y/main/base/$f" "$Y/main/rerun/$f" && echo "IDENTICAL $f $(sha256sum < "$Y/main/base/$f" | cut -c1-64)" || echo "DIFFERENT $f"; done
         cmp "$Y/main/ledger1/ledger.jsonl" "$Y/main/ledger2/ledger.jsonl" && echo "IDENTICAL ledger.jsonl $(sha256sum < "$Y/main/ledger1/ledger.jsonl" | cut -c1-64)" || echo "DIFFERENT ledger.jsonl"; } >> "$LOG" 2>&1 ;;
esac; done
echo "### main-yard done $(TZ=Asia/Tokyo date '+%F %T JST')" >> "$LOG"
