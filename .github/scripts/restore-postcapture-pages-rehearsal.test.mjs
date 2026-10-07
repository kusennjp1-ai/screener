import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonicalBytes,generationBody} from '../../frontend/src/static/transport/format.mjs';
import {pinnedCarryContinuation,requiredGitDependencies} from './restore-postcapture-pages-rehearsal.mjs';
import {ensurePinnedGitObjects, measureRuntimeUsage, verifyPreservedControls, inspectArchiveMetadata, measureLogicalMetadata, pinnedContract, requireStorageBudget, restoreRehearsalInputs,
  sha256, verifyPinnedZip, verifyRehearsalInputs, verifyStableEvidence} from './restore-postcapture-pages-rehearsal.mjs';

const c = pinnedContract(), prefix = `repos/${c.repository}/`, clock = Date.parse('2026-10-06T17:10:00Z');
function fixture() {
  const responses = new Map(), calls = [];
  const context = {repository:c.repository,branch:c.caller.branch,event:'push',id:80000000000,attempt:1,sha:'a'.repeat(40)};
  const checkout = () => ({head:context.sha,tree:'b'.repeat(40),clean:true});
  const put = (endpoint,value,pages=false) => responses.set(`${pages?'GET_PAGES':'GET'} ${endpoint}`,value);
  const repo = {id:c.repository_id,full_name:c.repository,default_branch:'main'};
  const caller = {id:context.id,head_sha:context.sha,run_attempt:1,head_branch:context.branch,path:c.caller.workflow,event:'push',
    status:'in_progress',conclusion:null,repository:repo,head_repository:repo,head_commit:{id:context.sha,tree_id:checkout().tree}};
  const tree = (head,treeSha,parent=[]) => {put(`${prefix}git/commits/${head}`,{sha:head,tree:{sha:treeSha},parents:parent.map(sha => ({sha}))});
    put(`${prefix}git/trees/${treeSha}?recursive=1`,{sha:treeSha,truncated:false,tree:[{path:'README.md',sha:'c'.repeat(40),type:'blob',mode:'100644'}]});};
  put(`${prefix}actions/runs/${context.id}`,caller);
  put(`${prefix}git/ref/heads/${context.branch}`,{object:{sha:context.sha}});
  put(`${prefix}git/ref/heads/main`,{object:{sha:c.caller.first_parent}});
  tree(context.sha,checkout().tree,[c.caller.first_parent]);tree(c.caller.first_parent,c.caller.base_tree);
  put(`${prefix}actions/runs/${context.id}/attempts/1/jobs?per_page=100`,{total_count:1,jobs:[{id:80000000001,name:c.caller.job,run_id:context.id,run_attempt:1,head_sha:context.sha,status:'in_progress',conclusion:null}]});
  for (const [role,pin] of Object.entries(c.inputs)) {
    const run = {id:pin.run_id,run_attempt:pin.run_attempt,run_number:pin.run_number,head_sha:pin.head_sha,head_branch:pin.branch,
      path:pin.workflow,workflow_id:pin.workflow_id,event:pin.event,status:'completed',conclusion:pin.conclusion,repository:repo,
      head_repository:repo,head_commit:{id:pin.head_sha,tree_id:pin.tree_sha},run_started_at:'2026-10-06T17:00:00Z'};
    const endpoint = `${prefix}actions/runs/${pin.run_id}`;
    put(`${endpoint}/attempts/${pin.run_attempt}`,run);put(endpoint,run);
    const jobs = {total_count:pin.jobs.length,jobs:pin.jobs.map(j => ({...j,run_id:pin.run_id,run_attempt:pin.run_attempt,head_sha:pin.head_sha,
      status:'completed',started_at:'2026-10-06T17:01:00Z',completed_at:'2026-10-06T17:03:00Z',steps:role === 'failed-source' ?
        [{number:10,name:c.failure_boundary.step_name,conclusion:'failure',status:'completed'}] : role === 'pages' ? [{name:'Deploy to GitHub Pages',conclusion:'success',started_at:'2026-10-06T17:02:15Z',completed_at:'2026-10-06T17:02:45Z'}] : []}))};
    put(`${endpoint}/attempts/${pin.run_attempt}/jobs?per_page=100`,jobs);put(`${endpoint}/attempts/${pin.run_attempt}/jobs?per_page=100`,[jobs],true);
    const artifacts = {total_count:1,artifacts:[{id:pin.artifact_id,name:pin.artifact_name,size_in_bytes:pin.zip_bytes,digest:`sha256:${pin.artifact_sha256}`,
      expired:false,expires_at:'2026-10-20T17:00:00Z',created_at:'2026-10-06T17:02:00Z',workflow_run:{id:pin.run_id,head_sha:pin.head_sha,head_branch:pin.branch,repository_id:c.repository_id,head_repository_id:c.repository_id}}]};
    put(`${endpoint}/artifacts?per_page=100`,artifacts);put(`${endpoint}/artifacts?per_page=100`,[artifacts],true);
    tree(pin.head_sha,pin.tree_sha);put(`${prefix}git/ref/heads/${pin.branch}`,{object:{sha:pin.head_sha}});
  }
  put(`${prefix}git/ref/heads/main`,{object:{sha:c.caller.first_parent}});
  for (const [sha,value] of Object.entries(c.git_objects)) tree(sha,value);put(`repos/${c.repository}`,repo);
  for (const file of ['research-ui-release.yml','static-site.yml']) put(`${prefix}actions/workflows/${file}/runs?branch=main&per_page=100`,[{total_count:0,workflow_runs:[]}],true);
  for (const p of c.supplementary_endpoints) if (!responses.has(`${p.paginate?'GET_PAGES':'GET'} ${p.endpoint}`)) put(p.endpoint,p.paginate?[{total_count:0,[p.endpoint.includes('/artifacts?')?'artifacts':'jobs']:[]}]:{recorded:true},p.paginate);
  const api = (endpoint,pages=false) => {const key=`${pages?'GET_PAGES':'GET'} ${endpoint}`;calls.push(key);assert.ok(responses.has(key),`Unrecorded API request ${key}`);return structuredClone(responses.get(key));};
  return {context,checkout,api,responses,calls,read:() => verifyRehearsalInputs(context,api,checkout,() => clock)};
}
const mutate = (f,endpoint,fn,pages=false) => fn(f.responses.get(`${pages?'GET_PAGES':'GET'} ${prefix}${endpoint}`));

