// The browser preview remains closed and grants no publication authority.
// Only an independently sealed renewal candidate can supply this controller's
// exact retained-audit context; ordinary v2 captures cannot opt into it.
import {existsSync,lstatSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {dataInventory,digest} from './financial-correction.mjs';
import {inventoryDigest,isData,sha256,uiInventory} from './publication-state.mjs';
import {financialAuditInventory,parsePublicationReceipt,requiredFinancialAuditFiles,validateFinancialAuditFiles} from './financial-audit-history.mjs';
import {AUDIT_TRANSPORT_PREFIX,financialAuditRestoreBudget,validateFinancialAuditTransport,verifyFinancialAuditStorage} from './financial-audit-transport.mjs';
import {packPublication,previewPublication,transportCapable,transportDescriptor,validateTransportPreview,verifyRenewalTransportAssets,verifyTransportPublication} from './static-transport-publication.mjs';
import {parseRenewalRequest,renewalSchema,validateRenewalCandidate,verifyRenewalPredecessor} from './financial-source-renewal.mjs';

export const RENEWAL_CANDIDATE_TRANSPORT_SCHEMA='financial-renewal-candidate-transport-v1';
const AUDIT_CONTEXT_SCHEMA='financial-renewal-candidate-audit-v1';
const exact=(value,keys,label)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))throw Error(`Invalid closed renewal transport ${label}`);};
const equal=(a,b,label)=>{if(digest(a)!==digest(b))throw Error(`Renewal transport changed ${label}`);};
const hashes=files=>Object.fromEntries(Object.entries(files).map(([path,value])=>[path,value.sha256]));
const read=path=>{
  const info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>4*1024*1024)throw Error('Invalid bounded renewal transport metadata');
  return parsePublicationReceipt(readFileSync(path));
};

function retainedContext(candidate,record){
  const request=parseRenewalRequest(read(join(candidate,'renewal-request.json'))),live=read(join(candidate,'evidence.json')).live;
  verifyRenewalPredecessor(request,live);
  const history=validateFinancialAuditFiles(read(join(candidate,'history-inventory.json')));
  for(const [path,hash]of Object.entries(requiredFinancialAuditFiles(live)))if(history[path]!==hash)throw Error('Renewal transport omitted retained source authority');
  if(record&&(record.renewal_request_sha256!==digest(request)||record.history_inventory_sha256!==inventoryDigest(history)))throw Error('Renewal transport changed sealed request/history');
  return {previous_publication_identity:live.identity,financial_release:live.receipt.financial_release,financial_audit_files:history};
}

