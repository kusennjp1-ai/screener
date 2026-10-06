import { loadFinancialGenerationCarry } from './financial-generation-carry.mjs';
import { orderResearchExportRows } from './research-export-order.mjs';
import { applicabilityUniverse } from '../src/static/instrumentApplicability.js';
import { loadFinancialCorrection, correctionMetadata, CORRECTION_METADATA_FIELDS, overlayFinancialCorrection, overlayFinancialChart, rewriteCorrectionChartAliases, writeCorrectionHistory } from './financial-correction-overlay.mjs';
import { FINANCIAL_FIELDS, projectFinancialRow, projectFinancialPayload, financialNextExpiry } from '../src/static/financialCurrent.js';
import { filterStaticScanRows, sortStaticScanRows } from '../src/static/scanClient.js';
import { institutionalHolderHistory } from '../src/static/institutionalHistory.js';
import { baseCountHistory } from '../src/static/baseCountHistory.js';
import { exportIndicatorHistory, entryPriceHistoryBasis } from './export-indicator-history.mjs';
import { exportWorkbench } from './export-workbench.mjs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { encodeResearchIndex } from '../src/static/researchTransport.js';
import { scanListRow } from './scan-list-payload.mjs';
import { setupEvidence } from './setup-evidence.mjs';
import { institutionalGrowth } from '../src/static/institutionalEvidence.js';
// Daily, reproducible candidate snapshots use the exact same rules as the UI.
import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rankCandidates, compareReference, assess, RULE_SUMMARY_VERSION } from '../src/static/researchEngine.js';
import { buildBookAnnotations } from '../src/components/Charts/bookAnnotations.js';
import { buildPortfolioPlan } from '../src/static/portfolioPlan.js';
import { diagnoseBookChart } from '../src/static/bookChartDiagnostics.js';
import { marketLeadership } from '../src/static/marketLeadership.js';
import { buildBookTechnicalEvidence } from '../src/static/bookTechnicalEvidence.js';
import { buildBookMarketEvidence } from '../src/static/bookMarketEvidence.js';
import { auditDailyBars, mergeScanRows, rankVerifiedUniverse, AUDIT_VERSION } from '../src/static/qualificationAudit.js';

