#!/bin/bash
# SCRATCH (ui-abc yardstick, never committed): timing4.spec.mjs, interleaved, on an idle machine.
# Usage: timing4.sh <worktree A> <worktree B> <port> <outdir> [runs, default 7] [label]
#   A and B may be the same tree (main against main: the noise band of plan S1-P1). Each tree's HEAD is built by the
#   harness's build/run-build.sh (dist-t, base /t-<head7>/) unless present, served by snapshot/scripts/serve.mjs on <port>
#   (4461 or 4462), with the 11-12 rebuild's serve/ data. The run waits for a quiet machine (timing/wait-quiet.sh 0.5 600)
#   and records /proc/loadavg, the top processes and the Node calibration loop (timing/host-calib.mjs) before and after.
#   → <outdir>/timing4-<label>.json (the spec's result + the host record) and <outdir>/timing4-<label>.log
source $SCRATCH/ui-abc/yard/lib.sh
A=$(readlink -f "$1"); B=$(readlink -f "$2"); PORT=$3; OUTD=$(readlink -f "$4"); RUNS=${5:-7}
yard_port_ok "$PORT"
TA=$(head_of "$A"); TB=$(head_of "$B"); LABEL=${6:-$TA-vs-$TB}
mkdir -p "$OUTD"; LOG=$OUTD/timing4-$LABEL.log; : > "$LOG"
for w in "$A" "$B"; do t=$(head_of "$w"); [ -f "$H/snapshot/trees/$t/frontend/dist-t/index.html" ] || "$H/build/run-build.sh" "$w" >> "$LOG" 2>&1; done
SNAP_SERVE=$H/snapshot/out/bd20584/serve
RUND=$Y/runs/timing4-$PORT; rm -rf "$RUND"; mkdir -p "$RUND"
cp "$Y/timing4.spec.mjs" "$RUND/"; ln -s "$(readlink -f "$A/frontend/node_modules")" "$RUND/node_modules"; echo '{"type":"module"}' > "$RUND/package.json"
cat > "$RUND/pw.config.mjs" <<CFG
export default { testDir: '$RUND', testMatch: /timing4\.spec\.mjs/, outputDir: '$RUND/test-results', workers: 1, timeout: 3 * 60 * 60 * 1000, reporter: 'line',
  use: { trace: 'off', launchOptions: { executablePath: '$CFT' } } };
CFG
node "$H/snapshot/scripts/serve.mjs" "$H/snapshot/trees" "$PORT" >> "$LOG" 2>&1 & SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
# T4_SMOKE=1 skips the quiet wait: a code check only, never a measurement.
[ "${T4_SMOKE:-}" = 1 ] && echo "SMOKE: no quiet wait (not a measurement)" | tee -a "$LOG" || "$H/timing/wait-quiet.sh" 0.5 600 true | tee -a "$LOG"
L0=$(cut -d' ' -f1-3 /proc/loadavg); ps -eo pcpu,etime,comm --sort=-pcpu | head -8 > "$RUND/ps-before.txt"; node "$H/timing/host-calib.mjs" > "$RUND/calib-before.json"
echo "trees $TA,$TB runs $RUNS port $PORT load $L0 start $(TZ=Asia/Tokyo date '+%F %T JST')" | tee -a "$LOG"
( cd "$A/frontend" && SNAP_SERVE=$SNAP_SERVE SERVE_PORT=$PORT T4_TREES=$TA,$TB T4_RUNS=$RUNS T4_WIDTHS=${T4_WIDTHS:-390,1440} T4_OUT=$RUND/result.json npx playwright test -c "$RUND/pw.config.mjs" ) >> "$LOG" 2>&1 || { echo "timing4 spec failed (see $LOG)"; tail -20 "$LOG"; exit 1; }
L1=$(cut -d' ' -f1-3 /proc/loadavg); ps -eo pcpu,etime,comm --sort=-pcpu | head -8 > "$RUND/ps-after.txt"; node "$H/timing/host-calib.mjs" > "$RUND/calib-after.json"
node - "$RUND" "$OUTD/timing4-$LABEL.json" "$L0" "$L1" <<'JS'
const [,, R, OUT, L0, L1] = process.argv; const fs = await import('node:fs');
const r = JSON.parse(fs.readFileSync(`${R}/result.json`, 'utf8'));
r.host = { load_before: L0, load_after: L1, ps_before: fs.readFileSync(`${R}/ps-before.txt`, 'utf8').trim().split('\n'), ps_after: fs.readFileSync(`${R}/ps-after.txt`, 'utf8').trim().split('\n'),
  calib_before: JSON.parse(fs.readFileSync(`${R}/calib-before.json`, 'utf8')), calib_after: JSON.parse(fs.readFileSync(`${R}/calib-after.json`, 'utf8')) };
fs.writeFileSync(OUT, JSON.stringify(r, null, 1));
for (const [w, list] of Object.entries(r.widths)) for (const s of list) console.log(`${w} ${s.label}: ${JSON.stringify(s.medians)}`);
JS
echo "end load $L1 $(TZ=Asia/Tokyo date '+%F %T JST')" | tee -a "$LOG"