export async function prepareRenewalCandidateTransport(root,candidate){
  const corrected=join(candidate,'corrected');
  if(!transportCapable(corrected))throw Error('Renewal audit preview requires the approved lossless decoder');
  if(existsSync(join(candidate,'transport.json'))||existsSync(join(corrected,'publication.json')))throw Error('Renewal candidate transport must be prepared exactly once');
  const {validatePreviewReceipt}=await import('./financial-candidate-preview.mjs');
  const {renewalSourceLineage}=await import('./financial-release-activation.mjs');
  const previewBytes=readFileSync(join(candidate,'preview-receipt.json')),preview=validatePreviewReceipt(JSON.parse(previewBytes));
  const retained=retainedContext(candidate);
  equal(financialAuditInventory(corrected),retained.financial_audit_files,'complete original audit history');
  if(inventoryDigest(dataInventory(corrected))!==preview.bundles.corrected_data_sha256||inventoryDigest(uiInventory(corrected))!==preview.candidate_ui.digest)throw Error('Renewal logical bytes changed before packing');
  const lineage=renewalSourceLineage({source:preview.source,certificate:preview.source_validation.certificate.reference,sourceProjectionSha256:preview.financial.projection_sha256,
    receiptInventorySha256:preview.financial.receipt_inventory_sha256,projectionPolicy:preview.destination_projection.policy});
  // This object is used only inside the controller's existing codec. Its audit
  // context is removed from the browser bootstrap before the candidate is sealed.
  const publication={...previewPublication({uiSha:preview.candidate_ui.sha,uiDigest:preview.candidate_ui.digest,manifestSha256:sha256(readFileSync(join(corrected,'static-data/manifest.json')))}),
    financial_release:retained.financial_release,financial_audit_files:retained.financial_audit_files};
  const descriptor=await packPublication({root:corrected,frontendRoot:join(root,'frontend'),publication,compressFinancialAudit:true,preserveLogical:join(candidate,'corrected-logical'),bindings:{
    sourceCommit:preview.controller.sha,appCommit:preview.candidate_ui.sha,candidateId:sha256(previewBytes),financialGeneration:preview.financial.generation,financialLineageSha256:lineage.id}});
  const context={schema_version:AUDIT_CONTEXT_SCHEMA,...retained,financial_audit_transport:publication.financial_audit_transport};
  delete publication.financial_release;delete publication.financial_audit_files;delete publication.financial_audit_transport;
  validateTransportPreview(publication);
  const bootstrapBytes=Buffer.from(JSON.stringify(publication));writeFileSync(join(corrected,'publication.json'),bootstrapBytes);
  const transport={schema_version:RENEWAL_CANDIDATE_TRANSPORT_SCHEMA,preview_receipt_sha256:sha256(previewBytes),bootstrap_sha256:sha256(bootstrapBytes),corrected:descriptor,financial_audit:context};
  writeFileSync(join(candidate,'transport.json'),JSON.stringify(transport));
  return transport;
}

// Called only after the common candidate transport's preview, record, UI,
// source, generation and bootstrap bindings pass. Recheck the complete sealed
// sidecar here as well, so calling this export directly cannot supply context.
export async function verifyRenewalCandidateStorage({root,candidate,record,transport,publication,restore}){
  validateRenewalCandidate(record);
  if(record.schema_version!==renewalSchema)throw Error('Nested audit preview requires its own sealed renewal capture');
  const transportPath=join(candidate,'transport.json'),sealed=readFileSync(transportPath),actual=read(transportPath);
  exact(actual,['schema_version','preview_receipt_sha256','bootstrap_sha256','corrected','financial_audit'],'sidecar');
  if(actual.schema_version!==RENEWAL_CANDIDATE_TRANSPORT_SCHEMA||sha256(sealed)!==record.transport_sha256)throw Error('Renewal transport seal changed');
  equal(actual,transport,'sidecar bytes');
  const context=actual.financial_audit;
  exact(context,['schema_version','previous_publication_identity','financial_release','financial_audit_files','financial_audit_transport'],'audit context');
  if(context.schema_version!==AUDIT_CONTEXT_SCHEMA)throw Error('Invalid renewal audit context version');
  const retained=retainedContext(candidate,record);
  for(const [key,value]of Object.entries(retained))equal(context[key],value,`retained ${key}`);
  const physical=join(candidate,'corrected'),bootstrapPath=join(physical,'publication.json'),bootstrapBytes=readFileSync(bootstrapPath);
  equal(validateTransportPreview(read(bootstrapPath)),publication,'preview bootstrap');
  if(actual.bootstrap_sha256!==sha256(bootstrapBytes)||actual.preview_receipt_sha256!==record.preview_receipt_sha256)throw Error('Renewal transport preview hash changed');
  equal(actual.corrected,publication.transport,'preview descriptor');
  if(!transportCapable(physical)||!existsSync(join(physical,AUDIT_TRANSPORT_PREFIX)))throw Error('Missing declared renewal audit storage');
  if(restore&&existsSync(restore))throw Error('Canonical transport destination must be new');
  const codecPublication={...publication,financial_release:retained.financial_release,financial_audit_files:retained.financial_audit_files,financial_audit_transport:context.financial_audit_transport};
  validateFinancialAuditTransport(context.financial_audit_transport,codecPublication);
  const restoreBudget=financialAuditRestoreBudget({root:physical,publication:codecPublication,restore});
  try{
    const frontendRoot=join(root,'frontend'),{verify}=await import(pathToFileURL(join(resolve(frontendRoot),'tools/static-transport/verify.mjs')).href);
    const outer=await verify({packed:physical,expectedRoot:publication.transport.root,...(restore?{restore}:{})});
    const storage=transportDescriptor(outer,{uiSha:publication.ui_sha,uiDigest:publication.ui_digest});
    if(storage.logical_data_inventory_sha256!==context.financial_audit_transport.storage_data_inventory_sha256)throw Error('Renewal intermediate audit inventory changed');
    const checked=await verifyFinancialAuditStorage({root:physical,frontendRoot,publication:codecPublication,outer,restore});
    equal(transportDescriptor(checked,{uiSha:publication.ui_sha,uiDigest:publication.ui_digest}),publication.transport,'complete logical/physical inventories');
    if(inventoryDigest(hashes(Object.fromEntries(Object.entries(checked.logicalInventory).filter(([path])=>!isData(path)))))!==publication.ui_digest)throw Error('Renewal transport changed approved UI');
    if(sha256(readFileSync(join(physical,'static-data/manifest.json')))!==publication.data_manifest_sha256)throw Error('Renewal transport manifest changed');
    if(!readFileSync(bootstrapPath).equals(bootstrapBytes)||!readFileSync(transportPath).equals(sealed))throw Error('Renewal transport changed during verification');
    if(restore)writeFileSync(join(restore,'publication.json'),bootstrapBytes);
    return {transport:actual,publication,checked,restoreBudget,...(restore?{logicalRoot:restore}:{})};
  }catch(error){if(restore)rmSync(restore,{recursive:true,force:true});throw error;}
}

