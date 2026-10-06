// Controller-only second transport layer. The captured browser sees its entire
// physical closure as ordinary identity files; its wire format never changes.
import {copyFileSync,existsSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,statfsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createStaticTransport} from '../../frontend/src/static/transport/index.mjs';
import {canonicalBytes,DEFAULT_LIMITS,generationBody,parseCanonical,validateExpectedRoot,validateRoot,validPath} from '../../frontend/src/static/transport/format.mjs';
import {financialAuditInventory,validateFinancialAuditFiles,PUBLICATION_METADATA_BYTES} from './financial-audit-history.mjs';
import bootstrap from './approved-ui-bootstrap.json' with {type:'json'};
import policy from '../../contracts/financial_release_v1.json' with {type:'json'};

export const AUDIT_TRANSPORT_PREFIX='static-data/_financial-audit-transport/';
export const AUDIT_TRANSPORT_SCHEMA='financial-audit-transport-v1';
const compressedPattern=/^static-data\/financial-corrections\/(source-projection|source-base|carry-projection)-([a-f0-9]{64})\.json$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const sorted=value=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0));
const equal=(a,b,message)=>{if(JSON.stringify(sorted(a))!==JSON.stringify(sorted(b)))throw Error(message);};
const implementation=(frontendRoot,name)=>import(pathToFileURL(join(resolve(frontendRoot),'tools/static-transport',`${name}.mjs`)).href);

// Read only small, hash-bound metadata before any potentially large restore.
// The codec subsequently verifies every shard, closure and payload independently.
function pinnedMetadata(root,ref,cap){
  if(!validPath(ref.path)||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>cap)throw Error('Invalid bounded audit transport metadata');
  let path=root;
  for(const part of ['',...ref.path.split('/').slice(0,-1)]){
    if(part)path=join(path,part);
    const info=lstatSync(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Linked audit transport metadata directory');
  }
  const file=join(root,ref.path),before=lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size!==ref.bytes)throw Error('Audit transport metadata size or type mismatch');
  const bytes=readFileSync(file),after=lstatSync(file);
  if(bytes.length!==ref.bytes||sha(bytes)!==ref.sha256||before.dev!==after.dev||before.ino!==after.ino||before.ctimeMs!==after.ctimeMs||before.mtimeMs!==after.mtimeMs)throw Error('Audit transport metadata integrity mismatch');
  return parseCanonical(bytes);
}
function inspectLogicalInventory(root,expected){
  validateExpectedRoot(expected);
  const value=validateRoot(pinnedMetadata(root,expected,DEFAULT_LIMITS.rootBytes),expected);
  if(sha(canonicalBytes(generationBody(value)))!==expected.generation)throw Error('Audit transport generation digest mismatch');
  const inventory=pinnedMetadata(root,value.logicalInventory,DEFAULT_LIMITS.inventoryBytes);
  if(!exact(inventory,['format','files'])||inventory.format!==value.format||!inventory.files||typeof inventory.files!=='object'||Array.isArray(inventory.files))throw Error('Invalid audit logical inventory');
  let bytes=0;
  for(const [path,entry]of Object.entries(inventory.files)){
    if(!validPath(path)||!exact(entry,['bytes','sha256'])||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>DEFAULT_LIMITS.decodedBytes||!/^[a-f0-9]{64}$/.test(entry.sha256||''))throw Error('Invalid bounded audit logical inventory entry');
    bytes+=entry.bytes;
  }
  return {files:inventory.files,bytes,count:Object.keys(inventory.files).length};
}
export function financialAuditRestoreBudget({root,publication,restore}){
  const outer=inspectLogicalInventory(root,publication.transport.root);
  const receipt=lstatSync(join(root,'publication.json'));
  if(!receipt.isFile()||receipt.isSymbolicLink()||receipt.size>PUBLICATION_METADATA_BYTES)throw Error('Invalid bounded publication metadata');
  // The codec excludes its external bootstrap, but canonicalization writes it.
  const publicationBytes=receipt.size;
  let canonicalBytes=outer.bytes+publicationBytes,canonicalFiles=outer.count+1,restoreBytes=outer.bytes+publicationBytes;
  if(publication.financial_audit_transport){
    validateFinancialAuditTransport(publication.financial_audit_transport,publication);
    const nested=inspectLogicalInventory(join(root,AUDIT_TRANSPORT_PREFIX),publication.financial_audit_transport.root);
    const manifest=nested.files['static-data/manifest.json'];if(!manifest)throw Error('Missing audit transport manifest');
    for(const [path,entry]of Object.entries(outer.files))if(path.startsWith(AUDIT_TRANSPORT_PREFIX)){canonicalBytes-=entry.bytes;canonicalFiles--;}
    canonicalBytes+=nested.bytes-manifest.bytes;canonicalFiles+=nested.count-1;
    // Nested recovery is streamed to its own staging directory, then renamed
    // into the outer restore without copying the decoded audit a second time.
    restoreBytes+=nested.bytes;
  }
  assertLogicalPublicationBudget(canonicalBytes,canonicalFiles);
  let availableBytes=null;
  if(restore){
    let parent=dirname(resolve(restore));while(!existsSync(parent))parent=dirname(parent);
    const disk=statfsSync(parent);availableBytes=disk.bavail*disk.bsize;
    // Account for filesystem blocks and metadata in addition to exact contents.
    restoreBytes+=canonicalFiles*4096+64*1024*1024;
    if(availableBytes<restoreBytes)throw Error(`Insufficient disk for bounded canonical restoration: need ${restoreBytes}, available ${availableBytes}`);
  }
  return {canonicalBytes,canonicalFiles,publicationBytes,restoreBytes,availableBytes};
}
export function assertLogicalPublicationBudget(bytes,files){
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes>policy.maximum_archive_bytes||!Number.isSafeInteger(files)||files<0||files>policy.maximum_archive_files)throw Error('Reconstructed logical publication exceeds existing archive bounds');
}

