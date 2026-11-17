#!/bin/bash
# SCRATCH (ui-abc S1-P0): the round-3 harness's checks on main 01066ebe (worktree ui-plan, port 4462), in sequence.
# Usage: main-harness.sh  → logs in yard/main/harness.log; outputs in the harness's own dirs (named by head7).
set -uo pipefail
H=$SCRATCH/audit3/r3-harness
Y=$SCRATCH/ui-abc/yard
W=/home/user/screener/.claude/worktrees/ui-plan; PORT=4462
LOG=$Y/main/harness.log
s() { echo "### $* | load $(cut -d' ' -f1-3 /proc/loadavg) | $(TZ=Asia/Tokyo date '+%F %T JST')" >> "$LOG"; "$@" >> "$LOG" 2>&1; echo "### rc=$? $(TZ=Asia/Tokyo date '+%T')" >> "$LOG"; }
s "$H/probe/run-probe.sh" "$W" $PORT default
s "$H/probe/run-probe.sh" "$W" $PORT oracles
s "$H/dump/run-dump.sh" "$W" $PORT
s env HEIGHTS_NAME=heights-01066eb-yard "$H/heights/run-heights.sh" "$W" $PORT "$H/probe/probe-01066eb.json"
s "$H/build/run-build.sh" "$W"
echo "### all done $(TZ=Asia/Tokyo date '+%F %T JST')" >> "$LOG"
