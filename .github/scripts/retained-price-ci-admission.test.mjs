import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {PRICE_CI,PRICE_REQUEST_PATH,PRICE_REPAIR_STEP,PRICE_HOLD_STEP,priceControllerRoot,verifyPriceActivation,verifyPriceCiProducer,verifyPriceSourceCompletion,routePricePublication,isVerifiedPriceSourceProof} from './retained-price-ci-admission.mjs';

const sha256=b=>createHash('sha256').update(b).digest('hex');
const repo={id:PRICE_CI.repositoryId,full_name:PRICE_CI.repository,default_branch:'main'};
const prefix=`repos/${PRICE_CI.repository}`;
const now=Date.now();
const timestamp=seconds=>new Date(now+seconds*1000).toISOString();
const copy=v=>structuredClone(v);
function fixture(t,{disabled=false,extraCommitFile=false}={}){
  const root=mkdtempSync(join(tmpdir(),'finite-price-ci-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=(path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value)+'\n');};
  git('init','-q');git('config','user.email','fixture@example.test');git('config','user.name','Fixture');
  write(PRICE_CI.producer.path,"concurrency:\n  group: ${{ github.event_name == 'workflow_run' && format('static-site-oct6-{0}', github.event.workflow_run.head_sha) || 'ordinary' }}\n  cancel-in-progress: false\n");
  const old={schema_version:'retained-price-oct6-source-v1',enabled:false,activation:null,immutable_test_body:{source:'fixed'}};write(PRICE_REQUEST_PATH,old);
  git('add','.');git('commit','-qm','disabled reviewed plumbing');const parent=git('rev-parse','HEAD'),parentTree=git('rev-parse','HEAD^{tree}'),oldRaw=readFileSync(join(root,PRICE_REQUEST_PATH));
  const request={...old,enabled:!disabled,activation:disabled?null:{reviewed_parent_sha:parent,reviewed_parent_tree:parentTree,disabled_request_sha256:sha256(oldRaw),not_before:timestamp(-3600),not_after:timestamp(3600)}};write(PRICE_REQUEST_PATH,request);if(extraCommitFile)write('unreviewed.txt','extra');
  git('add','.');git('commit','--allow-empty','-qm','finite request-only activation');const head=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
  const commits=id=>JSON.parse(git('show','-s','--format={"sha":"%H","tree":{"sha":"%T"},"parents":["%P"]}',id));
  const commit=id=>{const c=commits(id);c.parents=c.parents[0]?c.parents[0].split(' ').map(sha=>({sha})):[];return c;};
  const treeResponse=(id,ref)=>({sha:id,truncated:false,tree:git('ls-tree','-r',ref).split('\n').filter(Boolean).map(line=>{const [metadata,path]=line.split('\t'),[mode,type,sha]=metadata.split(' ');return{mode,type,sha,path};})});
  const content=ref=>{const raw=Buffer.from(git('show',`${ref}:${PRICE_REQUEST_PATH}`)+'\n');return{type:'file',path:PRICE_REQUEST_PATH,encoding:'base64',content:raw.toString('base64'),size:raw.length,sha:git('rev-parse',`${ref}:${PRICE_REQUEST_PATH}`)};};
  const run=(id,workflow,event,status='completed')=>({id,run_attempt:1,workflow_id:workflow.id,path:workflow.path,head_sha:head,head_branch:'main',event,status,conclusion:status==='completed'?'success':null,created_at:timestamp(-3500),run_started_at:timestamp(-3490),updated_at:timestamp(-3480),repository:repo,head_repository:repo});
  const ci=run(100,PRICE_CI.ci,'push'),producer=run(200,PRICE_CI.producer,'workflow_run','in_progress');Object.assign(producer,{created_at:timestamp(-3470),run_started_at:timestamp(-3460),updated_at:timestamp(-3400)});
  const publisher=run(400,PRICE_CI.publisher,'workflow_run','in_progress');Object.assign(publisher,{created_at:timestamp(-3300),run_started_at:timestamp(-3290),updated_at:timestamp(-3280)});
  const job=(id,run,name,status='completed')=>({id,run_id:run.id,run_attempt:1,head_sha:head,name,status,conclusion:status==='completed'?'success':null,started_at:run.run_started_at,completed_at:run.updated_at,steps:[]});
  const ciJobs=['Backend Quality Gates','Frontend','Static Browser Regression'].map((name,i)=>job(1000+i,ci,name));
  const sourceJob=job(2000,producer,'combine-and-build','in_progress');
  const sourceSteps=['Build static frontend',PRICE_REPAIR_STEP,'Upload verified data export','Record exact export attempt and dated evidence','Preserve dated export provenance for release selection'];
  const map={
    [prefix]:repo,[`${prefix}/git/ref/heads/main`]:{object:{sha:head}},[`${prefix}/git/commits/${head}`]:commit(head),[`${prefix}/git/commits/${parent}`]:commit(parent),
    [`${prefix}/git/trees/${tree}?recursive=1`]:treeResponse(tree,head),[`${prefix}/git/trees/${parentTree}?recursive=1`]:treeResponse(parentTree,parent),
    [`${prefix}/contents/${PRICE_REQUEST_PATH}?ref=${head}`]:content(head),[`${prefix}/contents/${PRICE_REQUEST_PATH}?ref=${parent}`]:content(parent),
  };
  const records={ci:[ci],producer:[producer],publisher:[publisher]},jobRecords={100:ciJobs,200:[sourceJob],400:[job(4000,publisher,'Route exact renewal CI admission','in_progress')]};
  function sync(){for(const [kind,rs]of Object.entries(records)){const wf=PRICE_CI[kind];map[`${prefix}/actions/workflows/${wf.id}/runs?branch=main&event=${kind==='ci'?'push':'workflow_run'}&head_sha=${head}&per_page=100`]=[{total_count:rs.length,workflow_runs:copy(rs)}];for(const r of rs){map[`${prefix}/actions/runs/${r.id}`]=copy(r);map[`${prefix}/actions/runs/${r.id}/attempts/1`]=copy(r);}}
    for(const [id,jobs]of Object.entries(jobRecords))map[`${prefix}/actions/runs/${id}/attempts/1/jobs?per_page=100`]=[{total_count:jobs.length,jobs:copy(jobs)}];}
  sync();
  const api=(endpoint)=>{assert(Object.hasOwn(map,endpoint),`Unexpected API read ${endpoint}`);return copy(map[endpoint]);};
  const execution=workflow=>({event_name:'workflow_run',repository:PRICE_CI.repository,repository_id:PRICE_CI.repositoryId,ref:'refs/heads/main',sha:head,workflow_ref:`${PRICE_CI.repository}/${workflow.path}@refs/heads/main`,workflow_sha:head,run_id:workflow.id===PRICE_CI.producer.id?200:400,run_attempt:1});
  const event=source=>({action:'completed',repository:repo,workflow_run:copy(source)});
  function finish(){producer.status='completed';producer.conclusion='success';sourceJob.status='completed';sourceJob.conclusion='success';sourceJob.steps=sourceSteps.map(name=>({name,status:'completed',conclusion:'success'}));sync();}
  return {root,git,write,head,tree,parent,parentTree,request,map,records,jobRecords,ci,producer,publisher,sourceJob,api,sync,finish,event,execution,
    produce:()=>verifyPriceCiProducer({root,event:event(ci),execution:execution(PRICE_CI.producer),api,now}),
    source:()=>verifyPriceSourceCompletion({root,sourceRun:copy(producer),api,now}),
    route:source=>routePricePublication({root,event:event(source),execution:execution(PRICE_CI.publisher),api,now})};
}

test('disabled plumbing performs no GitHub read or producer work',t=>{
  const f=fixture(t,{disabled:true}),api=()=>assert.fail('Disabled route read remote state');
  assert.deepEqual(verifyPriceCiProducer({root:f.root,event:{},api,now}),{status:'disabled',repair:false});
  assert.deepEqual(routePricePublication({root:f.root,event:{},api,now}),{price_wait:false,price_source:false});
});
test('exact request-only child and successful CI admit the original winning producer',t=>{
  const f=fixture(t),result=f.produce();assert.equal(result.repair,true);assert.equal(result.activation.executing.sha,f.head);assert.equal(result.trigger.id,100);assert.equal(result.producer.id,200);
});
test('extra changed file cannot hide behind an otherwise exact activation request',t=>{assert.throws(()=>fixture(t,{extraCommitFile:true}).produce(),/only existing request blob/);});
test('finite activation rejects expiry, unreviewed parent tree, body change and dirty checkout',t=>{
  const f=fixture(t);assert.throws(()=>verifyPriceActivation({root:f.root,api:f.api,now:now+3600*1000}),/outside finite window/);
  f.map[`${prefix}/git/commits/${f.parent}`].tree.sha='f'.repeat(40);assert.throws(()=>f.produce(),/reviewed parent child/);
  f.map[`${prefix}/git/commits/${f.parent}`].tree.sha=f.parentTree;f.write('untracked.js','malicious');assert.throws(()=>f.produce(),/untracked/);
});
test('all exact controller and trigger identities are enforced',t=>{
  for(const [key,value]of [['workflow_id',99],['run_attempt',2],['head_sha','f'.repeat(40)],['head_branch','other'],['event','pull_request'],['status','in_progress'],['conclusion','failure']]){
    const f=fixture(t);f.ci[key]=value;f.sync();assert.throws(()=>f.produce(),undefined,`${key}=${value}`);
  }
  const f=fixture(t);f.map[`${prefix}/git/ref/heads/main`].object.sha='b'.repeat(40);assert.throws(()=>f.produce(),/no longer current main/);
});
test('payload, current attempt and required job must match independently read facts',t=>{
  const f=fixture(t);f.map[`${prefix}/actions/runs/100`].run_attempt=2;assert.throws(()=>f.produce(),/attempt/);
  f.sync();f.jobRecords[100][0].conclusion='failure';f.sync();assert.throws(()=>f.produce(),/required CI job/);
  f.jobRecords[100][0].conclusion='success';f.sync();const event=f.event(f.ci);event.workflow_run.updated_at=timestamp(-3479);assert.throws(()=>verifyPriceCiProducer({root:f.root,event,execution:f.execution(PRICE_CI.producer),api:f.api,now}),/payload/);
});
test('active caller progress timestamp may advance without relaxing completed-source clocks',t=>{
  const f=fixture(t);f.map[`${prefix}/actions/runs/200`].updated_at=timestamp(-3390);assert.equal(f.produce().repair,true);
  f.map[`${prefix}/actions/runs/100`].updated_at=timestamp(-3479);assert.throws(()=>f.produce(),/current\/original attempt/);
});
test('a prior failed caller consumes the finite activation; attempt2 and duplicate winners reject',t=>{
  const f=fixture(t);f.records.producer.push({...f.producer,id:199,status:'completed',conclusion:'failure'});f.sync();assert.throws(()=>f.produce(),/consumed/);
  f.records.producer.splice(1);f.producer.run_attempt=2;f.sync();assert.throws(()=>f.produce(),/attempt/);
});
test('incomplete and duplicate API inventories fail closed',t=>{
  const f=fixture(t),endpoint=`${prefix}/actions/workflows/${PRICE_CI.ci.id}/runs?branch=main&event=push&head_sha=${f.head}&per_page=100`;
  f.map[endpoint][0].total_count=101;assert.throws(()=>f.produce(),/inventory/);
  f.sync();f.map[endpoint][0].workflow_runs.push(copy(f.ci));f.map[endpoint][0].total_count=2;assert.throws(()=>f.produce(),/duplicate/);
});
test('exact activated CI and competing events hold publication without entering renewal',t=>{
  const f=fixture(t);assert.deepEqual(f.route(f.ci),{price_wait:true,price_source:false});
  assert.deepEqual(f.route({...f.ci,path:'.github/workflows/design-acceptance.yml'}),{price_wait:true,price_source:false});
  assert.deepEqual(f.route({...f.producer,event:'schedule'}),{price_wait:true,price_source:false});
});
test('only a completed genuine source creates an unforgeable immutable completion proof',t=>{
  const f=fixture(t);assert.throws(()=>f.source(),/terminal success/);f.finish();const proof=f.source();
  assert(isVerifiedPriceSourceProof(proof,{sourceRunId:200,controllerSha:f.head,controllerTree:f.tree}));
  assert(!isVerifiedPriceSourceProof(copy(proof)));assert(!isVerifiedPriceSourceProof({...proof,verified:true}));assert(!isVerifiedPriceSourceProof(proof,{sourceRunId:201}));
  assert.throws(()=>{proof.producer.id=999;},TypeError);assert.deepEqual(f.route(f.producer),{price_wait:false,price_source:true,source_run_id:200,source_run_attempt:1});
});
test('missing repair/build/upload success and changed source attempt reject',t=>{
  for(const name of ['Build static frontend',PRICE_REPAIR_STEP,'Upload verified data export']){const f=fixture(t);f.finish();f.sourceJob.steps.find(s=>s.name===name).conclusion='skipped';f.sync();assert.throws(()=>f.source(),/producer step/);}
  const f=fixture(t);f.finish();f.map[`${prefix}/actions/runs/200`].run_attempt=2;assert.throws(()=>f.source(),/attempt/);
});
test('publisher permits only independently proven earlier hold callers',t=>{
  const f=fixture(t);f.finish();const held={...f.publisher,id:300,status:'completed',conclusion:'success',updated_at:timestamp(-3280)};f.records.publisher.unshift(held);
  const base={run_id:300,run_attempt:1,head_sha:f.head,status:'completed',started_at:held.run_started_at,completed_at:held.updated_at};
  f.jobRecords[300]=[{...base,id:3000,name:'Route exact renewal CI admission',conclusion:'success',steps:[{name:PRICE_HOLD_STEP,status:'completed',conclusion:'success'}]},{...base,id:3001,name:'publish',conclusion:'skipped',steps:[]}];f.sync();assert.equal(f.route(f.producer).price_source,true);
  f.jobRecords[300][1].conclusion='success';f.sync();assert.throws(()=>f.route(f.producer),/no-publication hold/);
});
test('reviewed request-only disable restores ordinary routing and revokes in-process source proof use',t=>{
  const f=fixture(t);f.finish();const proof=f.source();assert(isVerifiedPriceSourceProof(proof));
  const enabledBody=JSON.parse(readFileSync(join(f.root,PRICE_REQUEST_PATH))),disabled={...enabledBody,enabled:false,activation:null};
  f.write(PRICE_REQUEST_PATH,disabled);f.git('add',PRICE_REQUEST_PATH);f.git('commit','-qm','request-only disable after successful publication');
  assert.equal(f.git('diff','--name-only',f.head,'HEAD'),PRICE_REQUEST_PATH);
  assert.deepEqual({...disabled,enabled:enabledBody.enabled,activation:enabledBody.activation},enabledBody);
  const noApi=()=>assert.fail('Disabled route must return to ordinary routing without finite API work');
  assert.deepEqual(routePricePublication({root:f.root,event:f.event(f.ci),api:noApi,now}),{price_wait:false,price_source:false});
  assert.deepEqual(verifyPriceCiProducer({root:f.root,event:f.event(f.ci),api:noApi,now}),{status:'disabled',repair:false});
  assert.throws(()=>verifyPriceSourceCompletion({root:f.root,sourceRun:f.producer,api:noApi,now}),/request is disabled/);
  assert(!isVerifiedPriceSourceProof(proof));assert(!isVerifiedPriceSourceProof(copy(proof)));
});
test('real publisher checkout/build paths remain outside the immutable clean controller',t=>{
  const f=fixture(t);f.finish();const temp=mkdtempSync(join(tmpdir(),'finite-controller-')),clean=join(temp,'retained-price-controller');
  t.after(()=>rmSync(temp,{recursive:true,force:true}));f.git('worktree','add','--detach',clean,f.head);
  f.write('release/frontend/dist/static-data/generated.json','{}');
  assert.throws(()=>f.source(),/untracked/);
  const saved=Object.fromEntries(['RUNNER_TEMP','GITHUB_WORKSPACE','RETAINED_PRICE_CONTROLLER_ROOT'].map(k=>[k,process.env[k]]));
  t.after(()=>{for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  Object.assign(process.env,{RUNNER_TEMP:temp,GITHUB_WORKSPACE:f.root,RETAINED_PRICE_CONTROLLER_ROOT:clean});
  assert.equal(priceControllerRoot(),clean);
  const proof=verifyPriceSourceCompletion({sourceRun:f.producer,api:f.api,now});assert(isVerifiedPriceSourceProof(proof));
  writeFileSync(join(clean,'rogue.js'),'untracked');assert.throws(()=>verifyPriceSourceCompletion({sourceRun:f.producer,api:f.api,now}),/untracked/);rmSync(join(clean,'rogue.js'));
  writeFileSync(join(clean,PRICE_REQUEST_PATH),'{}');assert.throws(()=>verifyPriceSourceCompletion({sourceRun:f.producer,api:f.api,now}),/request envelope/);
  execFileSync('git',['checkout','--',PRICE_REQUEST_PATH],{cwd:clean});
  process.env.RETAINED_PRICE_CONTROLLER_ROOT=f.root;assert.throws(()=>priceControllerRoot(),/unexpected clean controller path/);
  process.env.RETAINED_PRICE_CONTROLLER_ROOT=clean;f.git('worktree','remove','--force',clean);symlinkSync(f.root,clean,'dir');assert.throws(()=>priceControllerRoot(),/linked/);
});
