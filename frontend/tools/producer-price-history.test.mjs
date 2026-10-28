// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {retainObservedHistory,preserveProducerHistory,producerHistoryCoverage} from './producer-price-history.mjs';
import {pack} from './static-transport/pack.mjs';
import {inventoryDigest} from '../../.github/scripts/publication-state.mjs';
import {rankVerifiedUniverse,AUDIT_VERSION} from '../src/static/qualificationAudit.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const target='2026-10-27',old='2026-10-26';
const row=(symbol='STALE')=>({symbol,market:'US',currency:'USD',exchange:'XNAS',company_name:symbol+' Inc',as_of_date:target,current_price:100,adv_usd:30000000,rs_rating:99,se_setup_ready:true,vcp_ready_for_breakout:true,eps_growth_yy:15,financial_source_evidence:{unchanged:'candidate'},unreviewed_scanner_signal:true});
const chart=(date,stock=row())=>({symbol:stock.symbol,market:'US',as_of_date:date,generated_at:date+'T22:00:00Z',stock_data:stock,bars:[{date,open:100,high:101,low:99,close:100,volume:300000}],rs_line:[{time:date,value:2}],signal:{buy:true}});
const input=()=>({symbol:'STALE',target,observation:old,previousChart:chart(old),candidateChart:{...chart('2026-10-23'),as_of_date:target},candidateRow:row(),provenance:{test_only:true}});
it('preserves whole genuine bars and capture clock but never any current price/technical claim',()=>{
 const source=input(),result=retainObservedHistory(source);
 expect(result.chart.bars).toEqual(source.previousChart.bars);expect(result.chart.generated_at).toBe(source.previousChart.generated_at);
 expect(result.row).toMatchObject({current_price:null,adv_usd:null,rs_rating:null,se_setup_ready:false,vcp_ready_for_breakout:false,eps_growth_yy:15,financial_source_evidence:source.candidateRow.financial_source_evidence,retained_price_history:{status:'stale_reference_only',observation_date:old,target_as_of_date:target}});
 expect(result.row).not.toHaveProperty('unreviewed_scanner_signal');expect(result.chart.rs_line).toEqual([]);expect(result.chart.signal).toBe(null);
 expect(result.snapshot.candidate_chart).toEqual(source.candidateChart);expect(result.snapshot.previous_chart).toEqual(source.previousChart);
 expect(result.snapshotHash).toBe(hash(result.snapshotBytes));
});
it('can retain an already-retained predecessor on a later attempt of the same analysis session',()=>{
 const source=input();source.previousChart.as_of_date=target;
 const result=retainObservedHistory(source);
 expect(result.chart.retained_price_history).toMatchObject({original_as_of_date:target,observation_date:old,target_as_of_date:target});
 expect(result.row.current_price).toBe(null);
});
for(const key of ['symbol','market','currency','exchange','company_name','cik'])it(`rejects changed identity ${key}`,()=>{
 const source=input();if(key==='cik')source.previousChart.stock_data.cik='1';source.candidateChart.stock_data[key]='changed';
 expect(()=>retainObservedHistory(source)).toThrow();
});
for(const change of ['future','same','badOHLC','duplicate','missingIdentity'])it(`rejects ${change} without inventing bars`,()=>{
 const source=input();if(change==='future')source.previousChart.bars[0].date='2026-10-28';
 if(change==='same')source.candidateChart.bars[0].date=old;
 if(change==='badOHLC')source.previousChart.bars[0].high=1;
 if(change==='duplicate')source.previousChart.bars.push({...source.previousChart.bars[0]});
 if(change==='missingIdentity')delete source.previousChart.stock_data.currency;
 expect(()=>retainObservedHistory(source)).toThrow();
});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'producer-history-')),source=join(directory,'prior'),root=join(directory,'candidate'),output=join(directory,'packed');
 await mkdir(join(source,'static-data'),{recursive:true});await mkdir(root);
 const write=async(base,path,value)=>{await mkdir(join(base,path,'..'),{recursive:true});await writeFile(join(base,path),JSON.stringify(value));};
 const priorManifest={markets:{US:{market:'US',as_of_date:old,assets:{charts:{path:'charts.json'}}}}};
 const priorBytes=JSON.stringify(priorManifest);await write(source,'static-data/manifest.json',priorManifest);await write(source,'static-data/charts.json',{symbols:[{symbol:'STALE',path:'markets/us/charts/STALE.json'}]});await write(source,'static-data/markets/us/charts/STALE.json',chart(old));
 const uiFiles={'index.html':hash('test'),'sw.js':hash('//test')};await writeFile(join(source,'index.html'),'test');await writeFile(join(source,'sw.js'),'//test');
 const packed=await pack({source,output,bindings:{manifestSha256:hash(priorBytes),uiInventorySha256:inventoryDigest(uiFiles),financialGeneration:null,financialLineageSha256:null,sourceCommit:'3'.repeat(40),appCommit:'4'.repeat(40),candidateId:'5'.repeat(64)}});
 const good=Array.from({length:20},(_,i)=>({...row(`GOOD${i}`),technical_audit:{version:AUDIT_VERSION,status:'verified',symbol:`GOOD${i}`,as_of_date:target,valid:true,errors:[],values:{close:100,momentum:i}}}));
 const stale={...row(),research_detail_path:'detail.json'};
 const entry={market:'US',as_of_date:target,assets:{charts:{path:'charts.json'}},pages:{scan:{path:'scan.json'}}};
 await write(root,'manifest.json',{markets:{US:entry}});await write(root,'charts.json',{symbols:[{symbol:'STALE',path:'verified-charts/STALE-original.json'}]});
 await write(root,'scan.json',{as_of_date:target,initial_rows:[stale,...good],chunks:[]});await write(root,'detail.json',stale);
 await write(root,'verified-charts/STALE-original.json',{...chart('2026-10-23'),as_of_date:target});await write(root,'markets/us/charts/STALE.json',{...chart('2026-10-23'),as_of_date:target});
 const key=JSON.stringify(['US','chart','STALE']);
 const live={receipt:{run_id:1,transport:{root:packed.expectedRoot},verification_universe:{minimum_target:.9}},manifest:priorManifest,manifestHash:hash(priorBytes),receiptHash:'6'.repeat(64),verificationUniverse:{as_of_date:old,required_symbols:good.map(r=>r.symbol)},priceObservations:{[key]:old},knownPriceDates:{[key]:old}};
 const fetchImpl=async url=>{try{return new Response(await readFile(join(output,new URL(url).pathname.slice('/screener/'.length))));}catch(error){if(error.code==='ENOENT')return new Response(null,{status:404});throw error;}};
 return {directory,root,output,live,fetchImpl,good,write,read:async path=>JSON.parse(await readFile(join(root,path))),cleanup:()=>rm(directory,{recursive:true,force:true})};
}
it('runs authenticated transport→all aliases/scan/detail→protected quality, idempotently preserving cohort',async()=>{
 const f=await fixture();try{
  const result=await preserveProducerHistory(f);expect(result.symbols).toEqual(['STALE']);
  const canonical=await f.read('verified-charts/STALE-original.json');expect(await f.read('markets/us/charts/STALE.json')).toEqual(canonical);
  const scan=await f.read('scan.json'),stale=scan.initial_rows[0];expect(stale.current_price).toBe(null);expect((await f.read('detail.json')).current_price).toBe(null);
  stale.technical_audit={valid:false};stale.rs_rating=null;
  const entry=(await f.read('manifest.json')).markets.US;
  const coverage=await producerHistoryCoverage({root:f.root,entry,rows:scan.initial_rows,charts:new Map([['STALE',canonical]])});
  expect(coverage.total).toBe(21);expect(coverage.verified).toBe(20);expect(coverage.requiredSymbols).toContain('STALE');
  const insufficient=structuredClone(scan.initial_rows);
  for(const row of insufficient.slice(1,5)){row.current_price=null;row.adv_usd=null;row.technical_audit={valid:false};}
  await expect(producerHistoryCoverage({root:f.root,entry,rows:insufficient,charts:new Map([['STALE',canonical]])})).rejects.toThrow(/90%/);
  await expect(producerHistoryCoverage({root:f.root,entry,rows:scan.initial_rows.slice(1),charts:new Map([['STALE',canonical]])})).rejects.toThrow(/membership/);
  expect(rankVerifiedUniverse(scan.initial_rows).find(r=>r.symbol==='STALE').rs_rating).toBe(null);
  await preserveProducerHistory(f);
  const second=(await f.read('manifest.json')).markets.US;
  expect((await f.read(second.assets.producer_price_history.path)).protected_symbols).toContain('STALE');
  const altered=structuredClone(canonical);altered.bars[0].close=101;
  await expect(producerHistoryCoverage({root:f.root,entry:second,rows:scan.initial_rows,charts:new Map([['STALE',altered]])})).rejects.toThrow(/OHLCV/);
  for(const field of ['target_as_of_date','observation_date','snapshot_path','snapshot_sha256','original_as_of_date','original_generated_at']){
   const alteredMarker=structuredClone(canonical);alteredMarker.retained_price_history[field]='corrupted';
   await expect(producerHistoryCoverage({root:f.root,entry:second,rows:scan.initial_rows,charts:new Map([['STALE',alteredMarker]])})).rejects.toThrow();
  }
  const alteredEnvelope={...canonical,as_of_date:old};
  await expect(producerHistoryCoverage({root:f.root,entry:second,rows:scan.initial_rows,charts:new Map([['STALE',alteredEnvelope]])})).rejects.toThrow(/analysis date/);
  stale.current_price=100;
  await expect(producerHistoryCoverage({root:f.root,entry:second,rows:scan.initial_rows,charts:new Map([['STALE',canonical]])})).rejects.toThrow(/relabelled current/);
 }finally{await f.cleanup();}
});
it('rejects successful-HTTP altered authenticated shard bytes before mutation',async()=>{
 const f=await fixture();try{
  const before=await readFile(join(f.root,'scan.json'));
  const fetchImpl=async url=>{const response=await f.fetchImpl(url);if(String(url).includes('/shard-')){const bytes=new Uint8Array(await response.arrayBuffer());bytes[bytes.length-2]^=1;return new Response(bytes);}return response;};
  await expect(preserveProducerHistory({...f,fetchImpl})).rejects.toThrow();
  expect(await readFile(join(f.root,'scan.json'))).toEqual(before);
 }finally{await f.cleanup();}
});
it('rejects a traversal canonical-detail pointer before rewriting any chart',async()=>{
 const f=await fixture();try{
  const scan=await f.read('scan.json');scan.initial_rows[0].research_detail_path='../escape.json';await f.write(f.root,'scan.json',scan);
  const before=await readFile(join(f.root,'verified-charts/STALE-original.json'));
  await expect(preserveProducerHistory(f)).rejects.toThrow(/Unsafe/);
  expect(await readFile(join(f.root,'verified-charts/STALE-original.json'))).toEqual(before);
 }finally{await f.cleanup();}
});
it.skipIf(process.platform==='win32')('rejects a linked canonical-detail target before rewriting any chart',async()=>{
 const f=await fixture();try{
  await rm(join(f.root,'detail.json'));await writeFile(join(f.directory,'outside.json'),'{}');await symlink(join(f.directory,'outside.json'),join(f.root,'detail.json'));
  const before=await readFile(join(f.root,'verified-charts/STALE-original.json'));
  await expect(preserveProducerHistory(f)).rejects.toThrow(/Linked/);
  expect(await readFile(join(f.root,'verified-charts/STALE-original.json'))).toEqual(before);
 }finally{await f.cleanup();}
});
it('fails closed on unavailable authenticated source before any source mutation',async()=>{
 const f=await fixture();try{
  const before=await readFile(join(f.root,'scan.json'));
  await expect(preserveProducerHistory({...f,fetchImpl:async()=>new Response(null,{status:503})})).rejects.toThrow();
  expect(await readFile(join(f.root,'scan.json'))).toEqual(before);
 }finally{await f.cleanup();}
});
