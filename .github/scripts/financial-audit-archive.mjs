// Public, durable archive of older financial audit carry projections.
// Controller-only: nothing here imports or executes the approved UI tree
// (release/), runs npm, or uses a permissive Node gunzip. Archived bytes are
// content addressed by their LOGICAL sha256; an encoded (gzip) copy is accepted
// only after the canonical transport decoder reproduces exactly those bytes.
import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ARCHIVE_POLICY,ARCHIVE_SCHEMA,ARCHIVE_TAG_PREFIX,RESERVED_RELEASE_PREFIX,FINANCIAL_AUDIT_MAX_FILE_BYTES,FINANCIAL_AUDIT_METADATA_BYTES,PUBLICATION_METADATA_BYTES,
  archiveDigest,archiveLocation,canonicalJson,isArchivableAuditPath,parsePublicationReceipt,validateFinancialAuditArchive,validateFinancialAuditFiles,verifyFinancialAuditFile} from './financial-audit-history.mjs';
import {AUDIT_TRANSPORT_PREFIX,auditInternalPath} from './financial-audit-transport.mjs';
import {validateReceipt} from './publication-state.mjs';
import {githubApi} from './publication-gate.mjs';
import {ordinaryCarrySelected} from './ordinary-carry-tooling.mjs';
import bootstrap from './approved-ui-bootstrap.json' with {type:'json'};
import {createStaticTransport} from '../../frontend/src/static/transport/index.mjs';
import {decodeBytes,fetchPinned} from '../../frontend/src/static/transport/codec.mjs';

export const ADMISSION_SCHEMA='financial-audit-archive-admission-v1';
export const PLAN_SCHEMA='financial-audit-archive-plan-v1';
export const RENEWAL_REQUEST_PATH='.github/financial-source-renewal-request.json';
// Gaps an independent closure check may report for publications made before
// the archive existed. Empty: any gap fails the sweep until an owner reviews it.
export const LEGACY_CLOSURE_GAPS=Object.freeze([]);
// Room left in publication.json for the rest of one publication's changes.
const PUBLICATION_MARGIN_BYTES=64*1024;
const MAX_FALLBACK_TAG_READS=50,MAX_RELEASE_PAGES=200,PROBE_CONCURRENCY=8;
const receiptPattern=/^static-data\/financial-corrections\/release-([a-f0-9]{64})\.json$/;
const renewalPattern=/^static-data\/financial-corrections\/renewal-[a-f0-9]{64}\.json$/;
const contentPattern=/^static-data\/financial-corrections\/[a-z-]+-([a-f0-9]{64})\.json$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sortedObject=value=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0));
const isoTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
const defaultSleep=ms=>new Promise(done=>setTimeout(done,ms));
const warning=message=>console.log(`::warning::${message}`);

export class ArchiveHttpError extends Error{constructor(message,status){super(message);this.status=status;}}
export class ArchiveConflict extends Error{}

function allowedDownload(url){
  if(url.protocol!=='https:'||url.username||url.password||url.port||!ARCHIVE_POLICY.download_hosts.includes(url.hostname))throw Error(`Archived asset URL is outside the allowed public download hosts: ${url.host}`);
}
async function cancel(response){try{await response.body?.cancel();}catch{/* already closed */}}
async function readCapped(response,cap){
  const chunks=[];let size=0;
  if(!response.body){const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>cap)throw Error('Archived asset exceeds its expected size');return bytes;}
  const reader=response.body.getReader();
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>cap){await reader.cancel().catch(()=>{});throw Error('Archived asset exceeds its expected size');}chunks.push(Buffer.from(value));}
  }finally{reader.releaseLock();}
  return Buffer.concat(chunks,size);
}

// Anonymous download from the allowed public hosts. Never sends credentials,
// follows at most three https redirects, and never accepts a transfer encoding.
export async function fetchArchivedAsset(url,{fetcher=fetch,expectedBytes,mode='full',cap}={}){
  const limit=cap??expectedBytes;
  if(!['full','probe'].includes(mode)||!Number.isSafeInteger(limit)||limit<1||limit>FINANCIAL_AUDIT_MAX_FILE_BYTES
    ||(mode==='probe'||cap===undefined)&&(!Number.isSafeInteger(expectedBytes)||expectedBytes<2))throw Error('Invalid archived asset request bounds');
  let current=new URL(url);
  for(let hop=0;;hop++){
    allowedDownload(current);
    const headers={'Accept':'application/octet-stream','Accept-Encoding':'identity',...(mode==='probe'?{Range:'bytes=0-1'}:{})};
    const response=await fetcher(current.href,{method:'GET',redirect:'manual',cache:'no-store',headers});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');await cancel(response);
      if(hop>=3)throw Error('Archived asset redirected more than three times');
      if(!location)throw Error('Archived asset redirect has no location');
      current=new URL(location,current);continue;
    }
    const encoding=(response.headers.get('content-encoding')||'identity').toLowerCase();
    if(encoding!=='identity'){await cancel(response);throw Error('Archived asset was served with a transfer encoding');}
    if(response.status===404){await cancel(response);throw new ArchiveHttpError('Archived asset is not publicly available',404);}
    const length=response.headers.get('content-length');
    if(mode==='probe'){
      let total=null;
      if(response.status===206){const range=/^bytes 0-1\/(\d+)$/.exec(response.headers.get('content-range')||'');total=range?Number(range[1]):null;}
      else if(response.status===200)total=length===null?null:Number(length);
      if(total!==expectedBytes){await cancel(response);throw new ArchiveHttpError(`Archived asset probe size mismatch (HTTP ${response.status})`,response.status);}
      const reader=response.body.getReader();let head=Buffer.alloc(0);
      try{while(head.length<2){const {done,value}=await reader.read();if(done)break;head=Buffer.concat([head,Buffer.from(value)]);if(response.status===206&&head.length>2)throw Error('Archived asset probe returned extra bytes');}}
      finally{await reader.cancel().catch(()=>{});}
      if(head.length<2||head[0]!==0x1f||head[1]!==0x8b)throw Error('Archived asset probe is not gzip');
      return {status:response.status,bytes:expectedBytes};
    }
    if(response.status!==200){await cancel(response);throw new ArchiveHttpError(`Archived asset download failed: HTTP ${response.status}`,response.status);}
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit||cap===undefined&&Number(length)!==expectedBytes)){await cancel(response);throw Error('Archived asset length mismatch');}
    const bytes=await readCapped(response,limit);
    if(cap===undefined&&bytes.length!==expectedBytes)throw Error('Archived asset length mismatch');
    return bytes;
  }
}