test('each explicit stage authenticates its own job clock while earlier jobs are retained',()=>{
  for(const stage of ['seal','publish','carry']){
    const f=fixture();f.context.stage=stage;
    const jobs=Object.entries(c.caller.staged_jobs).map(([key,name],i)=>({id:80000000001+i,name,run_id:f.context.id,run_attempt:1,head_sha:f.context.sha,status:key===stage?'in_progress':'completed',conclusion:key===stage?null:'success',started_at:`2026-10-06T17:0${i}:00Z`}));
    f.responses.set(`GET ${prefix}actions/runs/${f.context.id}/attempts/1/jobs?per_page=100`,{total_count:jobs.length,jobs});
    assert.equal(f.read().caller.job.name,c.caller.staged_jobs[stage]);
    jobs.find(job=>job.name===c.caller.staged_jobs[stage]).status='completed';assert.throws(f.read,/job identity changed/);
  }
  const f=fixture();f.context.stage='unknown';assert.throws(f.read,/Invalid rehearsal stage/);
});

test('actual remote certificate reference is required; historical local review annotation is not fetched',()=>{
  const c=pinnedContract(),required=requiredGitDependencies(c),annotation='16145829c9f06a51a5404a4044229b32b638c3c6';
  const request=JSON.parse(readFileSync(new URL('../../contracts/financial_source_postcapture_request_v1.json',import.meta.url)));
  const trust=JSON.parse(readFileSync(new URL('../../contracts/financial_source_certification_trust_v1.json',import.meta.url)));
  assert.equal(trust.reviewed_requests.find(entry=>entry.tree_sha==='16accf63ff4caef0da2adae8f4f9bbe46c913886').reviewed_commit,annotation);
  assert.equal(request.frozen_validator.reviewed_commit,annotation);
  assert.equal(Object.keys(required).length,7);assert.equal(Object.hasOwn(required,annotation),false);
  assert.equal(required['2a8f31dac1192850ea690392273f006ed58a396f'],'16accf63ff4caef0da2adae8f4f9bbe46c913886');
  const f=fixture();f.read();assert.equal(f.calls.some(call=>call.includes(annotation)),false);
  const expanded=structuredClone(c);expanded.git_objects[annotation]='16accf63ff4caef0da2adae8f4f9bbe46c913886';
  assert.throws(()=>requiredGitDependencies(expanded),/dependencies exactly/);
  for(const head of Object.keys(required)){
    const missing=structuredClone(c);delete missing.git_objects[head];assert.throws(()=>requiredGitDependencies(missing),/dependencies exactly/);
  }
  const relabeled=structuredClone(c);relabeled.inputs['old-cert'].head_sha=annotation;
  assert.throws(()=>requiredGitDependencies(relabeled),/original source\/certificate references/);
});

