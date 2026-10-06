import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {sha256,inventoryDigest,uiInventory,validateReceipt} from './publication-state.mjs';
import {dataInventory} from './financial-correction.mjs';
import {completeInventory,validateCandidateRecord} from './financial-release-activation.mjs';
import {assertTransportDeclaration,canonicalPublication,packPublication,previewPublication,transportCapable,validateTransportDescriptor,validateTransportPreview,verifyTransportPublication,verifyCapturedTransportAssets} from './static-transport-publication.mjs';
const frontend=fileURLToPath(new URL('../../frontend',import.meta.url));
const S='1'.repeat(40),C='2'.repeat(40),H='a'.repeat(64);
const write=(root,path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};

function fixture(t) {
  const temp=mkdtempSync(join(tmpdir(),'publication-transport-')),root=join(temp,'site');mkdirSync(root);
  t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const originals={
    'index.html':'<!doctype html><title>exact approved decoder</title>', 'sw.js':'// approved cache policy',
    'static-transport-capability.json':readFileSync(join(frontend,'public/static-transport-capability.json')),
    'static-data/manifest.json':'{"as_of_date":"2026-10-02","markets":{"US":{"as_of_date":"2026-10-02"}}}',
    'static-data/markets/us/charts/OWNED.json':' {"symbol":"OWNED","bars":[{"date":"2026-10-02","open":1,"close":2,"volume":20}],"optional":null,"observed_at":"2026-10-01T10:46:54.945Z"}\n',
    'static-data/markets/us/charts/index.json':'{"symbols":["OWNED"]}',
    'static-data/research-details/OWNED-123456789abcdef0.json':'{"unknown_future_field":{"nested":[false,null,1.000]}}\n',
    'static-data/markets/us/scan/chunks/chunk-0001.json':'{"rows":[{"symbol":"OWNED","currency":"JPY"}]}',
    'static-data/verified-charts/OWNED.json':'{"verified":"keep raw"}',
    'static-data/candidate-history/history.json':'{"retained":"original history"}',
    'static-data/financial-corrections/source-base-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json':'{"source":"original financial bytes"}',
    'research-daily.json':'{"prices":"original bytes"}',
  };
  for(const [path,bytes]of Object.entries(originals))write(root,path,bytes);
  const ui=uiInventory(root),publication=previewPublication({uiSha:S,uiDigest:inventoryDigest(ui),manifestSha256:sha256(originals['static-data/manifest.json'])});
  const logical=inventoryDigest(dataInventory(root));
  const pack=()=>packPublication({root,frontendRoot:frontend,publication,bindings:{sourceCommit:C,appCommit:S,candidateId:H},preserveLogical:join(temp,'original')});
  return {temp,root,originals,publication,logical,pack};
}

test('packed publication pins distinct logical and complete physical inventories and exact original bytes',async t=>{
  const f=fixture(t),descriptor=await f.pack();
  assert.equal(descriptor.logical_data_inventory_sha256,f.logical);
  assert.notEqual(descriptor.physical_inventory_sha256,f.logical);
  assert.equal(descriptor.root.bindings.sourceCommit,C);assert.equal(descriptor.root.bindings.appCommit,S);
  assert.equal(validateTransportPreview(f.publication),f.publication);
  assert.throws(()=>validateReceipt(f.publication),/receipt|price|universe/i,'preview transport grants no publication authority');
  assert.equal(existsSync(join(f.root,'static-data/markets/us/charts/OWNED.json')),false);
  for(const path of ['static-data/markets/us/charts/index.json','static-data/verified-charts/OWNED.json','static-data/candidate-history/history.json'])assert.deepEqual(readFileSync(join(f.root,path)),Buffer.from(f.originals[path]));
  const restored=await canonicalPublication({root:f.root,frontendRoot:frontend,publication:f.publication,restore:join(f.temp,'restored')});
  for(const [path,bytes]of Object.entries(f.originals))assert.deepEqual(readFileSync(join(restored,path)),Buffer.from(bytes),path);
  assert.equal(inventoryDigest(dataInventory(restored)),f.logical);
  const physical=completeInventory(f.root);delete physical['publication.json'];
  assert.equal(inventoryDigest(physical),descriptor.physical_inventory_sha256);
});

test('legacy raw tree is unchanged; undeclared/missing/malformed packed metadata fails closed',async t=>{
  const f=fixture(t),before=completeInventory(f.root);
  assert.equal(await canonicalPublication({root:f.root,frontendRoot:frontend,publication:null}),f.root);
  assert.deepEqual(completeInventory(f.root),before);
  await f.pack();
  assert.throws(()=>assertTransportDeclaration(f.root,null),/missing or undeclared/);
  assert.throws(()=>assertTransportDeclaration(f.root,{transport:null}),/descriptor/);
  const changed=structuredClone(f.publication);delete changed.transport.root.generation;
  assert.throws(()=>validateTransportPreview(changed),/root reference/);
  const moved=join(f.temp,'missing');cpSync(f.root,moved,{recursive:true});rmSync(join(moved,'static-data/_transport'),{recursive:true});
  await assert.rejects(()=>canonicalPublication({root:moved,frontendRoot:frontend,publication:f.publication,restore:join(f.temp,'bad')}),/missing or undeclared/);
});

