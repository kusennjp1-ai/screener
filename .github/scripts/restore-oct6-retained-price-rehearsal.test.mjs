import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const createGitBlob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {allowedAdditions,reviewedHelperChanges,reviewedNewFixtures,digest,ensureApprovedUi,pinnedInputs,pins,recheckRehearsalInputs,restoreRehearsalInputs,verifyControlTree,verifyRehearsalInputs,
  verifyStableEvidence,verifyWorkflowPermissions} from './restore-oct6-retained-price-rehearsal.mjs';

const prefix=`repos/${pins.repository}/`,clock=Date.parse('2026-10-07T01:10:00Z'),inputs=pinnedInputs();
const callerId=80000000000,callerSha='a'.repeat(40),callerTree='b'.repeat(40),workflowBlob='c'.repeat(40);
function fixture() {
  const data=new Map(),calls=[],repo={full_name:pins.repository,id:pins.repository_id,name:'screener',default_branch:'main',private:false,visibility:'public',
    owner:{login:'kusennjp1-ai',id:pins.repository_owner_id},pushed_at:'2026-10-07T01:00:00Z',updated_at:'2026-10-07T01:00:00Z',size:57226,open_issues_count:5,open_issues:5,archived:false};
  const put=(endpoint,value,pages=false)=>data.set(`${pages?'GET_PAGES':'GET'} ${endpoint}`,structuredClone(value));
  const read=(endpoint,pages=false)=>data.get(`${pages?'GET_PAGES':'GET'} ${prefix}${endpoint}`);
  const commit=(head,tree,parent=[])=>{
    put(`${prefix}git/commits/${head}`,{sha:head,tree:{sha:tree},parents:parent.map(sha=>({sha}))});
    put(`${prefix}git/trees/${tree}?recursive=1`,{sha:tree,truncated:false,tree:[{path:'.github/scripts/select-release-source.mjs',type:'blob',mode:'100644',sha:'d'.repeat(40)}]});
  };
  put(`repos/${pins.repository}`,repo);put(`${prefix}git/ref/heads/main`,{ref:'refs/heads/main',object:{type:'commit',sha:pins.reviewed_main}});
  put(`${prefix}git/ref/heads/${pins.branch}`,{object:{sha:callerSha}});
  commit(pins.control_base,pins.control_tree,[pins.control_parent]);commit(callerSha,callerTree,[pins.control_base]);
  read(`git/trees/${callerTree}?recursive=1`).tree.push({path:pins.workflow,type:'blob',mode:'100644',sha:workflowBlob});
  for(const [path,pin] of Object.entries(reviewedHelperChanges)){
    read(`git/trees/${pins.control_tree}?recursive=1`).tree.push({path,type:'blob',mode:'100644',sha:pin.before});
    read(`git/trees/${callerTree}?recursive=1`).tree.push({path,type:'blob',mode:'100644',sha:pin.after});
  }
  for(const [path,sha] of Object.entries(reviewedNewFixtures))read(`git/trees/${callerTree}?recursive=1`).tree.push({path,type:'blob',mode:'100644',sha});
  commit(pins.reviewed_main,pins.reviewed_main_tree);commit(pins.approved_ui.sha,pins.approved_ui.tree);
  read(`git/trees/${pins.approved_ui.tree}?recursive=1`).tree.push({path:'frontend',type:'tree',mode:'040000',sha:pins.approved_ui.frontend_tree});
  const caller={id:callerId,head_sha:callerSha,run_attempt:1,head_branch:pins.branch,path:pins.workflow,event:'push',status:'in_progress',conclusion:null,
    repository:repo,head_repository:repo,head_commit:{id:callerSha,tree_id:callerTree},run_started_at:'2026-10-07T01:00:00Z'};
  put(`${prefix}actions/runs/${callerId}`,caller);put(`${prefix}actions/runs/${callerId}/attempts/1`,caller);
  put(`${prefix}actions/runs/${callerId}/attempts/1/jobs?per_page=100`,[{total_count:1,jobs:[{id:80000000001,name:pins.job,run_id:callerId,run_attempt:1,head_sha:callerSha,
    status:'in_progress',conclusion:null,started_at:'2026-10-07T01:01:00Z',completed_at:null}]}],true);
  for (const role of ['candidate','prior']) {
    const pin=inputs[role],endpoint=`${prefix}actions/runs/${pin.run_id}`,workflowId=role==='candidate'?300000000:364666954;
    put(`${prefix}actions/workflows/${pin.workflow.split('/').at(-1)}`,{id:workflowId,path:pin.workflow});
    const run={id:pin.run_id,run_attempt:1,run_number:role==='prior'?99:100,head_sha:pin.head_sha,head_branch:'main',path:pin.workflow,workflow_id:workflowId,
      event:role==='candidate'?'schedule':'workflow_run',status:'completed',conclusion:'success',repository:repo,head_repository:repo,
      head_commit:{id:pin.head_sha,tree_id:pin.tree_sha},run_started_at:'2026-10-06T01:00:00Z'};
    put(endpoint,run);put(`${endpoint}/attempts/1`,run);
    const steps=role==='candidate'?['Build static frontend','Upload verified data export','Preserve dated export provenance for release selection']:['Run actions/upload-pages-artifact@v4','Deploy to GitHub Pages'];
    const job={id:role==='candidate'?80000000002:112314516098,name:role==='candidate'?'combine-and-build':'publish',run_id:pin.run_id,run_attempt:1,
      head_sha:pin.head_sha,status:'completed',conclusion:'success',started_at:'2026-10-06T01:01:00Z',completed_at:'2026-10-06T01:08:00Z',
      steps:steps.map((name,index)=>({number:index+1,name,status:'completed',conclusion:'success',started_at:`2026-10-06T01:0${index+2}:00Z`,completed_at:`2026-10-06T01:0${index+3}:00Z`}))};
    put(`${endpoint}/attempts/1/jobs?per_page=100`,[{total_count:1,jobs:[job]}],true);
    const artifacts=(role==='candidate'?['candidate','companion']:['prior']).map(archiveRole=>{
      const item=inputs[archiveRole];return {id:item.artifact_id,name:item.artifact_name,expired:false,size_in_bytes:item.zip_bytes,digest:`sha256:${item.artifact_sha256}`,
        created_at:role==='prior'?'2026-10-06T01:02:30Z':'2026-10-06T01:04:00Z',expires_at:'2026-10-12T01:00:00Z',workflow_run:{id:pin.run_id,head_sha:pin.head_sha,head_branch:'main',repository_id:pins.repository_id,head_repository_id:pins.repository_id}};
    });
    put(`${endpoint}/artifacts?per_page=100`,[{total_count:artifacts.length,artifacts}],true);commit(pin.head_sha,pin.tree_sha);
    if(role==='candidate') read(`git/trees/${pin.tree_sha}?recursive=1`).tree.push(
      {path:'.github/workflows/static-site.yml',type:'blob',mode:'100644',sha:'c601578500182f3a3a18dc7e929de1fd03bebaa5'},
      {path:'backend/app/services/static_site_export_service.py',type:'blob',mode:'100644',sha:'358938e52b903ae6bfed4d80a8f73160389ddd1e'});
  }
  const context={repository:pins.repository,branch:pins.branch,event:'push',id:callerId,attempt:1,sha:callerSha};
  const checkout=()=>({head:callerSha,tree:callerTree,clean:true,workflow_blob:workflowBlob});
  const api=(endpoint,pages=false)=>{const key=`${pages?'GET_PAGES':'GET'} ${endpoint}`;calls.push(key);assert.ok(data.has(key),`Unexpected API request ${key}`);return structuredClone(data.get(key));};
  return {data,context,checkout,api,calls,read,verify:()=>verifyRehearsalInputs(context,api,checkout,()=>clock)};
}
const sourceRun=inputs.candidate.run_id,priorRun=inputs.prior.run_id;
const artifacts=f=>f.read(`actions/runs/${sourceRun}/artifacts?per_page=100`,true)[0];
const jobs=f=>f.read(`actions/runs/${sourceRun}/attempts/1/jobs?per_page=100`,true)[0];
const callerJobs=f=>f.read(`actions/runs/${callerId}/attempts/1/jobs?per_page=100`,true)[0];

