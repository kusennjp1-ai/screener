// Lossless transport is a physical representation, never publication authority.
// Keep logical data receipts independent from the exact hosted file closure.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdtempSync} from 'node:fs';
import {dirname} from 'node:path';
import {AUDIT_TRANSPORT_PREFIX,assertLogicalPublicationBudget,financialAuditRestoreBudget,prepareFinancialAuditStorage,validateFinancialAuditTransport,verifyFinancialAuditStorage} from './financial-audit-transport.mjs';
import {PUBLICATION_METADATA_BYTES} from './financial-audit-history.mjs';

export const TRANSPORT_PUBLICATION_SCHEMA='static-json-transport-publication-v1';
export const TRANSPORT_PREVIEW_SCHEMA='static-json-transport-preview-v1';
export const TRANSPORT_CAPABILITY_PATH='static-transport-capability.json';
const capability={schema_version:'static-json-transport-capability-v1',publication_schema:TRANSPORT_PUBLICATION_SCHEMA};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const checksum=v=>createHash('sha256').update(v).digest('hex');
const exact=(v,keys,label)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))throw Error(`Invalid closed transport ${label}`);};
const dataFiles=['research-daily.json','portfolio-model.json','qualification-audit.json','ibd-reference.json'];
const isData=path=>path.startsWith('static-data/')||dataFiles.includes(path);
const digest=files=>checksum(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0))));
const hashes=files=>Object.fromEntries(Object.entries(files).map(([path,value])=>[path,value.sha256]));
const read=path=>JSON.parse(readFileSync(path,'utf8'));

export function validateTransportDescriptor(value,publication) {
  exact(value,['schema_version','root','logical_data_inventory_sha256','physical_inventory_sha256','ui_sha','ui_digest'],'publication descriptor');
  if(value.schema_version!==TRANSPORT_PUBLICATION_SCHEMA||!sha(value.ui_sha)||!hash(value.ui_digest)||!hash(value.logical_data_inventory_sha256)||!hash(value.physical_inventory_sha256))throw Error('Invalid transport inventory/UI binding');
  const root=value.root;
  exact(root,['path','bytes','sha256','generation','bindings'],'root reference');
  if(!hash(root.sha256)||!hash(root.generation)||root.path!==`static-data/_transport/root-${root.sha256}.json`||!Number.isSafeInteger(root.bytes)||root.bytes<=0||root.bytes>65536)throw Error('Invalid transport root identity');
  const b=root.bindings;
  exact(b,['manifestSha256','uiInventorySha256','financialGeneration','financialLineageSha256','sourceCommit','appCommit','candidateId'],'generation bindings');
  if(!hash(b.manifestSha256)||!hash(b.uiInventorySha256)||!sha(b.sourceCommit)||!sha(b.appCommit)||!hash(b.candidateId)
    ||!(b.financialGeneration===null||hash(b.financialGeneration))||!(b.financialLineageSha256===null||hash(b.financialLineageSha256))
    ||(b.financialGeneration===null)!==(b.financialLineageSha256===null)
    ||b.appCommit!==value.ui_sha||b.uiInventorySha256!==value.ui_digest)throw Error('Invalid transport generation bindings');
  if(publication&&(publication.ui_sha!==value.ui_sha||publication.ui_digest!==value.ui_digest||publication.data_manifest_sha256!==b.manifestSha256
    ||publication.controller_sha!==undefined&&publication.controller_sha!==b.sourceCommit
    ||publication.financial_generation!==undefined&&publication.financial_generation!==b.financialGeneration
    ||publication.financial_lineage_sha256!==undefined&&publication.financial_lineage_sha256!==b.financialLineageSha256
    ||publication.data_inventory_sha256!==undefined&&publication.data_inventory_sha256!==value.logical_data_inventory_sha256))throw Error('Publication and transport generation disagree');
  if(publication?.schema===1&&(b.financialGeneration!==(publication.financial_generation??null)||b.financialLineageSha256!==(publication.financial_lineage_sha256??null)))throw Error('Published transport changed financial lineage');
  return value;
}

export function validateTransportPreview(value) {
  exact(value,['schema','publication_authority','ui_sha','ui_digest','data_manifest_sha256','transport'],'preview bootstrap');
  if(value.schema!==TRANSPORT_PREVIEW_SCHEMA||value.publication_authority!=='none')throw Error('Transport preview cannot grant publication authority');
  validateTransportDescriptor(value.transport,value);
  return value;
}

