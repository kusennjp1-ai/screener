// Recover the last verified long-history capture before a daily refresh. A
// failed acquisition never turns old observations into a newer session.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createStaticTransport } from '../src/static/transport/index.mjs';
import { consumeBounded } from '../src/static/transport/codec.mjs';
import { validateReceipt } from '../../.github/scripts/publication-state.mjs';
import { selectLongHistorySource, verifyLongHistorySource } from './export-market-trends.mjs';

const BASE='https://kusennjp1-ai.github.io/screener/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const parse=bytes=>JSON.parse(Buffer.from(bytes).toString('utf8'));
const fail=message=>{throw Error(`Long-history restore: ${message}`);};

export async function restoreMarketHistorySource({root=resolve('public/static-data'),seedDirectory=resolve(dirname(fileURLToPath(import.meta.url)),'../data'),fetchImpl=globalThis.fetch}={}) {
  const local=parse(await readFile(join(root,'manifest.json'))),target=(local.markets?.US||local).as_of_date;
  const destination=join(root,'market-history-source.json');
  let existing=null;
  try{
    const stat=await lstat(destination);
    if(!stat.isFile()||stat.isSymbolicLink())fail('destination is not a regular file');
    existing=await readFile(destination);verifyLongHistorySource(existing,target);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const remote=async(path,cap=8*1024*1024)=>{
    const response=await fetchImpl(new URL(path,BASE),{cache:'no-cache',signal:AbortSignal.timeout(35000)});
    if(!response.ok)fail(`published ${path} unavailable (${response.status})`);
    return Buffer.from(await consumeBounded(response.body,cap));
  };
  const receipt=validateReceipt(parse(await remote('publication.json')));
  const reader=receipt.transport?await createStaticTransport({baseURL:BASE,expectedRoot:receipt.transport.root,fetchImpl,signal:AbortSignal.timeout(120000)}):null;
  const read=async(path,expected)=>{
    const bytes=reader?Buffer.from(await reader.readBytes(path,{expectedDecodedSha256:expected})):await remote(path);
    if(hash(bytes)!==expected)fail(`published hash mismatch: ${path}`);
    return bytes;
  };
  let selected,origin;
  try{
    const manifest=parse(await read('static-data/manifest.json',receipt.data_manifest_sha256)),entry=manifest.markets?.US||manifest;
    if(typeof entry.as_of_date!=='string'||entry.as_of_date>target)fail('published source is newer than the fresh export; refusing rollback');
    const ref=entry.assets?.market_trends;
    if(ref!==undefined){
      if(ref?.schema_version!=='market-trends-v1'||ref.market!=='US'||ref.as_of_date!==entry.as_of_date||!hex(ref.sha256)||ref.path!==`market-trends/series-${ref.sha256}.json`)fail('invalid published market-trends reference');
      const series=parse(await read(`static-data/${ref.path}`,ref.sha256));
      if(series.schema_version!=='market-trends-v1'||series.market!=='US'||series.as_of_date!==entry.as_of_date)fail('derived identity mismatch');
      if(series.long_history!==undefined){
        const expected=series.long_history.source_sha256;
        if(!hex(expected))fail('missing source digest');
        selected=await read(`static-data/market-trends/history-source-${expected}.json`,expected);
        const history=verifyLongHistorySource(selected,target);
        if(!isDeepStrictEqual({...history,source_sha256:expected},series.long_history))fail('source projection mismatch');
        origin='verified_publication';
      }
    }
    // Only a verified publication without this feature may use a seed. HTTP,
    // digest, source validation and transport failures never silently fall back.
    if(!selected){selected=(await selectLongHistorySource(seedDirectory,target,Date.now()))?.bytes;origin='committed_pre_feature_seed';}
  }finally{reader?.dispose();}
  if(!selected)return {restored:false,reason:'No eligible verified long-history source'};
  if(existing&&parse(existing).as_of_date>=parse(selected).as_of_date)return {restored:false,as_of_date:parse(existing).as_of_date,reason:'Existing validated capture is at least as recent'};
  const temporary=join(root,`.market-history-restore-${randomUUID()}.tmp`);
  try{await writeFile(temporary,selected,{flag:'wx'});await rename(temporary,destination);}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {restored:true,origin,as_of_date:parse(selected).as_of_date,sha256:hash(selected),publication_ui:receipt.ui_sha};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await restoreMarketHistorySource()));