test('pins the unmodified original archives and emits complete API evidence without publication authority',()=>{
  const f=fixture(),result=f.verify();assert.equal(result.publication_authority,false);assert.equal(result.provider_work,false);
  assert.deepEqual(Object.keys(result.selected),['candidate','companion','prior']);
  assert.equal(result.caller.job_started_at,'2026-10-07T01:01:00Z');assert.deepEqual(result.approved_ui,pins.approved_ui);
  assert.equal(pins.control_base,'1126e7b97782dffabccac7fd48fc55e8215fc923');
  assert.deepEqual(result.reviewed_historical_main,{sha:'22548890d0fe161edf7be3943b1775c4f293d0d9',tree:'8245b42cdff76c1fe51c652227a0eb8d6809cf63'});
  assert.equal(result.current_main_observation.role,'diagnostic_observation_only');
  assert.equal(result.producer_runtime.python_version,'3.11');
  assert.equal(result.producer_runtime.workflow.git_blob_sha,'c601578500182f3a3a18dc7e929de1fd03bebaa5');
  assert.equal(result.producer_runtime.ranking_builder.git_blob_sha,'358938e52b903ae6bfed4d80a8f73160389ddd1e');
  assert.equal(result.producer_runtime.ranking_builder.sha256,'d8316b2ccb45b703becaa850a674ea58aa459a687b2f57214063a502775afa6a');
  assert.equal(inputs.candidate.artifact_id,11461777446);assert.equal(inputs.companion.artifact_id,11461613143);assert.equal(inputs.prior.artifact_id,11421722413);
  for (const [key,value] of Object.entries(result.responses)) assert.equal(result.response_sha256[key],digest(JSON.stringify(value)));
  assert.ok(f.calls.every(call=>/^GET(?:_PAGES)? repos\/kusennjp1-ai\/screener(?:\/|$)/.test(call)));
});

