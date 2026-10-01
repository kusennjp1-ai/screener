import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { prepareResearchBundle } from '../src/static/researchPreprocess.js';
import { sectorStrength } from '../src/static/sectorStrength.js';
import { assess, assessmentSummary, rankCandidates, researchCsv, RULE_SUMMARY_VERSION } from '../src/static/researchEngine.js';
import {canonicalPivot} from '../src/static/researchPresentation.js';
import {buildPortfolioPlan} from '../src/static/portfolioPlan.js';
import {filterStaticScanRows,sortStaticScanRows} from '../src/static/scanClient.js';
const read=async path=>JSON.parse(await readFile(`public/static-data/${path}`,'utf8'));
const manifest=await read('manifest.json');
const indexPath=(manifest.markets?.US||manifest).assets.research.path;
const wireRaw=await readFile(`public/static-data/${indexPath}`);
const wire=JSON.parse(wireRaw.toString('utf8'));
const index=decodeResearchIndex(wire);
const prepared=prepareResearchBundle([wire],index.as_of_date);
if(wire.schema && (wireRaw.length>8000000 || gzipSync(wireRaw).length>1000000)) throw Error(`Research payload budget exceeded: ${wireRaw.length} raw / ${gzipSync(wireRaw).length} gzip bytes`);
for(const method of ['minervini','minervini2','oneil','ibd']) {
  if(prepared.rankings[method].map(item=>item.row.symbol).join(',')!==rankCandidates(index.rows,method).map(item=>item.row.symbol).join(',')) throw Error(`Exported ranking differs: ${method}`);
}
const quality=await read('data-quality.json');
for(const row of index.rows) for(const method of ['minervini','minervini2','oneil','ibd']) {
  const {rules,...expected}=assess(row,method); void rules;
  if(row.method_summary?.version!==RULE_SUMMARY_VERSION || JSON.stringify(expected)!==JSON.stringify(assessmentSummary(row,method))) throw Error(`Rule summary mismatch: ${row.symbol}/${method}`);
}
if(!quality.total || quality.as_of_date!==index.as_of_date || quality.verified/quality.total<.9) {
  throw Error(`Daily verification below 90%: ${quality.verified}/${quality.total}. Keep last good publication and repair the source; never relax selection criteria.`);
}
console.log(`Quality gate passed: ${quality.verified}/${quality.total} verified; all exported assessments reproduce.`);

