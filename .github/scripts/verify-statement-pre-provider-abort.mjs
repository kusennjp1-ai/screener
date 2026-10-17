// Four closed reviewed terminal-abort proofs, not a search/fallback/retry mechanism.
// Run8 is an audited prepared abort, never a completed source or artifact-free run.
// The immutable run5 head binds the reviewed caller (sha256 7209f92cc72de912b29789ebccbb41450e2e9bf74f559a93984e5a16b2488374)
// and workflow (sha256 53005ef466d31fb2ba362cc4a4d0c49cdbcc29bbde3f889730e6c1e6b52bc207).
// That caller's line159 awaits livePublication before its only provider-child
// spawn. The full exact authenticated job log proves this call threw. Neither
// an absent artifact nor an arbitrary failure/log substring establishes that.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,mkdtempSync,openSync,readSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {repository,recoveryWorkflow,previousRecoveryRun} from './restore-statement-source.mjs';
import {readReviewedJobLog} from './download-reviewed-job-log.mjs';

export const replacementSchema='financial-targeted-recovery-execution-v2';
export const chainedReplacementSchema='financial-targeted-recovery-execution-v3';
export const run8ReplacementSchema='financial-targeted-recovery-execution-v4';
export const run9ReplacementSchema='financial-targeted-recovery-execution-v5';
export const isReplacementRequest=request=>[replacementSchema,chainedReplacementSchema,run8ReplacementSchema,run9ReplacementSchema].includes(request?.schema_version);
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
// The immutable run7 caller (sha256 cc1bc4666ce1612cbc3ffa4f52fc4f866b7470337e07918085a63be6c9f02c94)
// authenticates at line154 before mkdir158, the live verifier159, source restore,
// and the only provider child196. Its exact complete log proves that call threw;
// the generic download error does not establish its underlying transport cause.
export const reviewedAbort7=Object.freeze({schema_version:'financial-pre-provider-abort-v1',
  run_id:38997227416,run_attempt:1,run_number:7,head_sha:'b6378b8077b51f18d63e6dbb4d221ac47144bee4',
  request_sha256:'846a0d2a07e2a43b6eee3837f19dfb01e233866a8b3e1912a57d025d3a043e00',
  job_id:117292325413,job_log_sha256:'5ce16137dfe39a063a3f0903031eb93bdb1f792a08dee1549c97bdf3b152ae56'});
// The immutable run8 Python cycle reaches bounded_acquisition_budget at line363
// before its only collector call375. Its exact log proves that guard threw.
// The exact retained ZIP was independently audited: prepared cycle, no batch,
// all8431 source4 archive files/8417 objects/4154 receipts/4182 attempts and all
// 1894 ordered cohort members unchanged. Hashing these known bytes at runtime
// binds that closed audit; a digest in metadata or absence of a batch is not proof.
export const reviewedPreparedAbort8=Object.freeze({schema_version:'financial-prepared-pre-provider-abort-v1',
  run_id:39013437787,run_attempt:1,run_number:8,head_sha:'49ca70d2c09dac84ce2ae1100617f9aba3a78527',
  request_sha256:'13bbc9b0edff90a99f28d111bab483c0f61c9f2efc4f739548dff1e859b08d63',
  job_id:117340568549,job_log_sha256:'37a202f5d7d992b2f61f154715ffd4758f9e2a652c3ecb65805019c9bbd7f1b0',
  artifact_id:12093719779,artifact_bytes:29737343,
  artifact_sha256:'3518d1a73c0ec4999fdaa67d6deafd7a19157e69a15f5a184b645aa1cf9c34f5'});
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
const abort7Proof=Object.freeze({identity:reviewedAbort7,completedAt:'2026-10-17T03:03:22Z',
  startedAt:'2026-10-17T03:02:14Z',runStartedAt:'2026-10-17T03:02:12Z',logLength:67609,
  schema:chainedReplacementSchema,operation:'targeted-nvda-aaoi-20261017t025809z'});