test('records exact source failure separately from companion success without publication authority', () => {
  const f=fixture(),value=f.read();assert.equal(value.selected['failed-source'].run.conclusion,'failure');
  assert.equal(value.selected.companion.run.conclusion,'success');assert.equal(value.publication_authority,false);
  assert.ok(Object.keys(value.responses).some(k => k.startsWith('GET_PAGES ')));
  assert.equal(value.response_sha256[`GET ${prefix}actions/runs/37478731832`],sha256(JSON.stringify(value.selected['failed-source'].run)));
});
test('new main135 parent and closed-price controls are exact while #99 retains its original producer',()=>{
  assert.equal(c.caller.first_parent,'1356148aecb8dc03b01fda103d2dd416cce05db6');
  assert.equal(c.caller.base_tree,'b39d5283d77c85cba454add980ea3c2c472232be');
  assert.equal(c.inputs.pages.head_sha,'8a490df5b0a873637781a8e4e5351cece9313f37');
  for(const path of ['.github/daily-price-promotion.json','.github/workflows/static-site.yml','backend/app/scripts/publish_daily_price_bundle.py','backend/app/services/close_price_contract.py'])assert.ok(c.preserved_controls[path]);
  assert.equal(JSON.parse(readFileSync(new URL('../daily-price-promotion.json',import.meta.url))).enabled,false);
  const f=fixture();f.read();assert.ok(f.calls.includes(`GET ${prefix}git/commits/${c.caller.first_parent}`));
  const bad=fixture();mutate(bad,`git/commits/${c.caller.first_parent}`,v=>v.tree.sha='f'.repeat(40));assert.throws(bad.read,/Pinned commit\/tree/);
});
for (const [label,edit,pattern] of [
  ['alternate branch',f => {f.context.branch='main';},/caller context/],
  ['rerun caller',f => {f.context.attempt=2;},/caller context/],
  ['unclean checkout',f => {f.checkout=() => ({head:f.context.sha,tree:'b'.repeat(40),clean:false});},/checkout/],
  ['moved branch',f => mutate(f,`git/ref/heads/${c.caller.branch}`,v => v.object.sha='c'.repeat(40)),/branch moved/],
  ['moved main',f => mutate(f,'git/ref/heads/main',v => v.object.sha='c'.repeat(40)),/main changed/],
  ['wrong caller parent',f => mutate(f,'git/commits/'+'a'.repeat(40),v => v.parents[0].sha='c'.repeat(40)),/direct reviewed-main/],
  ['forked source',f => mutate(f,'actions/runs/37478731832/attempts/1',v => v.head_repository={id:2,full_name:'fork/screener'}),/terminal run/],
  ['ordinary source falsely successful',f => mutate(f,'actions/runs/37478731832/attempts/1',v => v.conclusion='success'),/terminal run/],
  ['ordinary failure at another step',f => mutate(f,'actions/runs/37478731832/attempts/1/jobs?per_page=100',v => v.jobs[0].steps[0].number=11),/failed source boundary/],
  ['later source retry',f => mutate(f,'actions/runs/37478731832',v => v.run_attempt=2),/terminal run|retried/],
  ['wrong terminal job',f => mutate(f,'actions/runs/37495003542/attempts/1/jobs?per_page=100',v => v.jobs[0].id++),/terminal job/],
  ['incomplete inventory',f => mutate(f,'actions/runs/37495003542/artifacts?per_page=100',v => v.total_count++),/Incomplete/],
  ['duplicate artifact name',f => mutate(f,'actions/runs/37495003542/artifacts?per_page=100',v => {v.artifacts.push({...v.artifacts[0],id:7});v.total_count++;}),/ambiguous/],
  ['wrong artifact digest',f => mutate(f,'actions/runs/37495003542/artifacts?per_page=100',v => v.artifacts[0].digest='sha256:'+'0'.repeat(64)),/artifact identity/],
  ['expired artifact',f => mutate(f,'actions/runs/37495003542/artifacts?per_page=100',v => v.artifacts[0].expired=true),/artifact identity/],
  ['expired artifact timestamp',f => mutate(f,'actions/runs/37495003542/artifacts?per_page=100',v => v.artifacts[0].expires_at='2026-10-01T00:00:00Z'),/expiry/],
  ['wrong artifact origin',f => mutate(f,'actions/runs/37495003542/artifacts?per_page=100',v => v.artifacts[0].workflow_run.head_repository_id=99),/artifact identity/],
  ['wrong captured Git tree',f => mutate(f,`git/commits/${c.inputs.companion.head_sha}`,v => v.tree.sha='c'.repeat(40)),/commit\/tree/],
  ['truncated captured tree',f => mutate(f,`git/trees/${c.inputs.companion.tree_sha}?recursive=1`,v => v.truncated=true),/Incomplete pinned/],
  ['wrong closed source branch',f => mutate(f,`git/ref/heads/${c.inputs['failed-source'].branch}`,v => v.object.sha='c'.repeat(40)),/closed branch/],
  ['truncated publication history',f => mutate(f,'actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100',v => v[0].total_count=1,true),/Truncated publication/],
  ['newer successful publisher',f => mutate(f,'actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100',v => {const r=structuredClone(f.responses.get(`GET ${prefix}actions/runs/37456692717`));r.id++;r.updated_at='2026-10-06T17:05:00Z';v[0]={total_count:1,workflow_runs:[r]};f.responses.set(`GET_PAGES ${prefix}actions/runs/${r.id}/jobs?filter=all&per_page=100`,[{total_count:1,jobs:[{id:80000000002,run_attempt:1,steps:[{name:'Deploy to GitHub Pages',conclusion:'success',completed_at:'2026-10-06T17:04:00Z'}]}]}]);},true),/newer or changed/],
]) test(`rejects ${label}`,() => {const f=fixture();edit(f);assert.throws(() => verifyRehearsalInputs(f.context,f.api,f.checkout,() => clock),pattern);});
test('missing explicit API fixture fails closed without a live fallback', () => {
  const f=fixture();f.responses.delete(`GET ${prefix}actions/runs/37456692717`);assert.throws(f.read,/Unrecorded API/);
});
test('before/after terminal and pagination mutations fail closed', () => {
  const f=fixture(),before=f.read(),after=structuredClone(before);verifyStableEvidence(before,after);
  after.selected.companion.run.head_sha='c'.repeat(40);assert.throws(() => verifyStableEvidence(before,after),/Pinned evidence/);
  const pages=structuredClone(before);pages.responses[`GET_PAGES ${prefix}actions/workflows/static-site.yml/runs?branch=main&per_page=100`]=[];
  assert.throws(() => verifyStableEvidence(before,pages),/API evidence/);
});

