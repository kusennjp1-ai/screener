import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import policy from '../../contracts/financial_source_renewal_v1.json' with {type:'json'};
import {bootstrap,sha256} from './publication-state.mjs';
import {contract,digest} from './financial-correction.mjs';
import {renewalCiEligibility,validateRenewalCiAdmission,validateRenewalCiProof,verifyRenewalCiAdmission,verifyRenewalCiProof} from './financial-renewal-ci-admission.mjs';

const repo=bootstrap.repository,repoId=1203919607,registryPath='contracts/financial_source_renewal_v1.json';
const paths={request:'.github/financial-source-renewal-request.json',pin:'.github/financial-source-renewal-candidate.json',intent:'.github/financial-source-renewal-release.json'};
const workflows={certify:'.github/workflows/financial-source-renewal-certification.yml',publish:'.github/workflows/research-ui-release.yml'};
const json=value=>`${JSON.stringify(value,null,2)}\n`,clone=value=>structuredClone(value),other='e'.repeat(40),hash='a'.repeat(64);
const write=(root,path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),value);};
const blob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const clock='2026-10-05T12:00:00Z',end='2026-10-05T12:01:00Z',called='2026-10-05T12:02:00Z';
function fixture(phase='certify',{extraDelta=false,badReview=false,badPrior=false,badStageRegistry=false,extraStageDelta=false,mergeStage=false}={}){
  const root=mkdtempSync(join(tmpdir(),'renewal-ci-admission-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const save=(message)=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm',message);return {head_sha:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};};
  git('init','-q');
  let registry={...policy,publication_enabled:false,reviewed_controllers:[],reviewed_consumer_transitions:[],ci_admission:null};
  const controls={request:json({request:'independently parsed by outer caller'})};
  write(root,paths.request,controls.request);write(root,registryPath,json(registry));write(root,'unchanged.txt','unrelated bytes');write(root,'docs/Existing reviewed notes.md','A regular Git path with spaces remains protected.');
  for(const [key,path]of Object.entries(workflows))write(root,path,`name: fixture\nconcurrency:\n  group: ${key==='certify'?'financial-source-renewal-certification':'research-ui-release'}\n  cancel-in-progress: false\njobs:\n  ${key==='certify'?'certify':'publish'}:\n    runs-on: ubuntu-latest\n`);
  const R=save('Reviewed request');
  registry={...registry,ci_admission:{phase:'certify',reviewed_commit:R.head_sha,reviewed_tree:R.tree,controls:{request:sha256(controls.request)}}};
  write(root,registryPath,json(registry));if(extraDelta)write(root,'other-unprotected-path.txt','must also be protected');
  const A=save('Certify admission');let B=null,C=null;
  if(phase==='publish'){
    controls.pin=json({head_sha:A.head_sha,run_id:44,run_attempt:1});controls.intent=json({intent:'bounded by outer caller'});
    write(root,paths.pin,controls.pin);write(root,paths.intent,controls.intent);if(badPrior){registry={...registry,reviewed_consumer_transitions:[{unexpected:true}]};write(root,registryPath,json(registry));}
    if(badStageRegistry)write(root,registryPath,`${json(registry)} `);
    if(extraStageDelta)write(root,'docs/unreviewed-staging-change.md','A source-independent file must still remain unchanged.');
    B=save('Pinned certified candidate');
    if(mergeStage){
      const merged=git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit-tree',B.tree,'-p',A.head_sha,'-p',R.head_sha,'-m','Exact controls through merge staging');
      git('reset','--hard',merged);B={head_sha:merged,tree:B.tree};
    }
    const review={controller_sha:B.head_sha,controller_tree:B.tree,certification_sha:A.head_sha,certification_tree:A.tree,protected_code_sha256:hash,
      ...Object.fromEntries(Object.entries(controls).flatMap(([key,bytes])=>[[`${key}_sha256`,digest(JSON.parse(bytes))],[`${key}_raw_sha256`,sha256(bytes)]]))};
    registry={...registry,publication_enabled:true,reviewed_controllers:[review,...(badReview?[review]:[])],ci_admission:{phase:'publish',reviewed_commit:B.head_sha,reviewed_tree:B.tree,controls:Object.fromEntries(Object.entries(controls).map(([key,bytes])=>[key,sha256(bytes)]))}};
    write(root,registryPath,json(registry));C=save('Publish admission');
  }
  const executing=C??A;
  const baseRun={run_attempt:1,head_sha:executing.head_sha,head_branch:'main',repository:{id:repoId,full_name:repo},head_repository:{id:repoId,full_name:repo},created_at:clock,run_started_at:clock,updated_at:end,status:'completed',conclusion:'success'};
  const trigger={...baseRun,id:10,workflow_id:101,path:'.github/workflows/ci.yml',event:'push'};
  const caller={...baseRun,id:20,workflow_id:102,path:workflows[phase],event:'workflow_run',created_at:called,run_started_at:called,updated_at:called,status:'in_progress',conclusion:null};
  const jobs=contract.required_ci_jobs.map((name,index)=>({id:1010+index,name,run_id:10,run_attempt:1,head_sha:executing.head_sha,status:'completed',conclusion:'success',started_at:clock,completed_at:end}));
  const ownJobs=[{id:201,name:phase==='publish'?'publish':policy.job,run_id:20,run_attempt:1,head_sha:executing.head_sha,status:'in_progress',conclusion:null,started_at:called,completed_at:null,steps:[{name:'Admit exact successful main CI renewal',status:'in_progress',conclusion:null,started_at:called,completed_at:null}]}];
  const state={trigger,caller,jobs,ownJobs,latestTrigger:clone(trigger),latestCaller:clone(caller),ciRuns:[clone(trigger)],ownRuns:[clone(caller)],main:executing.head_sha,repo:{id:repoId,full_name:repo,default_branch:'main'},overrides:new Map(),calls:[]};
  const cache=new Map();
  const api=(endpoint,paginate=false)=>{
    state.calls.push(endpoint);
    if(state.overrides.has(endpoint)){const value=state.overrides.get(endpoint);return clone(typeof value==='function'?value():value);}
    if(endpoint===`repos/${repo}`)return clone(state.repo);
    if(endpoint===`repos/${repo}/git/ref/heads/main`)return {object:{sha:state.main}};
    if(endpoint===`repos/${repo}/actions/runs/10/attempts/1`)return clone(state.trigger);
    if(endpoint===`repos/${repo}/actions/runs/10`)return clone(state.latestTrigger);
    if(endpoint===`repos/${repo}/actions/runs/20/attempts/1`)return clone(state.caller);
    if(endpoint===`repos/${repo}/actions/runs/20`)return clone(state.latestCaller);
    if(endpoint===`repos/${repo}/actions/runs/20/attempts/1/jobs?per_page=100`)return [{total_count:state.ownJobs.length,jobs:clone(state.ownJobs)}];
    if(endpoint===`repos/${repo}/actions/runs/10/attempts/1/jobs?per_page=100`)return [{total_count:state.jobs.length,jobs:clone(state.jobs)}];
    if(endpoint===`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${executing.head_sha}&per_page=100`)return [{total_count:state.ciRuns.length,workflow_runs:clone(state.ciRuns)}];
    if(endpoint===`repos/${repo}/actions/workflows/${workflows[phase].split('/').at(-1)}/runs?branch=main&head_sha=${executing.head_sha}&per_page=100`)return [{total_count:state.ownRuns.length,workflow_runs:clone(state.ownRuns)}];
    if(cache.has(endpoint))return clone(cache.get(endpoint));
    let value,match;
    if((match=/\/git\/commits\/([a-f0-9]{40})$/.exec(endpoint))){const head=match[1];value={sha:head,tree:{sha:git('rev-parse',`${head}^{tree}`)},parents:git('rev-list','--parents','-n','1',head).split(' ').slice(1).map(sha=>({sha}))};}
    else if((match=/\/git\/trees\/([a-f0-9]{40})\?recursive=1$/.exec(endpoint))){value={sha:match[1],truncated:false,tree:git('ls-tree','-r',match[1]).split('\n').map(line=>{const found=/^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/.exec(line);return {mode:found[1],type:found[2],sha:found[3],path:found[4]};})};}
    else if((match=/\/contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(endpoint))){const bytes=execFileSync('git',['show',`${match[2]}:${match[1]}`],{cwd:root});value={type:'file',path:match[1],sha:blob(bytes),encoding:'base64',size:bytes.length,content:bytes.toString('base64')};}
    else throw Error(`Unexpected fixture endpoint: ${endpoint} (${paginate})`);
    cache.set(endpoint,value);return clone(value);
  };
  const event={action:'completed',repository:clone(state.repo),workflow_run:clone(trigger)};
  const context={event_name:'workflow_run',repository:repo,repository_id:repoId,ref:'refs/heads/main',sha:executing.head_sha,workflow_ref:`${repo}/${workflows[phase]}@refs/heads/main`,workflow_sha:executing.head_sha,run_id:20,run_attempt:1};
  return {root,phase,api,state,event,context,R,A,B,C,executing,controls,registry,git,options:{root,phase,api,event,context},dispose:()=>rmSync(root,{recursive:true,force:true})};
}
function withFixture(phase,body,options){const f=fixture(phase,options);try{return body(f);}finally{f.dispose();}}