// Exact encoded identity first, then the canonical one-member gzip decoder must
// reproduce the logical length and sha256 named by the content address.
export async function verifyArchivedBytes(bytes,{sha256,bytes:decodedBytes,encoding}){
  if(!encoding||encoding.kind!=='gzip'||!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))throw Error('Invalid archived encoding');
  if(bytes.length!==encoding.bytes||sha(bytes)!==encoding.sha256)throw Error('Archived encoded bytes differ from their recorded digest');
  if(!Number.isSafeInteger(decodedBytes)||decodedBytes<1||decodedBytes>FINANCIAL_AUDIT_MAX_FILE_BYTES)throw Error('Archived decoded size is out of bounds');
  const view=new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.length);
  await decodeBytes(view,{kind:'gzip',decodedBytes,decodedSha256:sha256});
  return true;
}
export const selfEncoding=bytes=>({kind:'gzip',sha256:sha(bytes),bytes:bytes.length});

function notFound(error){return /\bHTTP 404\b|Not Found/i.test(`${error?.stderr??''}\n${error?.message??''}`);}
// One paginated pass; a bounded per-tag fallback covers listing omissions.
export function listArchiveReleases(api=githubApi,{required=[],repository=bootstrap.repository}={}){
  const map=new Map();let pages=0;
  for(let page=1;;page++){
    if(++pages>MAX_RELEASE_PAGES)throw Error('Release listing exceeds its bounded page count');
    const items=api(`repos/${repository}/releases?per_page=100&page=${page}`);
    if(!Array.isArray(items))throw Error('Invalid release listing page');
    for(const release of items)if(typeof release?.tag_name==='string'&&release.tag_name.startsWith(ARCHIVE_TAG_PREFIX)&&release.draft===false){
      if(map.has(release.tag_name))throw Error(`Ambiguous published archive release ${release.tag_name}`);
      map.set(release.tag_name,release);
    }
    if(items.length<100)break;
  }
  const missing=[...new Set(required)].filter(tag=>!map.has(tag));
  if(missing.length>MAX_FALLBACK_TAG_READS)throw Error(`Release listing omits ${missing.length} archive releases`);
  for(const tag of missing){const release=releaseByTag(api,tag,{repository});if(release)map.set(tag,release);}
  return map;
}
export function releaseByTag(api,tag,{repository=bootstrap.repository}={}){
  if(!tag.startsWith(ARCHIVE_TAG_PREFIX))throw Error('Fallback read is limited to archive release tags');
  try{const release=api(`repos/${repository}/releases/tags/${tag}`);return release?.tag_name===tag&&release.draft===false?release:null;}
  catch(error){if(!notFound(error))throw error;return null;}
}

export function assertReleaseMetadata(release,{path,encoding=null}){
  const location=archiveLocation(path);
  if(!release||release.tag_name!==location.tag||release.draft!==false)throw Error(`Archive release is missing or still a draft: ${location.tag}`);
  const assets=release.assets;
  if(!Array.isArray(assets)||assets.length!==1)throw Error(`Archive release must hold exactly one asset: ${location.tag}`);
  const asset=assets[0];
  if(asset?.name!==location.asset||asset.state!=='uploaded'||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>FINANCIAL_AUDIT_MAX_FILE_BYTES
    ||asset.browser_download_url!==undefined&&asset.browser_download_url!==location.url)throw Error(`Archive asset is incomplete or misnamed: ${location.tag}`);
  if(encoding&&asset.size!==encoding.bytes)throw Error(`Archive asset size changed: ${location.tag}`);
  if(asset.digest===null||asset.digest===undefined)return {needsFull:true,size:asset.size,digest:null,asset,location};
  if(typeof asset.digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(asset.digest))throw Error(`Archive asset digest is malformed: ${location.tag}`);
  if(encoding&&asset.digest!==`sha256:${encoding.sha256}`)throw Error(`Archive asset digest changed: ${location.tag}`);
  return {needsFull:false,size:asset.size,digest:asset.digest.slice(7),asset,location};
}

// One nested audit transport per live publication, pinned by its receipt.
export async function openNestedAudit({publication,fetcher=fetch,siteUrl=bootstrap.site_url}){
  if(!publication?.financial_audit_transport)throw Error('Live publication has no nested financial audit transport');
  const baseURL=new URL(AUDIT_TRANSPORT_PREFIX,siteUrl).href;
  const transport=await createStaticTransport({baseURL,expectedRoot:publication.financial_audit_transport.root,fetchImpl:fetcher});
  return {
    async entry(path,sha256){
      const entry=await transport.lookup(auditInternalPath(path,sha256));
      if(!entry||entry.kind!=='gzip'||entry.decodedSha256!==sha256)throw Error(`Live nested audit entry is missing or not gzip: ${path}`);
      // Encoded fields are informational: archive identity is the logical hash.
      return {decodedBytes:entry.decodedBytes,assetPath:entry.assetPath,encodedBytes:entry.encodedBytes,encodedSha256:entry.encodedSha256};
    },
    async readEncoded(entry){
      const bytes=await fetchPinned({baseURL:new URL(baseURL),descriptor:{path:entry.assetPath,bytes:entry.encodedBytes,sha256:entry.encodedSha256},cap:FINANCIAL_AUDIT_MAX_FILE_BYTES,fetchImpl:fetcher});
      return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.length);
    },
    dispose:()=>transport.dispose(),
  };
}
export async function liveNestedEntry({publication,path,sha256,fetcher=fetch}){
  const nested=await openNestedAudit({publication,fetcher});
  try{return await nested.entry(path,sha256);}finally{nested.dispose();}
}

