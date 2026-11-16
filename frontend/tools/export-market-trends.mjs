import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distributionDays } from '../src/static/distributionDays.js';
import { followThroughDay, FOLLOW_THROUGH_METHOD } from '../src/static/followThroughDay.js';
import { validateLongHistory } from '../src/static/marketLongHistory.js';
import { indexSummary } from '../src/static/reference/indexSummary.js';
import { INDEX_CLOSES_MAX } from '../src/static/marketTrendAsset.js';
import { isGeneratedOutput, removeSupersededOutputs } from './superseded-export.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const isDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const provenance=(value,host,date)=>{try{return Boolean(value&&typeof value.url==='string'&&new URL(value.url).protocol==='https:'&&new URL(value.url).hostname===host&&/^[a-f0-9]{64}$/.test(value.sha256||'')&&Number.isFinite(Date.parse(value.retrieved_at))&&value.retrieved_at.slice(0,10)>=date&&Date.parse(value.retrieved_at)<=Date.now());}catch{return false;}};
export function verifyLongHistorySource(bytes,asOfDate){
 const history=validateLongHistory(JSON.parse(bytes),asOfDate);
 if(hash(JSON.stringify(history.universe.symbols))!==history.universe.sha256)throw Error('Long-history universe hash mismatch');
 if(history.classification&&hash(JSON.stringify(history.classification.memberships))!==history.classification.memberships_sha256)throw Error('Long-history classification hash mismatch');
 return history;
}

/**
 * The index's position on the same validated bars and last date as its distribution count: indexSummary, the
 * function the market tab and the market-regime study use. A distance needs its window (50 / 200 closes, a full
 * 252-session year for the high); a short window leaves the field null, never 0.
 */
export function indexState(bars,lastDate){
  const closes=bars.filter(bar=>bar.date<=lastDate).map(bar=>({date:bar.date,close:bar.close}));
  const summary=indexSummary(closes),last=closes.at(-1);
  if(!summary)return last?{date:last.date,close:last.close,vs50:null,vs200:null,fromHigh:null,fullYear:false}:null;
  return {date:summary.date,close:summary.close,vs50:summary.vsMa,vs200:summary.vs200,fromHigh:summary.fullYear?summary.fromHigh:null,fullYear:summary.fullYear};
}

// The most closes an index series carries (plan §2.3): one constant, the reader's (marketTrendAsset.js), which also
// refuses a longer series. The market tab charts the last 130 with their 50/200-day lines.
export { INDEX_CLOSES_MAX };
/**
 * An index's closes for the market tab's chart, [{date, close}]: the last INDEX_CLOSES_MAX of the same validated bars
 * (the distribution count's input, up to its own last date), so the line, its marks and its position share one series.
 */
export function indexClosesFrom(bars,lastDate){
  return bars.filter(bar=>bar.date<=lastDate).slice(-INDEX_CLOSES_MAX).map(bar=>({date:bar.date,close:bar.close}));
}

// Round 3 M8d (round 3 plan rule 18, UI before data): an index's `stalling` is computed and logged on every run, but
// written to the asset only once this is true. It stays false until the round-3 UI that reads it is confirmed on Pages,
// and is flipped only by that later follow-up commit; while it is false the payload bytes are those before `stalling`.
export const EMIT_R3_MARKET_FIELDS=false;
// Stalling days, mirrored from the backend's approximation (backend/app/services/market_regime.py, STALL_MAX_GAIN,
// STALL_NEAR_HIGH_PCT and DIST_WINDOW in _distribution_days). IBD does not publish its definition; these are the
// app's own settings (独自設定). A stalling day is never part of the distribution count, its points or its events.
export const STALLING_METHOD='stalling-up0.2-higher-volume-lower-half-near3-age25-v1';
export const STALLING_MAX_GAIN=0.002;        // an up close of at most +0.2% (and above 0)
export const STALLING_NEAR_HIGH=0.03;        // a close within 3% of the 25-session closing high (that day included)
export const STALLING_WINDOW_SESSIONS=25;    // the closing-high window, and the age at which a stalling day expires
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
/**
 * The stalling days still live on asOfDate, oldest first, on the same validated bars and last date as the distribution
 * count: an up close of more than 0 and at most +0.2% (close/previous close − 1, as pandas' pct_change) on volume
 * above the previous session's, closing in the lower half of a non-zero range, within 3% of the 25-session closing
 * high. Like a distribution day it is age 0 on its own session and expires after 25 later sessions. The backend also
 * removes one after a later close 5% above it (DIST_EXPIRY_RALLY); this does not (see docs/round3/market.md).
 * Every session of the live window needs its full 25-session window, so fewer than 49 bars is unavailable, as is any
 * bad or missing OHLCV: `{available:false, method, reason}`, never an empty list for unknown. The bars carry no
 * calendar, so the caller passes bars that distributionDays has already checked against the sessions.
 */
