import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,linkSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sha256} from './publication-state.mjs';
import {digest} from './financial-correction.mjs';
import {NATIVE_PROJECTOR_PATH} from './financial-candidate-preview-v2.mjs';
import {renewalPolicy} from './financial-source-renewal.mjs';
import {runtimeIdentity,writeSealedCheckpoint,verifySealedCheckpoint,restoreCheckpointController,releaseConsumedCandidateTar,writePublicationCheckpoint,verifyPublicationCheckpoint,restorePublicationController} from './fixtures/postcapture-rehearsal-checkpoint.mjs';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const write=(path,value)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));};
const read=path=>JSON.parse(readFileSync(path));
const commit=root=>{git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','test');return git(root,'rev-parse','HEAD');};
function copyFixtureRuntime(root,runtime,name){const checkout=join(root,name);git(root,'clone','--no-hardlinks',runtime,checkout);git(checkout,'rm','backend/outside-fixture.txt');commit(checkout);return checkout;}
function makeFixture(t){
  const root=mkdtempSync(join(tmpdir(),'postcapture-checkpoint-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const runtime=join(root,'runtime');mkdirSync(runtime);git(runtime,'init','-b','main');write(join(runtime,'frontend/package-lock.json'),'{}');write(join(runtime,NATIVE_PROJECTOR_PATH),'# test');write(join(runtime,'contracts/financial_source_postcapture_trust_v1.json'),{reviewed_requests:[]});write(join(runtime,'.github/scripts/fixtures/postcapture-reviewed-entry.json'),{exact:'review'});write(join(runtime,'backend/outside-fixture.txt'),'not copied by real fixture');commit(runtime);
  const checkout=copyFixtureRuntime(root,runtime,'controller');
  const target=join(root,'target.json');write(target,{rows:Array.from({length:5901},(_,i)=>({symbol:`S${i}`}))});
  const evaluatedAt=new Date(Date.now()-10000).toISOString(),request={target:{evaluated_at:evaluatedAt,base_sha256:sha256(readFileSync(target))}};write(join(checkout,renewalPolicy.request_path),request);
  write(join(checkout,'contracts/financial_source_postcapture_trust_v1.json'),{reviewed_requests:[{exact:'review'}]});
  const a=commit(checkout),candidate=join(root,'candidate');mkdirSync(candidate);
  const record={producer:{head_sha:a},renewal_request_sha256:digest(request),source_base_sha256:request.target.base_sha256,source_projection_sha256:'1'.repeat(64),receipt_inventory_sha256:'2'.repeat(64),source_delta_sha256:'3'.repeat(64),financial_generation:'4'.repeat(64),sealed_at:new Date(Date.now()-1000).toISOString()};write(join(candidate,'candidate.json'),record);
  const zip=join(root,'sealed.zip');write(zip,'exact archive test bytes');const actualInputs={pages:{artifact_sha256:'5'.repeat(64)}},syntheticApi={'synthetic-ci':{head:a,time:evaluatedAt}};
  const result=writeSealedCheckpoint({directory:join(root,'checkpoint'),runtimeRoot:runtime,checkout,zip,candidate,target,actualInputs,sourceReport:{exact:true},syntheticApi});
  const options={directory:result.directory,checkpointSha256:result.sha256,runtimeRoot:runtime,actualInputs};return {root,runtime,checkout,target,zip,candidate,record,request,a,actualInputs,syntheticApi,result,options};
}

test('sealed checkpoint moves exact bytes once and restores original A and CI without a new evaluation',t=>{
  const f=makeFixture(t);assert.equal(existsSync(f.zip),false);const m=verifySealedCheckpoint(f.options);assert.equal(m.evaluated_at,f.request.target.evaluated_at);assert.equal(m.source_base_sha256,f.request.target.base_sha256);
  const next=copyFixtureRuntime(f.root,f.runtime,'next');const fixture={checkout:next,api:{},setHead(value){this.head=value;}};
  restoreCheckpointController({directory:f.result.directory,manifest:m,fixture,runtimeRoot:f.runtime});assert.equal(fixture.head,f.a);assert.deepEqual(fixture.api,f.syntheticApi);assert.equal(existsSync(join(next,renewalPolicy.pin_path)),false);assert.equal(existsSync(join(next,renewalPolicy.intent_path)),false);
});
test('checkpoint rejects altered ZIP, digest, evaluation, code/tree, lineage, omitted members and links',t=>{
  const f=makeFixture(t),root=f.result.directory,zip=join(root,'sealed-renewal.zip'),original=readFileSync(zip);
  write(zip,Buffer.concat([original,Buffer.from('x')]).toString());assert.throws(()=>verifySealedCheckpoint(f.options),/bytes changed/);writeFileSync(zip,original);
  assert.throws(()=>verifySealedCheckpoint({...f.options,checkpointSha256:'0'.repeat(64)}),/binding changed/);
  assert.throws(()=>verifySealedCheckpoint({...f.options,actualInputs:{}}),/lineage changed/);
  const path=join(root,'checkpoint.json'),bytes=readFileSync(path),m=read(path);m.evaluated_at=new Date(Date.now()+10000).toISOString();write(path,m);
  assert.throws(()=>verifySealedCheckpoint({...f.options,checkpointSha256:sha256(readFileSync(path))}));writeFileSync(path,bytes);
  write(join(f.runtime,NATIVE_PROJECTOR_PATH),'changed');assert.throws(()=>verifySealedCheckpoint(f.options),/runtime must be clean/);git(f.runtime,'restore','.');
  write(join(f.runtime,'extra.txt'),'new tree');commit(f.runtime);assert.throws(()=>verifySealedCheckpoint(f.options),/commit\/tree\/code changed/);git(f.runtime,'reset','--hard','HEAD~1');
  rmSync(zip);assert.throws(()=>verifySealedCheckpoint(f.options),/member inventory changed/);symlinkSync(f.candidate,zip);assert.throws(()=>verifySealedCheckpoint(f.options),/unsafe checkpoint member/);rmSync(zip);writeFileSync(zip,original);
  linkSync(zip,join(f.root,'hardlink'));assert.throws(()=>verifySealedCheckpoint(f.options),/unsafe checkpoint member/);rmSync(join(f.root,'hardlink'));
  write(join(root,'extra'),'unexpected');assert.throws(()=>verifySealedCheckpoint(f.options),/member inventory changed/);
});
test('renewal cleanup targets candidate.tar and keeps the exact artifact ZIP for later verification',t=>{
  const root=mkdtempSync(join(tmpdir(),'renewal-cleanup-'));t.after(()=>rmSync(root,{recursive:true,force:true}));write(join(root,'input/candidate.tar'),'unpacked');write(join(root,'input/artifact.zip'),'retain');
  releaseConsumedCandidateTar(root);releaseConsumedCandidateTar(root);assert.equal(existsSync(join(root,'input/candidate.tar')),false);assert.equal(readFileSync(join(root,'input/artifact.zip'),'utf8'),'retain');
  mkdirSync(join(root,'input/candidate.tar'));assert.throws(()=>releaseConsumedCandidateTar(root));
});
test('publication checkpoint binds carry to exact published bytes, source lineage and prior sealed checkpoint',t=>{
  const f=makeFixture(t),pages=join(f.root,'pages');mkdirSync(pages);write(join(pages,'publication.json'),'exact publication');const zip=join(f.root,'pages.zip');write(zip,'exact physical archive');
  const renewed={identity:'synthetic-renewal',financialRelease:{lineage_sha256:'a'.repeat(64),source_projection:{path:'projection',sha256:'b'.repeat(64)},source_base:{path:'target',sha256:f.request.target.base_sha256},evaluated_at:f.request.target.evaluated_at}};
  const fixture={checkout:f.checkout,head:f.a,liveRoot:pages};const c=writePublicationCheckpoint({directory:join(f.root,'publication-checkpoint'),runtimeRoot:f.runtime,fixture,zip,target:f.target,actualInputs:f.actualInputs,renewed,sealedCheckpointSha256:f.result.sha256,syntheticApi:f.syntheticApi});
  const options={directory:c.directory,checkpointSha256:c.sha256,runtimeRoot:f.runtime,actualInputs:f.actualInputs};const m=verifyPublicationCheckpoint(options);assert.equal(m.sealed_checkpoint_sha256,f.result.sha256);assert.equal(m.publication_sha256,sha256(readFileSync(join(pages,'publication.json'))));
  const next=copyFixtureRuntime(f.root,f.runtime,'carry');const nextFixture={checkout:next,api:{},setHead(value){this.head=value;}};restorePublicationController({directory:c.directory,manifest:m,fixture:nextFixture,runtimeRoot:f.runtime});assert.equal(nextFixture.head,f.a);assert.deepEqual(nextFixture.api,f.syntheticApi);
  write(join(c.directory,'synthetic-api.json'),{});assert.throws(()=>verifyPublicationCheckpoint(options),/bytes changed/);
});
