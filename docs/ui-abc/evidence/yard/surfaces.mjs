#!/usr/bin/env node
// SCRATCH (ui-abc yardstick, never committed): runner and diff of the cross-surface oracle (surfaces.spec.mjs, plan §5.3).
//   node surfaces.mjs run <worktree> <port> <outdir> [--views <regex>]
//       → <outdir>/surfaces.json (one line per state, keys sorted), <outdir>/surfaces.sha256, meta in <outdir>/surfaces-meta.json
//   node surfaces.mjs diff <baseDir> <sliceDir> [allow.json]
//       Fails (exit 1) on: a state missing on either side; a surface whose { answer, figure } changed or that appeared or
//       disappeared; an agreement flag true on the base and false on the slice. Allow-list: JSON array of
//       { state?: regex, surface?: regex, change: 'reading'|'added'|'removed'|'flag', reason } (S1 lists its new rows here).
//   node surfaces.mjs table <dir>    prints the per-state table.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
const Y = '$SCRATCH/ui-abc/yard';
const sha = text => createHash('sha256').update(text).digest('hex');
const [, , cmd, ...args] = process.argv;
const flag = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };

function merge(OUT) {
  const dir = `${OUT}/raw/surfaces`, files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
  const entries = files.map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const text = `{\n${entries.map(r => `${JSON.stringify(r.id)}: ${JSON.stringify(r)}`).join(',\n')}\n}\n`;
  writeFileSync(`${OUT}/surfaces.json`, text);
  writeFileSync(`${OUT}/surfaces.sha256`, `${sha(text)}  surfaces.json\n`);
  console.log(`${sha(text)}  surfaces.json (${entries.length} states)`);
}
function table(OUT) {
  const all = JSON.parse(readFileSync(`${OUT}/surfaces.json`, 'utf8'));
  for (const [id, r] of Object.entries(all)) {
    const cells = Object.entries(r.surfaces).map(([name, s]) => `${name}=${s.absent ? 'absent' : `${s.answer}/${s.figure}`}`);
    console.log(`${id.padEnd(22)} agree answer=${r.agree.answer} figLoose=${r.agree.figureLoose} figStrict=${r.agree.figureStrict} | ${cells.join(' ')}`);
  }
}
if (cmd === 'run') {
  const views = flag('--views');
  const [W0, PORT, OUT0] = args, W = resolve(W0), OUT = resolve(OUT0);
  if (!['4461', '4462'].includes(String(PORT))) throw Error('port: 4461 / 4462 only');
  rmSync(`${OUT}/raw/surfaces`, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
  const head = execFileSync('git', ['-C', W, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  const meta = { tree: head, worktree: W, port: Number(PORT), started: new Date().toISOString(), load_before: loadavg() };
  const script = `source ${Y}/lib.sh; RUN=$(yard_run_dir surfaces "${W}" ${PORT} surfaces.spec.mjs); cd "${W}/frontend"; ` +
    `YARD_FIXTURE="${W}/frontend/tests/static/brief-fixture.js" YARD_TREE="${W}/frontend" YARD_OUT="${OUT}" ${views ? `YARD_VIEWS='${views}' ` : ''}npx playwright test -c "$RUN/pw.config.mjs"`;
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8', maxBuffer: 1 << 28 });
  writeFileSync(`${OUT}/surfaces-run.log`, `${res.stdout}\n${res.stderr}`);
  Object.assign(meta, { playwright_rc: res.status, ended: new Date().toISOString(), load_after: loadavg(), summary: (res.stdout.match(/\d+ (passed|failed|skipped)[^\n]*/g) || []).join('; ') });
  writeFileSync(`${OUT}/surfaces-meta.json`, JSON.stringify(meta, null, 1));
  console.log(`tree ${head} playwright rc ${res.status}: ${meta.summary}`);
  if (res.status) console.log(res.stdout.split('\n').filter(l => /Error|no rule|✘/.test(l)).slice(0, 20).join('\n'));
  merge(OUT); table(OUT);
  process.exit(res.status ? 1 : 0);
} else if (cmd === 'merge') { merge(resolve(args[0])); }
else if (cmd === 'table') { table(resolve(args[0])); }
else if (cmd === 'diff') {
  const [a0, b0, allowFile] = args;
  const A = JSON.parse(readFileSync(`${a0}/surfaces.json`, 'utf8')), B = JSON.parse(readFileSync(`${b0}/surfaces.json`, 'utf8'));
  const allow = allowFile ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];
  const ok = (state, surface, change) => allow.find(x => x.change === change && (!x.state || new RegExp(x.state).test(state)) && (!x.surface || new RegExp(x.surface).test(surface)));
  const out = [];
  for (const id of [...new Set([...Object.keys(A), ...Object.keys(B)])].sort()) {
    const a = A[id], b = B[id];
    if (!a || !b) { out.push({ id, surface: '-', change: a ? 'stateMissingInSlice' : 'stateMissingInBase', detail: '' }); continue; }
    for (const name of [...new Set([...Object.keys(a.surfaces), ...Object.keys(b.surfaces)])].sort()) {
      const x = a.surfaces[name], y = b.surfaces[name];
      const r = s => (!s || s.absent ? 'absent' : `${s.answer}/${s.figure}`);
      if (r(x) === r(y)) continue;
      const change = !x || x.absent ? 'added' : !y || y.absent ? 'removed' : 'reading';
      out.push({ id, surface: name, change, detail: `${r(x)} -> ${r(y)} ${y?.text ? `「${y.text.replace(/\s+/g, ' ').slice(0, 90)}」` : ''}` });
    }
    for (const f of Object.keys(a.agree)) if (a.agree[f] && !b.agree[f]) out.push({ id, surface: 'agree', change: 'flag', detail: `${f}: true -> false` });
  }
  let fails = 0;
  for (const d of out) { const hit = ok(d.id, d.surface, d.change); if (!hit) fails++; console.log(`${hit ? 'allowed' : 'FAIL'}\t${d.id}\t${d.surface}\t${d.change}\t${d.detail}${hit ? `\t(${hit.reason})` : ''}`); }
  console.log(JSON.stringify({ differences: out.length, failures: fails }));
  process.exit(fails ? 1 : 0);
} else if (cmd) { console.error(`unknown command ${cmd}`); process.exit(2); }