export function stallingDays({bars,asOfDate}={}){
  const unavailable=reason=>({available:false,method:STALLING_METHOD,reason});
  if(!isDay(asOfDate)||!Array.isArray(bars)||bars.some(bar=>!isDay(bar?.date)))return unavailable('指数・日付を確認できません。');
  const input=bars.filter(bar=>bar.date<=asOfDate);
  if(!input.length||input.at(-1).date!==asOfDate||input.some((bar,index)=>(index>0&&bar.date<=input[index-1].date)||!['open','high','low','close','volume'].every(key=>positive(bar[key]))||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close)))
    return unavailable('指数OHLCVに欠測・重複・不正値があります。ゼロ件とは扱いません。');
  const span=STALLING_WINDOW_SESSIONS;
  if(input.length<2*span-1)return unavailable('25営業日の判定に必要な履歴が不足しています。');
  const dates=[];
  for(let index=input.length-span;index<input.length;index++){
    const bar=input[index],previous=input[index-1],gain=bar.close/previous.close-1,range=bar.high-bar.low;
    const closingHigh=Math.max(...input.slice(index-span+1,index+1).map(item=>item.close));
    if(gain>0&&gain<=STALLING_MAX_GAIN&&bar.volume>previous.volume&&range>0&&bar.close-bar.low<=0.5*range&&bar.close>=closingHigh*(1-STALLING_NEAR_HIGH))dates.push(bar.date);
  }
  return {available:true,method:STALLING_METHOD,dates};
}

// Log text only (round 3 M0): one line, so a Python str(error) reason cannot split the line or start a workflow command.
const logText=value=>String(value).replace(/\s+/g,' ').trim();
const logUnavailable=reason=>`unavailable(${typeof reason==='string'&&logText(reason)?logText(reason):'-'})`;
const logPercent=value=>{const text=Math.abs(value).toFixed(2);return value<0&&text!=='0.00'?`−${text}`:text;};
/**
 * One CI log line per index of a built market-trends payload (round 3 M0; no published field, no UI):
 * `Market indices <as_of_date>: <symbol> last=<date|-> historical=<bool> dd=<n|unavailable(<reason>)> ddDates=[…]|-
 *  ft=<state|unavailable(<reason>)> day=<n|-> ftd=<date|-> decline=<x.xx|-> stalling=<n|unavailable(<reason>)> stallingDates=[…]|-`.
 * Every value but stalling is read from the objects written to the asset (points, lastObserved, events, followThrough);
 * nothing is recomputed. `last` is the index's last bar (its last point); `dd` is the dated last count (lastObserved), printed
 * only when it is that bar's count, so a historical index prints its own past count under its own date. A count that
 * is not there prints `unavailable(<the index's reason>)` and its dates `-`, never 0 or an empty list. Never throws.
 * Round 3 M8d: `stalling` is the index's written `stalling` when emission is on, else the same build's value passed as
 * `{stalling: {<symbol>: …}}` (buildMarketTrendsWithStalling); neither prints `unavailable(-)`, never 0.
 */
export function marketIndexLogLines(payload,options){
  const computed=options?.stalling;
  const indices=Array.isArray(payload?.indices)?payload.indices:[];
  return indices.map(index=>{
    const last=Array.isArray(index?.points)?index.points.at(-1)?.date??null:null;
    const observed=index?.lastObserved,counted=Boolean(last)&&observed?.date===last&&Number.isSafeInteger(observed?.value);
    const active=Array.isArray(index?.events)?index.events.filter(event=>event?.state==='active').map(event=>event.date):[];
    const ft=index?.followThrough,read=ft?.available===true;
    const stall=index?.stalling??computed?.[index?.symbol],stalled=stall?.available===true&&Array.isArray(stall.dates);
    return [`Market indices ${payload.as_of_date}: ${index?.symbol??'-'}`,
      `last=${last??'-'}`,`historical=${index?.historical===true}`,
      `dd=${counted?observed.value:logUnavailable(index?.reason)}`,`ddDates=${counted?`[${active.join(',')}]`:'-'}`,
      `ft=${read?ft.state:logUnavailable(ft?.reason)}`,
      `day=${read&&Number.isSafeInteger(ft.attempt?.day)?ft.attempt.day:'-'}`,
      `ftd=${read&&typeof ft.ftd?.date==='string'?ft.ftd.date:'-'}`,
      `decline=${read&&Number.isFinite(ft.declinePct)?logPercent(ft.declinePct):'-'}`,
      `stalling=${stalled?stall.dates.length:logUnavailable(stall?.reason)}`,`stallingDates=${stalled?`[${stall.dates.join(',')}]`:'-'}`].join(' ');
  });
}