test('authenticates multiple complete inventory pages and an original successful combine job even if a different job failed',()=>{
  const f=fixture(),page=artifacts(f),first=page.artifacts[0],second=page.artifacts[1];
  f.data.set(`GET_PAGES ${prefix}actions/runs/${sourceRun}/artifacts?per_page=100`,[{total_count:2,artifacts:[first]},{total_count:2,artifacts:[second]}]);
  jobs(f).total_count=2;jobs(f).jobs.push({...jobs(f).jobs[0],id:80000000003,name:'other-job',conclusion:'failure'});
  for (const suffix of ['', '/attempts/1']) f.read(`actions/runs/${sourceRun}${suffix}`).conclusion='failure';
  assert.equal(f.verify().selected.candidate.run.conclusion,'failure');
});

for (const [name,mutate,pattern] of [
  ['wrong repository',f=>{f.context.repository='attacker/screener';},/caller/],
  ['repository ownership changed',f=>{f.data.get(`GET repos/${pins.repository}`).owner.login='another-owner';},/Repository identity/],
  ['repository owner ID changed',f=>{f.data.get(`GET repos/${pins.repository}`).owner.id++;},/Repository identity/],
  ['repository became private',f=>{f.data.get(`GET repos/${pins.repository}`).private=true;},/Repository identity/],
  ['repository public visibility changed',f=>{f.data.get(`GET repos/${pins.repository}`).visibility='private';},/Repository identity/],
  ['repository default branch changed',f=>{f.data.get(`GET repos/${pins.repository}`).default_branch='other';},/Repository identity/],
  ['wrong branch',f=>{f.context.branch='main';},/caller/],
  ['manual dispatch',f=>{f.context.event='workflow_dispatch';},/caller/],
  ['caller rerun',f=>{f.context.attempt=2;},/caller/],
  ['caller current rerun',f=>{f.read(`actions/runs/${callerId}`).run_attempt=2;},/caller identity/],
  ['caller historic attempt changed',f=>{f.read(`actions/runs/${callerId}/attempts/1`).head_sha='f'.repeat(40);},/caller identity/],
  ['malformed current main',f=>{f.read('git/ref/heads/main').object.sha='not-a-commit';},/current main observation/],
  ['wrong observed main ref',f=>{f.read('git/ref/heads/main').ref='refs/heads/other';},/current main observation/],
  ['observed main is not a commit',f=>{f.read('git/ref/heads/main').object.type='tag';},/current main observation/],
  ['historical reviewed main tree changed',f=>{f.read(`git/commits/${pins.reviewed_main}`).tree.sha='f'.repeat(40);},/Pinned commit\/tree/],
  ['historical reviewed main identity changed',f=>{f.read(`git/commits/${pins.reviewed_main}`).sha='f'.repeat(40);},/Pinned commit\/tree/],
  ['remote control tree changed',f=>{f.read(`git/commits/${pins.control_base}`).tree.sha='f'.repeat(40);},/Pinned commit\/tree/],
  ['remote control ancestry changed',f=>{f.read(`git/commits/${pins.control_base}`).parents[0].sha='f'.repeat(40);},/remote control parent/],
  ['unpublished local control parent',f=>{f.read(`git/commits/${callerSha}`).parents[0].sha='e4100c3af8e99167dcb5d5c14b4656eb4c3ae614';},/direct child/],
  ['branch moved',f=>{f.read(`git/ref/heads/${pins.branch}`).object.sha='f'.repeat(40);},/branch moved/],
  ['control parent changed',f=>{f.read(`git/commits/${callerSha}`).parents[0].sha=pins.reviewed_main;},/direct child/],
  ['baseline blob changed',f=>{f.read(`git/trees/${callerTree}?recursive=1`).tree[0].sha='f'.repeat(40);},/control-tree file/],
  ['unexpected production file',f=>{f.read(`git/trees/${callerTree}?recursive=1`).tree.push({path:'.github/approval.json',sha:'f'.repeat(40),type:'blob',mode:'100644'});},/Unreviewed rehearsal addition/],
  ['truncated tree',f=>{f.read(`git/trees/${pins.control_tree}?recursive=1`).truncated=true;},/Incomplete committed/],
  ['different workflow blob',f=>{f.read(`git/trees/${callerTree}?recursive=1`).tree[1].sha='f'.repeat(40);},/committed control tree/],
  ['caller job name',f=>{callerJobs(f).jobs[0].name='publish';},/job identity/],
  ['caller job run identity',f=>{callerJobs(f).jobs[0].run_id++;},/job identity/],
  ['missing caller job start',f=>{callerJobs(f).jobs[0].started_at=null;},/job start/],
  ['future caller start',f=>{callerJobs(f).jobs[0].started_at='2026-10-07T02:00:00Z';},/clock/],
  ['source rerun',f=>{f.read(`actions/runs/${sourceRun}`).run_attempt=2;},/source run/],
  ['source wrong original head',f=>{f.read(`actions/runs/${sourceRun}/attempts/1`).head_sha=callerSha;},/source run/],
  ['source fork repository',f=>{f.read(`actions/runs/${sourceRun}/attempts/1`).head_repository.id++;},/source run/],
  ['candidate original workflow blob changed',f=>{f.read(`git/trees/${inputs.candidate.tree_sha}?recursive=1`).tree.find(e=>e.path===inputs.candidate.workflow).sha='f'.repeat(40);},/Original candidate producer blob/],
  ['candidate original group builder blob changed',f=>{f.read(`git/trees/${inputs.candidate.tree_sha}?recursive=1`).tree.find(e=>e.path==='backend/app/services/static_site_export_service.py').sha='f'.repeat(40);},/Original candidate producer blob/],
  ['source workflow changed',f=>{f.read(`actions/workflows/static-site.yml`).id++;},/source run/],
  ['prior is a different release',f=>{f.read(`actions/runs/${priorRun}`).run_number=100;},/source run/],
  ['job inventory incomplete',f=>{jobs(f).total_count++;},/Incomplete or duplicate jobs/],
  ['artifact inventory incomplete',f=>{artifacts(f).total_count++;},/Incomplete or duplicate artifacts/],
  ['duplicate artifact ID',f=>{artifacts(f).artifacts.push({...artifacts(f).artifacts[0]});artifacts(f).total_count++;},/duplicate artifacts/],
  ['ambiguous artifact name',f=>{artifacts(f).artifacts.push({...artifacts(f).artifacts[0],id:80000000009});artifacts(f).total_count++;},/ambiguous original/],
  ['source job failed',f=>{jobs(f).jobs[0].conclusion='failure';},/producer job/],
  ['wrong producer name',f=>{jobs(f).jobs[0].name='rehearsal-build';},/producer job/],
  ['missing original build step',f=>{jobs(f).jobs[0].steps.shift();},/Build static frontend/],
  ['failed build step',f=>{jobs(f).jobs[0].steps[0].conclusion='failure';},/Build static frontend/],
  ['missing original upload step',f=>{jobs(f).jobs[0].steps.pop();},/Preserve dated/],
  ['step outside job clock',f=>{jobs(f).jobs[0].steps[0].started_at='2026-10-05T00:00:00Z';},/step clock/],
  ['artifact ID changed',f=>{artifacts(f).artifacts[0].id++;},/archive identity/],
  ['artifact digest changed',f=>{artifacts(f).artifacts[0].digest='sha256:'+'f'.repeat(64);},/archive identity/],
  ['artifact size changed',f=>{artifacts(f).artifacts[0].size_in_bytes++;},/archive identity/],
  ['artifact expired',f=>{artifacts(f).artifacts[0].expired=true;},/archive identity/],
  ['artifact expiry elapsed',f=>{artifacts(f).artifacts[0].expires_at='2026-10-07T01:00:00Z';},/archive identity/],
  ['artifact before producer job',f=>{artifacts(f).artifacts[0].created_at='2026-10-06T00:00:00Z';},/archive identity/],
  ['artifact claimed new diagnostic origin',f=>{artifacts(f).artifacts[0].workflow_run.id=callerId;},/archive identity/],
  ['prior artifact after deployment started',f=>{f.read(`actions/runs/${priorRun}/artifacts?per_page=100`,true)[0].artifacts[0].created_at='2026-10-06T01:07:00Z';},/archive identity/],
  ['prior deploy step absent',f=>{f.read(`actions/runs/${priorRun}/attempts/1/jobs?per_page=100`,true)[0].jobs[0].steps.pop();},/Deploy to GitHub Pages/],
  ['original UI tree changed',f=>{f.read(`git/commits/${pins.approved_ui.sha}`).tree.sha='f'.repeat(40);},/Pinned commit\/tree/],
]) test(`rejects ${name}`,()=>{const f=fixture();mutate(f);assert.throws(f.verify,pattern);});