const hostedRenewal=files=>Object.keys(files||{}).some(path=>renewalPattern.test(path));
const identityPattern=/^([1-9]\d*)\/([1-9]\d*)\/([a-f0-9]{64})\/([a-f0-9]{64})$/;
// A committed renewal request can only be admitted while the live publication
// is its exact predecessor (verifyRenewalPredecessor). Archiving pauses while
// the request names this publication (by identity, receipt hash or run and
// attempt); a request naming an earlier, superseded publication can never be
// admitted again and does not pause it. An unreadable request pauses.
export function renewalRequestHold({root=process.cwd(),identity=null,receiptSha256=null,runId=null,runAttempt=null}={}){
  let bytes;
  try{bytes=readFileSync(join(root,RENEWAL_REQUEST_PATH));}
  catch(error){return error?.code==='ENOENT'?null:'an unreadable renewal request is committed';}
  let named=null;
  try{named=identityPattern.exec(JSON.parse(bytes.toString('utf8'))?.previous_publication_identity);}catch{named=null;}
  if(!named)return 'an unreadable renewal request is committed';
  const live=typeof identity==='string'?identityPattern.exec(identity):null;
  const receipt=receiptSha256??live?.[3]??null,run=runId??live?.[1]??null,attempt=runAttempt??live?.[2]??null;
  if(!receipt&&(run===null||attempt===null))return 'a renewal request is committed and the live publication is unidentified';
  if(named[0]===identity||named[3]===receipt||run!==null&&attempt!==null&&named[1]===String(run)&&named[2]===String(attempt))return 'a renewal request names the live publication';
  return null;
}
// Only a plain carry may remove files. Every other route keeps today's behaviour.
export function pruneMode(state,{root=process.cwd()}={}){
  return Boolean(ARCHIVE_POLICY.pruning_enabled&&state?.carry&&!state.limited&&!state.activation&&!state.renewal&&!state.correction
    &&!state.source?.repair&&!state.publisherTooling&&!ordinaryCarrySelected(state)
    &&state.live?.financialRelease&&!state.live.financialRelease.renewal&&!hostedRenewal(state.live.receipt?.financial_audit_files)
    &&renewalRequestHold({root,identity:state.live.identity??null})===null);
}

export function selectArchiveCandidates(live){
  const hosted=live?.receipt?.financial_audit_files;if(!hosted)return [];
  const indexed=live.receipt.financial_audit_archive?.files??{};
  const sources=new Set([live.financialRelease?.source_projection?.path,live.financialRelease?.source_base?.path]);
  return Object.entries(hosted).filter(([path])=>isArchivableAuditPath(path)&&!Object.hasOwn(indexed,path)&&!sources.has(path))
    .sort(([a],[b])=>a<b?-1:1).slice(0,ARCHIVE_POLICY.max_new_entries_per_publication).map(([path,sha256])=>({path,sha256}));
}

async function pool(items,limit,work){
  let next=0;const runners=Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const item=items[next++];await work(item);}});
  await Promise.all(runners);
}
export function rotatingPaths(paths,count,seed){
  const sorted=[...paths].sort(),n=sorted.length,base=Number.isSafeInteger(Number(seed))?Number(seed):0;
  return n?[...new Set(Array.from({length:Math.min(count,n)},(_,k)=>sorted[((base+k)%n+n)%n]))]:[];
}
// Already indexed entries fail closed: metadata for every entry, an anonymous
// probe unless covered, and a full decode for missing digests or rotation.
async function verifyIndexedEntries(files,{listing,fetcher,probeAll=true,fullPaths=[]}){
  const entries=Object.entries(files).sort(([a],[b])=>a<b?-1:1),full=new Set(fullPaths);
  for(const [path,entry]of entries){
    const meta=assertReleaseMetadata(listing.get(archiveLocation(path).tag),{path,encoding:entry.encoding});
    if(meta.needsFull)full.add(path);
  }
  const verified={probe:[],full:[]};
  if(probeAll)await pool(entries.filter(([path])=>!full.has(path)),PROBE_CONCURRENCY,async([path,entry])=>{
    await fetchArchivedAsset(entry.url,{fetcher,expectedBytes:entry.encoding.bytes,mode:'probe'});verified.probe.push(path);
  });
  for(const path of [...full].sort()){
    const entry=files[path];if(!entry)throw Error(`Unknown archived path requested for verification: ${path}`);
    await verifyArchivedBytes(await fetchArchivedAsset(entry.url,{fetcher,expectedBytes:entry.encoding.bytes}),entry);verified.full.push(path);
  }
  verified.probe.sort();return verified;
}

export async function verifyArchiveAvailability(index,{api=githubApi,fetcher=fetch,probeAll=true,fullPaths=[],rotating=0,seed=process.env.GITHUB_RUN_ID}={}){
  if(index===null||index===undefined)return {probe:[],full:[]};
  const files=index.files,paths=Object.keys(files);
  const listing=listArchiveReleases(api,{required:paths.map(path=>archiveLocation(path).tag)});
  return verifyIndexedEntries(files,{listing,fetcher,probeAll,fullPaths:[...fullPaths,...rotatingPaths(paths,rotating,seed)]});
}

