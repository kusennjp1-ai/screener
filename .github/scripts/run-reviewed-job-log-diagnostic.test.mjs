import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {readReviewedJobLog} from './download-reviewed-job-log.mjs';
import {repository,branch,workflowPath,requestPath,financialRequestPath,financialRequestHash,base,prior,priorSteps,target,controllerChanges,compatibilityChanges,
  validateRequest,validateContext,verifyActivation,metadataApi,authenticate,checkedRuntime,verifiedResult,failureResult,renderResult,runDiagnostic} from './run-reviewed-job-log-diagnostic.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
// The actual immutable financial request already exists in every deployed
// checkout. Local review may explicitly supply that same byte-for-byte fixture.
const financial=readFileSync(process.env.REVIEWED_DIAGNOSTIC_FINANCIAL_FIXTURE??join(root,financialRequestPath));
const spent=process.env.REVIEWED_DIAGNOSTIC_SPENT_FIXTURE?readFileSync(process.env.REVIEWED_DIAGNOSTIC_SPENT_FIXTURE):execFileSync('git',['show',`${base.sha}:${requestPath}`],{cwd:root,maxBuffer:16384});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>structuredClone(value);
const now=Date.parse('2030-01-01T00:01:00Z');
function fixture(){
  const request={schema_version:'reviewed-job-log-diagnostic-request-v2',operation_id:'log-diagnostic2-11111111-1111-4111-8111-111111111111',
    created_at:'2030-01-01T00:00:00Z',expires_at:'2030-01-01T00:30:00Z',
    controller:{parent_sha:'c'.repeat(40),parent_tree:'d'.repeat(40)},expected_run_number:2,expected_run_attempt:1,
    target:{...target},limits:{helper_calls:1,caller_retries:0,provider_getter_calls:0,timeout_seconds:30,max_bytes:1048576}};
  const context={repository,repositoryId:12,event:'push',branch,ref:`refs/heads/${branch}`,id:38998636876,attempt:1,runNumber:2,sha:'e'.repeat(40),
    workflowRef:`${repository}/${workflowPath}@refs/heads/${branch}`,workflowSha:'e'.repeat(40)};
  const event={ref:context.ref,before:request.controller.parent_sha,after:context.sha,created:false,deleted:false,forced:false,
    repository:{id:12,full_name:repository},head_commit:{id:context.sha},commits:[{id:context.sha}]};
  const run={id:38998636876,run_attempt:1,run_number:2,head_sha:context.sha,head_branch:branch,path:workflowPath,event:'push',status:'in_progress',conclusion:null,
    workflow_id:prior.workflow_id,repository:{id:12,full_name:repository},head_repository:{id:12,full_name:repository},
    created_at:'2030-01-01T00:00:01Z',run_started_at:'2030-01-01T00:00:02Z'};
  const previous={id:prior.run_id,run_attempt:1,run_number:1,head_sha:prior.sha,head_branch:branch,path:workflowPath,event:'push',status:'completed',conclusion:'failure',
    workflow_id:prior.workflow_id,repository:{id:12,full_name:repository},head_repository:{id:12,full_name:repository},
    created_at:prior.created_at,run_started_at:prior.run_started_at,updated_at:prior.updated_at};
  const comparison=(parent,head,tree,names,status)=>({status:'ahead',ahead_by:1,behind_by:0,total_commits:1,
    base_commit:{sha:parent,commit:{tree:{sha:parent===prior.sha?prior.tree:prior.controller_tree}}},merge_base_commit:{sha:parent},commits:[{sha:head,commit:{tree:{sha:tree}},parents:[{sha:parent}]}],
    files:names.map(filename=>({filename,status}))});
  const responses=new Map([
    [`repos/${repository}`,{id:12,full_name:repository}],
    [`repos/${repository}/actions/runs/38998636876`,copy(run)],
    [`repos/${repository}/actions/runs/38998636876/attempts/1`,copy(run)],
    [`repos/${repository}/actions/workflows/${prior.workflow_id}`,{id:prior.workflow_id,path:workflowPath,state:'active'}],
    [`repos/${repository}/actions/workflows/${prior.workflow_id}/runs?per_page=100`,{total_count:2,workflow_runs:[copy(run),copy(previous)]}],
    [`repos/${repository}/actions/jobs/${target.job_id}`,{id:target.job_id,run_id:target.run_id,run_attempt:1,head_sha:target.head_sha,status:'completed',conclusion:'failure'}],
    [`repos/${repository}/git/ref/heads/${branch}`,{ref:context.ref,object:{type:'commit',sha:context.sha}}],
    [`repos/${repository}/actions/runs/${prior.run_id}`,copy(previous)],
    [`repos/${repository}/actions/runs/${prior.run_id}/attempts/1`,copy(previous)],
    [`repos/${repository}/actions/runs/${prior.run_id}/attempts/1/jobs?per_page=100`,{total_count:1,jobs:[{id:prior.job_id,run_id:prior.run_id,run_attempt:1,head_sha:prior.sha,name:'reviewed-log-diagnostic',status:'completed',conclusion:'failure',started_at:prior.job_started_at,completed_at:prior.job_completed_at,steps:copy(priorSteps)}]}],
    [`repos/${repository}/git/commits/${base.sha}`,{sha:base.sha,tree:{sha:base.tree},parents:[{sha:prior.sha}]}],
    [`repos/${repository}/git/commits/${prior.sha}`,{sha:prior.sha,tree:{sha:prior.tree},parents:[{sha:prior.controller_sha}]}],
    [`repos/${repository}/compare/${prior.sha}...${base.sha}?per_page=100`,comparison(prior.sha,base.sha,base.tree,compatibilityChanges,'modified')],
    [`repos/${repository}/compare/${prior.controller_sha}...${prior.sha}?per_page=100`,comparison(prior.controller_sha,prior.sha,prior.tree,[requestPath],'added')],
  ]);
  const commands=new Map([
    ['rev-parse HEAD',context.sha],['status --porcelain --untracked-files=all',''],
    ['rev-list --parents -n 1 HEAD',`${context.sha} ${request.controller.parent_sha}`],
    [`rev-parse ${request.controller.parent_sha}^{tree}`,request.controller.parent_tree],
    [`rev-list --parents -n 1 ${request.controller.parent_sha}`,`${request.controller.parent_sha} ${base.sha}`],
    [`rev-parse ${base.sha}^{tree}`,base.tree],
    [`diff --name-status --no-renames ${request.controller.parent_sha} ${context.sha}`,`M\t${requestPath}`],
    [`diff --name-status --no-renames ${base.sha} ${request.controller.parent_sha}`,controllerChanges.join('\n')],
  ]);
  const requestBytes=()=>Buffer.from(JSON.stringify(request));
  const io={git:args=>{const key=args.join(' ');assert.ok(commands.has(key));return commands.get(key);},
    gitFile:object=>object.endsWith(`:${requestPath}`)?(object.startsWith(context.sha+':')?requestBytes():spent):financial,
    readFile:path=>path.endsWith(requestPath)?requestBytes():financial};
  const calls=[];
  const api=endpoint=>{calls.push(endpoint);assert.ok(responses.has(endpoint));return responses.get(endpoint);};
  return {request,context,event,run,responses,commands,io,api,calls};
}
function runFixture(f,extras={}){return runDiagnostic({context:f.context,event:f.event,io:f.io,api:f.api,now:()=>now,...extras});}
function stoppedBeforeHelper(f,extras={}){
  let reads=0;
  const result=runFixture(f,{readLog:()=>{reads++;throw Error('unexpected read');},...extras});
  assert.equal(result.outcome,'failed');assert.equal(reads,0);return result;
}

