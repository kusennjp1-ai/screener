// Append-only audit metadata is retention evidence, never financial availability
// or authority to renew a source, change approval, or advance a price clock.
import {createHash} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,lstatSync,openSync,readSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import policy from '../../contracts/financial_release_v1.json' with {type:'json'};

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
export function assertFinancialAuditPreserved(before,after){
  validateFinancialAuditFiles(before);validateFinancialAuditFiles(after);
  for(const [path,hash]of Object.entries(before))if(after[path]!==hash)throw Error('Previous financial audit bytes were removed or changed');
}
