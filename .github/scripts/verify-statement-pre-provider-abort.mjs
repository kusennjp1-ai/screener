// Two closed reviewed terminal-abort proofs, not a search/fallback/retry mechanism.
// The immutable run5 head binds the reviewed caller (sha256 7209f92cc72de912b29789ebccbb41450e2e9bf74f559a93984e5a16b2488374)
// and workflow (sha256 53005ef466d31fb2ba362cc4a4d0c49cdbcc29bbde3f889730e6c1e6b52bc207).
// That caller's line159 awaits livePublication before its only provider-child
// spawn. The full exact authenticated job log proves this call threw. Neither
// an absent artifact nor an arbitrary failure/log substring establishes that.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {repository,recoveryWorkflow,previousRecoveryRun} from './restore-statement-source.mjs';
import {readReviewedJobLog} from './download-reviewed-job-log.mjs';

export const replacementSchema='financial-targeted-recovery-execution-v2';
export const chainedReplacementSchema='financial-targeted-recovery-execution-v3';
export const isReplacementRequest=request=>[replacementSchema,chainedReplacementSchema].includes(request?.schema_version);
export const spentRequestPath='.github/targeted-financial-recovery/request.json';
export const abortBranch='improve/mandatory-financial-source-recovery';
export const reviewedAbort=Object.freeze({schema_version:'financial-pre-provider-abort-v1',
  run_id:38991458566,run_attempt:1,run_number:5,head_sha:'afba716470995a59c41043f982e1c09f987b1c53',
  request_sha256:'7f0bd22ed8fcedb703c9c851b0891512d52dd8c7b781bb2ab8a85c3b6fd06c1d',
  job_id:117274547210,job_log_sha256:'acf29622ccbd3933c1e220ca8f41b1c77beae3320a4f63bdb580a07078066f87'});
// The immutable run6 caller (sha256 98f38d763ba18a3cdd937dc23a58f553f5466fdc33c43503fae65997045373c5)
// calls authenticateRecovery at line154 before mkdir at line158 and any provider
// child. Its exact complete log binds the readAbortJobLog failure at that call.
export const reviewedAbort6=Object.freeze({schema_version:'financial-pre-provider-abort-v1',
  run_id:38993132263,run_attempt:1,run_number:6,head_sha:'12b4e4dba9c847d754b7ec3b47b234984386a1f4',
  request_sha256:'cf059634ca8e29f3bf4a8ab70ec14a6e9cf76ee76ad3948d0ac619a30def13ca',
  job_id:117279659374,job_log_sha256:'47dabe41056aeb89eb17d2408bb120c10998868eaf4ccfb17597026b6ccfc462'});
export const reviewedSource=Object.freeze({run_id:37478731832,run_attempt:1,
  head_sha:'4715b218cc25720d1d3be455930554e1e6282136',artifact_id:11420873789,
  artifact_sha256:'266b2118cefe4a51dcf0981b4e60c35ba76524e1f35cf9633f8c26691f68d2bd',
  archive_manifest_sha256:'2593d2c737724da007a72091b7b85d6007530e0fb6fc7e4e0765d75692b007d0',
  base_sha256:'2524eeac36bcb79d3ebe75f7f57d5672e91e1dafcd80a23d180ae39de867b932',
  cohort_sha256:'36a83c34c33b0158f1d246226d8d538797c6c6e6494669c6feacefa82da12580'});
const abort5Proof=Object.freeze({identity:reviewedAbort,completedAt:'2026-10-17T01:37:34Z',
  startedAt:'2026-10-17T01:34:45Z',runStartedAt:'2026-10-17T01:34:42Z',logLength:51171,
  schema:'financial-targeted-recovery-execution-v1',operation:'targeted-nvda-aaoi-20261017t013151z'});
const abort6Proof=Object.freeze({identity:reviewedAbort6,completedAt:'2026-10-17T02:01:05Z',
  startedAt:'2026-10-17T01:59:35Z',runStartedAt:'2026-10-17T01:59:32Z',logLength:59325,
  schema:replacementSchema,operation:'targeted-nvda-aaoi-20261017t015500z'});
