#!/usr/bin/env node
// SCRATCH (ui-abc yardstick, never committed): the per-row ledger of plan §5.4 on the 11-12 rebuild.
//   node ledger.mjs run <worktree> <outdir> [--serve <rebuild serve dir>] [--listed <rows.jsonl>]
//       Archives <worktree>'s HEAD (frontend: commit before you measure) into
//       yard/trees/<head7>/, bundles the tree's OWN modules with esbuild from <outdir> (relative paths: byte-stable), pins the
//       clock (Date.now and new Date() read the rebuild's evaluation instant) and, for every certified listed row under three
//       markets — `pub` (the rows as published, with the feature run's market fields restored as the snapshot's eval-sell.mjs
//       restores them), `f50` (every row confirmed_uptrend above both lines: modelMarket gives 上昇トレンド, 50%) and `unk`
//       (every row's 50-day field missing: modelMarket gives 市場未確認) — writes one JSONL line with:
//         gate   buyGate {kind, reason, reference, title}  (as StockVerdict.jsx:120 calls it: no `broken`, `earnings` = the call)
//         plan   positionPlan {basis, entry, stop, shares, r2, r3, trialOnly, referenceReason, blocked}, unrounded (as
//                usePositionPlan, StockPlanCard.jsx:34-43, calls it: default settings, `technical` = StockView's evidence,
//                `judged` = certified bars, `broken` from the sells, the earnings days/soon, no `sells`)
//         tally  the sell tally {hits, strengthHits, weaknessHits, breakdownHits, cautions, unknowns} (StockView.jsx:54)
//         chip   sellChipView(sells).text      pivot  pivotDistanceText(view)
//       → <outdir>/ledger.jsonl, <outdir>/ledger.sha256, <outdir>/ledger-meta.json (tree, dirty state, markets, counts; outside
//       the hash). A dirty worktree is recorded there and warned about (the ledger measures HEAD, not the working tree).
//   node ledger.mjs diff <a/ledger.jsonl> <b/ledger.jsonl> [--allow <field regex>]
//       Field-level differences per (symbol, market); exit 1 on any not matched by --allow.
// The wiring is main 01066ebe's StockView/StockVerdict/usePositionPlan. A slice that changes a call site (not a module) must
// mirror it here; the research detail is not merged (the rebuild serves no details), as in the snapshot's eval-sell.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const Y = '$SCRATCH/ui-abc/yard';
const H = '$SCRATCH/audit3/r3-harness';
const MARKET_FIELDS = '$SCRATCH/audit3/p4-risk-sell-regime/work/market_fields.json';
const DATE = '2026-11-12', NOW = Date.parse('2026-11-13T11:10:31Z');   // the rebuild's (snapshot eval-sell.mjs:8-9)
const sha = text => createHash('sha256').update(text).digest('hex');
const [, , cmd, ...args] = process.argv;
const flag = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };

