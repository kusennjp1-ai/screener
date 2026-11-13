// SCRATCH (audit3 p3): attribute the longest renderer main-thread task of a Chrome trace (from timing.spec.mjs with
// P3_TRACE, on the sourcemap build /m-<sha>/). Prints the task, its event breakdown (exclusive time by trace event name)
// and JS self/inclusive time by original function (CPU profile samples mapped through the build's sourcemaps).
// Usage: node trace-analyse.mjs <trace.json> <dist-map dir> [--json out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { SourceMapConsumer } from 'source-map-js';

const [file, distMap, , jsonOut] = process.argv.slice(2);
const trace = JSON.parse(readFileSync(file, 'utf8'));
const events = trace.traceEvents || trace;
// Main thread: the CrRendererMain with the most RunTask time.
const names = new Map(events.filter(e => e.ph === 'M' && e.name === 'thread_name').map(e => [`${e.pid}:${e.tid}`, e.args.name]));
const busy = new Map();
for (const e of events) if (e.ph === 'X' && e.name === 'RunTask' && names.get(`${e.pid}:${e.tid}`) === 'CrRendererMain') busy.set(`${e.pid}:${e.tid}`, (busy.get(`${e.pid}:${e.tid}`) || 0) + e.dur);
const main = [...busy.entries()].sort((a, b) => b[1] - a[1])[0][0];
const [pid, tid] = main.split(':').map(Number);
const onMain = events.filter(e => e.pid === pid && e.tid === tid && e.ph === 'X' && Number.isFinite(e.dur));
const tasks = onMain.filter(e => e.name === 'RunTask').sort((a, b) => a.ts - b.ts);
const navStart = events.find(e => e.pid === pid && (e.name === 'navigationStart' || e.name === 'markAsMainFrame'))?.ts ?? tasks[0].ts;
const long = tasks.filter(t => t.dur >= 50000);
const longest = [...tasks].sort((a, b) => b.dur - a.dur)[0];
const lo = longest.ts, hi = longest.ts + longest.dur;

// Exclusive time by event name inside the task (complete events nest on one thread).
const inside = onMain.filter(e => e.ts >= lo && e.ts + e.dur <= hi && e !== longest).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const excl = new Map(), stack = [];
const add = (name, us) => excl.set(name, (excl.get(name) || 0) + us);
let selfTop = longest.dur;
for (const e of inside) {
  while (stack.length && e.ts >= stack.at(-1).ts + stack.at(-1).dur) stack.pop();
  if (stack.length) stack.at(-1).childTime = (stack.at(-1).childTime || 0) + e.dur; else selfTop -= e.dur;
  stack.push(e);
}
for (const e of inside) add(e.name, e.dur - (e.childTime || 0));
add('(RunTask self)', selfTop);
const detail = inside.filter(e => ['FunctionCall', 'EvaluateScript', 'TimerFire', 'FireAnimationFrame', 'RunMicrotasks', 'v8.run', 'ParseHTML', 'Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint', 'MajorGC', 'MinorGC', 'V8.GC_SCAVENGER', 'v8.compile', 'EventDispatch', 'XHRReadyStateChange', 'ResourceReceivedData', 'ResourceFinish'].includes(e.name) && e.dur > 3000)
  .map(e => ({ name: e.name, start_ms: +((e.ts - lo) / 1000).toFixed(1), dur_ms: +(e.dur / 1000).toFixed(1), url: e.args?.data?.url?.split('/').pop() || e.args?.data?.functionName || e.args?.data?.type || '' }));