for(const [name,mutate]of Object.entries({
  'wrong generation':(f,p)=>{p.transport.root.generation='b'.repeat(64);},
  'wrong root hash':(f,p)=>{p.transport.root.sha256='b'.repeat(64);},
  'wrong approved decoder':(f,p)=>{p.transport.ui_sha=C;},
  'partial physical inventory':(f,p)=>{p.transport.physical_inventory_sha256='b'.repeat(64);},
  'extra logical file':f=>write(f.root,'static-data/extra.json','{}'),
  'omitted logical file':f=>rmSync(join(f.root,'static-data/candidate-history/history.json')),
  'changed logical data digest':(f,p)=>{p.transport.logical_data_inventory_sha256='b'.repeat(64);},
  'truncated gzip':f=>{const path=Object.keys(completeInventory(f.root)).find(path=>path.includes('/gzip/'));const bytes=readFileSync(join(f.root,path));writeFileSync(join(f.root,path),bytes.subarray(0,bytes.length-4));},
  'changed source clock':f=>write(f.root,'static-data/financial-corrections/source-base-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json','{"observed_at":"2099-01-01"}'),
}))test(`transport refuses ${name} before financial or price validation`,async t=>{
  const f=fixture(t);await f.pack();const publication=structuredClone(f.publication);mutate(f,publication);
  await assert.rejects(()=>verifyTransportPublication({root:f.root,frontendRoot:frontend,publication}));
});

test('transport descriptor is closed and a packed candidate requires a new v2 capture binding',async t=>{
  const f=fixture(t);await f.pack();
  for(const mutate of [v=>v.approved=true,v=>v.root.bindings.controller='anything',v=>v.root.path='static-data/_transport/root.json',v=>v.root.bindings.candidateId='latest']){
    const descriptor=structuredClone(f.publication.transport);mutate(descriptor);assert.throws(()=>validateTransportDescriptor(descriptor));
  }
  const record={schema_version:'financial-release-candidate-v2',producer:{repository:'kusennjp1-ai/screener',workflow:'.github/workflows/design-acceptance.yml',head_sha:S,run_id:1,run_attempt:1},captured_ui:{sha:S,tree:C,digest:H},request_sha256:H,preview_receipt_sha256:H,corrected_inventory_sha256:H,protected_code_sha256:H,transport_sha256:H};
  assert.equal(validateCandidateRecord(record),record);
  const missing={...record};delete missing.transport_sha256;assert.throws(()=>validateCandidateRecord(missing));
  assert.throws(()=>validateCandidateRecord({...record,schema_version:'financial-release-candidate-v1'}));
  rmSync(join(f.root,'static-transport-capability.json'));assert.equal(transportCapable(f.root),false);
  await assert.rejects(()=>verifyTransportPublication({root:f.root,frontendRoot:frontend,publication:f.publication}),/approved decoder UI/);
});

test('final receipt metadata may change while every captured logical and encoded original stays exact',async t=>{
  const f=fixture(t);await f.pack();
  const final=join(f.temp,'final');cpSync(join(f.temp,'original'),final,{recursive:true});
  const additionBytes='{"mode":"activation"}',addition=`static-data/financial-corrections/release-${sha256(additionBytes)}.json`;write(final,addition,additionBytes);
  const publication=previewPublication({uiSha:S,uiDigest:f.publication.ui_digest,manifestSha256:f.publication.data_manifest_sha256});
  await packPublication({root:final,frontendRoot:frontend,publication,bindings:{sourceCommit:C,appCommit:S,candidateId:'b'.repeat(64)}});
  assert.notEqual(publication.transport.root.generation,f.publication.transport.root.generation);
  const result=await verifyCapturedTransportAssets({candidateRoot:f.root,root:final,frontendRoot:frontend,candidatePublication:f.publication,publication,allowedAdditions:[addition]});
  assert.match(result.encoded_payload_inventory_sha256,/^[a-f0-9]{64}$/);
  await assert.rejects(()=>verifyCapturedTransportAssets({candidateRoot:f.root,root:final,frontendRoot:frontend,candidatePublication:f.publication,publication}),/original logical files/);
  await assert.rejects(()=>verifyCapturedTransportAssets({candidateRoot:f.root,root:final,frontendRoot:frontend,candidatePublication:f.publication,publication,allowedAdditions:['static-data/extra.json']}),/audit additions/);
});