export function transportCapable(root) {
  const path=join(root,TRANSPORT_CAPABILITY_PATH);
  if(!existsSync(path))return false;
  if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw Error('Invalid transport capability file');
  const actual=read(path);exact(actual,Object.keys(capability),'consumer capability');
  if(JSON.stringify(actual)!==JSON.stringify(capability))throw Error('Unsupported transport consumer capability');
  return true;
}

export function assertTransportDeclaration(root,publication) {
  const declared=publication&&Object.hasOwn(publication,'transport');
  const stored=existsSync(join(root,'static-data/_transport'));
  if(declared)validateTransportDescriptor(publication.transport,publication);
  if(stored!==Boolean(declared))throw Error('Packed transport metadata is missing or undeclared');
  if(declared&&!transportCapable(root))throw Error('Packed data requires the exact approved decoder UI');
  if(existsSync(join(root,AUDIT_TRANSPORT_PREFIX))!==Boolean(publication?.financial_audit_transport))throw Error('Financial audit transport metadata is missing or undeclared');
  if(publication?.financial_audit_transport)validateFinancialAuditTransport(publication.financial_audit_transport,publication);
  return Boolean(declared);
}

async function implementation(frontendRoot,name) {
  return import(pathToFileURL(join(resolve(frontendRoot),'tools/static-transport',`${name}.mjs`)).href);
}

export function transportDescriptor(result,{uiSha,uiDigest}) {
  return validateTransportDescriptor({schema_version:TRANSPORT_PUBLICATION_SCHEMA,root:result.expectedRoot,
    logical_data_inventory_sha256:digest(hashes(Object.fromEntries(Object.entries(result.logicalInventory).filter(([path])=>isData(path))))),
    physical_inventory_sha256:digest(hashes(result.physicalInventory)),ui_sha:uiSha,ui_digest:uiDigest});
}

export async function verifyTransportPublication({root,frontendRoot,publication,restore}) {
  if(!assertTransportDeclaration(root,publication))return null;
  const receiptPath=join(root,'publication.json'),receiptBytes=readFileSync(receiptPath);
  if(JSON.stringify(JSON.parse(receiptBytes))!==JSON.stringify(publication))throw Error('Packed publication bootstrap differs from pinned receipt');
  const restoreBudget=financialAuditRestoreBudget({root,publication,restore});
  const {verify}=await implementation(frontendRoot,'verify');
  let checked=await verify({packed:root,expectedRoot:publication.transport.root,...(restore?{restore}:{})});
  if(publication.financial_audit_transport){
    const storage=transportDescriptor(checked,{uiSha:publication.ui_sha,uiDigest:publication.ui_digest});
    if(storage.logical_data_inventory_sha256!==publication.financial_audit_transport.storage_data_inventory_sha256)throw Error('Financial audit intermediate storage inventory changed');
    checked=await verifyFinancialAuditStorage({root,frontendRoot,publication,outer:checked,restore});
  }
  const actual=transportDescriptor(checked,{uiSha:publication.ui_sha,uiDigest:publication.ui_digest});
  if(JSON.stringify(actual)!==JSON.stringify(publication.transport))throw Error('Transport logical or complete physical inventory changed');
  if(digest(hashes(Object.fromEntries(Object.entries(checked.logicalInventory).filter(([path])=>!isData(path)))))!==publication.ui_digest)throw Error('Transport UI inventory differs from approved decoder');
  if(checksum(readFileSync(join(root,'static-data/manifest.json')))!==publication.data_manifest_sha256)throw Error('Transport raw manifest changed');
  if(checksum(readFileSync(receiptPath))!==checksum(receiptBytes))throw Error('Packed publication changed during verification');
  if(restore)writeFileSync(join(restore,'publication.json'),receiptBytes);
  return {...checked,restoreBudget};
}

// The returned root is a fresh verified original tree. Callers must remove it
// after the unchanged logical financial/price validators finish.
export async function canonicalPublication({root,frontendRoot,publication,restore}) {
  if(!assertTransportDeclaration(root,publication))return root;
  if(!restore||existsSync(restore))throw Error('Canonical transport destination must be new');
  try{await verifyTransportPublication({root,frontendRoot,publication,restore});return restore;}
  catch(error){rmSync(restore,{recursive:true,force:true});throw error;}
}