const root = resolve('public/static-data');
const evaluatedAt = process.env.FINANCIAL_EVALUATED_AT ? Date.parse(process.env.FINANCIAL_EVALUATED_AT) : Date.now();
if (!Number.isFinite(evaluatedAt)) throw Error('Invalid financial evaluation instant');
const currentEvaluation={financial_evaluated_at:evaluatedAt,financial_semantics:'current_at_evaluation_not_historical_publication',assessment_version:RULE_SUMMARY_VERSION};
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
// initial_rows is rewritten in UI sort order below. Preserve canonical export
// order across rebuilds while recalculating every value from the current scan.
const merged = await orderResearchExportRows(mergeScanRows([scan, ...chunks.map(c => c.payload)], scan.as_of_date), resolve('public/qualification-audit.json'), scan.as_of_date);
const carry = await loadFinancialGenerationCarry({rows:merged,asOfDate:scan.as_of_date});
const correction = carry || await loadFinancialCorrection({rows:merged,asOfDate:scan.as_of_date});
const correctionMeta = correctionMetadata(correction);
Object.assign(currentEvaluation,correctionMeta);
if(correction) Object.assign(manifest,correctionMeta);
const chartIndex = await read(entry.assets.charts.path);
const paths = new Map((chartIndex.symbols || []).map(c => [c.symbol, c.path]));
const breadth = entry.pages?.breadth?.path ? await read(entry.pages.breadth.path) : null;
let benchmark = null, financials = null, entryContext = null, currentFinancials = null, institutional = null;
try { institutional = await read('institutional-holdings.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { currentFinancials = await read('financial-history.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { entryContext = await read('entry-context.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { benchmark = await read('book-benchmark.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (benchmark?.as_of_date !== scan.as_of_date) benchmark = { symbol: breadth?.payload?.benchmark_symbol || 'SPY', as_of_date: scan.as_of_date, bars: breadth?.payload?.benchmark_overlay || breadth?.payload?.spy_overlay || [] };
try { financials = await read('book-financials.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const marketCharts = [];
const entryPriceBasis = {};
const availableCharts = new Set();
let rows = new Map();
for (const row of merged) {
  row.se_explain=row.setup_engine?.explain || null;
  row.se_candidates=row.setup_engine?.candidates || null;
  // Scores from other scanners cannot be carried across a price replacement.
  // They remain unknown until those scanners receive the repaired history too.
  if (row.price_quality?.status==='replaced' || row.setup_recalculation?.status!=='calculated') {
    for (const key of ['composite_score','composite_reason','minervini_score','canslim_score','ipo_score','custom_score','volume_breakthrough_score','rating_basis_score','rating_basis_screener','buy_risk_atr','buy_risk_state','pressure_state','pressure_value','tpr_max','tpr_score','tpr_state','pct_day','pct_week','pct_month']) row[key]=null;
  }
  const evidence = institutional?.as_of_date === scan.as_of_date ? institutional.results?.[row.symbol] : null;
  row.institutional_evidence = evidence ? {...evidence,observations:evidence.observations.map(({filings,...observation})=>{void filings;return observation;})} : null;
  row.institutional_holder_history = institutionalHolderHistory(row.institutional_evidence,row.symbol,scan.as_of_date);
  row.institutional_sponsors_increasing = institutionalGrowth(row.institutional_evidence,row.symbol,scan.as_of_date).increasing;
  let chart = null;
  if (paths.has(row.symbol)) {
    try { chart = await read(paths.get(row.symbol)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (chart) availableCharts.add(row.symbol);
  const audit = auditDailyBars(row, chart, scan.as_of_date);
  row.week_52_high_distance=audit.valid ? -audit.values.belowHigh : null;
  row.week_52_low_distance=audit.valid ? audit.values.aboveLow : null;
  // Verification-only histories need the same benchmark line as repaired and
  // ordinary charts. Never substitute an RS percentile for this price ratio.
  if (audit.valid) {
    const comparison = new Map((benchmark?.bars || []).map(b=>[b.date,b.close]));
    chart.rs_line = chart.bars.filter(b=>comparison.get(b.date)>0).map(b=>({time:b.date,value:b.close/comparison.get(b.date)}));
    await writeFile(resolve(root, paths.get(row.symbol)), JSON.stringify(chart));
  }
  const recent60 = audit.valid ? chart.bars.slice(-60) : [];
  const range60 = recent60.length === 60 ? (Math.max(...recent60.map(b=>b.high))/Math.min(...recent60.map(b=>b.low))-1)*100 : null;
  row.price_activity = {range60pct:range60,lowRange:range60 != null && range60 < 5};
  if(row.symbol==='SLAB' && scan.as_of_date >= '2026-02-04') row.corporate_action={cash_acquisition:true,label:'現金買収合意（成長株の購入候補から除外）',announced:'2026-02-04',source:'https://investor.silabs.com/news-releases/news-release-details/texas-instruments-acquire-silicon-labs'};
  if (row.technical_audit?.errors?.includes('同一銘柄のデータが矛盾')) { audit.errors.push('同一銘柄のデータが矛盾'); audit.valid = false; audit.values = {}; }
  const diagnostics = diagnoseBookChart(row, audit.valid ? chart : null, scan.as_of_date);
  const technical = buildBookTechnicalEvidence(row, audit.valid ? chart : null, scan.as_of_date, { benchmark });
  // Summaries in the candidate list; detailed series are recalculated on demand.
  if (technical.valid) {
    for (const value of Object.values(technical.sma200)) if (value && typeof value === 'object' && 'points' in value) delete value.points;
    delete technical.rs.points;
    for (const key of ['sixWeeks', 'thirteenWeeks']) delete technical.rs[key].points;
  }
  if (audit.valid) entryPriceBasis[row.symbol] = entryPriceHistoryBasis(chart, scan.as_of_date);
  if (audit.valid) marketCharts.push({ symbol: row.symbol, as_of_date: scan.as_of_date, bars: chart.bars });
  const baseHistory = baseCountHistory(audit.valid ? chart : null, row.symbol, scan.as_of_date, (benchmark?.bars || []).map(bar => bar.date));
  row.base_count_summary = {version:baseHistory.version,as_of_date:scan.as_of_date,count:baseHistory.count,origin_known:baseHistory.originKnown,complete:baseHistory.complete};
  row.base_count_history = baseHistory;
  const shape = audit.valid ? buildBookAnnotations(chart.bars) : null;
  const recent = audit.valid ? chart.bars.slice(-51,-1) : [];
  const averageVolume = recent.length === 50 ? recent.reduce((sum,b)=>sum+b.volume,0)/50 : null;
  const entryEvidence = { as_of_date:scan.as_of_date,
    calendar:entryContext?.as_of_date === scan.as_of_date ? entryContext.calendar : null,
    earnings:entryContext?.as_of_date === scan.as_of_date ? entryContext.earnings?.[row.symbol] || null : null,
    shape:setupEvidence(row,shape,scan.as_of_date),
    volumeRatio:averageVolume > 0 ? chart.bars.at(-1).volume / averageVolume : null };
  rows.set(row.symbol, projectFinancialRow(overlayFinancialCorrection({ ...row, as_of_date:scan.as_of_date, chart_path:paths.get(row.symbol) || null, entry_evidence:entryEvidence, technical_audit: audit, book_diagnostics: diagnostics, book_technical_evidence: technical,
    financial_history: currentFinancials?.as_of_date === scan.as_of_date ? currentFinancials.results?.[row.symbol] || null : null,
    book_financials: financials?.as_of_date === scan.as_of_date ? financials.results?.[row.symbol] || null : null }, correction), {now:evaluatedAt,asOfDate:scan.as_of_date}));
}
await writeCorrectionHistory(root,correction,currentFinancials);
await rewriteCorrectionChartAliases(root,correction);
rows = new Map(rankVerifiedUniverse([...rows.values()]).map(row => [row.symbol, row]));
currentEvaluation.instrument_applicability_universe=applicabilityUniverse([...rows.values()]);
if (breadth) {
  if (breadth.payload?.current?.date === scan.as_of_date) {
    breadth.payload.book_leadership = marketLeadership([...rows.values()], scan.as_of_date);
    breadth.payload.book_market_evidence = buildBookMarketEvidence({ charts: marketCharts, asOfDate: scan.as_of_date, benchmark, expectedUniverseSize: rows.size, lookbackSessions: 60 });
    breadth.payload.indicator_histories = await exportIndicatorHistory({root,rows:[...rows.values()],entry,manifest,benchmark,bookEvidence:breadth.payload.book_market_evidence,priceHistoryBasis:entryPriceBasis,now:evaluatedAt});
    await writeFile(resolve(root, entry.pages.breadth.path), JSON.stringify(breadth));
  }
}
// Details are fetched only when a symbol is opened. Keep rule inputs in the index.
await mkdir(resolve(root, 'research-details'), {recursive:true});
await mkdir(resolve(root, 'verified-charts'), {recursive:true});
const compactRows = new Map();
const currentDetails=new Set();
const currentCharts=new Set();
for (const row of rows.values()) {
  row.passes_template=row.technical_audit.valid ? assess(row,'minervini',evaluatedAt).qualified : null;
  row.method_summary = {version:RULE_SUMMARY_VERSION,evaluated_at:evaluatedAt,next_expiry_at:financialNextExpiry([row],evaluatedAt)};
  for (const method of ['minervini','minervini2','oneil','ibd']) {
    const {rules,...summary} = assess(row,method,evaluatedAt); row.method_summary[method] = summary;
  }
}
for (const [symbol, row] of rows) {
  let canonicalChart=null;
  if (availableCharts.has(symbol)) {
    canonicalChart=projectFinancialPayload(overlayFinancialChart(await read(paths.get(symbol)),correction,symbol),{now:evaluatedAt,asOfDate:scan.as_of_date,market:row.market});
    Object.assign(canonicalChart,{signal:null,risk_plan:null,sell_plan:null,trend_template:null});
    const hashInput={...canonicalChart,stock_data:{...row,chart_path:undefined,research_detail_path:undefined}};
    const chartHash=createHash('sha256').update(JSON.stringify(hashInput)).digest('hex').slice(0,16);
    row.chart_path=`verified-charts/${encodeURIComponent(symbol)}-${chartHash}.json`;
    paths.set(symbol,row.chart_path);currentCharts.add(row.chart_path);
  }
  const { book_diagnostics, book_technical_evidence, book_financials, base_count_history, institutional_holder_history, research_detail_path: previousDetailPath, ...compact } = row;
  void previousDetailPath;
  const detail = {...compact, symbol, as_of_date:scan.as_of_date, book_diagnostics, book_technical_evidence, book_financials, base_count_history, institutional_holder_history};
  const content = JSON.stringify(detail);
  const hash = createHash('sha256').update(content).digest('hex').slice(0,16);
  const path = `research-details/${encodeURIComponent(symbol)}-${hash}.json`;
  await writeFile(resolve(root, path), content);
  currentDetails.add(path);
  compact.research_detail_path = path;
  compactRows.set(symbol, compact);
  if (canonicalChart) {
    canonicalChart.stock_data=scanListRow(compact);
    // Canonical detail is shared even when a chart is opened outside research.
    await writeFile(resolve(root,paths.get(symbol)),JSON.stringify(canonicalChart));
  }
}
chartIndex.symbols=chartIndex.symbols.map(item=>availableCharts.has(item.symbol)?{...item,path:paths.get(item.symbol)}:item);
if(correction) Object.assign(chartIndex,correctionMeta);
const chartIndexContent=JSON.stringify(chartIndex),chartIndexHash=createHash('sha256').update(chartIndexContent).digest('hex').slice(0,16);
const chartIndexPath=`charts-index-${chartIndexHash}.json`;
await writeFile(resolve(root,chartIndexPath),chartIndexContent);
entry.assets.charts={...entry.assets.charts,...correctionMeta,path:chartIndexPath};
scan.charts={...scan.charts,...correctionMeta,path:chartIndexPath};
const listFields = ([...FINANCIAL_FIELDS,...CORRECTION_METADATA_FIELDS].join(' ')+' name product_name quoteType quote_type cusip isin cik issuer_cik instrument_identity instrument_applicability financial_identity financial_current as_of_date eps_growth_quarterly eps_growth_annual institutional_evidence base_count_summary setup_recalculation price_quality corporate_action price_activity chart_path symbol company_name exchange currency market current_price price_change_1d adv_usd gics_sector ibd_industry_group ibd_group_rank passes_template rs_rating rs_method rs_universe_size rs_as_of_date eps_rating composite_rating annual_eps_growth_3y institutional_sponsors_increasing eps_growth_yy sales_growth_yy se_volume_vs_50d market_regime market_above_50dma market_above_200dma technical_audit financial_history entry_evidence se_pivot_price vcp_pivot se_pattern_confidence se_setup_ready vcp_detected se_base_length_weeks se_base_depth_pct research_detail_path week_52_high_distance').split(' ');
const researchIndex = {...currentEvaluation,summary_storage:'canonical-detail-v1',as_of_date:scan.as_of_date, rows:[...compactRows.values()].map(row => {
  const summary=Object.fromEntries(listFields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
  // Full provenance and detector reasons remain in the content-addressed detail.
  if(row.price_quality) summary.price_quality={status:row.price_quality.status,as_of_date:row.price_quality.as_of_date};
  if(row.setup_recalculation) summary.setup_recalculation={status:row.setup_recalculation.status,as_of_date:row.setup_recalculation.as_of_date,...(row.setup_recalculation.status==='calculated'?{}:{reason:row.setup_recalculation.reason})};
  return summary;
})};
// Runtime orders are rebuilt from current inputs at each evaluation epoch.
// Omit ignored cached permutations and list summaries. Canonical detail keeps
// its independently checked publication summaries; every exact input remains.
const researchContent = JSON.stringify(encodeResearchIndex(researchIndex, undefined, {
  columnBytes: column => gzipSync(JSON.stringify(column)).length,
}));
if (Buffer.byteLength(researchContent) > 8000000 || gzipSync(researchContent).length > 1000000) {
  throw Error(`Research index exceeds its unchanged 8 MB raw / 1 MB gzip budget: ${Buffer.byteLength(researchContent)} raw / ${gzipSync(researchContent).length} gzip bytes`);
}
// The scan list has all global filter/sort values, but no full detector reports.
await mkdir(resolve(root,'scan-list'),{recursive:true});
const scanRows=[...compactRows.values()].map(scanListRow), scanChunks=[];
for(let offset=0;offset<scanRows.length;offset+=1000) {
  const content=JSON.stringify({...correctionMeta,as_of_date:scan.as_of_date,rows:scanRows.slice(offset,offset+1000)});
  const hash=createHash('sha256').update(content).digest('hex').slice(0,16);
  const path=`scan-list/chunk-${hash}.json`;await writeFile(resolve(root,path),content);
  scanChunks.push({path,count:Math.min(1000,scanRows.length-offset)});
}
const currentPresets=(scan.preset_screens || []).map(screen=>{const count=filterStaticScanRows(scanRows,screen.filters || {},{now:evaluatedAt}).length;return {...screen,match_count:screen.limit?Math.min(count,screen.limit):count};});
const filteredScanRows=sortStaticScanRows(filterStaticScanRows(scanRows,scan.default_filters || {},{now:evaluatedAt}),'se_setup_score','desc',{now:evaluatedAt});
for(const key of ['rows','results','stocks','members']) if(Array.isArray(scan[key])) scan[key]=scan[key].map(row=>compactRows.get(row?.symbol)).filter(Boolean);
const lightScan={...scan,...correctionMeta,preview_rows:filteredScanRows.slice(0,10).map(scanListRow),default_filtered_rows_total:filteredScanRows.length,preset_screens:currentPresets,financial_evaluated_at:evaluatedAt,sort:{field:'se_setup_score',order:'desc'},initial_rows:[],chunks:scanChunks,embedded_chart_paths:true};
const lightContent=JSON.stringify(lightScan),lightHash=createHash('sha256').update(lightContent).digest('hex').slice(0,16);
entry.pages.scan.list_path=`scan-list/index-${lightHash}.json`;
await writeFile(resolve(root,entry.pages.scan.list_path),lightContent);
manifest.research_generation = createHash('sha256').update(researchContent).digest('hex');
const researchPath = `research-index-${manifest.research_generation.slice(0,16)}.json`;
await writeFile(resolve(root, researchPath), researchContent);
entry.assets.research = {path:researchPath,...currentEvaluation};

// Remove only obsolete, generated hash-addressed files in these known folders.
// No source data or historical candidate snapshots are included in this cleanup.
for(const [directory,keep] of [['research-details',currentDetails],['verified-charts',currentCharts],['scan-list',new Set([entry.pages.scan.list_path,...scanChunks.map(c=>c.path)])]]) {
  for(const name of await readdir(resolve(root,directory))) {
    const relative=`${directory}/${name}`;
    if(/-[a-f0-9]{16}\.json$/.test(name) && !keep.has(relative)) await unlink(resolve(root,relative));
  }
}
for(const name of await readdir(root)) if(/^research-index-[a-f0-9]{16}\.json$/.test(name) && name!==researchPath) await unlink(resolve(root,name));
for(const name of await readdir(root)) if(/^charts-index-[a-f0-9]{16}\.json$/.test(name) && name!==chartIndexPath) await unlink(resolve(root,name));

// Stamp the generated bundle, so every UI and the portfolio share verified data.
scan.preset_screens = currentPresets;
scan.financial_evaluated_at=evaluatedAt;
if(correction) Object.assign(scan,correctionMeta);
scan.sort={field:'se_setup_score',order:'desc'};
scan.default_filtered_rows_total=filteredScanRows.length;
scan.preview_rows=filteredScanRows.slice(0,10).map(scanListRow);
scan.initial_rows = sortStaticScanRows(filterStaticScanRows([...compactRows.values()],scan.default_filters || {},{now:evaluatedAt}),'se_setup_score','desc',{now:evaluatedAt}).slice(0,50).map(row=>compactRows.get(row.symbol));
await writeFile(resolve(root, entry.pages.scan.path), JSON.stringify(scan));
for (const { path, payload } of chunks) {
  payload.rows = (payload.rows || []).map(r => compactRows.get(r?.symbol)).filter(Boolean);
  if(correction) Object.assign(payload,correctionMeta);
  for(const key of ['initial_rows','preview_rows','results','stocks','members']) if(Array.isArray(payload[key])) payload[key]=payload[key].map(row=>compactRows.get(row?.symbol)).filter(Boolean);
  await writeFile(resolve(root, path), JSON.stringify(payload));
}
const verification = [...rows.values()].map(row => ({ symbol: row.symbol, audit: row.technical_audit,
  methods: Object.fromEntries(['minervini', 'minervini2', 'ibd'].map(method => { const a = assess(row, method,evaluatedAt); return [method, a || null]; })) }));
await writeFile('public/qualification-audit.json', JSON.stringify({ ...currentEvaluation, version: AUDIT_VERSION, as_of_date: scan.as_of_date,
  generated_at: manifest.generated_at, independently_recalculated: verification.filter(r => r.audit.valid).length,
  total: rows.size, results: verification }));
const candidates = Object.fromEntries(['oneil', 'minervini', 'minervini2', 'ibd'].map(method => [method,
  rankCandidates([...rows.values()], method, { liquidOnly: true, now:evaluatedAt }).filter(r => r.assessment.qualified).slice(0, 50).map(({ row, assessment }) => ({ symbol: row.symbol, rs_estimate: row.rs_rating, passed: assessment.passed, total: assessment.total }))]));
// Only explicitly verified references are eligible. Old lists remain historical;
// they can never inflate today's overlap. No scraping or invented IBD membership.
let reference = null;
const referenceDir = resolve('../data/ibd_reference/ibd50');
for (const file of (await readdir(referenceDir)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()) {
  const value = JSON.parse(await readFile(resolve(referenceDir, file), 'utf8'));
  if (value.verified === true && value.as_of_date === scan.as_of_date && value.source && value.constituents?.length) { reference = value; break; }
}
await writeFile('public/ibd-reference.json', JSON.stringify(reference));
await writeFile('public/portfolio-model.json', JSON.stringify({ ...currentEvaluation, model_version: 'cash-first-v1', source_generated_at: manifest.generated_at, ...buildPortfolioPlan([...rows.values()], scan.as_of_date,100000,evaluatedAt) }, null, 2));
await writeFile('public/research-daily.json', JSON.stringify({
  ...currentEvaluation, schema_version: 1, rule_version: 'research-v6-static-financial-current', as_of_date: scan.as_of_date,
  generated_at: manifest.generated_at, universe_size: rows.size, ratings: 'independent_estimates',
  liquidity: { min_price_usd: 10, min_average_dollar_volume: 20000000 },
  candidates, ibd_comparison: compareReference(candidates.ibd, reference, scan.as_of_date),
}, null, 2));
console.log(`Daily research exported for ${scan.as_of_date}: ${rows.size} rows.`);

const liquid=[...rows.values()].filter(r=>r.current_price>=10&&r.adv_usd>=20000000);
const failures={};for(const row of liquid)for(const reason of row.technical_audit.errors)failures[reason]=(failures[reason]||0)+1;
await writeFile(resolve(root,'data-quality.json'),JSON.stringify({as_of_date:scan.as_of_date,total:liquid.length,verified:liquid.filter(r=>r.technical_audit.valid).length,reasons:failures,rs_universe:[...rows.values()][0]?.rs_universe_size,minimum_target:.9}));

await exportWorkbench({root,rows:[...rows.values()],manifest,entry,researchContent,now:evaluatedAt,financialCorrection:correctionMeta});
// Publish the manifest pointer only after every referenced asset is complete.
await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest));
