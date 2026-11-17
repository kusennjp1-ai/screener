#!/bin/bash
# SCRATCH (ui-abc yardstick, never committed): screenshots (shots.spec.mjs, plan §5.7) of one worktree.
# Usage: shots.sh <worktree> <port> <label> [views regex] [--resume]
#   → $S/ui-abc/shots-<label>/<view>__<size>__<theme>[-full].png, shots.log, manifest.txt (sha256 per PNG; PNGs are a human
#     side-by-side record, not a byte gate). Env passthrough: YARD_SIZES, YARD_THEMES.
source $SCRATCH/ui-abc/yard/lib.sh
W=$(readlink -f "$1"); PORT=$2; LABEL=$3; VIEWS=${4:-}; RESUME=${5:-}
yard_port_ok "$PORT"
OUT=$S/ui-abc/shots-$LABEL; mkdir -p "$OUT"; LOG=$OUT/shots.log
[ "$RESUME" = --resume ] || rm -f "$OUT"/*.png
echo "tree $(head_of "$W") ($(dirty_of "$W")) port $PORT load $(cut -d' ' -f1-3 /proc/loadavg) start $(TZ=Asia/Tokyo date '+%F %T JST')" | tee "$LOG"
RUN=$(yard_run_dir shots "$W" "$PORT" shots.spec.mjs)
SKIP=0; [ "$RESUME" = --resume ] && SKIP=1
RC=0; ( cd "$W/frontend" && env YARD_FIXTURE="$W/frontend/tests/static/brief-fixture.js" YARD_OUT="$OUT" YARD_VIEWS="$VIEWS" YARD_SKIP_EXISTING=$SKIP \
  npx playwright test -c "$RUN/pw.config.mjs" ) >> "$LOG" 2>&1 || RC=$?
(cd "$OUT" && sha256sum *.png > manifest.txt 2>/dev/null) || true
echo "playwright rc $RC; $(grep -Eo '[0-9]+ (passed|failed|skipped|flaky)' "$LOG" | tr '\n' ' '); $(ls "$OUT"/*.png 2>/dev/null | wc -l) PNGs, $(du -sh "$OUT" | cut -f1); end $(TZ=Asia/Tokyo date '+%F %T JST')" | tee -a "$LOG"
exit $RC
