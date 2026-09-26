// Daily, reproducible candidate snapshots use the exact same rules as the UI.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rankCandidates, compareReference } from '../src/static/researchEngine.js';
import { buildPortfolioPlan } from '../src/static/portfolioPlan.js';
import { diagnoseBookChart } from '../src/static/bookChartDiagnostics.js';
import { marketLeadership } from '../src/static/marketLeadership.js';
import { auditDailyBars, mergeScanRows, rankVerifiedUniverse, AUDIT_VERSION } from '../src/static/qualificationAudit.js';

const root = resolve('public/static-data');
async function read(relative) {
  const path = resolve(root, relative);
  if (!path.startsWith(root + '/') && !path.startsWith(root + '\\')) throw Error('Invalid data path');
  return JSON.parse(await readFile(path, 'utf8'));
}
let manifest;
try { manifest = await read('manifest.json'); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Daily research export skipped: no local static-data bundle.');
  process.exit(0);
}
const entry = manifest.markets?.US || manifest;
const scan = await read(entry.pages.scan.path);
const chunks = [];
for (const chunk of scan.chunks || []) {
  const payload = await read(chunk.path);
  chunks.push({ path: chunk.path, payload });
}
if (entry.as_of_date !== scan.as_of_date) throw Error('Manifest / scan date mismatch');
const merged = mergeScanRows([scan, ...chunks.map(c => c.payload)], scan.as_of_date);
const chartIndex = await read(entry.assets.charts.path);
const paths = new Map((chartIndex.symbols || []).map(c => [c.symbol, c.path]));
let rows = new Map();
for (const row of merged) {
  let chart = null;
  if (paths.has(row.symbol)) {
    try { chart = await read(paths.get(row.symbol)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const audit = auditDailyBars(row, chart, scan.as_of_date);
  if (row.technical_audit?.errors?.includes('同一銘柄のデータが矛盾')) { audit.errors.push('同一銘柄のデータが矛盾'); audit.valid = false; audit.values = {}; }
  const diagnostics = diagnoseBookChart(row, audit.valid ? chart : null, scan.as_of_date);
  rows.set(row.symbol, { ...row, technical_audit: audit, book_diagnostics: diagnostics });
}
rows = new Map(rankVerifiedUniverse([...rows.values()]).map(row => [row.symbol, row]));
if (entry.pages?.breadth?.path) {
  const breadth = await read(entry.pages.breadth.path);
  if (breadth.payload?.current?.date === scan.as_of_date) {
    breadth.payload.book_leadership = marketLeadership([...rows.values()], scan.as_of_date);
    await writeFile(resolve(root, entry.pages.breadth.path), JSON.stringify(breadth));
  }
}
// Stamp the generated bundle, so every UI and the portfolio share verified data.
scan.initial_rows = (scan.initial_rows || []).map(r => rows.get(r?.symbol)).filter(Boolean);
await writeFile(resolve(root, entry.pages.scan.path), JSON.stringify(scan));
for (const { path, payload } of chunks) {
  payload.rows = (payload.rows || []).map(r => rows.get(r?.symbol)).filter(Boolean);
  await writeFile(resolve(root, path), JSON.stringify(payload));
}
const verification = [...rows.values()].map(row => ({ symbol: row.symbol, audit: row.technical_audit,
  methods: Object.fromEntries(['minervini', 'minervini2', 'ibd'].map(method => { const a = rankCandidates([row], method)[0]?.assessment; return [method, a || null]; })) }));
await writeFile('public/qualification-audit.json', JSON.stringify({ version: AUDIT_VERSION, as_of_date: scan.as_of_date,
  generated_at: manifest.generated_at, independently_recalculated: verification.filter(r => r.audit.valid).length,
  total: rows.size, results: verification }));
const candidates = Object.fromEntries(['oneil', 'minervini', 'minervini2', 'ibd'].map(method => [method,
  rankCandidates([...rows.values()], method, { liquidOnly: true }).filter(r => r.assessment.qualified).slice(0, 50).map(({ row, assessment }) => ({ symbol: row.symbol, rs_estimate: row.rs_rating, passed: assessment.passed, total: assessment.total }))]));
// Only explicitly verified references are eligible. Old lists remain historical;
// they can never inflate today's overlap. No scraping or invented IBD membership.
let reference = null;
const referenceDir = resolve('../data/ibd_reference/ibd50');
for (const file of (await readdir(referenceDir)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()) {
  const value = JSON.parse(await readFile(resolve(referenceDir, file), 'utf8'));
  if (value.verified === true && value.as_of_date === scan.as_of_date && value.source && value.constituents?.length) { reference = value; break; }
}
await writeFile('public/ibd-reference.json', JSON.stringify(reference));
await writeFile('public/portfolio-model.json', JSON.stringify({ model_version: 'cash-first-v1', source_generated_at: manifest.generated_at, ...buildPortfolioPlan([...rows.values()], scan.as_of_date) }, null, 2));
await writeFile('public/research-daily.json', JSON.stringify({
  schema_version: 1, rule_version: 'research-v4-book-profiles', as_of_date: scan.as_of_date,
  generated_at: manifest.generated_at, universe_size: rows.size, ratings: 'independent_estimates',
  liquidity: { min_price_usd: 10, min_average_dollar_volume: 20000000 },
  candidates, ibd_comparison: compareReference(candidates.ibd, reference, scan.as_of_date),
}, null, 2));
console.log(`Daily research exported for ${scan.as_of_date}: ${rows.size} rows.`);
