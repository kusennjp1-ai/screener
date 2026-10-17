import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {repository,recoveryWorkflow} from './restore-statement-source.mjs';
import {replacementSchema,chainedReplacementSchema,reviewedAbort,reviewedAbort6,reviewedSource,abortBranch,spentRequestPath,
  validateAbortContinuity,authenticateAbortContinuity,verifyReplacementActivation} from './verify-statement-pre-provider-abort.mjs';
import {authenticateRecovery,validateRequest,verifyActivation} from './run-statement-targeted-recovery.mjs';

const fixture=name=>readFileSync(new URL(`./fixtures/targeted-abort-run5/${name}`,import.meta.url));
const oldBytes=fixture('request.json'),old=JSON.parse(oldBytes),log=Buffer.from(JSON.parse(fixture('job-log.json')).content,'base64');
const terminal=JSON.parse(fixture('terminal.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const apiRoot=`repos/${repository}`;
const inventoryPath=`${apiRoot}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`;
const requestPath=`${apiRoot}/contents/${spentRequestPath}?ref=${reviewedAbort.head_sha}`;
const artifactsPath=`${apiRoot}/actions/runs/${reviewedAbort.run_id}/artifacts?per_page=100`;
const jobsPath=`${apiRoot}/actions/runs/${reviewedAbort.run_id}/attempts/1/jobs?per_page=100`;
const request=()=>({...structuredClone(old),schema_version:replacementSchema,operation_id:'targeted-nvda-aaoi-new-run6',
  expected_run_number:6,created_at:'2026-10-17T01:50:00Z',expires_at:'2026-10-17T02:50:00Z',abort_continuity:{...reviewedAbort}});
function fixtureApi(){
  const abort=structuredClone(terminal.abort),source=structuredClone(terminal.source);
  const current={...structuredClone(abort),id:38991458567,head_sha:'c'.repeat(40),run_number:6,status:'in_progress',conclusion:null,run_started_at:'2026-10-17T02:00:00Z'};
  const endpoints={
    [inventoryPath]:{total_count:3,workflow_runs:[current,abort,source]},
    [artifactsPath]:{total_count:0,artifacts:[]},[jobsPath]:structuredClone(terminal.jobs),
    [requestPath]:{type:'file',path:spentRequestPath,size:oldBytes.length,encoding:'base64',content:oldBytes.toString('base64')},
  };
  for(const run of [abort,source])for(const suffix of ['', '/attempts/1'])endpoints[`${apiRoot}/actions/runs/${run.id}${suffix}`]=structuredClone(run);
  const state={initial:false,current:structuredClone(current),run:structuredClone(abort)};
  const api=path=>{assert.ok(Object.hasOwn(endpoints,path),`Unexpected API: ${path}`);return structuredClone(endpoints[path]);};
  return {state,endpoints,api,readLog:id=>{assert.equal(id,reviewedAbort.job_id);return Buffer.from(log);}};
}

test('reviewed immutable fixtures bind the exact historical log, request, head and original source',()=>{
  assert.equal(hash(log),reviewedAbort.job_log_sha256);assert.equal(hash(oldBytes),reviewedAbort.request_sha256);
  assert.deepEqual(old.source,reviewedSource);
  assert.match(log.toString(),/run-statement-targeted-recovery\.mjs:159:14/);
  assert.match(log.toString(),/Error: Unapproved live UI/);
});
test('explicit run6 -> proven terminal abort5 -> unchanged source4 succeeds without changing source conclusion',()=>{
  const f=fixtureApi(),result=authenticateAbortContinuity(request(),f.state,f.api,f.readLog);
  assert.equal(result.abort.id,38991458566);assert.equal(result.run.id,37478731832);
  assert.equal(result.run.conclusion,'failure');assert.equal(result.initial,false);
});
test('integrated targeted caller validates v2 and restores source4 only through the explicit authenticated abort edge',()=>{
  const f=fixtureApi(),current=f.state.current,r=request();
  f.endpoints[`${apiRoot}/actions/runs/${current.id}`]=structuredClone(current);
  f.endpoints[`${apiRoot}/actions/runs/${current.id}/attempts/1`]=structuredClone(current);
  f.endpoints[`${apiRoot}/git/ref/heads/${abortBranch}`]={object:{sha:current.head_sha}};
  const artifact={id:reviewedSource.artifact_id,name:`financial-statement-recovery-${reviewedSource.head_sha}-1`,
    size_in_bytes:33424519,expired:false,digest:`sha256:${reviewedSource.artifact_sha256}`,created_at:'2026-10-06T14:40:06Z',
    workflow_run:{id:reviewedSource.run_id,head_sha:reviewedSource.head_sha,head_branch:abortBranch,
      repository_id:current.repository.id,head_repository_id:current.repository.id}};
  f.endpoints[`${apiRoot}/actions/runs/${reviewedSource.run_id}/artifacts?per_page=100`]={total_count:1,artifacts:[artifact]};
  const context={id:current.id,sha:current.head_sha,branch:abortBranch,attempt:1,event:'push',repository};
  assert.equal(validateRequest(r,Date.parse('2026-10-17T02:00:00Z')).schema_version,replacementSchema);
  assert.equal(authenticateRecovery(r,context,f.api,f.readLog).artifact.id,reviewedSource.artifact_id);
  const withoutEdge={...r,schema_version:'financial-targeted-recovery-execution-v1'};delete withoutEdge.abort_continuity;
  assert.throws(()=>authenticateRecovery(withoutEdge,context,f.api,f.readLog),/Missing or ambiguous/);
  f.endpoints[`${apiRoot}/actions/runs/${reviewedSource.run_id}/artifacts?per_page=100`].artifacts[0].created_at='2026-10-17T01:34:43Z';
  assert.throws(()=>authenticateRecovery(r,context,f.api,f.readLog),/prior attempt interval/);
});
test('closed abort binding rejects arbitrary skips, a renewed operation, wrong source, invalid clock and run7',()=>{
  const mutations=[r=>r.schema_version='financial-targeted-recovery-execution-v1',r=>r.expected_run_number=7,
    r=>r.abort_continuity.extra=true,r=>r.abort_continuity.run_id--,r=>r.abort_continuity.run_attempt=2,
    r=>r.abort_continuity.job_id++,r=>r.abort_continuity.job_log_sha256='f'.repeat(64),r=>delete r.abort_continuity,
    r=>r.source.artifact_id++,r=>r.source.cohort_sha256='f'.repeat(64),r=>r.operation_id=old.operation_id,
    r=>r.created_at='2026-10-17T01:37:34Z',r=>r.created_at='invalid'];
  for(const mutate of mutations){const r=request();mutate(r);assert.throws(()=>validateAbortContinuity(r));}
});
test('terminal/attempt/job/step/artifact/inventory changes never authorize source fallback',()=>{
  const abortPath=`${apiRoot}/actions/runs/${reviewedAbort.run_id}`;
  const sourcePath=`${apiRoot}/actions/runs/${reviewedSource.run_id}`;
  const mutations=[
    ['latest abort rerun',f=>f.endpoints[abortPath].run_attempt=2],
    ['live abort',f=>f.endpoints[abortPath].status='in_progress'],
    ['cancelled abort',f=>f.endpoints[abortPath].conclusion='cancelled'],
    ['different abort attempt',f=>f.endpoints[abortPath+'/attempts/1'].head_sha='a'.repeat(40)],
    ['foreign workflow',f=>f.endpoints[abortPath].workflow_id++],
    ['foreign repository',f=>f.endpoints[abortPath].repository.id++],
    ['source rerun',f=>f.endpoints[sourcePath].run_attempt=2],
    ['different source head',f=>f.endpoints[sourcePath+'/attempts/1'].head_sha='a'.repeat(40)],
    ['nonempty artifacts',f=>{f.endpoints[artifactsPath]={total_count:1,artifacts:[{id:1}]};}],
    ['incomplete artifacts',f=>delete f.endpoints[artifactsPath].total_count],
    ['incomplete jobs',f=>f.endpoints[jobsPath].total_count=2],
    ['different job',f=>f.endpoints[jobsPath].jobs[0].id++],
    ['untrusted job conclusion',f=>f.endpoints[jobsPath].jobs[0].conclusion='success'],
    ['changed completion',f=>f.endpoints[jobsPath].jobs[0].completed_at='2026-10-17T01:37:35Z'],
    ['different failed step',f=>f.endpoints[jobsPath].jobs[0].steps[7].conclusion='success'],
    ['missing offline tests',f=>f.endpoints[jobsPath].jobs[0].steps.splice(6,1)],
    ['oversized inventory',f=>f.endpoints[inventoryPath].total_count=101],
    ['missing abort inventory',f=>{f.endpoints[inventoryPath].workflow_runs.splice(1,1);f.endpoints[inventoryPath].total_count--;}],
    ['duplicate inventory',f=>{f.endpoints[inventoryPath].workflow_runs.push(f.endpoints[inventoryPath].workflow_runs[1]);f.endpoints[inventoryPath].total_count++;}],
    ['intervening run',f=>{f.endpoints[inventoryPath].workflow_runs.push({...structuredClone(terminal.source),id:38991458565});f.endpoints[inventoryPath].total_count++;}],
    ['newer completed run',f=>{f.endpoints[inventoryPath].workflow_runs.push({...structuredClone(terminal.source),id:38991458568,run_number:7});f.endpoints[inventoryPath].total_count++;}],
    ['queued run',f=>{f.endpoints[inventoryPath].workflow_runs.push({...structuredClone(terminal.source),id:38991458568,run_number:7,status:'queued'});f.endpoints[inventoryPath].total_count++;}],
    ['changed spent request',f=>f.endpoints[requestPath].content=Buffer.from('{}').toString('base64')],
    ['unavailable spent request',f=>f.endpoints[requestPath].encoding='none'],
  ];
  for(const [name,mutate]of mutations){const f=fixtureApi();mutate(f);assert.throws(()=>authenticateAbortContinuity(request(),f.state,f.api,f.readLog),undefined,name);}
});
test('missing/truncated/edited log and a changed selection fail closed even with empty artifacts',()=>{
  for(const bytes of [Buffer.alloc(0),log.subarray(0,log.length-1),Buffer.from(log.toString().replace('Unapproved live UI','different failure')),log.toString()]){
    const f=fixtureApi();assert.throws(()=>authenticateAbortContinuity(request(),f.state,f.api,()=>bytes),/log/);
  }
  for(const mutate of [r=>r.selection[0].receipts[0].receipt_sha256='f'.repeat(64),r=>r.limits.caller_retries=1]){
    const f=fixtureApi(),r=request();mutate(r);assert.throws(()=>authenticateAbortContinuity(r,f.state,f.api,f.readLog),/retained work/);
  }
  const f=fixtureApi();assert.throws(()=>authenticateAbortContinuity(request(),f.state,f.api,()=>{throw Error('Missing logs');}),/Missing logs/);
});
test('replacement is M only after one code-only repair parent retaining exact spent bytes, including shallow history',()=>{
  const dir=mkdtempSync(join(tmpdir(),'abort-replacement-'));
  const git=(args,input)=>execFileSync('git',args,{cwd:dir,input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  try{
    git(['init','-q']);git(['config','user.name','Offline Fixture']);git(['config','user.email','fixture@example.invalid']);
    assert.equal(git(['hash-object','-w','-t','commit','--stdin'],fixture('activation.commit')),reviewedAbort.head_sha);
    mkdirSync(join(dir,'.github/targeted-financial-recovery'),{recursive:true});writeFileSync(join(dir,spentRequestPath),oldBytes);
    writeFileSync(join(dir,'controller.txt'),'reviewed repair');git(['add','.']);
    const tree=git(['write-tree']),parent=git(['commit-tree',tree,'-p',reviewedAbort.head_sha,'-m','Reviewed code-only repair']);
    git(['update-ref','HEAD',parent]);
    const r=request();r.controller={parent_sha:parent,parent_tree:tree};writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);
    const head=git(['commit-tree',git(['write-tree']),'-p',parent,'-m','New finite request replacement']);git(['update-ref','HEAD',head]);
    const context={repository,event:'push',branch:abortBranch,attempt:1,sha:head};
    assert.doesNotThrow(()=>verifyReplacementActivation(r,context,dir));
    assert.doesNotThrow(()=>verifyActivation(r,{...context,id:38991458567},dir));
    writeFileSync(join(dir,'.git/shallow'),parent+'\n');
    assert.doesNotThrow(()=>verifyReplacementActivation(r,context,dir));
    assert.doesNotThrow(()=>verifyActivation(r,{...context,id:38991458567},dir));
    for(const change of [{attempt:2},{branch:'main'},{event:'workflow_dispatch'}])assert.throws(()=>verifyReplacementActivation(r,{...context,...change},dir));
    writeFileSync(join(dir,'controller.txt'),'unreviewed extra change');git(['add','.']);
    const extra=git(['commit-tree',git(['write-tree']),'-p',parent,'-m','Mixed activation']);
    assert.throws(()=>verifyReplacementActivation(r,{...context,sha:extra},dir),/only modify/);
    // An old request retimed/changed in the code commit cannot become a new base.
    git(['reset','--hard',parent]);writeFileSync(join(dir,spentRequestPath),oldBytes.toString()+' ');git(['add','.']);
    const badParent=git(['commit-tree',git(['write-tree']),'-p',reviewedAbort.head_sha,'-m','Changed spent request']);
    writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);const badHead=git(['commit-tree',git(['write-tree']),'-p',badParent,'-m','Replacement']);
    assert.throws(()=>verifyReplacementActivation({...r,controller:{...r.controller,parent_sha:badParent}},{...context,sha:badHead},dir),/spent request/);
    // A different controller ancestry is rejected even when old bytes match.
    git(['reset','--hard',parent]);
    const wrongParent=git(['commit-tree',tree,'-m','Detached controller']);
    writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);
    const wrongHead=git(['commit-tree',git(['write-tree']),'-p',wrongParent,'-m','Replacement']);
    assert.throws(()=>verifyReplacementActivation({...r,controller:{...r.controller,parent_sha:wrongParent}},{...context,sha:wrongHead},dir),/code-only child/);
    // Removing the spent file in a controller and adding another request is not M.
    git(['reset','--hard',parent]);git(['rm','-q',spentRequestPath]);
    const removedParent=git(['commit-tree',git(['write-tree']),'-p',reviewedAbort.head_sha,'-m','Deleted spent request']);
    mkdirSync(join(dir,'.github/targeted-financial-recovery'),{recursive:true});writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);
    const addedHead=git(['commit-tree',git(['write-tree']),'-p',removedParent,'-m','Readded request']);
    assert.throws(()=>verifyReplacementActivation({...r,controller:{...r.controller,parent_sha:removedParent}},{...context,sha:addedHead},dir),/only modify/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});


const fixture6=name=>readFileSync(new URL(`./fixtures/targeted-abort-run6/${name}`,import.meta.url));
const old6Bytes=fixture6('request.json'),old6=JSON.parse(old6Bytes),log6=Buffer.from(JSON.parse(fixture6('job-log.json')).content,'base64');
const terminal6=JSON.parse(fixture6('terminal.json'));
const request6Path=`${apiRoot}/contents/${spentRequestPath}?ref=${reviewedAbort6.head_sha}`;
const artifacts6Path=`${apiRoot}/actions/runs/${reviewedAbort6.run_id}/artifacts?per_page=100`;
const jobs6Path=`${apiRoot}/actions/runs/${reviewedAbort6.run_id}/attempts/1/jobs?per_page=100`;
const chainRequest=()=>({...structuredClone(old6),schema_version:chainedReplacementSchema,operation_id:'targeted-nvda-aaoi-new-run7',
  expected_run_number:7,created_at:'2026-10-17T02:10:00Z',expires_at:'2026-10-17T03:10:00Z',
  abort_continuity:{run6:{...reviewedAbort6},run5:{...reviewedAbort}}});
function chainFixtureApi(){
  const f=fixtureApi(),abort=structuredClone(terminal6.abort);
  const current={...structuredClone(abort),id:38993132270,head_sha:'d'.repeat(40),run_number:7,status:'in_progress',conclusion:null,run_started_at:'2026-10-17T02:20:00Z'};
  f.state={initial:false,current:structuredClone(current),run:structuredClone(abort)};
  f.endpoints[inventoryPath]={total_count:4,workflow_runs:[current,abort,structuredClone(terminal.abort),structuredClone(terminal.source)]};
  f.endpoints[artifacts6Path]=structuredClone(terminal6.artifacts);
  f.endpoints[jobs6Path]=structuredClone(terminal6.jobs);
  f.endpoints[request6Path]={type:'file',path:spentRequestPath,size:old6Bytes.length,encoding:'base64',content:old6Bytes.toString('base64')};
  for(const run of [current,abort])for(const suffix of ['', '/attempts/1'])f.endpoints[`${apiRoot}/actions/runs/${run.id}${suffix}`]=structuredClone(run);
  f.endpoints[`${apiRoot}/git/ref/heads/${abortBranch}`]={object:{sha:current.head_sha}};
  const sourceArtifact={id:reviewedSource.artifact_id,name:`financial-statement-recovery-${reviewedSource.head_sha}-1`,
    size_in_bytes:33424519,expired:false,digest:`sha256:${reviewedSource.artifact_sha256}`,created_at:'2026-10-06T14:40:06Z',
    workflow_run:{id:reviewedSource.run_id,head_sha:reviewedSource.head_sha,head_branch:abortBranch,
      repository_id:current.repository.id,head_repository_id:current.repository.id}};
  f.endpoints[`${apiRoot}/actions/runs/${reviewedSource.run_id}/artifacts?per_page=100`]={total_count:1,artifacts:[sourceArtifact]};
  f.calls=[];f.logs=[];
  f.api=path=>{f.calls.push(path);assert.ok(Object.hasOwn(f.endpoints,path),`Unexpected API: ${path}`);return structuredClone(f.endpoints[path]);};
  f.readLog=id=>{f.logs.push(id);assert.ok([reviewedAbort.job_id,reviewedAbort6.job_id].includes(id));return Buffer.from(id===reviewedAbort.job_id?log:log6);};
  f.context={id:current.id,sha:current.head_sha,branch:abortBranch,attempt:1,event:'push',repository};
  return f;
}
test('run6 immutable fixtures prove the exact initial authentication abort before workspace or provider startup',()=>{
  assert.equal(log6.length,59325);assert.equal(hash(log6),reviewedAbort6.job_log_sha256);
  assert.equal(hash(old6Bytes),reviewedAbort6.request_sha256);assert.equal(old6.schema_version,replacementSchema);
  assert.deepEqual(old6.source,reviewedSource);assert.deepEqual(old6.abort_continuity,reviewedAbort);
  assert.deepEqual(old6.selection,old.selection);assert.deepEqual(old6.limits,old.limits);
  assert.match(log6.toString(),/Error: Command failed: gh api repos\/kusennjp1-ai\/screener\/actions\/jobs\/117274547210\/logs/);
  assert.match(log6.toString(),/at readAbortJobLog .*verify-statement-pre-provider-abort\.mjs:66:10/);
  assert.match(log6.toString(),/at authenticateAbortContinuity .*verify-statement-pre-provider-abort\.mjs:109:13/);
  assert.match(log6.toString(),/at authenticateRecovery .*run-statement-targeted-recovery\.mjs:78:55/);
  assert.match(log6.toString(),/at run .*run-statement-targeted-recovery\.mjs:154:50/);
  assert.equal(terminal6.jobs.jobs[0].completed_at,'2026-10-17T02:01:05Z');
  assert.deepEqual(terminal6.artifacts,{total_count:0,artifacts:[]});
});
test('v3 integrates only run7 -> exact terminal abort6 -> exact terminal abort5 -> unchanged source4',()=>{
  const f=chainFixtureApi(),r=chainRequest();
  assert.equal(validateRequest(r,Date.parse('2026-10-17T02:20:00Z')).schema_version,chainedReplacementSchema);
  const result=authenticateRecovery(r,f.context,f.api,f.readLog);
  assert.deepEqual(result.aborts.map(run=>run.id),[reviewedAbort6.run_id,reviewedAbort.run_id]);
  assert.equal(result.abort.id,reviewedAbort.run_id);assert.equal(result.run.id,reviewedSource.run_id);
  assert.equal(result.run.conclusion,'failure');assert.equal(result.artifact.id,reviewedSource.artifact_id);
  assert.deepEqual(f.logs,[reviewedAbort6.job_id,reviewedAbort.job_id]);
  for(const identity of [reviewedAbort6,reviewedAbort]){
    for(const suffix of ['', '/attempts/1','/artifacts?per_page=100','/attempts/1/jobs?per_page=100']){
      assert.ok(f.calls.includes(`${apiRoot}/actions/runs/${identity.run_id}${suffix}`));
    }
    assert.ok(f.calls.includes(`${apiRoot}/contents/${spentRequestPath}?ref=${identity.head_sha}`));
  }
  // Source4 artifacts must predate abort5, even though abort6 is newer.
  f.endpoints[`${apiRoot}/actions/runs/${reviewedSource.run_id}/artifacts?per_page=100`].artifacts[0].created_at='2026-10-17T01:50:00Z';
  assert.throws(()=>authenticateRecovery(r,f.context,f.api,f.readLog),/prior attempt interval/);
});
test('v3 fixed shape rejects omitted, swapped, extended or unreviewed aborts, run8, clocks and both spent operations',()=>{
  const mutations=[r=>r.expected_run_number=6,r=>r.expected_run_number=8,r=>r.schema_version=replacementSchema,
    r=>r.schema_version='financial-targeted-recovery-execution-v1',r=>delete r.abort_continuity,
    r=>delete r.abort_continuity.run5,r=>delete r.abort_continuity.run6,r=>r.abort_continuity.run4={...reviewedAbort},
    r=>r.abort_continuity=[r.abort_continuity.run6,r.abort_continuity.run5],
    r=>{[r.abort_continuity.run6,r.abort_continuity.run5]=[r.abort_continuity.run5,r.abort_continuity.run6];},
    r=>r.abort_continuity.run6.extra=true,r=>r.abort_continuity.run6.run_attempt=2,
    r=>r.abort_continuity.run6.head_sha='f'.repeat(40),r=>r.abort_continuity.run5.job_id++,
    r=>r.abort_continuity.run6.request_sha256='f'.repeat(64),r=>r.abort_continuity.run5.job_log_sha256='f'.repeat(64),
    r=>r.source.artifact_id++,r=>r.operation_id=old.operation_id,r=>r.operation_id=old6.operation_id,
    r=>r.created_at='2026-10-17T02:01:05Z',r=>r.created_at='invalid'];
  for(const mutate of mutations){const r=chainRequest();mutate(r);assert.throws(()=>validateAbortContinuity(r));}
});
test('both aborts independently require exact latest, attempt, inventory, job, steps, artifacts and spent bytes',()=>{
  for(const identity of [reviewedAbort6,reviewedAbort]){
    const runPath=`${apiRoot}/actions/runs/${identity.run_id}`;
    const jobsPath=`${runPath}/attempts/1/jobs?per_page=100`,artifactsPath=`${runPath}/artifacts?per_page=100`;
    const requestPath=`${apiRoot}/contents/${spentRequestPath}?ref=${identity.head_sha}`;
    const mutations=[
      ['latest rerun',f=>f.endpoints[runPath].run_attempt=2],
      ['attempt rerun',f=>f.endpoints[runPath+'/attempts/1'].run_attempt=2],
      ['latest live',f=>f.endpoints[runPath].status='in_progress'],
      ['latest cancellation',f=>f.endpoints[runPath].conclusion='cancelled'],
      ['attempt success',f=>f.endpoints[runPath+'/attempts/1'].conclusion='success'],
      ['foreign workflow',f=>f.endpoints[runPath].workflow_id++],
      ['foreign repository',f=>f.endpoints[runPath].repository.id++],
      ['foreign head repository',f=>f.endpoints[runPath+'/attempts/1'].head_repository.full_name='other/repo'],
      ['attempt clock mismatch',f=>f.endpoints[runPath+'/attempts/1'].run_started_at='2026-10-17T02:00:00Z'],
      ['inventory identity mismatch',f=>f.endpoints[inventoryPath].workflow_runs.find(run=>run.id===identity.run_id).head_sha='f'.repeat(40)],
      ['nonempty artifacts',f=>f.endpoints[artifactsPath]={total_count:1,artifacts:[{id:1}]}],
      ['incomplete artifacts',f=>delete f.endpoints[artifactsPath].total_count],
      ['incomplete jobs',f=>f.endpoints[jobsPath].total_count=2],
      ['duplicate jobs',f=>f.endpoints[jobsPath].jobs.push(f.endpoints[jobsPath].jobs[0])],
      ['wrong job',f=>f.endpoints[jobsPath].jobs[0].id++],
      ['wrong job attempt',f=>f.endpoints[jobsPath].jobs[0].run_attempt=2],
      ['wrong job head',f=>f.endpoints[jobsPath].jobs[0].head_sha='f'.repeat(40)],
      ['wrong job branch',f=>f.endpoints[jobsPath].jobs[0].head_branch='main'],
      ['job success',f=>f.endpoints[jobsPath].jobs[0].conclusion='success'],
      ['job completion',f=>f.endpoints[jobsPath].jobs[0].completed_at='2026-10-17T02:01:06Z'],
      ['job start',f=>f.endpoints[jobsPath].jobs[0].started_at='2026-10-17T02:10:00Z'],
      ['missing offline step',f=>f.endpoints[jobsPath].jobs[0].steps.splice(6,1)],
      ['changed failure step',f=>f.endpoints[jobsPath].jobs[0].steps[7].conclusion='success'],
      ['added step',f=>f.endpoints[jobsPath].jobs[0].steps.push({...f.endpoints[jobsPath].jobs[0].steps[7]})],
      ['step clock reversal',f=>f.endpoints[jobsPath].jobs[0].steps[7].completed_at='2026-10-16T00:00:00Z'],
      ['changed spent request',f=>f.endpoints[requestPath].content=Buffer.from('{}').toString('base64')],
      ['unavailable spent request',f=>f.endpoints[requestPath].encoding='none'],
    ];
    for(const [name,mutate]of mutations){const f=chainFixtureApi();mutate(f);assert.throws(()=>authenticateRecovery(chainRequest(),f.context,f.api,f.readLog),undefined,`run${identity.run_number}: ${name}`);}
  }
});
test('v3 proves all three immediate edges and rejects newer, live, intervening, duplicate and rerun histories',()=>{
  const add=(f,run)=>{f.endpoints[inventoryPath].workflow_runs.push(run);f.endpoints[inventoryPath].total_count++;};
  const other=(id,number,change={})=>({...structuredClone(terminal.source),id,run_number:number,head_sha:'e'.repeat(40),...change});
  const mutations=[
    f=>add(f,other(38993132271,8)),f=>add(f,other(38993132271,8,{status:'queued',conclusion:null})),
    f=>add(f,other(38993132265,8)), // between current and abort6
    f=>add(f,other(38993132262,8)), // between current and abort5, ahead of abort5
    f=>add(f,other(38991458565,3)), // between abort5 and source4
    f=>add(f,other(37478731833,3,{status:'in_progress',conclusion:null})),
    f=>add(f,other(37478731831,5)), // duplicate run number
    f=>add(f,other(37478731831,3,{head_sha:reviewedAbort6.head_sha})),
    f=>add(f,structuredClone(terminal.abort)),
    f=>{f.endpoints[inventoryPath].workflow_runs.splice(2,1);f.endpoints[inventoryPath].total_count--;},
    f=>f.endpoints[inventoryPath].total_count=101,
    f=>f.endpoints[`${apiRoot}/actions/runs/${reviewedSource.run_id}`].run_attempt=2,
    f=>f.endpoints[`${apiRoot}/actions/runs/${reviewedSource.run_id}/attempts/1`].head_sha='f'.repeat(40),
    f=>f.endpoints[`${apiRoot}/actions/runs/${f.context.id}/attempts/1`].run_attempt=2,
    f=>f.endpoints[`${apiRoot}/git/ref/heads/${abortBranch}`].object.sha=reviewedAbort6.head_sha,
  ];
  for(const mutate of mutations){const f=chainFixtureApi();mutate(f);assert.throws(()=>authenticateRecovery(chainRequest(),f.context,f.api,f.readLog));}
  const f=chainFixtureApi();f.state.current.run_started_at='2026-10-17T02:01:05Z';
  f.endpoints[inventoryPath].workflow_runs[0].run_started_at=f.state.current.run_started_at;
  assert.throws(()=>authenticateAbortContinuity(chainRequest(),f.state,f.api,f.readLog),/terminal abort job/);
});
test('both complete logs are mandatory and any retained selection or bounds change fails before source artifact access',()=>{
  for(const identity of [reviewedAbort6,reviewedAbort]){
    const original=identity===reviewedAbort6?log6:log;
    for(const altered of [Buffer.alloc(0),original.subarray(0,original.length-1),Buffer.from(original).fill(0,10,11),original.toString()]){
      const f=chainFixtureApi();assert.throws(()=>authenticateRecovery(chainRequest(),f.context,f.api,id=>id===identity.job_id?altered:f.readLog(id)),/log/);
      assert.ok(!f.calls.includes(`${apiRoot}/actions/runs/${reviewedSource.run_id}/artifacts?per_page=100`));
    }
    const f=chainFixtureApi();assert.throws(()=>authenticateRecovery(chainRequest(),f.context,f.api,id=>{if(id===identity.job_id)throw Error('Missing reviewed log');return f.readLog(id);}),/Missing reviewed log/);
  }
  for(const mutate of [r=>r.selection[0].receipts[0].receipt_sha256='f'.repeat(64),r=>r.limits.max_statement_getter_calls=5,r=>r.limits.caller_retries=1]){
    const f=chainFixtureApi(),r=chainRequest();mutate(r);assert.throws(()=>authenticateRecovery(r,f.context,f.api,f.readLog),/retained work/);
  }
});
test('v3 activation is request-only M after exactly one run6 code-only child, including shallow checkout',()=>{
  const dir=mkdtempSync(join(tmpdir(),'abort6-replacement-'));
  const git=(args,input)=>execFileSync('git',args,{cwd:dir,input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  try{
    git(['init','-q']);git(['config','user.name','Offline Fixture']);git(['config','user.email','fixture@example.invalid']);
    assert.equal(git(['hash-object','-w','-t','commit','--stdin'],fixture6('activation.commit')),reviewedAbort6.head_sha);
    assert.equal(git(['hash-object','-w','-t','commit','--stdin'],fixture('activation.commit')),reviewedAbort.head_sha);
    mkdirSync(join(dir,'.github/targeted-financial-recovery'),{recursive:true});writeFileSync(join(dir,spentRequestPath),old6Bytes);
    writeFileSync(join(dir,'controller.txt'),'reviewed repair');git(['add','.']);
    const tree=git(['write-tree']),parent=git(['commit-tree',tree,'-p',reviewedAbort6.head_sha,'-m','Reviewed run6 code-only repair']);
    git(['update-ref','HEAD',parent]);const r=chainRequest();r.controller={parent_sha:parent,parent_tree:tree};
    writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);
    const head=git(['commit-tree',git(['write-tree']),'-p',parent,'-m','New finite run7 request']);git(['update-ref','HEAD',head]);
    const context={repository,event:'push',branch:abortBranch,attempt:1,sha:head,id:38993132264};
    assert.doesNotThrow(()=>verifyActivation(r,context,dir));
    writeFileSync(join(dir,'.git/shallow'),parent+'\n');assert.doesNotThrow(()=>verifyActivation(r,context,dir));
    for(const change of [{attempt:2},{branch:'main'},{event:'workflow_dispatch'}])assert.throws(()=>verifyReplacementActivation(r,{...context,...change},dir));
    writeFileSync(join(dir,'extra.txt'),'x');assert.throws(()=>verifyActivation(r,context,dir),/clean/);rmSync(join(dir,'extra.txt'));
    writeFileSync(join(dir,'controller.txt'),'mixed code');git(['add','.']);
    const mixed=git(['commit-tree',git(['write-tree']),'-p',parent,'-m','Mixed activation']);
    assert.throws(()=>verifyReplacementActivation(r,{...context,sha:mixed},dir),/only modify/);
    for(const previous of [reviewedAbort.head_sha,parent]){
      git(['reset','--hard',parent]);const wrongParent=git(['commit-tree',tree,'-p',previous,'-m','Wrong repair ancestry']);
      writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);
      const wrongHead=git(['commit-tree',git(['write-tree']),'-p',wrongParent,'-m','Replacement']);
      assert.throws(()=>verifyReplacementActivation({...r,controller:{...r.controller,parent_sha:wrongParent}},{...context,sha:wrongHead},dir),/code-only child/);
    }
    git(['reset','--hard',parent]);writeFileSync(join(dir,spentRequestPath),old6Bytes.toString()+' ');git(['add','.']);
    const badParent=git(['commit-tree',git(['write-tree']),'-p',reviewedAbort6.head_sha,'-m','Changed spent run6 request']);
    writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);const badHead=git(['commit-tree',git(['write-tree']),'-p',badParent,'-m','Replacement']);
    assert.throws(()=>verifyReplacementActivation({...r,controller:{...r.controller,parent_sha:badParent}},{...context,sha:badHead},dir),/spent request/);
    git(['reset','--hard',parent]);git(['rm','-q',spentRequestPath]);
    const removedParent=git(['commit-tree',git(['write-tree']),'-p',reviewedAbort6.head_sha,'-m','Deleted spent request']);
    mkdirSync(join(dir,'.github/targeted-financial-recovery'),{recursive:true});
    writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);const addedHead=git(['commit-tree',git(['write-tree']),'-p',removedParent,'-m','Readded request']);
    assert.throws(()=>verifyReplacementActivation({...r,controller:{...r.controller,parent_sha:removedParent}},{...context,sha:addedHead},dir),/only modify/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