export function auditInternalPath(path,hash){
  const match=compressedPattern.exec(path);
  if(!match||match[2]!==hash)throw Error('Unapproved compressed financial audit path');
  return `static-data/research-details/${match[1]}-${hash}.json`;
}
export function compressedAuditFiles(publication){
  return Object.fromEntries(Object.entries(validateFinancialAuditFiles(publication.financial_audit_files)).filter(([path])=>compressedPattern.test(path)));
}
export function validateFinancialAuditTransport(value,publication){
  if(!exact(value,['schema_version','root','storage_data_inventory_sha256'])||value.schema_version!==AUDIT_TRANSPORT_SCHEMA
    ||!/^[a-f0-9]{64}$/.test(value.storage_data_inventory_sha256||''))throw Error('Invalid closed financial audit transport descriptor');
  validateExpectedRoot(value.root);
  if(!publication?.financial_release||!publication.transport||!Object.keys(compressedAuditFiles(publication)).length)throw Error('Financial audit transport requires an approved logical inventory');
  equal(value.root.bindings,publication.transport.root.bindings,'Financial audit transport generation bindings changed');
  return value;
}

function stageTree(source,destination,excluded,prefix=''){
  mkdirSync(destination,{recursive:true});
  for(const entry of readdirSync(source,{withFileTypes:true})){
    const path=prefix+entry.name,from=join(source,entry.name),to=join(destination,entry.name);
    if(excluded.has(path))continue;
    if(entry.isDirectory())stageTree(from,to,excluded,`${path}/`);
    else if(entry.isFile()){
      // Release receipts retain their ordinary one-link audit-file invariant.
      if(path.startsWith('static-data/financial-corrections/'))copyFileSync(from,to);
      else linkSync(from,to);
    }else throw Error('Linked or special financial audit staging input');
  }
}

export async function prepareFinancialAuditStorage({source,storage,frontendRoot,publication,bindings}){
  if(existsSync(join(source,AUDIT_TRANSPORT_PREFIX)))throw Error('Reserved financial audit transport path already exists');
  equal(financialAuditInventory(source),publication.financial_audit_files,'Financial audit logical inventory changed before packing');
  const files=compressedAuditFiles(publication);
  if(!Object.keys(files).length)throw Error('Missing compressible financial audit files');
  const scratch=mkdtempSync(join(dirname(storage),'.financial-audit-source-'));
  try{
    for(const [path,hash]of Object.entries(files)){
      const internal=auditInternalPath(path,hash),to=join(scratch,internal);
      if(lstatSync(join(source,path)).size>DEFAULT_LIMITS.decodedBytes)throw Error('Financial audit exceeds existing decoded transport cap');
      mkdirSync(dirname(to),{recursive:true});linkSync(join(source,path),to);
    }
    mkdirSync(join(scratch,'static-data'),{recursive:true});linkSync(join(source,'static-data/manifest.json'),join(scratch,'static-data/manifest.json'));
    stageTree(source,storage,new Set([...Object.keys(files),'publication.json']));
    const {pack}=await implementation(frontendRoot,'pack'),{verify}=await implementation(frontendRoot,'verify');
    const packed=await pack({source:scratch,output:join(storage,AUDIT_TRANSPORT_PREFIX),bindings});
    await verify({packed:join(storage,AUDIT_TRANSPORT_PREFIX),expectedRoot:packed.expectedRoot,source:scratch});
    return {schema_version:AUDIT_TRANSPORT_SCHEMA,root:packed.expectedRoot};
  }finally{rmSync(scratch,{recursive:true,force:true});}
}