function projectedEntry(path,candidate){
  return {kind:'carry-projection',sha256:candidate.sha256,bytes:candidate.bytes??FINANCIAL_AUDIT_MAX_FILE_BYTES,financial_generation:'0'.repeat(64),
    receipts:[`static-data/financial-corrections/release-${'0'.repeat(64)}.json`,`static-data/financial-corrections/release-${'1'.repeat(64)}.json`],
    encoding:{kind:'gzip',sha256:'0'.repeat(64),bytes:FINANCIAL_AUDIT_MAX_FILE_BYTES},url:archiveLocation(path).url,archived_at:'2000-01-01T00:00:00.000Z',verified_at:'2000-01-01T00:00:00.000Z',
    removed_by:{run_id:Number.MAX_SAFE_INTEGER,run_attempt:Number.MAX_SAFE_INTEGER,previous_publication_identity:`${Number.MAX_SAFE_INTEGER}/${Number.MAX_SAFE_INTEGER}/${'0'.repeat(64)}/${'0'.repeat(64)}`}};
}

// Runs before the approved UI tree is checked out. Uses the plan's
// authenticated live publication; never re-reads or re-authenticates it.
export async function admitAuditArchive({state,api=githubApi,fetcher=fetch,now=()=>new Date().toISOString(),seed=process.env.GITHUB_RUN_ID,root=process.cwd(),warn=warning}){
  const live=state.live,prior=live.receipt?.financial_audit_archive??null;
  if(prior)validateFinancialAuditArchive(prior,live.receipt);
  const mode=pruneMode(state,{root})?'prune':'verify';
  const record={schema_version:ADMISSION_SCHEMA,live_identity:live.identity,prior_sha256:archiveDigest(prior),mode,verified:{probe:[],full:[]},drops:{},verified_at:null};
  if(!prior&&mode==='verify'){record.verified_at=now();return record;}
  const hosted=live.receipt.financial_audit_files,candidates=mode==='prune'?selectArchiveCandidates(live):[];
  const priorPaths=Object.keys(prior?.files??{});
  let listing;
  // Indexed entries fail closed. Without an index, an unavailable listing only
  // means no carry can leave Pages in this run.
  try{listing=listArchiveReleases(api,{required:priorPaths.map(path=>archiveLocation(path).tag)});}
  catch(error){if(prior)throw error;warn(`Keeping every carry on Pages: the archive release listing is unavailable (${error.message})`);record.verified_at=now();return record;}
  let fallbacks=Math.max(0,MAX_FALLBACK_TAG_READS-priorPaths.filter(path=>!listing.has(archiveLocation(path).tag)).length);
  if(prior){
    // Already archived copies that are hosted again leave Pages only after a
    // full same-run download, like any other removal.
    const overlap=mode==='prune'?priorPaths.filter(path=>Object.hasOwn(hosted,path)):[];
    record.verified=await verifyIndexedEntries(prior.files,{listing,fetcher,probeAll:true,
      fullPaths:[...overlap,...rotatingPaths(priorPaths,ARCHIVE_POLICY.rotating_full_verifications,seed)]});
  }
  if(candidates.length){
    const liveBytes=Buffer.byteLength(live.receiptBytes??JSON.stringify(live.receipt));
    const projected={schema_version:ARCHIVE_SCHEMA,repository:bootstrap.repository,files:{...(prior?.files??{})}};
    const hostedEntry=`,"static-data/financial-corrections/release-${'0'.repeat(64)}.json":"${'0'.repeat(64)}"`.length;
    const priorIndexBytes=prior?Buffer.byteLength(JSON.stringify(prior)):0;
    let nested=null;
    try{
      for(const candidate of candidates){
        const location=archiveLocation(candidate.path);
        try{
          if(hosted[candidate.path]!==candidate.sha256||location.sha256!==candidate.sha256)throw Error('candidate is not hosted under its content address');
          const next={...projected,files:{...projected.files,[candidate.path]:projectedEntry(candidate.path,candidate)}};
          const indexBytes=Buffer.byteLength(JSON.stringify(next));
          // The new receipt replaces the live index and adds one receipt and one carry entry.
          if(indexBytes>FINANCIAL_AUDIT_METADATA_BYTES||liveBytes-priorIndexBytes+indexBytes+2*hostedEntry+PUBLICATION_MARGIN_BYTES>PUBLICATION_METADATA_BYTES){
            warn(`Financial audit archive index cap reached; ${candidate.path} and later carries stay hosted`);break;
          }
          let release=listing.get(location.tag);
          if(!release){if(fallbacks<=0)throw Error('release listing omitted it');fallbacks--;release=releaseByTag(api,location.tag);if(!release)throw Error('no published archive release');listing.set(location.tag,release);}
          const meta=assertReleaseMetadata(release,{path:candidate.path});
          nested??=await openNestedAudit({publication:live.receipt,fetcher});
          const entry=await nested.entry(candidate.path,candidate.sha256);
          const bytes=await fetchArchivedAsset(location.url,{fetcher,expectedBytes:meta.size});
          if(meta.digest!==null&&sha(bytes)!==meta.digest)throw Error('downloaded bytes differ from the release asset digest');
          const encoding=selfEncoding(bytes);
          await verifyArchivedBytes(bytes,{sha256:candidate.sha256,bytes:entry.decodedBytes,encoding});
          if(!isoTime(release.published_at))throw Error('archive release has no publication time');
          record.drops[candidate.path]={sha256:candidate.sha256,bytes:entry.decodedBytes,encoding,url:location.url,archived_at:release.published_at,verified_at:now()};
          projected.files[candidate.path]=projectedEntry(candidate.path,{sha256:candidate.sha256,bytes:entry.decodedBytes});
        }catch(error){warn(`Keeping ${candidate.path} on Pages: its public archive copy is not verified (${error.message})`);}
      }
    }finally{nested?.dispose();}
  }
  record.drops=sortedObject(record.drops);record.verified_at=now();
  return record;
}