test('rejects missing, additional and amplified permissions including a job override',()=>{
  const valid='name: Diagnostic\n\npermissions:\n  contents: read\n  actions: read\n\njobs:\n  rehearsal:\n    runs-on: ubuntu-latest\n';
  assert.doesNotThrow(()=>verifyWorkflowPermissions(valid));
  for (const text of [valid.replace('contents: read','contents: write'),valid.replace('  actions: read\n',''),valid.replace('jobs:','  id-token: write\njobs:'),
    valid+'    permissions:\n      contents: write\n',valid+'    \"permissions\": {contents: write}\n',valid.replace('permissions:\n  contents: read\n  actions: read','permissions: read-all')]) assert.throws(()=>verifyWorkflowPermissions(text),/permission|requires/);
});

test('the addition boundary excludes production controls, executable symlinks and unexpected files',()=>{
  assert.ok(allowedAdditions.includes('.github/scripts/fixtures/oct6-retained-price-rehearsal/contract.json'));
  const f=fixture(),base=f.read(`git/trees/${pins.control_tree}?recursive=1`),tree=f.read(`git/trees/${callerTree}?recursive=1`);
  tree.tree[1].mode='120000';assert.throws(()=>verifyControlTree(base,tree,workflowBlob),/Unreviewed rehearsal addition/);
});

