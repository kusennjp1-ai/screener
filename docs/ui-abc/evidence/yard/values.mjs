#!/usr/bin/env node
// SCRATCH (ui-abc yardstick, never committed): value invariance (plan §5.3) over the state matrix (§5.2).
//
//   node values.mjs run <worktree> <port> <outdir> [--views <regex>] [--modes 375,390f,1440] [--resume] [--allow-dirty]
//       Refuses (exit 2) a worktree with any uncommitted or untracked file (vite serves the working tree; the record must be
//       a commit) unless --allow-dirty. Serves <worktree>'s frontend on <port> (its own vite dev server, CI-faithful browser and fonts) and runs
//       matrix.spec.mjs with the matrix and values collectors. Writes <outdir>/matrix.json and <outdir>/values.json (one
//       line per view and mode, keys sorted: byte-comparable), <outdir>/sha256.txt over those two, <outdir>/meta.json (tree,
//       port, times, load: outside the hashes) and <outdir>/run.log. --resume keeps <outdir>/raw and skips views already there.
//   node values.mjs merge <outdir>
//   node values.mjs diff <baseDir> <sliceDir> [allowList.json] [--subset]
//       Per view and mode: strings added / removed in each section (closed and opened lines, SVG text, label-bound pairs,
//       numbers, accessible names, the dock's lines and names; the first fold at 375x812 and 390x844), plus the derived kinds
//       `movedIntoFold` (in the base's closed lines, now only in the slice's opened lines), `leftFirstFold` /
//       `enteredFirstFold` (fold multiset) and `foldOrder` (the lines common to both folds stand in another relative order:
//       the first displaced line with its old and new index), and (round 2) `lineOrder` (the whole page's ordered lines,
//       section `closed.seq` / `opened.seq`: one row per displaced line with its old and new index; see lineOrder below) and
//       `seqMissing` (a record without seq on either side). Then the matrix section (when both dirs have matrix.json): per
//       view-mode a change of `rows` (the candidate rows as an ordered list), `overflow`, `bar`, `dock`, `reach.model`,
//       `reach.gate`, a non-empty slice `reach.why`, or (round 2) an entry of `errors` / `notes` the base record has not is a
//       FAIL of kind `matrix` (section = the field); `page` / `content`
//       height changes are printed as `info` and never fail. Every difference not matched by the allow-list is printed as
//       FAIL and the exit code is 1. --subset compares only the views both sides have (otherwise a view missing on either side
//       is a FAIL). Allow-list: JSON array of { kind: added|removed|movedIntoFold|leftFirstFold|enteredFirstFold|foldOrder|
//       lineOrder|seqMissing, section?: regex, text: string | "/regex/", views?: regex, reason } or { kind: 'matrix', field:
//       regex (rows|overflow|bar|dock|reach.model|reach.gate|reach.why|errors|notes), views?: regex, reason }.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';

const Y = '$SCRATCH/ui-abc/yard';
const sha = text => createHash('sha256').update(text).digest('hex');
const [, , cmd, ...args] = process.argv;
const flag = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };

