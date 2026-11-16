import { describe,it,expect,vi } from 'vitest';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildMarketTrends,buildMarketTrendsWithStalling,exportMarketTrends,indexClosesFrom,indexState,verifyLongHistorySource,selectLongHistorySource,selectRuntimeLongHistorySource,marketIndexLogLines,stallingDays,INDEX_CLOSES_MAX,EMIT_R3_MARKET_FIELDS,STALLING_METHOD,STALLING_MAX_GAIN,STALLING_NEAR_HIGH,STALLING_WINDOW_SESSIONS } from './export-market-trends.mjs';
import { INDEX_CLOSES_MAX as CONTRACT_CLOSES_MAX, indexCloses as contractCloses } from '../src/test/fixtures/publishedContracts.js';
import { indexSummary } from '../src/static/reference/indexSummary.js';
import { FOLLOW_THROUGH_METHOD } from '../src/static/followThroughDay.js';
import { readMarketTrends } from '../src/static/marketTrendAsset.js';
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
 it('adds the follow-through state and the dated last count from the same validated index bars',()=>{
  const input=source(),out=buildMarketTrends(input,{asOfDate:input.as_of_date}),[sp,nasdaq]=out.indices;
  expect(sp.followThrough).toMatchObject({available:true,method:FOLLOW_THROUGH_METHOD,asOf:'2026-10-23',state:'confirmed',ftd:{date:'2026-04-08',attemptDay:6}});
  expect(sp.followThrough.ftd.distributionSince).toBe(sp.events.filter(event=>event.state==='active'&&event.date>'2026-04-08').length);
  expect(nasdaq.followThrough).toMatchObject({available:true,asOf:'2026-10-23',state:'no_correction',ftd:null});
  expect(nasdaq.followThrough.events.filter(event=>event.type==='ftd').map(event=>event.date)).toEqual(['2026-04-14']);
  for(const index of out.indices)expect(index.lastObserved).toEqual({date:index.latest.date,value:index.latest.value});
  expect(readMarketTrends(out,{as_of_date:input.as_of_date}).indices.map(index=>index.followThrough.state)).toEqual(['confirmed','no_correction']);
 });
 it('records each index position with indexSummary on the same validated bars and last date as its count',()=>{
  const input=source(),out=buildMarketTrends(input,{asOfDate:input.as_of_date});
  for(const index of out.indices){
   const bars=input.indices.find(item=>item.symbol===index.symbol).bars,summary=indexSummary(bars.map(bar=>({date:bar.date,close:bar.close})));
   expect(index.state).toEqual({date:'2026-10-23',close:summary.close,vs50:summary.vsMa,vs200:summary.vs200,fromHigh:summary.fromHigh,fullYear:true});
   expect(index.state.date).toBe(index.points.at(-1).date);
   for(const field of ['vs50','vs200','fromHigh'])expect(index.state[field]).toEqual(expect.any(Number));
  }
  // The reader passes the field through as published.
  expect(readMarketTrends(out,{as_of_date:input.as_of_date}).indices[1].state).toEqual(out.indices[1].state);
  // A historical index keeps its own last session; no source, or bars that fail validation, record no position.
  const late=source();late.indices[0].bars.pop();
  expect(buildMarketTrends(late,{asOfDate:late.as_of_date}).indices[0].state).toMatchObject({date:'2026-10-22',fullYear:true});
  for(const index of buildMarketTrends(source(),{asOfDate:'2026-10-26'}).indices)expect(index.state).toBeNull();
  const broken=source();broken.indices[1].bars[100].volume=0;
  expect(buildMarketTrends(broken,{asOfDate:broken.as_of_date}).indices[1].state).toBeNull();
 });
 it('writes each index\'s closes from the same validated bars as its count, at most 300 (plan §2.3)',()=>{
  expect(INDEX_CLOSES_MAX).toBe(CONTRACT_CLOSES_MAX);
  const input=source(),out=buildMarketTrends(input,{asOfDate:input.as_of_date});
  for(const index of out.indices){
   const bars=input.indices.find(item=>item.symbol===index.symbol).bars;
   expect(index.closes).toEqual(bars.slice(-INDEX_CLOSES_MAX).map(bar=>({date:bar.date,close:bar.close})));
   // The closes end on the count's own last session, day for day with its points.
   expect(index.closes.map(point=>point.date)).toEqual(index.points.slice(-index.closes.length).map(point=>point.date));
   expect(index.closes.at(-1)).toEqual({date:index.state.date,close:index.state.close});
   expect(Object.keys(index.closes[0])).toEqual(Object.keys(contractCloses[0]));
  }
  // The reader passes valid closes through as published.
  expect(readMarketTrends(out,{as_of_date:input.as_of_date}).indices[1].closes).toEqual(out.indices[1].closes);
  // A longer window keeps its newest 300 bars; a historical index stops at its own last session.
  const many=Array.from({length:320},(_,i)=>({date:new Date(Date.UTC(2025,0,1)+i*86400000).toISOString().slice(0,10),close:100+i}));
  expect(indexClosesFrom(many,many.at(-1).date)).toHaveLength(INDEX_CLOSES_MAX);
  expect(indexClosesFrom(many,many.at(-1).date)[0]).toEqual({date:many[20].date,close:many[20].close});
  expect(indexClosesFrom(many,many[9].date)).toEqual(many.slice(0,10));
  const late=source();late.indices[0].bars.pop();
  expect(buildMarketTrends(late,{asOfDate:late.as_of_date}).indices[0].closes.at(-1).date).toBe('2026-10-22');
 });
 it('writes no closes when the index has no source of the date or its bars fail validation',()=>{
  for(const index of buildMarketTrends(source(),{asOfDate:'2026-10-26'}).indices)expect('closes' in index).toBe(false);
  const broken=source();broken.indices[1].bars[100].volume=0;
  const out=buildMarketTrends(broken,{asOfDate:broken.as_of_date});
  expect('closes' in out.indices[1]).toBe(false);
  expect(out.indices[0].closes).toHaveLength(280);
 });
 it('leaves a distance null when its window is short, never 0',()=>{
  const short=source();short.calendar.sessions=short.calendar.sessions.slice(-120);for(const index of short.indices)index.bars=index.bars.slice(-120);
  const [sp]=buildMarketTrends(short,{asOfDate:short.as_of_date}).indices;
  expect(sp.available).toBe(true);
  expect(sp.state).toMatchObject({date:'2026-10-23',vs200:null,fromHigh:null,fullYear:false});
  expect(sp.state.vs50).toEqual(expect.any(Number));
  // A short window publishes the closes it has (the market tab draws no 200-day line under 200 of them), never padded.
  expect(sp.closes).toHaveLength(120);
  expect(sp.closes.at(-1).date).toBe('2026-10-23');
  const bars=source().indices[0].bars;
  expect(indexState(bars.slice(-230),bars.at(-1).date)).toMatchObject({vs200:expect.any(Number),fromHigh:null,fullYear:false});
  expect(indexState(bars.slice(-30),bars.at(-1).date)).toEqual({date:'2026-10-23',close:bars.at(-1).close,vs50:null,vs200:null,fromHigh:null,fullYear:false});
  expect(indexState([],'2026-10-23')).toBeNull();
 });
 it('dates a historical index count and follow-through to its own last session while latest stays null',()=>{
  const input=source();input.indices[0].bars.pop();
  const out=buildMarketTrends(input,{asOfDate:input.as_of_date}),[sp,nasdaq]=out.indices;
  expect(sp).toMatchObject({available:false,historical:true,latest:null,lastObserved:{date:'2026-10-22',value:sp.points.at(-1).value}});
  expect(sp.lastObserved.value).toEqual(expect.any(Number));
  expect(sp.followThrough).toMatchObject({available:true,asOf:'2026-10-22',state:'confirmed'});
  expect(nasdaq.followThrough.asOf).toBe('2026-10-23');
  expect(readMarketTrends(out,{as_of_date:input.as_of_date}).indices[0].lastObserved).toEqual(sp.lastObserved);
 });
 it('marks follow-through unavailable with the index reason when bars are missing or invalid, never as a state',()=>{
  for(const index of buildMarketTrends(source(),{asOfDate:'2026-10-26'}).indices){
   expect(index.followThrough).toEqual({available:false,method:FOLLOW_THROUGH_METHOD,reason:index.reason});
   expect(index.lastObserved).toBeNull();
  }
  const input=source();input.indices[1].bars[100].volume=0;
  const broken=buildMarketTrends(input,{asOfDate:input.as_of_date}).indices[1];
  expect(broken).toMatchObject({available:false,lastObserved:null,followThrough:{available:false,method:FOLLOW_THROUGH_METHOD,reason:broken.reason}});
  expect(broken.reason).toMatch(/ゼロ件とは扱いません/);
 });
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
 },60_000);
 it('replays identical selected seed and manifest bytes from a foreign cwd, ignoring a spoofed cwd seed',async()=>{
  const scratch=mkdtempSync(resolve(tmpdir(),'market-replay-'));
  try{
   const entry={assets:{}},asOfDate='2026-10-23',normal=resolve(scratch,'normal'),foreign=resolve(scratch,'foreign');
   mkdirSync(resolve(foreign,'data'),{recursive:true});
   writeFileSync(resolve(foreign,'data',`market-trend-source-${asOfDate}.json`),JSON.stringify({...source(),indices:[],put_call:{observations:[]}}));
   await exportMarketTrends({root:normal,entry,asOfDate});
   const moduleUrl=pathToFileURL(resolve('tools/export-market-trends.mjs')).href,replay=resolve(foreign,'output');
   const code=`import {exportMarketTrends} from ${JSON.stringify(moduleUrl)};const entry={assets:{}};await exportMarketTrends({root:${JSON.stringify(replay)},entry,asOfDate:${JSON.stringify(asOfDate)}});process.stdout.write(JSON.stringify(entry));`;
   // Round 3 M0: the exporter prints one log line per index ahead of the entry, so the entry is the last line.
   const stdout=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:foreign,encoding:'utf8'}).split('\n');
   const replayEntry=JSON.parse(stdout.at(-1));
   expect(replayEntry).toEqual(entry);
   const ref=entry.assets.market_trends;
   // Round 3 M8d: with emission off, the stalling fields come from the same build, not from the written series.
   const {stalling}=buildMarketTrendsWithStalling(source(),{asOfDate});
   expect(stdout.slice(0,-1)).toEqual(marketIndexLogLines(JSON.parse(readFileSync(resolve(replay,ref.path),'utf8')),{stalling}));
   expect(readFileSync(resolve(replay,ref.path))).toEqual(readFileSync(resolve(normal,ref.path)));
   expect(readFileSync(resolve(replay,ref.source_path))).toEqual(readFileSync(resolve(normal,ref.source_path)));
  }finally{rmSync(scratch,{recursive:true,force:true});}
 },60_000);
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
// Round 3 M0: one CI log line per index, read from the asset's own objects (docs/round3/market.md).
describe('market index log lines (M0)',()=>{
 const LINE=/^Market indices (\S+): (\S+) last=(\S+) historical=(true|false) dd=(.+?) ddDates=(.+?) ft=(.+?) day=(\S+) ftd=(\S+) decline=(\S+) stalling=(.+?) stallingDates=(\S+)$/;
 const parse=line=>{const m=LINE.exec(line);expect(m,line).not.toBeNull();const [,asOf,symbol,last,historical,dd,ddDates,ft,day,ftd,decline,stalling,stallingDates]=m;return {asOf,symbol,last,historical,dd,ddDates,ft,day,ftd,decline,stalling,stallingDates};};
 const activeDates=index=>`[${index.events.filter(event=>event.state==='active').map(event=>event.date).join(',')}]`;
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 it('(a) prints a current index from its last point, dated count, active distribution dates and follow-through',()=>{
  const input=source(),out=buildMarketTrends(input,{asOfDate:input.as_of_date}),lines=marketIndexLogLines(out);
  expect(lines).toHaveLength(2);
  const [sp,nasdaq]=lines.map(parse);
  // Anchors the existing projection tests already assert for this source.
  expect(sp).toMatchObject({asOf:'2026-10-23',symbol:'^GSPC',last:'2026-10-23',historical:'false',dd:'5',ft:'confirmed',day:'-',ftd:'2026-04-08'});
  expect(nasdaq).toMatchObject({asOf:'2026-10-23',symbol:'^IXIC',last:'2026-10-23',historical:'false',ft:'no_correction',day:'-',ftd:'-'});
  for(const [i,field] of [sp,nasdaq].entries()){
   const index=out.indices[i];
   expect(field.last).toBe(index.points.at(-1).date);expect(field.last).toBe(index.latest.date);
   expect(Number(field.dd)).toBe(index.latest.value);
   expect(field.ddDates).toBe(activeDates(index));
   expect(field.ddDates.slice(1,-1).split(',')).toHaveLength(index.latest.value);
   expect(field.decline).toBe(index.followThrough.declinePct.toFixed(2));
  }
  for(const line of lines)expect(line).not.toMatch(/\n/);
 });
 it('(b) prints a series that ends one session early as historical, with its own last count under its own date',()=>{
  const input=source();input.indices[0].bars.pop();
  const out=buildMarketTrends(input,{asOfDate:input.as_of_date}),[sp,nasdaq]=marketIndexLogLines(out).map(parse),index=out.indices[0];
  expect(index).toMatchObject({available:false,historical:true,latest:null});
  expect(sp).toMatchObject({asOf:'2026-10-23',symbol:'^GSPC',last:'2026-10-22',historical:'true',ft:'confirmed',ftd:'2026-04-08'});
  expect(sp.last).toBe(index.lastObserved.date);
  expect(Number(sp.dd)).toBe(index.lastObserved.value);
  expect(sp.ddDates).toBe(activeDates(index));
  expect(sp.decline).toBe(index.followThrough.declinePct.toFixed(2));
  expect(index.followThrough.asOf).toBe('2026-10-22');
  expect(nasdaq).toMatchObject({last:'2026-10-23',historical:'false'});
 });
 it('(c) prints a missing OHLCV value as unavailable with the asset\'s own reason, never as 0 or an empty list',()=>{
  const input=source();input.indices[1].bars[100].volume=null;
  const out=buildMarketTrends(input,{asOfDate:input.as_of_date}),lines=marketIndexLogLines(out),[sp,nasdaq]=lines.map(parse),index=out.indices[1];
  expect(index.available).toBe(false);
  // Round 3 M8d: no stalling side input here, so stalling is unavailable(-) on both lines, never 0.
  expect(nasdaq).toEqual({asOf:'2026-10-23',symbol:'^IXIC',last:'-',historical:'false',dd:`unavailable(${index.reason})`,ddDates:'-',ft:`unavailable(${index.followThrough.reason})`,day:'-',ftd:'-',decline:'-',stalling:'unavailable(-)',stallingDates:'-'});
  expect(index.reason).toMatch(/ゼロ件とは扱いません/);
  expect(lines[1]).not.toMatch(/ dd=\d| ft=\d| ddDates=\[/);
  expect(sp).toMatchObject({last:'2026-10-23',dd:'5',ft:'confirmed'});
  // No source of the date: both indices print their reason.
  const missing=buildMarketTrends(source(),{asOfDate:'2026-10-26'});
  marketIndexLogLines(missing).map(parse).forEach((field,i)=>{
   expect(field).toEqual({asOf:'2026-10-26',symbol:missing.indices[i].symbol,last:'-',historical:'false',dd:`unavailable(${missing.indices[i].reason})`,ddDates:'-',ft:`unavailable(${missing.indices[i].followThrough.reason})`,day:'-',ftd:'-',decline:'-',stalling:'unavailable(-)',stallingDates:'-'});
  });
  // A collector reason (a Python str(error)) stays on one line and cannot start a workflow command.
  const failed=source();failed.indices[1]={symbol:'^IXIC',bars:[],unavailable_reason:'HTTP 404\n::error::Not Found'};
  const line=marketIndexLogLines(buildMarketTrends(failed,{asOfDate:failed.as_of_date}))[1];
  expect(line.split('\n')).toHaveLength(1);
  expect(parse(line)).toMatchObject({dd:'unavailable(HTTP 404 ::error::Not Found)',ft:'unavailable(HTTP 404 ::error::Not Found)',ddDates:'-'});
 });
 it('(d) prints a rally attempt\'s day and a confirmed follow-through day from the asset\'s follow-through',()=>{
  // The same real bars up to 2026-04-08: the S&P's FTD session, the Nasdaq's sixth rally-attempt day.
  const input=source(),date='2026-04-08';input.as_of_date=date;for(const index of input.indices)index.bars=index.bars.filter(bar=>bar.date<=date);
  const out=buildMarketTrends(input,{asOfDate:date}),[sp,nasdaq]=marketIndexLogLines(out).map(parse),[spIndex,nasdaqIndex]=out.indices;
  expect(spIndex.followThrough).toMatchObject({state:'confirmed',ftd:{date,attemptDay:6},attempt:null,declinePct:null});
  expect(sp).toMatchObject({asOf:date,symbol:'^GSPC',last:date,historical:'false',ft:'confirmed',day:'-',ftd:date,decline:'-'});
  expect(nasdaqIndex.followThrough).toMatchObject({state:'rally_attempt',attempt:{startDate:'2026-03-31',day:6},ftd:null});
  expect(nasdaq).toMatchObject({asOf:date,symbol:'^IXIC',last:date,historical:'false',ft:'rally_attempt',day:'6',ftd:'-'});
  expect(nasdaq.decline).toBe(nasdaqIndex.followThrough.declinePct.toFixed(2));
  for(const [field,index] of [[sp,spIndex],[nasdaq,nasdaqIndex]]){expect(Number(field.dd)).toBe(index.latest.value);expect(field.ddDates).toBe(activeDates(index));}
 });
 it('never throws on a malformed payload and writes a negative decline with U+2212',()=>{
  expect(marketIndexLogLines(null)).toEqual([]);expect(marketIndexLogLines({})).toEqual([]);expect(marketIndexLogLines({},null)).toEqual([]);
  expect(parse(marketIndexLogLines({as_of_date:'2026-10-23',indices:[{symbol:'^GSPC'}]},null)[0])).toMatchObject({stalling:'unavailable(-)',stallingDates:'-'});
  const [line]=marketIndexLogLines({as_of_date:'2026-10-23',indices:[{symbol:'^GSPC',points:[{date:'2026-10-23',value:null}],lastObserved:{date:'2026-10-22',value:4},events:[],followThrough:{available:true,state:'correction',declinePct:-1.234,attempt:null,ftd:null}}]});
  // A last count that is not the last point's count is not printed under the last point's date.
  expect(parse(line)).toMatchObject({last:'2026-10-23',dd:'unavailable(-)',ddDates:'-',decline:'−1.23'});
  expect(parse(marketIndexLogLines({as_of_date:'2026-10-23',indices:[null]})[0])).toMatchObject({symbol:'-',dd:'unavailable(-)',ft:'unavailable(-)'});
 });
 it('logs the written lines without changing the payload or the series bytes, path and hash',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'market-trends-log-')),log=vi.spyOn(console,'log').mockImplementation(()=>{});
  try{
   const bytes=readFileSync(resolve('data/market-trend-source-2026-10-23.json')),built=buildMarketTrends(JSON.parse(bytes),{asOfDate:'2026-10-23',sourceSha256:sha(bytes)});
   const body=JSON.stringify(built),lines=marketIndexLogLines(built,{stalling:buildMarketTrendsWithStalling(JSON.parse(bytes),{asOfDate:'2026-10-23'}).stalling});
   expect(lines.every(line=>/ stalling=0 stallingDates=\[\]$/.test(line))).toBe(true);
   expect(JSON.stringify(built)).toBe(body);
   // Before the long-history capture was retrieved (as above), so the written series is buildMarketTrends' payload alone.
   const entry={},result=await exportMarketTrends({root,entry,asOfDate:'2026-10-23',evaluatedAt:Date.parse('2026-10-26T22:00:00Z')});
   const ref=entry.assets.market_trends;
   expect(ref).toMatchObject({path:`market-trends/series-${sha(body)}.json`,sha256:sha(body),source_sha256:sha(bytes)});
   expect(readFileSync(resolve(root,ref.path),'utf8')).toBe(body);
   expect(result).toEqual(built);
   expect(log.mock.calls).toEqual(lines.map(line=>[line]));
  }finally{log.mockRestore();rmSync(root,{recursive:true,force:true});}
 });
});
// Round 3 M8d: stalling days beside the distribution count, written only with EMIT_R3_MARKET_FIELDS (docs/round3/market.md).
describe('stalling days (M8d)',()=>{
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const dayOf=k=>new Date(Date.UTC(2026,0,1)+k*86400000).toISOString().slice(0,10);
 // Rising closes that sit at the top of each day's range (close = high), so no baseline session can stall.
 const rising=n=>Array.from({length:n},(_,k)=>{const close=100*1.005**k;return {date:dayOf(k),open:close/1.004,high:close,low:close/1.004*.998,close,volume:1000+k};});
 // Session `at`: up `gain` on a higher volume, in the lower part of its range (close − low = 1/6 of the range).
 const stall=(bars,at,{gain=.001,volume=100,lowFactor=.999,highFactor=1.005}={})=>{
  const close=bars[at-1].close*(1+gain);
  bars[at]={date:bars[at].date,open:close,high:close*highFactor,low:close*lowFactor,close,volume:bars[at-1].volume+volume};
  return bars;
 };
 const last=bars=>bars.at(-1).date;
 it('mirrors the backend constants and is off',()=>{
  expect(EMIT_R3_MARKET_FIELDS).toBe(false);
  expect([STALLING_MAX_GAIN,STALLING_NEAR_HIGH,STALLING_WINDOW_SESSIONS]).toEqual([0.002,0.03,25]);
  const backend=readFileSync(resolve('../backend/app/services/market_regime.py'),'utf8');
  expect(backend).toMatch(/^STALL_MAX_GAIN = 0\.002\b/m);expect(backend).toMatch(/^STALL_NEAR_HIGH_PCT = 0\.03\b/m);expect(backend).toMatch(/^DIST_WINDOW = 25\b/m);
 });
 it('finds a session that meets every condition',()=>{
  const bars=stall(rising(60),59);
  expect(stallingDays({bars,asOfDate:last(bars)})).toEqual({available:true,method:STALLING_METHOD,dates:[last(bars)]});
  expect(stallingDays({bars:rising(60),asOfDate:last(bars)})).toEqual({available:true,method:STALLING_METHOD,dates:[]});
 });
 it.each([
  ['an unchanged close',{gain:0}],
  ['a down close',{gain:-.001}],
  ['an up close above +0.2%',{gain:.0021}],
  ['volume equal to the previous session',{volume:0}],
  ['lower volume',{volume:-1}],
  ['a close in the upper half',{lowFactor:.995,highFactor:1.001}],
 ])('rejects %s alone',(_,change)=>{
  const bars=stall(rising(60),59,change);
  expect(stallingDays({bars,asOfDate:last(bars)})).toEqual({available:true,method:STALLING_METHOD,dates:[]});
 });
 it('keeps +0.19% and a close at the range midpoint, and needs a non-zero range',()=>{
  for(const change of [{gain:.0019},{lowFactor:.997,highFactor:1.003}]){
   const bars=stall(rising(60),59,change);
   expect(stallingDays({bars,asOfDate:last(bars)}).dates).toEqual([last(bars)]);
  }
  const flat=stall(rising(60),59);flat[59]={...flat[59],open:flat[59].close,high:flat[59].close,low:flat[59].close};
  expect(stallingDays({bars:flat,asOfDate:last(flat)}).dates).toEqual([]);
 });
 it('needs a close within 3% of the 25-session closing high',()=>{
  for(const [spike,dates] of [[1.029,1],[1.031,0]]){
   const bars=stall(rising(60),59),close=bars[59].close;
   // One earlier close inside the 25-session window, `spike` above the stalling close.
   bars[40]={...bars[40],open:close*spike,high:close*spike,low:close*spike*.99,close:close*spike};
   expect(stallingDays({bars,asOfDate:last(bars)}).dates).toHaveLength(dates);
   // Outside the window (26 sessions earlier) the same close does not count.
   const outside=stall(rising(60),59);outside[33]={...bars[40],date:outside[33].date};
   expect(stallingDays({bars:outside,asOfDate:last(outside)}).dates).toEqual([last(outside)]);
  }
 });
 it('expires after 25 sessions, as a distribution day does',()=>{
  const bars=stall(rising(90),50);
  expect(stallingDays({bars,asOfDate:bars[50].date}).dates).toEqual([bars[50].date]);
  expect(stallingDays({bars,asOfDate:bars[50+24].date}).dates).toEqual([bars[50].date]);
  expect(stallingDays({bars,asOfDate:bars[50+25].date}).dates).toEqual([]);
 });
 it('is unavailable on bad, missing or short OHLCV, never an empty list',()=>{
  const ok=rising(60),date=last(ok);
  const cases={
   short:{bars:rising(48),asOfDate:rising(48).at(-1).date},
   empty:{bars:[],asOfDate:date},none:{asOfDate:date},badDate:{bars:ok,asOfDate:'2026-02-30'},
   noBarOnDate:{bars:ok,asOfDate:dayOf(60)},
   nullBar:{bars:[...ok.slice(0,30),null,...ok.slice(30)],asOfDate:date},
   missingVolume:{bars:ok.map((bar,i)=>i===20?{...bar,volume:null}:bar),asOfDate:date},
   zeroVolume:{bars:ok.map((bar,i)=>i===20?{...bar,volume:0}:bar),asOfDate:date},
   nanClose:{bars:ok.map((bar,i)=>i===20?{...bar,close:NaN}:bar),asOfDate:date},
   highBelowClose:{bars:ok.map((bar,i)=>i===20?{...bar,high:bar.close*.99}:bar),asOfDate:date},
   duplicate:{bars:[...ok.slice(0,21),ok[20],...ok.slice(21)],asOfDate:date},
  };
  for(const [name,input] of Object.entries(cases)){
   const value=stallingDays(input);
   expect(value,name).toEqual({available:false,method:STALLING_METHOD,reason:expect.any(String)});
   expect(value.reason.length,name).toBeGreaterThan(0);
  }
  expect(stallingDays({bars:rising(49),asOfDate:rising(49).at(-1).date}).available).toBe(true);
  expect(stallingDays()).toMatchObject({available:false});
 });
 it('finds the real ^GSPC stalling day of 2026-07-27 on the committed bars',()=>{
  const [sp]=source().indices;
  expect(stallingDays({bars:sp.bars,asOfDate:'2026-07-27'}).dates).toEqual(['2026-07-27']);
  expect(stallingDays({bars:sp.bars,asOfDate:'2026-10-23'}).dates).toEqual([]);
 });
 it('leaves the payload bytes of the base commit unchanged while emission is off',()=>{
  const bytes=readFileSync(resolve('data/market-trend-source-2026-10-23.json'));
  // sha256 of JSON.stringify(buildMarketTrends(…)) at 45603f06, taken before stalling existed (docs/round3/market.md).
  const built=buildMarketTrends(JSON.parse(bytes),{asOfDate:'2026-10-23',sourceSha256:sha(bytes)});
  expect(sha(JSON.stringify(built))).toBe('ed029467dc598143690d59bf3296e9015a5ac6025bb1acbe7886ef59932e2df6');
  const late=source();late.indices[0].bars.pop();
  expect(sha(JSON.stringify(buildMarketTrends(late,{asOfDate:'2026-10-23'})))).toBe('242bbf6fbb59a38eede73dc72acbbc9c0a473581d4e2a4ee57f8ab0d86ad6a29');
  for(const index of built.indices)expect('stalling' in index).toBe(false);
  const on=buildMarketTrends(JSON.parse(bytes),{asOfDate:'2026-10-23',sourceSha256:sha(bytes),emitR3MarketFields:true});
  expect(JSON.stringify({...on,indices:on.indices.map(({stalling,...index})=>index)})).toBe(JSON.stringify(built));
 });
 it('writes the shape with emission on and never mixes stalling days into the distribution count',()=>{
  // The committed bars up to 2026-07-27: the ^GSPC stalling day is the last session.
  const date='2026-07-27',input=source();input.as_of_date=date;for(const index of input.indices)index.bars=index.bars.filter(bar=>bar.date<=date);
  const off=buildMarketTrendsWithStalling(structuredClone(input),{asOfDate:date}),on=buildMarketTrendsWithStalling(structuredClone(input),{asOfDate:date,emitR3MarketFields:true});
  const [sp,nasdaq]=on.payload.indices;
  expect(sp.stalling).toEqual({available:true,method:STALLING_METHOD,dates:[date]});
  expect(nasdaq.stalling).toEqual({available:true,method:STALLING_METHOD,dates:[]});
  expect(on.stalling).toEqual(off.stalling);expect(on.stalling['^GSPC']).toBe(sp.stalling);
  for(const [i,index] of on.payload.indices.entries()){
   const plain=off.payload.indices[i];
   for(const key of ['points','events','latest','lastObserved','followThrough','closes','state'])expect(index[key],key).toEqual(plain[key]);
  }
  expect(sp.events.some(event=>event.date===date)).toBe(false);
  expect(sp.points.at(-1)).toMatchObject({date,distribution:false});
  // Written or not, the log line is the same.
  expect(marketIndexLogLines(on.payload)).toEqual(marketIndexLogLines(off.payload,{stalling:off.stalling}));
  expect(marketIndexLogLines(on.payload)[0]).toMatch(new RegExp(` stalling=1 stallingDates=\\[${date}\\]$`));
 });
 it('carries the index\'s own reason when the index is unavailable, and a historical index\'s own last date',()=>{
  const broken=source();broken.indices[1].bars[100].volume=null;
  const out=buildMarketTrends(broken,{asOfDate:broken.as_of_date,emitR3MarketFields:true});
  expect(out.indices[1].stalling).toEqual({available:false,method:STALLING_METHOD,reason:out.indices[1].reason});
  expect(out.indices[1].reason).toMatch(/ゼロ件とは扱いません/);
  const missing=buildMarketTrends(source(),{asOfDate:'2026-10-26',emitR3MarketFields:true});
  for(const index of missing.indices)expect(index.stalling).toEqual({available:false,method:STALLING_METHOD,reason:index.reason});
  const lines=marketIndexLogLines(missing);
  for(const [i,line] of lines.entries())expect(line.endsWith(` stalling=unavailable(${missing.indices[i].reason}) stallingDates=-`)).toBe(true);
  const late=source();late.indices[0].bars=late.indices[0].bars.filter(bar=>bar.date<='2026-07-27');
  const [sp]=buildMarketTrends(late,{asOfDate:late.as_of_date,emitR3MarketFields:true}).indices;
  expect(sp).toMatchObject({historical:true,stalling:{available:true,method:STALLING_METHOD,dates:['2026-07-27']}});
 });
});
