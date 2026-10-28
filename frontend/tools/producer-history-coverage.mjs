// Offline canonical-compiler verification. No controller, API, network or
// publication authority dependency is imported across this boundary.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {assessRetainedUniverse,isEligibleForPublication} from './publication-coverage.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=bytes=>JSON.parse(Buffer.from(bytes).toString('utf8'));
const sorted=values=>[...new Set(values)].sort();
async function local(root,path){
 assert(typeof path==='string'&&!isAbsolute(path)&&/^[A-Za-z0-9._%/-]+$/.test(path)&&!/%(?:2f|5c|25|00)/i.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Unsafe producer history path');
 let part=root;for(const name of path.split('/')){part=join(part,name);assert(!(await lstat(part)).isSymbolicLink(),'Linked producer input');}
 return readFile(part);
}
export async function producerHistoryCoverage({root,entry,rows,charts}){
 const ref=entry.assets?.producer_price_history;
 if(!ref)return null;
 assert.equal(ref.schema_version,'producer-price-history-v1');assert.equal(ref.as_of_date,entry.as_of_date);
 const bytes=await local(root,ref.path);assert.equal(hash(bytes),ref.sha256,'Producer history report hash mismatch');
 const report=json(bytes);assert.equal(report.schema_version,'producer-price-history-v1');assert.equal(report.as_of_date,entry.as_of_date);
 assert.deepEqual(sorted(rows.map(row=>row.symbol)),report.universe_symbols,'Producer research membership changed');
 const bySymbol=new Map(rows.map(row=>[row.symbol,row]));
 if(!charts){
  charts=new Map();
  const index=json(await local(root,entry.assets.charts.path)),paths=new Map(index.symbols.map(item=>[item.symbol,item.path]));
  const required=new Set([...report.retained.map(item=>item.symbol),...report.protected_symbols.filter(symbol=>{
   const row=bySymbol.get(symbol);return row&&!isEligibleForPublication(row)&&row.technical_audit?.valid;
  })]);
  for(const symbol of required)if(paths.has(symbol))charts.set(symbol,json(await local(root,paths.get(symbol))));
 }
 for(const item of report.retained){
  const snapshotBytes=await local(root,item.snapshot_path);assert.equal(hash(snapshotBytes),item.snapshot_sha256);
  const snapshot=json(snapshotBytes),chart=charts.get(item.symbol);
  assert(chart,'Retained chart disappeared');assert.equal(chart.symbol,item.symbol);
  assert.equal(chart.as_of_date,entry.as_of_date,'Retained chart analysis date changed');
  assert.equal(hash(JSON.stringify(chart.bars)),item.bars_sha256,'Retained OHLCV changed');
  assert.deepEqual(chart.bars,snapshot.previous_chart.bars,'Retained bars differ from original predecessor');
  assert.equal(chart.bars.at(-1)?.date,item.observation_date);
  assert(item.observation_date<entry.as_of_date,'Retained reference cannot admit current bars');
  assert.equal(chart.retained_price_history?.status,'stale_reference_only');
  const marker=chart.retained_price_history;
  assert.equal(marker.target_as_of_date,entry.as_of_date,'Retained target marker changed');
  assert.equal(marker.observation_date,item.observation_date,'Retained observation marker changed');
  assert.equal(marker.snapshot_path,item.snapshot_path,'Retained snapshot path changed');
  assert.equal(marker.snapshot_sha256,item.snapshot_sha256,'Retained snapshot hash changed');
  assert.equal(marker.original_as_of_date,snapshot.previous_chart.as_of_date,'Original analysis date changed');
  assert.equal(marker.original_generated_at,snapshot.previous_chart.generated_at??null,'Original capture time changed');
  const row=bySymbol.get(item.symbol);
  if(row){
   assert.equal(row.current_price,null,'Retained close was relabelled current');
   assert.equal(row.rs_rating,null,'Retained row entered RS ranking');
   assert.equal(row.technical_audit?.valid,false,'Retained row became technically verified');
   assert(row.se_setup_ready!==true&&row.vcp_ready_for_breakout!==true,'Retained setup became eligible');
   assert.equal(row.retained_price_history?.snapshot_sha256,item.snapshot_sha256,'Retained row lost source provenance');
  }
 }
 const coverage=assessRetainedUniverse({previousSymbols:report.protected_symbols,rows,asOfDate:entry.as_of_date,charts});
 assert(coverage.passed,'Producer retained universe fails unchanged 90% coverage');
 return coverage;
}
