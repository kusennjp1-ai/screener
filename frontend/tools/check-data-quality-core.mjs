// Internal worker: the coordinator waits for this process to exit before loading financial compatibility.
import { writeSync } from 'node:fs';
import { verifyWorkbenchComparison } from './workbench-comparison.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { sectorStrength } from '../src/static/sectorStrength.js';
import { summarizeWorkbench, validateWorkbenchSummary, validateWorkbenchDetails } from '../src/static/workbenchSummary.js';
import { researchEvaluation, validatePublishedSummaries, validateResearchListSummaries, validateResearchParity } from './research-quality.mjs';
import {canonicalPivot} from '../src/static/researchPresentation.js';
import {filterStaticScanRows,sortStaticScanRows} from '../src/static/scanClient.js';
import {producerHistoryCoverage} from './producer-history-coverage.mjs';
import {marketContextBlock,validMarketContext,validRsLineHigh} from './scan-list-payload.mjs';
import {buildSecSummary,secSummary} from '../src/static/fundamentalsExplain.js';
import {isDeepStrictEqual} from 'node:util';
const read=async path=>JSON.parse(await readFile(`public/static-data/${path}`,'utf8'));
const manifest=await read('manifest.json');
const indexPath=(manifest.markets?.US||manifest).assets.research.path;
const wireRaw=await readFile(`public/static-data/${indexPath}`);
const wire=JSON.parse(wireRaw.toString('utf8'));
const index=decodeResearchIndex(wire);
const evaluatedAt=researchEvaluation(index,(manifest.markets?.US||manifest).assets.research);
const checkedAt=Date.now();
if(wire.schema && (wireRaw.length>8000000 || gzipSync(wireRaw).length>1000000)) throw Error(`Research payload budget exceeded: ${wireRaw.length} raw / ${gzipSync(wireRaw).length} gzip bytes`);
const quality=await read('data-quality.json');
validateResearchListSummaries(wire,index.rows,evaluatedAt);
if(!quality.total || quality.as_of_date!==index.as_of_date || quality.verified/quality.total<.9) {
  try {
    writeSync(2, `Daily verification diagnostics: ${JSON.stringify({as_of_date:quality.as_of_date,research_as_of_date:index.as_of_date,total:quality.total,verified:quality.verified,required_verified_fraction:.9,reasons:quality.reasons})}\n`);
  } catch { /* Diagnostics must not replace the existing failure. */ }
  throw Error(`Daily verification below 90%: ${quality.verified}/${quality.total}. Keep last good publication and repair the source; never relax selection criteria.`);
}
console.log(`Quality gate passed: ${quality.verified}/${quality.total} verified; declared financial evaluation ${new Date(evaluatedAt).toISOString()}.`);

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
}
validatePublishedSummaries(canonicalRows,evaluatedAt);
// Round-2 list summaries (index rows only) and the market context: each is valid when absent (an older exporter);
// present, it must have its documented shape and be what the canonical detail gives with the export's own functions.
{
  const date=index.as_of_date,coverage=market.fundamentals_coverage??null,details=new Map(canonicalRows.map(row=>[row.symbol,row]));
  const counts={rs_line_high:0,sec_summary:0,se_pattern_primary:0};
  for(const row of index.rows) {
    if(Object.hasOwn(row,'rs_line_high')) {
      counts.rs_line_high++;
      if(!validRsLineHigh(row.rs_line_high,date) || (row.rs_line_high!==null && !(row.technical_audit?.valid===true && row.technical_audit.as_of_date===date))) throw Error(`Invalid rs_line_high: ${row.symbol}`);
    }
    if(Object.hasOwn(row,'sec_summary')) {
      counts.sec_summary++;
      if(row.sec_summary!==null && (secSummary(row)===null || row.sec_summary.as_of_date!==date)) throw Error(`Invalid sec_summary: ${row.symbol}`);
      if(!isDeepStrictEqual(row.sec_summary,buildSecSummary(details.get(row.symbol),{date,now:evaluatedAt,coverage}))) throw Error(`sec_summary differs from the admitted SEC record: ${row.symbol}`);
    }
    if(Object.hasOwn(row,'se_pattern_primary')) {
      counts.se_pattern_primary++;
      if(!(row.se_pattern_primary===null || typeof row.se_pattern_primary==='string') || row.se_pattern_primary!==details.get(row.symbol)?.se_pattern_primary) throw Error(`Invalid se_pattern_primary: ${row.symbol}`);
    }
  }
  if(Object.hasOwn(market,'market_context')) {
    if(!validMarketContext(market.market_context,date)) throw Error('Invalid market_context block');
    if(!isDeepStrictEqual(market.market_context,marketContextBlock(canonicalRows,date).block)) throw Error('market_context differs from the canonical rows');
  }
  console.log(`List summary gate passed: rs_line_high ${counts.rs_line_high}, sec_summary ${counts.sec_summary}, se_pattern_primary ${counts.se_pattern_primary} of ${index.rows.length} rows; market_context ${Object.hasOwn(market,'market_context')?(market.market_context?'present':'null'):'absent'}.`);
}
const producerCoverage=await producerHistoryCoverage({root:'public/static-data',entry:market,rows:canonicalRows});
if(producerCoverage && (quality.total!==producerCoverage.total || quality.verified!==producerCoverage.verified))throw Error('Producer protected coverage denominator changed');
for(const now of new Set([evaluatedAt,checkedAt])) validateResearchParity(wire,canonicalRows,now);
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
    const ids=rows=>sortStaticScanRows(filterStaticScanRows(rows,filters,{now:checkedAt}),key,'desc',{now:checkedAt}).map(r=>r.symbol).join(',');
    if(ids(list)!==ids([...full.values()]))throw Error(`Lazy scan changes global filters/sort: ${key}`);
  }
}
console.log(`Cross-view gate passed: ${list.length} scan rows; ${sample.size} real chart/detail cases; global filters/sort identical.`);