const market=manifest.markets?.US||manifest;
const scan=await read(market.pages.scan.list_path);
const list=[];
for(const chunk of scan.chunks) {
  const payload=await read(chunk.path);
  if(payload.as_of_date!==index.as_of_date) throw Error('Mixed scan-list dates');
  list.push(...payload.rows);
}
const bySymbol=new Map(list.map(r=>[r.symbol,r]));
if(list.length!==index.rows.length || bySymbol.size!==list.length) throw Error('Scan-list universe differs');
const scalarFields=['current_price','se_pivot_price','vcp_pivot','se_setup_ready','rs_rating','passes_template','institutional_sponsors_increasing'];
const canonicalRows=[];
for(const row of index.rows) {
  const entry=bySymbol.get(row.symbol);
  for(const key of scalarFields) if(entry[key]!==row[key]) throw Error(`Cross-view value mismatch: ${row.symbol}/${key}`);
  if(row.setup_recalculation?.status!=='calculated' && (canonicalPivot(row).price || row.se_setup_ready)) throw Error(`Stale failed setup: ${row.symbol}`);
  // Every compact row must reproduce the full canonical inputs, not merely
  // agree with its own exported summary (which could hide transport drift).
  const detail=await read(row.research_detail_path);
  canonicalRows.push(detail);
  for(const method of ['minervini','minervini2','oneil','ibd']) {
    if(JSON.stringify(assess(row,method))!==JSON.stringify(assess(detail,method))) throw Error(`Canonical detail rule mismatch: ${row.symbol}/${method}`);
    if(researchCsv([{row}],method,index.as_of_date)!==researchCsv([{row:detail}],method,index.as_of_date)) throw Error(`Canonical CSV mismatch: ${row.symbol}/${method}`);
  }
}
const planTime=Date.now();
const planContract=rows=>{
  const plan=buildPortfolioPlan(rows,index.as_of_date,100000,planTime);
  return {positions:plan.positions,dailyPositions:plan.dailyPositions,candidateCount:plan.candidateCount,invested:plan.invested,cash:plan.cash,exposure:plan.exposure,risk:plan.risk,
    readiness:plan.readiness.map(item=>({symbol:item.symbol,passed:item.passed,ready:item.ready,states:item.rules.map(rule=>[rule.id,rule.state])}))};
};
if(JSON.stringify(planContract(index.rows))!==JSON.stringify(planContract(canonicalRows))) throw Error('Compact research changes order plan or entry readiness');
console.log(`Research transport gate passed: ${wireRaw.length} raw / ${gzipSync(wireRaw).length} gzip bytes; full canonical rules, CSV, rankings and order plan agree.`);
// Open real normal, repaired, split and incomplete symbols. All surfaces use
// these same canonical details; chart stubs may not retain old levels.
const sample=new Set(['AMD','TSM','JPM','KLAC','SLAB','ADI','SNDK','NDSN','IRDM','EBAY',index.rows.find(r=>!r.financial_history)?.symbol,index.rows.find(r=>!r.institutional_evidence)?.symbol,index.rows.find(r=>r.setup_recalculation?.status!=='calculated')?.symbol]);
for(const symbol of sample) {
  const row=index.rows.find(r=>r.symbol===symbol);if(!row)continue;
  const detail=await read(row.research_detail_path);
  if(detail.symbol!==symbol || detail.as_of_date!==index.as_of_date)throw Error(`Detail identity mismatch ${symbol}`);
  for(const key of scalarFields)if(detail[key]!==row[key])throw Error(`Detail mismatch: ${symbol}/${key}`);
  if(row.chart_path) {
    const chart=await read(row.chart_path);
    if(row.technical_audit?.valid && (!chart.rs_line || chart.rs_line.length<63)) throw Error(`Verified chart lacks RS context: ${symbol}`);
    for(const key of scalarFields)if(chart.stock_data[key]!==row[key])throw Error(`Chart mismatch: ${symbol}/${key}`);
  }
}
// Global filters and sort retain all scalar source inputs, including nulls.
const original=await read(market.pages.scan.path),full=new Map();
for(const chunk of original.chunks)for(const row of (await read(chunk.path)).rows)full.set(row.symbol,row);
for(const filters of [{},{minVolume:20000000,price:{min:10}},{seSetupReady:true},{seSetupReady:false},{rsRating:{min:85}},{symbolSearch:'AMD'}]) {
  for(const key of ['se_setup_score','current_price','rs_rating']) {
    const ids=rows=>sortStaticScanRows(filterStaticScanRows(rows,filters),key,'desc').map(r=>r.symbol).join(',');
    if(ids(list)!==ids([...full.values()]))throw Error(`Lazy scan changes global filters/sort: ${key}`);
  }
}
console.log(`Cross-view gate passed: ${list.length} scan rows; ${sample.size} real chart/detail cases; global filters/sort identical.`);

const workbenchRef=market.assets.workbench;
const workbenchRaw=await readFile(`public/static-data/${workbenchRef.path}`,'utf8');
if(createHash('sha256').update(workbenchRaw).digest('hex')!==workbenchRef.sha256) throw Error('Workbench hash mismatch');
const workbench=JSON.parse(workbenchRaw);
if(workbench.as_of!==index.as_of_date || workbench.source_research_sha256!==manifest.research_generation || workbench.snapshot_id!==workbenchRef.snapshot_id) throw Error('Mixed workbench snapshot');
const sectorPrices=await read('sector-prices.json');
if(JSON.stringify(sectorStrength(index.rows,sectorPrices,index.as_of_date))!==JSON.stringify(workbench.sectors)) throw Error('Sector evidence does not reproduce');
const saved=await readFile(`public/static-data/${workbench.current_snapshot.path}`);
if(createHash('sha256').update(saved).digest('hex')!==workbench.current_snapshot.sha256)throw Error('Saved observation hash mismatch');
const recorded=JSON.parse(gunzipSync(saved).toString('utf8'));
if(recorded.records.length!==index.rows.length || recorded.as_of!==index.as_of_date)throw Error('Selection snapshot coverage/date mismatch');
for(const method of ['minervini','minervini2','oneil','ibd']) {
  const changes=workbench.changes[method];
  if(Object.values(changes.counts).reduce((a,b)=>a+b,0)!==changes.items.length)throw Error('Candidate change count mismatch');
}
console.log(`Workbench gate passed: ${recorded.records.length} saved observations; sector calculations reproduce; snapshot identity and counts agree.`);
