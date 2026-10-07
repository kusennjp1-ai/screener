// Price semantics must survive the ordinary compiler before carry takes ownership.
// Financial availability is evaluated by the existing current-time carry gates.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
import {verifyCurrentRows,verifyUnknownRow,verifyRetainedChart} from './oct6-retained-price-rehearsal.mjs';
import {extractPriceObservations,priceObservationDigest} from './price-observations.mjs';
import {safePath} from './publication-state.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const priceFields=['symbol','market','currency','as_of_date','current_price','price_change_1d','adv_usd','volume','rs_rating','se_pivot_price','vcp_pivot','se_setup_ready','vcp_ready_for_breakout','technical_audit','retained_price_history','price_quarantine'];
const project=row=>Object.fromEntries(priceFields.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
const read=(root,path)=>{assert(safePath(path),'Unsafe finite baseline member');const file=join(root,path);assert(lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink(),'Linked/nonregular finite baseline member');return JSON.parse(readFileSync(file));};
const sourceKey=symbol=>JSON.stringify(['US','chart',symbol]);

export function assertPriceRowsUnchanged(before,after){
  const originals=new Map(before.map(row=>[row.symbol,project(row)]));assert.equal(originals.size,before.length,'Duplicate source price row');assert.equal(after.length,before.length,'Compiler changed price-row count');
  for(const row of after){assert(originals.has(row.symbol),'Compiler invented/duplicated price row');assert.deepEqual(project(row),originals.get(row.symbol),`${row.symbol}: compiler changed authenticated price semantics`);originals.delete(row.symbol);}
  assert.equal(originals.size,0,'Compiler dropped authenticated price rows');
}
function tables(root){const data=join(root,'static-data'),manifest=read(data,'manifest.json'),market=manifest.markets.US;
  const index=decodeResearchIndex(read(data,market.assets.research.path)),scan=read(data,market.pages.scan.path);
  const full=scan.chunks.flatMap(chunk=>read(data,chunk.path).rows);return{data,manifest,market,index,scan,full};}

export function assertFinitePriceBaseline({sourceRoot,targetRoot,replayRoot,request}){
  assert(request?.enabled&&request.target_as_of_date==='2026-10-06','Finite baseline requires active reviewed request');
  const preparedRaw=readFileSync(join(replayRoot,'prepared.json'));
  assert.deepEqual({bytes:preparedRaw.length,sha256:sha(preparedRaw)},request.repair.prepared,'Prepared repair graph changed');
  const prepared=JSON.parse(preparedRaw),expected=request.repair.expected,target=prepared.target_as_of_date;
  assert.equal(target,request.target_as_of_date);
  const before=tables(sourceRoot),after=tables(targetRoot),affected=new Set([...prepared.patches.filter(p=>p.row).map(p=>p.symbol),...prepared.row_quarantines.map(p=>p.symbol)]);
  assert.equal(before.full.length,expected.rows);assert.equal(affected.size,expected.affected);assert.equal(prepared.patches.length,expected.restored_prior_histories+expected.stale_candidate_histories);assert.equal(prepared.row_quarantines.length,expected.undated);
  assertPriceRowsUnchanged(before.full,after.full);assertPriceRowsUnchanged(before.index.rows,after.index.rows);
  const observed=extractPriceObservations({dataRoot:after.data,manifest:after.manifest}),original=extractPriceObservations({dataRoot:before.data,manifest:before.manifest});
  assert.equal(priceObservationDigest(observed),priceObservationDigest(original),'Compiler changed actual source observation dates');
  verifyCurrentRows(after.full,observed,affected,target);verifyCurrentRows(after.index.rows,observed,affected,target,{compact:true});
  const rows=new Map(after.index.rows.map(row=>[row.symbol,row]));
  for(const row of after.index.rows)if(affected.has(row.symbol))verifyUnknownRow(read(after.data,row.research_detail_path),target);
  const paths=new Set([after.market.assets.charts.path,after.manifest.assets.charts.path,'markets/us/charts/index.json',after.scan.charts.path]);
  const beforeMembers=read(before.data,before.market.assets.charts.path).symbols.map(item=>item.symbol).sort();
  const patches=new Map(prepared.patches.map(patch=>[patch.symbol,patch])),checked=new Set();
  for(const path of paths){const items=read(after.data,path).symbols;assert.equal(items.length,expected.chart_members);assert.equal(new Set(items.map(item=>item.symbol)).size,items.length);assert.deepEqual(items.map(item=>item.symbol).sort(),beforeMembers,'Compiler changed complete chart membership');
    for(const item of items){if(!patches.has(item.symbol))continue;verifyRetainedChart(read(after.data,item.path),patches.get(item.symbol),target);checked.add(item.symbol);}}
  assert.deepEqual([...checked].sort(),[...patches.keys()].sort(),'Compiler dropped retained history');
  for(const patch of prepared.patches){const encoded=encodeURIComponent(patch.symbol),originalAlias=`markets/us/charts/${encoded}.json`;
    if(existsSync(join(after.data,originalAlias)))verifyRetainedChart(read(after.data,originalAlias),patch,target);
    for(const name of readdirSync(join(after.data,'verified-charts')))if(name.startsWith(encoded+'-'))verifyRetainedChart(read(after.data,'verified-charts/'+name),patch,target);
  }
  for(const row of prepared.row_quarantines){assert.equal(rows.get(row.symbol)?.chart_path,null,'Undated row gained a chart');assert(!beforeMembers.includes(row.symbol)&&!Object.hasOwn(observed,sourceKey(row.symbol)),'Undated row gained price evidence');}
  const beforeHome=read(before.data,before.market.pages.home.path),home=read(after.data,after.market.pages.home.path);
  assert.deepEqual(home.key_markets,beforeHome.key_markets,'Compiler changed original home prices/history/clocks');assert.equal(home.generated_at,beforeHome.generated_at,'Compiler changed home capture clock');
  for(const row of [...(after.scan.initial_rows??[]),...(after.scan.preview_rows??[]),...(home.scan_summary.top_results??[])])if(affected.has(row.symbol))assert.equal(row.current_price,null,'Current preview revived quarantined price');
  const graph=JSON.parse(readFileSync(join(replayRoot,'graph.json')));
  for(const [path,pin]of Object.entries(graph.materialized_inventory))if(path.startsWith('static-data/retained-price-history/')||path.startsWith('static-data/retained-price-repair-audit/')||['static-data/markets/us/groups.json','static-data/markets/us/groups_rrg.json'].includes(path)){
    const bytes=readFileSync(join(targetRoot,path));assert.deepEqual({bytes:bytes.length,sha256:sha(bytes)},pin,'Compiler changed immutable repair/group evidence: '+path);}
  return {schema_version:'retained-price-source-carry-baseline-v1',price_rows:after.full.length,affected:affected.size,retained_histories:checked.size,undated:prepared.row_quarantines.length,observations_sha256:priceObservationDigest(observed),financial_availability:'owned-by-current-time-ordinary-carry'};
}