export const admissionCovers=(state,live)=>state?.auditArchive?.schema_version===ADMISSION_SCHEMA&&state.auditArchive.live_identity===live.identity
  &&state.auditArchive.prior_sha256===archiveDigest(live.receipt?.financial_audit_archive??null);

function hostedReceipts(root,hosted){
  return Object.entries(hosted).filter(([path])=>receiptPattern.test(path)).map(([path,hash])=>{verifyFinancialAuditFile(root,path,hash);return [path,JSON.parse(readFileSync(join(root,path),'utf8'))];});
}
function referencingReceipts(receipts,path,sha256){
  const refs=receipts.filter(([,receipt])=>receipt?.evaluation_projection?.path===path&&receipt.evaluation_projection.sha256===sha256);
  return {receipts:refs.map(([name])=>name).sort(),generations:[...new Set(refs.map(([,receipt])=>receipt.financial_generation))]};
}
// Offline, inside restoreCarrySources: binds every verified drop to the hosted
// receipts that reference it. Anything unbound stays hosted.
export function finalizeDrops(state,root,{warn=warning,cwd=process.cwd()}={}){
  const record=state.auditArchive;
  if(!record)return [];
  if(record.mode!=='prune'||record.live_identity!==state.live.identity||!pruneMode(state,{root:cwd})){record.drops={};record.removal=[];return [];}
  // An unindexed activation predecessor has no hosted map and nothing to omit.
  if(!Object.keys(record.drops||{}).length&&!state.live.receipt?.financial_audit_archive){record.drops={};record.removal=[];return [];}
  const hosted=validateFinancialAuditFiles(state.live.receipt.financial_audit_files),receipts=hostedReceipts(root,hosted),drops={};
  for(const [path,drop]of Object.entries(record.drops).sort(([a],[b])=>a<b?-1:1)){
    try{
      if(hosted[path]!==drop.sha256)throw Error('not hosted by the predecessor');
      verifyFinancialAuditFile(root,path,drop.sha256);
      const bound=referencingReceipts(receipts,path,drop.sha256);
      if(!bound.receipts.length)throw Error('no hosted receipt references it');
      if(bound.generations.length!==1||!/^[a-f0-9]{64}$/.test(bound.generations[0]||''))throw Error('referencing receipts disagree on its generation');
      drops[path]={...drop,receipts:bound.receipts,financial_generation:bound.generations[0]};
    }catch(error){warn(`Keeping ${path} on Pages: ${error.message}`);}
  }
  const prior=state.live.receipt.financial_audit_archive?.files??{},full=new Set(record.verified?.full??[]);
  const overlap=Object.keys(prior).filter(path=>Object.hasOwn(hosted,path)&&full.has(path));
  record.drops=drops;record.removal=[...new Set([...Object.keys(drops),...overlap])].sort();
  return record.removal;
}

export function applyArchivedDrops(root,paths){
  for(const path of paths){
    const hash=contentPattern.exec(path)?.[1];if(!hash||!isArchivableAuditPath(path))throw Error('Only archived carry projections can be omitted');
    const full=join(root,path);
    let present=false;try{lstatSync(full);present=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(present){verifyFinancialAuditFile(root,path,hash);rmSync(full);}
  }
  for(const path of paths)if(existsSync(join(root,path)))throw Error('An archived carry projection is still present');
}

export function archivePins(receipt,reference){
  return new Set([reference?.path,receipt?.source_projection?.path,receipt?.source_base?.path,receipt?.evaluation_projection?.path,
    ...(receipt?.renewal?[receipt.renewal.origin?.path,...(receipt.renewal.transitions||[]).map(item=>item?.path)]:[])].filter(Boolean));
}

// prior ∪ verified drops that are NOT hosted in the final map. A re-hosted drop
// is simply not indexed, so a file is never both newly archived and hosted.
export function composeFinancialAuditArchive({state,dist,hosted,runId=Number(process.env.GITHUB_RUN_ID),runAttempt=Number(process.env.GITHUB_RUN_ATTEMPT)}){
  const prior=state.live.receipt?.financial_audit_archive??null,record=state.auditArchive;
  const files=structuredClone(prior?.files??{});
  if(record?.mode==='prune'&&record.live_identity===state.live.identity&&Array.isArray(record.removal)){
    const receipts=hostedReceipts(dist,hosted);
    for(const [path,drop]of Object.entries(record.drops||{}).sort(([a],[b])=>a<b?-1:1)){
      if(Object.hasOwn(hosted,path)||Object.hasOwn(files,path)||!record.removal.includes(path))continue;
      const bound=referencingReceipts(receipts,path,drop.sha256);
      if(canonicalJson(bound.receipts)!==canonicalJson(drop.receipts)||bound.generations.length!==1||bound.generations[0]!==drop.financial_generation)throw Error('Archived carry receipt binding changed before composition');
      files[path]={kind:'carry-projection',sha256:drop.sha256,bytes:drop.bytes,financial_generation:drop.financial_generation,receipts:drop.receipts,encoding:drop.encoding,url:drop.url,
        archived_at:drop.archived_at,verified_at:drop.verified_at,removed_by:{run_id:runId,run_attempt:runAttempt,previous_publication_identity:state.live.identity}};
    }
  }
  const index=Object.keys(files).length||prior?{schema_version:ARCHIVE_SCHEMA,repository:bootstrap.repository,files:sortedObject(files)}:null;
  if(record)record.composed_sha256=archiveDigest(index);
  return index;
}

export function assertArchiveBinding(state,live,publication){
  const actual=archiveDigest(publication.financial_audit_archive??null);
  if(admissionCovers(state,live)&&state.auditArchive.composed_sha256!==undefined){
    if(actual!==state.auditArchive.composed_sha256)throw Error('Financial audit archive index changed after composition');
  }else if(actual!==archiveDigest(live.receipt?.financial_audit_archive??null))throw Error('Financial audit archive index changed without a same-run admission');
}

// ---------------------------------------------------------------------------
// Archive workflow (separate from the publisher). Collect and verify steps are
// anonymous; only `upload` receives the step-scoped contents: write token.

async function readSitePublication({fetcher=fetch,siteUrl=bootstrap.site_url,validate=validateReceipt}={}){
  const read=async path=>{
    const url=new URL(path,siteUrl);url.searchParams.set('publication_check',String(Date.now()));
    const response=await fetcher(url.href,{cache:'no-store',headers:{'Cache-Control':'no-cache'},redirect:'error'});
    if(!response.ok)throw Error(`Cannot read current Pages ${path}: ${response.status}`);
    return readCapped(response,PUBLICATION_METADATA_BYTES);
  };
  const bytes=await read('publication.json'),receipt=validate(parsePublicationReceipt(bytes));
  return {receipt,bytes,read};
}
const writeOutput=values=>{if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(values).map(([key,value])=>`${key}=${value}\n`).join(''));};