test('spent diagnostic request fixture remains exact',()=>assert.equal(digest(spent),prior.request_sha256));
test('financial request fixture is the exact unspent-getters run7 request',()=>assert.equal(digest(financial),financialRequestHash));
test('fixed target is only reviewed run6 job, count and hash',()=>assert.deepEqual(target,{repository,run_id:38993132263,run_number:6,run_attempt:1,
  head_sha:'12b4e4dba9c847d754b7ec3b47b234984386a1f4',job_id:117279659374,bytes:59325,
  sha256:'47dabe41056aeb89eb17d2408bb120c10998868eaf4ccfb17597026b6ccfc462'}));
test('closed finite diagnostic request accepts only bound zero-provider limits',()=>assert.equal(validateRequest(fixture().request,now).limits.provider_getter_calls,0));
for(const [label,mutate] of [
  ['unknown field',r=>r.extra='value'],['wrong schema',r=>r.schema_version='financial-targeted-recovery-execution-v4'],
  ['missing unique operation',r=>r.operation_id='retry'],['wrong target job',r=>r.target.job_id=117274547210],
  ['wrong target run',r=>r.target.run_id++],['wrong target hash',r=>r.target.sha256='f'.repeat(64)],
  ['wrong target bytes',r=>r.target.bytes++],['wrong repository',r=>r.target.repository='other/repo'],
  ['extra target data',r=>r.target.url='https://secret.invalid'],['rerun number',r=>r.expected_run_number=3],
  ['rerun attempt',r=>r.expected_run_attempt=2],['more helper calls',r=>r.limits.helper_calls=2],
  ['caller retry',r=>r.limits.caller_retries=1],['provider authority',r=>r.limits.provider_getter_calls=1],
  ['oversized transport',r=>r.limits.max_bytes++],['extended timeout',r=>r.limits.timeout_seconds++],
  ['future intent',r=>r.created_at='2030-01-01T00:02:00Z'],['expired intent',r=>r.expires_at='2030-01-01T00:01:00Z'],
  ['more than30minutes',r=>r.expires_at='2030-01-01T00:30:01Z'],['empty interval',r=>r.expires_at=r.created_at],
  ['invalid date',r=>r.created_at='2030-13-01T00:00:00Z'],['nonUTC date',r=>r.created_at='2030-01-01T00:00:00+00:00'],
  ['controller is consumed base',r=>r.controller.parent_sha=base.sha],['unbound controller',r=>r.controller.parent_tree='bad'],
])test(`request rejects ${label} without metadata or helper`,()=>{
  const f=fixture();mutate(f.request);stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
});

