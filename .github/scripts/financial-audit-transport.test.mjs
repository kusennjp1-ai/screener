import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,truncateSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {AUDIT_TRANSPORT_PREFIX,auditInternalPath,financialAuditReader,financialAuditRestoreBudget} from './financial-audit-transport.mjs';
import {financialAuditInventory,FINANCIAL_AUDIT_MAX_BYTES,FINANCIAL_AUDIT_MAX_FILE_BYTES} from './financial-audit-history.mjs';
import {canonicalPublication,packPublication,previewPublication,transportDescriptor,verifyCapturedTransportAssets,verifyTransportPublication} from './static-transport-publication.mjs';
import {dataInventory} from './financial-correction.mjs';
import {inventoryDigest,sha256,uiInventory} from './publication-state.mjs';
import {createStaticTransport} from '../../frontend/src/static/transport/index.mjs';
import {canonicalBytes,DEFAULT_LIMITS,generationBody,validateShard} from '../../frontend/src/static/transport/format.mjs';
import {pack} from '../../frontend/tools/static-transport/pack.mjs';
import {verify} from '../../frontend/tools/static-transport/verify.mjs';

const frontend=fileURLToPath(new URL('../../frontend',import.meta.url)),controller=fileURLToPath(new URL('.',import.meta.url));
const H='a'.repeat(64),S='b'.repeat(40),write=(root,path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};
const read=path=>JSON.parse(readFileSync(path));
const bindings={sourceCommit:S,appCommit:S,candidateId:H};

async function fixture(t,{compress=true}={}){
  const temp=mkdtempSync(join(tmpdir(),'financial-audit-codec-')),root=join(temp,'site'),candidate=join(temp,'candidate');
  t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const originals={'index.html':'exact captured HTML','sw.js':'exact captured worker',
    'static-transport-capability.json':readFileSync(join(frontend,'public/static-transport-capability.json')),
    'static-data/manifest.json':'{"generation":"original"}\n'};
  // One app chart in every bucket makes audit metadata/chart shard collisions
  // unavoidable, including under the unchanged captured browser validator.
  const buckets=new Set();
  for(let i=0;buckets.size<256;i++){
    const path=`static-data/markets/us/charts/S${i}.json`,id=sha256(path).slice(0,2);
    if(!buckets.has(id)){buckets.add(id);originals[path]=' {"n":1.000,"v":-0,"original_at":"2026-10-02"}\n';}
  }
  for(const [path,bytes]of Object.entries(originals))write(root,path,bytes);
  const ui=uiInventory(root),common={ui_sha:S,ui_digest:inventoryDigest(ui),data_manifest_sha256:sha256(originals['static-data/manifest.json'])};
  cpSync(root,candidate,{recursive:true});
  const candidatePublication=previewPublication({uiSha:S,uiDigest:common.ui_digest,manifestSha256:common.data_manifest_sha256});
  await packPublication({root:candidate,frontendRoot:frontend,publication:candidatePublication,bindings});
  const audit={};
  for(const [kind,bytes]of Object.entries({'source-projection':' {"source":1.000,"original_at":"2026-10-02"}\n','source-base':'{"rows":[1,null,-0]}','carry-projection':'{"previous":"R0","evaluation":"C1","source_at":"2026-10-02"}','release':'{"mode":"opaque-test-envelope"}'})){
    const hash=sha256(bytes),path=`static-data/financial-corrections/${kind}-${hash}.json`;
    audit[path]=hash;originals[path]=bytes;write(root,path,bytes);
  }
  const release=Object.keys(audit).find(path=>path.includes('/release-'));
  const publication={schema:1,...common,financial_release:{schema_version:'financial-release-receipt-v1',path:release,sha256:audit[release]},financial_audit_files:audit,
    financial_generation:H,financial_lineage_sha256:H,data_inventory_sha256:inventoryDigest(dataInventory(root))};
  await packPublication({root,frontendRoot:frontend,publication,bindings,compressFinancialAudit:compress,preserveLogical:join(temp,'original')});
  const fetcher=async url=>{const path=new URL(url).pathname.split('/screener/')[1];return existsSync(join(root,path))?new Response(readFileSync(join(root,path))):new Response(null,{status:404});};
  return {temp,root,originals,audit,publication,candidate,candidatePublication,fetcher};
}