export function buildMarketTrends(source,options={}) {
  return buildMarketTrendsWithStalling(source,options).payload;
}

/**
 * buildMarketTrends' payload with each index's stalling days beside it ({<symbol>: stallingDays(…)}), computed
 * whether or not they are written. `emitR3MarketFields` (default EMIT_R3_MARKET_FIELDS) writes them as `stalling`.
 */
export function buildMarketTrendsWithStalling(source,{asOfDate,bookEvidence,sourceSha256,emitR3MarketFields=EMIT_R3_MARKET_FIELDS}={}) {
  if(!isDay(asOfDate))throw Error('Invalid market trend date');
  const stalling={};
  const sourceMatches=source?.schema_version==='market-trend-source-v1'&&source.market==='US'&&source.as_of_date===asOfDate;
  let refreshSchedule=null;
  if(sourceMatches&&source.refresh_schedule!==undefined){
    const schedule=source.refresh_schedule;
    if(schedule?.provider!=='pandas_market_calendars:NYSE'||typeof schedule.version!=='string'||!schedule.version||
      !Number.isFinite(Date.parse(schedule.generated_at))||schedule.generated_at.slice(0,10)<asOfDate||Date.parse(schedule.generated_at)>Date.now()||!Number.isFinite(Date.parse(schedule.valid_until))||
      Date.parse(schedule.valid_until)>Date.parse(asOfDate)+47*86400000||Date.parse(schedule.valid_until)<=Date.parse(asOfDate)||
      !Array.isArray(schedule.sessions)||!schedule.sessions.length||!schedule.sessions.some(row=>row.date===asOfDate)||
      schedule.sessions.some((row,i)=>!isDay(row?.date)||!Number.isFinite(Date.parse(row.close_at))||row.close_at.slice(0,10)!==row.date||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(row.close_at)||Date.parse(row.close_at)>=Date.parse(schedule.valid_until)||(i>0&&row.date<=schedule.sessions[i-1].date)))throw Error('Invalid independent market refresh calendar');
    refreshSchedule=schedule;
  }
  // Round-2 contract (plan §2.3): each index whose distribution count was computed carries `closes`, [{date, close}],
  // at most INDEX_CLOSES_MAX points taken from the same validated bars (indexClosesFrom). Older assets lack it, and a
  // reader treats that as 未収録: the market tab then has no S&P／Nasdaq switch (src/test/fixtures/publishedContracts.js
  // has the shape).
  const indices=['^GSPC','^IXIC'].map(symbol=>{
    const input=sourceMatches?source.indices?.find(item=>item.symbol===symbol):null;
    const lastDate=input?.bars?.at(-1)?.date;
    if(!input?.bars?.length || !isDay(lastDate)||lastDate>asOfDate||!provenance(input.provenance,'query1.finance.yahoo.com',lastDate)){
      const reason=input?.unavailable_reason||'同じ基準日の出典付き指数履歴は未取得です。';
      stalling[symbol]={available:false,method:STALLING_METHOD,reason};
      return {symbol,available:false,points:[],events:[],reason,lastObserved:null,followThrough:{available:false,method:FOLLOW_THROUGH_METHOD,reason},...(emitR3MarketFields?{stalling:stalling[symbol]}:{}),state:null};
    }
    const calculated=distributionDays({symbol,bars:input.bars,sessions:input.calendar_sessions||source.calendar?.sessions,halfDays:source.calendar?.half_days,asOfDate:lastDate});
    // Same validated bars and last date as the distribution count; a historical index keeps its own asOf.
    const followThrough=calculated.available?followThroughDay({symbol,bars:input.bars,asOfDate:lastDate,distributionEvents:calculated.events}):{available:false,method:FOLLOW_THROUGH_METHOD,reason:calculated.reason};
    // Round 3 M8d: the same bars and last date, once distributionDays has checked them against the sessions.
    stalling[symbol]=calculated.available?stallingDays({bars:input.bars,asOfDate:lastDate}):{available:false,method:STALLING_METHOD,reason:calculated.reason};
    // The last observed count always carries its own date; latest stays null for a historical index.
    const observed=calculated.points.filter(point=>Number.isSafeInteger(point.value)).at(-1);
    return {...calculated,state:calculated.available?indexState(input.bars,lastDate):null,...(calculated.available?{closes:indexClosesFrom(input.bars,lastDate)}:{}),...(lastDate<asOfDate?{available:false,historical:true,latest:null,reason:`${asOfDate}は未取得。${lastDate}までの過去記録を表示しています。`}:{}),lastObserved:observed?{date:observed.date,value:observed.value}:null,followThrough,...(emitR3MarketFields?{stalling:stalling[symbol]}:{}),source:input.source,volumeBasis:input.volume_basis,provenance:input.provenance};
  });
  const observations=sourceMatches?source.put_call?.observations:[];
  const seen=new Set();
  const putCall=Array.isArray(observations)?observations.filter(row=>isDay(row?.date)&&row.date<=asOfDate).map(row=>{
    const duplicate=seen.has(row.date);seen.add(row.date);
    const valid=!duplicate&&Number.isSafeInteger(row.calls)&&row.calls>0&&Number.isSafeInteger(row.puts)&&row.puts>=0&&provenance(row.provenance,'www.cboe.com',row.date)&&new URL(row.provenance.url).searchParams.get('dt')===row.date;
    return {date:row.date,value:valid?row.puts/row.calls:null,calls:valid?row.calls:null,puts:valid?row.puts:null,provenance:valid?row.provenance:null,reason:valid?null:row.unavailable_reason||'対象日・分子分母・取得元を確認できません。'};
  }).sort((a,b)=>a.date.localeCompare(b.date)):[];
  if(seen.size!==putCall.length)throw Error('Duplicate put/call observation');
  const validBook=bookEvidence?.as_of_date===asOfDate&&Array.isArray(bookEvidence.series);
  const breadth=validBook?bookEvidence.series.filter(row=>isDay(row.date)&&row.date<=asOfDate).map(row=>({date:row.date,above50:row.above50??null,coverage:row.coverage,universe:row.expectedUniverseSize,above50Percent:row.coverage>0&&Number.isSafeInteger(row.above50)?row.above50/row.coverage*100:null,newHighs:row.newHighs,newLows:row.newLows})):[];
  const payload={schema_version:'market-trends-v1',market:'US',as_of_date:asOfDate,source_sha256:sourceMatches?sourceSha256:null,...(refreshSchedule?{refresh_schedule:refreshSchedule}:{}),indices,put_call:{population:sourceMatches?source.put_call.population:null,points:putCall},breadth:{approximate:true,population:'現在の公開チャート集合（当時の全上場銘柄集合ではありません）',points:breadth}};
  return {payload,stalling};
}