test('final recheck tolerates caller step progress but rejects changed original metadata or job identity',()=>{
  const f=fixture(),before=f.verify();callerJobs(f).jobs[0].steps=[{name:'compiler completed',conclusion:'success'}];
  verifyStableEvidence(before,f.verify());artifacts(f).artifacts[0].updated_at='2026-10-07T01:09:00Z';
  assert.throws(()=>verifyStableEvidence(before,f.verify()),/source evidence changed/);
  const g=fixture(),original=g.verify();callerJobs(g).jobs[0].id++;assert.throws(()=>verifyStableEvidence(original,g.verify()),/Caller identity changed/);
});

test('later main commits are retained observations while historical/control/source bindings stay immutable',()=>{
  const f=fixture(),before=f.verify();
  f.read('git/ref/heads/main').object.sha='9'.repeat(40);
  Object.assign(f.data.get(`GET repos/${pins.repository}`),{pushed_at:'2026-10-07T01:09:00Z',updated_at:'2026-10-07T01:09:00Z',size:57300,open_issues_count:6,open_issues:6});
  const after=f.verify();verifyStableEvidence(before,after);
  assert.equal(before.current_main_observation.sha,pins.reviewed_main);
  assert.equal(after.current_main_observation.sha,'9'.repeat(40));
  assert.deepEqual(after.reviewed_historical_main,before.reviewed_historical_main);
  assert.equal(after.publication_authority,false);assert.equal(after.provider_work,false);
  assert.deepEqual(after.selected,before.selected);
  assert(!f.calls.some(call=>call.includes('/git/commits/'+'9'.repeat(40))),'Observed main must not become an executable dependency');
  const forged=structuredClone(after);forged.current_main_observation.sha='8'.repeat(40);
  assert.throws(()=>verifyStableEvidence(before,forged),/observation binding changed/);
  const historical=structuredClone(after);historical.responses[`GET ${prefix}git/commits/${pins.reviewed_main}`].tree.sha='8'.repeat(40);
  assert.throws(()=>verifyStableEvidence(before,historical),/Authenticated API evidence changed/);
  const source=structuredClone(after);source.selected.candidate.artifact.digest='sha256:'+'8'.repeat(64);
  assert.throws(()=>verifyStableEvidence(before,source),/source evidence changed/);
  const control=structuredClone(after);control.responses[`GET ${prefix}git/commits/${pins.control_base}`].tree.sha='8'.repeat(40);
  assert.throws(()=>verifyStableEvidence(before,control),/Authenticated API evidence changed/);
  for(const change of [value=>value.owner.id++,value=>value.archived=true,value=>value.allow_auto_merge=true]){
    const other=fixture(),original=other.verify();change(other.data.get(`GET repos/${pins.repository}`));
    assert.throws(()=>verifyStableEvidence(original,other.verify()),/Repository identity changed|Stable repository identity or settings changed/);
  }
});