test('nested audit codec preserves all original bytes, dual inventories, captured gzip and all 256 browser shards',async t=>{
  const f=await fixture(t),p=f.publication;
  assert.notEqual(p.financial_audit_transport.storage_data_inventory_sha256,p.data_inventory_sha256);
  assert.equal(p.transport.logical_data_inventory_sha256,p.data_inventory_sha256);
  const checked=await verifyTransportPublication({root:f.root,frontendRoot:frontend,publication:p});
  assert.equal(checked.auditTransport.compressedFiles,3);
  assert.equal(checked.restoreBudget.canonicalBytes,Object.values(f.originals).reduce((sum,bytes)=>sum+Buffer.byteLength(bytes),0)+readFileSync(join(f.root,'publication.json')).length);
  assert.equal(checked.restoreBudget.canonicalFiles,Object.keys(f.originals).length+1);
  const root=read(join(f.root,p.transport.root.path));let mixed=0;
  for(const descriptor of root.shards){
    const shard=read(join(f.root,descriptor.path));await validateShard(shard,descriptor.id);
    if(shard.files.some(entry=>entry.kind==='gzip')&&shard.files.some(entry=>entry.path.startsWith(AUDIT_TRANSPORT_PREFIX)))mixed++;
    for(const entry of shard.files)if(entry.path.startsWith(AUDIT_TRANSPORT_PREFIX))assert.equal(entry.kind,'identity');
  }
  assert.ok(mixed>100,'existing app reads collide with nested audit identity metadata in many buckets');
  const browser=await createStaticTransport({baseURL:'https://example.test/screener/',expectedRoot:p.transport.root,fetchImpl:f.fetcher});
  try{for(const [path,bytes]of Object.entries(f.originals))if(path.includes('/charts/'))assert.deepEqual(Buffer.from(await browser.readBytes(path)),Buffer.from(bytes));}finally{browser.dispose();}
  await verifyCapturedTransportAssets({candidateRoot:f.candidate,root:f.root,frontendRoot:frontend,candidatePublication:f.candidatePublication,publication:p,allowedAdditions:Object.keys(f.audit)});
  await assert.rejects(()=>verifyCapturedTransportAssets({candidateRoot:f.candidate,root:f.root,frontendRoot:frontend,candidatePublication:f.candidatePublication,publication:p}),/original logical/);
  const restored=await canonicalPublication({root:f.root,frontendRoot:frontend,publication:p,restore:join(f.temp,'restored')});
  for(const [path,bytes]of Object.entries(f.originals))assert.deepEqual(readFileSync(join(restored,path)),Buffer.from(bytes),path);
  assert.equal(existsSync(join(restored,AUDIT_TRANSPORT_PREFIX)),false);
  assert.deepEqual(financialAuditInventory(restored),f.audit);
  assert.equal(inventoryDigest(dataInventory(restored)),p.data_inventory_sha256);
  const reader=await financialAuditReader({publication:p,fetcher:f.fetcher});
  try{
    for(const [path,hash]of Object.entries(f.audit))if(!path.includes('/release-'))assert.deepEqual(await reader.read(path,hash),Buffer.from(f.originals[path]));
    await assert.rejects(()=>reader.read('static-data/research-details/arbitrary.json',H),/Unapproved/);
    await assert.rejects(()=>reader.read(Object.keys(f.audit)[0],H),/Unapproved/);
  }finally{reader.dispose();}
  const payload=JSON.parse(execFileSync('python3',[join(controller,'check-pages-payload.py'),f.root],{encoding:'utf8'}));
  assert.ok(payload.file_bytes<1_000_000_000&&payload.tar_bytes<1_000_000_000);
});

test('identity audit publications remain readable without a nested descriptor',async t=>{
  const f=await fixture(t,{compress:false});assert.equal(f.publication.financial_audit_transport,undefined);
  await verifyTransportPublication({root:f.root,frontendRoot:frontend,publication:f.publication});
  for(const path of Object.keys(f.audit))assert.deepEqual(readFileSync(join(f.root,path)),Buffer.from(f.originals[path]));
});

