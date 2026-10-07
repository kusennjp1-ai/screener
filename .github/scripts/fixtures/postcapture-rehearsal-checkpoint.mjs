// Diagnostic continuation only: this manifest is an integrity binding, never a
// cached production verification. The consumer runs every real publisher check.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {closeSync,copyFileSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {digest} from '../financial-correction.mjs';
import {protectedCodeInventory} from '../financial-release-activation.mjs';
import {renewalControllerCodeInventory,renewalPolicy} from '../financial-source-renewal.mjs';

const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000}).trim();
const hash=path=>execFileSync('sha256sum',[path],{encoding:'utf8',timeout:180000}).split(' ')[0];
const members=['candidate.json','controller.bundle','synthetic-api.json','request-target-base.json','sealed-renewal.zip'];
const maxBytes={'candidate.json':2*1024**2,'controller.bundle':128*1024**2,'synthetic-api.json':32*1024**2,'request-target-base.json':64*1024**2,'sealed-renewal.zip':5*1024**3};
const read=path=>JSON.parse(readFileSync(path,'utf8'));
function assertRestoredCode(runtimeRoot,checkout,revision,baselineRevision){
  // The fresh fixture copies a fixed subset of runtime HEAD. Compare with that
  // independently rebuilt baseline, not unrelated backend files it omits.
  const expected=renewalControllerCodeInventory(protectedCodeInventory(checkout,baselineRevision));
  const trustPath='contracts/financial_source_postcapture_trust_v1.json',trust=read(join(runtimeRoot,trustPath));
  assert.deepEqual(trust.reviewed_requests,[]);trust.reviewed_requests.push(read(join(runtimeRoot,'.github/scripts/fixtures/postcapture-reviewed-entry.json')));
  const expectedBytes=JSON.stringify(trust);
  assert.equal(readFileSync(join(checkout,trustPath),'utf8'),expectedBytes,'checkpoint expanded original source trust');
  expected[trustPath]={...expected[trustPath],sha:execFileSync('git',['hash-object','--stdin'],{input:expectedBytes,encoding:'utf8'}).trim()};
  assert.deepEqual(renewalControllerCodeInventory(protectedCodeInventory(checkout,revision)),expected,'checkpoint executable inventory changed');
}
function file(path,limit){const s=lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size>0&&s.size<=limit,`unsafe checkpoint member ${path}`);return {bytes:s.size,sha256:hash(path)};}
function sync(path){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export function runtimeIdentity(root){
  assert.equal(git(root,'status','--porcelain','--untracked-files=no'),'','checkpoint runtime must be clean');
  const commit=git(root,'rev-parse','HEAD');return {commit,tree:git(root,'rev-parse','HEAD^{tree}'),protected_code_sha256:digest(renewalControllerCodeInventory(protectedCodeInventory(root,commit)))};
}
export function releaseConsumedCandidateTar(directory){rmSync(join(directory,'input/candidate.tar'),{force:true});}
export function writeSealedCheckpoint({directory,runtimeRoot,checkout,zip,candidate,target,actualInputs,sourceReport,syntheticApi}){
  const pending=resolve(directory)+'.pending';mkdirSync(pending);
  // Move the large ZIP once. Reports and the source TAR do not stand in for it.
  renameSync(zip,join(pending,'sealed-renewal.zip'));
  copyFileSync(join(candidate,'candidate.json'),join(pending,'candidate.json'));
  copyFileSync(target,join(pending,'request-target-base.json'));
  writeFileSync(join(pending,'synthetic-api.json'),JSON.stringify(syntheticApi)+'\n',{flag:'wx'});
  const certification={sha:git(checkout,'rev-parse','HEAD'),tree:git(checkout,'rev-parse','HEAD^{tree}')};
  git(checkout,'bundle','create',join(pending,'controller.bundle'),'HEAD');
  const record=read(join(pending,'candidate.json')),request=read(join(checkout,renewalPolicy.request_path));
  const files=Object.fromEntries(members.map(name=>[name,file(join(pending,name),maxBytes[name])]));
  assert.equal(files['request-target-base.json'].sha256,request.target.base_sha256);
  assert.equal(record.renewal_request_sha256,digest(request));
  assert.equal(record.producer.head_sha,certification.sha);
  assert.equal(record.source_base_sha256,request.target.base_sha256);
  assert.equal(read(join(pending,'request-target-base.json')).rows.length,5901);
  const manifest={schema_version:'postcapture-pages-sealed-checkpoint-v1',publication_authority:false,synthetic_future_authority:true,
    checkpoint_at:new Date().toISOString(),runtime:runtimeIdentity(runtimeRoot),certification,actual_inputs:actualInputs,files,
    evaluated_at:request.target.evaluated_at,sealed_at:record.sealed_at,request_sha256:digest(request),
    candidate_record_sha256:files['candidate.json'].sha256,source_projection_sha256:record.source_projection_sha256,
    source_base_sha256:record.source_base_sha256,receipt_inventory_sha256:record.receipt_inventory_sha256,
    source_delta_sha256:record.source_delta_sha256,financial_generation:record.financial_generation,
    request,source_report:sourceReport};
  const manifestPath=join(pending,'checkpoint.json');writeFileSync(manifestPath,JSON.stringify(manifest)+'\n',{flag:'wx'});
  for(const name of [...members,'checkpoint.json'])sync(join(pending,name));sync(pending);
  renameSync(pending,resolve(directory));sync(resolve(directory));sync(dirname(resolve(directory)));
  const checkpointSha256=hash(join(directory,'checkpoint.json'));
  verifySealedCheckpoint({directory,checkpointSha256,runtimeRoot,actualInputs});
  return {directory:resolve(directory),sha256:checkpointSha256,manifest};
}
export function verifySealedCheckpoint({directory,checkpointSha256,runtimeRoot,actualInputs}){
  assert.match(checkpointSha256||'',/^[a-f0-9]{64}$/,'explicit retained checkpoint SHA-256 required');
  const root=resolve(directory),s=lstatSync(root);assert.ok(s.isDirectory()&&!s.isSymbolicLink(),'unsafe checkpoint directory');
  assert.deepEqual(readdirSync(root).sort(),[...members,'checkpoint.json'].sort(),'checkpoint member inventory changed');
  const binding=file(join(root,'checkpoint.json'),32*1024**2);assert.equal(binding.sha256,checkpointSha256,'checkpoint binding changed');
  const manifest=read(join(root,'checkpoint.json'));
  assert.equal(manifest.schema_version,'postcapture-pages-sealed-checkpoint-v1');assert.equal(manifest.publication_authority,false);assert.equal(manifest.synthetic_future_authority,true);
  assert.deepEqual(manifest.runtime,runtimeIdentity(runtimeRoot),'checkpoint runtime commit/tree/code changed');
  assert.deepEqual(manifest.actual_inputs,actualInputs,'checkpoint original input lineage changed');
  assert.deepEqual(Object.keys(manifest.files).sort(),members.sort());
  for(const name of members)assert.deepEqual(file(join(root,name),maxBytes[name]),manifest.files[name],`checkpoint bytes changed: ${name}`);
  const record=read(join(root,'candidate.json')),request=manifest.request;
  assert.equal(record.producer.head_sha,manifest.certification.sha);
  assert.equal(digest(request),manifest.request_sha256);assert.equal(record.renewal_request_sha256,manifest.request_sha256);
  assert.equal(manifest.candidate_record_sha256,manifest.files['candidate.json'].sha256);
  for(const key of ['source_projection_sha256','source_base_sha256','receipt_inventory_sha256','source_delta_sha256','financial_generation','sealed_at'])assert.equal(manifest[key],record[key],`checkpoint ${key} changed`);
  assert.equal(manifest.evaluated_at,request.target.evaluated_at);assert.equal(manifest.source_base_sha256,request.target.base_sha256);
  assert.equal(manifest.files['request-target-base.json'].sha256,request.target.base_sha256);
  assert.equal(read(join(root,'request-target-base.json')).rows.length,5901);
  assert.ok(Date.parse(manifest.evaluated_at)<=Date.parse(manifest.sealed_at)&&Date.parse(manifest.sealed_at)<=Date.parse(manifest.checkpoint_at)&&Date.parse(manifest.checkpoint_at)<=Date.now(),'checkpoint clocks changed or are in the future');
  return manifest;
}
export function restoreCheckpointController({directory,manifest,fixture,runtimeRoot}){
  // Only local, hash-verified Git objects are imported. The restored executable
  // inventory must still equal the independently pinned current runtime.
  const baseline=git(fixture.checkout,'rev-parse','HEAD');
  git(fixture.checkout,'fetch','--no-tags',join(resolve(directory),'controller.bundle'),'HEAD');
  assert.equal(git(fixture.checkout,'rev-parse','FETCH_HEAD'),manifest.certification.sha,'checkpoint controller head changed');
  assert.equal(git(fixture.checkout,'rev-parse','FETCH_HEAD^{tree}'),manifest.certification.tree,'checkpoint controller tree changed');
  git(fixture.checkout,'checkout','--detach','FETCH_HEAD');fixture.setHead(manifest.certification.sha);
  assertRestoredCode(runtimeRoot,fixture.checkout,manifest.certification.sha,baseline);
  assert.equal(digest(read(join(fixture.checkout,renewalPolicy.request_path))),manifest.request_sha256);
  Object.assign(fixture.api,read(join(directory,'synthetic-api.json')));
  for(const path of [renewalPolicy.pin_path,renewalPolicy.intent_path])assert.equal(execFileSync('git',['-C',fixture.checkout,'ls-files','--',path],{encoding:'utf8'}).trim(),'','checkpoint must precede pin and intent');
}

const publicationMembers=['controller.bundle','synthetic-api.json','request-target-base.json','renewed-pages.zip'];
const publicationLimits={'controller.bundle':128*1024**2,'synthetic-api.json':32*1024**2,'request-target-base.json':64*1024**2,'renewed-pages.zip':5*1024**3};
export function writePublicationCheckpoint({directory,runtimeRoot,fixture,zip,target,actualInputs,renewed,sealedCheckpointSha256,syntheticApi}){
  const pending=resolve(directory)+'.pending';mkdirSync(pending);
  renameSync(zip,join(pending,'renewed-pages.zip'));
  copyFileSync(target,join(pending,'request-target-base.json'));
  writeFileSync(join(pending,'synthetic-api.json'),JSON.stringify(syntheticApi)+'\n',{flag:'wx'});
  git(fixture.checkout,'bundle','create',join(pending,'controller.bundle'),'HEAD');
  const manifest={schema_version:'postcapture-pages-publication-checkpoint-v1',publication_authority:false,synthetic_future_authority:true,
    checkpoint_at:new Date().toISOString(),runtime:runtimeIdentity(runtimeRoot),controller:{sha:fixture.head,tree:git(fixture.checkout,'rev-parse','HEAD^{tree}')},
    actual_inputs:actualInputs,sealed_checkpoint_sha256:sealedCheckpointSha256,
    renewed_identity:renewed.identity,publication_sha256:hash(join(fixture.liveRoot,'publication.json')),lineage_sha256:renewed.financialRelease.lineage_sha256,
    source_projection:renewed.financialRelease.source_projection,source_base:renewed.financialRelease.source_base,
    evaluated_at:renewed.financialRelease.evaluated_at,files:Object.fromEntries(publicationMembers.map(name=>[name,file(join(pending,name),publicationLimits[name])]))};
  assert.equal(manifest.files['request-target-base.json'].sha256,renewed.financialRelease.source_base.sha256);
  const path=join(pending,'checkpoint.json');writeFileSync(path,JSON.stringify(manifest)+'\n',{flag:'wx'});
  for(const name of [...publicationMembers,'checkpoint.json'])sync(join(pending,name));sync(pending);
  renameSync(pending,resolve(directory));sync(resolve(directory));sync(dirname(resolve(directory)));const checkpointSha256=hash(join(directory,'checkpoint.json'));
  verifyPublicationCheckpoint({directory,checkpointSha256,runtimeRoot,actualInputs});
  return {directory:resolve(directory),sha256:checkpointSha256,manifest};
}
export function verifyPublicationCheckpoint({directory,checkpointSha256,runtimeRoot,actualInputs}){
  assert.match(checkpointSha256||'',/^[a-f0-9]{64}$/,'explicit retained checkpoint SHA-256 required');
  const root=resolve(directory),s=lstatSync(root);assert.ok(s.isDirectory()&&!s.isSymbolicLink(),'unsafe checkpoint directory');
  assert.deepEqual(readdirSync(root).sort(),[...publicationMembers,'checkpoint.json'].sort(),'checkpoint member inventory changed');
  assert.equal(file(join(root,'checkpoint.json'),32*1024**2).sha256,checkpointSha256,'checkpoint binding changed');
  const manifest=read(join(root,'checkpoint.json'));
  assert.equal(manifest.schema_version,'postcapture-pages-publication-checkpoint-v1');assert.equal(manifest.publication_authority,false);assert.equal(manifest.synthetic_future_authority,true);
  assert.deepEqual(manifest.runtime,runtimeIdentity(runtimeRoot),'checkpoint runtime commit/tree/code changed');assert.deepEqual(manifest.actual_inputs,actualInputs,'checkpoint original input lineage changed');
  assert.deepEqual(Object.keys(manifest.files).sort(),publicationMembers.sort());
  for(const name of publicationMembers)assert.deepEqual(file(join(root,name),publicationLimits[name]),manifest.files[name],`checkpoint bytes changed: ${name}`);
  assert.match(manifest.sealed_checkpoint_sha256||'',/^[a-f0-9]{64}$/,'missing sealed checkpoint lineage');
  assert.equal(manifest.files['request-target-base.json'].sha256,manifest.source_base.sha256);assert.equal(read(join(root,'request-target-base.json')).rows.length,5901);
  assert.ok(Date.parse(manifest.evaluated_at)<=Date.parse(manifest.checkpoint_at)&&Date.parse(manifest.checkpoint_at)<=Date.now(),'checkpoint clocks changed or are in the future');
  return manifest;
}
export function restorePublicationController({directory,manifest,fixture,runtimeRoot}){
  const baseline=git(fixture.checkout,'rev-parse','HEAD');
  git(fixture.checkout,'fetch','--no-tags',join(resolve(directory),'controller.bundle'),'HEAD');
  assert.equal(git(fixture.checkout,'rev-parse','FETCH_HEAD'),manifest.controller.sha,'checkpoint controller head changed');
  assert.equal(git(fixture.checkout,'rev-parse','FETCH_HEAD^{tree}'),manifest.controller.tree,'checkpoint controller tree changed');
  git(fixture.checkout,'checkout','--detach','FETCH_HEAD');fixture.setHead(manifest.controller.sha);
  assertRestoredCode(runtimeRoot,fixture.checkout,manifest.controller.sha,baseline);
  Object.assign(fixture.api,read(join(directory,'synthetic-api.json')));
}
