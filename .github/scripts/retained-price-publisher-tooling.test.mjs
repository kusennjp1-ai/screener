import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PUBLISHER_TOOLING,PUBLISHER_EXPORT_ARTIFACT,validatePublisherToolingIdentity,validatePublisherToolingFiles,validatePublisherToolingContext,validatePublisherToolingBinding,validatePublisherToolingReceipt,publisherToolingReceipt,publisherToolingPhase,publisherToolingBoundary,verifyPublisherToolingSourceFiles,verifyPublisherToolingCheckout} from './retained-price-publisher-tooling.mjs';

const clone=v=>structuredClone(v),hash='a'.repeat(64),other='b'.repeat(64),head='c'.repeat(40),tree='d'.repeat(40);
const original={ [PUBLISHER_TOOLING.files[0].path]:{mode:'100644',sha:PUBLISHER_TOOLING.files[0].before.git_blob_sha},'frontend/src/static/financialCurrent.js':{mode:'100644',sha:'e'.repeat(40)},'frontend/package-lock.json':{mode:'100644',sha:'f'.repeat(40)} };
const amended={...original,[PUBLISHER_TOOLING.files[0].path]:{mode:'100644',sha:PUBLISHER_TOOLING.files[0].after.git_blob_sha}};
const start=Date.parse('2026-10-08T09:00:00.000Z'),stamp=n=>new Date(start+n).toISOString();
function fixture(){
  const previous='9/1/'+hash+'/'+other,source={repair:{},artifact:{id:31,digest:'sha256:'+hash},companion:{id:32,digest:'sha256:'+other}};
  const state={source,sourceSha:PUBLISHER_TOOLING.base.sha,controllerSha:head,live:{identity:previous,uiSha:PUBLISHER_TOOLING.base.sha,uiDigest:hash},decision:{mode:'data'},carry:{projectionSha256:hash,evaluatedAt:stamp(2000)}};
  const request={enabled:true,approved_ui:PUBLISHER_TOOLING.base,predecessor:{identity:previous},bounds:{lifecycle_minutes:95,job_minutes:110},activation:{not_before:stamp(0),not_after:stamp(4*3600000)}};
  const verification={controller:{head,tree},caller:{run_id:55,run_attempt:1,head_sha:head,job:{id:77,started_at:stamp(0)}},request_sha256:hash,predecessor_identity:previous,
    artifact:{id:31,sha256:'sha256:'+hash},companion:{id:32,sha256:'sha256:'+other},actual_checked_at:stamp(1000)};
  const context={request,requestSha256:hash,verification,jobStartEpoch:start/1000,now:start+5000};
  const binding={schema_version:'retained-price-publisher-tooling-binding-v1',identity:PUBLISHER_TOOLING,controller:verification.controller,caller:verification.caller,request_sha256:hash,
    source:{artifact_id:31,artifact_sha256:hash,companion_id:32,companion_sha256:other,payload_sha256:hash,replay_verification_sha256:hash,restored_data_digest:hash},
    predecessor_identity:previous,carry_projection_sha256:hash,carry_evaluated_at:stamp(2000),applied_at:stamp(3000)};
  const publication={run_id:55,run_attempt:1,controller_sha:head,data_source:{artifact_id:31},financial_release:{schema_version:'financial-release-receipt-v1',path:'static-data/financial-corrections/release-'+hash+'.json',sha256:hash},
    financial_generation:hash,financial_lineage_sha256:other,ui_sha:PUBLISHER_TOOLING.base.sha,ui_digest:hash};
  state.publisherTooling={binding,phase:'composed'};state.financialPrepared={reference:publication.financial_release,receipt:{mode:'carry',evaluation_projection:{sha256:hash}}};
  return {state,context,binding,publication};
}
test('default and disabled ordinary source route does not create tooling state',async()=>{
  for(const state of [{source:{}},{source:{artifact:{id:1}},carry:{}},{source:{},decision:{mode:'data'}}]){
    const before=clone(state);assert.equal(await publisherToolingBoundary(state,'apply'),null);assert.deepEqual(state,before);
  }
  await assert.rejects(()=>publisherToolingBoundary({source:{},publisherTooling:{}},'apply'),/Ordinary route/);
});
test('exact immutable one-file identity and artifact preserve original main exporter',()=>{
  validatePublisherToolingIdentity(clone(PUBLISHER_TOOLING));
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),pin=PUBLISHER_TOOLING.files[0];
  for(const [path,expected]of [[PUBLISHER_EXPORT_ARTIFACT,pin.after],[pin.path,pin.before]]){
    const raw=readFileSync(resolve(root,path));assert.equal(raw.length,expected.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),expected.sha256);
    assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),expected.git_blob_sha);
  }
  assert.equal(PUBLISHER_TOOLING.files.length,1);assert.equal(PUBLISHER_TOOLING.source_compiler,'unchanged_approved_ui');assert.equal(PUBLISHER_TOOLING.browser_assets,'equal_approved_predecessor_only');
});
for(const [name,change]of [
  ['wrong source sha',x=>{x.base.sha=head;}],['wrong source tree',x=>{x.base.tree=head;}],['wrong frontend tree',x=>{x.base.frontend_tree=head;}],
  ['wrong amendment tree',x=>{x.amended.tree=head;}],['wrong amendment frontend tree',x=>{x.amended.frontend_tree=head;}],
  ['wrong before blob',x=>{x.files[0].before.git_blob_sha=head;}],['wrong after blob',x=>{x.files[0].after.git_blob_sha=head;}],
  ['wrong after hash',x=>{x.files[0].after.sha256=other;}],['wrong after size',x=>{x.files[0].after.bytes++;}],
  ['extra file',x=>{x.files.push(clone(x.files[0]));}],['extra field',x=>{x.override=true;}],['source authority claim',x=>{x.source_compiler='modified';}],
])test('identity rejects '+name,()=>{const x=clone(PUBLISHER_TOOLING);change(x);assert.throws(()=>validatePublisherToolingIdentity(x),/Unreviewed/);});
test('checkout inventory admits exactly one declared exporter replacement',()=>{
  validatePublisherToolingFiles(original,original);validatePublisherToolingFiles(original,amended,{amended:true});
  validatePublisherToolingFiles(original,{...amended,'frontend/public/static-data/current.json':{mode:'100644',sha:head}},{amended:true});
  assert.throws(()=>validatePublisherToolingFiles(original,amended),/delta/);
  assert.throws(()=>validatePublisherToolingFiles(original,original,{amended:true}),/delta/);
});
for(const [name,change]of [
  ['extra source',x=>{x['frontend/tools/override.mjs']={mode:'100644',sha:head};}],
  ['changed consumer',x=>{x['frontend/src/static/financialCurrent.js'].sha=head;}],
  ['changed lockfile',x=>{x['frontend/package-lock.json'].sha=head;}],
  ['changed mode',x=>{x[PUBLISHER_TOOLING.files[0].path].mode='100755';}],
  ['changed after blob',x=>{x[PUBLISHER_TOOLING.files[0].path].sha=head;}],
  ['removed source',x=>{delete x['frontend/src/static/financialCurrent.js'];}],
])test('checkout inventory rejects '+name,()=>{const x=clone(amended);change(x);assert.throws(()=>validatePublisherToolingFiles(original,x,{amended:true}),/delta/);});
test('actual source/caller context retains original lifecycle',()=>{const f=fixture();validatePublisherToolingContext(f.state,f.context);});
for(const [name,change]of [
  ['disabled request',f=>{f.context.request.enabled=false;}],['wrong source compiler',f=>{f.state.sourceSha=head;}],['wrong approved browser',f=>{f.state.live.uiSha=head;}],
  ['wrong request source tree',f=>{f.context.request.approved_ui={...PUBLISHER_TOOLING.base,tree:head};}],
  ['wrong caller controller',f=>{f.state.controllerSha=tree;}],['wrong caller attempt',f=>{f.context.verification.caller.run_attempt=2;}],
  ['wrong artifact',f=>{f.state.source.artifact.id++;}],['wrong artifact hash',f=>{f.state.source.artifact.digest='sha256:'+other;}],['wrong companion',f=>{f.state.source.companion.id++;}],
  ['wrong replay request',f=>{f.context.verification.request_sha256=other;}],['wrong predecessor',f=>{f.state.live.identity='10/1/'+hash+'/'+other;}],
  ['wrong phase state',f=>{f.state.decision.mode='ui';}],['wrong carry state',f=>{delete f.state.carry;}],['correction mode',f=>{f.state.correction={};}],['renewal mode',f=>{f.state.renewal={};}],['activation mode',f=>{f.state.activation={};}],
  ['future replay check',f=>{f.context.verification.actual_checked_at=stamp(1000000);}],['not yet active',f=>{f.context.request.activation.not_before=stamp(1000000);}],
  ['activation expired',f=>{f.context.request.activation.not_after=stamp(4000);}],['original lifecycle expired',f=>{f.context.now=start+95*60000;}],
  ['shorter first-step clock expired',f=>{f.context.jobStartEpoch-=95*60;}],['lifecycle expanded',f=>{f.context.request.bounds.lifecycle_minutes=96;}],['job expanded',f=>{f.context.request.bounds.job_minutes=111;}],
])test('context rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>validatePublisherToolingContext(f.state,f.context));});
test('publisher phases require full ordered build, composition and browser path',()=>{
  let phase='applied';for(const action of ['build-before','build-after','compose','browser-before','browser-after','recheck','recheck'])phase=publisherToolingPhase(phase,action);
  assert.equal(phase,'rechecked');
  for(const action of ['build-after','compose','browser-before','browser-after','recheck'])assert.throws(()=>publisherToolingPhase('applied',action),/phase/);
  assert.throws(()=>publisherToolingPhase('built','build-before'),/phase/);assert.throws(()=>publisherToolingPhase('browsing','recheck'),/phase/);
});
test('final receipt tells the truth about changed tooling and unchanged browser approval',()=>{
  const f=fixture(),receipt=publisherToolingReceipt(f.state,f.publication);validatePublisherToolingReceipt(receipt,f.publication);
  assert.equal(receipt.binding.identity.amended.tree,PUBLISHER_TOOLING.amended.tree);assert.equal(receipt.ui_sha,PUBLISHER_TOOLING.base.sha);
  assert.equal(receipt.ui_digest,f.state.live.uiDigest);assert.equal(receipt.binding.carry_projection_sha256,f.state.carry.projectionSha256);
  f.state.publisherTooling.phase='applied';assert.throws(()=>publisherToolingReceipt(f.state,f.publication),/composition/);
});
for(const [name,change]of [
  ['wrong publisher',f=>{f.publication.run_id++;}],['wrong attempt',f=>{f.publication.run_attempt++;}],['wrong controller',f=>{f.publication.controller_sha=tree;}],
  ['wrong source',f=>{f.publication.data_source.artifact_id++;}],['wrong browser sha',f=>{f.publication.ui_sha=head;}],['wrong browser digest',f=>{f.publication.ui_digest=other;}],
  ['wrong final generation',f=>{f.publication.financial_generation=other;}],['wrong final lineage',f=>{f.publication.financial_lineage_sha256=hash;}],['wrong carry receipt',f=>{f.publication.financial_release.sha256=other;}],
  ['wrong exporter tree',f=>{f.receipt.binding.identity.amended.tree=head;}],['extra tooling field',f=>{f.receipt.override=true;}],['extra binding field',f=>{f.receipt.binding.override=true;}],
  ['future application ordering',f=>{f.receipt.binding.applied_at=stamp(1000);}],
])test('receipt rejects '+name,()=>{
  const f=fixture();f.receipt=clone(publisherToolingReceipt(f.state,f.publication));change(f);assert.throws(()=>validatePublisherToolingReceipt(f.receipt,f.publication));
});
test('binding rejects source identities and projection clocks with closed fields',()=>{
  const f=fixture();validatePublisherToolingBinding(f.binding);
  for(const change of [x=>{x.source.payload_sha256='bad';},x=>{x.source.extra=hash;},x=>{x.caller.head_sha=tree;},x=>{x.carry_evaluated_at=stamp(-1);}]){
    const x=clone(f.binding);change(x);assert.throws(()=>validatePublisherToolingBinding(x));
  }
});

function diskFixture(t){
  const root=mkdtempSync(join(tmpdir(),'publisher-tooling-disk-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),pin=PUBLISHER_TOOLING.files[0];
  const write=(path,raw,mode=0o644)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,raw,{mode});return file;};
  write('.gitignore','frontend/public/static-data/\nfrontend/public/qualification-audit.json\nfrontend/dist/\nfrontend/node_modules/\n.env*\nfrontend/.env*\n*.tmp\n');
  write(pin.path,readFileSync(resolve(source,pin.path)));
  write('frontend/src/static/financialCurrent.js','export const current = true;\n');
  write('frontend/tools/native-fixture.sh','#!/bin/sh\nexit 0\n',0o755);
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  git('init','--quiet');git('add','.');git('-c','user.name=Publisher tooling tests','-c','user.email=publisher-tooling-test@example.invalid','commit','--quiet','-m','Immutable physical source fixture');
  const files=git('ls-tree','-r','-z','--full-tree','HEAD').split('\0').filter(Boolean).map(line=>{const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert(match);return {mode:match[1],sha:match[2],path:match[3],type:'blob'};});
  const verify=amended=>verifyPublisherToolingSourceFiles(root,files,{amended});
  const apply=()=>copyFileSync(resolve(source,PUBLISHER_EXPORT_ARTIFACT),join(root,pin.path));
  return {root,source,pin,write,git,files,verify,apply};
}
test('real Git/filesystem fingerprint admits only the original or exact one-file tooling delta',t=>{
  const f=diskFixture(t);assert.equal(f.verify(false),true);
  assert.throws(()=>verifyPublisherToolingCheckout(join(f.root,'frontend')),/Wrong selected UI source/);
  f.apply();assert.equal(f.verify(true),true);assert.throws(()=>f.verify(false),/source change/);
  f.write('frontend/public/static-data/generated.json','{"price":1}');f.write('frontend/public/qualification-audit.json','{}');
  f.write('frontend/dist/assets/app.js','built asset');f.write('frontend/node_modules/package/index.js','locked dependency placeholder');
  assert.equal(f.verify(true),true,'Generated data and Git-ignored dist/dependencies remain available');
});
for(const [name,change]of [
  ['changed after bytes',f=>{f.write(f.pin.path,'unreviewed exporter');}],
  ['changed consumer bytes',f=>{f.write('frontend/src/static/financialCurrent.js','export const current = false;');}],
  ['changed exporter mode',f=>{chmodSync(join(f.root,f.pin.path),0o755);}],
  ['changed original executable mode',f=>{chmodSync(join(f.root,'frontend/tools/native-fixture.sh'),0o644);}],
  ['extra source file',f=>{f.write('frontend/tools/extra.mjs','export const bypass = true;');}],
  ['ignored extra source',f=>{f.write('frontend/tools/extra.tmp','unreviewed source');}],
  ['ignored frontend environment',f=>{f.write('frontend/.env.production','VITE_STATIC_SITE=false');}],
  ['ignored root environment',f=>{f.write('.env.local','NODE_OPTIONS=--import=clock-hook');}],
  ['deleted consumer',f=>{unlinkSync(join(f.root,'frontend/src/static/financialCurrent.js'));}],
  ['linked exporter',f=>{const path=join(f.root,f.pin.path);unlinkSync(path);symlinkSync(resolve(f.source,PUBLISHER_EXPORT_ARTIFACT),path);}],
])test('real Git/filesystem fingerprint rejects '+name,t=>{const f=diskFixture(t);f.apply();change(f);assert.throws(()=>f.verify(true));});

for(const [name,change]of [
  ['staged root prototype key',f=>{f.write('__proto__','staged prototype key');f.git('add','__proto__');}],
  ['staged tools addition',f=>{f.write('frontend/tools/staged-extra.mjs','export const extra = true;');f.git('add','frontend/tools/staged-extra.mjs');}],
  ['staged src addition',f=>{f.write('frontend/src/static/staged-extra.js','export const extra = true;');f.git('add','frontend/src/static/staged-extra.js');}],
  ['staged ignored frontend environment',f=>{f.write('frontend/.env.production','VITE_STATIC_SITE=false');f.git('add','-f','frontend/.env.production');}],
  ['staged ignored root environment',f=>{f.write('.env.local','VITE_BASE_PATH=/changed/');f.git('add','-f','.env.local');}],
  ['staged consumer modification',f=>{f.write('frontend/src/static/financialCurrent.js','export const current = false;');f.git('add','frontend/src/static/financialCurrent.js');}],
  ['staged exporter overlay',f=>{f.git('add',f.pin.path);}],
  ['staged removal with original bytes present',f=>{f.git('rm','--cached','frontend/src/static/financialCurrent.js');}],
  ['staged executable mode',f=>{f.git('update-index','--chmod=+x',f.pin.path);}],
])test('complete real Git index rejects '+name,t=>{const f=diskFixture(t);f.apply();change(f);assert.throws(()=>f.verify(true),/index differs from original HEAD/);});

test('complete real Git index rejects unmerged stages',t=>{
  const f=diskFixture(t);f.apply();const path='frontend/src/static/financialCurrent.js',entry=f.files.find(item=>item.path===path);
  const input='0 '+entry.sha+'\t'+path+'\n'+[1,2,3].map(stage=>entry.mode+' '+entry.sha+' '+stage+'\t'+path+'\n').join('');
  execFileSync('git',['update-index','--index-info'],{cwd:f.root,input,encoding:'utf8'});
  assert.throws(()=>f.verify(true),/Unmerged or invalid publisher source index/);
});