export async function collectArchive({output,fetcher=fetch,sleep=defaultSleep,cwd=process.cwd(),attempts=3,log=console.log,validate=validateReceipt}){
  for(let attempt=1;;attempt++){
    try{return await collectOnce({output,fetcher,cwd,log,validate});}
    catch(error){
      if(attempt>=attempts)throw error;
      log(`Live Pages changed or was unreadable while staging (${error.message}); retrying in 60 s`);await sleep(60000);
    }
  }
}
async function collectOnce({output,fetcher,cwd,log,validate}){
  rmSync(output,{recursive:true,force:true});mkdirSync(join(output,'bins'),{recursive:true});
  const {receipt,bytes}=await readSitePublication({fetcher,validate});
  const plan={schema_version:PLAN_SCHEMA,publication:{run_id:receipt.run_id,run_attempt:receipt.run_attempt,receipt_sha256:sha(bytes)},controller_sha:process.env.GITHUB_SHA||null,entries:[],conflicts:[]};
  let reason=null;
  if(!receipt.financial_release||!receipt.financial_audit_files)reason='no live financial release';
  else if(hostedRenewal(receipt.financial_audit_files))reason='a renewal receipt is hosted';
  else reason=renewalRequestHold({root:cwd,receiptSha256:sha(bytes),runId:receipt.run_id??null,runAttempt:receipt.run_attempt??null});
  const candidates=reason?[]:selectArchiveCandidates({receipt});
  if(candidates.length){
    const nested=await openNestedAudit({publication:receipt,fetcher});
    try{
      for(const {path,sha256}of candidates){
        const location=archiveLocation(path),entry=await nested.entry(path,sha256);
        let existing=null;
        try{existing=await fetchArchivedAsset(location.url,{fetcher,cap:FINANCIAL_AUDIT_MAX_FILE_BYTES});}
        catch(error){if(error?.status!==404)throw error;}
        if(existing){
          try{await verifyArchivedBytes(existing,{sha256,bytes:entry.decodedBytes,encoding:selfEncoding(existing)});log(`Already archived: ${path}`);}
          catch(error){plan.conflicts.push({path,url:location.url,reason:error.message});log(`::error::Published archive copy does not reproduce ${path}: ${error.message}`);}
          continue;
        }
        const encoded=await nested.readEncoded(entry),encoding=selfEncoding(encoded);
        await verifyArchivedBytes(encoded,{sha256,bytes:entry.decodedBytes,encoding});
        writeFileSync(join(output,'bins',location.asset),encoded);
        plan.entries.push({path,sha256,bytes:entry.decodedBytes,encoding,tag:location.tag,asset:location.asset,url:location.url});
      }
    }finally{nested.dispose();}
  }else log(`No carry projections to archive${reason?` (${reason})`:''}.`);
  writeFileSync(join(output,'plan.json'),JSON.stringify(plan,null,1));
  writeOutput({pending:plan.entries.length?'true':'false',conflicts:String(plan.conflicts.length)});
  log(`Staged ${plan.entries.length} carry projection(s); ${plan.conflicts.length} conflict(s).`);
  return plan;
}

export async function verifyPlan({input}){
  const plan=JSON.parse(readFileSync(join(input,'plan.json'),'utf8'));
  if(plan?.schema_version!==PLAN_SCHEMA||!Array.isArray(plan.entries)||!Array.isArray(plan.conflicts))throw Error('Invalid archive staging plan');
  const names=new Set(readdirSync(join(input,'bins')));
  if(names.size!==plan.entries.length)throw Error('Archive staging directory holds unplanned files');
  for(const entry of plan.entries){
    const location=archiveLocation(entry.path);
    if(Object.keys(entry).sort().join('|')!=='asset|bytes|encoding|path|sha256|tag|url'||entry.sha256!==location.sha256||entry.tag!==location.tag||entry.asset!==location.asset||entry.url!==location.url||!names.has(entry.asset))throw Error(`Invalid archive staging entry ${entry.path}`);
    await verifyArchivedBytes(readFileSync(join(input,'bins',entry.asset)),entry);
  }
  return plan;
}