test('acquisition start, acquired inputs and final recheck retain distinct genuine main observations',async()=>{
  const parent=mkdtempSync(join(tmpdir(),'oct6-main-observation-')),directory=join(parent,'inputs'),f=fixture();
  try {
    const result=await restoreRehearsalInputs(directory,f.context,{api:f.api,checkout:f.checkout,now:()=>clock,space:()=>10*1024**3,
      download:async(role,path)=>{writeFileSync(path,'mock original '+role);f.read('git/ref/heads/main').object.sha='9'.repeat(40);f.data.get(`GET repos/${pins.repository}`).pushed_at='2026-10-07T01:09:00Z';},gitObjects:()=>pins.approved_ui});
    const start=JSON.parse(readFileSync(join(directory,'acquisition-start-api-evidence.json'))),acquired=JSON.parse(readFileSync(result.api_evidence));
    assert.equal(start.current_main_observation.sha,pins.reviewed_main);assert.equal(acquired.current_main_observation.sha,'9'.repeat(40));
    f.read('git/ref/heads/main').object.sha='8'.repeat(40);
    Object.assign(f.data.get(`GET repos/${pins.repository}`),{updated_at:'2026-10-07T01:10:00Z',size:57400,open_issues_count:4,open_issues:4});
    const final=await recheckRehearsalInputs(directory,f.context,{api:f.api,checkout:f.checkout,now:()=>clock+1000,verifyZip:async()=>{}});
    assert.equal(final.current_main_observation.sha,'8'.repeat(40));assert.equal(final.current_main_observation.observed_at,new Date(clock+1000).toISOString());
    assert.deepEqual(start.reviewed_historical_main,final.reviewed_historical_main);
    assert.equal(start.responses[`GET repos/${pins.repository}`].size,57226);assert.equal(final.responses[`GET repos/${pins.repository}`].size,57400);
    assert.equal(result.financial_predecessor_bound,false);assert.equal(final.publication_authority,false);
  } finally {rmSync(parent,{recursive:true,force:true});}
});

