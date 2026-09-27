// Replace suspect histories with freshly retrieved vendor OHLCV. Never widen
// highs/lows or infer a split ratio from a price jump. An unsuccessful fetch
// leaves the original data invalid, with an auditable reason.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {brokenHistory as broken, vendorHistory} from './price-history-validation.mjs';
import {setTimeout as pause} from 'node:timers/promises';
const root=resolve('public/static-data');
const read=async p=>JSON.parse(await readFile(resolve(root,p),'utf8'));
const write=(p,v)=>writeFile(resolve(root,p),JSON.stringify(v));
const manifest=await read('manifest.json'),market=manifest.markets?.US||manifest;
const scan=await read(market.pages.scan.path),date=scan.as_of_date;
const index=await read(market.assets.charts.path),paths=new Map(index.symbols.map(r=>[r.symbol,r.path]));
const chunks=await Promise.all((scan.chunks||[]).map(async c=>({path:c.path,data:await read(c.path)})));
const rows=new Map([...scan.initial_rows,...chunks.flatMap(c=>c.data.rows)].map(r=>[r.symbol,r]));
const hash=bars=>createHash('sha256').update(JSON.stringify(bars)).digest('hex');
const replacements=new Map(),report=[]; let cursor=0;
const symbols=[...rows.keys()]; let throttledUntil=0;
async function worker(){while(cursor<symbols.length){const symbol=symbols[cursor++],path=paths.get(symbol);if(!path)continue;
 const original=await read(path);if(!original.bars?.length||!broken(original.bars))continue;
 try{
  if(throttledUntil>Date.now())await pause(throttledUntil-Date.now());
  const response=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&events=splits&includeAdjustedClose=true`,{signal:AbortSignal.timeout(25000)});
  if(response.status===429)throttledUntil=Date.now()+30000;
  if(!response.ok)throw Error(`vendor HTTP ${response.status}`);
  const raw=(await response.json()).chart?.result?.[0];if(!raw)throw Error('vendor history unavailable');
  const bars=vendorHistory(raw,symbol,date);
  const quality={source:'Yahoo chart API: complete vendor history, split-adjusted prices',retrieved_at:new Date().toISOString(),as_of_date:date,original_sha256:hash(original.bars),replacement_sha256:hash(bars),splits:raw.events?.splits||{},status:'replaced'};
  const old=rows.get(symbol),last=bars.at(-1);
  // Setup Engine inputs were built from the old history. Withhold those stale
  // levels until a complete scan rebuild; no fabricated readiness/confidence.
  const row={...old,current_price:last.close,price_change_1d:(last.close/bars.at(-2).close-1)*100,se_pivot_price:null,vcp_pivot:null,se_setup_ready:false,se_pattern_confidence:null,vcp_detected:false,price_quality:quality};
  replacements.set(symbol,row);
  await write(path,{...original,bars,stock_data:row,rs_line:[],blue_dots:[],eps_line:[],vcp_boxes:[],signal:null,risk_plan:null,price_quality:quality});
  report.push({symbol,status:'replaced',bars:bars.length,...quality});
 }catch(error){report.push({symbol,status:'unresolved',reason:error.message});}
 if(report.length%100===0)console.log(`Price history verification: ${report.length} checked, ${replacements.size} replaced`);
}}
await Promise.all(Array.from({length:4},worker));
const apply=rs=>rs.map(r=>replacements.get(r.symbol)||r);
scan.initial_rows=apply(scan.initial_rows);await write(market.pages.scan.path,scan);
for(const c of chunks){c.data.rows=apply(c.data.rows);await write(c.path,c.data);}
await write('price-repair-report.json',{as_of_date:date,checked_at:new Date().toISOString(),attempted:report.length,replaced:replacements.size,unresolved:report.filter(r=>r.status==='unresolved').length,results:report});
console.log(`Price repair completed: ${replacements.size}/${report.length}; unrepaired remain excluded.`);
