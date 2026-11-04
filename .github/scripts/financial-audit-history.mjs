// Append-only audit metadata is retention evidence, never financial availability
// or authority to renew a source, change approval, or advance a price clock.
import {createHash} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,lstatSync,openSync,readSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import policy from '../../contracts/financial_release_v1.json' with {type:'json'};
import bootstrap from './approved-ui-bootstrap.json' with {type:'json'};

const assetPattern=/^static-data\/financial-corrections\/(?:source-projection|source-base|carry-projection|release|renewal)-([a-f0-9]{64})\.json$/;
export const FINANCIAL_AUDIT_METADATA_BYTES=1024*1024;
export const PUBLICATION_METADATA_BYTES=4*1024*1024;
// Logical recovery uses the existing decoded archive budget. The independent
// final hosted/TAR guard remains strictly below 1 GB after both codec layers.
export const FINANCIAL_AUDIT_MAX_BYTES=policy.maximum_archive_bytes;
export const FINANCIAL_AUDIT_MAX_FILE_BYTES=128*1024*1024;
export function validateFinancialAuditFiles(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))
    ||!Object.keys(value).length||Object.keys(value).length>policy.maximum_archive_files
    ||Buffer.byteLength(JSON.stringify(value))>FINANCIAL_AUDIT_METADATA_BYTES)throw Error('Invalid bounded financial audit inventory');
  for(const [path,hash]of Object.entries(value))if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)||assetPattern.exec(path)?.[1]!==hash)throw Error('Financial audit inventory is not content-addressed');
  return value;
}
// JSON.parse alone silently discards duplicate keys. Validate the bounded JSON
// first, then reject repeated decoded object keys (including escaped aliases).
export function parsePublicationReceipt(bytes){
  if(Buffer.byteLength(bytes)>PUBLICATION_METADATA_BYTES)throw Error('Publication metadata exceeds the existing browser byte limit');
  const text=bytes.toString(),value=JSON.parse(text),stack=[];
  for(const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)){
    const part=token[0];
    if(part==='{')stack.push(new Set());
    else if(part==='[')stack.push(null);
    else if(part==='}'||part===']')stack.pop();
    else if(/^\s*:/.test(text.slice(token.index+part.length))){
      const key=JSON.parse(part),keys=stack.at(-1);
      if(keys.has(key))throw Error('Duplicate publication metadata key');
      keys.add(key);
    }
  }
  return value;
}
export function assertFinancialAuditDirectory(root){
  for(const path of [root,join(root,'static-data'),join(root,'static-data/financial-corrections')]){
    let info;try{info=lstatSync(path);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(!info.isDirectory()||info.isSymbolicLink())throw Error('Linked or special financial audit directory');
  }
}
export function verifyFinancialAuditFile(root,path,expected){
  if(assetPattern.exec(path)?.[1]!==expected)throw Error('Financial audit inventory is not content-addressed');
  assertFinancialAuditDirectory(root);
  const full=join(root,path),fd=openSync(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=fstatSync(fd);
    if(!before.isFile()||before.nlink!==1)throw Error('Linked or special financial audit asset');
    if(before.size>FINANCIAL_AUDIT_MAX_FILE_BYTES)throw Error('Financial audit exceeds existing decoded transport cap');
    const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let count;
    while((count=readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,count));
    const after=fstatSync(fd),current=lstatSync(full);
    if(!current.isFile()||current.nlink!==1||current.dev!==before.dev||current.ino!==before.ino
      ||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('Financial audit changed while reading');
    if(hash.digest('hex')!==expected)throw Error('Financial audit inventory is not content-addressed');
    return before.size;
  }finally{closeSync(fd);}
}
export function financialAuditInventory(root){
  assertFinancialAuditDirectory(root);
  const out={},base=join(root,'static-data/financial-corrections');if(!existsSync(base))return out;
  const entries=readdirSync(base,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
  if(entries.length>policy.maximum_archive_files)throw Error('Financial audit exceeds bounded file count');
  for(const entry of entries){
    const path=`static-data/financial-corrections/${entry.name}`,expected=assetPattern.exec(path)?.[1];
    if(!entry.isFile()||!expected)throw Error('Unrecognized or linked financial audit asset');
    out[path]=expected;
  }
  if(entries.length)validateFinancialAuditFiles(out);
  let total=0;
  for(const [path,expected]of Object.entries(out)){
    total+=verifyFinancialAuditFile(root,path,expected);
    if(total>FINANCIAL_AUDIT_MAX_BYTES)throw Error('Financial audit exceeds bounded archive size');
  }
  return out;
}
export function requiredFinancialAuditFiles(live){
  if(!live.financialRelease||!live.receipt?.financial_release)throw Error('Missing live financial audit authority');
  const receipt=live.financialRelease,declared=live.receipt.financial_audit_files;
  // An activation authenticates the original release and source. An unindexed
  // carry cannot establish which earlier receipts existed; never invent them.
  if(declared===undefined&&receipt.mode!=='activation')throw Error('Cannot establish financial audit history from an unindexed carry');
  const files=declared===undefined?{}:{...validateFinancialAuditFiles(declared)};
  for(const ref of [live.receipt.financial_release,receipt.source_projection,receipt.source_base,receipt.evaluation_projection,
    ...(receipt.renewal?[receipt.renewal.origin,...receipt.renewal.transitions]:[])]){
    if(!ref||declared!==undefined&&files[ref.path]!==ref.sha256)throw Error('Financial audit inventory omits active source authority');
    if(files[ref.path]&&files[ref.path]!==ref.sha256)throw Error('Live financial audit reference changed');
    files[ref.path]=ref.sha256;
  }
  return validateFinancialAuditFiles(files);
}
// The full audit history is hosted (publication.financial_audit_files) plus
// archived (publication.financial_audit_archive.files). With empty archive maps
// this is exactly the original hosted-only preservation check.
export function assertFinancialAuditPreserved(before,after,{archivedBefore={},archivedAfter={},pinned=new Set()}={}){
  validateFinancialAuditFiles(before);validateFinancialAuditFiles(after);
  for(const [path,entry]of Object.entries(archivedBefore))if(canonicalJson(archivedAfter[path]??null)!==canonicalJson(entry))throw Error('Archived financial audit entry was removed or changed');
  for(const [path,hash]of Object.entries(before))if(after[path]!==hash&&archivedAfter[path]?.sha256!==hash)throw Error('Previous financial audit bytes were removed or changed');
  for(const path of Object.keys(archivedAfter))if(!Object.hasOwn(archivedBefore,path)){
    if(before[path]!==archivedAfter[path].sha256)throw Error('Archive may only receive previously hosted audit files');
    if(pinned.has(path)||Object.hasOwn(after,path))throw Error('Active or hosted financial audit cannot be newly archived');
  }
}

// Public archive of older carry projections (GitHub Release assets). The index
// lives in publication.json, so its bytes are bound by the publication identity.
export const ARCHIVE_SCHEMA='financial-audit-archive-v1';
export const ARCHIVE_TAG_PREFIX='financial-audit-archive-';
// No release under this prefix may ever be pruned, edited or deleted by tooling.
export const RESERVED_RELEASE_PREFIX='financial-audit-';
export const ARCHIVE_POLICY=Object.freeze({pruning_enabled:true,max_new_entries_per_publication:32,rotating_full_verifications:2,
  download_hosts:Object.freeze(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'])});
const archivablePattern=/^static-data\/financial-corrections\/carry-projection-([a-f0-9]{64})\.json$/;
const receiptPattern=/^static-data\/financial-corrections\/release-([a-f0-9]{64})\.json$/;
const archiveIdentity=/^[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9]{64}\/[a-f0-9]{64}$/;
const isoTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
const plainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exactKeys=(value,keys)=>plainObject(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const hex64=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const boundedBytes=value=>Number.isSafeInteger(value)&&value>=1&&value<=FINANCIAL_AUDIT_MAX_FILE_BYTES;
export function canonicalJson(value){
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  if(value===undefined||typeof value==='number'&&!Number.isFinite(value))throw Error('Noncanonical financial audit archive value');
  return JSON.stringify(value);
}
export const archiveDigest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export function isArchivableAuditPath(path){return archivablePattern.test(path);}
export function archiveLocation(path){
  const hash=archivablePattern.exec(path)?.[1];if(!hash)throw Error('Only carry projections can be archived');
  const tag=`${ARCHIVE_TAG_PREFIX}carry-projection-${hash}`,asset=`carry-projection-${hash}.json.gz`;
  return {sha256:hash,tag,asset,url:`https://github.com/${bootstrap.repository}/releases/download/${tag}/${asset}`};
}
// Synchronous, offline and closed. Network availability is verified separately.
export function validateFinancialAuditArchive(value,publication){
  if(!exactKeys(value,['schema_version','repository','files'])||value.schema_version!==ARCHIVE_SCHEMA||value.repository!==bootstrap.repository)throw Error('Invalid closed financial audit archive index');
  if(!publication?.financial_release||!publication.financial_audit_files)throw Error('Financial audit archive requires a financial release inventory');
  const hosted=validateFinancialAuditFiles(publication.financial_audit_files),files=value.files;
  if(!plainObject(files)||!Object.keys(files).length||Object.keys(files).length>policy.maximum_archive_files
    ||Buffer.byteLength(JSON.stringify(value))>FINANCIAL_AUDIT_METADATA_BYTES)throw Error('Invalid bounded financial audit archive index');
  for(const [path,entry]of Object.entries(files)){
    const hash=archivablePattern.exec(path)?.[1];
    if(!hash||!exactKeys(entry,['kind','sha256','bytes','financial_generation','receipts','encoding','url','archived_at','verified_at','removed_by'])
      ||entry.kind!=='carry-projection'||entry.sha256!==hash||!boundedBytes(entry.bytes)||!hex64(entry.financial_generation))throw Error('Invalid financial audit archive entry');
    if(!exactKeys(entry.encoding,['kind','sha256','bytes'])||entry.encoding.kind!=='gzip'||!hex64(entry.encoding.sha256)||!boundedBytes(entry.encoding.bytes))throw Error('Invalid financial audit archive encoding');
    if(entry.url!==archiveLocation(path).url)throw Error('Financial audit archive URL is not derived from its content address');
    if(!Array.isArray(entry.receipts)||!entry.receipts.length||entry.receipts.some((receipt,index)=>typeof receipt!=='string'||!receiptPattern.test(receipt)
      ||hosted[receipt]!==receiptPattern.exec(receipt)[1]||index&&!(entry.receipts[index-1]<receipt)))throw Error('Financial audit archive receipts must be sorted hosted release receipts');
    if(!isoTime(entry.archived_at)||!isoTime(entry.verified_at))throw Error('Invalid financial audit archive timestamps');
    const removed=entry.removed_by;
    if(!exactKeys(removed,['run_id','run_attempt','previous_publication_identity'])||!Number.isSafeInteger(removed.run_id)||removed.run_id<1
      ||!Number.isSafeInteger(removed.run_attempt)||removed.run_attempt<1||!archiveIdentity.test(removed.previous_publication_identity||''))throw Error('Invalid financial audit archive removal provenance');
  }
  return value;
}