test('nested audit rejects tampering, wrong roots, decoded bounds, unknown paths and unbound inventories',async t=>{
  const f=await fixture(t),p=f.publication,descriptor=p.financial_audit_transport;
  const wrong=structuredClone(p);wrong.financial_audit_transport.root.generation='f'.repeat(64);
  await assert.rejects(()=>financialAuditReader({publication:wrong,fetcher:f.fetcher}),/generation/);
  const storage=structuredClone(p);storage.financial_audit_transport.storage_data_inventory_sha256='f'.repeat(64);
  write(f.root,'publication.json',JSON.stringify(storage));
  await assert.rejects(()=>verifyTransportPublication({root:f.root,frontendRoot:frontend,publication:storage}),/storage inventory/);
  write(f.root,'publication.json',JSON.stringify(p));
  const path=Object.keys(f.audit)[0],internal=auditInternalPath(path,f.audit[path]);
  const root=read(join(f.root,AUDIT_TRANSPORT_PREFIX,descriptor.root.path));
  const position=parseInt(sha256(internal).slice(0,2),16),shard=read(join(f.root,AUDIT_TRANSPORT_PREFIX,root.shards[position].path));
  const entry=shard.files.find(value=>value.path===internal),asset=join(f.root,AUDIT_TRANSPORT_PREFIX,entry.assetPath),original=readFileSync(asset);
  const corrupt=Buffer.from(original);corrupt[10]^=1;writeFileSync(asset,corrupt);
  const reader=await financialAuditReader({publication:p,fetcher:f.fetcher});
  try{await assert.rejects(()=>reader.read(path,f.audit[path]),/SHA-256/);}finally{reader.dispose();}
  await assert.rejects(()=>verifyTransportPublication({root:f.root,frontendRoot:frontend,publication:p}),/integrity/);
  writeFileSync(asset,original);
  const originalDecodedBytes=entry.decodedBytes;
  for(const limit of ['decodedBytes','encodedBytes']){
  entry.decodedBytes=originalDecodedBytes;entry.encodedBytes=original.length;entry[limit]=DEFAULT_LIMITS[limit]+1;
  const shardBytes=canonicalBytes(shard),shardSha=sha256(shardBytes);
  root.shards[position]={id:root.shards[position].id,path:`static-data/_transport/shard-${shardSha}.json`,bytes:shardBytes.length,sha256:shardSha};
  root.generation=sha256(canonicalBytes(generationBody(root)));
  const rootBytes=canonicalBytes(root),rootSha=sha256(rootBytes),bounded=structuredClone(p);
  bounded.financial_audit_transport.root={path:`static-data/_transport/root-${rootSha}.json`,bytes:rootBytes.length,sha256:rootSha,generation:root.generation,bindings:root.bindings};
  const overlays=new Map([[AUDIT_TRANSPORT_PREFIX+root.shards[position].path,shardBytes],[AUDIT_TRANSPORT_PREFIX+bounded.financial_audit_transport.root.path,rootBytes]]);
  const boundedReader=await financialAuditReader({publication:bounded,fetcher:async url=>{const resource=new URL(url).pathname.split('/screener/')[1];return overlays.has(resource)?new Response(overlays.get(resource)):f.fetcher(url);}});
  try{await assert.rejects(()=>boundedReader.read(path,f.audit[path]),new RegExp(`${limit} cap`));}finally{boundedReader.dispose();}
  }
  write(f.root,AUDIT_TRANSPORT_PREFIX+'unknown.json','{}');
  await assert.rejects(()=>verifyTransportPublication({root:f.root,frontendRoot:frontend,publication:p}),/unknown or missing/);
  assert.throws(()=>auditInternalPath('static-data/financial-corrections/unknown-'+H+'.json',H),/Unapproved/);
  assert.equal(FINANCIAL_AUDIT_MAX_BYTES,8*1024**3);assert.equal(FINANCIAL_AUDIT_MAX_FILE_BYTES,DEFAULT_LIMITS.decodedBytes);
  const huge=join(f.temp,'original',path);truncateSync(huge,DEFAULT_LIMITS.decodedBytes+1);
  assert.throws(()=>financialAuditInventory(join(f.temp,'original')),/decoded transport cap/);
});