test('approved UI acquisition fetches only its authenticated SHA and never checks out archive code',()=>{
  const f=fixture(),evidence=f.verify(),calls=[];let available=false;
  const execute=(program,args)=>{
    assert.equal(program,'git');const actual=args.slice(2);calls.push(actual);
    if(actual[0]==='remote')return `https://github.com/${pins.repository}.git\n`;
    if(actual[0]==='cat-file' && actual[1]==='-e'){if(!available)throw Error('missing');return '';}
    if(actual[0]==='fetch'){assert.deepEqual(actual,['fetch','--no-tags','origin',pins.approved_ui.sha]);available=true;return '';}
    if(actual[0]==='cat-file')return `tree ${pins.approved_ui.tree}\nparent ${pins.control_base}\n`;
    if(actual[0]==='rev-parse')return pins.approved_ui.frontend_tree;
    if(actual[0]==='ls-tree')return '100644 blob abc\tfrontend/tool.mjs\n';
    throw Error('Unapproved Git command');
  };
  assert.deepEqual(ensureApprovedUi(evidence,execute),pins.approved_ui);assert.equal(calls.filter(c=>c[0]==='fetch').length,1);
  const bad=structuredClone(evidence);bad.responses[`GET ${prefix}git/commits/${pins.approved_ui.sha}`].tree.sha=callerTree;
  assert.throws(()=>ensureApprovedUi(bad,execute),/authenticated original/);
});

test('restore authenticates before downloads, rechecks after acquisition and final recheck hashes every original ZIP',async()=>{
  const parent=mkdtempSync(join(tmpdir(),'oct6-auth-test-')),directory=join(parent,'inputs'),f=fixture(),downloads=[],checks=[];
  try {
    const result=await restoreRehearsalInputs(directory,f.context,{api:f.api,checkout:f.checkout,now:()=>clock,space:()=>10*1024**3,
      download:async(role,path)=>{downloads.push(role);writeFileSync(path,'mock original '+role);},gitObjects:()=>pins.approved_ui});
    assert.deepEqual(downloads,['candidate','companion','prior']);assert.equal(result.prior_role,'historical_price_evidence_only');assert.equal(result.financial_predecessor_bound,false);
    assert.equal(result.candidate_zip,join(directory,'candidate.zip'));assert.equal(result.api_evidence_sha256,digest(readFileSync(result.api_evidence)));
    await recheckRehearsalInputs(directory,f.context,{api:f.api,checkout:f.checkout,now:()=>clock+1000,verifyZip:async(path,pin)=>checks.push([path,pin.artifact_id])});
    assert.deepEqual(checks.map(c=>c[1]),[11461777446,11461613143,11421722413]);assert.ok(existsSync(join(directory,'final-api-evidence.json')));
    assert.equal(readFileSync(result.candidate_zip,'utf8'),'mock original candidate');
  } finally {rmSync(parent,{recursive:true,force:true});}
});