// CPU profile of the main thread.
const profiles = events.filter(e => e.pid === pid && (e.name === 'Profile' || e.name === 'ProfileChunk'));
const byId = new Map();
for (const e of profiles) {
  const id = e.id;
  if (!byId.has(id)) byId.set(id, { start: null, nodes: new Map(), samples: [], deltas: [], tid: e.tid });
  const p = byId.get(id);
  if (e.name === 'Profile') p.start = e.args.data.startTime;
  const cp = e.args?.data?.cpuProfile;
  for (const n of cp?.nodes || []) p.nodes.set(n.id, n);
  if (cp?.samples) p.samples.push(...cp.samples);
  if (e.args?.data?.timeDeltas) p.deltas.push(...e.args.data.timeDeltas);
}
const prof = [...byId.values()].filter(p => p.start !== null).sort((a, b) => b.samples.length - a.samples.length)[0];
// Sourcemaps of the build.
const maps = new Map();
for (const f of readdirSync(`${distMap}/assets`).filter(f => f.endsWith('.js.map'))) maps.set(f.replace(/\.map$/, ''), new SourceMapConsumer(JSON.parse(readFileSync(`${distMap}/assets/${f}`, 'utf8'))));
const fnCache = new Map();
const original = frame => {
  const key = `${frame.url}|${frame.lineNumber}|${frame.columnNumber}|${frame.functionName}`;
  if (fnCache.has(key)) return fnCache.get(key);
  let out = { file: frame.url ? frame.url.split('/').pop() : `(${frame.functionName || 'native'})`, fn: frame.functionName || '(anonymous)', line: null };
  const consumer = frame.url && maps.get(frame.url.split('/').pop());
  if (consumer && frame.lineNumber >= 0) {
    const pos = consumer.originalPositionFor({ line: frame.lineNumber + 1, column: frame.columnNumber });
    if (pos.source) {
      const src = pos.source.replace(/^.*?(src\/|node_modules\/)/, '$1');
      let fn = pos.name || null;
      if (!fn) {
        const content = consumer.sourceContentFor(pos.source, true);
        const lineText = content?.split('\n')[pos.line - 1] || '';
        const before = lineText.slice(0, pos.column + 40);
        const m = before.match(/(?:function\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)\s*=|([\w$]+)\s*[:=]\s*(?:\([^)]*\)|[\w$]+)\s*=>|([\w$]+)\s*\([^)]*\)\s*\{)(?![\s\S]*(?:function\s+[\w$]+|(?:const|let|var)\s+[\w$]+\s*=))/);
        fn = m ? (m[1] || m[2] || m[3] || m[4]) : `L${pos.line}`;
      }
      out = { file: src, fn, line: pos.line };
    }
  }
  fnCache.set(key, out);
  return out;
};
const self = new Map(), incl = new Map(), fileSelf = new Map();
let t = prof.start, sampled = 0;
for (let i = 0; i < prof.samples.length; i++) {
  t += prof.deltas[i] || 0;
  const next = t + (prof.deltas[i + 1] || 0);
  if (t < lo || t > hi) continue;
  const w = Math.max(0, Math.min(next, hi) - t);
  sampled += w;
  let node = prof.nodes.get(prof.samples[i]);
  const o = original(node.callFrame);
  const k = `${o.file} :: ${o.fn}`;
  self.set(k, (self.get(k) || 0) + w);
  const fk = node.callFrame.functionName === '(garbage collector)' ? '(garbage collector)' : node.callFrame.functionName === '(program)' ? '(program)' : node.callFrame.functionName === '(idle)' ? '(idle)' : o.file;
  fileSelf.set(fk, (fileSelf.get(fk) || 0) + w);
  const seen = new Set();
  while (node) {
    const oo = original(node.callFrame), kk = `${oo.file} :: ${oo.fn}`;
    if (!seen.has(kk)) { incl.set(kk, (incl.get(kk) || 0) + w); seen.add(kk); }
    node = node.parent ? prof.nodes.get(node.parent) : [...prof.nodes.values()].find(n => n.children?.includes(node.id));
  }
}
const ms = us => +(us / 1000).toFixed(1);
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, ms(v)]);
const result = {
  file, main, long_tasks: long.map(t => [ms(t.ts - navStart), ms(t.dur)]), longest: { start_ms_from_nav: ms(lo - navStart), dur_ms: ms(longest.dur) },
  breakdown_ms: top(excl, 14), big_events: detail.slice(0, 30), js_sampled_ms: ms(sampled),
  self_by_file_ms: top(fileSelf, 14), self_by_function_ms: top(self, 25), inclusive_ms: top(incl, 40),
};
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