const workflowId=374552819,repositoryId=1203919607;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const positive=value=>Number.isSafeInteger(value)&&value>0;
const same=isDeepStrictEqual;
const finiteDate=value=>typeof value==='string'&&value.endsWith('Z')&&Number.isFinite(Date.parse(value));

export function validateAbortContinuity(request){
  const chained=request.schema_version===chainedReplacementSchema;
  const binding=chained?{run6:reviewedAbort6,run5:reviewedAbort}:reviewedAbort;
  const proof=chained?abort6Proof:abort5Proof;
  if(!isReplacementRequest(request)||request.expected_run_number!==(chained?7:6)
    ||!same(request.abort_continuity,binding)||!same(request.source,reviewedSource)
    ||request.operation_id===abort5Proof.operation||(chained&&request.operation_id===abort6Proof.operation)
    ||!finiteDate(request.created_at)||Date.parse(request.created_at)<=Date.parse(proof.completedAt)){
    throw Error(chained?'Only the exact reviewed run6 -> run5 pre-provider aborts may precede run7'
      :'Only the exact reviewed run5 pre-provider abort may precede run6');
  }
}

function checkedRun(run,{id,attempt,sha,number,status,conclusion}){
  if(run?.id!==id||run.run_attempt!==attempt||run.head_sha!==sha||run.run_number!==number
    ||run.head_branch!==abortBranch||run.path!==recoveryWorkflow||run.event!=='push'
    ||run.workflow_id!==workflowId||run.repository?.id!==repositoryId||run.head_repository?.id!==repositoryId
    ||run.repository.full_name!==repository||run.head_repository.full_name!==repository
    ||run.status!==status||run.conclusion!==conclusion||!finiteDate(run.run_started_at))throw Error('Reviewed abort-chain run identity changed');
  return run;
}
function sameRun(run,other){
  for(const key of ['id','run_attempt','head_sha','run_number','head_branch','path','event','workflow_id','status','conclusion','run_started_at']){
    if(run[key]!==other[key])throw Error('Abort-chain inventory and exact attempt disagree');
  }
  for(const key of ['repository','head_repository'])if(run[key]?.id!==other[key]?.id
    ||run[key]?.full_name!==other[key]?.full_name)throw Error('Abort-chain repository identity changed');
}
function readSpentRequest(api,identity){
  const value=api(`repos/${repository}/contents/${spentRequestPath}?ref=${identity.head_sha}`);
  if(value?.type!=='file'||value.path!==spentRequestPath||value.encoding!=='base64'||!positive(value.size)||value.size>16384
    ||typeof value.content!=='string'||!(/^[a-zA-Z0-9+/=\r\n]+$/).test(value.content))throw Error('Missing immutable spent request bytes');
  const bytes=Buffer.from(value.content,'base64');
  if(bytes.length!==value.size||hash(bytes)!==identity.request_sha256)throw Error('Spent request bytes changed');
  return JSON.parse(bytes);
}
export function readAbortJobLog(jobId){
  if(jobId!==reviewedAbort.job_id&&jobId!==reviewedAbort6.job_id)throw Error('Unreviewed abort job');
  return readReviewedJobLog(jobId);
}
function expectedAbort(identity){
  return {id:identity.run_id,attempt:1,sha:identity.head_sha,number:identity.run_number,status:'completed',conclusion:'failure'};
}
// Only the two private, immutable reviewed proofs can reach this helper. No
// request-provided IDs, list traversal, recursive fallback or extra skip exists.
function authenticateTerminalAbort(request,abort,next,proof,api,readLog){
  const {identity,completedAt,startedAt,runStartedAt,logLength,schema,operation}=proof;
  checkedRun(abort,expectedAbort(identity));
  if(abort.run_started_at!==runStartedAt)throw Error('Reviewed abort start changed');
  for(const suffix of ['', '/attempts/1'])sameRun(abort,checkedRun(api(`repos/${repository}/actions/runs/${abort.id}${suffix}`),expectedAbort(identity)));
  const artifacts=api(`repos/${repository}/actions/runs/${abort.id}/artifacts?per_page=100`);
  if(artifacts?.total_count!==0||!Array.isArray(artifacts.artifacts)||artifacts.artifacts.length!==0)throw Error('Abort artifacts are nonempty or incomplete');
  const jobs=api(`repos/${repository}/actions/runs/${abort.id}/attempts/1/jobs?per_page=100`);
  if(jobs?.total_count!==1||!Array.isArray(jobs.jobs)||jobs.jobs.length!==1)throw Error('Abort job inventory is incomplete or ambiguous');
  const job=jobs.jobs[0];
  if(job.id!==identity.job_id||job.run_id!==abort.id||job.run_attempt!==1||job.head_sha!==abort.head_sha
    ||job.head_branch!==abortBranch||job.name!=='statement-recovery'||job.status!=='completed'||job.conclusion!=='failure'
    ||job.completed_at!==completedAt||job.started_at!==startedAt||!Array.isArray(job.steps)
    ||Date.parse(abort.run_started_at)>Date.parse(job.started_at)||Date.parse(job.started_at)>Date.parse(job.completed_at)
    ||Date.parse(job.completed_at)>=Date.parse(next.run_started_at))throw Error('Reviewed terminal abort job changed');
  const expectedSteps=[['Set up job',1,'success'],['Start the bounded job clock',2,'success'],
    ['Run actions/checkout@v4',3,'success'],['Run actions/setup-node@v4',4,'success'],
    ['Run actions/setup-python@v5',5,'success'],['Install the reviewed statement transport',6,'success'],
    ['Check acquisition bounds and source restoration offline',7,'success'],
    ['Authenticate the new finite request and collect only due NVDA and AAOI',8,'failure'],
    ['Retain partial source progress and original pilot receipts',9,'success'],
    ['Post Run actions/setup-python@v5',16,'skipped'],['Post Run actions/setup-node@v4',17,'skipped'],
    ['Post Run actions/checkout@v4',18,'success'],['Complete job',19,'success']];
  if(job.steps.length!==expectedSteps.length)throw Error('Reviewed abort step inventory changed');
  let previousEnd=Date.parse(job.started_at);
  for(const [index,[name,number,conclusion]]of expectedSteps.entries()){
    const step=job.steps[index];
    if(step.name!==name||step.number!==number||step.status!=='completed'||step.conclusion!==conclusion
      ||!finiteDate(step.started_at)||!finiteDate(step.completed_at)||Date.parse(step.started_at)<previousEnd
      ||Date.parse(step.completed_at)<Date.parse(step.started_at)||Date.parse(step.completed_at)>Date.parse(job.completed_at))throw Error('Reviewed abort step outcome or chronology changed');
    previousEnd=Date.parse(step.completed_at);
  }
  const log=readLog(identity.job_id);
  if(!Buffer.isBuffer(log)||log.length!==logLength||hash(log)!==identity.job_log_sha256)throw Error('Reviewed complete abort job log changed or is unavailable');
  const old=readSpentRequest(api,identity);
  if(old.schema_version!==schema||old.expected_run_number!==identity.run_number||old.operation_id!==operation
    ||!same(old.source,request.source)||!same(old.selection,request.selection)||!same(old.limits,request.limits)
    ||old.operation_id===request.operation_id||old.publication_authority!=='none'||old.financial_admission!==false)throw Error('Replacement renews a spent operation or changes retained work');
  if(identity===reviewedAbort6)validateAbortContinuity(old);
}