/** Merge a raw/<collector>/<mode>/*.json tree into one line-per-record JSON, keys sorted. */
export function mergeCollector(dir, collector) {
  const root = `${dir}/raw/${collector}`;
  if (!existsSync(root)) return null;
  const entries = [];
  for (const mode of readdirSync(root).sort()) for (const file of readdirSync(`${root}/${mode}`).filter(f => f.endsWith('.json')).sort()) {
    const record = JSON.parse(readFileSync(`${root}/${mode}/${file}`, 'utf8'));
    entries.push([`${mode} ${record.id}`, record]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return `{\n${entries.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')}\n}\n`;
}

function merge(dir) {
  const hashes = [];
  for (const collector of ['matrix', 'values']) {
    const text = mergeCollector(dir, collector);
    if (text === null) continue;
    writeFileSync(`${dir}/${collector}.json`, text);
    hashes.push(`${sha(text)}  ${collector}.json`);
  }
  writeFileSync(`${dir}/sha256.txt`, hashes.join('\n') + '\n');
  // Off-hash diagnostics (rect-dependent): the fold without the closed-<details> rule, and what the rule left out.
  const check = mergeCollector(dir, 'foldcheck');
  if (check !== null) writeFileSync(`${dir}/foldcheck.json`, check);
  const matrix = existsSync(`${dir}/matrix.json`) ? JSON.parse(readFileSync(`${dir}/matrix.json`, 'utf8')) : {};
  const unreached = Object.entries(matrix).filter(([, r]) => r.reach?.why?.length).map(([k, r]) => `${k}: ${r.reach.why.join('; ')}`);
  const errors = Object.entries(matrix).filter(([, r]) => r.errors?.length).map(([k, r]) => `${k}: ${r.errors.join(' | ')}`);
  const notes = Object.entries(matrix).filter(([, r]) => r.notes?.length).map(([k, r]) => `${k}: ${r.notes.join(' | ')}`);
  console.log(hashes.join('\n'));
  console.log(JSON.stringify({ views: Object.keys(matrix).length, unreached: unreached.length, page_errors: errors.length, notes: notes.length }));
  for (const line of [...unreached.map(l => `UNREACHED ${l}`), ...errors.map(l => `PAGE-ERROR ${l}`), ...notes.map(l => `NOTE ${l}`)]) console.log(line);
  return { unreached, errors };
}

/** 'clean', or 'dirty: <first porcelain lines>' (tracked changes AND untracked files: vite serves the working tree). */
export function treeState(W) {
  const status = execFileSync('git', ['-C', W, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim();
  return status ? `dirty: ${status.split('\n').slice(0, 5).join('; ')}${status.split('\n').length > 5 ? '; …' : ''}` : 'clean';
}

function run(W, PORT, OUT, { views, modes, resume }) {
  W = resolve(W); OUT = resolve(OUT);
  if (!['4461', '4462'].includes(String(PORT))) throw Error(`port ${PORT}: only 4461 / 4462`);
  if (!resume) rmSync(`${OUT}/raw`, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const head = execFileSync('git', ['-C', W, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = treeState(W);
  const meta = { tree: head, dirty, worktree: W, port: Number(PORT), views: views || null, modes: modes || null, started: new Date().toISOString(), load_before: loadavg().map(x => Math.round(x * 100) / 100) };
  const script = `source ${Y}/lib.sh; RUN=$(yard_run_dir matrix "${W}" ${PORT} matrix.spec.mjs); cd "${W}/frontend"; ` +
    `YARD_FIXTURE="${W}/frontend/tests/static/brief-fixture.js" YARD_TREE="${W}/frontend" YARD_OUT="${OUT}" YARD_COLLECT=matrix,values ` +
    `${views ? `YARD_VIEWS='${views}' ` : ''}${modes ? `YARD_MODES='${modes}' ` : ''}${resume ? 'YARD_SKIP_EXISTING=1 ' : ''}npx playwright test -c "$RUN/pw.config.mjs"`;
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8', maxBuffer: 1 << 28 });
  writeFileSync(`${OUT}/run.log`, `${res.stdout}\n${res.stderr}`);
  meta.playwright_rc = res.status; meta.ended = new Date().toISOString(); meta.load_after = loadavg().map(x => Math.round(x * 100) / 100);
  meta.summary = (res.stdout.match(/\d+ (passed|failed|skipped|flaky)[^\n]*/g) || []).join('; ');
  writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
  console.log(`tree ${head} (${dirty}) port ${PORT} playwright rc ${res.status}: ${meta.summary}`);
  return merge(OUT);
}

// ---- diff ----
const toMap = pairs => new Map(pairs || []);
const msDiff = (a, b) => { // multiset a -> b: added (in b more), removed (in a more)
  const A = toMap(a), B = toMap(b), added = [], removed = [];
  for (const [k, n] of B) { const d = n - (A.get(k) || 0); if (d > 0) added.push([k, d]); }
  for (const [k, n] of A) { const d = n - (B.get(k) || 0); if (d > 0) removed.push([k, d]); }
  return { added, removed };
};
const listMs = list => [...(list || []).reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())];

/** Occurrence-indexed tokens (a fold can hold the same line twice, e.g. 「⌄」). */
const tokens = list => { const seen = new Map(); return (list || []).map(t => { const k = (seen.get(t) || 0) + 1; seen.set(t, k); return `${t}\u0000${k}`; }); };
/** The lines common to both folds, in each fold's order; when the orders differ, the displaced lines (outside one LCS). */
export function foldOrder(a, b) {
  const ta = tokens(a), tb = tokens(b), inB = new Set(tb), inA = new Set(ta);
  const A = ta.filter(t => inB.has(t)), B = tb.filter(t => inA.has(t));
  if (A.join('\n') === B.join('\n')) return null;
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const kept = new Set();
  for (let i = 0, j = 0; i < n && j < m;) { if (A[i] === B[j]) { kept.add(A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  const displaced = A.filter(t => !kept.has(t));
  const first = displaced[0];
  return { text: first.split('\u0000')[0], oldIndex: ta.indexOf(first), newIndex: tb.indexOf(first), displaced: displaced.length, common: n };
}

/**
 * Round 2, `lineOrder` (the whole page's `seq`, closed and opened): the lines common to both sequences stand in another relative
 * order. Like foldOrder an LCS over the lines common to both sides, but on the raw texts, without foldOrder's occurrence index:
 * a whole page repeats 「✓」, 「未確認」, 「前日比」 many times, and with an occurrence index one repeat added or removed anywhere
 * would shift every later repeat and read as a reorder. A line is displaced when it stands outside the LCS on both sides beyond
 * what the multiset difference (added / removed) accounts for, so the result is empty exactly when the slice's sequence is the
 * base's with lines inserted and deleted only. Returns one entry per displaced line instance: { text, oldIndex, newIndex,
 * displaced, common } (indices in the unfiltered sequences; for a text displaced twice the instances pair up in order).
 */
export function lineOrder(a = [], b = []) {
  const countOf = list => list.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
  const ca = countOf(a), cb = countOf(b);
  const A = [], B = [];
  a.forEach((t, i) => { if (cb.has(t)) A.push([t, i]); });
  b.forEach((t, i) => { if (ca.has(t)) B.push([t, i]); });
  if (A.length === B.length && A.every((x, k) => x[0] === B[k][0])) return [];
  let p = 0; while (p < A.length && p < B.length && A[p][0] === B[p][0]) p++;
  let s = 0; while (s < A.length - p && s < B.length - p && A[A.length - 1 - s][0] === B[B.length - 1 - s][0]) s++;
  const MA = A.slice(p, A.length - s), MB = B.slice(p, B.length - s), n = MA.length, m = MB.length, w = m + 1;
  const L = new Int32Array((n + 1) * w); // L[i*w+j] = LCS of MA[i..], MB[j..]
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * w + j] = MA[i][0] === MB[j][0] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  const inA = new Array(n).fill(false), inB = new Array(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (MA[i][0] === MB[j][0]) { inA[i] = inB[j] = true; i++; j++; } else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) i++; else j++;
  }
  const outside = (list, kept) => list.reduce((map, [t, index], k) => (kept[k] ? map : map.set(t, [...(map.get(t) || []), index])), new Map());
  const outA = outside(MA, inA), outB = outside(MB, inB);
  let common = 0; for (const [t, k] of ca) if (cb.has(t)) common += Math.min(k, cb.get(t));
  const displaced = common - (p + s + L[0]);
  const out = [];
  for (const [t, olds] of [...outA].sort((x, y) => x[1][0] - y[1][0])) {
    const news = outB.get(t) || [];
    const k = olds.length - Math.max(0, ca.get(t) - cb.get(t)); // the instances not accounted for by a removal
    for (let q = 0; q < k; q++) out.push({ text: t, oldIndex: olds[q], newIndex: news[q] ?? null, displaced, common });
  }
  return out;
}

const SECTIONS = ['lines', 'svg', 'pairs', 'numbers', 'names', 'dock'];
export function diffValues(baseDir, sliceDir, allow = [], { subset = false } = {}) {
  const base = JSON.parse(readFileSync(`${baseDir}/values.json`, 'utf8')), slice = JSON.parse(readFileSync(`${sliceDir}/values.json`, 'utf8'));
  const keys = [...new Set([...Object.keys(base), ...Object.keys(slice)])].sort();
  const out = [];
  const allowed = (kind, section, text, view) => allow.find(a => a.kind === kind && a.kind !== 'matrix' && (!a.section || new RegExp(a.section).test(section)) && (!a.views || new RegExp(a.views).test(view))
    && (typeof a.text === 'string' && a.text.startsWith('/') && a.text.endsWith('/') && a.text.length > 1 ? new RegExp(a.text.slice(1, -1)).test(text) : a.text === text));
  const push = (view, kind, section, text, count = 1, detail = null) => { const hit = allowed(kind, section, text, view); out.push({ view, kind, section, text, count, ...(detail ? { detail } : {}), allowed: hit ? hit.reason || true : false }); };
  for (const key of keys) {
    const a = base[key], b = slice[key];
    if (!a || !b) { if (!subset) push(key, a ? 'viewMissingInSlice' : 'viewMissingInBase', 'view', key); continue; }
    for (const part of ['closed', 'opened']) for (const section of SECTIONS) {
      if (!a[part] && !b[part]) continue;
      const d = msDiff(a[part]?.[section], b[part]?.[section]);
      for (const [text, n] of d.added) push(key, 'added', `${part}.${section}`, text, n);
      for (const [text, n] of d.removed) push(key, 'removed', `${part}.${section}`, text, n);
    }
    // Round 2: the order of the whole page's lines (seq), closed and opened; a record without seq (a pre-round-2 run) is a
    // FAIL of its own kind, never a silent skip.
    for (const part of ['closed', 'opened']) {
      if (!a[part] || !b[part]) continue;
      if (!a[part].seq || !b[part].seq) { push(key, 'seqMissing', `${part}.seq`, `no seq in ${a[part].seq ? 'slice' : b[part].seq ? 'base' : 'base and slice'}`); continue; }
      for (const d of lineOrder(a[part].seq, b[part].seq)) push(key, 'lineOrder', `${part}.seq`, d.text, 1, `old index ${d.oldIndex} -> new index ${d.newIndex} (${d.displaced} of ${d.common} common lines displaced)`);
    }
    if (a.closed && b.closed && b.opened) { // moved behind a fold: in the base's closed lines, only in the slice's opened lines
      const bc = toMap(b.closed.lines), bo = toMap(b.opened.lines);
      for (const [text, n] of a.closed.lines) { const lost = n - (bc.get(text) || 0); if (lost > 0 && (bo.get(text) || 0) >= n) push(key, 'movedIntoFold', 'closed.lines', text, lost); }
    }
    if (a.fold || b.fold) {
      const d = msDiff(listMs(a.fold), listMs(b.fold));
      for (const [text, n] of d.removed) push(key, 'leftFirstFold', 'fold', text, n);
      for (const [text, n] of d.added) push(key, 'enteredFirstFold', 'fold', text, n);
      const order = foldOrder(a.fold, b.fold);
      if (order) push(key, 'foldOrder', 'fold', order.text, order.displaced, `old index ${order.oldIndex} -> new index ${order.newIndex} (${order.displaced} of ${order.common} common lines displaced)`);
    }
  }
  return out;
}

/** The matrix section: fields that FAIL on change, and the heights printed as info. */
const MATRIX_FAIL = [['rows', r => r.rows ?? null], ['overflow', r => r.overflow ?? null], ['bar', r => r.bar ?? null], ['dock', r => r.dock ?? null],
  ['reach.model', r => r.reach?.model ?? null], ['reach.gate', r => r.reach?.gate ?? null]];
const MATRIX_INFO = ['page', 'content'];
export function diffMatrix(baseDir, sliceDir, allow = [], { subset = false } = {}) {
  const out = [];
  for (const dir of [baseDir, sliceDir]) if (!existsSync(`${dir}/matrix.json`)) return { out, note: `matrix not compared (no matrix.json in ${dir})` };
  const base = JSON.parse(readFileSync(`${baseDir}/matrix.json`, 'utf8')), slice = JSON.parse(readFileSync(`${sliceDir}/matrix.json`, 'utf8'));
  const allowed = (field, view) => allow.find(a => a.kind === 'matrix' && (!a.field || new RegExp(a.field).test(field)) && (!a.views || new RegExp(a.views).test(view)));
  const push = (view, field, from, to, info = false) => { const hit = info ? null : allowed(field, view); out.push({ view, kind: info ? 'info' : 'matrix', section: field, text: `${JSON.stringify(from)} -> ${JSON.stringify(to)}`, count: 1, info, allowed: info ? true : hit ? hit.reason || true : false }); };
  let compared = 0;
  for (const key of [...new Set([...Object.keys(base), ...Object.keys(slice)])].sort()) {
    const a = base[key], b = slice[key];
    if (!a || !b) { if (!subset) push(key, 'record', a ? 'present' : 'missing', b ? 'present' : 'missing'); continue; }
    compared++;
    for (const [field, get] of MATRIX_FAIL) if (JSON.stringify(get(a)) !== JSON.stringify(get(b))) push(key, field, get(a), get(b));
    if (b.reach?.why?.length) push(key, 'reach.why', a.reach?.why ?? [], b.reach.why);
    // Round 2: a page error or a note (a step the state could not take, loading text, no chart, chartSettled …) that the
    // slice's record has and the base's has not (as a multiset): FAIL, field `errors` / `notes`.
    for (const field of ['errors', 'notes']) {
      const left = toMap(listMs(a[field])), extra = (b[field] || []).filter(x => { const k = left.get(x) || 0; left.set(x, k - 1); return k <= 0; });
      if (extra.length) push(key, field, a[field] ?? [], b[field]);
    }
    for (const field of MATRIX_INFO) if (a[field] !== b[field]) push(key, field, a[field], b[field], true);
  }
  return { out, compared };
}

if (cmd === 'run') {
  const views = flag('--views'), modes = flag('--modes'), resume = bool('--resume'), allowDirty = bool('--allow-dirty');
  const [W, PORT, OUT] = args;
  if (!OUT) { console.error('usage: values.mjs run <worktree> <port> <outdir> [--views re] [--modes m] [--resume] [--allow-dirty]'); process.exit(2); }
  const state = treeState(resolve(W));
  if (state !== 'clean' && !allowDirty) { console.error(`refused: ${resolve(W)} is ${state} (commit first, or pass --allow-dirty; meta.json records the state)`); process.exit(2); }
  const r = run(W, PORT, OUT, { views, modes, resume });
  // Non-zero on any failed test (a timeout leaves a view-mode without its file), any unreached state or any page error.
  const meta = JSON.parse(readFileSync(`${resolve(OUT)}/meta.json`, 'utf8'));
  process.exit(meta.playwright_rc || r.unreached.length || r.errors.length ? 1 : 0);
} else if (cmd === 'merge') {
  merge(resolve(args[0]));
} else if (cmd === 'diff') {
  const subset = bool('--subset');
  const [baseDir, sliceDir, allowFile] = args;
  const allow = allowFile ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];
  const values = diffValues(baseDir, sliceDir, allow, { subset });
  const matrix = diffMatrix(baseDir, sliceDir, allow, { subset });
  const out = [...values, ...matrix.out];
  const fails = out.filter(d => !d.allowed);
  for (const d of out) console.log(`${d.info ? 'info' : d.allowed ? 'allowed' : 'FAIL'}\t${d.view}\t${d.kind}\t${d.section}\t×${d.count}\t${d.text}${d.detail ? `\t[${d.detail}]` : ''}${d.allowed && d.allowed !== true ? `\t(${d.allowed})` : ''}`);
  if (matrix.note) console.log(`note: ${matrix.note}`);
  const byKind = values.reduce((m, d) => ({ ...m, [d.kind]: (m[d.kind] || 0) + 1 }), {});
  const mx = matrix.out.filter(d => !d.info);
  console.log(JSON.stringify({ differences: values.length + mx.length, failures: fails.length, byKind,
    matrix: matrix.note ? 'not compared' : { compared: matrix.compared, differences: mx.length, failures: mx.filter(d => !d.allowed).length, info: matrix.out.length - mx.length } }));
  process.exit(fails.length ? 1 : 0);
} else if (cmd) {
  console.error(`unknown command ${cmd}`); process.exit(2);
}
