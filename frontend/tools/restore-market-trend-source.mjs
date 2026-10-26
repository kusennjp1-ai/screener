// Restore a previous published input before the fresh daily collector runs.
// The receipt, immutable transport, manifest and both content hashes are checked.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, rename, unlink, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStaticTransport } from '../src/static/transport/index.mjs';
import { consumeBounded } from '../src/static/transport/codec.mjs';
import { validateReceipt } from '../../.github/scripts/publication-state.mjs';
import { buildMarketTrends } from './export-market-trends.mjs';

const BASE='https://kusennjp1-ai.github.io/screener/';
const hash=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const fail=message=>{throw Error(`Market source restore: ${message}`);};
const parse=bytes=>JSON.parse(Buffer.from(bytes).toString('utf8'));

function validateSource(source,target) {
  if(source?.schema_version!=='market-trend-source-v1'||source.market!=='US'||!day(source.as_of_date)||source.as_of_date>target||!Array.isArray(source.indices)||source.indices.length!==2||new Set(source.indices.map(index=>index.symbol)).size!==2||!source.indices.every(index=>['^GSPC','^IXIC'].includes(index.symbol)&&Array.isArray(index.bars))||!Array.isArray(source.put_call?.observations)||!Array.isArray(source.calendar?.sessions))fail('invalid or future source identity');
  if(source.calendar.sessions.some((date,i)=>!day(date)||date>source.as_of_date||(i>0&&date<=source.calendar.sessions[i-1])))fail('invalid source calendar');
  const projected=buildMarketTrends(source,{asOfDate:source.as_of_date});
  for(const index of source.indices) {
    if(index.bars.some(bar=>!day(bar?.date)||bar.date>source.as_of_date))fail('future or invalid index observation');
    const checked=projected.indices.find(item=>item.symbol===index.symbol);
    if(index.bars.length&&!checked.points.length)fail('index source validation failed');
    if(!index.bars.length&&typeof index.unavailable_reason!=='string')fail('unexplained missing index source');
  }
  if(projected.put_call.points.length!==source.put_call.observations.length)fail('invalid put/call dates');
  for(const row of source.put_call.observations){
    const checked=projected.put_call.points.find(item=>item.date===row.date);
    if(row.calls===null&&row.puts===null&&typeof row.unavailable_reason==='string')continue;
    if(!Number.isFinite(checked?.value)||checked.calls!==row.calls||checked.puts!==row.puts)fail('put/call source validation failed');
  }
  return source;
}

async function readRemote(path,fetchImpl,cap=1024*1024){
  const response=await fetchImpl(new URL(path,BASE),{cache:'no-cache',signal:AbortSignal.timeout(35000)});
  if(!response.ok)fail(`published ${path} unavailable (${response.status})`);
  return Buffer.from(await consumeBounded(response.body,cap));
}

async function committedSeed(directory,target){
  const names=(await readdir(directory)).filter(name=>/^market-trend-source-\d{4}-\d{2}-\d{2}\.json$/.test(name)&&name.slice(20,30)<=target).sort().reverse();
  if(!names.length)return null;
  const bytes=await readFile(join(directory,names[0])),source=validateSource(parse(bytes),target);
  if(source.as_of_date!==names[0].slice(20,30))fail('committed capture filename/date mismatch');
  return bytes;
}

export async function restoreMarketTrendSource({root=resolve('public/static-data'),seedDirectory=resolve('data'),fetchImpl=globalThis.fetch}={}){
  const local=parse(await readFile(join(root,'manifest.json'))),target=(local.markets?.US||local).as_of_date;
  if(!day(target))fail('invalid fresh export target date');
  const destination=join(root,'market-trend-source.json');
  let existing=null;
  try{const stat=await lstat(destination);if(!stat.isFile()||stat.isSymbolicLink())fail('destination is not a regular file');existing=await readFile(destination);validateSource(parse(existing),target);}catch(error){if(error.code!=='ENOENT')throw error;}
  const receipt=validateReceipt(parse(await readRemote('publication.json',fetchImpl,4*1024*1024)));
  const reader=receipt.transport?await createStaticTransport({baseURL:BASE,expectedRoot:receipt.transport.root,fetchImpl,signal:AbortSignal.timeout(120000)}):null;
  const read=async(path,expected)=>{
    const bytes=reader?Buffer.from(await reader.readBytes(path,{expectedDecodedSha256:expected})):await readRemote(path,fetchImpl);
    if(hash(bytes)!==expected)fail(`published hash mismatch: ${path}`);
    return bytes;
  };
  let selected,origin;
  try{
    const manifest=parse(await read('static-data/manifest.json',receipt.data_manifest_sha256)),entry=manifest.markets?.US||manifest;
    if(!day(entry.as_of_date)||entry.as_of_date>target)fail('published source is later than the fresh export; refusing rollback');
    const ref=entry.assets?.market_trends;
    if(ref===undefined){
      // Only a successfully verified pre-feature manifest can take this path.
      // HTTP, hash, malformed-reference and transport errors never fall back.
      selected=await committedSeed(seedDirectory,target);origin='committed_pre_feature_seed';
    }else{
      if(ref?.schema_version!=='market-trends-v1'||ref.market!=='US'||ref.as_of_date!==entry.as_of_date||!hex(ref.sha256)||ref.path!==`market-trends/series-${ref.sha256}.json`||!hex(ref.source_sha256)||ref.source_path!==`market-trends/source-${ref.source_sha256}.json`)fail('invalid or missing published source reference');
      const series=parse(await read(`static-data/${ref.path}`,ref.sha256));
      if(series.schema_version!=='market-trends-v1'||series.market!=='US'||series.as_of_date!==entry.as_of_date||series.source_sha256!==ref.source_sha256)fail('derived/source identity mismatch');
      selected=await read(`static-data/${ref.source_path}`,ref.source_sha256);
      const source=validateSource(parse(selected),target);
      if(source.as_of_date!==entry.as_of_date)fail('source/manifest date mismatch');
      origin='verified_publication';
    }
  }finally{reader?.dispose();}
  if(!selected)return {restored:false,reason:'No verified prior feature source or eligible committed capture'};
  if(existing&&parse(existing).as_of_date>=parse(selected).as_of_date)return {restored:false,reason:'Existing validated source is at least as recent; preserved unchanged',as_of_date:parse(existing).as_of_date};
  const temporary=join(root,`.market-trend-restore-${randomUUID()}.tmp`);
  try{await writeFile(temporary,selected,{flag:'wx'});await rename(temporary,destination);}finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {restored:true,origin,as_of_date:parse(selected).as_of_date,sha256:hash(selected),publication_ui:receipt.ui_sha};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await restoreMarketTrendSource()));