// recoverySource first authenticates the current attempt and its actual immediate
// predecessor. These are exactly run6 -> abort5 -> source4 OR the separately
// reviewed run7 -> abort6 -> abort5 -> source4. This cannot admit any other chain.
export function authenticateAbortContinuity(request,state,api,readLog=readAbortJobLog){
  validateAbortContinuity(request);
  if(state.initial||!state.current||!state.run)throw Error('Abort continuity requires an authenticated recovery predecessor');
  const chained=request.schema_version===chainedReplacementSchema,identity=chained?reviewedAbort6:reviewedAbort;
  const current=checkedRun(state.current,{id:state.current.id,attempt:1,sha:state.current.head_sha,number:chained?7:6,status:'in_progress',conclusion:null});
  if(!positive(current.id)||current.id<=identity.run_id||!(/^[a-f0-9]{40}$/).test(current.head_sha??''))throw Error('Invalid replacement run identity');
  const predecessor=checkedRun(state.run,expectedAbort(identity));
  const inventory=api(`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`);
  const runs=inventory?.workflow_runs,required=chained?[current.id,reviewedAbort6.run_id,reviewedAbort.run_id,reviewedSource.run_id]
    :[current.id,reviewedAbort.run_id,reviewedSource.run_id];
  if(!Array.isArray(runs)||!Number.isSafeInteger(inventory.total_count)||inventory.total_count<required.length||inventory.total_count>100
    ||runs.length!==inventory.total_count||new Set(runs.map(run=>run.id)).size!==runs.length
    ||required.some(id=>runs.filter(run=>run.id===id).length!==1))throw Error('Incomplete or ambiguous abort-chain inventory');
  const serial=runs.filter(run=>run.path===recoveryWorkflow&&run.head_branch===abortBranch&&run.event==='push');
  if(new Set(serial.map(run=>run.run_number)).size!==serial.length||new Set(serial.map(run=>run.head_sha)).size!==serial.length
    ||serial.some(run=>run.id!==current.id&&run.status!=='completed')||serial.some(run=>run.id>current.id)
    ||previousRecoveryRun(runs,current.id,abortBranch)?.id!==predecessor.id
    ||previousRecoveryRun(runs,reviewedAbort.run_id,abortBranch)?.id!==reviewedSource.run_id
    ||(chained&&previousRecoveryRun(runs,reviewedAbort6.run_id,abortBranch)?.id!==reviewedAbort.run_id))throw Error('Intervening, live, duplicate or newer recovery execution');
  sameRun(current,runs.find(run=>run.id===current.id));
  sameRun(predecessor,runs.find(run=>run.id===predecessor.id));
  const abort=chained?checkedRun(runs.find(run=>run.id===reviewedAbort.run_id),expectedAbort(reviewedAbort)):predecessor;
  if(chained)authenticateTerminalAbort(request,predecessor,current,abort6Proof,api,readLog);
  authenticateTerminalAbort(request,abort,chained?predecessor:current,abort5Proof,api,readLog);
  const expectedSource={id:reviewedSource.run_id,attempt:1,sha:reviewedSource.head_sha,number:4,status:'completed',conclusion:'failure'};
  const source=checkedRun(api(`repos/${repository}/actions/runs/${reviewedSource.run_id}/attempts/1`),expectedSource);
  sameRun(source,checkedRun(api(`repos/${repository}/actions/runs/${reviewedSource.run_id}`),expectedSource));
  sameRun(source,runs.find(run=>run.id===source.id));
  if(Date.parse(source.run_started_at)>=Date.parse(abort.run_started_at))throw Error('Source and abort chronology changed');
  // Keep the original source's artifact interval bounded by its true successor,
  // abort5, never by the later abort6 or current execution.
  return {...state,run:source,abort,...(chained?{aborts:[predecessor,abort]}:{})};
}

