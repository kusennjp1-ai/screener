import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {readReviewedJobLog} from './download-reviewed-job-log.mjs';
import {repository,branch,workflowPath,requestPath,financialRequestPath,financialRequestHash,base,target,controllerChanges,
  validateRequest,validateContext,verifyActivation,metadataApi,authenticate,checkedRuntime,verifiedResult,failureResult,renderResult,runDiagnostic} from './run-reviewed-job-log-diagnostic.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
// The actual immutable financial request already exists in every deployed
// checkout. Local review may explicitly supply that same byte-for-byte fixture.
const financial=readFileSync(process.env.REVIEWED_DIAGNOSTIC_FINANCIAL_FIXTURE??join(root,financialRequestPath));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>structuredClone(value);
const now=Date.parse('2000-01-01T00:01:00Z');
function fixture(){
  const request={schema_version:'reviewed-job-log-diagnostic-request-v1',operation_id:'log-diagnostic-11111111-1111-4111-8111-111111111111',
    created_at:'2000-01-01T00:00:00Z',expires_at:'2000-01-01T00:30:00Z',
    controller:{parent_sha:'c'.repeat(40),parent_tree:'d'.repeat(40)},expected_run_number:1,expected_run_attempt:1,
    target:{...target},limits:{helper_calls:1,caller_retries:0,provider_getter_calls:0,timeout_seconds:30,max_bytes:1048576}};
  const context={repository,repositoryId:12,event:'push',branch,ref:`refs/heads/${branch}`,id:987,attempt:1,runNumber:1,sha:'e'.repeat(40),
    workflowRef:`${repository}/${workflowPath}@refs/heads/${branch}`,workflowSha:'e'.repeat(40)};
  const event={ref:context.ref,before:request.controller.parent_sha,after:context.sha,created:false,deleted:false,forced:false,
    repository:{id:12,full_name:repository},head_commit:{id:context.sha},commits:[{id:context.sha}]};
  const run={id:987,run_attempt:1,run_number:1,head_sha:context.sha,head_branch:branch,path:workflowPath,event:'push',status:'in_progress',conclusion:null,
    workflow_id:56,repository:{id:12,full_name:repository},head_repository:{id:12,full_name:repository},
    created_at:'2000-01-01T00:00:01Z',run_started_at:'2000-01-01T00:00:02Z'};
  const responses=new Map([
    [`repos/${repository}`,{id:12,full_name:repository}],
    [`repos/${repository}/actions/runs/987`,copy(run)],
    [`repos/${repository}/actions/runs/987/attempts/1`,copy(run)],
    [`repos/${repository}/actions/workflows/56`,{id:56,path:workflowPath,state:'active'}],
    [`repos/${repository}/actions/workflows/56/runs?per_page=100`,{total_count:1,workflow_runs:[copy(run)]}],
    [`repos/${repository}/actions/jobs/${target.job_id}`,{id:target.job_id,run_id:target.run_id,run_attempt:1,head_sha:target.head_sha,status:'completed',conclusion:'failure'}],
    [`repos/${repository}/git/ref/heads/${branch}`,{ref:context.ref,object:{type:'commit',sha:context.sha}}],
  ]);
  const commands=new Map([
    ['rev-parse HEAD',context.sha],['status --porcelain --untracked-files=all',''],
    ['rev-list --parents -n 1 HEAD',`${context.sha} ${request.controller.parent_sha}`],
    [`rev-parse ${request.controller.parent_sha}^{tree}`,request.controller.parent_tree],
    [`rev-list --parents -n 1 ${request.controller.parent_sha}`,`${request.controller.parent_sha} ${base.sha}`],
    [`rev-parse ${base.sha}^{tree}`,base.tree],
    [`diff --name-status --no-renames ${request.controller.parent_sha} ${context.sha}`,`A\t${requestPath}`],
    [`diff --name-status --no-renames ${base.sha} ${request.controller.parent_sha}`,controllerChanges.join('\n')],
  ]);
  const requestBytes=()=>Buffer.from(JSON.stringify(request));
  const io={git:args=>{const key=args.join(' ');assert.ok(commands.has(key));return commands.get(key);},
    gitFile:object=>object.endsWith(`:${requestPath}`)?requestBytes():financial,
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
  ['extra target data',r=>r.target.url='https://secret.invalid'],['rerun number',r=>r.expected_run_number=2],
  ['rerun attempt',r=>r.expected_run_attempt=2],['more helper calls',r=>r.limits.helper_calls=2],
  ['caller retry',r=>r.limits.caller_retries=1],['provider authority',r=>r.limits.provider_getter_calls=1],
  ['oversized transport',r=>r.limits.max_bytes++],['extended timeout',r=>r.limits.timeout_seconds++],
  ['future intent',r=>r.created_at='2000-01-01T00:02:00Z'],['expired intent',r=>r.expires_at='2000-01-01T00:01:00Z'],
  ['more than30minutes',r=>r.expires_at='2000-01-01T00:30:01Z'],['empty interval',r=>r.expires_at=r.created_at],
  ['invalid date',r=>r.created_at='2000-13-01T00:00:00Z'],['nonUTC date',r=>r.created_at='2000-01-01T00:00:00+00:00'],
  ['controller is consumed base',r=>r.controller.parent_sha=base.sha],['unbound controller',r=>r.controller.parent_tree='bad'],
])test(`request rejects ${label} without metadata or helper`,()=>{
  const f=fixture();mutate(f.request);stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
});