// Minimal REST client for the upload job. Every write is create-only or a
// draft-only repair; the token is never logged or sent to download hosts.
export function releaseClient({token,fetcher=fetch,sleep=defaultSleep,repository=bootstrap.repository}){
  if(!token)throw Error('Archive upload requires the step-scoped GH_TOKEN');
  const base=`https://api.github.com/repos/${repository}`;
  const call=async(method,url,{body,headers={},write=false,expect=[200]}={})=>{
    if(write)await sleep(1000);
    const response=await fetcher(url,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...headers},...(body===undefined?{}:{body})});
    if(!expect.includes(response.status)){await cancel(response);throw new ArchiveHttpError(`GitHub ${method} ${new URL(url).pathname} failed: HTTP ${response.status}`,response.status);}
    if(response.status===404||response.status===204){await cancel(response);return null;}
    return response.json();
  };
  return {
    byTag:tag=>call('GET',`${base}/releases/tags/${encodeURIComponent(tag)}`,{expect:[200,404]}),
    get:id=>call('GET',`${base}/releases/${id}`),
    async list(){
      const all=[];
      for(let page=1;page<=MAX_RELEASE_PAGES;page++){const items=await call('GET',`${base}/releases?per_page=100&page=${page}`);if(!Array.isArray(items))throw Error('Invalid release listing');all.push(...items);if(items.length<100)return all;}
      throw Error('Release listing exceeds its bounded page count');
    },
    create:value=>call('POST',`${base}/releases`,{body:JSON.stringify(value),headers:{'Content-Type':'application/json'},write:true,expect:[201]}),
    upload:(id,name,bytes)=>call('POST',`https://uploads.github.com/repos/${repository}/releases/${id}/assets?name=${encodeURIComponent(name)}`,{body:bytes,headers:{'Content-Type':'application/gzip'},write:true,expect:[201]}),
    publish:id=>call('PATCH',`${base}/releases/${id}`,{body:JSON.stringify({draft:false,make_latest:'false'}),headers:{'Content-Type':'application/json'},write:true}),
    deleteAsset:id=>call('DELETE',`${base}/releases/assets/${id}`,{write:true,expect:[204]}),
  };
}
const matchingAsset=(asset,entry)=>asset?.name===archiveLocation(entry.path).asset&&asset.state==='uploaded'&&asset.size===entry.encoding.bytes&&asset.digest===`sha256:${entry.encoding.sha256}`;
const reservedDraft=(release,tag)=>release?.draft===true&&release.tag_name===tag&&tag.startsWith(RESERVED_RELEASE_PREFIX)&&tag.startsWith(ARCHIVE_TAG_PREFIX);

// Published release with other bytes: accepted only when it reproduces the same
// logical file (a different zlib runtime may re-encode); never modified.
async function acceptPublished(release,entry,{fetcher}){
  const meta=assertReleaseMetadata(release,{path:entry.path});
  if(!meta.needsFull&&meta.digest===entry.encoding.sha256&&meta.size===entry.encoding.bytes)return 'exists';
  const bytes=await fetchArchivedAsset(entry.url,{fetcher,expectedBytes:meta.size});
  if(meta.digest!==null&&sha(bytes)!==meta.digest)throw Error('published asset bytes differ from its digest');
  await verifyArchivedBytes(bytes,{sha256:entry.sha256,bytes:entry.bytes,encoding:selfEncoding(bytes)});
  return 'alternate-encoding';
}
export async function uploadEntry(client,entry,bytes,{fetcher=fetch,controllerSha=process.env.GITHUB_SHA,log=console.log}={}){
  const location=archiveLocation(entry.path),tag=location.tag;
  if(sha(bytes)!==entry.encoding.sha256||bytes.length!==entry.encoding.bytes)throw Error(`Staged bytes changed for ${entry.path}`);
  const published=await client.byTag(tag);
  if(published){
    if(published.draft!==false)throw new ArchiveConflict(`Tag lookup returned a draft for ${tag}`);
    try{return await acceptPublished(published,entry,{fetcher});}catch(error){throw new ArchiveConflict(`Published archive release ${tag} cannot be accepted: ${error.message}`);}
  }
  const drafts=(await client.list()).filter(release=>release?.tag_name===tag&&release.draft===true);
  if(drafts.length>1)throw new ArchiveConflict(`More than one draft release for ${tag}`);
  let release=drafts[0]??null;
  if(!release){
    if(!/^[a-f0-9]{40}$/.test(controllerSha||''))throw Error('Archive upload requires the controller commit');
    release=await client.create({tag_name:tag,target_commitish:controllerSha,name:`Financial audit archive: carry-projection ${entry.sha256.slice(0,12)}`,
      body:canonicalJson({path:entry.path,sha256:entry.sha256,bytes:entry.bytes,encoding:entry.encoding,url:entry.url}),draft:true,make_latest:'false'});
    if(!reservedDraft(release,tag))throw new ArchiveConflict(`Created release for ${tag} is not a reserved draft`);
  }
  const assets=release.assets??[];
  if(!(assets.length===1&&matchingAsset(assets[0],entry))){
    // repairDraftAsset: re-read and only ever touch a reserved draft.
    const current=await client.get(release.id);
    if(!reservedDraft(current,tag))throw new ArchiveConflict(`Refusing to modify ${tag}: not a reserved draft`);
    for(const asset of current.assets??[])if(!matchingAsset(asset,entry)){
      const again=await client.get(release.id);if(!reservedDraft(again,tag))throw new ArchiveConflict(`Refusing to modify ${tag}: not a reserved draft`);
      await client.deleteAsset(asset.id);
    }
    const refreshed=await client.get(release.id);
    if(!reservedDraft(refreshed,tag))throw new ArchiveConflict(`Refusing to modify ${tag}: not a reserved draft`);
    if(!(refreshed.assets??[]).some(asset=>matchingAsset(asset,entry)))await client.upload(release.id,location.asset,bytes);
    const uploaded=await client.get(release.id);
    if(!reservedDraft(uploaded,tag)||(uploaded.assets??[]).length!==1||!matchingAsset(uploaded.assets[0],entry))throw new ArchiveConflict(`Uploaded asset for ${tag} did not verify`);
  }
  await client.publish(release.id);
  const final=await client.byTag(tag);
  const meta=assertReleaseMetadata(final,{path:entry.path,encoding:entry.encoding});
  if(meta.needsFull)await verifyArchivedBytes(await fetchArchivedAsset(entry.url,{fetcher,expectedBytes:entry.encoding.bytes}),entry);
  log(`Archived ${entry.path} as ${tag}`);
  return drafts.length?'repaired-draft':'created';
}
export async function uploadArchive({input,token=process.env.GH_TOKEN,fetcher=fetch,sleep=defaultSleep,log=console.log,controllerSha=process.env.GITHUB_SHA}){
  const plan=await verifyPlan({input}),client=releaseClient({token,fetcher,sleep}),results={};let conflicts=0;
  for(const entry of plan.entries){
    try{results[entry.path]=await uploadEntry(client,entry,readFileSync(join(input,'bins',entry.asset)),{fetcher,log,controllerSha});}
    catch(error){if(!(error instanceof ArchiveConflict))throw error;conflicts++;results[entry.path]='conflict';log(`::error::${error.message}`);}
  }
  if(conflicts)throw Error(`${conflicts} archive conflict(s); no published release was modified`);
  return results;
}