// The outer codec's logical inventory describes intermediate storage. Only this
// closed, independently verified substitution yields the canonical inventory.
export async function verifyFinancialAuditStorage({root,frontendRoot,publication,outer,restore}){
  const descriptor=validateFinancialAuditTransport(publication.financial_audit_transport,publication);
  const {verify}=await implementation(frontendRoot,'verify');
  const scratch=restore?mkdtempSync(join(dirname(restore),'.financial-audit-restore-')):null;
  try{
    const nested=await verify({packed:join(root,AUDIT_TRANSPORT_PREFIX),expectedRoot:descriptor.root,...(scratch?{restore:join(scratch,'logical')}:{})});
    const files=compressedAuditFiles(publication),expected={};
    const manifest=outer.logicalInventory['static-data/manifest.json'];
    expected['static-data/manifest.json']=manifest;
    for(const [path,hash]of Object.entries(files)){
      const internal=auditInternalPath(path,hash),entry=nested.logicalInventory[internal];
      if(!entry||entry.sha256!==hash||entry.bytes>DEFAULT_LIMITS.decodedBytes)throw Error('Financial audit logical source hash or bounds changed');
      expected[internal]=entry;
    }
    equal(nested.logicalInventory,expected,'Financial audit transport contains unknown logical paths');
    const logical={...outer.logicalInventory},nestedPhysical={};
    for(const [path,entry]of Object.entries(logical))if(path.startsWith(AUDIT_TRANSPORT_PREFIX)){nestedPhysical[path.slice(AUDIT_TRANSPORT_PREFIX.length)]=entry;delete logical[path];}
    equal(nestedPhysical,nested.physicalInventory,'Financial audit nested physical closure changed');
    for(const [path,hash]of Object.entries(files)){
      if(Object.hasOwn(logical,path))throw Error('Financial audit has duplicate raw and compressed representations');
      const internal=auditInternalPath(path,hash);logical[path]=nested.logicalInventory[internal];
      if(restore){const to=join(restore,path);mkdirSync(dirname(to),{recursive:true});if(existsSync(to))throw Error('Financial audit restore destination already exists');renameSync(join(scratch,'logical',internal),to);}
    }
    if(restore)rmSync(join(restore,AUDIT_TRANSPORT_PREFIX),{recursive:true});
    const logicalBytes=Object.values(logical).reduce((sum,entry)=>sum+entry.bytes,0),logicalFiles=Object.keys(logical).length;
    assertLogicalPublicationBudget(logicalBytes,logicalFiles);
    return {...outer,logicalInventory:sorted(logical),logicalFiles,logicalBytes,auditTransport:nested};
  }finally{if(scratch)rmSync(scratch,{recursive:true,force:true});}
}

// No injectable resolver, aliases, or base URL: callers supply the same trusted
// live publication and the publisher's configured site, then request its map.
export async function financialAuditReader({publication,fetcher}){
  validateFinancialAuditTransport(publication.financial_audit_transport,publication);
  const files=compressedAuditFiles(publication),transport=await createStaticTransport({
    baseURL:new URL(AUDIT_TRANSPORT_PREFIX,bootstrap.site_url).href,expectedRoot:publication.financial_audit_transport.root,fetchImpl:fetcher});
  return {dispose:()=>transport.dispose(),read:async(path,hash)=>{
    if(files[path]!==hash)throw Error('Unapproved compressed financial audit source');
    return Buffer.from(await transport.readBytes(auditInternalPath(path,hash),{expectedDecodedSha256:hash}));
  }};
}