test('clean local activation authenticates only exact C then A and preserved financial bytes',()=>{
  const f=fixture();assert.deepEqual(verifyActivation(f.request,f.context,root,f.io),Buffer.from(JSON.stringify(f.request)));
});
for(const [label,key,value] of [
  ['dirty checkout','status --porcelain --untracked-files=all','?? secret'],
  ['wrong checkout','rev-parse HEAD','f'.repeat(40)],
  ['two activation parents','rev-list --parents -n 1 HEAD',`${'e'.repeat(40)} ${'c'.repeat(40)} ${'a'.repeat(40)}`],
  ['wrong controller tree',`rev-parse ${'c'.repeat(40)}^{tree}`,'f'.repeat(40)],
  ['wrong base parent',`rev-list --parents -n 1 ${'c'.repeat(40)}`,`${'c'.repeat(40)} ${'a'.repeat(40)}`],
  ['wrong actual base tree',`rev-parse ${base.sha}^{tree}`,'f'.repeat(40)],
  ['replacement rather than new request',`diff --name-status --no-renames ${'c'.repeat(40)} ${'e'.repeat(40)}`,`M\t${requestPath}`],
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

for(const [key,value] of Object.entries({repository:'other/repo',repositoryId:0,event:'workflow_dispatch',branch:'main',ref:'refs/tags/x',attempt:2,runNumber:2,id:0,sha:'bad',workflowRef:'other',workflowSha:'f'.repeat(40)}))test(`context rejects changed ${key}`,()=>{
  const f=fixture();f.context[key]=value;assert.throws(()=>validateContext(f.context));stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
});
test('authentic push and complete sole diagnostic run inventory are required',()=>{
  const f=fixture();assert.equal(authenticate(f.request,f.context,f.event,f.api,now).id,f.context.id);assert.equal(f.calls.length,7);
  assert.ok(f.calls.includes(`repos/${repository}/actions/workflows/56/runs?per_page=100`));
});
for(const [key,value] of Object.entries({forced:true,deleted:true,created:true,before:'f'.repeat(40),after:'f'.repeat(40),ref:'refs/heads/main'}))test(`push event rejects ${key}`,()=>{
  const f=fixture();f.event[key]=value;stoppedBeforeHelper(f);assert.equal(f.calls.length,0);
});
for(const [label,mutate] of [
  ['two commits',e=>e.commits.push({id:'f'.repeat(40)})],['missing head identity',e=>delete e.head_commit],
  ['wrong repository id',e=>e.repository.id++],['foreign repository',e=>e.repository.full_name='other/repo'],
])test(`push event rejects ${label}`,()=>{const f=fixture();mutate(f.event);stoppedBeforeHelper(f);assert.equal(f.calls.length,0);});
for(const endpoint of ['current','attempt','inventory'])for(const [key,value] of Object.entries({id:123,run_attempt:2,run_number:2,head_sha:'f'.repeat(40),head_branch:'main',path:'.github/workflows/financial-statement-recovery.yml',event:'workflow_dispatch',status:'completed',workflow_id:57,conclusion:'success',created_at:'1999-01-01T00:00:00Z',run_started_at:'1999-01-01T00:00:00Z'}))test(`${endpoint} run rejects changed ${key}`,()=>{
  const f=fixture();const run=endpoint==='current'?f.responses.get(`repos/${repository}/actions/runs/987`):endpoint==='attempt'?f.responses.get(`repos/${repository}/actions/runs/987/attempts/1`):f.responses.get(`repos/${repository}/actions/workflows/56/runs?per_page=100`).workflow_runs[0];
  run[key]=value;stoppedBeforeHelper(f);
});
for(const [label,mutate] of [
  ['more than one run',i=>{i.total_count=2;i.workflow_runs.push(copy(i.workflow_runs[0]));}],
  ['partial inventory',i=>i.total_count=2],['empty inventory',i=>{i.total_count=0;i.workflow_runs=[];}],
  ['count type coercion',i=>i.total_count='1'],['same count but duplicate run',i=>i.workflow_runs.push(copy(i.workflow_runs[0]))],
])test(`inventory rejects ${label}`,()=>{
  const f=fixture();mutate(f.responses.get(`repos/${repository}/actions/workflows/56/runs?per_page=100`));stoppedBeforeHelper(f);
});
for(const [label,endpoint,mutate] of [
  ['changed branch head',`git/ref/heads/${branch}`,r=>r.object.sha='f'.repeat(40)],
  ['noncommit branch',`git/ref/heads/${branch}`,r=>r.object.type='tag'],
  ['foreign repo','',r=>r.full_name='other/repo'],['disabled workflow','actions/workflows/56',r=>r.state='disabled_manually'],
  ['wrong workflow path','actions/workflows/56',r=>r.path='.github/workflows/financial-statement-recovery.yml'],
  ['wrong target job run',`actions/jobs/${target.job_id}`,r=>r.run_id++],
  ['wrong target job attempt',`actions/jobs/${target.job_id}`,r=>r.run_attempt++],
  ['nonterminal target job',`actions/jobs/${target.job_id}`,r=>r.status='in_progress'],
])test(`remote metadata rejects ${label}`,()=>{const f=fixture();mutate(f.responses.get(`repos/${repository}${endpoint?'/'+endpoint:''}`));stoppedBeforeHelper(f);});
test('expiry after metadata reads prevents log read',()=>{const f=fixture();let n=0;stoppedBeforeHelper(f,{now:()=>++n<3?now:Date.parse(f.request.expires_at)});});
test('less than the full30second allowance prevents log read',()=>{const f=fixture();let n=0;stoppedBeforeHelper(f,{now:()=>++n<3?now:Date.parse(f.request.expires_at)-29999});});

test('metadata API executes only bounded read-only gh commands, once per fixed endpoint',()=>{
  const f=fixture(),calls=[];const api=metadataApi(f.context,(program,args,options)=>{calls.push({program,args,options});return '{}';});
  api(`repos/${repository}`);assert.throws(()=>api(`repos/${repository}`));
  api(`repos/${repository}/actions/workflows/56`);api(`repos/${repository}/actions/workflows/56/runs?per_page=100`);
  for(const endpoint of [`repos/${repository}/actions/workflows/57`,`repos/${repository}/actions/jobs/${target.job_id}/logs`,
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
    GITHUB_REF:f.context.ref,GITHUB_RUN_ID:'987',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_NUMBER:'1',GITHUB_SHA:f.context.sha,
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