function scheduledFixture() {
  const f=fixture(),run=structuredClone(f.responses.get(`GET ${prefix}actions/runs/37456692717`));
  Object.assign(run,{id:37548275000,head_sha:c.caller.first_parent,path:'.github/workflows/static-site.yml',
    event:'schedule',updated_at:'2026-10-06T17:05:00Z',status:'in_progress',conclusion:null});
  const job={id:80000000002,run_id:run.id,run_attempt:1,head_sha:run.head_sha,name:'build',status:'in_progress',
    conclusion:null,started_at:'2026-10-06T17:01:00Z',completed_at:null,
    steps:[{number:8,name:'Export static data',status:'in_progress',conclusion:null}]};
  f.responses.set(`GET_PAGES ${prefix}actions/workflows/static-site.yml/runs?branch=main&per_page=100`,[{total_count:1,workflow_runs:[run]}]);
  f.responses.set(`GET_PAGES ${prefix}actions/runs/${run.id}/jobs?filter=all&per_page=100`,[{total_count:1,jobs:[job]}]);
  return {...f,run,job};
}
test('unrelated scheduled full Static Site progress does not change pinned deployment evidence',()=>{
  const f=scheduledFixture(),before=f.read();
  Object.assign(f.job.steps[0],{status:'completed',conclusion:'success',completed_at:'2026-10-06T17:06:00Z'});
  Object.assign(f.job,{status:'completed',conclusion:'failure',completed_at:'2026-10-06T17:07:00Z'});
  Object.assign(f.run,{status:'completed',conclusion:'failure',updated_at:'2026-10-06T17:07:00Z'});
  const after=f.read();verifyStableEvidence(before,after);
  assert.notDeepEqual(before.responses,after.responses,'fresh after-evidence retains actual progress, never normalized replay bytes');
});
test('a newly created downstream job without successful deployment is ordinary progress',()=>{
  const f=scheduledFixture(),before=f.read(),key=`GET_PAGES ${prefix}actions/runs/${f.run.id}/jobs?filter=all&per_page=100`;
  const page=f.responses.get(key)[0];page.jobs.push({...f.job,id:f.job.id+1,name:'downstream',steps:[]});page.total_count++;
  verifyStableEvidence(before,f.read());
});
test('a new main publication run without successful deployment has fresh complete jobs but no new authority',()=>{
  const f=scheduledFixture(),before=f.read(),newRun={...f.run,id:f.run.id+1};
  const history=f.responses.get(`GET_PAGES ${prefix}actions/workflows/static-site.yml/runs?branch=main&per_page=100`)[0];
  history.workflow_runs.push(newRun);history.total_count++;
  const key=`GET_PAGES ${prefix}actions/runs/${newRun.id}/jobs?filter=all&per_page=100`;
  f.responses.set(key,[{total_count:0,jobs:[]}]);verifyStableEvidence(before,f.read());
  f.responses.delete(key);assert.throws(f.read,/Unrecorded API/);
});
test('a new downstream job cannot hide a successful deployment inside an otherwise failed run',()=>{
  const f=scheduledFixture();f.read();f.run.status='completed';f.run.conclusion='failure';
  const page=f.responses.get(`GET_PAGES ${prefix}actions/runs/${f.run.id}/jobs?filter=all&per_page=100`)[0];
  page.jobs.push({...f.job,id:f.job.id+1,name:'downstream',conclusion:'failure',steps:[{number:1,name:'Deploy to GitHub Pages',
    conclusion:'success',completed_at:'2026-10-06T17:07:00Z'}]});page.total_count++;
  assert.throws(f.read,/newer or changed/);
});
test('a newly discovered older successful deployment and a removed deployment both change the complete authority proof',()=>{
  const f=scheduledFixture(),before=f.read();
  f.job.steps.push({number:12,name:'Deploy to GitHub Pages',conclusion:'success',completed_at:'2026-10-06T17:02:00Z'});
  const withOlderDeployment=f.read();assert.throws(()=>verifyStableEvidence(before,withOlderDeployment),/Successful deployment API evidence/);
  const history=f.responses.get(`GET_PAGES ${prefix}actions/workflows/static-site.yml/runs?branch=main&per_page=100`)[0];
  history.workflow_runs=[];history.total_count=0;
  assert.throws(()=>verifyStableEvidence(withOlderDeployment,f.read()),/Successful deployment API evidence/);
});
test('publication-only normalization never exempts unknown endpoints or repository artifact catalogues',()=>{
  const f=scheduledFixture(),before=f.read(),extra=structuredClone(before);
  extra.responses[`GET_PAGES ${prefix}actions/runs/999/jobs?filter=all&per_page=100`]=[{total_count:0,jobs:[]}];
  assert.throws(()=>verifyStableEvidence(before,extra),/API evidence inventory/);
  const catalog=structuredClone(before);catalog.responses[`GET_PAGES ${prefix}actions/artifacts?per_page=100`]=[{total_count:1,artifacts:[{id:999}]}];
  assert.throws(()=>verifyStableEvidence(before,catalog),/API evidence changed/);
});
for(const conclusion of ['failure',null,'success'])test(`a new successful deploy is rejected despite enclosing run conclusion ${conclusion}`,()=>{
  const f=scheduledFixture();f.read();f.run.conclusion=conclusion;f.job.conclusion=conclusion;
  f.job.steps.push({number:12,name:'Run actions/deploy-pages@v4',status:'completed',conclusion:'success',
    started_at:'2026-10-06T17:06:00Z',completed_at:'2026-10-06T17:07:00Z'});
  assert.throws(f.read,/newer or changed/);
});
for(const [label,edit] of [
  ['step identity',f=>f.job.steps.at(-1).number++],
  ['step name',f=>f.job.steps.at(-1).name='Run actions/deploy-pages@v4'],
  ['successful evidence removed',f=>f.job.steps.at(-1).conclusion='failure'],
  ['deployment clock',f=>f.job.steps.at(-1).completed_at='2026-10-06T17:02:01Z'],
  ['job start clock',f=>f.job.started_at='2026-10-06T17:00:59Z'],
  ['head',f=>f.run.head_sha='f'.repeat(40)],
  ['run attempt',f=>f.run.run_attempt=2],
  ['job attempt',f=>f.job.run_attempt=2],
  ['job identity',f=>f.job.id++],
])test(`semantic comparison retains ${label} even if latest deployment ID is unchanged`,()=>{
  const f=scheduledFixture();f.job.steps.push({number:12,name:'Deploy to GitHub Pages',status:'completed',conclusion:'success',
    started_at:'2026-10-06T17:01:30Z',completed_at:'2026-10-06T17:02:00Z'});
  const before=f.read();edit(f);assert.throws(()=>verifyStableEvidence(before,f.read()),/API evidence|Deployment authority/);
});
test('deployment ambiguity and missing all-attempt history still fail closed',()=>{
  const f=scheduledFixture();f.job.steps.push({number:12,name:'Deploy to GitHub Pages',conclusion:'success',completed_at:'2026-10-06T17:02:45Z'});
  assert.throws(f.read,/ambiguous/);
  f.job.steps.pop();const before=f.read();
  f.responses.get(`GET_PAGES ${prefix}actions/runs/${f.run.id}/jobs?filter=all&per_page=100`)[0].total_count++;
  assert.throws(f.read,/Incomplete paginated jobs/);
  const after=structuredClone(before);delete after.responses[`GET_PAGES ${prefix}actions/runs/${f.run.id}/jobs?filter=all&per_page=100`];
  assert.throws(()=>verifyStableEvidence(before,after),/Missing publication API evidence/);
});
test('both snapshots retain complete publication pagination and reject a missing or contradictory later page',()=>{
  const f=scheduledFixture(),endpoint=`GET_PAGES ${prefix}actions/workflows/static-site.yml/runs?branch=main&per_page=100`;
  const older={...f.run,id:f.run.id-1,updated_at:'2026-10-06T16:00:00Z'};
  const pages=[{total_count:2,workflow_runs:[f.run]},{total_count:2,workflow_runs:[older]}];f.responses.set(endpoint,pages);
  const before=f.read();f.job.steps[0].status='completed';verifyStableEvidence(before,f.read());
  pages[1].total_count=1;assert.throws(f.read,/Incomplete publication history/);pages[1].total_count=2;
  pages.pop();assert.throws(f.read,/Truncated publication history/);
});
test('second snapshot rejects source retries, changed artifacts, main races and wall-clock expiry',()=>{
  for(const edit of [
    f=>mutate(f,`actions/runs/${c.inputs.companion.run_id}`,v=>v.run_attempt++),
    f=>mutate(f,`actions/runs/${c.inputs.companion.run_id}/artifacts?per_page=100`,v=>v.artifacts[0].digest='sha256:'+'f'.repeat(64)),
    f=>mutate(f,'git/ref/heads/main',v=>v.object.sha='f'.repeat(40)),
  ]) {const f=scheduledFixture();f.read();edit(f);assert.throws(f.read,/retried|terminal run|artifact identity|main changed/);}
  const f=scheduledFixture();f.read();
  assert.throws(()=>verifyRehearsalInputs(f.context,f.api,f.checkout,()=>Date.parse('2026-10-20T17:00:00Z')),/expiry/);
});