test('clean local activation authenticates only exact compatibility then C then A and preserved financial bytes',()=>{
  const f=fixture();assert.deepEqual(verifyActivation(f.request,f.context,root,f.io),Buffer.from(JSON.stringify(f.request)));
});
for(const [label,key,value] of [
  ['dirty checkout','status --porcelain --untracked-files=all','?? secret'],
  ['wrong checkout','rev-parse HEAD','f'.repeat(40)],
  ['two activation parents','rev-list --parents -n 1 HEAD',`${'e'.repeat(40)} ${'c'.repeat(40)} ${'a'.repeat(40)}`],
  ['wrong controller tree',`rev-parse ${'c'.repeat(40)}^{tree}`,'f'.repeat(40)],
  ['wrong base parent',`rev-list --parents -n 1 ${'c'.repeat(40)}`,`${'c'.repeat(40)} ${'a'.repeat(40)}`],
  ['wrong actual base tree',`rev-parse ${base.sha}^{tree}`,'f'.repeat(40)],
  ['addition rather than replacement',`diff --name-status --no-renames ${'c'.repeat(40)} ${'e'.repeat(40)}`,`A\t${requestPath}`],
  ['activation changes financial request',`diff --name-status --no-renames ${'c'.repeat(40)} ${'e'.repeat(40)}`,`A\t${requestPath}\nM\t${financialRequestPath}`],
  ['controller expands scope',`diff --name-status --no-renames ${base.sha} ${'c'.repeat(40)}`,controllerChanges.join('\n')+'\nM\tprovider.py'],
])test(`activation rejects ${label}`,()=>{const f=fixture();f.commands.set(key,value);stoppedBeforeHelper(f);assert.equal(f.calls.length,0);});
for(const revision of ['base','controller','activation','worktree'])test(`changed financial bytes rejected at ${revision}`,()=>{
  const f=fixture(),original=f.io.gitFile;
  const shaValue=revision==='base'?base.sha:revision==='controller'?f.request.controller.parent_sha:f.context.sha;
  if(revision==='worktree')f.io.readFile=path=>path.endsWith(requestPath)?Buffer.from(JSON.stringify(f.request)):Buffer.from('changed');
  else f.io.gitFile=object=>object===`${shaValue}:${financialRequestPath}`?Buffer.from('changed'):original(object);
  stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
});
test('committed diagnostic request differs from worktree',()=>{
  const f=fixture(),original=f.io.gitFile;f.io.gitFile=object=>object.endsWith(`:${requestPath}`)?Buffer.from('{}'):original(object);
  stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
});

