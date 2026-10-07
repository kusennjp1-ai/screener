import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {digest} from './financial-correction.mjs';
import {bootstrap,sha256} from './publication-state.mjs';
import {disabledRenewalRegistry} from './fixtures/financial-renewal-policy.mjs';
import {consumerCodeInventory,renewalControllerCodeInventory,renewalPolicy,renewalPolicyPath,
  reviewedMain135ConsumerTransition,validateRenewalRegistry,assertRenewalRegistryAppendOnly,verifyRenewalInitialCapturePolicy} from './financial-source-renewal.mjs';

const prefix=`repos/${bootstrap.repository}`,certifier='a'.repeat(40),capturedTree='b'.repeat(40);
const clone=structuredClone;
const content=value=>{const bytes=Buffer.from(JSON.stringify(value));return {type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')};};
const registry=entries=>({...disabledRenewalRegistry(),reviewed_consumer_transitions:entries});
const blob=bytes=>({mode:'100644',sha:createHash('sha1').update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest('hex')});

// GitHub identities and tree transport below are explicitly synthetic. The
// catalog contains real reviewed blob pairs; this unit fixture does not claim
// to recreate or rename the actual main135 Git commit or authenticate GitHub.
function fixture(){
  const entry=reviewedMain135ConsumerTransition(),api={},captured={
    'frontend/package-lock.json':blob('locked frontend'),
    'backend/app/scripts/export_native_annual_projection.py':blob('unchanged projector'),
  };
  for(const [path,change]of Object.entries(entry.changes))if(change.before)captured[path]=clone(change.before);
  const reviewed=clone(captured);for(const [path,change]of Object.entries(entry.changes))reviewed[path]=clone(change.after);
  const tree=(sha,files)=>({sha,truncated:false,tree:Object.entries(files).map(([path,value])=>({path,type:'blob',...value}))});
  api[`${prefix}/git/commits/${entry.captured_ui_sha}`]={sha:entry.captured_ui_sha,tree:{sha:capturedTree}};
  api[`${prefix}/git/trees/${capturedTree}?recursive=1`]=tree(capturedTree,captured);
  api[`${prefix}/git/commits/${entry.reviewed_sha}`]={sha:entry.reviewed_sha,tree:{sha:entry.reviewed_tree}};
  api[`${prefix}/git/trees/${entry.reviewed_tree}?recursive=1`]=tree(entry.reviewed_tree,reviewed);
  for(const revision of [entry.captured_ui_sha,certifier])api[`${prefix}/contents/contracts/financial_performance_exception_v2.json?ref=${revision}`]=content({enabled:false,capture:null});
  const registryEndpoint=`${prefix}/contents/${renewalPolicyPath}?ref=${certifier}`;
  api[registryEndpoint]=content(registry([entry]));
  const originBytes=Buffer.from(JSON.stringify({schema_version:'financial-release-receipt-v1',mode:'activation',ui:{approval:{type:'gates'}}}));
  const request={ui:{sha:entry.captured_ui_sha},origin_release:{sha256:sha256(originBytes)},consumer_code_sha256:digest(consumerCodeInventory(captured))};
  const calls=[],options={request,certificationSha:certifier,originBytes,api:endpoint=>{calls.push(endpoint);assert.ok(Object.hasOwn(api,endpoint),`Unexpected synthetic API: ${endpoint}`);return api[endpoint];}};
  return {entry,api,captured,reviewed,registryEndpoint,options,calls,verify:()=>verifyRenewalInitialCapturePolicy(options)};
}

test('reviewed main135 transition is finite, clone-only and rejected by an explicitly empty registry',()=>{
  assert.equal(validateRenewalRegistry(renewalPolicy),renewalPolicy);
  const entry=reviewedMain135ConsumerTransition();
  assert.equal(entry.reviewed_sha,'1356148aecb8dc03b01fda103d2dd416cce05db6');assert.equal(entry.reviewed_tree,'b39d5283d77c85cba454add980ea3c2c472232be');
  assert.equal(entry.captured_ui_sha,'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac');assert.equal(Object.keys(entry.changes).length,9);
  validateRenewalRegistry(registry([entry]));entry.changes['backend/app/config/settings.py'].after.sha='f'.repeat(40);
  assert.notDeepEqual(entry,reviewedMain135ConsumerTransition());
  const f=fixture();f.api[f.registryEndpoint]=content(registry([]));
  assert.throws(()=>f.verify().verifyConsumerCode(f.captured,f.reviewed),/published consumer policy/);
});

test('exact nine before/after pairs pass only after independent captured and reviewed Git inventory checks',()=>{
  const f=fixture(),verified=f.verify();
  assert.equal(verified.verifyConsumerCode(f.captured,f.reviewed),true);
  assert.notEqual(digest(consumerCodeInventory(f.reviewed)),f.options.request.consumer_code_sha256);
  for(const path of Object.keys(f.entry.changes)){
    assert.deepEqual(consumerCodeInventory(f.reviewed)[path],f.reviewed[path]);
    assert.deepEqual(renewalControllerCodeInventory(f.reviewed)[path],f.reviewed[path]);
  }
  for(const revision of [f.entry.captured_ui_sha,f.entry.reviewed_sha])assert.ok(f.calls.includes(`${prefix}/git/commits/${revision}`));
  assert.ok(f.calls.includes(`${prefix}/git/trees/${f.entry.reviewed_tree}?recursive=1`));
});

test('missing, altered, extra and duplicate registry pairs or transitions fail closed',()=>{
  const original=reviewedMain135ConsumerTransition(),path=Object.keys(original.changes)[0];
  const mutations=[entry=>delete entry.changes[path],entry=>entry.changes[path].before.sha='f'.repeat(40),entry=>entry.changes[path].after.sha='f'.repeat(40),
    entry=>entry.changes[path].after.mode='100755',entry=>entry.changes['backend/app/new.py']=entry.changes[path],entry=>entry.extra=true,
    entry=>entry.captured_ui_sha='f'.repeat(40),entry=>entry.reviewed_sha='f'.repeat(40),entry=>entry.reviewed_tree='f'.repeat(40)];
  for(const mutate of mutations){const entry=clone(original);mutate(entry);assert.throws(()=>validateRenewalRegistry(registry([entry])),/reviewed main135/);}
  for(const entries of [[original,original],null,{},[null]])assert.throws(()=>validateRenewalRegistry(registry(entries)));
  const missing=registry([]);delete missing.reviewed_consumer_transitions;assert.throws(()=>validateRenewalRegistry(missing),/closed/);
  assertRenewalRegistryAppendOnly(registry([]),registry([original]));
  assertRenewalRegistryAppendOnly(registry([original]),registry([original]));
  assert.throws(()=>assertRenewalRegistryAppendOnly(registry([original]),registry([])),/append-only prior consumer transition/);
});

test('every missing, reverted or one-byte later consumer pair is rejected; unknown paths remain protected',()=>{
  const f=fixture(),verified=f.verify();
  for(const [path,pair]of Object.entries(f.entry.changes)){
    const actual=readFileSync(new URL(`../../${path}`,import.meta.url));
    assert.deepEqual(blob(actual),pair.after,'the exact reviewed after blob is present in this checkout');
    const later=blob(Buffer.concat([actual,Buffer.from('\n')]));
    for(const mutate of [value=>delete value[path],value=>value[path]=pair.before,value=>value[path]=later]){
      const current=clone(f.reviewed);mutate(current);assert.throws(()=>verified.verifyConsumerCode(f.captured,current),/reviewed main135 consumer pair/);
    }
  }
  for(const path of ['backend/app/services/new_financial_math.py','frontend/tools/new.test.mjs','contracts/new_policy.json']){
    assert.throws(()=>verified.verifyConsumerCode(f.captured,{...f.reviewed,[path]:blob('unreviewed')}),/published consumer policy/);
  }
  const future=clone(f.reviewed);future['backend/app/scripts/export_native_annual_projection.py']=blob('unchanged projector\n');
  assert.throws(()=>verified.verifyConsumerCode(f.captured,future),/published consumer policy/);
});

test('replaced reviewed commit/tree, Git pair, capture, incomplete tree or future reviewed head cannot substitute',()=>{
  const cases=[
    f=>f.api[`${prefix}/git/commits/${f.entry.reviewed_sha}`].sha='f'.repeat(40),
    f=>f.api[`${prefix}/git/commits/${f.entry.reviewed_sha}`].tree.sha='f'.repeat(40),
    f=>f.api[`${prefix}/git/trees/${f.entry.reviewed_tree}?recursive=1`].tree.find(v=>v.path in f.entry.changes).sha='f'.repeat(40),
    f=>f.api[`${prefix}/git/trees/${capturedTree}?recursive=1`].tree.find(v=>v.path in f.entry.changes).sha='f'.repeat(40),
    f=>f.api[`${prefix}/git/trees/${f.entry.reviewed_tree}?recursive=1`].truncated=true,
    f=>f.api[`${prefix}/git/trees/${f.entry.reviewed_tree}?recursive=1`].tree.push({path:'backend/app/new.py',type:'blob',...blob('unreviewed')}),
    f=>f.options.request.ui.sha=certifier,
  ];
  for(const mutate of cases){const f=fixture();mutate(f);assert.throws(()=>f.verify());}
  const f=fixture(),future=clone(f.entry);future.reviewed_sha='f'.repeat(40);f.api[f.registryEndpoint]=content(registry([future]));
  assert.throws(()=>f.verify(),/reviewed main135/);
});

test('consumer transition depends on immutable certifier registry bytes and the retained origin, never current controls',()=>{
  const f=fixture();assert.equal(f.verify().verifyConsumerCode(f.captured,f.reviewed),true);
  assert.ok(f.calls.every(endpoint=>!endpoint.includes('git/ref/heads/main')&&!endpoint.includes(renewalPolicy.intent_path)));
  f.options.originBytes=Buffer.from('{}');assert.throws(()=>f.verify(),/exact retained anchor/);
});