function continuationFixture() {
  const f=fixture(),pin=pinnedCarryContinuation(),terminal=JSON.parse(readFileSync(new URL('./fixtures/postcapture-carry-terminal.json',import.meta.url)));
  f.context.branch=pin.caller.branch;f.context.stage='carry-continuation';
  const caller=f.responses.get(`GET ${prefix}actions/runs/${f.context.id}`);caller.head_branch=pin.caller.branch;caller.path=pin.caller.workflow;
  f.responses.set(`GET ${prefix}git/ref/heads/${pin.caller.branch}`,{object:{sha:f.context.sha}});
  f.responses.get(`GET ${prefix}actions/runs/${f.context.id}/attempts/1/jobs?per_page=100`).jobs[0].name=pin.caller.job;
  const endpoint=`${prefix}actions/runs/${pin.checkpoint.run_id}`;
  f.responses.set(`GET ${endpoint}`,terminal.run);f.responses.set(`GET ${endpoint}/attempts/1`,terminal.run);
  for(const [suffix,key]of [['/attempts/1/jobs?per_page=100','jobs'],['/artifacts?per_page=100','artifacts']]) {
    f.responses.set(`GET ${endpoint}${suffix}`,terminal[key]);f.responses.set(`GET_PAGES ${endpoint}${suffix}`,[terminal[key]]);
  }
  f.responses.set(`GET ${prefix}git/commits/${pin.runtime.commit}`,{sha:pin.runtime.commit,tree:{sha:pin.runtime.tree},parents:[{sha:c.caller.first_parent}]});
  f.responses.set(`GET ${prefix}git/trees/${pin.runtime.tree}?recursive=1`,{sha:pin.runtime.tree,truncated:false,tree:[{path:'README.md'}]});
  f.read=()=>verifyRehearsalInputs(f.context,f.api,f.checkout,()=>Date.parse('2026-10-07T00:00:00Z'));
  return {...f,pin,terminal};
}
test('carry continuation has its own first-attempt caller and preserves the literal failed source and successful publish job',()=>{
  const f=continuationFixture(),before=f.read(),after=f.read();verifyStableEvidence(before,after);
  assert.equal(before.selected['retained-publication'].run.conclusion,'failure');
  assert.equal(before.caller.run.path,'.github/workflows/financial-postcapture-pages-carry.yml');
  assert.equal(before.selected['retained-publication'].jobs.find(j=>j.id===112533546887).conclusion,'success');
});
for(const [label,edit,pattern]of [
  ['caller retry',f=>f.context.attempt=2,/caller context/],
  ['checkpoint producer retry',f=>f.terminal.run.run_attempt=2,/producer changed or retried/],
  ['relabelled successful producer',f=>f.terminal.run.conclusion='success',/producer changed or retried/],
  ['missing source job',f=>{f.terminal.jobs.jobs.pop();f.terminal.jobs.total_count--;},/job inventory/],
  ['carry failure moved to lifecycle',f=>f.terminal.jobs.jobs[2].steps.find(s=>s.conclusion==='failure').number=10,/step inventory|failure boundary/],
  ['changed checkpoint hash',f=>f.terminal.artifacts.artifacts.find(a=>a.id===11451264138).digest='sha256:'+'f'.repeat(64),/identity or current expiry/],
  ['expired checkpoint',f=>f.terminal.artifacts.artifacts.find(a=>a.id===11451264138).expired=true,/identity or current expiry/],
  ['changed checkpoint creation clock',f=>f.terminal.artifacts.artifacts.find(a=>a.id===11451264138).created_at='2026-10-06T23:53:14Z',/identity or current expiry/],
  ['extra continuation job',f=>{const v=f.responses.get(`GET ${prefix}actions/runs/${f.context.id}/attempts/1/jobs?per_page=100`);v.jobs.push({...v.jobs[0],id:9});v.total_count++;},/exactly one job/],
])test(`carry continuation rejects ${label}`,()=>{const f=continuationFixture();f.read();edit(f);assert.throws(f.read,pattern);});
const measurements = R => ({Z:431871840,P:693289931,L:2034508208,S:491394903,R,availableBytes:15121266196+R});
test('measured budget includes physical and logical copies, sources, runtime and 2 GiB', () => {
  const value=requireStorageBudget(measurements(1000));assert.equal(value.required_bytes,15121267196);assert.equal(value.passed,true);
  assert.throws(() => requireStorageBudget({...measurements(1000),availableBytes:15121267195}),/Insufficient rehearsal/);
});
for (const key of ['Z','P','L','S','R','availableBytes']) test(`budget rejects invalid ${key}`, () => {
  for (const invalid of [NaN,Infinity,-1,Number.MAX_SAFE_INTEGER+1,0.5]) assert.throws(() => requireStorageBudget({...measurements(1000),[key]:invalid}),/Invalid storage/);
});
test('budget rejects absent runtime measurement and logical audit undercount', () => {
  assert.throws(() => requireStorageBudget(measurements(0)),/disagree/);
  assert.throws(() => requireStorageBudget({...measurements(1000),L:1985269560}),/disagree/);
});
test('missing or forged metadata cannot authorize logical-budget estimation', () => {
  assert.throws(() => measureLogicalMetadata({}),/Missing authenticated/);
  assert.throws(() => measureLogicalMetadata({'publication.json':Buffer.from('{}').toString('base64')}),/receipt changed/);
});
function archive(t,entries,{tar=false}={}) {
  const dir=mkdtempSync(join(tmpdir(),'rehearsal-archive-'));t.after(() => rmSync(dir,{recursive:true,force:true}));const path=join(dir,'fixture.zip');
  const program=String.raw`
import io,json,stat,sys,tarfile,zipfile
r=json.load(sys.stdin)
with zipfile.ZipFile(r['path'],'w',compression=zipfile.ZIP_DEFLATED) as z:
 if r['tar']:
  b=io.BytesIO()
  with tarfile.open(fileobj=b,mode='w') as t:
   for e in r['entries']:
    m=tarfile.TarInfo(e['name']);data=e.get('data','x').encode();m.size=len(data)
    if e.get('link'): m.type=tarfile.SYMTYPE;m.linkname='outside';m.size=0
    t.addfile(m,io.BytesIO(data))
  z.writestr('artifact.tar',b.getvalue());print(len(b.getvalue()))
 else:
  for e in r['entries']:
   i=zipfile.ZipInfo(e['name']);i.external_attr=((stat.S_IFLNK if e.get('link') else stat.S_IFREG)|0o644)<<16;z.writestr(i,e.get('data','x'))
  print(0)
`;
  const tarBytes=Number(execFileSync('python',['-c',program],{input:JSON.stringify({path,entries,tar}),encoding:'utf8'}));
  const role=tar?'pages':'source';return {path,request:{[role]:{zip:path,tar_bytes:tarBytes,expanded_files:entries.length,expanded_bytes:entries.reduce((n,e) => n+Buffer.byteLength(e.data??'x'),0)}}};
}
test('metadata scan creates no expanded files', t => {
  const f=archive(t,[{name:'archive/a.json',data:'{}'},{name:'request.json',data:'{}'}]);const value=inspectArchiveMetadata(f.request);
  assert.equal(value.source.bytes,4);assert.equal(value.source.files,2);assert.equal(existsSync(join(dirname(f.path),'archive')),false);
});
for (const [label,entries] of [
  ['traversal',[{name:'../outside'}]],['absolute',[{name:'/outside'}]],['backslash',[{name:'a\\b'}]],['dot component',[{name:'a/./b'}]],
  ['empty component',[{name:'a//b'}]],['drive prefix',[{name:'C:/outside'}]],['control character',[{name:'a\nb'}]],
  ['symlink',[{name:'link',link:true}]],['duplicate normalized path',[{name:'a'},{name:'./a'}]],
  ['file parent collision',[{name:'a'},{name:'a/b'}]],['directory/file collision',[{name:'a/b'},{name:'a'}]],
]) test(`ZIP rejects ${label}`,t => {const f=archive(t,entries);assert.throws(() => inspectArchiveMetadata(f.request),/Unsafe|Linked|Duplicate|collision/);});
test('Pages TAR rejects linked members', t => {const f=archive(t,[{name:'bad',link:true}],{tar:true});assert.throws(() => inspectArchiveMetadata(f.request),/Linked or special/);});
test('archive size inventory mismatch fails before logical decode', t => {
  const f=archive(t,[{name:'a'}]);f.request.source.expanded_bytes++;assert.throws(() => inspectArchiveMetadata(f.request),/Exact expanded archive inventory/);
});
test('ZIP digest, byte size and symlink checks are independent', async t => {
  const f=archive(t,[{name:'a'}]),bytes=readFileSync(f.path),pin={zip_bytes:bytes.length,artifact_sha256:sha256(bytes)};
  await verifyPinnedZip(f.path,pin);await assert.rejects(verifyPinnedZip(f.path,{...pin,zip_bytes:bytes.length-1}),/size\/type/);
  await assert.rejects(verifyPinnedZip(f.path,{...pin,artifact_sha256:'0'.repeat(64)}),/digest/);
  const link=f.path+'.link';symlinkSync(f.path,link);await assert.rejects(verifyPinnedZip(link,pin),/size\/type/);
});
test('insufficient full budget records preflight without extracting',async t => {
  const dir=mkdtempSync(join(tmpdir(),'rehearsal-budget-'));t.after(() => rmSync(dir,{recursive:true,force:true}));const f=fixture();let extracted=0,downloads=0;
  const out=join(dir,'out');await assert.rejects(restoreRehearsalInputs(out,f.context,{api:f.api,checkout:f.checkout,now:() => clock,controls:() => ({}),gitObjects:() => [],
    download:async() => {downloads++;},inspect:async paths => ({request:paths,logical:{logical_bytes:c.storage.logical_bytes},inventories:Object.fromEntries(Object.entries(c.inputs).map(([role,p]) => [role,{bytes:p.expanded_bytes,files:p.expanded_files}]))}),
    runtime:() => ({bytes:1000,roots:[{path:'/checked',allocated_bytes:1000}]}),space:() => 4000000000,extract:() => {extracted++;}}),/Insufficient rehearsal storage/);
  assert.equal(downloads,5);assert.equal(extracted,0);const proof=JSON.parse(readFileSync(join(out,'storage-preflight.json')));
  assert.equal(proof.passed,false);assert.equal(proof.logical_decode_performed,false);assert.equal(existsSync(join(out,'inputs.json')),false);
});
test('a later successful static export without deployment does not replace #99', () => {
  const f=fixture(),run=structuredClone(f.responses.get(`GET ${prefix}actions/runs/37456692717`));
  run.id++;run.path='.github/workflows/static-site.yml';run.updated_at='2026-10-06T17:05:00Z';
  f.responses.set(`GET_PAGES ${prefix}actions/workflows/static-site.yml/runs?branch=main&per_page=100`,[{total_count:1,workflow_runs:[run]}]);
  f.responses.set(`GET_PAGES ${prefix}actions/runs/${run.id}/jobs?filter=all&per_page=100`,[{total_count:1,jobs:[{id:80000000002,run_attempt:1,steps:[{name:'Export static data',conclusion:'success'}]}]}]);
  assert.equal(f.read().selected.pages.run.id,37456692717);
});
test('truncated repository artifact catalogue is rejected', () => {
  const f=fixture();f.responses.set(`GET_PAGES ${prefix}actions/artifacts?per_page=100`,[{total_count:1,artifacts:[]}]);
  assert.throws(f.read,/Incomplete paginated artifacts/);
});
test('authenticated Git objects are checked locally with no fetch when present', () => {
  const evidence=fixture().read(),calls=[];
  const execute=(command,args) => {
    assert.equal(command,'git');const op=args.slice(2);calls.push(op);
    if(op[0]==='remote')return `https://github.com/${c.repository}.git\n`;
    if(op[0]==='cat-file')return '';
    if(op[0]==='show'){const head=op.at(-1);return `${head} ${c.git_objects[head]}\n`;}
    throw Error('Unapproved command');
  };
  const result=ensurePinnedGitObjects(evidence,execute);assert.equal(result.length,Object.keys(c.git_objects).length);
  assert.ok(result.every(r=>!r.fetched));assert.ok(calls.every(a=>a[0]!=='fetch'));
});
test('missing Git objects fetch only exact authenticated SHAs then verify exact trees', () => {
  const evidence=fixture().read(),fetched=[];
  const execute=(command,args) => {
    const op=args.slice(2);assert.equal(command,'git');
    if(op[0]==='remote')return `https://github.com/${c.repository}.git`;
    if(op[0]==='cat-file')throw Error('Object missing');
    if(op[0]==='fetch'){assert.deepEqual(op.slice(0,3),['fetch','--no-tags','origin']);assert.ok(Object.hasOwn(c.git_objects,op[3]));fetched.push(op[3]);return '';}
    if(op[0]==='show'){const head=op.at(-1);return `${head} ${c.git_objects[head]}`;}
    throw Error('Unapproved command');
  };
  assert.ok(ensurePinnedGitObjects(evidence,execute).every(r=>r.fetched));assert.deepEqual(fetched,Object.keys(c.git_objects));
});
test('Git retrieval rejects alternate remotes and unauthenticated object requests', () => {
  const f=fixture(),evidence=f.read();
  assert.throws(()=>ensurePinnedGitObjects(evidence,()=> 'https://example.test/other.git'),/Unreviewed Git object remote/);
  delete evidence.responses[`GET ${prefix}git/commits/${Object.keys(c.git_objects)[0]}`];
  assert.throws(()=>ensurePinnedGitObjects(evidence,()=> `https://github.com/${c.repository}.git`),/Unauthenticated Git object/);
});
test('runtime usage includes the selected venv prefix without resolving its executable', t => {
  const venv=mkdtempSync(join(tmpdir(),'rehearsal-venv-'));t.after(()=>rmSync(venv,{recursive:true,force:true}));
  const selected=join(venv,'bin/python'),seen=[];
  const execute=(command,args)=>{seen.push([command,args]);if(command==='du')return `4096\t${args.at(-1)}\n`;if(command===selected)return venv+'\n';if(command==='python')return '/usr\n';throw Error('Unexpected runtime command');};
  const result=measureRuntimeUsage(execute,{replayPython:selected});assert.ok(result.roots.some(r=>r.path===venv));
  assert.ok(seen.some(([command])=>command===selected));assert.equal(result.bytes,result.roots.length*4096);
});
test('carry runtime usage adds the separate pinned checkout to the measured roots',t=>{
  const root=mkdtempSync(join(tmpdir(),'carry-runtime-budget-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const execute=(command,args)=>command==='du'?`4096\t${args.at(-1)}\n`:'/usr\n';
  const measured=measureRuntimeUsage(execute,{runtimeRoot:root});
  assert.ok(measured.roots.some(r=>r.path===root));assert.equal(measured.bytes,4096*measured.roots.length);
});
test('reviewed initial controls and disabled source policies are preserved', t => {
  const root=mkdtempSync(join(tmpdir(),'rehearsal-controls-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const path of Object.keys(c.preserved_controls)){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),execFileSync('git',['show',`HEAD:${path}`]));}
  const renewal={publication_enabled:false,reviewed_controllers:[],reviewed_consumer_transitions:[]};
  mkdirSync(join(root,'contracts'));writeFileSync(join(root,'contracts/financial_source_renewal_v1.json'),JSON.stringify(renewal));
  writeFileSync(join(root,'contracts/financial_source_postcapture_trust_v1.json'),JSON.stringify({reviewed_requests:[]}));
  assert.equal(verifyPreservedControls(root).production_renewal_enabled,false);
  writeFileSync(join(root,'contracts/financial_source_renewal_v1.json'),JSON.stringify({...renewal,reviewed_consumer_transitions:[{}]}));
  assert.throws(()=>verifyPreservedControls(root),/trust is enabled/);
  writeFileSync(join(root,'contracts/financial_source_renewal_v1.json'),JSON.stringify(renewal));
  writeFileSync(join(root,'contracts/financial_source_postcapture_trust_v1.json'),JSON.stringify({reviewed_requests:[{}]}));
  assert.throws(()=>verifyPreservedControls(root),/trust is enabled/);
  writeFileSync(join(root,Object.keys(c.preserved_controls)[0]),'{}');assert.throws(()=>verifyPreservedControls(root),/initial control changed/);
});
function metadataFixture() {
  const metadata={},hash='1'.repeat(64),format='screener-static-transport-v1',pre='static-data/_financial-audit-transport/';
  const bindings={manifestSha256:hash,uiInventorySha256:hash,financialGeneration:hash,financialLineageSha256:hash,
    sourceCommit:c.inputs.pages.head_sha,appCommit:c.publication.ui_sha,candidateId:hash};
  const entry=bytes=>({bytes,sha256:hash});
  const put=(family,value,prefix='')=>{const bytes=Buffer.from(canonicalBytes(value)),sha=sha256(bytes),path=`static-data/_transport/${family}-${sha}.json`;
    metadata[prefix+path]=bytes.toString('base64');return {path,bytes:bytes.length,sha256:sha};};
  const record=(files,prefix='')=>{
    const logicalInventory=put('logical',{format,files},prefix),physicalInventory={path:`static-data/_transport/physical-${hash}.json`,bytes:1,sha256:hash};
    const shards=Array.from({length:256},(_,i)=>({id:i.toString(16).padStart(2,'0'),path:`static-data/_transport/shard-${hash}.json`,bytes:1,sha256:hash}));
    const body={format,bindings,logicalInventory,physicalInventory,shards},generation=sha256(canonicalBytes(generationBody(body)));
    return {...put('root',{format,generation,bindings,logicalInventory,physicalInventory,shards},prefix),generation,bindings};
  };
  const nested=record({'static-data/manifest.json':entry(7),'static-data/research-details/source-base-a.json':entry(50)},pre);
  const outer=record({'index.html':entry(17),'static-data/manifest.json':entry(7),[pre+'nested-physical.bin']:entry(128)});
  const pub={run_id:c.inputs.pages.run_id,run_attempt:1,ui_sha:c.publication.ui_sha,ui_digest:c.publication.ui_digest,
    transport:{root:outer},financial_audit_transport:{root:nested}};
  const bytes=Buffer.from(JSON.stringify(pub));metadata['publication.json']=bytes.toString('base64');
  const contract=structuredClone(c);contract.publication.bytes=bytes.length;contract.publication.sha256=sha256(bytes);contract.storage.logical_bytes=74+bytes.length;
  return {metadata,contract,outer,nested,pre};
}
test('logical measurement replaces nested physical files with decoded audit and keeps UI and receipt bytes',()=>{
  const f=metadataFixture(),value=measureLogicalMetadata(f.metadata,f.contract);
  assert.equal(value.outer_logical_bytes,152);assert.equal(value.nested_logical_bytes,57);assert.equal(value.nested_physical_bytes,128);
  assert.equal(value.logical_bytes,74+value.publication_bytes);assert.equal(value.logical_files,4);assert.equal(value.logical_decode_performed,false);
});
for(const role of ['outer','nested'])test(`logical measurement rejects ${role} root hash changes`,()=>{
  const f=metadataFixture(),path=(role==='nested'?f.pre:'')+f[role].path;
  f.metadata[path]=Buffer.from('{}').toString('base64');assert.throws(()=>measureLogicalMetadata(f.metadata,f.contract),/root hash\/size/);
});
test('logical measurement rejects missing nested inventory and inventory digest changes',()=>{
  for(const corrupt of [false,true]){
    const f=metadataFixture(),root=JSON.parse(Buffer.from(f.metadata[f.pre+f.nested.path],'base64'));
    const path=f.pre+root.logicalInventory.path;
    if(corrupt)f.metadata[path]=Buffer.from('{}').toString('base64');else delete f.metadata[path];
    assert.throws(()=>measureLogicalMetadata(f.metadata,f.contract),/inventory hash\/size|Missing authenticated/);
  }
});