for(const [key,value] of Object.entries({repository:'other/repo',repositoryId:0,event:'workflow_dispatch',branch:'main',ref:'refs/tags/x',attempt:2,runNumber:3,id:0,sha:'bad',workflowRef:'other',workflowSha:'f'.repeat(40)}))test(`context rejects changed ${key}`,()=>{
  const f=fixture();f.context[key]=value;assert.throws(()=>validateContext(f.context));stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
});
test('authentic push and complete two-entry diagnostic inventory are required',()=>{
  const f=fixture();assert.equal(authenticate(f.request,f.context,f.event,f.api,now).id,f.context.id);assert.equal(f.calls.length,14);
  assert.ok(f.calls.includes(`repos/${repository}/actions/workflows/${prior.workflow_id}/runs?per_page=100`));
});
for(const [key,value] of Object.entries({forced:true,deleted:true,created:true,before:'f'.repeat(40),after:'f'.repeat(40),ref:'refs/heads/main'}))test(`push event rejects ${key}`,()=>{
  const f=fixture();f.event[key]=value;stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
});
for(const [label,mutate] of [
  ['two commits',e=>e.commits.push({id:'f'.repeat(40)})],['missing head identity',e=>delete e.head_commit],
  ['wrong repository id',e=>e.repository.id++],['foreign repository',e=>e.repository.full_name='other/repo'],
])test(`push event rejects ${label}`,()=>{const f=fixture();mutate(f.event);stoppedBeforeHelper(f);assert.equal(f.calls.length,0);});
for(const endpoint of ['current','attempt','inventory'])for(const [key,value] of Object.entries({id:123,run_attempt:2,run_number:3,head_sha:'f'.repeat(40),head_branch:'main',path:'.github/workflows/financial-statement-recovery.yml',event:'workflow_dispatch',status:'completed',workflow_id:57,conclusion:'success',created_at:'1999-01-01T00:00:00Z',run_started_at:'1999-01-01T00:00:00Z'}))test(`${endpoint} run rejects changed ${key}`,()=>{
  const f=fixture();const run=endpoint==='current'?f.responses.get(`repos/${repository}/actions/runs/38998636876`):endpoint==='attempt'?f.responses.get(`repos/${repository}/actions/runs/38998636876/attempts/1`):f.responses.get(`repos/${repository}/actions/workflows/${prior.workflow_id}/runs?per_page=100`).workflow_runs[0];
  run[key]=value;stoppedBeforeHelper(f);
});
for(const [label,mutate] of [
  ['more than two runs',i=>{i.total_count=3;i.workflow_runs.push(copy(i.workflow_runs[0]));}],
  ['partial inventory',i=>i.total_count=3],['empty inventory',i=>{i.total_count=0;i.workflow_runs=[];}],
  ['count type coercion',i=>i.total_count='1'],['same count but duplicate run',i=>i.workflow_runs.push(copy(i.workflow_runs[0]))],
])test(`inventory rejects ${label}`,()=>{
  const f=fixture();mutate(f.responses.get(`repos/${repository}/actions/workflows/${prior.workflow_id}/runs?per_page=100`));stoppedBeforeHelper(f);
});
for(const [label,endpoint,mutate] of [
  ['changed branch head',`git/ref/heads/${branch}`,r=>r.object.sha='f'.repeat(40)],
  ['noncommit branch',`git/ref/heads/${branch}`,r=>r.object.type='tag'],
  ['foreign repo','',r=>r.full_name='other/repo'],['disabled workflow',`actions/workflows/${prior.workflow_id}`,r=>r.state='disabled_manually'],
  ['wrong workflow path',`actions/workflows/${prior.workflow_id}`,r=>r.path='.github/workflows/financial-statement-recovery.yml'],
  ['wrong target job run',`actions/jobs/${target.job_id}`,r=>r.run_id++],
  ['wrong target job attempt',`actions/jobs/${target.job_id}`,r=>r.run_attempt++],
  ['nonterminal target job',`actions/jobs/${target.job_id}`,r=>r.status='in_progress'],
])test(`remote metadata rejects ${label}`,()=>{const f=fixture();mutate(f.responses.get(`repos/${repository}${endpoint?'/'+endpoint:''}`));stoppedBeforeHelper(f);});
test('expiry after metadata reads prevents log read',()=>{const f=fixture();let n=0;stoppedBeforeHelper(f,{now:()=>++n<3?now:Date.parse(f.request.expires_at)});});
test('less than the full30second allowance prevents log read',()=>{const f=fixture();let n=0;stoppedBeforeHelper(f,{now:()=>++n<3?now:Date.parse(f.request.expires_at)-29999});});