export async function verifyPublic({input,fetcher=fetch,sleep=defaultSleep,budgetMs=120000,now=()=>Date.now()}){
  const plan=await verifyPlan({input}),started=now();
  for(const entry of plan.entries){
    for(let delay=2000;;delay*=2){
      try{
        const bytes=await fetchArchivedAsset(entry.url,{fetcher,cap:FINANCIAL_AUDIT_MAX_FILE_BYTES});
        await verifyArchivedBytes(bytes,{sha256:entry.sha256,bytes:entry.bytes,encoding:selfEncoding(bytes)});break;
      }catch(error){if(now()-started+delay>budgetMs)throw Error(`Public archive copy of ${entry.path} did not verify: ${error.message}`);await sleep(delay);}
    }
  }
  return plan.entries.length;
}

// Independent verifier: every hosted receipt's projections are hosted or
// archived with the same hash; every archive entry is publicly retrievable.
export async function verifyHistory({full=false,orphans=false,fetcher=fetch,api=githubApi,log=console.log,validate=validateReceipt}={}){
  const {receipt,read}=await readSitePublication({fetcher,validate});
  const hosted=receipt.financial_audit_files??{},index=receipt.financial_audit_archive??null,archived=index?.files??{};
  if(index)validateFinancialAuditArchive(index,receipt);
  const gaps=[];
  for(const [path,hash]of Object.entries(hosted).filter(([path])=>receiptPattern.test(path)).sort()){
    const bytes=await read(path);if(sha(bytes)!==hash)throw Error(`Hosted receipt bytes changed: ${path}`);
    const value=JSON.parse(bytes);
    for(const ref of [value.evaluation_projection,value.source_projection,value.source_base]){
      if(!ref?.path)continue;
      if(hosted[ref.path]!==ref.sha256&&archived[ref.path]?.sha256!==ref.sha256)gaps.push(`${path} -> ${ref.path}`);
    }
  }
  const unexpected=gaps.filter(gap=>!LEGACY_CLOSURE_GAPS.includes(gap));
  for(const gap of gaps)log(`${LEGACY_CLOSURE_GAPS.includes(gap)?'Legacy':'::error::Unexpected'} closure gap: ${gap}`);
  let verified={probe:[],full:[]};
  if(index){
    const listing=orphans?listArchiveReleases(api,{required:Object.keys(archived).map(path=>archiveLocation(path).tag)}):null;
    const files=Object.entries(archived).sort(([a],[b])=>a<b?-1:1);
    await pool(files,full?2:PROBE_CONCURRENCY,async([path,entry])=>{
      if(listing)assertReleaseMetadata(listing.get(archiveLocation(path).tag),{path,encoding:entry.encoding});
      const bytes=await fetchArchivedAsset(entry.url,{fetcher,expectedBytes:entry.encoding.bytes,mode:full?'full':'probe'});
      if(full){await verifyArchivedBytes(bytes,entry);verified.full.push(path);}else verified.probe.push(path);
    });
  }
  const orphaned=[];
  if(orphans){
    const listing=listArchiveReleases(api);
    for(const tag of listing.keys()){
      const hash=/^financial-audit-archive-carry-projection-([a-f0-9]{64})$/.exec(tag)?.[1];
      const path=hash?`static-data/financial-corrections/carry-projection-${hash}.json`:null;
      if(!path||!Object.hasOwn(archived,path)&&!Object.hasOwn(hosted,path))orphaned.push(tag);
    }
    for(const tag of orphaned)log(`::error::Archive release is neither indexed nor hosted (possible controller rollback): ${tag}`);
  }
  log(`Verified ${verified.full.length} full and ${verified.probe.length} probed archive entries; ${gaps.length} closure gap(s); ${orphaned.length} orphan(s).`);
  if(unexpected.length||orphaned.length)throw Error('Financial audit archive history check failed');
  return {verified,gaps,orphaned};
}

async function main(argv){
  const [command,...args]=argv,flag=name=>{const at=args.indexOf(name);if(at<0||!args[at+1])throw Error(`Missing ${name}`);return resolve(args[at+1]);};
  if(command==='collect')await collectArchive({output:flag('--output')});
  else if(command==='verify-plan')console.log(`Verified ${(await verifyPlan({input:flag('--input')})).entries.length} staged bin(s) offline.`);
  else if(command==='upload'){const results=await uploadArchive({input:flag('--input')});console.log(JSON.stringify(results));}
  else if(command==='verify-public')console.log(`Verified ${await verifyPublic({input:flag('--input')})} public archive copy(ies).`);
  else if(command==='verify-history'){
    if(args.some(arg=>!['--full','--orphans'].includes(arg)))throw Error('verify-history accepts only --full and --orphans');
    await verifyHistory({full:args.includes('--full'),orphans:args.includes('--orphans')});
  }
  else throw Error('Expected collect, verify-plan, upload, verify-public or verify-history');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let completed=false;
  process.once('beforeExit',()=>{if(!completed){console.error('Financial audit archive command did not complete');process.exitCode=1;}});
  main(process.argv.slice(2)).then(()=>{completed=true;},error=>{completed=true;console.error(error.stack||error);process.exitCode=1;});
}
