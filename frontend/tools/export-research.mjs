import { createHash } from 'node:crypto';
// Daily, reproducible candidate snapshots use the exact same rules as the UI.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rankCandidates, compareReference } from '../src/static/researchEngine.js';
import { buildBookAnnotations } from '../src/components/Charts/bookAnnotations.js';
import { buildPortfolioPlan } from '../src/static/portfolioPlan.js';
import { diagnoseBookChart } from '../src/static/bookChartDiagnostics.js';
import { marketLeadership } from '../src/static/marketLeadership.js';
import { buildBookTechnicalEvidence } from '../src/static/bookTechnicalEvidence.js';
import { buildBookMarketEvidence } from '../src/static/bookMarketEvidence.js';
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
const breadth = entry.pages?.breadth?.path ? await read(entry.pages.breadth.path) : null;
let benchmark = null, financials = null, entryContext = null, currentFinancials = null;
try { currentFinancials = await read('financial-history.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { entryContext = await read('entry-context.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { benchmark = await read('book-benchmark.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (benchmark?.as_of_date !== scan.as_of_date) benchmark = { symbol: breadth?.payload?.benchmark_symbol || 'SPY', as_of_date: scan.as_of_date, bars: breadth?.payload?.benchmark_overlay || breadth?.payload?.spy_overlay || [] };
try { financials = await read('book-financials.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const marketCharts = [];
let rows = new Map();
for (const row of merged) {
  let chart = null;
  if (paths.has(row.symbol)) {
    try { chart = await read(paths.get(row.symbol)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const audit = auditDailyBars(row, chart, scan.as_of_date);
  if (row.technical_audit?.errors?.includes('同一銘柄のデータが矛盾')) { audit.errors.push('同一銘柄のデータが矛盾'); audit.valid = false; audit.values = {}; }
  const diagnostics = diagnoseBookChart(row, audit.valid ? chart : null, scan.as_of_date);
  const technical = buildBookTechnicalEvidence(row, audit.valid ? chart : null, scan.as_of_date, { benchmark });
  // Summaries in the candidate list; detailed series are recalculated on demand.
  if (technical.valid) {
    for (const value of Object.values(technical.sma200)) if (value && typeof value === 'object' && 'points' in value) delete value.points;
    delete technical.rs.points;
    for (const key of ['sixWeeks', 'thirteenWeeks']) delete technical.rs[key].points;
  }
  if (audit.valid) marketCharts.push({ symbol: row.symbol, as_of_date: scan.as_of_date, bars: chart.bars });
  const shape = audit.valid ? buildBookAnnotations(chart.bars) : null;
  const recent = audit.valid ? chart.bars.slice(-51,-1) : [];
  const averageVolume = recent.length === 50 ? recent.reduce((sum,b)=>sum+b.volume,0)/50 : null;
  const entryEvidence = { as_of_date:scan.as_of_date,
    calendar:entryContext?.as_of_date === scan.as_of_date ? entryContext.calendar : null,
    earnings:entryContext?.as_of_date === scan.as_of_date ? entryContext.earnings?.[row.symbol] || null : null,
    shape:shape ? {candidate:shape.candidate,summary:shape.summary,method:'book-diagram-heuristic'} : null,
    volumeRatio:averageVolume > 0 ? chart.bars.at(-1).volume / averageVolume : null };
  rows.set(row.symbol, { ...row, entry_evidence:entryEvidence, technical_audit: audit, book_diagnostics: diagnostics, book_technical_evidence: technical,
    financial_history: currentFinancials?.as_of_date === scan.as_of_date ? currentFinancials.results?.[row.symbol] || null : null,
    book_financials: financials?.as_of_date === scan.as_of_date ? financials.results?.[row.symbol] || null : null });
}
rows = new Map(rankVerifiedUniverse([...rows.values()]).map(row => [row.symbol, row]));
if (breadth) {
  if (breadth.payload?.current?.date === scan.as_of_date) {
    breadth.payload.book_leadership = marketLeadership([...rows.values()], scan.as_of_date);
    breadth.payload.book_market_evidence = buildBookMarketEvidence({ charts: marketCharts, asOfDate: scan.as_of_date, benchmark, expectedUniverseSize: rows.size, lookbackSessions: 60 });
    await writeFile(resolve(root, entry.pages.breadth.path), JSON.stringify(breadth));
  }
}
// Details are fetched only when a symbol is opened. Keep rule inputs in the index.
await mkdir(resolve(root, 'research-details'), {recursive:true});
const compactRows = new Map();
for (const [symbol, row] of rows) {
  const { book_diagnostics, book_technical_evidence, book_financials, research_detail_path: previousDetailPath, ...compact } = row;
  void previousDetailPath;
  const detail = {...compact, symbol, as_of_date:scan.as_of_date, book_diagnostics, book_technical_evidence, book_financials};
  const content = JSON.stringify(detail);
  const hash = createHash('sha256').update(content).digest('hex').slice(0,16);
  const path = `research-details/${encodeURIComponent(symbol)}-${hash}.json`;
  await writeFile(resolve(root, path), content);
  compact.research_detail_path = path;
  compactRows.set(symbol, compact);
}
const listFields = 'symbol company_name exchange currency market current_price price_change_1d adv_usd gics_sector ibd_industry_group ibd_group_rank passes_template rs_rating rs_method rs_universe_size rs_as_of_date eps_rating composite_rating annual_eps_growth_3y institutional_sponsors_increasing eps_growth_yy sales_growth_yy se_volume_vs_50d market_regime market_above_50dma market_above_200dma technical_audit financial_history entry_evidence se_pivot_price vcp_pivot se_pattern_confidence se_setup_ready vcp_detected se_base_length_weeks se_base_depth_pct research_detail_path week_52_high_distance'.split(' ');
const researchIndex = {as_of_date:scan.as_of_date, rows:[...compactRows.values()].map(row => Object.fromEntries(listFields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])))};
const researchContent = JSON.stringify(researchIndex);
manifest.research_generation = createHash('sha256').update(researchContent).digest('hex');
const researchPath = `research-index-${manifest.research_generation.slice(0,16)}.json`;
await writeFile(resolve(root, researchPath), researchContent);
entry.assets.research = {path:researchPath};
await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest));

// Stamp the generated bundle, so every UI and the portfolio share verified data.
scan.initial_rows = (scan.initial_rows || []).map(r => compactRows.get(r?.symbol)).filter(Boolean);
await writeFile(resolve(root, entry.pages.scan.path), JSON.stringify(scan));
for (const { path, payload } of chunks) {
  payload.rows = (payload.rows || []).map(r => compactRows.get(r?.symbol)).filter(Boolean);
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
  schema_version: 1, rule_version: 'research-v5-book-evidence', as_of_date: scan.as_of_date,
  generated_at: manifest.generated_at, universe_size: rows.size, ratings: 'independent_estimates',
  liquidity: { min_price_usd: 10, min_average_dollar_volume: 20000000 },
  candidates, ibd_comparison: compareReference(candidates.ibd, reference, scan.as_of_date),
}, null, 2));
console.log(`Daily research exported for ${scan.as_of_date}: ${rows.size} rows.`);
