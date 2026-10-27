import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distributionDays } from '../src/static/distributionDays.js';
import { validateLongHistory } from '../src/static/marketLongHistory.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const isDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const provenance=(value,host,date)=>{try{return Boolean(value&&typeof value.url==='string'&&new URL(value.url).protocol==='https:'&&new URL(value.url).hostname===host&&/^[a-f0-9]{64}$/.test(value.sha256||'')&&Number.isFinite(Date.parse(value.retrieved_at))&&value.retrieved_at.slice(0,10)>=date&&Date.parse(value.retrieved_at)<=Date.now());}catch{return false;}};
export function verifyLongHistorySource(bytes,asOfDate){
 const history=validateLongHistory(JSON.parse(bytes),asOfDate);
 if(hash(JSON.stringify(history.universe.symbols))!==history.universe.sha256)throw Error('Long-history universe hash mismatch');
 if(history.classification&&hash(JSON.stringify(history.classification.memberships))!==history.classification.memberships_sha256)throw Error('Long-history classification hash mismatch');
 return history;
}

export function buildMarketTrends(source,{asOfDate,bookEvidence,sourceSha256}={}) {
  if(!isDay(asOfDate))throw Error('Invalid market trend date');
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
  const indices=['^GSPC','^IXIC'].map(symbol=>{
    const input=sourceMatches?source.indices?.find(item=>item.symbol===symbol):null;
    const lastDate=input?.bars?.at(-1)?.date;
    if(!input?.bars?.length || !isDay(lastDate)||lastDate>asOfDate||!provenance(input.provenance,'query1.finance.yahoo.com',lastDate))return {symbol,available:false,points:[],events:[],reason:input?.unavailable_reason||'同じ基準日の出典付き指数履歴は未取得です。'};
    const calculated=distributionDays({symbol,bars:input.bars,sessions:input.calendar_sessions||source.calendar?.sessions,halfDays:source.calendar?.half_days,asOfDate:lastDate});
    return {...calculated,...(lastDate<asOfDate?{available:false,historical:true,latest:null,reason:`${asOfDate}は未取得。${lastDate}までの過去記録を表示しています。`}:{}),source:input.source,volumeBasis:input.volume_basis,provenance:input.provenance};
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
  return {schema_version:'market-trends-v1',market:'US',as_of_date:asOfDate,source_sha256:sourceMatches?sourceSha256:null,...(refreshSchedule?{refresh_schedule:refreshSchedule}:{}),indices,put_call:{population:sourceMatches?source.put_call.population:null,points:putCall},breadth:{approximate:true,population:'現在の公開チャート集合（当時の全上場銘柄集合ではありません）',points:breadth}};
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
  const payload=buildMarketTrends(source,{asOfDate,bookEvidence,sourceSha256:bytes?hash(bytes):null});
  await mkdir(resolve(root,'market-trends'),{recursive:true});
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
  entry.assets={...entry.assets,market_trends:{path,sha256,schema_version:payload.schema_version,market:'US',as_of_date:asOfDate,source_path:bytes?`market-trends/source-${hash(bytes)}.json`:null,source_sha256:bytes?hash(bytes):null}};
  return payload;
}