const preparedAbort8Proof=Object.freeze({identity:reviewedPreparedAbort8,completedAt:'2026-10-17T07:41:58Z',
  startedAt:'2026-10-17T07:23:16Z',runStartedAt:'2026-10-17T07:23:14Z',logLength:84586,
  schema:run8ReplacementSchema,operation:'targeted-nvda-aaoi-20261017t071531z-289570b8'});
const workflowId=374552819,repositoryId=1203919607;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const positive=value=>Number.isSafeInteger(value)&&value>0;
const same=isDeepStrictEqual;
const finiteDate=value=>typeof value==='string'&&value.endsWith('Z')&&Number.isFinite(Date.parse(value));

export function validateAbortContinuity(request){
  const run9=request.schema_version===run9ReplacementSchema;
  const run8=run9||request.schema_version===run8ReplacementSchema;
  const chained=run8||request.schema_version===chainedReplacementSchema;
  const binding=run9?{run8:reviewedPreparedAbort8,run7:reviewedAbort7,run6:reviewedAbort6,run5:reviewedAbort}
    :run8?{run7:reviewedAbort7,run6:reviewedAbort6,run5:reviewedAbort}
    :chained?{run6:reviewedAbort6,run5:reviewedAbort}:reviewedAbort;
  const proof=run9?preparedAbort8Proof:run8?abort7Proof:chained?abort6Proof:abort5Proof;
  if(!isReplacementRequest(request)||request.expected_run_number!==(run9?9:run8?8:chained?7:6)
    ||!same(request.abort_continuity,binding)||!same(request.source,reviewedSource)
    ||request.operation_id===abort5Proof.operation||(chained&&request.operation_id===abort6Proof.operation)
    ||(run8&&request.operation_id===abort7Proof.operation)||(run9&&request.operation_id===preparedAbort8Proof.operation)
    ||!finiteDate(request.created_at)||Date.parse(request.created_at)<=Date.parse(proof.completedAt)){
    throw Error(run9?'Only the exact reviewed prepared abort8 -> abort7 -> abort6 -> abort5 may precede run9'
      :run8?'Only the exact reviewed run7 -> run6 -> run5 pre-provider aborts may precede run8'
      :chained?'Only the exact reviewed run6 -> run5 pre-provider aborts may precede run7'
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
  if(jobId!==reviewedAbort.job_id&&jobId!==reviewedAbort6.job_id&&jobId!==reviewedAbort7.job_id&&jobId!==reviewedPreparedAbort8.job_id)throw Error('Unreviewed abort job');
  return readReviewedJobLog(jobId);
}
function unlinkedArtifactDirectory(value){
  const root=resolve(value);
  if(realpathSync(root)!==root||!lstatSync(root).isDirectory())throw Error();
  for(let path=root;;path=dirname(path)){if(lstatSync(path).isSymbolicLink())throw Error();if(path===dirname(path))break;}
  return root;
}
// Match the proven artifact download's file-only gh output. A child-local
// RLIMIT_FSIZE bounds writes before download completion; it changes no runner
// setting. No ZIP bytes reach the process stdout/stderr capture or a terminal.
// Injection is solely an offline transport test seam, not request authority.
export function readPreparedAbortArtifact(artifactId,{execute=execFileSync,temporaryRoot=tmpdir()}={}){
  if(artifactId!==reviewedPreparedAbort8.artifact_id)throw Error('Unreviewed prepared abort artifact');
  let directory,descriptor;
  try{
    directory=mkdtempSync(join(unlinkedArtifactDirectory(temporaryRoot),'reviewed-prepared-abort8-'));
    descriptor=openSync(join(directory,'artifact.zip'),constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    execute('python3',['-c',`import os,resource,sys
limit=int(sys.argv[1]);resource.setrlimit(resource.RLIMIT_FSIZE,(limit,limit))
os.execvp('gh',['gh','api',sys.argv[2]])`,String(reviewedPreparedAbort8.artifact_bytes),
      `repos/${repository}/actions/artifacts/${artifactId}/zip`],
      {timeout:60000,maxBuffer:65536,stdio:['ignore',descriptor,'pipe']});
    const checkedFile=()=>{
      unlinkedArtifactDirectory(directory);
      const info=fstatSync(descriptor),pathInfo=lstatSync(join(directory,'artifact.zip'));
      if(!info.isFile()||info.nlink!==1||info.size!==reviewedPreparedAbort8.artifact_bytes
        ||!pathInfo.isFile()||pathInfo.isSymbolicLink()||pathInfo.nlink!==1||pathInfo.dev!==info.dev||pathInfo.ino!==info.ino)throw Error();
      return info;
    };
    const info=checkedFile();
    const bytes=Buffer.alloc(info.size);let offset=0;
    while(offset<bytes.length){const length=readSync(descriptor,bytes,offset,bytes.length-offset,offset);if(length<=0)throw Error();offset+=length;}
    const after=checkedFile();if(after.size!==info.size)throw Error();
    return bytes;
  }catch{throw Error('Reviewed prepared abort artifact download failed');}
  finally{
    let failed=false;
    try{if(descriptor!==undefined)closeSync(descriptor);}catch{failed=true;}
    try{if(directory)rmSync(directory,{recursive:true,force:true});}catch{failed=true;}
    if(failed)throw Error('Reviewed prepared abort artifact cleanup failed');
  }
}
export function verifyPreparedAbortArtifactBytes(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length!==reviewedPreparedAbort8.artifact_bytes
    ||hash(bytes)!==reviewedPreparedAbort8.artifact_sha256)throw Error('Reviewed prepared abort artifact bytes changed or are unavailable');
}
function authenticatePreparedArtifact(inventory,abort,next,readArtifact){
  if(inventory?.total_count!==1||!Array.isArray(inventory.artifacts)||inventory.artifacts.length!==1)throw Error('Prepared abort requires its exact nonempty artifact inventory');
  const artifact=inventory.artifacts[0],identity=reviewedPreparedAbort8;
  if(artifact.id!==identity.artifact_id||artifact.name!==`financial-statement-recovery-${identity.head_sha}-1`
    ||artifact.size_in_bytes!==identity.artifact_bytes||artifact.digest!==`sha256:${identity.artifact_sha256}`
    ||artifact.expired!==false||artifact.created_at!=='2026-10-17T07:41:52Z'
    ||artifact.workflow_run?.id!==abort.id||artifact.workflow_run.head_sha!==identity.head_sha
    ||artifact.workflow_run.head_branch!==abortBranch||artifact.workflow_run.repository_id!==repositoryId
    ||artifact.workflow_run.head_repository_id!==repositoryId
    ||Date.parse(artifact.created_at)>=Date.parse(next.run_started_at))throw Error('Reviewed prepared abort artifact identity changed');
  verifyPreparedAbortArtifactBytes(readArtifact(identity.artifact_id));
}
function expectedAbort(identity){
  return {id:identity.run_id,attempt:1,sha:identity.head_sha,number:identity.run_number,status:'completed',conclusion:'failure'};
}
// Only the four private, immutable reviewed proofs can reach this helper. No
// request-provided IDs, list traversal, recursive fallback or extra skip exists.
function authenticateTerminalAbort(request,abort,next,proof,api,readLog,readArtifact){
  const {identity,completedAt,startedAt,runStartedAt,logLength,schema,operation}=proof;
  checkedRun(abort,expectedAbort(identity));
  if(abort.run_started_at!==runStartedAt)throw Error('Reviewed abort start changed');
  for(const suffix of ['', '/attempts/1'])sameRun(abort,checkedRun(api(`repos/${repository}/actions/runs/${abort.id}${suffix}`),expectedAbort(identity)));
  const artifacts=api(`repos/${repository}/actions/runs/${abort.id}/artifacts?per_page=100`);
  const prepared=identity===reviewedPreparedAbort8;
  if(!prepared&&(artifacts?.total_count!==0||!Array.isArray(artifacts.artifacts)||artifacts.artifacts.length!==0))throw Error('Abort artifacts are nonempty or incomplete');
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
  if(identity===reviewedAbort6||identity===reviewedAbort7||prepared)validateAbortContinuity(old);
  if(prepared)authenticatePreparedArtifact(artifacts,abort,next,readArtifact);
}

// recoverySource first authenticates the current attempt and its actual immediate
// predecessor. The only additions are the separately reviewed run7 -> abort6 ->
// abort5 -> source4, run8 -> abort7 -> abort6 -> abort5 -> source4, and
// run9 -> prepared-abort8 -> abort7 -> abort6 -> abort5 -> source4. No other chain is admitted.
export function authenticateAbortContinuity(request,state,api,readLog=readAbortJobLog,readArtifact=readPreparedAbortArtifact){
  validateAbortContinuity(request);
  if(state.initial||!state.current||!state.run)throw Error('Abort continuity requires an authenticated recovery predecessor');
  const run9=request.schema_version===run9ReplacementSchema;
  const run8=run9||request.schema_version===run8ReplacementSchema,chained=run8||request.schema_version===chainedReplacementSchema;
  const identity=run9?reviewedPreparedAbort8:run8?reviewedAbort7:chained?reviewedAbort6:reviewedAbort;
  const current=checkedRun(state.current,{id:state.current.id,attempt:1,sha:state.current.head_sha,number:run9?9:run8?8:chained?7:6,status:'in_progress',conclusion:null});
  if(!positive(current.id)||current.id<=identity.run_id||!(/^[a-f0-9]{40}$/).test(current.head_sha??''))throw Error('Invalid replacement run identity');
  const predecessor=checkedRun(state.run,expectedAbort(identity));
  const inventory=api(`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`);
  const runs=inventory?.workflow_runs,required=run9?[current.id,reviewedPreparedAbort8.run_id,reviewedAbort7.run_id,reviewedAbort6.run_id,reviewedAbort.run_id,reviewedSource.run_id]
    :run8?[current.id,reviewedAbort7.run_id,reviewedAbort6.run_id,reviewedAbort.run_id,reviewedSource.run_id]
    :chained?[current.id,reviewedAbort6.run_id,reviewedAbort.run_id,reviewedSource.run_id]
    :[current.id,reviewedAbort.run_id,reviewedSource.run_id];
  if(!Array.isArray(runs)||!Number.isSafeInteger(inventory.total_count)||inventory.total_count<required.length||inventory.total_count>100
    ||runs.length!==inventory.total_count||new Set(runs.map(run=>run.id)).size!==runs.length
    ||required.some(id=>runs.filter(run=>run.id===id).length!==1))throw Error('Incomplete or ambiguous abort-chain inventory');
  const serial=runs.filter(run=>run.path===recoveryWorkflow&&run.head_branch===abortBranch&&run.event==='push');
  if(new Set(serial.map(run=>run.run_number)).size!==serial.length||new Set(serial.map(run=>run.head_sha)).size!==serial.length
    ||serial.some(run=>run.id!==current.id&&run.status!=='completed')||serial.some(run=>run.id>current.id)
    ||previousRecoveryRun(runs,current.id,abortBranch)?.id!==predecessor.id
    ||previousRecoveryRun(runs,reviewedAbort.run_id,abortBranch)?.id!==reviewedSource.run_id
    ||(chained&&previousRecoveryRun(runs,reviewedAbort6.run_id,abortBranch)?.id!==reviewedAbort.run_id)
    ||(run8&&previousRecoveryRun(runs,reviewedAbort7.run_id,abortBranch)?.id!==reviewedAbort6.run_id)
    ||(run9&&previousRecoveryRun(runs,reviewedPreparedAbort8.run_id,abortBranch)?.id!==reviewedAbort7.run_id))throw Error('Intervening, live, duplicate or newer recovery execution');
  sameRun(current,runs.find(run=>run.id===current.id));
  sameRun(predecessor,runs.find(run=>run.id===predecessor.id));
  const abort=chained?checkedRun(runs.find(run=>run.id===reviewedAbort.run_id),expectedAbort(reviewedAbort)):predecessor;
  const abort6=run8?checkedRun(runs.find(run=>run.id===reviewedAbort6.run_id),expectedAbort(reviewedAbort6)):predecessor;
  const abort7=run9?checkedRun(runs.find(run=>run.id===reviewedAbort7.run_id),expectedAbort(reviewedAbort7)):predecessor;
  if(run9)authenticateTerminalAbort(request,predecessor,current,preparedAbort8Proof,api,readLog,readArtifact);
  if(run8)authenticateTerminalAbort(request,abort7,run9?predecessor:current,abort7Proof,api,readLog);
  if(chained)authenticateTerminalAbort(request,abort6,run8?abort7:current,abort6Proof,api,readLog);
  authenticateTerminalAbort(request,abort,chained?abort6:current,abort5Proof,api,readLog);
  const expectedSource={id:reviewedSource.run_id,attempt:1,sha:reviewedSource.head_sha,number:4,status:'completed',conclusion:'failure'};
  const source=checkedRun(api(`repos/${repository}/actions/runs/${reviewedSource.run_id}/attempts/1`),expectedSource);
  sameRun(source,checkedRun(api(`repos/${repository}/actions/runs/${reviewedSource.run_id}`),expectedSource));
  sameRun(source,runs.find(run=>run.id===source.id));
  if(Date.parse(source.run_started_at)>=Date.parse(abort.run_started_at))throw Error('Source and abort chronology changed');
  // Keep the original source's artifact interval bounded by its true successor,
  // abort5, never by the later abort6, abort7 or current execution.
  return {...state,run:source,abort,...(run9?{preparedAbort:predecessor,aborts:[predecessor,abort7,abort6,abort]}:run8?{aborts:[predecessor,abort6,abort]}:chained?{aborts:[predecessor,abort]}:{})};
}

// Called in addition to the existing clean checkout, exact HEAD, single-child
// controller/tree and committed-new-request byte checks. Read raw commit headers
// so this works with the existing fetch-depth2 shallow checkout.
export function verifyReplacementActivation(request,context,cwd){
  validateAbortContinuity(request);
  const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:1024**2,timeout:30000}).trim();
  const parent=request.controller.parent_sha;
  const identity=request.schema_version===run9ReplacementSchema?reviewedPreparedAbort8
    :request.schema_version===run8ReplacementSchema?reviewedAbort7
    :request.schema_version===chainedReplacementSchema?reviewedAbort6:reviewedAbort;
  if(context.attempt!==1||context.branch!==abortBranch||context.event!=='push'||context.repository!==repository
    ||git(['diff','--name-status',parent,context.sha])!==`M\t${spentRequestPath}`)throw Error('Replacement must only modify the execution request');
  const commit=git(['cat-file','commit',parent]),parents=[...commit.split('\n\n',1)[0].matchAll(/^parent ([a-f0-9]{40})$/gm)].map(match=>match[1]);
  if(!same(parents,[identity.head_sha]))throw Error('Reviewed repair controller must be one code-only child of the aborted activation');
  const oldBytes=execFileSync('git',['show',`${parent}:${spentRequestPath}`],{cwd,maxBuffer:16384,timeout:30000});
  if(hash(oldBytes)!==identity.request_sha256)throw Error('Repair controller changed or deleted the spent request');
}
