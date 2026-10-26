import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { distributionDays } from '../src/static/distributionDays.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const isDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const provenance=(value,host,date)=>{try{return Boolean(value&&typeof value.url==='string'&&new URL(value.url).protocol==='https:'&&new URL(value.url).hostname===host&&/^[a-f0-9]{64}$/.test(value.sha256||'')&&Number.isFinite(Date.parse(value.retrieved_at))&&value.retrieved_at.slice(0,10)>=date&&Date.parse(value.retrieved_at)<=Date.now());}catch{return false;}};

export function buildMarketTrends(source,{asOfDate,bookEvidence,sourceSha256}={}) {
  if(!isDay(asOfDate))throw Error('Invalid market trend date');
  const sourceMatches=source?.schema_version==='market-trend-source-v1'&&source.market==='US'&&source.as_of_date===asOfDate;
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
  return {schema_version:'market-trends-v1',market:'US',as_of_date:asOfDate,source_sha256:sourceMatches?sourceSha256:null,indices,put_call:{population:sourceMatches?source.put_call.population:null,points:putCall},breadth:{approximate:true,population:'現在の公開チャート集合（当時の全上場銘柄集合ではありません）',points:breadth}};
}

export async function exportMarketTrends({root,entry,asOfDate,bookEvidence}) {
  // The source is data, not executable UI. A dated committed capture seeds an
  // ordinary carry; the daily producer's exact-date source takes precedence.
  let bytes=null;
  for(const path of [resolve(root,'market-trend-source.json'),resolve('data',`market-trend-source-${asOfDate}.json`)]) {
    try { const candidate=await readFile(path);const source=JSON.parse(candidate);if(source.as_of_date===asOfDate){bytes=candidate;break;} }
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const source=bytes?JSON.parse(bytes):null;
  const payload=buildMarketTrends(source,{asOfDate,bookEvidence,sourceSha256:bytes?hash(bytes):null});
  await mkdir(resolve(root,'market-trends'),{recursive:true});
  if(bytes)await writeFile(resolve(root,`market-trends/source-${hash(bytes)}.json`),bytes);
  const body=JSON.stringify(payload),sha256=hash(body),path=`market-trends/series-${sha256}.json`;
  await writeFile(resolve(root,path),body);
  entry.assets={...entry.assets,market_trends:{path,sha256,schema_version:payload.schema_version,market:'US',as_of_date:asOfDate,source_path:bytes?`market-trends/source-${hash(bytes)}.json`:null,source_sha256:bytes?hash(bytes):null}};
  return payload;
}