test('the full archive cap includes separately written publication bytes even at codec equality',async t=>{
  const f=await fixture(t),publication=structuredClone(f.publication);
  const root=read(join(f.root,publication.transport.root.path)),logical=read(join(f.root,root.logicalInventory.path));
  // Every individual declaration is within 128 MiB. The full canonical tree,
  // including ordinary app data, must still fail before any restore is created.
  const before=financialAuditRestoreBudget({root:f.root,publication});
  let remaining=FINANCIAL_AUDIT_MAX_BYTES-(before.canonicalBytes-before.publicationBytes);
  for(let i=0;remaining>0;i++){
    const bytes=Math.min(remaining,DEFAULT_LIMITS.decodedBytes);remaining-=bytes;
    logical.files[`static-data/research-details/budget-${i}.json`]={bytes,sha256:H};
  }
  const logicalBytes=canonicalBytes(logical),logicalHash=sha256(logicalBytes);
  root.logicalInventory={path:`static-data/_transport/logical-${logicalHash}.json`,bytes:logicalBytes.length,sha256:logicalHash};
  write(f.root,root.logicalInventory.path,logicalBytes);
  root.generation=sha256(canonicalBytes(generationBody(root)));
  const rootBytes=canonicalBytes(root),rootHash=sha256(rootBytes);
  publication.transport.root={path:`static-data/_transport/root-${rootHash}.json`,bytes:rootBytes.length,sha256:rootHash,generation:root.generation,bindings:root.bindings};
  write(f.root,publication.transport.root.path,rootBytes);write(f.root,'publication.json',JSON.stringify(publication));
  const destination=join(f.temp,'rejected-restore');
  assert.throws(()=>financialAuditRestoreBudget({root:f.root,publication,restore:destination}),/existing archive bounds/);
  await assert.rejects(()=>canonicalPublication({root:f.root,frontendRoot:frontend,publication,restore:destination}),/existing archive bounds/);
  assert.equal(existsSync(destination),false);
});

test('self-consistent rebuilt codec layers cannot authorize extra, missing or duplicate logical audits',async t=>{
  const f=await fixture(t),bound=f.publication.transport.root.bindings;
  const first=Object.keys(f.audit)[0],internal=auditInternalPath(first,f.audit[first]);
  for(const attack of ['unknown logical path','missing declared audit','raw and compressed duplicate']){
    const dir=join(f.temp,attack.replaceAll(' ','-')),storage=join(dir,'storage');mkdirSync(dir);
    await verify({packed:f.root,expectedRoot:f.publication.transport.root,restore:storage});
    const publication=structuredClone(f.publication);
    if(attack==='raw and compressed duplicate')write(storage,first,f.originals[first]);
    else{
      const nestedRoot=join(storage,AUDIT_TRANSPORT_PREFIX),inner=join(dir,'inner'),changed=join(dir,'changed');
      await verify({packed:nestedRoot,expectedRoot:publication.financial_audit_transport.root,restore:inner});
      if(attack==='unknown logical path')write(inner,'static-data/research-details/unauthorized.json','{"injected":true}');
      else rmSync(join(inner,internal));
      const nested=await pack({source:inner,output:changed,bindings:bound});
      rmSync(nestedRoot,{recursive:true});renameSync(changed,nestedRoot);
      publication.financial_audit_transport.root=nested.expectedRoot;
    }
    const packedRoot=join(dir,'packed'),outer=await pack({source:storage,output:packedRoot,bindings:bound});
    const descriptor=transportDescriptor(outer,{uiSha:publication.ui_sha,uiDigest:publication.ui_digest});
    publication.financial_audit_transport.storage_data_inventory_sha256=descriptor.logical_data_inventory_sha256;
    publication.transport={...descriptor,logical_data_inventory_sha256:publication.data_inventory_sha256};
    write(packedRoot,'publication.json',JSON.stringify(publication));
    await assert.rejects(()=>verifyTransportPublication({root:packedRoot,frontendRoot:frontend,publication}),
      attack==='unknown logical path'?/unknown logical paths/:attack==='missing declared audit'?/logical source hash/:/duplicate raw and compressed/);
  }
});
