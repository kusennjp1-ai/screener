import { describe,it,expect } from 'vitest';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildMarketTrends,exportMarketTrends,verifyLongHistorySource,selectLongHistorySource,selectRuntimeLongHistorySource } from './export-market-trends.mjs';
const source=()=>JSON.parse(readFileSync(resolve('data/market-trend-source-2026-10-23.json'),'utf8'));
const longSource=()=>JSON.parse(readFileSync(resolve('data/market-history-source-2026-10-23.json'),'utf8'));
const historyCapture=(date,retrieved_at)=>{
 const symbols=Array.from({length:100},(_,i)=>`S${i}`);
 return {schema_version:'market-long-history-v1',market:'US',as_of_date:date,retrieved_at,
  universe:{basis:'current-published-universe-retrospective',symbols,sha256:createHash('sha256').update(JSON.stringify(symbols)).digest('hex'),historical_membership_verified:false,historical_fundamentals_verified:false},
  calendar:{provider:'pandas_market_calendars:NYSE',sessions:[date]},breadth:[],sp500:[],sectorRotation:{lookback_sessions:126,frames:[]},
  provenance:symbols.map(symbol=>({symbol,url:`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`,sha256:'a'.repeat(64),retrieved_at}))};
};

describe('history availability at the fixed export clock',()=>{
 const evaluatedAt=Date.parse('2026-10-26T22:00:00Z');
 it('selects an older eligible capture when the newest observed snapshot was retrieved later',async()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'history-clock-'));
  try{
   const older=historyCapture('2026-10-22','2026-10-26T22:00:00Z'),future=historyCapture('2026-10-23','2026-10-27T04:10:00Z');
   writeFileSync(resolve(directory,'market-history-source-2026-10-22.json'),JSON.stringify(older));
   writeFileSync(resolve(directory,'market-history-source-2026-10-23.json'),JSON.stringify(future));
   expect((await selectLongHistorySource(directory,'2026-10-23',evaluatedAt)).history).toEqual(older);
   expect((await selectLongHistorySource(directory,'2026-10-23',Date.parse(future.retrieved_at))).history).toEqual(future);
  }finally{rmSync(directory,{recursive:true,force:true});}
 });
 it('omits both derived history and its raw asset before the real capture was available, even when wall time is later',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'history-unavailable-'));
  try{
   expect(Date.parse(longSource().retrieved_at)).toBeGreaterThan(evaluatedAt);
   const result=await exportMarketTrends({root,entry:{},asOfDate:'2026-10-23',evaluatedAt});
   expect(result.long_history).toBeUndefined();
   expect(readdirSync(resolve(root,'market-trends')).some(name=>name.startsWith('history-source-'))).toBe(false);
  }finally{rmSync(root,{recursive:true,force:true});}
 });
 it.each(['missingRetrieval','invalidRetrieval','universeDigest','futureResponse'])('fails closed for %s rather than falling back past an invalid eligible capture',async kind=>{
  const directory=mkdtempSync(resolve(tmpdir(),'history-invalid-'));
  try{
   const older=historyCapture('2026-10-22','2026-10-24T00:00:00Z'),newer=historyCapture('2026-10-23','2026-10-25T00:00:00Z');
   if(kind==='missingRetrieval')delete newer.retrieved_at;
   if(kind==='invalidRetrieval')newer.retrieved_at='not-a-date';
   if(kind==='universeDigest')newer.universe.sha256='f'.repeat(64);
   if(kind==='futureResponse')newer.provenance[0].retrieved_at='2026-10-27T00:00:00Z';
   writeFileSync(resolve(directory,'market-history-source-2026-10-22.json'),JSON.stringify(older));
   writeFileSync(resolve(directory,'market-history-source-2026-10-23.json'),JSON.stringify(newer));
   await expect(selectLongHistorySource(directory,'2026-10-23',evaluatedAt)).rejects.toThrow();
  }finally{rmSync(directory,{recursive:true,force:true});}
 });
});
describe('long historical source binding',()=>{
 it('carries a newly acquired runtime capture into export and identical offline replay without a new compiler seed',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'history-runtime-')),second=mkdtempSync(resolve(tmpdir(),'history-replay-'));
  try{
   const history=historyCapture('2026-10-26','2026-10-27T12:00:00Z'),bytes=Buffer.from(JSON.stringify(history,null,1)+'\n');
   const evaluatedAt=Date.parse('2026-10-27T12:01:00Z');
   for(const path of [root,second])writeFileSync(resolve(path,'market-history-source.json'),bytes);
   const entry={},out=await exportMarketTrends({root,entry,asOfDate:'2026-10-26',evaluatedAt});
   const replayEntry={},replay=await exportMarketTrends({root:second,entry:replayEntry,asOfDate:'2026-10-26',evaluatedAt});
   const sha=createHash('sha256').update(bytes).digest('hex');
   expect(out.long_history).toEqual({...history,source_sha256:sha});expect(replay).toEqual(out);expect(replayEntry).toEqual(entry);
   expect(readFileSync(resolve(root,`market-trends/history-source-${sha}.json`))).toEqual(bytes);
   expect(readFileSync(resolve(root,'market-history-source.json'))).toEqual(bytes);
  }finally{rmSync(root,{recursive:true,force:true});rmSync(second,{recursive:true,force:true});}
 });
 it('withholds a runtime capture before its recorded acquisition, and refuses future observation dates and malformed evidence',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'history-runtime-clock-'));
  try{
   const source=historyCapture('2026-10-26','2026-10-27T12:00:00Z');
   const file=resolve(root,'market-history-source.json');writeFileSync(file,JSON.stringify(source));
   expect(await selectRuntimeLongHistorySource(root,'2026-10-26',Date.parse('2026-10-27T11:59:00Z'))).toBeNull();
   await expect(selectRuntimeLongHistorySource(root,'2026-10-23',Date.parse('2026-10-27T12:00:00Z'))).rejects.toThrow();
   source.universe.sha256='f'.repeat(64);writeFileSync(file,JSON.stringify(source));
   await expect(selectRuntimeLongHistorySource(root,'2026-10-26',Date.parse('2026-10-27T12:00:00Z'))).rejects.toThrow(/hash/);
  }finally{rmSync(root,{recursive:true,force:true});}
 });
 it('admits the real five-year response-backed history and preserves the source date on a later publication',()=>{const value=longSource(),out=verifyLongHistorySource(JSON.stringify(value),'2026-10-26');expect(out.as_of_date).toBe('2026-10-23');expect(out.breadth.filter(p=>p.newHighs!==null).length).toBeGreaterThan(1250);expect(out.sectorRotation.frames).toHaveLength(252);expect(out.sectorBreadth).toHaveLength(12);});
 it.each(['universeDigest','classificationDigest','missingStockProvenance','warmupRatio','missingSession','futureRetrieval','sectorSum'])('rejects altered %s',kind=>{
  const value=longSource();
  if(kind==='universeDigest')value.universe.sha256='f'.repeat(64);
  if(kind==='classificationDigest')value.classification.memberships_sha256='f'.repeat(64);
  if(kind==='missingStockProvenance')value.provenance=value.provenance.filter(p=>p.symbol!==value.universe.symbols[0]);
  if(kind==='warmupRatio')value.breadth[0].ratio_10day=1;
  if(kind==='missingSession')value.breadth.splice(1,1);
  if(kind==='futureRetrieval')value.provenance[0].retrieved_at='2099-01-01T00:00:00Z';
  if(kind==='sectorSum')value.sectorBreadth[0].points[0].coverage--;
  expect(()=>verifyLongHistorySource(JSON.stringify(value),'2026-10-23')).toThrow();
 });
});
describe('market trend source projection',()=>{
 it('carries an independent close schedule without treating a future calendar date as observed market data',()=>{
  const input=source();input.refresh_schedule={provider:'pandas_market_calendars:NYSE',version:'5.4.0',generated_at:'2026-10-24T00:00:00Z',valid_until:'2026-12-08T05:00:00Z',sessions:[{date:'2026-10-23',close_at:'2026-10-23T20:00:00Z'},{date:'2026-10-26',close_at:'2026-10-26T20:00:00Z'},{date:'2026-11-27',close_at:'2026-11-27T18:00:00Z'}]};
  const result=buildMarketTrends(input,{asOfDate:'2026-10-23'});
  expect(result.refresh_schedule).toEqual(input.refresh_schedule);expect(result.as_of_date).toBe('2026-10-23');expect(result.indices[0].points.at(-1).date).toBe('2026-10-23');
  input.refresh_schedule.sessions[1].date='2026-10-23';expect(()=>buildMarketTrends(input,{asOfDate:'2026-10-23'})).toThrow(/calendar/);
 });
 it.each(['expiredBeforeLastClose','unsupportedProvider','wrongSessionDate','invalidTime','unboundedValidity'])('rejects a malformed refresh clock: %s',kind=>{
  const input=source();input.refresh_schedule={provider:'pandas_market_calendars:NYSE',version:'5.4.0',generated_at:'2026-10-24T00:00:00Z',valid_until:'2026-12-08T05:00:00Z',sessions:[{date:'2026-10-23',close_at:'2026-10-23T20:00:00Z'}]};
  if(kind==='expiredBeforeLastClose')input.refresh_schedule.valid_until='2026-10-23T19:00:00Z';
  if(kind==='unsupportedProvider')input.refresh_schedule.provider='weekday-guess';
  if(kind==='wrongSessionDate')input.refresh_schedule.sessions[0].close_at='2026-10-22T20:00:00Z';
  if(kind==='invalidTime')input.refresh_schedule.sessions[0].close_at='2026-10-23T25:00:00Z';
  if(kind==='unboundedValidity')input.refresh_schedule.valid_until='2099-12-08T05:00:00Z';
  expect(()=>buildMarketTrends(input,{asOfDate:'2026-10-23'})).toThrow(/calendar/);
 });
 it('projects actual dated separate indices and Cboe numerator/denominator',()=>{const input=source(),out=buildMarketTrends(input,{asOfDate:input.as_of_date});expect(out.indices.map(x=>x.available)).toEqual([true,true]);expect(out.indices[0].points).toHaveLength(280);expect(out.put_call.points).toHaveLength(63);for(const row of out.put_call.points)expect(row.value).toBe(row.puts/row.calls);});
 it('does not use a different date source as current',()=>{const out=buildMarketTrends(source(),{asOfDate:'2026-10-26'});expect(out.indices.every(x=>!x.available)).toBe(true);expect(out.put_call.points).toEqual([]);});
 it('rejects future/different-day Cboe evidence and preserves unknown values',()=>{const input=source();input.put_call.observations=input.put_call.observations.slice(-1);input.put_call.observations[0].provenance.url='https://www.cboe.com/markets/us/options/market-statistics/daily?dt=2026-10-22';const out=buildMarketTrends(input,{asOfDate:input.as_of_date});expect(out.put_call.points[0].value).toBeNull();});
 it('keeps the public chart universe and denominator for above50 instead of merging with liquid-stock current count',()=>{const input=source(),out=buildMarketTrends(input,{asOfDate:input.as_of_date,bookEvidence:{as_of_date:input.as_of_date,series:[{date:input.as_of_date,above50:3,coverage:4,expectedUniverseSize:7,newHighs:1,newLows:0}]}});expect(out.breadth.points[0]).toMatchObject({above50Percent:75,coverage:4,universe:7,newLows:0});expect(out.breadth.approximate).toBe(true);});
 it('retains known index history without carrying its past count into today',()=>{const input=source();input.indices[0].bars.pop();const out=buildMarketTrends(input,{asOfDate:input.as_of_date});expect(out.indices[0]).toMatchObject({available:false,historical:true,latest:null});expect(out.indices[0].points.at(-1).date).toBe('2026-10-22');expect(out.indices[0].points.at(-1).value).toEqual(expect.any(Number));});
 it('writes raw and derived data with exact content hashes and binds the manifest reference',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'market-trends-'));
  try{
   const entry={assets:{charts:{path:'existing.json'}}},historyBytes=readFileSync(resolve('data/market-history-source-2026-10-23.json'));
   const history=JSON.parse(historyBytes),historySha256=createHash('sha256').update(historyBytes).digest('hex');
   await exportMarketTrends({root,entry,asOfDate:'2026-10-23',evaluatedAt:Date.parse(history.retrieved_at)});
   const ref=entry.assets.market_trends,bytes=readFileSync(resolve(root,ref.path)),sourceBytes=readFileSync(resolve(root,ref.source_path)),payload=JSON.parse(bytes);
   expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sha256);
   expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(ref.source_sha256);
   expect(payload.source_sha256).toBe(ref.source_sha256);
   expect(entry.assets.charts.path).toBe('existing.json');expect(payload.indices[0].latest.value).toBe(5);
   expect(payload.long_history).toEqual({...history,source_sha256:historySha256});
   expect(payload.long_history.sectorRotation.frames).toHaveLength(252);
   expect(payload.long_history.breadth.filter(point=>point.newHighs!==null).length).toBeGreaterThan(1250);
   expect(readFileSync(resolve(root,`market-trends/history-source-${historySha256}.json`))).toEqual(historyBytes);
  }finally{rmSync(root,{recursive:true,force:true});}
 });
 it('replays identical selected seed and manifest bytes from a foreign cwd, ignoring a spoofed cwd seed',async()=>{
  const scratch=mkdtempSync(resolve(tmpdir(),'market-replay-'));
  try{
   const entry={assets:{}},asOfDate='2026-10-23',normal=resolve(scratch,'normal'),foreign=resolve(scratch,'foreign');
   mkdirSync(resolve(foreign,'data'),{recursive:true});
   writeFileSync(resolve(foreign,'data',`market-trend-source-${asOfDate}.json`),JSON.stringify({...source(),indices:[],put_call:{observations:[]}}));
   await exportMarketTrends({root:normal,entry,asOfDate});
   const moduleUrl=pathToFileURL(resolve('tools/export-market-trends.mjs')).href,replay=resolve(foreign,'output');
   const code=`import {exportMarketTrends} from ${JSON.stringify(moduleUrl)};const entry={assets:{}};await exportMarketTrends({root:${JSON.stringify(replay)},entry,asOfDate:${JSON.stringify(asOfDate)}});process.stdout.write(JSON.stringify(entry));`;
   const replayEntry=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:foreign,encoding:'utf8'}));
   expect(replayEntry).toEqual(entry);
   const ref=entry.assets.market_trends;
   expect(readFileSync(resolve(replay,ref.path))).toEqual(readFileSync(resolve(normal,ref.path)));
   expect(readFileSync(resolve(replay,ref.source_path))).toEqual(readFileSync(resolve(normal,ref.source_path)));
  }finally{rmSync(scratch,{recursive:true,force:true});}
 });
 it('keeps the exact-date daily source ahead of the compiler seed',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'market-daily-source-'));
  try{
   const daily=Buffer.from(JSON.stringify(source(),null,1)+'\n');
   writeFileSync(resolve(root,'market-trend-source.json'),daily);
   const entry={};await exportMarketTrends({root,entry,asOfDate:'2026-10-23'});
   const ref=entry.assets.market_trends;
   expect(ref.source_sha256).toBe(createHash('sha256').update(daily).digest('hex'));
   expect(readFileSync(resolve(root,ref.source_path))).toEqual(daily);
  }finally{rmSync(root,{recursive:true,force:true});}
 });
});