test('invalid caller or inadequate disk cannot start an archive download',async()=>{
  const parent=mkdtempSync(join(tmpdir(),'oct6-auth-block-'));let downloads=0;
  try {
    const f=fixture(),options={api:f.api,checkout:f.checkout,now:()=>clock,space:()=>0,download:async()=>{downloads++;},gitObjects:()=>pins.approved_ui};
    await assert.rejects(restoreRehearsalInputs(join(parent,'small'),f.context,options),/Insufficient/);
    await assert.rejects(restoreRehearsalInputs(join(parent,'bad'),{...f.context,attempt:2},options),/caller/);assert.equal(downloads,0);
  } finally {rmSync(parent,{recursive:true,force:true});}
});

test('new attempt during acquisition prevents an authenticated inputs.json',async()=>{
  const parent=mkdtempSync(join(tmpdir(),'oct6-auth-race-')),directory=join(parent,'inputs'),f=fixture();
  try {
    await assert.rejects(restoreRehearsalInputs(directory,f.context,{api:f.api,checkout:f.checkout,now:()=>clock,space:()=>10*1024**3,
      download:async(role,path)=>{writeFileSync(path,'mock');if(role==='prior')f.read(`actions/runs/${sourceRun}`).run_attempt=2;},gitObjects:()=>pins.approved_ui}),/source run/);
    assert.equal(existsSync(join(directory,'inputs.json')),false);
  } finally {rmSync(parent,{recursive:true,force:true});}
});

for (const [name,change] of [
  ['extra archive path',v=>{v.replacement_zip=v.candidate_zip;}],
  ['relative archive path',v=>{v.candidate_zip='candidate.zip';}],
  ['replaced companion name',v=>{v.archive_members={...v.archive_members,companion:'replacement.json'};}],
  ['source authority flag',v=>{v.publication_authority=true;}],
  ['provider flag',v=>{v.provider_work=true;}],
  ['financial predecessor claim',v=>{v.financial_predecessor_bound=true;}],
  ['historical role relabeled',v=>{v.prior_role='financial_predecessor';}],
  ['evidence hash changed',v=>{v.api_evidence_sha256='f'.repeat(64);}],
]) test(`final boundary rejects ${name}`,async()=>{
  const parent=mkdtempSync(join(tmpdir(),'oct6-auth-final-')),directory=join(parent,'inputs'),f=fixture();
  try {
    const result=await restoreRehearsalInputs(directory,f.context,{api:f.api,checkout:f.checkout,now:()=>clock,space:()=>10*1024**3,
      download:async(role,path)=>writeFileSync(path,'mock '+role),gitObjects:()=>pins.approved_ui});
    change(result);writeFileSync(join(directory,'inputs.json'),JSON.stringify(result));
    await assert.rejects(recheckRehearsalInputs(directory,f.context,{api:f.api,checkout:f.checkout,now:()=>clock,verifyZip:async()=>{}}),/authentication changed|archive path changed/);
    assert.equal(existsSync(join(directory,'final-api-evidence.json')),false);
  } finally {rmSync(parent,{recursive:true,force:true});}
});


test('only exact regular-file helper replacements and the one exact history fixture are admitted',()=>{
  const valid=fixture();assert.doesNotThrow(()=>valid.verify());
  for(const [path,pin] of Object.entries(reviewedHelperChanges)){
    assert.equal(createGitBlob(readFileSync(new URL('../../'+path,import.meta.url))),pin.after,'reviewed replacement must bind actual local bytes');
    for(const where of ['base','caller'])for(const attack of ['hash','mode','missing']){
      const f=fixture(),tree=f.read(`git/trees/${where==='base'?pins.control_tree:callerTree}?recursive=1`).tree,index=tree.findIndex(entry=>entry.path===path);
      if(attack==='missing')tree.splice(index,1);else if(attack==='hash')tree[index].sha='0'.repeat(40);else tree[index].mode='100755';
      assert.throws(()=>f.verify(),/Reviewed helper/);
    }
  }
  for(const [path,pin] of Object.entries(reviewedNewFixtures)){
    assert.equal(createGitBlob(readFileSync(new URL('../../'+path,import.meta.url))),pin);
    const f=fixture();f.read(`git/trees/${callerTree}?recursive=1`).tree.find(entry=>entry.path===path).sha='0'.repeat(40);
    assert.throws(()=>f.verify(),/Reviewed fixture/);
  }
});