export async function selectLongHistorySource(directory,asOfDate,evaluatedAt) {
  if(!isDay(asOfDate)||!Number.isFinite(evaluatedAt)||evaluatedAt>Date.now())throw Error('Invalid long-history evaluation instant');
  const names=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  const seeds=names.filter(name=>/^market-history-source-\d{4}-\d{2}-\d{2}\.json$/.test(name)&&name.slice(22,32)<=asOfDate).sort().reverse();
  for(const name of seeds){
    const bytes=await readFile(resolve(directory,name)),source=JSON.parse(bytes);
    const retrievedAt=typeof source?.retrieved_at==='string'?Date.parse(source.retrieved_at):NaN;
    if(!Number.isFinite(retrievedAt))throw Error('Invalid long-history source retrieval date');
    // Observation date and availability time are different. A replay may only
    // select captures already retrieved at its fixed export evaluation instant.
    if(retrievedAt>evaluatedAt)continue;
    return {bytes,history:verifyLongHistorySource(bytes,asOfDate)};
  }
  return null;
}

// Runtime captures are part of the authenticated data artifact, not compiler
// reference files. Keeping the original bytes lets ordinary release replay use
// the identical provider observations without network access or a new clock.
export async function selectRuntimeLongHistorySource(root,asOfDate,evaluatedAt) {
  if(!isDay(asOfDate)||!Number.isFinite(evaluatedAt)||evaluatedAt>Date.now())throw Error('Invalid long-history evaluation instant');
  let bytes;
  try{
    const path=resolve(root,'market-history-source.json'),stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Long-history runtime source must be a regular file');
    bytes=await readFile(path);
  }
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  const source=JSON.parse(bytes),retrievedAt=Date.parse(source?.retrieved_at);
  if(!Number.isFinite(retrievedAt))throw Error('Invalid long-history source retrieval date');
  if(retrievedAt>evaluatedAt)return null;
  return {bytes,history:verifyLongHistorySource(bytes,asOfDate)};
}

