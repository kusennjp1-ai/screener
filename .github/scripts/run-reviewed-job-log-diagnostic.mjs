// Independent, one-shot log diagnostic. No financial acquisition imports or calls.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readReviewedJobLog,reviewedJobLogDiagnostic} from './download-reviewed-job-log.mjs';

export const repository='kusennjp1-ai/screener';
export const branch='improve/reviewed-job-log-diagnostic-20261017';
export const workflowFile='reviewed-job-log-diagnostic.yml';
export const workflowPath=`.github/workflows/${workflowFile}`;
export const requestPath='.github/targeted-financial-recovery/log-diagnostic.json';
export const financialRequestPath='.github/targeted-financial-recovery/request.json';
export const base=Object.freeze({sha:'b6378b8077b51f18d63e6dbb4d221ac47144bee4',tree:'da1782f4170829dc87f37aab139dc98223988711'});
export const financialRequestHash='846a0d2a07e2a43b6eee3837f19dfb01e233866a8b3e1912a57d025d3a043e00';
export const target=Object.freeze({repository,run_id:38993132263,run_number:6,run_attempt:1,
  head_sha:'12b4e4dba9c847d754b7ec3b47b234984386a1f4',job_id:117279659374,
  bytes:59325,sha256:'47dabe41056aeb89eb17d2408bb120c10998868eaf4ccfb17597026b6ccfc462'});