async function run(W0, OUT0, serve, listedFile) {
  const W = resolve(W0), OUT = resolve(OUT0);
  mkdirSync(OUT, { recursive: true });
  const head = execFileSync('git', ['-C', W, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  // The ledger reads `git archive HEAD`, never the working tree: a dirty tree is recorded (ledger-meta.json) and warned about,
  // because what is measured is then not what is on disk.
  const status = execFileSync('git', ['-C', W, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim();
  const dirty = status ? `dirty: ${status.split('\n').slice(0, 5).join('; ')}${status.split('\n').length > 5 ? '; …' : ''}` : 'clean';
  if (status) console.error(`warning: ${W} is ${dirty}; the ledger measures HEAD ${head} only`);
  const T = `${Y}/trees/${head}`;
  if (!existsSync(`${T}/frontend/contracts`)) {
    mkdirSync(T, { recursive: true });
    execFileSync('bash', ['-c', `git -C "${W}" archive HEAD frontend | tar -x -C "${T}" && ln -sfn "$(readlink -f "${W}/frontend/node_modules")" "${T}/frontend/node_modules"`]);
  }
  const F = `${T}/frontend`;
  writeFileSync(`${OUT}/ledger-entry.mjs`, [
    `export * as cand from '${F}/src/static/brief/briefCandidate.js';`,
    `export * as engine from '${F}/src/static/researchEngine.js';`,
    `export * as gate from '${F}/src/static/brief/buyGate.js';`,
    `export * as sizing from '${F}/src/static/brief/positionSizing.js';`,
    `export * as sell from '${F}/src/static/brief/briefSell.js';`,
    `export * as history from '${F}/src/static/brief/breakoutHistory.js';`,
    `export { certifyBars } from '${F}/src/static/brief/useBriefData.js';`,
    `export { buildBookTechnicalEvidence, BOOK_TECHNICAL_VERSION } from '${F}/src/static/bookTechnicalEvidence.js';`,
    `export { diagnoseBookChart } from '${F}/src/static/bookChartDiagnostics.js';`,
    `export { modelMarket } from '${F}/src/static/portfolioPlan.js';`,
  ].join('\n') + '\n');
  execFileSync(`${F}/node_modules/.bin/esbuild`, ['ledger-entry.mjs', '--bundle', '--platform=node', '--format=esm', '--log-level=error',
    '--define:import.meta.env={"DEV":false,"PROD":true,"MODE":"production","BASE_URL":"/","VITE_STATIC_SITE":"true"}', '--outfile=ledger-bundle.mjs'], { cwd: OUT });
  // Pin the clock before the tree's code loads (earningsCall, trendTemplate and freshness read Date.now / new Date()).
  const RealDate = Date;
  class PinnedDate extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
  globalThis.Date = PinnedDate;
  const m = await import(`${OUT}/ledger-bundle.mjs`);
  const research = JSON.parse(readFileSync(`${serve}/research.json`, 'utf8'));
  const fields = JSON.parse(readFileSync(MARKET_FIELDS, 'utf8'));
  const listed = new Set(readFileSync(listedFile, 'utf8').trim().split('\n').map(l => JSON.parse(l).symbol));
  const published = research.rows.map(r => ({ ...r, ...(fields[r.symbol] ? { market_above_50dma: fields[r.symbol].market_above_50dma, market_above_200dma: fields[r.symbol].market_above_200dma } : {}) }));
  const MARKETS = [
    ['pub', m.modelMarket(published)],
    ['f50', m.modelMarket(published.map(r => ({ ...r, market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true })))],
    ['unk', m.modelMarket(published.map(r => ({ ...r, market_above_50dma: null })))],
  ];
  const ranking = m.engine.rankCandidates(published, 'minervini', { now: NOW });
  const settings = m.sizing.readPlanSettings({});   // readPlan() with nothing stored (StockPlanCard.jsx:16)
  const lines = [];
  let certified = 0, evaluated = 0;
  for (const item of [...ranking].sort((a, b) => (a.row.symbol < b.row.symbol ? -1 : a.row.symbol > b.row.symbol ? 1 : 0))) {
    const row = item.row, symbol = row.symbol;
    if (!listed.has(symbol)) continue;
    evaluated++;
    const path = `${serve}/charts/${symbol}.json`, chart = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
    const cert = chart ? m.certifyBars(row, chart, DATE) : { certified: false };
    if (cert.certified !== true) continue;
    certified++;
    // useStockData (useBriefData.js:140-171) and StockView (StockView.jsx:35-60)
    const view = m.cand.candidateView({ row, assessment: item.assessment }, DATE);
    const template = m.cand.trendTemplate(row, NOW);
    const bars = chart.bars?.length ? chart.bars : null, judged = bars;
    let technical = null;
    if (row?.book_technical_evidence?.vcp) technical = row.book_technical_evidence;
    else if (bars) { try { technical = m.buildBookTechnicalEvidence(row, chart, DATE); } catch { technical = null; } }
    let evidence = null;
    if (technical) {
      if (technical.version === m.BOOK_TECHNICAL_VERSION || technical.vcp?.source === 'reviewer-intervals') evidence = technical;
      else { try { evidence = { ...technical, vcp: m.buildBookTechnicalEvidence(row, chart, DATE).vcp ?? null }; } catch { evidence = { ...technical, vcp: null }; } }
    }
    let diagnostics = null;
    if (row?.book_diagnostics && row.book_diagnostics.as_of_date === DATE) diagnostics = row.book_diagnostics;
    else if (bars) { try { diagnostics = m.diagnoseBookChart(row, chart, DATE); } catch { diagnostics = null; } }
    const sells = m.sell.stockSells({ judged, diagnostics, view, from: m.history.crossingFloor(judged, view?.row) });
    const broken = Array.isArray(sells?.weakness) && sells.weakness.some(m.sell.isBreakdown);
    const call = m.cand.earningsCall(view, NOW), soon = Boolean(call?.soon), days = call?.days, csoon = call?.soon;
    const tally = sells ? Object.fromEntries(['hits', 'strengthHits', 'weaknessHits', 'breakdownHits', 'cautions', 'unknowns'].map(k => [k, sells[k] ?? null])) : null;
    const chip = m.sell.sellChipView(sells)?.text ?? null, pivot = m.cand.pivotDistanceText(view);
    for (const [mid, market] of MARKETS) {
      const g = m.gate.buyGate({ view, template, market, sells, earnings: call, judged });
      const p = m.sizing.positionPlan(view, settings, { market, template, technical: evidence, judged, broken, earningsSoon: soon, earnings: csoon === undefined ? null : { days, soon: csoon }, sells: null });
      const plan = p === null ? null : p.blocked ? { blocked: p.blocked } : { basis: p.basis, entry: p.entry, stop: p.stop, shares: p.shares, r2: p.r2, r3: p.r3, trialOnly: p.trialOnly, referenceReason: p.referenceReason, blocked: null };
      lines.push(JSON.stringify({ symbol, market: mid, gate: { kind: g.kind, reason: g.reason ?? null, reference: g.reference ?? null, title: g.title ?? null }, plan, tally, chip, pivot }));
    }
  }
  globalThis.Date = RealDate;
  const text = lines.join('\n') + '\n';
  writeFileSync(`${OUT}/ledger.jsonl`, text);
  writeFileSync(`${OUT}/ledger.sha256`, `${sha(text)}  ledger.jsonl\n`);
  const meta = { tree: head, dirty, worktree: W, serve, listed: listed.size, evaluated, certified, lines: lines.length, markets: Object.fromEntries(MARKETS.map(([k, v]) => [k, `${v.label} cap ${v.cap}`])), bundle_sha256: sha(readFileSync(`${OUT}/ledger-bundle.mjs`)) };
  writeFileSync(`${OUT}/ledger-meta.json`, JSON.stringify(meta, null, 1));
  console.log(`${sha(text)}  ledger.jsonl`);
  console.log(JSON.stringify(meta));
}

function diff(a, b, allowRe) {
  const load = f => new Map(readFileSync(f, 'utf8').trim().split('\n').map(l => { const o = JSON.parse(l); return [`${o.symbol} ${o.market}`, o]; }));
  const A = load(a), B = load(b);
  const flat = (o, p = '') => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [[p, o]]);
  let fails = 0, diffs = 0;
  for (const key of [...new Set([...A.keys(), ...B.keys()])].sort()) {
    const x = A.get(key), y = B.get(key);
    if (!x || !y) { diffs++; fails++; console.log(`FAIL\t${key}\t${x ? 'missing in b' : 'missing in a'}`); continue; }
    const fx = new Map(flat(x)), fy = new Map(flat(y));
    for (const f of [...new Set([...fx.keys(), ...fy.keys()])].sort()) {
      if (JSON.stringify(fx.get(f)) === JSON.stringify(fy.get(f))) continue;
      diffs++;
      const ok = allowRe && new RegExp(allowRe).test(f);
      if (!ok) fails++;
      console.log(`${ok ? 'allowed' : 'FAIL'}\t${key}\t${f}\t${JSON.stringify(fx.get(f))} -> ${JSON.stringify(fy.get(f))}`);
    }
  }
  console.log(JSON.stringify({ rows_a: A.size, rows_b: B.size, differences: diffs, failures: fails }));
  return fails;
}

if (cmd === 'run') {
  const serve = resolve(flag('--serve') || `${H}/snapshot/out/bd20584/serve`), listed = resolve(flag('--listed') || `${H}/snapshot/out/bd20584/rows.jsonl`);
  await run(args[0], args[1], serve, listed);
} else if (cmd === 'diff') {
  const allow = flag('--allow');
  process.exit(diff(args[0], args[1], allow) ? 1 : 0);
} else { console.error('usage: ledger.mjs run <worktree> <outdir> [--serve dir] [--listed rows.jsonl] | diff <a.jsonl> <b.jsonl> [--allow re]'); process.exit(2); }