export async function verifyRenewalCandidateTransportAssets({root,candidate,record,dist,publication,allowedAdditions}){
  const {verifyCandidateTransport}=await import('./financial-release-activation.mjs');
  const before=await verifyCandidateTransport(root,candidate,record);
  if(before.transport.schema_version!==RENEWAL_CANDIDATE_TRANSPORT_SCHEMA)return verifyRenewalTransportAssets({candidateRoot:join(candidate,'corrected'),root:dist,frontendRoot:join(root,'frontend'),candidatePublication:before.publication,publication,allowedAdditions});
  const after=await verifyTransportPublication({root:dist,frontendRoot:join(root,'frontend'),publication});
  if(!after?.auditTransport)throw Error('Sealed renewal audit preview cannot drop its nested transport');
  const originals=hashes(before.checked.logicalInventory),final=hashes(after.logicalInventory),allowed=new Set(allowedAdditions);
  if(!Array.isArray(allowedAdditions)||allowedAdditions.some(path=>!/^static-data\/financial-corrections\/(?:source-projection|source-base|carry-projection|release|renewal)-[a-f0-9]{64}\.json$/.test(path)))throw Error('Invalid renewal audit additions');
  for(const [path,hash]of Object.entries(final))if(!Object.hasOwn(originals,path)&&allowed.has(path)){
    if(!path.endsWith(`-${hash}.json`))throw Error('Renewal audit addition is not hash-bound');
    delete final[path];
  }
  equal(originals,final,'captured logical files');
  const encoded=files=>hashes(Object.fromEntries(Object.entries(files).filter(([path])=>path.startsWith('static-data/_transport/gzip/'))));
  const originalEncoded=encoded(before.checked.physicalInventory),finalEncoded=encoded(after.physicalInventory);
  equal(originalEncoded,finalEncoded,'captured outer encoded payloads');
  const originalAudit=encoded(before.checked.auditTransport.physicalInventory),finalAudit=encoded(after.auditTransport.physicalInventory);
  for(const [path,hash]of Object.entries(originalAudit))if(finalAudit[path]!==hash)throw Error('Renewal changed a captured encoded audit payload');
  return {logical_inventory_sha256:inventoryDigest(originals),encoded_payload_inventory_sha256:inventoryDigest(originalEncoded),encoded_audit_inventory_sha256:inventoryDigest(originalAudit)};
}