export async function exportMarketTrends({root,entry,asOfDate,bookEvidence,evaluatedAt=Date.now()}) {
  if(!isDay(asOfDate))throw Error('Invalid market trend date');
  // The source is data, not executable UI. A dated committed capture seeds an
  // ordinary carry; the daily producer's exact-date source takes precedence.
  let bytes=null;
  // Independent release replay runs the selected compiler from a fresh working
  // directory. Its committed seed must remain bound to that compiler, never to
  // an unrelated cwd/data directory. The calendar proof hashes frontend/data.
  const seed=resolve(dirname(fileURLToPath(import.meta.url)),'../data',`market-trend-source-${asOfDate}.json`);
  for(const path of [resolve(root,'market-trend-source.json'),seed]) {
    try { const candidate=await readFile(path);const source=JSON.parse(candidate);if(source.as_of_date===asOfDate){bytes=candidate;break;} }
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const source=bytes?JSON.parse(bytes):null;
  const {payload,stalling}=buildMarketTrendsWithStalling(source,{asOfDate,bookEvidence,sourceSha256:bytes?hash(bytes):null});
  await mkdir(resolve(root,'market-trends'),{recursive:true});
  // The input manifest's series is replaced below together with the source and
  // long-history capture it names. Read that binding before any write.
  const previous=entry.assets?.market_trends;
  let previousHistory=null;
  if(isGeneratedOutput('market_trends_series',previous?.path)){
    let prior;
    try{prior=await readFile(resolve(root,previous.path));}
    catch(error){if(error.code==='ENOENT')throw Error(`Input manifest references a missing market-trends series: ${previous.path}`);throw error;}
    if(`market-trends/series-${hash(prior)}.json`!==previous.path)throw Error('Input market-trends series content address mismatch');
    const priorSha=JSON.parse(prior).long_history?.source_sha256;
    if(priorSha!==undefined){if(!/^[a-f0-9]{64}$/.test(priorSha||''))throw Error('Input market-trends series names an invalid long-history source');previousHistory=`market-trends/history-source-${priorSha}.json`;}
  }
  // Retain the history's own observation date on later publications. Compiler
  // data are already covered by the independent calendar reference hash.
  const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../data');
  const runtime=await selectRuntimeLongHistorySource(root,asOfDate,evaluatedAt);
  const committed=await selectLongHistorySource(directory,asOfDate,evaluatedAt);
  const selected=runtime&&(!committed||runtime.history.as_of_date>=committed.history.as_of_date)?runtime:committed;
  if(selected){
    const {bytes:historyBytes,history}=selected;
    payload.long_history={...history,source_sha256:hash(historyBytes)};
    await writeFile(resolve(root,`market-trends/history-source-${hash(historyBytes)}.json`),historyBytes);
  }
  if(bytes)await writeFile(resolve(root,`market-trends/source-${hash(bytes)}.json`),bytes);
  const body=JSON.stringify(payload),sha256=hash(body),path=`market-trends/series-${sha256}.json`;
  await writeFile(resolve(root,path),body);
  // Round 3 M0: the index values as written above, for the CI log (log only; the payload and its bytes are unchanged).
  // Round 3 M8d: plus each index's stalling days from the same build, written to the asset or not.
  for (const line of marketIndexLogLines(payload,{stalling})) console.log(line);
  entry.assets={...entry.assets,market_trends:{path,sha256,schema_version:payload.schema_version,market:'US',as_of_date:asOfDate,source_path:bytes?`market-trends/source-${hash(bytes)}.json`:null,source_sha256:bytes?hash(bytes):null}};
  // A retained input series keeps the source and capture it names.
  if((await removeSupersededOutputs({root,references:entry,replacements:[{family:'market_trends_series',previous:previous?.path,current:path}]})).length)
    await removeSupersededOutputs({root,references:entry,replacements:[
      {family:'market_trends_source',previous:previous.source_path,current:entry.assets.market_trends.source_path},
      {family:'market_trends_history_source',previous:previousHistory,current:payload.long_history?`market-trends/history-source-${payload.long_history.source_sha256}.json`:null}]});
  return payload;
}