// Called in addition to the existing clean checkout, exact HEAD, single-child
// controller/tree and committed-new-request byte checks. Read raw commit headers
// so this works with the existing fetch-depth2 shallow checkout.
export function verifyReplacementActivation(request,context,cwd){
  validateAbortContinuity(request);
  const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:1024**2,timeout:30000}).trim();
  const parent=request.controller.parent_sha;
  const identity=request.schema_version===chainedReplacementSchema?reviewedAbort6:reviewedAbort;
  if(context.attempt!==1||context.branch!==abortBranch||context.event!=='push'||context.repository!==repository
    ||git(['diff','--name-status',parent,context.sha])!==`M\t${spentRequestPath}`)throw Error('Replacement must only modify the execution request');
  const commit=git(['cat-file','commit',parent]),parents=[...commit.split('\n\n',1)[0].matchAll(/^parent ([a-f0-9]{40})$/gm)].map(match=>match[1]);
  if(!same(parents,[identity.head_sha]))throw Error('Reviewed repair controller must be one code-only child of the aborted activation');
  const oldBytes=execFileSync('git',['show',`${parent}:${spentRequestPath}`],{cwd,maxBuffer:16384,timeout:30000});
  if(hash(oldBytes)!==identity.request_sha256)throw Error('Repair controller changed or deleted the spent request');
}