export const controllerChanges=Object.freeze([
  'M\t.github/scripts/download-reviewed-job-log.mjs',
  'M\t.github/scripts/download-reviewed-job-log.test.mjs',
  'A\t.github/scripts/run-reviewed-job-log-diagnostic.mjs',
  'A\t.github/scripts/run-reviewed-job-log-diagnostic.test.mjs',
  `A\t${workflowPath}`,
].sort());
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const fixedFailures=new WeakMap();
function fail(stage){const error=Error('Diagnostic stopped');fixedFailures.set(error,Object.freeze({stage,cause:'rejected',host:'none',status:0}));throw error;}
function exact(value,keys,stage='controller-input'){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail(stage);
}
function sameFields(actual,expected){return Object.keys(expected).every(key=>actual?.[key]===expected[key]);}
function git(args,cwd){return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:8000,maxBuffer:1024*1024}).trim();}
function gitFile(object,cwd){return execFileSync('git',['show',object],{cwd,stdio:['ignore','pipe','pipe'],timeout:8000,maxBuffer:16384});}
export function boundedFile(path,maximum=16384){
  for(let p=resolve(path);;p=dirname(p)){if(lstatSync(p).isSymbolicLink())fail('controller-input');if(p===dirname(p))break;}
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.nlink!==1||stat.size<=0||stat.size>maximum)fail('controller-input');
  const bytes=readFileSync(path);
  if(bytes.length!==stat.size)fail('controller-input');
  return bytes;
}
export function validateRequest(value,now=Date.now()){
  exact(value,['schema_version','operation_id','created_at','expires_at','controller','expected_run_number','expected_run_attempt','target','limits']);
  if(value.schema_version!=='reviewed-job-log-diagnostic-request-v1'
    ||typeof value.operation_id!=='string'||!/^log-diagnostic-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.operation_id)
    ||value.expected_run_number!==1||value.expected_run_attempt!==1)fail('controller-input');
  const utc=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value.replace('Z','.000Z');
  if(!utc(value.created_at)||!utc(value.expires_at))fail('controller-input');
  const start=Date.parse(value.created_at),end=Date.parse(value.expires_at);
  if(!Number.isFinite(now)||start>now||now>=end||end<=start||end-start>30*60*1000)fail('controller-input');
  exact(value.controller,['parent_sha','parent_tree']);
  if(!sha(value.controller.parent_sha)||!sha(value.controller.parent_tree)||value.controller.parent_sha===base.sha)fail('controller-input');
  exact(value.target,Object.keys(target));
  if(!sameFields(value.target,target))fail('controller-input');
  const limits={helper_calls:1,caller_retries:0,provider_getter_calls:0,timeout_seconds:30,max_bytes:1048576};
  exact(value.limits,Object.keys(limits));
  if(!sameFields(value.limits,limits))fail('controller-input');
  return value;
}
export function validateContext(context){
  if(context.repository!==repository||context.event!=='push'||context.branch!==branch||context.ref!==`refs/heads/${branch}`
    ||context.attempt!==1||context.runNumber!==1||!positive(context.id)||!positive(context.repositoryId)||!sha(context.sha)
    ||context.workflowRef!==`${repository}/${workflowPath}@refs/heads/${branch}`||context.workflowSha!==context.sha)fail('controller-activation');
  return context;
}
export function verifyActivation(request,context,cwd=root,io={git,gitFile,readFile:boundedFile}){
  validateContext(context);
  const read=args=>io.git(args,cwd);
  const parent=request.controller.parent_sha;
  if(read(['rev-parse','HEAD'])!==context.sha||read(['status','--porcelain','--untracked-files=all'])!=='')fail('controller-activation');
  if(read(['rev-list','--parents','-n','1','HEAD'])!==`${context.sha} ${parent}`
    ||read(['rev-parse',`${parent}^{tree}`])!==request.controller.parent_tree
    ||read(['rev-list','--parents','-n','1',parent])!==`${parent} ${base.sha}`
    ||read(['rev-parse',`${base.sha}^{tree}`])!==base.tree)fail('controller-activation');
  if(read(['diff','--name-status','--no-renames',parent,context.sha])!==`A\t${requestPath}`
    ||read(['diff','--name-status','--no-renames',base.sha,parent]).split('\n').sort().join('\n')!==controllerChanges.join('\n'))fail('controller-activation');
  const bytes=io.readFile(join(cwd,requestPath));
  if(!Buffer.isBuffer(bytes)||JSON.stringify(JSON.parse(bytes))!==JSON.stringify(request)
    ||hash(io.gitFile(`${context.sha}:${requestPath}`,cwd))!==hash(bytes))fail('controller-activation');
  for(const revision of [base.sha,parent,context.sha]){
    if(hash(io.gitFile(`${revision}:${financialRequestPath}`,cwd))!==financialRequestHash)fail('controller-activation');
  }
  if(hash(io.readFile(join(cwd,financialRequestPath)))!==financialRequestHash)fail('controller-activation');
  return bytes;
}
// Only fixed read-only GitHub metadata endpoints are admitted. No log/asset API
// requests, pagination, installations or configuration changes occur here.
function endpoints(context){return [
  `repos/${repository}`,
  `repos/${repository}/actions/runs/${context.id}`,
  `repos/${repository}/actions/runs/${context.id}/attempts/1`,
  `repos/${repository}/actions/jobs/${target.job_id}`,
  `repos/${repository}/git/ref/heads/${branch}`,
];}
export function metadataApi(context,execute=execFileSync){
  const allowed=new Set(endpoints(validateContext(context))),used=new Set();
  const workflowPrefix=`repos/${repository}/actions/workflows/`;
  let selectedWorkflow;
  return endpoint=>{
    let dynamic=false;
    if(typeof endpoint==='string'&&endpoint.startsWith(workflowPrefix)){
      const match=/^([1-9][0-9]*)(?:\/runs\?per_page=100)?$/.exec(endpoint.slice(workflowPrefix.length));
      if(match&&positive(Number(match[1]))){
        if(selectedWorkflow===undefined)selectedWorkflow=Number(match[1]);
        dynamic=Number(match[1])===selectedWorkflow;
      }
    }
    if((!allowed.has(endpoint)&&!dynamic)||used.has(endpoint)||used.size>=7)fail('controller-authentication');
    used.add(endpoint);
    const bytes=execute('gh',['api','--method','GET','--hostname','github.com',endpoint],{
      encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:8000,maxBuffer:1024*1024,
    });
    return JSON.parse(bytes);
  };
}
function checkedRun(run,context,workflowId,createdAt){
  if(!sameFields(run,{id:context.id,run_attempt:1,run_number:1,head_sha:context.sha,head_branch:branch,
    path:workflowPath,event:'push',status:'in_progress',workflow_id:workflowId,conclusion:null})
    ||!sameFields(run.repository,{id:context.repositoryId,full_name:repository})
    ||!sameFields(run.head_repository,{id:context.repositoryId,full_name:repository})
    ||!Number.isFinite(Date.parse(run.created_at))||Date.parse(run.created_at)<createdAt
    ||!Number.isFinite(Date.parse(run.run_started_at))||Date.parse(run.run_started_at)<Date.parse(run.created_at))fail('controller-authentication');
  return run;
}
export function authenticate(request,context,event,api,now=Date.now()){
  validateRequest(request,now);validateContext(context);
  if(!sameFields(event,{ref:context.ref,before:request.controller.parent_sha,after:context.sha,created:false,deleted:false,forced:false})
    ||!sameFields(event.repository,{id:context.repositoryId,full_name:repository})
    ||event.head_commit?.id!==context.sha||!Array.isArray(event.commits)||event.commits.length!==1||event.commits[0]?.id!==context.sha)fail('controller-authentication');
  const paths=endpoints(context),repo=api(paths[0]);
  if(!sameFields(repo,{id:context.repositoryId,full_name:repository}))fail('controller-authentication');
  const created=Date.parse(request.created_at);
  const observed=api(paths[1]);
  if(!positive(observed?.workflow_id))fail('controller-authentication');
  const current=checkedRun(observed,context,observed.workflow_id,created);
  const attempt=checkedRun(api(paths[2]),context,current.workflow_id,created);
  const workflow=api(`repos/${repository}/actions/workflows/${current.workflow_id}`);
  if(!sameFields(workflow,{id:current.workflow_id,path:workflowPath,state:'active'}))fail('controller-authentication');
  if(current.created_at!==attempt.created_at||current.run_started_at!==attempt.run_started_at
    ||Date.parse(current.run_started_at)>now||Date.parse(current.created_at)>now)fail('controller-authentication');
  const inventory=api(`repos/${repository}/actions/workflows/${current.workflow_id}/runs?per_page=100`);
  // Unfiltered inventory, not only matching pushes: this new workflow has one
  // complete unique run. Any extra run, retry or incomplete inventory fails.
  if(inventory.total_count!==1||!Array.isArray(inventory.workflow_runs)||inventory.workflow_runs.length!==1)fail('controller-authentication');
  const listed=checkedRun(inventory.workflow_runs[0],context,workflow.id,created);
  if(listed.created_at!==current.created_at||listed.run_started_at!==current.run_started_at)fail('controller-authentication');
  const job=api(paths[3]);
  if(!sameFields(job,{id:target.job_id,run_id:target.run_id,run_attempt:target.run_attempt,head_sha:target.head_sha,
    status:'completed',conclusion:'failure'}))fail('controller-authentication');
  const ref=api(paths[4]);
  if(ref.ref!==context.ref||ref.object?.type!=='commit'||ref.object?.sha!==context.sha)fail('controller-authentication');
  return current;
}
export function checkedRuntime(env=process.env,nodeVersion=process.versions.node){
  if(!/^22\./.test(nodeVersion)||env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted'
    ||env.RUNNER_OS!=='Linux'||env.GITHUB_REPOSITORY!==repository
    ||env.GITHUB_SERVER_URL!=='https://github.com'||env.GITHUB_API_URL!=='https://api.github.com'
    ||(env.GH_HOST!==undefined&&env.GH_HOST!==''&&env.GH_HOST!=='github.com'))fail('controller-runtime');
  return {repository:env.GITHUB_REPOSITORY,repositoryId:Number(env.GITHUB_REPOSITORY_ID),event:env.GITHUB_EVENT_NAME,
    branch:env.GITHUB_REF_NAME,ref:env.GITHUB_REF,id:Number(env.GITHUB_RUN_ID),attempt:Number(env.GITHUB_RUN_ATTEMPT),
    runNumber:Number(env.GITHUB_RUN_NUMBER),sha:env.GITHUB_SHA,workflowRef:env.GITHUB_WORKFLOW_REF,workflowSha:env.GITHUB_WORKFLOW_SHA};
}
export function verifiedResult(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length!==target.bytes||hash(bytes)!==target.sha256)fail('controller-integrity');
  return Object.freeze({schema_version:'reviewed-job-log-diagnostic-result-v1',outcome:'verified',target:{...target}});
}
export function failureResult(error){
  const diagnostic=reviewedJobLogDiagnostic(error)??fixedFailures.get(error)??{stage:'unknown',cause:'rejected',host:'none',status:0};
  return Object.freeze({schema_version:'reviewed-job-log-diagnostic-result-v1',outcome:'failed',diagnostic:{...diagnostic}});
}
export function renderResult(result){
  // Result construction is internal. Recheck the closed output schema anyway;
  // no arbitrary errors, bodies or response properties may reach stdout.
  exact(result,['schema_version','outcome',result.outcome==='verified'?'target':'diagnostic'],'controller-integrity');
  if(result.schema_version!=='reviewed-job-log-diagnostic-result-v1')fail('controller-integrity');
  if(result.outcome==='verified'){
    exact(result.target,Object.keys(target),'controller-integrity');
    if(!sameFields(result.target,target))fail('controller-integrity');
  }else if(result.outcome==='failed'){
    const diagnostic=result.diagnostic;
    exact(diagnostic,['stage','cause','host','status'],'controller-integrity');
    const stages=['unknown','input','environment','file','api-request','api-response','redirect','storage-request','storage-response','storage-headers','body','worker','result','cleanup',
      'controller-input','controller-activation','controller-authentication','controller-runtime','controller-integrity'];
    const causes=['rejected','invalid-input','environment-rejected','routing-or-trust-override','tls-override','unsafe-file','request-error','dns-error','tls-error','http-status','invalid-status','invalid-headers','unapproved-location','invalid-body','write-failed','incomplete-body','timeout','worker-failed','worker-start-failed','invalid-diagnostic','cleanup-failed'];
    if(!stages.includes(diagnostic.stage)||!causes.includes(diagnostic.cause)
      ||!['none','github-api','reviewed-storage','rejected-redirect'].includes(diagnostic.host)
      ||!Number.isInteger(diagnostic.status)||(diagnostic.status!==0&&(diagnostic.status<100||diagnostic.status>599)))fail('controller-integrity');
  }else fail('controller-integrity');
  const line=JSON.stringify(result)+'\n';
  if(Buffer.byteLength(line)>1024)fail('controller-integrity');
  return line;
}
export function runDiagnostic({context,event,cwd=root,now=Date.now,api,readLog=readReviewedJobLog,io={git,gitFile,readFile:boundedFile}}){
  try{
    const request=validateRequest(JSON.parse(io.readFile(join(cwd,requestPath))),now());
    verifyActivation(request,context,cwd,io);
    authenticate(request,context,event,api??metadataApi(context),now());
    // Metadata calls cannot retime or extend the finite request.
    const beforeRead=now();
    validateRequest(request,beforeRead);
    if(Date.parse(request.expires_at)-beforeRead<30000)fail('controller-input');
    // Exactly one bounded helper invocation, no retry/fallback or provider work.
    return verifiedResult(readLog(target.job_id));
  }catch(error){return failureResult(error);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let result;
  try{
    if(process.argv.length!==2)fail('controller-input');
    const context=validateContext(checkedRuntime());
    const event=JSON.parse(boundedFile(process.env.GITHUB_EVENT_PATH,1024*1024));
    result=runDiagnostic({context,event});
  }catch(error){result=failureResult(error);}
  process.stdout.write(renderResult(result));
  if(result.outcome!=='verified')process.exitCode=1;
}
