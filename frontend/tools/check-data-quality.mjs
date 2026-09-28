import { readFile } from 'node:fs/promises';
import { assess, assessmentSummary, RULE_SUMMARY_VERSION } from '../src/static/researchEngine.js';
import {canonicalPivot} from '../src/static/researchPresentation.js';
import {filterStaticScanRows,sortStaticScanRows} from '../src/static/scanClient.js';
const read=async path=>JSON.parse(await readFile(`public/static-data/${path}`,'utf8'));
const manifest=await read('manifest.json');
const index=await read((manifest.markets?.US||manifest).assets.research.path);
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
for(const row of index.rows) {
  const entry=bySymbol.get(row.symbol);
  for(const key of scalarFields) if(entry[key]!==row[key]) throw Error(`Cross-view value mismatch: ${row.symbol}/${key}`);
  if(row.setup_recalculation?.status!=='calculated' && (canonicalPivot(row).price || row.se_setup_ready)) throw Error(`Stale failed setup: ${row.symbol}`);
}
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