test('metadata API executes only bounded read-only gh commands, once per fixed endpoint',()=>{
  const f=fixture(),calls=[];const api=metadataApi(f.context,(program,args,options)=>{calls.push({program,args,options});return '{}';});
  api(`repos/${repository}`);assert.throws(()=>api(`repos/${repository}`));
  api(`repos/${repository}/actions/workflows/${prior.workflow_id}`);api(`repos/${repository}/actions/workflows/${prior.workflow_id}/runs?per_page=100`);
  for(const endpoint of [`repos/${repository}/actions/workflows/${prior.workflow_id+1}`,`repos/${repository}/actions/jobs/${target.job_id}/logs`,
    `repos/${repository}/actions/artifacts/1/zip`,'https://secret.invalid','repos/other/repo','repos/x/actions/workflows/1'])assert.throws(()=>api(endpoint));
  assert.equal(calls.length,3);
  for(const call of calls){assert.equal(call.program,'gh');assert.deepEqual(call.args.slice(0,5),['api','--method','GET','--hostname','github.com']);assert.equal(call.options.timeout,8000);assert.equal(call.options.maxBuffer,1048576);assert.deepEqual(call.options.stdio,['ignore','pipe','pipe']);}
});
test('exactly one helper read after authentic context; no retry on failure',()=>{
  const f=fixture();let reads=0;const result=runFixture(f,{readLog:job=>{reads++;assert.equal(job,target.job_id);throw Error('RAW TOKEN URL BODY');}});
  assert.equal(reads,1);assert.equal(result.outcome,'failed');assert.doesNotMatch(renderResult(result),/RAW|TOKEN|URL|BODY/);
});
test('helper private safe diagnostic is retained without invoking sockets',()=>{
  let error;try{readReviewedJobLog(target.job_id,{env:{},spawn:()=>assert.fail('worker must not spawn')});}catch(value){error=value;}
  const f=fixture();let reads=0;const result=runFixture(f,{readLog:()=>{reads++;throw error;}});
  assert.equal(reads,1);assert.equal(result.diagnostic.stage,'environment');assert.equal(result.diagnostic.cause,'environment-rejected');
  assert.equal(result.diagnostic.host,'none');assert.equal(result.diagnostic.status,0);
});
test('foreign error fields cannot forge helper diagnostic or leak strings',()=>{
  const error=Object.assign(Error('SECRET_TOKEN https://private.invalid body'),{stage:'api-response',cause:'http-status',host:'private.invalid',status:403,
    diagnostic:{stage:'api-response',cause:'http-status',host:'github-api',status:403}});
  assert.deepEqual(failureResult(error).diagnostic,{stage:'unknown',cause:'rejected',host:'none',status:0});
  assert.doesNotMatch(renderResult(failureResult(error)),/SECRET|https:|private|403/);
});
test('same-length wrong hash and wrong body type fail closed after one helper call',()=>{
  for(const body of [Buffer.alloc(target.bytes),Buffer.alloc(1),'secret',null]){
    const f=fixture();let reads=0;const result=runFixture(f,{readLog:()=>{reads++;return body;}});
    assert.equal(reads,1);assert.equal(result.outcome,'failed');assert.equal(result.diagnostic.stage,'controller-integrity');
  }
});
test('success output contains only the fixed expected identity, length and hash',()=>{
  const line=renderResult({schema_version:'reviewed-job-log-diagnostic-result-v1',outcome:'verified',target:{...target}});
  assert.deepEqual(JSON.parse(line).target,target);assert.ok(Buffer.byteLength(line)<1024);assert.equal(line.split('\n').length,2);
});
for(const mutate of [r=>r.raw='SECRET',r=>r.diagnostic.url='https://private.invalid',r=>r.diagnostic.stage='SECRET',
  r=>r.diagnostic.cause='SECRET',r=>r.diagnostic.host='private.invalid',r=>r.diagnostic.status='403',r=>r.diagnostic.status=600])test('output validation rejects unbounded or nonenum fields',()=>{
  const result=copy(failureResult(Error('SECRET')));mutate(result);assert.throws(()=>renderResult(result));
});
test('preexisting reviewed log fixture exercises exact successful full controller offline',()=>{
  let bytes;
  if(process.env.REVIEWED_DIAGNOSTIC_LOG_FIXTURE)bytes=readFileSync(process.env.REVIEWED_DIAGNOSTIC_LOG_FIXTURE);
  else{
    const stored=JSON.parse(readFileSync(join(root,'.github/scripts/fixtures/targeted-abort-run6/job-log.json')));
    assert.equal(stored.encoding,'base64');bytes=Buffer.from(stored.content,'base64');
  }
  assert.deepEqual(verifiedResult(bytes).target,target);
  const f=fixture();let reads=0;const result=runFixture(f,{readLog:()=>{reads++;return bytes;}});
  assert.equal(reads,1);assert.equal(result.outcome,'verified');assert.deepEqual(JSON.parse(renderResult(result)).target,target);
});
test('runtime requires normal GitHub-hosted Linux Node22 context',()=>{
  const f=fixture();const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',GITHUB_REPOSITORY:repository,
    GITHUB_SERVER_URL:'https://github.com',GITHUB_API_URL:'https://api.github.com',GITHUB_REPOSITORY_ID:'12',GITHUB_EVENT_NAME:'push',GITHUB_REF_NAME:branch,
    GITHUB_REF:f.context.ref,GITHUB_RUN_ID:'38998636876',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_NUMBER:'2',GITHUB_SHA:f.context.sha,
    GITHUB_WORKFLOW_REF:f.context.workflowRef,GITHUB_WORKFLOW_SHA:f.context.sha};
  assert.deepEqual(checkedRuntime(env,'22.0.0'),f.context);
  for(const changes of [{RUNNER_ENVIRONMENT:'self-hosted'},{RUNNER_OS:'Windows'},{GITHUB_ACTIONS:'false'},{GH_HOST:'private.invalid'},
    {GITHUB_SERVER_URL:'https://private.invalid'},{GITHUB_API_URL:'https://private.invalid'}])assert.throws(()=>checkedRuntime({...env,...changes},'22.0.0'));
  assert.throws(()=>checkedRuntime(env,'24.0.0'));
});
test('CLI rejects nonrunner execution with one sanitized line and empty stderr',()=>{
  const script=join(root,'.github/scripts/run-reviewed-job-log-diagnostic.mjs');
  const child=spawnSync(process.execPath,[script],{env:{},encoding:'utf8',timeout:10000});
  assert.equal(child.status,1);assert.equal(child.stderr,'');const result=JSON.parse(child.stdout);
  assert.equal(result.diagnostic.stage,'controller-runtime');assert.ok(Buffer.byteLength(child.stdout)<1024);
});
test('workflow is a separate request-only trigger with read-only permissions and shared serial group',()=>{
  const workflow=readFileSync(join(root,workflowPath),'utf8');
  assert.match(workflow,/paths: \[\.github\/targeted-financial-recovery\/log-diagnostic\.json\]/);
  assert.match(workflow,/contents: read\n  actions: read/);assert.match(workflow,/group: financial-statement-recovery\n  cancel-in-progress: false/);
  assert.match(workflow,/timeout-minutes: 3/);assert.match(workflow,/node-version: '22'/);assert.match(workflow,/fetch-depth: 3/);assert.match(workflow,/persist-credentials: false/);
  assert.doesNotMatch(workflow,/workflow_dispatch:|schedule:|contents: write|actions: write|pip install|npm install|upload-artifact|run-statement-targeted-recovery/);
  const source=readFileSync(join(root,'.github/scripts/run-reviewed-job-log-diagnostic.mjs'),'utf8');
  const localImports=[...source.matchAll(/from '(\.\/.+)'/g)].map(m=>m[1]);assert.deepEqual(localImports,['./download-reviewed-job-log.mjs']);
  assert.doesNotMatch(source,/from .*publication|from .*restore-statement|from .*financial|httpsRequest|fetch\(/);
});

test('run2 cannot reuse spent first operation or old schema',()=>{
  for(const mutate of [r=>r.operation_id=prior.operation_id,r=>r.schema_version='reviewed-job-log-diagnostic-request-v1',r=>r.expected_run_number=1]){
    const f=fixture();mutate(f.request);stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
  }
});
for(const revision of ['compatibility','new-controller'])test(`spent request cannot change in ${revision}`,()=>{
  const f=fixture(),original=f.io.gitFile,rev=revision==='compatibility'?base.sha:f.request.controller.parent_sha;
  f.io.gitFile=object=>object===`${rev}:${requestPath}`?Buffer.from('{}'):original(object);
  stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
});
for(const endpoint of ['latest','attempt','inventory'])for(const [key,value] of Object.entries({id:123,run_attempt:2,run_number:2,head_sha:'f'.repeat(40),head_branch:'main',path:'.github/workflows/financial-statement-recovery.yml',event:'workflow_dispatch',status:'in_progress',conclusion:'success',workflow_id:prior.workflow_id+1,created_at:'2030-01-01T00:00:00Z',run_started_at:'2030-01-01T00:00:00Z',updated_at:'2030-01-01T00:00:00Z'}))test(`prior ${endpoint} rejects changed ${key}`,()=>{
  const f=fixture();let previous;
  if(endpoint==='inventory')previous=f.responses.get(`repos/${repository}/actions/workflows/${prior.workflow_id}/runs?per_page=100`).workflow_runs[1];
  else previous=f.responses.get(`repos/${repository}/actions/runs/${prior.run_id}${endpoint==='attempt'?'/attempts/1':''}`);
  previous[key]=value;stoppedBeforeHelper(f);
});
for(const [label,mutate] of [
  ['extra prior job',j=>{j.total_count=2;j.jobs.push(copy(j.jobs[0]));}],['partial prior jobs',j=>j.total_count=2],
  ['foreign prior job',j=>j.jobs[0].id++],['prior job rerun',j=>j.jobs[0].run_attempt++],['prior job still running',j=>j.jobs[0].status='in_progress'],
  ['wrong prior head',j=>j.jobs[0].head_sha='f'.repeat(40)],['wrong prior completed time',j=>j.jobs[0].completed_at='2030-01-01T00:00:00Z'],
  ['missing prior step',j=>j.jobs[0].steps.pop()],['extra prior step',j=>j.jobs[0].steps.push(copy(j.jobs[0].steps[0]))],
  ['changed prior step outcome',j=>j.jobs[0].steps[4].conclusion='success'],['changed prior step time',j=>j.jobs[0].steps[4].completed_at='2030-01-01T00:00:00Z'],
  ['unreviewed prior step field',j=>j.jobs[0].steps[4].extra='value'],
])test(`predecessor job rejects ${label}`,()=>{const f=fixture();mutate(f.responses.get(`repos/${repository}/actions/runs/${prior.run_id}/attempts/1/jobs?per_page=100`));stoppedBeforeHelper(f);});
for(const revision of ['compatibility','prior'])for(const [label,mutate] of [
  ['wrong SHA',c=>c.sha='f'.repeat(40)],['wrong tree',c=>c.tree.sha='f'.repeat(40)],['wrong parent',c=>c.parents[0].sha='f'.repeat(40)],
  ['extra parent',c=>c.parents.push({sha:'f'.repeat(40)})],['missing parent',c=>c.parents=[]],
])test(`${revision} commit rejects ${label}`,()=>{const f=fixture();mutate(f.responses.get(`repos/${repository}/git/commits/${revision==='compatibility'?base.sha:prior.sha}`));stoppedBeforeHelper(f);});
for(const edge of ['compatibility','prior-activation'])for(const [label,mutate] of [
  ['wrong status',c=>c.status='identical'],['wrong ahead count',c=>c.ahead_by=2],['behind history',c=>c.behind_by=1],
  ['partial commits',c=>c.total_commits=2],['missing commits',c=>c.commits=[]],['extra commit',c=>c.commits.push(copy(c.commits[0]))],
  ['wrong base',c=>c.base_commit.sha='f'.repeat(40)],['wrong base tree',c=>c.base_commit.commit.tree.sha='f'.repeat(40)],['wrong merge base',c=>c.merge_base_commit.sha='f'.repeat(40)],
  ['wrong head',c=>c.commits[0].sha='f'.repeat(40)],['wrong head tree',c=>c.commits[0].commit.tree.sha='f'.repeat(40)],
  ['wrong parent',c=>c.commits[0].parents[0].sha='f'.repeat(40)],['extra parent',c=>c.commits[0].parents.push({sha:'f'.repeat(40)})],
  ['missing files',c=>c.files=[]],['extra files',c=>c.files.push({filename:'provider.py',status:'modified'})],
  ['renamed file',c=>{c.files[0].status='renamed';c.files[0].previous_filename='other';}],
  ['unexpected previous filename',c=>c.files[0].previous_filename=c.files[0].filename],['wrong path',c=>c.files[0].filename=financialRequestPath],
])test(`${edge} compare rejects ${label}`,()=>{
  const f=fixture(),pair=edge==='compatibility'?`${prior.sha}...${base.sha}`:`${prior.controller_sha}...${prior.sha}`;
  mutate(f.responses.get(`repos/${repository}/compare/${pair}?per_page=100`));stoppedBeforeHelper(f);
});
test('prior failed timestamp cannot be retimed into a later new request',()=>{
  const f=fixture();f.request.created_at=prior.updated_at;f.request.expires_at='2026-10-17T03:54:23Z';
  stoppedBeforeHelper(f,{now:()=>Date.parse('2026-10-17T03:25:00Z')});
});
test('two-entry inventory may arrive in either order',()=>{
  const f=fixture();f.responses.get(`repos/${repository}/actions/workflows/${prior.workflow_id}/runs?per_page=100`).workflow_runs.reverse();
  assert.equal(authenticate(f.request,f.context,f.event,f.api,now).run_number,2);
});

test('run2 rejects reused run1 UUID under the new operation prefix',()=>{
  const f=fixture();f.request.operation_id=prior.operation_id.replace('log-diagnostic-','log-diagnostic2-');
  stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
});