for(const phase of ['certify','publish'])test(`${phase}: exact direct registry-only admission produces closed CI proof`,()=>withFixture(phase,f=>{
  assert.equal(renewalCiEligibility(f.options).status,'eligible');const proof=verifyRenewalCiAdmission(f.options);
  assert.equal(proof.producer_event,'workflow_run');assert.equal(proof.executing.head_sha,f.executing.head_sha);assert.equal(proof.caller.run_attempt,1);assert.equal(proof.phase,phase);
  assert.deepEqual(proof.controls,f.registry.ci_admission.controls);assert.equal(validateRenewalCiProof(proof),proof);
  assert.equal(verifyRenewalCiProof(proof,{api:f.api,expectedHead:f.executing.head_sha,expectedTree:f.executing.tree,expectedPhase:phase,expectedChecks:proof.checks,expectedCaller:{run_id:20}}),proof);
}));
test('disabled and pending local controls no-op before API or execution context',()=>withFixture('certify',f=>{
  write(f.root,registryPath,json({...f.registry,ci_admission:null}));let calls=0;const api=()=>{calls++;throw Error('must not call API');};
  assert.equal(verifyRenewalCiAdmission({...f.options,context:null,event:null,api}).status,'hold');
  rmSync(join(f.root,paths.request));assert.equal(verifyRenewalCiAdmission({...f.options,context:null,event:null,api}).status,'disabled');assert.equal(calls,0);
}));
test('certification admission is a hold for publisher and vice versa',()=>{for(const phase of ['certify','publish'])withFixture(phase,f=>assert.equal(renewalCiEligibility({root:f.root,phase:phase==='certify'?'publish':'certify'}).status,'hold'));});
test('closed admission rejects extra authority, wrong paths, phase, raw digest and reviewed identities',()=>withFixture('certify',f=>{
  for(const change of [a=>a.extra=true,a=>a.phase='manual',a=>a.controls.pin=hash,a=>a.controls.request='bad',a=>a.reviewed_tree=hash,a=>a.reviewed_commit='main']){
    const admission=clone(f.registry.ci_admission);change(admission);assert.throws(()=>validateRenewalCiAdmission(admission));
  }
}));
for(const [name,change]of [
  ['fork context',f=>f.context.repository='fork/screener'],['repository ID',f=>f.context.repository_id=1],['PR event',f=>f.context.event_name='pull_request'],
  ['nonmain ref',f=>f.context.ref='refs/heads/topic'],['workflow SHA',f=>f.context.workflow_sha=other],['checkout SHA',f=>f.context.sha=other],['wrong workflow',f=>f.context.workflow_ref=`${repo}/.github/workflows/ci.yml@refs/heads/main`],
  ['own rerun',f=>f.context.run_attempt=2],['fork event repository',f=>f.event.repository.id=1],['incomplete event',f=>f.event.action='requested'],['CI rerun event',f=>f.event.workflow_run.run_attempt=2],
  ['PR trigger',f=>f.event.workflow_run.event='pull_request'],['fork trigger',f=>f.event.workflow_run.head_repository.id=1],['failed trigger',f=>f.event.workflow_run.conclusion='failure'],
  ['stale trigger',f=>f.event.workflow_run.head_sha=other],['future trigger clock',f=>f.event.workflow_run.updated_at='2099-01-01T00:00:00Z'],['invalid trigger clock',f=>f.event.workflow_run.created_at='bad'],
  ['current main changed',f=>f.state.main=other],['official repo mismatch',f=>f.state.repo.id=1],['new CI attempt',f=>f.state.latestTrigger.run_attempt=2],['new own attempt',f=>f.state.latestCaller.run_attempt=2],
  ['newer CI run',f=>f.state.ciRuns.push({...f.state.trigger,id:11})],['own API event mismatch',f=>f.state.caller.event='workflow_dispatch'],['own API head mismatch',f=>f.state.caller.head_sha=other],
  ['own caller failed',f=>{f.state.caller.status='completed';f.state.caller.conclusion='failure';}],['duplicate required jobs',f=>f.state.jobs.push({...f.state.jobs[0],id:999})],
  ['wrong job head',f=>f.state.jobs[0].head_sha=other],['wrong job attempt',f=>f.state.jobs[0].run_attempt=2],['wrong job run',f=>f.state.jobs[0].run_id=11],
  ['duplicate job ID',f=>f.state.jobs[1].id=f.state.jobs[0].id],['missing required job',f=>f.state.jobs.pop()],['late job clock',f=>f.state.jobs[0].completed_at=called],
  ['missing own inventory',f=>f.state.ownRuns=[]],['duplicate own inventory',f=>f.state.ownRuns.push(clone(f.state.caller))],['earlier uncertified caller',f=>f.state.ownRuns.push({...f.state.caller,id:19,status:'cancelled',conclusion:'cancelled'})],
])test(`rejects ${name}`,()=>withFixture('certify',f=>{change(f);assert.throws(()=>verifyRenewalCiAdmission(f.options));}));
test('rejects unrelated Git path changes outside protected-prefix inventories',()=>withFixture('certify',f=>assert.throws(()=>verifyRenewalCiAdmission(f.options),/only the existing registry blob/),{extraDelta:true}));
test('rejects wrong parent, wrong tree, truncated inventory, symlink and mode changes',()=>withFixture('certify',f=>{
  const commitEndpoint=`repos/${repo}/git/commits/${f.A.head_sha}`,commit=f.api(commitEndpoint);
  for(const invalid of [{...commit,parents:[{sha:other}]},{...commit,parents:[{sha:f.R.head_sha},{sha:other}]},{...commit,tree:{sha:other}}]){f.state.overrides.set(commitEndpoint,invalid);assert.throws(()=>verifyRenewalCiAdmission(f.options));}
  f.state.overrides.delete(commitEndpoint);
  const endpoint=`repos/${repo}/git/trees/${f.A.tree}?recursive=1`,tree=f.api(endpoint);
  for(const change of [v=>v.truncated=true,v=>v.tree[0].mode='120000',v=>v.tree[0].type='commit',v=>v.tree.push(clone(v.tree[0])),v=>v.tree.find(e=>e.path===registryPath).mode='100755']){const value=clone(tree);change(value);f.state.overrides.set(endpoint,value);assert.throws(()=>verifyRenewalCiAdmission(f.options));}
}));
test('rejects raw registry and control byte mutations even when parsed values match',()=>withFixture('certify',f=>{
  for(const path of [registryPath,paths.request]){const endpoint=`repos/${repo}/contents/${path}?ref=${f.A.head_sha}`,response=f.api(endpoint),bytes=Buffer.concat([Buffer.from(response.content,'base64'),Buffer.from(' ')]);
    f.state.overrides.set(endpoint,{...response,size:bytes.length,content:bytes.toString('base64')});assert.throws(()=>verifyRenewalCiAdmission(f.options),/raw bytes mismatch/);f.state.overrides.delete(endpoint);
  }
  write(f.root,paths.request,`${f.controls.request} `);assert.throws(()=>verifyRenewalCiAdmission(f.options),/local admission controls/);
}));
test('rejects multiple appended reviews and changed preexisting registry metadata',()=>{
  withFixture('publish',f=>assert.throws(()=>verifyRenewalCiAdmission(f.options),/exactly one/),{badReview:true});
  withFixture('publish',f=>assert.throws(()=>verifyRenewalCiAdmission(f.options),/raw certification registry bytes/),{badPrior:true});
});
test('rejects incomplete pagination and ambiguous own-run entries',()=>withFixture('certify',f=>{
  const endpoint=`repos/${repo}/actions/workflows/${workflows.certify.split('/').at(-1)}/runs?branch=main&head_sha=${f.A.head_sha}&per_page=100`;
  for(const pages of [[],[{total_count:2,workflow_runs:[f.state.caller]}],[{total_count:1001,workflow_runs:[f.state.caller]}],[{total_count:1,workflow_runs:[{id:20}]}]]){f.state.overrides.set(endpoint,pages);assert.throws(()=>verifyRenewalCiAdmission(f.options));}
}));
test('historical proof survives present intent removal, new main, CI rerun and replay inventory',()=>withFixture('publish',f=>{
  const proof=verifyRenewalCiAdmission(f.options);f.state.caller.status='completed';f.state.caller.conclusion='success';f.state.caller.updated_at='2026-10-05T12:03:00Z';
  const publisherJob={id:201,name:'publish',run_id:20,run_attempt:1,head_sha:f.C.head_sha,status:'completed',conclusion:'success',started_at:called,completed_at:'2026-10-05T12:03:00Z',steps:[
    {name:'Admit exact successful main CI renewal',status:'completed',conclusion:'success',started_at:called,completed_at:'2026-10-05T12:02:10Z'},
    {name:'Deploy to GitHub Pages',status:'completed',conclusion:'success',started_at:'2026-10-05T12:02:20Z',completed_at:'2026-10-05T12:02:50Z'}]};
  f.state.overrides.set(`repos/${repo}/actions/runs/20/attempts/1/jobs?per_page=100`,[{total_count:1,jobs:[publisherJob]}]);
  f.state.main=other;f.state.latestTrigger.run_attempt=2;f.state.latestCaller.run_attempt=2;f.state.ownRuns.push({...f.state.caller,id:21});rmSync(join(f.root,paths.intent));
  f.state.calls=[];assert.equal(verifyRenewalCiProof(proof,{api:f.api,historical:true,expectedHead:f.C.head_sha,expectedTree:f.C.tree,expectedPhase:'publish'}),proof);
  assert.equal(f.state.calls.some(path=>path.includes('/git/ref/')||path.includes('/workflows/')||/\/actions\/runs\/\d+$/.test(path)),false);
  publisherJob.steps[0].conclusion='skipped';assert.throws(()=>verifyRenewalCiProof(proof,{api:f.api,historical:true}),/admission or deployment step/);publisherJob.steps[0].conclusion='success';
  publisherJob.steps[1].conclusion='failure';assert.throws(()=>verifyRenewalCiProof(proof,{api:f.api,historical:true}),/admission or deployment step/);publisherJob.steps[1].conclusion='success';
  f.state.caller.conclusion='failure';assert.throws(()=>verifyRenewalCiProof(proof,{api:f.api,historical:true}),/terminal successful/);
}));
test('saved proof cannot change phase, caller, checks, control digest, registry or reviewed tree',()=>withFixture('certify',f=>{
  const proof=verifyRenewalCiAdmission(f.options);
  for(const change of [p=>p.phase='publish',p=>p.caller.workflow_sha=other,p=>p.caller.run_attempt=2,p=>p.checks[0].job_id=999,p=>p.registry_sha256=hash,p=>p.admission_sha256=hash,p=>p.reviewed.tree=other,p=>p.controls.request=hash,p=>p.extra=true]){const value=clone(proof);change(value);assert.throws(()=>verifyRenewalCiProof(value,{api:f.api}));}
}));
function ordinaryPrior(f,{sourcePath='.github/workflows/design-acceptance.yml',sourceEvent='push',sourceConclusion='success',publishConclusion='success'}={}){
  // The ordinary completion runs before the CI caller gets the same workflow's lock.
  const source={...clone(f.state.trigger),id:8,workflow_id:100,path:sourcePath,event:sourceEvent,conclusion:sourceConclusion,created_at:'2026-10-05T11:54:00Z',run_started_at:'2026-10-05T11:54:00Z',updated_at:'2026-10-05T11:55:00Z'};
  const run={...clone(f.state.caller),id:19,status:'completed',conclusion:'success',created_at:'2026-10-05T11:56:00Z',run_started_at:'2026-10-05T11:56:00Z',updated_at:'2026-10-05T11:59:00Z'};
  const route={id:191,name:'Route exact renewal CI admission',run_id:19,run_attempt:1,head_sha:f.executing.head_sha,status:'completed',conclusion:'success',started_at:'2026-10-05T11:56:00Z',completed_at:'2026-10-05T11:57:00Z',steps:[{name:'Ordinary non-CI publication: 8/1',status:'completed',conclusion:'success',started_at:'2026-10-05T11:56:30Z',completed_at:'2026-10-05T11:56:40Z'}]};
  const publish={id:192,name:'publish',run_id:19,run_attempt:1,head_sha:f.executing.head_sha,status:'completed',conclusion:publishConclusion,started_at:'2026-10-05T11:57:30Z',completed_at:'2026-10-05T11:58:00Z'};
  f.state.ownRuns.push(run);
  const put=()=>{f.state.overrides.set(`repos/${repo}/actions/runs/19/attempts/1`,run);f.state.overrides.set(`repos/${repo}/actions/runs/19`,run);f.state.overrides.set(`repos/${repo}/actions/runs/19/attempts/1/jobs?per_page=100`,[{total_count:2,jobs:[route,publish]}]);f.state.overrides.set(`repos/${repo}/actions/runs/8/attempts/1`,source);f.state.overrides.set(`repos/${repo}/actions/runs/8`,source);};put();
  return {source,run,route,publish,put};
}
function queuedLater(f){
  const run={...clone(f.state.caller),id:21,status:'queued',conclusion:null,created_at:'2026-10-05T12:02:10Z',run_started_at:null,updated_at:'2026-10-05T12:02:10Z'};
  const currentJob=clone(f.state.ownJobs[0]);
  f.state.ownRuns.push(run);
  const put=()=>{f.state.overrides.set(`repos/${repo}/actions/runs/21`,run);f.state.overrides.set(`repos/${repo}/actions/runs/21/attempts/1`,run);f.state.overrides.set(`repos/${repo}/actions/runs/20/attempts/1/jobs?per_page=100`,[{total_count:1,jobs:[currentJob]}]);};put();return {run,currentJob,put};
}
for(const options of [{},{sourceConclusion:'failure'},{publishConclusion:'skipped'},{sourcePath:'.github/workflows/static-site.yml',sourceEvent:'schedule'},{sourcePath:'.github/workflows/static-site.yml',sourceEvent:'workflow_dispatch'}])test(`publisher admits an independently authenticated prior ordinary non-CI completion ${JSON.stringify(options)}`,()=>withFixture('publish',f=>{
  ordinaryPrior(f,options);assert.equal(verifyRenewalCiAdmission(f.options).phase,'publish');
}));
for(const [name,change]of [
  ['missing marker',n=>n.route.steps=[]],['duplicate marker',n=>n.route.steps.push(clone(n.route.steps[0]))],['failed marker',n=>n.route.steps[0].conclusion='failure'],
  ['forged CI marker',n=>n.source.path='.github/workflows/ci.yml'],['unbound marker ID',n=>n.route.steps[0].name='Ordinary non-CI publication: 9/1'],['unbound marker attempt',n=>n.route.steps[0].name='Ordinary non-CI publication: 8/2'],
  ['cancelled caller',n=>n.run.conclusion='cancelled'],['running caller',n=>n.run.status='in_progress'],['caller rerun',n=>n.run.run_attempt=2],['failed publication',n=>n.publish.conclusion='failure'],
  ['wrong job head',n=>n.route.head_sha=other],['wrong job attempt',n=>n.publish.run_attempt=2],['wrong source head',n=>n.source.head_sha=other],['wrong source event',n=>n.source.event='pull_request'],
  ['fork source',n=>n.source.head_repository.id=1],['running source',n=>n.source.status='in_progress'],['unknown source conclusion',n=>n.source.conclusion='unknown'],['missing marker clock',n=>delete n.route.steps[0].completed_at],
])test(`prior ordinary exception rejects ${name}`,()=>withFixture('publish',f=>{const n=ordinaryPrior(f);change(n);n.put();assert.throws(()=>verifyRenewalCiAdmission(f.options));}));
test('prior ordinary exception rejects source or caller reruns through independent latest APIs',()=>withFixture('publish',f=>{
  const n=ordinaryPrior(f);f.state.overrides.set(`repos/${repo}/actions/runs/8`,{...n.source,run_attempt:2});assert.throws(()=>verifyRenewalCiAdmission(f.options));
  n.put();f.state.overrides.set(`repos/${repo}/actions/runs/19`,{...n.run,run_attempt:2});assert.throws(()=>verifyRenewalCiAdmission(f.options));
}));
for(const phase of ['certify','publish'])test(`${phase}: later queued sibling stays outside the current verified serial lock`,()=>withFixture(phase,f=>{
  queuedLater(f);assert.equal(verifyRenewalCiAdmission(f.options).phase,phase);
}));
for(const [name,change]of [
  ['running successor',n=>n.run.status='in_progress'],['waiting successor',n=>n.run.status='waiting'],['cancelled successor',n=>{n.run.status='completed';n.run.conclusion='cancelled';}],
  ['completed successor',n=>{n.run.status='completed';n.run.conclusion='success';}],['manual successor',n=>n.run.event='workflow_dispatch'],['rerun successor',n=>n.run.run_attempt=2],
  ['wrong workflow successor',n=>n.run.workflow_id=300],['missing current lock',n=>n.currentJob.status='queued'],['wrong current job head',n=>n.currentJob.head_sha=other],
])test(`queued exception rejects ${name}`,()=>withFixture('publish',f=>{const n=queuedLater(f);change(n);n.put();assert.throws(()=>verifyRenewalCiAdmission(f.options));}));
test('queued exception rechecks successor latest state instead of trusting stale inventory',()=>withFixture('publish',f=>{
  const n=queuedLater(f);f.state.overrides.set(`repos/${repo}/actions/runs/21`,{...n.run,status:'in_progress'});assert.throws(()=>verifyRenewalCiAdmission(f.options));
}));
test('both completion orders work: prior ordinary success and later queued Design run',()=>withFixture('publish',f=>{
  ordinaryPrior(f);queuedLater(f);assert.equal(verifyRenewalCiAdmission(f.options).phase,'publish');
}));
test('all tracked working-tree bytes remain exact, including code outside controls',()=>withFixture('certify',f=>{
  write(f.root,'unchanged.txt','dirty executing code');assert.throws(()=>verifyRenewalCiAdmission(f.options));
}));
for(const phase of ['certify','publish'])test(`${phase}: proof stays identical after the actual admission step succeeds`,()=>withFixture(phase,f=>{
  const running=verifyRenewalCiAdmission(f.options),step=f.state.ownJobs[0].steps[0];
  step.status='completed';step.conclusion='success';step.completed_at='2026-10-05T12:02:10Z';
  assert.deepEqual(verifyRenewalCiAdmission(f.options),running);
}));
for(const phase of ['certify','publish'])for(const [name,change]of [
  ['missing own job',f=>f.state.ownJobs=[]],['duplicate own job',f=>f.state.ownJobs.push({...clone(f.state.ownJobs[0]),id:202})],['wrong own job name',f=>f.state.ownJobs[0].name='other'],
  ['wrong own job head',f=>f.state.ownJobs[0].head_sha=other],['wrong own job attempt',f=>f.state.ownJobs[0].run_attempt=2],['queued own job',f=>f.state.ownJobs[0].status='queued'],
  ['completed own job',f=>{f.state.ownJobs[0].status='completed';f.state.ownJobs[0].conclusion='success';}],['missing admission step',f=>f.state.ownJobs[0].steps=[]],
  ['duplicate admission step',f=>f.state.ownJobs[0].steps.push(clone(f.state.ownJobs[0].steps[0]))],['queued admission step',f=>f.state.ownJobs[0].steps[0].status='queued'],
  ['skipped admission step',f=>{f.state.ownJobs[0].steps[0].status='completed';f.state.ownJobs[0].steps[0].conclusion='skipped';}],
  ['failed admission step',f=>{f.state.ownJobs[0].steps[0].status='completed';f.state.ownJobs[0].steps[0].conclusion='failure';}],
  ['missing job clock',f=>delete f.state.ownJobs[0].started_at],['job before caller',f=>f.state.ownJobs[0].started_at=clock],['job already ended',f=>f.state.ownJobs[0].completed_at=called],
  ['missing admission clock',f=>delete f.state.ownJobs[0].steps[0].started_at],['admission before job',f=>f.state.ownJobs[0].steps[0].started_at=clock],
  ['future admission clock',f=>f.state.ownJobs[0].steps[0].started_at='2099-01-01T00:00:00Z'],['in-progress step with conclusion',f=>f.state.ownJobs[0].steps[0].conclusion='success'],
  ['in-progress step with completion time',f=>f.state.ownJobs[0].steps[0].completed_at=called],
  ['successful step without completion time',f=>{f.state.ownJobs[0].steps[0].status='completed';f.state.ownJobs[0].steps[0].conclusion='success';}],
  ['successful step with reversed clocks',f=>{const step=f.state.ownJobs[0].steps[0];step.status='completed';step.conclusion='success';step.completed_at=clock;}],
])test(`${phase}: current gate rejects ${name}`,()=>withFixture(phase,f=>{change(f);assert.throws(()=>verifyRenewalCiAdmission(f.options));}));
test('historical certifier requires its original successful admission job and step',()=>withFixture('certify',f=>{
  const proof=verifyRenewalCiAdmission(f.options),job=f.state.ownJobs[0],step=job.steps[0];
  f.state.caller.status='completed';f.state.caller.conclusion='success';f.state.caller.updated_at='2026-10-05T12:04:00Z';
  job.status='completed';job.conclusion='success';job.completed_at='2026-10-05T12:03:00Z';step.status='completed';step.conclusion='success';step.completed_at='2026-10-05T12:02:10Z';
  assert.equal(verifyRenewalCiProof(proof,{api:f.api,historical:true}),proof);
  for(const invalid of ['skipped','failure','cancelled']){step.conclusion=invalid;assert.throws(()=>verifyRenewalCiProof(proof,{api:f.api,historical:true}));}step.conclusion='success';
  step.completed_at='2026-10-05T12:03:30Z';assert.throws(()=>verifyRenewalCiProof(proof,{api:f.api,historical:true}));step.completed_at='2026-10-05T12:02:10Z';
  job.steps=[];assert.throws(()=>verifyRenewalCiProof(proof,{api:f.api,historical:true}));
}));
test('automatic staging rejects a whitespace-only A registry rewrite at B with all Git identities rebound',()=>withFixture('publish',f=>{
  assert.equal(f.git('diff','--name-only',f.A.head_sha,f.B.head_sha).split('\n').includes(registryPath),true);
  assert.equal(f.registry.ci_admission.reviewed_commit,f.B.head_sha);assert.equal(f.registry.ci_admission.reviewed_tree,f.B.tree);
  assert.throws(()=>verifyRenewalCiAdmission(f.options),/staging changed raw certification registry bytes/);
},{badStageRegistry:true}));
test('automatic staging rejects an extra unprotected B file with exact B and C Git metadata',()=>withFixture('publish',f=>{
  assert.equal(f.registry.reviewed_controllers[0].controller_sha,f.B.head_sha);assert.equal(f.registry.reviewed_controllers[0].controller_tree,f.B.tree);
  assert.throws(()=>verifyRenewalCiAdmission(f.options),/staging must add only the exact pin and intent files/);
},{extraStageDelta:true}));
test('automatic staging permits a merge-parent B when its complete tree adds exactly pin and intent',()=>withFixture('publish',f=>{
  assert.equal(f.git('rev-list','--parents','-n','1',f.B.head_sha).split(' ').length,3);
  assert.equal(verifyRenewalCiAdmission(f.options).phase,'publish');
},{mergeStage:true}));