export async function packPublication({root,frontendRoot,publication,bindings,preserveLogical,compressFinancialAudit=false}) {
  if(!transportCapable(root))throw Error('Packing requires a captured decoder-capable UI');
  if(existsSync(join(root,'static-data/_transport'))||Object.hasOwn(publication,'transport'))throw Error('Only an original logical tree can be packed');
  const output=`${root}.packed`,original=preserveLogical||`${root}.logical`;
  if(existsSync(output)||existsSync(original))throw Error('Transport output or original destination already exists');
  const {pack}=await implementation(frontendRoot,'pack');
  const {verify}=await implementation(frontendRoot,'verify');
  const bound={...bindings,manifestSha256:publication.data_manifest_sha256,uiInventorySha256:publication.ui_digest,
    financialGeneration:publication.financial_generation??bindings.financialGeneration??null,
    financialLineageSha256:publication.financial_lineage_sha256??bindings.financialLineageSha256??null,appCommit:publication.ui_sha};
  if(typeof compressFinancialAudit!=='boolean'||publication.financial_audit_transport)throw Error('Invalid financial audit codec request');
  let staging;
  try{
    let source=root,audit;
    if(compressFinancialAudit){
      staging=mkdtempSync(join(dirname(root),'.financial-audit-storage-'));source=join(staging,'storage');
      audit=await prepareFinancialAuditStorage({source:root,storage:source,frontendRoot,publication,bindings:bound});
    }
    const packed=await pack({source,output,bindings:bound});
    let checked=await verify({packed:output,expectedRoot:packed.expectedRoot,source});
    if(audit){
      const storage=transportDescriptor(checked,{uiSha:publication.ui_sha,uiDigest:publication.ui_digest});
      const candidate={...publication,transport:storage,financial_audit_transport:{...audit,storage_data_inventory_sha256:storage.logical_data_inventory_sha256}};
      checked=await verifyFinancialAuditStorage({root:output,frontendRoot,publication:candidate,outer:checked});
      audit=candidate.financial_audit_transport;
    }
    const descriptor=transportDescriptor(checked,{uiSha:publication.ui_sha,uiDigest:publication.ui_digest});
    validateTransportDescriptor(descriptor,publication);
    if(audit)publication.financial_audit_transport=audit;
    publication.transport=descriptor;
    const receipt=JSON.stringify(publication),receiptBytes=Buffer.byteLength(receipt);
    if(receiptBytes>PUBLICATION_METADATA_BYTES)throw Error('Publication metadata exceeds the existing browser byte limit');
    assertLogicalPublicationBudget(checked.logicalBytes+receiptBytes,checked.logicalFiles+1);
    writeFileSync(join(output,'publication.json'),receipt);
    renameSync(root,original);renameSync(output,root);
    if(!preserveLogical)rmSync(original,{recursive:true,force:true});
    return descriptor;
  }catch(error){if(!existsSync(root)&&existsSync(original))renameSync(original,root);rmSync(output,{recursive:true,force:true});throw error;}
  finally{if(staging)rmSync(staging,{recursive:true,force:true});}
}

export function previewPublication({uiSha,uiDigest,manifestSha256}) {
  return {schema:TRANSPORT_PREVIEW_SCHEMA,publication_authority:'none',ui_sha:uiSha,ui_digest:uiDigest,data_manifest_sha256:manifestSha256};
}

export function removeCanonical(root,canonical) {if(canonical!==root)rmSync(canonical,{recursive:true,force:true});}

// Appending the release audit creates new root/shard metadata. It must never
// re-encode captured original members differently or add arbitrary logical data.
export async function verifyCapturedTransportAssets({candidateRoot,root,frontendRoot,candidatePublication,publication,allowedAdditions=[]}) {
  const before=await verifyTransportPublication({root:candidateRoot,frontendRoot,publication:candidatePublication});
  const after=await verifyTransportPublication({root,frontendRoot,publication});
  if(!before||!after)throw Error('Captured packed candidate cannot switch transport representations');
  if(!Array.isArray(allowedAdditions)||allowedAdditions.some(path=>!/^static-data\/financial-corrections\/(?:source-projection|source-base|carry-projection|release)-[a-f0-9]{64}\.json$/.test(path)))throw Error('Invalid packed activation audit additions');
  const originals=hashes(before.logicalInventory),final=hashes(after.logicalInventory),allowed=new Set(allowedAdditions);
  for(const path of Object.keys(final))if(!Object.hasOwn(originals,path)&&allowed.has(path)){
    if(!path.endsWith(`-${final[path]}.json`))throw Error('Packed activation audit addition is not hash-bound');
    delete final[path];
  }
  if(digest(originals)!==digest(final))throw Error('Final packed activation changed captured original logical files');
  const encoded=files=>hashes(Object.fromEntries(Object.entries(files).filter(([path])=>path.startsWith('static-data/_transport/gzip/'))));
  if(digest(encoded(before.physicalInventory))!==digest(encoded(after.physicalInventory)))throw Error('Final packed activation changed captured encoded payload bytes');
  return {logical_inventory_sha256:digest(originals),encoded_payload_inventory_sha256:digest(encoded(before.physicalInventory))};
}
