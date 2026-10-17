import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fstatSync,ftruncateSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,symlinkSync,unlinkSync,writeFileSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {repository,recoveryWorkflow} from './restore-statement-source.mjs';
import {replacementSchema,chainedReplacementSchema,run8ReplacementSchema,reviewedAbort,reviewedAbort6,reviewedAbort7,reviewedSource,abortBranch,spentRequestPath,
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

const fixture7=name=>readFileSync(new URL(`./fixtures/targeted-abort-run7/${name}`,import.meta.url));
const old7Bytes=fixture7('request.json'),old7=JSON.parse(old7Bytes),log7=Buffer.from(JSON.parse(fixture7('job-log.json')).content,'base64');
const terminal7=JSON.parse(fixture7('terminal.json'));
const request7Path=`${apiRoot}/contents/${spentRequestPath}?ref=${reviewedAbort7.head_sha}`;
const artifacts7Path=`${apiRoot}/actions/runs/${reviewedAbort7.run_id}/artifacts?per_page=100`;
const jobs7Path=`${apiRoot}/actions/runs/${reviewedAbort7.run_id}/attempts/1/jobs?per_page=100`;
const run8Request=()=>({...structuredClone(old7),schema_version:run8ReplacementSchema,operation_id:'targeted-nvda-aaoi-new-run8',
  expected_run_number:8,created_at:'2026-10-17T03:10:00Z',expires_at:'2026-10-17T04:10:00Z',
  abort_continuity:{run7:{...reviewedAbort7},run6:{...reviewedAbort6},run5:{...reviewedAbort}}});
function run8FixtureApi(){
  const f=chainFixtureApi(),abort=structuredClone(terminal7.abort);
  const current={...structuredClone(abort),id:38997227420,head_sha:'f'.repeat(40),run_number:8,status:'in_progress',conclusion:null,run_started_at:'2026-10-17T03:20:00Z'};
  f.state={initial:false,current:structuredClone(current),run:structuredClone(abort)};
  f.endpoints[inventoryPath]={total_count:5,workflow_runs:[current,abort,structuredClone(terminal6.abort),structuredClone(terminal.abort),structuredClone(terminal.source)]};
  f.endpoints[artifacts7Path]=structuredClone(terminal7.artifacts);
  f.endpoints[jobs7Path]=structuredClone(terminal7.jobs);
  f.endpoints[request7Path]={type:'file',path:spentRequestPath,size:old7Bytes.length,encoding:'base64',content:old7Bytes.toString('base64')};
  for(const run of [current,abort])for(const suffix of ['', '/attempts/1'])f.endpoints[`${apiRoot}/actions/runs/${run.id}${suffix}`]=structuredClone(run);
  f.endpoints[`${apiRoot}/actions/runs/${abort.id}/attempts/1`]=structuredClone(terminal7.attempt);
  f.endpoints[`${apiRoot}/git/ref/heads/${abortBranch}`]={object:{sha:current.head_sha}};
  f.readLog=id=>{f.logs.push(id);assert.ok([reviewedAbort7.job_id,reviewedAbort6.job_id,reviewedAbort.job_id].includes(id));return Buffer.from(id===reviewedAbort7.job_id?log7:id===reviewedAbort6.job_id?log6:log);};
  f.context={id:current.id,sha:current.head_sha,branch:abortBranch,attempt:1,event:'push',repository};
  return f;
}
const gitObject=(type,bytes)=>createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
function treeEntries(bytes){
  const entries={};let offset=0;
  while(offset<bytes.length){
    const space=bytes.indexOf(32,offset),nul=bytes.indexOf(0,space);
    assert.ok(space>offset&&nul>space&&nul+21<=bytes.length);
    const mode=bytes.subarray(offset,space).toString(),name=bytes.subarray(space+1,nul).toString();
    assert.ok(!Object.hasOwn(entries,name));entries[name]={mode,sha:bytes.subarray(nul+1,nul+21).toString('hex')};offset=nul+21;
  }
  return entries;
}
test('run7 exact full log and immutable commit/tree-bound code prove only the initial pre-provider abort',()=>{
  assert.equal(log7.length,67609);assert.equal(hash(log7),reviewedAbort7.job_log_sha256);
  assert.equal(hash(old7Bytes),reviewedAbort7.request_sha256);assert.equal(old7.schema_version,chainedReplacementSchema);
  assert.deepEqual(old7.source,reviewedSource);assert.deepEqual(old7.abort_continuity,{run6:reviewedAbort6,run5:reviewedAbort});
  assert.deepEqual(old7.selection,old.selection);assert.deepEqual(old7.limits,old.limits);
  assert.deepEqual(terminal7.abort,terminal7.attempt);assert.deepEqual(terminal7.artifacts,{total_count:0,artifacts:[]});
  const commit=fixture7('activation.commit'),trees=JSON.parse(fixture7('git-trees.json')),proof=JSON.parse(fixture7('code-proof.json'));
  assert.equal(gitObject('commit',commit),reviewedAbort7.head_sha);
  assert.equal(commit.toString().match(/^tree ([a-f0-9]{40})$/m)[1],trees[''].sha);
  assert.deepEqual([...commit.toString().matchAll(/^parent ([a-f0-9]{40})$/gm)].map(m=>m[1]),[old7.controller.parent_sha]);
  const entries={};
  for(const [path,tree]of Object.entries(trees)){
    const bytes=Buffer.from(tree.content,'base64');assert.equal(tree.encoding,'base64');assert.equal(gitObject('tree',bytes),tree.sha);
    entries[path]=treeEntries(bytes);
  }
  for(const path of Object.keys(trees).filter(Boolean)){
    const slash=path.lastIndexOf('/'),parent=slash<0?'':path.slice(0,slash),name=path.slice(slash+1);
    assert.deepEqual(entries[parent][name],{mode:'40000',sha:trees[path].sha});
  }
  assert.deepEqual(Object.keys(proof).sort(),['.github/scripts/download-reviewed-job-log.mjs','.github/scripts/run-statement-targeted-recovery.mjs',spentRequestPath,recoveryWorkflow].sort());
  for(const [path,item]of Object.entries(proof)){
    const bytes=fixture7(item.fixture),slash=path.lastIndexOf('/');
    assert.equal(hash(bytes),item.sha256);assert.equal(gitObject('blob',bytes),item.blob_sha);
    assert.deepEqual(entries[path.slice(0,slash)][path.slice(slash+1)],{mode:'100644',sha:item.blob_sha});
  }
  const caller=fixture7('caller.mjs.txt').toString(),lines=caller.split('\n'),workflow=fixture7('workflow.yml.txt').toString();
  assert.match(lines[153],/verifyActivation\(request,context\);let recovery=authenticateRecovery\(request,context,api\)/);
  assert.match(lines[157],/mkdirSync\(workspace/);assert.match(lines[158],/await preparePublicationVerifier/);
  assert.match(lines[160],/repos\/\$\{repository\}\/actions\/artifacts\/\$\{recovery\.artifact\.id\}\/zip/);
  assert.match(lines[195],/await executeWithRecheck\('python3'/);
  assert.equal(caller.match(/await executeWithRecheck\(/g).length,1);
  assert.equal(workflow.match(/node \.github\/scripts\/run-statement-targeted-recovery\.mjs\s/g).length,1);
  assert.match(log7.toString(),/Error: Reviewed job log download failed/);
  assert.match(log7.toString(),/at readReviewedJobLog .*download-reviewed-job-log\.mjs:183:19/);
  assert.match(log7.toString(),/at readAbortJobLog .*verify-statement-pre-provider-abort\.mjs:85:10/);
  assert.match(log7.toString(),/at authenticateTerminalAbort .*verify-statement-pre-provider-abort\.mjs:124:13/);
  assert.match(log7.toString(),/at authenticateAbortContinuity .*verify-statement-pre-provider-abort\.mjs:158:14/);
  assert.match(log7.toString(),/at authenticateRecovery .*run-statement-targeted-recovery\.mjs:78:42/);
  assert.match(log7.toString(),/at run .*run-statement-targeted-recovery\.mjs:154:50/);
});
test('v4 integrates only run8 -> abort7 -> abort6 -> abort5 -> source4 and keeps source artifacts bounded by abort5',()=>{
  const f=run8FixtureApi(),r=run8Request();
  assert.equal(validateRequest(r,Date.parse('2026-10-17T03:20:00Z')).schema_version,run8ReplacementSchema);
  const result=authenticateRecovery(r,f.context,f.api,f.readLog);
  assert.deepEqual(result.aborts.map(run=>run.id),[reviewedAbort7.run_id,reviewedAbort6.run_id,reviewedAbort.run_id]);
  assert.equal(result.abort.id,reviewedAbort.run_id);assert.equal(result.run.id,reviewedSource.run_id);
  assert.equal(result.run.conclusion,'failure');assert.equal(result.artifact.id,reviewedSource.artifact_id);
  assert.deepEqual(f.logs,[reviewedAbort7.job_id,reviewedAbort6.job_id,reviewedAbort.job_id]);
  for(const identity of [reviewedAbort7,reviewedAbort6,reviewedAbort]){
    for(const suffix of ['', '/attempts/1','/artifacts?per_page=100','/attempts/1/jobs?per_page=100']){
      assert.ok(f.calls.includes(`${apiRoot}/actions/runs/${identity.run_id}${suffix}`));
    }
    assert.ok(f.calls.includes(`${apiRoot}/contents/${spentRequestPath}?ref=${identity.head_sha}`));
  }
  for(const created of ['2026-10-17T01:34:42Z','2026-10-17T01:50:00Z','2026-10-17T02:10:00Z','2026-10-17T03:10:00Z']){
    f.endpoints[`${apiRoot}/actions/runs/${reviewedSource.run_id}/artifacts?per_page=100`].artifacts[0].created_at=created;
    assert.throws(()=>authenticateRecovery(r,f.context,f.api,f.readLog),/prior attempt interval/);
  }
});
test('v4 fixed shape rejects other runs, arbitrary skips, extended chains, all spent operations and changed retained source',()=>{
  const mutations=[r=>r.expected_run_number=7,r=>r.expected_run_number=9,r=>r.expected_run_number=true,
    r=>r.schema_version=chainedReplacementSchema,r=>r.schema_version=replacementSchema,r=>r.schema_version='financial-targeted-recovery-execution-v5',
    r=>delete r.abort_continuity,r=>delete r.abort_continuity.run7,r=>delete r.abort_continuity.run6,r=>delete r.abort_continuity.run5,
    r=>r.abort_continuity.run8={...reviewedAbort7},r=>r.abort_continuity.run4={...reviewedSource},
    r=>r.abort_continuity=[reviewedAbort7,reviewedAbort6,reviewedAbort],
    r=>{[r.abort_continuity.run7,r.abort_continuity.run6]=[r.abort_continuity.run6,r.abort_continuity.run7];},
    r=>r.source.run_id=reviewedAbort7.run_id,r=>r.source.cohort_sha256='e'.repeat(64),
    r=>r.created_at='2026-10-17T03:03:22Z',r=>r.created_at='invalid',
    ...[old,old6,old7].map(old=>r=>r.operation_id=old.operation_id),
    ...['run7','run6','run5'].flatMap(key=>[r=>r.abort_continuity[key].extra=true,r=>r.abort_continuity[key].run_attempt=2,
      r=>r.abort_continuity[key].run_attempt=true,r=>r.abort_continuity[key].head_sha='e'.repeat(40),
      r=>r.abort_continuity[key].job_id++,r=>r.abort_continuity[key].request_sha256='e'.repeat(64),
      r=>r.abort_continuity[key].job_log_sha256='e'.repeat(64)])];
  for(const mutate of mutations){const r=run8Request();mutate(r);assert.throws(()=>validateAbortContinuity(r));}
});
test('v4 individually reauthenticates all three terminal aborts and rejects changed jobs, artifacts, requests and attempts',()=>{
  for(const identity of [reviewedAbort7,reviewedAbort6,reviewedAbort]){
    const runPath=`${apiRoot}/actions/runs/${identity.run_id}`,jobsPath=runPath+'/attempts/1/jobs?per_page=100',artifactsPath=runPath+'/artifacts?per_page=100';
    const requestPath=`${apiRoot}/contents/${spentRequestPath}?ref=${identity.head_sha}`;
    const mutations=[
      ['rerun',f=>f.endpoints[runPath].run_attempt=2],['live',f=>f.endpoints[runPath].status='in_progress'],
      ['cancelled',f=>f.endpoints[runPath].conclusion='cancelled'],['wrong attempt',f=>f.endpoints[runPath+'/attempts/1'].head_sha='e'.repeat(40)],
      ['foreign workflow',f=>f.endpoints[runPath].workflow_id++],['foreign repo',f=>f.endpoints[runPath].repository.id++],
      ['foreign head repo',f=>f.endpoints[runPath+'/attempts/1'].head_repository.full_name='other/repo'],
      ['attempt clock',f=>f.endpoints[runPath+'/attempts/1'].run_started_at='2026-10-17T03:00:00Z'],
      ['inventory head',f=>f.endpoints[inventoryPath].workflow_runs.find(run=>run.id===identity.run_id).head_sha='e'.repeat(40)],
      ['nonempty artifacts',f=>f.endpoints[artifactsPath]={total_count:1,artifacts:[{id:1}]}],
      ['incomplete artifacts',f=>delete f.endpoints[artifactsPath].total_count],
      ['incomplete jobs',f=>f.endpoints[jobsPath].total_count=2],['duplicate jobs',f=>f.endpoints[jobsPath].jobs.push(f.endpoints[jobsPath].jobs[0])],
      ['wrong job',f=>f.endpoints[jobsPath].jobs[0].id++],['wrong job attempt',f=>f.endpoints[jobsPath].jobs[0].run_attempt=2],
      ['wrong job head',f=>f.endpoints[jobsPath].jobs[0].head_sha='e'.repeat(40)],['wrong job branch',f=>f.endpoints[jobsPath].jobs[0].head_branch='main'],
      ['job success',f=>f.endpoints[jobsPath].jobs[0].conclusion='success'],['job completion',f=>f.endpoints[jobsPath].jobs[0].completed_at='2026-10-17T03:03:23Z'],
      ['job start',f=>f.endpoints[jobsPath].jobs[0].started_at='2026-10-17T03:02:13Z'],
      ['missing offline tests',f=>f.endpoints[jobsPath].jobs[0].steps.splice(6,1)],['wrong failed step',f=>f.endpoints[jobsPath].jobs[0].steps[7].conclusion='success'],
      ['added step',f=>f.endpoints[jobsPath].jobs[0].steps.push({...f.endpoints[jobsPath].jobs[0].steps[7]})],
      ['step chronology',f=>f.endpoints[jobsPath].jobs[0].steps[7].completed_at='2026-10-16T00:00:00Z'],
      ['changed spent request',f=>f.endpoints[requestPath].content=Buffer.from('{}').toString('base64')],
      ['unavailable spent request',f=>f.endpoints[requestPath].encoding='none'],
    ];
    for(const [name,mutate]of mutations){const f=run8FixtureApi();mutate(f);assert.throws(()=>authenticateRecovery(run8Request(),f.context,f.api,f.readLog),undefined,`run${identity.run_number}: ${name}`);}
  }
});
test('v4 proves all four immediate edges and rejects live, intervening, newer, duplicate and incomplete histories',()=>{
  const add=(f,run)=>{f.endpoints[inventoryPath].workflow_runs.push(run);f.endpoints[inventoryPath].total_count++;};
  const other=(id,number,change={})=>({...structuredClone(terminal.source),id,run_number:number,head_sha:'e'.repeat(40),...change});
  const mutations=[
    f=>add(f,other(38997227421,9)),f=>add(f,other(38997227421,9,{status:'queued',conclusion:null})),
    f=>add(f,other(38997227418,9)),f=>add(f,other(38997227415,9)), // current->abort7 and abort7->abort6
    f=>add(f,other(38993132262,9)),f=>add(f,other(38991458565,9)), // abort6->abort5 and abort5->source4
    f=>add(f,other(37478731831,3,{status:'in_progress',conclusion:null})),
    ...[reviewedAbort7,reviewedAbort6,reviewedAbort].flatMap(identity=>[
      f=>add(f,other(37478731831,identity.run_number)),f=>add(f,other(37478731831,3,{head_sha:identity.head_sha})),
      f=>add(f,structuredClone(f.endpoints[inventoryPath].workflow_runs.find(run=>run.id===identity.run_id))),
      f=>{f.endpoints[inventoryPath].workflow_runs=f.endpoints[inventoryPath].workflow_runs.filter(run=>run.id!==identity.run_id);f.endpoints[inventoryPath].total_count--;}]),
    f=>f.endpoints[inventoryPath].total_count=101,f=>f.endpoints[inventoryPath].total_count--,
    f=>f.endpoints[`${apiRoot}/actions/runs/${reviewedSource.run_id}`].run_attempt=2,
    f=>f.endpoints[`${apiRoot}/actions/runs/${reviewedSource.run_id}/attempts/1`].head_sha='e'.repeat(40),
    f=>f.endpoints[`${apiRoot}/actions/runs/${f.context.id}/attempts/1`].run_attempt=2,
    f=>f.endpoints[`${apiRoot}/git/ref/heads/${abortBranch}`].object.sha=reviewedAbort7.head_sha,
  ];
  for(const mutate of mutations){const f=run8FixtureApi();mutate(f);assert.throws(()=>authenticateRecovery(run8Request(),f.context,f.api,f.readLog));}
  const f=run8FixtureApi();f.state.current.run_started_at='2026-10-17T03:03:22Z';
  f.endpoints[inventoryPath].workflow_runs[0].run_started_at=f.state.current.run_started_at;
  assert.throws(()=>authenticateAbortContinuity(run8Request(),f.state,f.api,f.readLog),/terminal abort job/);
});
test('v4 requires all complete logs and unchanged retained work before source artifact access',()=>{
  for(const [identity,original]of [[reviewedAbort7,log7],[reviewedAbort6,log6],[reviewedAbort,log]]){
    for(const altered of [Buffer.alloc(0),original.subarray(0,original.length-1),Buffer.from(original).fill(0,10,11),original.toString()]){
      const f=run8FixtureApi();assert.throws(()=>authenticateRecovery(run8Request(),f.context,f.api,id=>id===identity.job_id?altered:f.readLog(id)),/log/);
      assert.ok(!f.calls.includes(`${apiRoot}/actions/runs/${reviewedSource.run_id}/artifacts?per_page=100`));
    }
    const f=run8FixtureApi();assert.throws(()=>authenticateRecovery(run8Request(),f.context,f.api,id=>{if(id===identity.job_id)throw Error('Missing reviewed log');return f.readLog(id);}),/Missing reviewed log/);
  }
  for(const mutate of [r=>r.selection[0].receipts[0].receipt_sha256='e'.repeat(64),r=>r.limits.max_statement_getter_calls=5,r=>r.limits.caller_retries=1]){
    const f=run8FixtureApi(),r=run8Request();mutate(r);assert.throws(()=>authenticateRecovery(r,f.context,f.api,f.readLog),/retained work/);
    assert.ok(!f.calls.includes(`${apiRoot}/actions/runs/${reviewedSource.run_id}/artifacts?per_page=100`));
  }
});

test('v4 activation is request-only M after exactly one run7 code-only child, including shallow checkout',()=>{
  const dir=mkdtempSync(join(tmpdir(),'abort7-replacement-'));
  const git=(args,input)=>execFileSync('git',args,{cwd:dir,input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  try{
    git(['init','-q']);git(['config','user.name','Offline Fixture']);git(['config','user.email','fixture@example.invalid']);
    assert.equal(git(['hash-object','-w','-t','commit','--stdin'],fixture7('activation.commit')),reviewedAbort7.head_sha);
    assert.equal(git(['hash-object','-w','-t','commit','--stdin'],fixture('activation.commit')),reviewedAbort.head_sha);
    assert.equal(git(['hash-object','-w','-t','commit','--stdin'],fixture6('activation.commit')),reviewedAbort6.head_sha);
    mkdirSync(join(dir,'.github/targeted-financial-recovery'),{recursive:true});writeFileSync(join(dir,spentRequestPath),old7Bytes);
    writeFileSync(join(dir,'controller.txt'),'reviewed repair');git(['add','.']);
    const tree=git(['write-tree']),parent=git(['commit-tree',tree,'-p',reviewedAbort7.head_sha,'-m','Reviewed run7 code-only repair']);
    git(['update-ref','HEAD',parent]);const r=run8Request();r.controller={parent_sha:parent,parent_tree:tree};
    writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);
    const head=git(['commit-tree',git(['write-tree']),'-p',parent,'-m','New finite run8 request']);git(['update-ref','HEAD',head]);
    const context={repository,event:'push',branch:abortBranch,attempt:1,sha:head,id:38997227421};
    assert.doesNotThrow(()=>verifyActivation(r,context,dir));
    writeFileSync(join(dir,'.git/shallow'),parent+'\n');assert.doesNotThrow(()=>verifyActivation(r,context,dir));
    for(const change of [{attempt:2},{branch:'main'},{event:'workflow_dispatch'}])assert.throws(()=>verifyReplacementActivation(r,{...context,...change},dir));
    writeFileSync(join(dir,'extra.txt'),'x');assert.throws(()=>verifyActivation(r,context,dir),/clean/);rmSync(join(dir,'extra.txt'));
    writeFileSync(join(dir,'controller.txt'),'mixed code');git(['add','.']);
    const mixed=git(['commit-tree',git(['write-tree']),'-p',parent,'-m','Mixed activation']);
    assert.throws(()=>verifyReplacementActivation(r,{...context,sha:mixed},dir),/only modify/);
    for(const previous of [reviewedAbort.head_sha,reviewedAbort6.head_sha,parent]){
      git(['reset','--hard',parent]);const wrongParent=git(['commit-tree',tree,'-p',previous,'-m','Wrong repair ancestry']);
      writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);
      const wrongHead=git(['commit-tree',git(['write-tree']),'-p',wrongParent,'-m','Replacement']);
      assert.throws(()=>verifyReplacementActivation({...r,controller:{...r.controller,parent_sha:wrongParent}},{...context,sha:wrongHead},dir),/code-only child/);
    }
    git(['reset','--hard',parent]);writeFileSync(join(dir,spentRequestPath),old7Bytes.toString()+' ');git(['add','.']);
    const badParent=git(['commit-tree',git(['write-tree']),'-p',reviewedAbort7.head_sha,'-m','Changed spent run7 request']);
    writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);const badHead=git(['commit-tree',git(['write-tree']),'-p',badParent,'-m','Replacement']);
    assert.throws(()=>verifyReplacementActivation({...r,controller:{...r.controller,parent_sha:badParent}},{...context,sha:badHead},dir),/spent request/);
    git(['reset','--hard',parent]);git(['rm','-q',spentRequestPath]);
    const removedParent=git(['commit-tree',git(['write-tree']),'-p',reviewedAbort7.head_sha,'-m','Deleted spent request']);
    mkdirSync(join(dir,'.github/targeted-financial-recovery'),{recursive:true});
    writeFileSync(join(dir,spentRequestPath),JSON.stringify(r));git(['add','.']);const addedHead=git(['commit-tree',git(['write-tree']),'-p',removedParent,'-m','Readded request']);
    assert.throws(()=>verifyReplacementActivation({...r,controller:{...r.controller,parent_sha:removedParent}},{...context,sha:addedHead},dir),/only modify/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

// Run8 retained a prepared artifact. Its proof is deliberately distinct from
// the three empty-artifact aborts above and never changes completed source4.
import {run9ReplacementSchema,reviewedPreparedAbort8,readPreparedAbortArtifact,verifyPreparedAbortArtifactBytes} from './verify-statement-pre-provider-abort.mjs';
import {preparedAbortFixture,preparedAbortRequest,run8Fixture} from './fixtures/targeted-prepared-abort-run8/offline-fixture.mjs';
const preparedTerminal=JSON.parse(run8Fixture('terminal.json'));

test('run8 immutable code, full log and prepared audit bind the exact guard-before-collector failure',()=>{
  const log8=run8Fixture('job.log'),old8=run8Fixture('request.json'),commit=run8Fixture('activation.commit');
  assert.equal(log8.length,84586);assert.equal(hash(log8),reviewedPreparedAbort8.job_log_sha256);
  assert.equal(hash(old8),reviewedPreparedAbort8.request_sha256);assert.equal(gitObject('commit',commit),reviewedPreparedAbort8.head_sha);
  const trees=JSON.parse(run8Fixture('git-trees.json')),proof=JSON.parse(run8Fixture('code-proof.json')),entries={};
  assert.equal(commit.toString().match(/^tree ([a-f0-9]{40})$/m)[1],'19d995aaa270712f015a5a5e6b47f23522a110fb');
  assert.equal(commit.toString().match(/^tree ([a-f0-9]{40})$/m)[1],trees[''].sha);
  assert.deepEqual([...commit.toString().matchAll(/^parent ([a-f0-9]{40})$/gm)].map(m=>m[1]),[JSON.parse(old8).controller.parent_sha]);
  for(const [path,tree]of Object.entries(trees)){
    const bytes=Buffer.from(tree.content,'base64');assert.equal(gitObject('tree',bytes),tree.sha);entries[path]=treeEntries(bytes);
  }
  for(const path of Object.keys(trees).filter(Boolean)){
    const slash=path.lastIndexOf('/'),parent=slash<0?'':path.slice(0,slash),name=path.slice(slash+1);
    assert.deepEqual(entries[parent][name],{mode:'40000',sha:trees[path].sha});
  }
  for(const [path,item]of Object.entries(proof)){
    const bytes=run8Fixture(item.fixture),slash=path.lastIndexOf('/');
    assert.equal(hash(bytes),item.sha256);assert.equal(gitObject('blob',bytes),item.blob_sha);
    assert.deepEqual(entries[path.slice(0,slash)][path.slice(slash+1)],{mode:'100644',sha:item.blob_sha});
  }
  const code=run8Fixture('cycle.py.txt').toString(),lines=code.split('\n');
  assert.match(lines[362],/allowance = helpers.bounded_acquisition_budget/);
  assert.match(lines[374],/result, code = collector\(/);assert.equal(code.match(/result, code = collector\(/g).length,1);
  assert.match(log8.toString(),/run-statement-targeted-cycle\.py", line 363, in run/);
  assert.match(log8.toString(),/Bounded refresh setup exhausted the acquisition allowance; finalization reserve is retained/);
  const cycle8=JSON.parse(run8Fixture('cycle.json')),audit=JSON.parse(run8Fixture('audit-result.json'));
  assert.equal(cycle8.phase,'prepared');assert.equal(cycle8.archive_manifest_sha256,reviewedSource.archive_manifest_sha256);
  assert.equal(cycle8.request_sha256,reviewedPreparedAbort8.request_sha256);assert.equal(cycle8.published,false);
  assert.equal(audit.artifact_sha256,reviewedPreparedAbort8.artifact_sha256);assert.equal(audit.artifact_bytes,reviewedPreparedAbort8.artifact_bytes);
  assert.deepEqual([audit.archive_files_preserved,audit.objects,audit.receipts,audit.attempts,audit.cohort_count],[8431,8417,4154,4182,1894]);
  assert.equal(audit.source4_archive_byte_inventory_exact,true);assert.equal(audit.cohort_order_exact,true);assert.equal(audit.batch_directory_present,false);
  const invocation=JSON.parse(run8Fixture('invocation.json')),provider=JSON.parse(run8Fixture('provider-invocation.json'));
  assert.equal(invocation.authenticated_at,'2026-10-17T07:35:31.877Z');assert.equal(provider.authenticated_at,'2026-10-17T07:41:41.937Z');
  const withoutClock=({authenticated_at,...rest})=>rest;assert.deepEqual(withoutClock(invocation),withoutClock(provider));
  assert.deepEqual(invocation.source,reviewedSource);assert.equal(preparedTerminal.jobs.jobs[0].completed_at,'2026-10-17T07:41:58Z');
  assert.equal(preparedTerminal.jobs.jobs[0].steps.at(-1).completed_at,'2026-10-17T07:41:53Z');
});

test('v5 permits only the exact prepared8 plus fixed historical7/6/5 chain with unchanged source4',()=>{
  const r=preparedAbortRequest();assert.doesNotThrow(()=>validateAbortContinuity(r));
  assert.equal(validateRequest(r,Date.parse('2026-10-17T08:01:00Z')).schema_version,run9ReplacementSchema);
  const mutations=[r=>r.expected_run_number=8,r=>r.expected_run_number=10,r=>r.schema_version=run8ReplacementSchema,
    r=>r.abort_continuity.run8={...reviewedAbort7},r=>delete r.abort_continuity.run8,r=>r.abort_continuity.run9={...reviewedPreparedAbort8},
    r=>r.abort_continuity.run8.schema_version='financial-pre-provider-abort-v1',r=>r.source.run_id=reviewedPreparedAbort8.run_id,
    r=>r.source.artifact_id=reviewedPreparedAbort8.artifact_id,r=>r.created_at='2026-10-17T07:41:58Z',
    r=>r.operation_id=JSON.parse(run8Fixture('request.json')).operation_id,
    ...['run8','run7','run6','run5'].flatMap(key=>[r=>delete r.abort_continuity[key],r=>r.abort_continuity[key].extra=true,
      r=>r.abort_continuity[key].run_attempt=2,r=>r.abort_continuity[key].head_sha='f'.repeat(40),r=>r.abort_continuity[key].job_log_sha256='f'.repeat(64)]),
    ...['artifact_id','artifact_bytes','artifact_sha256'].map(key=>r=>r.abort_continuity.run8[key]='changed')];
  for(const change of mutations){const value=preparedAbortRequest();change(value);assert.throws(()=>validateAbortContinuity(value));}
});

test('v5 exact metadata, job, history, spent request and complete log fail closed before artifact bytes',()=>{
  const prefix=`${apiRoot}/actions/runs/${reviewedPreparedAbort8.run_id}`,artifacts=prefix+'/artifacts?per_page=100',jobs=prefix+'/attempts/1/jobs?per_page=100';
  const request8=`${apiRoot}/contents/${spentRequestPath}?ref=${reviewedPreparedAbort8.head_sha}`;
  const changes=[
    f=>f.endpoints[prefix].run_attempt=2,f=>f.endpoints[prefix].status='in_progress',f=>f.endpoints[prefix].conclusion='cancelled',
    f=>f.endpoints[prefix+'/attempts/1'].head_sha='f'.repeat(40),f=>f.endpoints[prefix].repository.id++,
    f=>f.endpoints[prefix].workflow_id++,f=>f.endpoints[jobs].total_count=2,f=>f.endpoints[jobs].jobs[0].id++,
    f=>f.endpoints[jobs].jobs[0].completed_at='2026-10-17T07:41:53Z',f=>f.endpoints[jobs].jobs[0].steps[7].conclusion='success',
    f=>f.endpoints[jobs].jobs[0].steps.splice(6,1),f=>f.endpoints[request8].content=Buffer.from('{}').toString('base64'),
    f=>f.endpoints[artifacts]={total_count:0,artifacts:[]},f=>f.endpoints[artifacts].total_count=2,
    f=>f.endpoints[artifacts].artifacts.push(structuredClone(f.endpoints[artifacts].artifacts[0])),
    ...['id','size_in_bytes','digest','name','created_at'].map(key=>f=>f.endpoints[artifacts].artifacts[0][key]='wrong'),
    f=>f.endpoints[artifacts].artifacts[0].expired=true,
    ...['id','head_sha','head_branch','repository_id','head_repository_id'].map(key=>f=>f.endpoints[artifacts].artifacts[0].workflow_run[key]='wrong'),
    ...[reviewedPreparedAbort8,reviewedAbort7,reviewedAbort6,reviewedAbort,reviewedSource].map(identity=>f=>{
      f.endpoints[f.inventoryPath].workflow_runs=f.endpoints[f.inventoryPath].workflow_runs.filter(run=>run.id!==identity.run_id);f.endpoints[f.inventoryPath].total_count--;}),
    ...[39013437786,38997227415,38993132262,38991458565,39013437791].map(id=>f=>{
      f.endpoints[f.inventoryPath].workflow_runs.push({...structuredClone(terminal.source),id,run_number:10,head_sha:'e'.repeat(40)});f.endpoints[f.inventoryPath].total_count++;}),
  ];
  for(const change of changes){const f=preparedAbortFixture();change(f);let bytesRead=false;
    assert.throws(()=>authenticateAbortContinuity(preparedAbortRequest(),f.state,f.api,f.readLog,()=>{bytesRead=true;throw Error('Unexpected bytes read');}));
    assert.equal(bytesRead,false);
  }
  for(const bad of [Buffer.alloc(0),run8Fixture('job.log').subarray(1),run8Fixture('job.log').toString()]){
    const f=preparedAbortFixture();let bytesRead=false;
    assert.throws(()=>authenticateAbortContinuity(preparedAbortRequest(),f.state,f.api,()=>bad,()=>{bytesRead=true;}),/log/);
    assert.equal(bytesRead,false);
  }
});

test('v5 real artifact bytes are mandatory: empty, truncated, wrong-sized, digest-only and same-size corrupt values fail',()=>{
  for(const invalid of [undefined,null,{sha256:reviewedPreparedAbort8.artifact_sha256,size:reviewedPreparedAbort8.artifact_bytes},
      Buffer.alloc(0),Buffer.alloc(reviewedPreparedAbort8.artifact_bytes-1),Buffer.alloc(reviewedPreparedAbort8.artifact_bytes),
      Buffer.alloc(reviewedPreparedAbort8.artifact_bytes+1)]){
    assert.throws(()=>verifyPreparedAbortArtifactBytes(invalid),/artifact bytes/);
  }
  assert.throws(()=>readPreparedAbortArtifact(reviewedSource.artifact_id),/Unreviewed/);
  const f=preparedAbortFixture();let reads=0;
  assert.throws(()=>authenticateAbortContinuity(preparedAbortRequest(),f.state,f.api,f.readLog,id=>{
    assert.equal(id,reviewedPreparedAbort8.artifact_id);reads++;return Buffer.alloc(0);}),/artifact bytes/);
  assert.equal(reads,1);assert.deepEqual(f.logCalls,[reviewedPreparedAbort8.job_id]);
  assert.ok(!f.calls.includes(`${apiRoot}/actions/runs/${reviewedSource.run_id}/artifacts?per_page=100`));
});

test('v5 activation is request-only after one exact run8 code-only child with byte-identical spent request',()=>{
  const dir=mkdtempSync(join(tmpdir(),'prepared-abort8-replacement-'));
  const git=(args,input)=>execFileSync('git',args,{cwd:dir,input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  try{
    git(['init','-q']);git(['config','user.name','Offline Fixture']);git(['config','user.email','fixture@example.invalid']);
    assert.equal(git(['hash-object','-w','-t','commit','--stdin'],run8Fixture('activation.commit')),reviewedPreparedAbort8.head_sha);
    mkdirSync(join(dir,'.github/targeted-financial-recovery'),{recursive:true});writeFileSync(join(dir,spentRequestPath),run8Fixture('request.json'));
    writeFileSync(join(dir,'controller.txt'),'reviewed repair');git(['add','.']);const tree=git(['write-tree']);
    const parent=git(['commit-tree',tree,'-p',reviewedPreparedAbort8.head_sha,'-m','Reviewed code-only repair']);git(['update-ref','HEAD',parent]);
    const request=preparedAbortRequest();request.controller={parent_sha:parent,parent_tree:tree};writeFileSync(join(dir,spentRequestPath),JSON.stringify(request));git(['add','.']);
    const head=git(['commit-tree',git(['write-tree']),'-p',parent,'-m','Hypothetical offline activation']);git(['update-ref','HEAD',head]);
    const context={repository,event:'push',branch:abortBranch,attempt:1,sha:head,id:39013437790};
    assert.doesNotThrow(()=>verifyActivation(request,context,dir));writeFileSync(join(dir,'.git/shallow'),parent+'\n');
    assert.doesNotThrow(()=>verifyActivation(request,context,dir));
    git(['reset','--hard',parent]);writeFileSync(join(dir,spentRequestPath),run8Fixture('request.json').toString()+' ');git(['add','.']);
    const changedParent=git(['commit-tree',git(['write-tree']),'-p',reviewedPreparedAbort8.head_sha,'-m','Changed spent request']);
    writeFileSync(join(dir,spentRequestPath),JSON.stringify(request));git(['add','.']);
    const changed=git(['commit-tree',git(['write-tree']),'-p',changedParent,'-m','Invalid replacement']);
    assert.throws(()=>verifyReplacementActivation({...request,controller:{parent_sha:changedParent,parent_tree:tree}},{...context,sha:changed},dir),/spent request/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('prepared ZIP transport is file-only, privately bounded and cleans up on success, truncation and error',()=>{
  const temporaryRoot=mkdtempSync(join(tmpdir(),'prepared-transport-test-'));
  const check=(command,args,options)=>{
    assert.equal(command,'python3');assert.match(args[1],/resource\.setrlimit\(resource\.RLIMIT_FSIZE,\(limit,limit\)\)/);
    assert.equal(args[2],String(reviewedPreparedAbort8.artifact_bytes));
    assert.equal(args[3],`${apiRoot}/actions/artifacts/${reviewedPreparedAbort8.artifact_id}/zip`);
    assert.equal(options.timeout,60000);assert.equal(options.maxBuffer,65536);
    assert.equal(options.stdio[0],'ignore');assert.equal(typeof options.stdio[1],'number');assert.equal(options.stdio[2],'pipe');
    const info=fstatSync(options.stdio[1]);assert.equal(info.mode&0o777,0o600);assert.equal(info.size,0);
    return options.stdio[1];
  };
  try{
    const bytes=readPreparedAbortArtifact(reviewedPreparedAbort8.artifact_id,{temporaryRoot,execute:(...args)=>{
      const descriptor=check(...args);ftruncateSync(descriptor,reviewedPreparedAbort8.artifact_bytes);writeSync(descriptor,Buffer.from('PK'),0,2,0);
    }});
    // This exercises transport only. These dummy bytes explicitly fail proof.
    assert.equal(bytes.length,reviewedPreparedAbort8.artifact_bytes);assert.equal(bytes.subarray(0,2).toString(),'PK');
    assert.throws(()=>verifyPreparedAbortArtifactBytes(bytes),/artifact bytes/);assert.deepEqual(readdirSync(temporaryRoot),[]);
    for(const size of [0,1,reviewedPreparedAbort8.artifact_bytes-1,reviewedPreparedAbort8.artifact_bytes+1]){
      assert.throws(()=>readPreparedAbortArtifact(reviewedPreparedAbort8.artifact_id,{temporaryRoot,execute:(...args)=>{
        ftruncateSync(check(...args),size);}}),/download failed/);assert.deepEqual(readdirSync(temporaryRoot),[]);
    }
    assert.throws(()=>readPreparedAbortArtifact(reviewedPreparedAbort8.artifact_id,{temporaryRoot,execute:(...args)=>{
      check(...args);throw Error('private transport details must not escape');}}),error=>error.message==='Reviewed prepared abort artifact download failed');
    assert.deepEqual(readdirSync(temporaryRoot),[]);
  }finally{rmSync(temporaryRoot,{recursive:true,force:true});}
});

test('prepared transport applies its actual child file-size cap without contacting GitHub',()=>{
  const temporaryRoot=mkdtempSync(join(tmpdir(),'prepared-fsize-test-'));
  try{
    assert.throws(()=>readPreparedAbortArtifact(reviewedPreparedAbort8.artifact_id,{temporaryRoot,execute:(command,args,options)=>{
      // Replace only gh exec with local overflow writes. The real production
      // resource-limit prefix and inherited file descriptor run unmodified.
      const local=[...args];local[1]=local[1].replace("os.execvp('gh',['gh','api',sys.argv[2]])", "os.write(1,b'x'*limit);os.write(1,b'y')");
      assert.notEqual(local[1],args[1]);
      assert.throws(()=>execFileSync(command,local,options));
      assert.equal(fstatSync(options.stdio[1]).size,reviewedPreparedAbort8.artifact_bytes);
      throw Error('Local overflow was rejected');
    }}),/download failed/);
    assert.deepEqual(readdirSync(temporaryRoot),[]);
  }finally{rmSync(temporaryRoot,{recursive:true,force:true});}
});

test('prepared transport rejects linked roots or ancestors before execution and substituted/unlinked files after execution',()=>{
  const temporaryRoot=mkdtempSync(join(tmpdir(),'prepared-path-test-'));
  try{
    const target=join(temporaryRoot,'target'),linked=join(temporaryRoot,'linked');mkdirSync(target);mkdirSync(join(target,'nested'));symlinkSync(target,linked);
    for(const root of [linked,join(linked,'nested')]){
      let called=false;assert.throws(()=>readPreparedAbortArtifact(reviewedPreparedAbort8.artifact_id,{temporaryRoot:root,execute:()=>{called=true;}}),/download failed/);
      assert.equal(called,false);assert.deepEqual(readdirSync(join(target,'nested')),[]);assert.deepEqual(readdirSync(target),['nested']);
    }
    for(const substitute of [false,true]){
      const transportRoot=join(temporaryRoot,substitute?'substituted':'unlinked');mkdirSync(transportRoot);
      assert.throws(()=>readPreparedAbortArtifact(reviewedPreparedAbort8.artifact_id,{temporaryRoot:transportRoot,execute:(_command,_args,options)=>{
        const path=join(transportRoot,readdirSync(transportRoot)[0],'artifact.zip');
        ftruncateSync(options.stdio[1],reviewedPreparedAbort8.artifact_bytes);
        if(substitute){renameSync(path,path+'.moved');writeFileSync(path,'replacement');}else unlinkSync(path);
      }}),/download failed/);
      assert.deepEqual(readdirSync(transportRoot),[]);
    }
  }finally{rmSync(temporaryRoot,{recursive:true,force:true});}
});