const workbenchRef=market.assets.workbench;
const workbenchRaw=await readFile(`public/static-data/${workbenchRef.path}`,'utf8');
if(createHash('sha256').update(workbenchRaw).digest('hex')!==workbenchRef.sha256) throw Error('Workbench hash mismatch');
const workbench=JSON.parse(workbenchRaw);
if(workbench.financial_evaluated_at!==evaluatedAt || workbench.financial_semantics!==index.financial_semantics) throw Error('Mixed workbench evaluation');
if(workbench.as_of!==index.as_of_date || workbench.source_research_sha256!==manifest.research_generation || workbench.snapshot_id!==workbenchRef.snapshot_id) throw Error('Mixed workbench snapshot');
const summaryRef=market.assets.workbench_summary;
const summaryRaw=await readFile(`public/static-data/${summaryRef.path}`,'utf8');
if(createHash('sha256').update(summaryRaw).digest('hex')!==summaryRef.sha256)throw Error('Workbench summary hash mismatch');
const summary=JSON.parse(summaryRaw);
validateWorkbenchSummary(summary,summaryRef,workbenchRef,index.as_of_date,market.assets.research.path,true);
validateWorkbenchDetails(workbench,summary);
if(JSON.stringify(summarizeWorkbench(workbench,workbenchRef))!==summaryRaw)throw Error('Workbench summary does not reproduce');
const sectorPrices=await read('sector-prices.json');
if(JSON.stringify(sectorStrength(index.rows,sectorPrices,index.as_of_date,evaluatedAt))!==JSON.stringify(workbench.sectors)) throw Error('Sector evidence does not reproduce');
const saved=await readFile(`public/static-data/${workbench.current_snapshot.path}`);
if(createHash('sha256').update(saved).digest('hex')!==workbench.current_snapshot.sha256)throw Error('Saved observation hash mismatch');
const recorded=JSON.parse(gunzipSync(saved).toString('utf8'));
await verifyWorkbenchComparison({root:'public/static-data',workbench,canonicalRows});
if(recorded.records.length!==index.rows.length || recorded.as_of!==index.as_of_date)throw Error('Selection snapshot coverage/date mismatch');
for(const method of ['minervini','minervini2','oneil','ibd']) {
  const changes=workbench.changes[method];
  if(Object.values(changes.counts).reduce((a,b)=>a+b,0)!==changes.items.length)throw Error('Candidate change count mismatch');
}
console.log(`Workbench gate passed: ${recorded.records.length} saved observations; sector calculations reproduce; snapshot identity and counts agree.`);

writeSync(3, 'data-quality:core:complete:v1\n');
