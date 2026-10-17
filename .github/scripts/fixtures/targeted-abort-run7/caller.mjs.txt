// Artifact-only caller. No publication, admission, retries or provider resume.
import {execFileSync,spawn} from 'node:child_process';
import {closeSync,lstatSync,mkdirSync,openSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {githubApi} from './publication-gate.mjs';
import {sha256,downloadArtifact} from './publication-state.mjs';
import {preparePublicationVerifier} from './targeted-publication-verifier.mjs';
import {chooseExport,verifyArchive} from './select-release-source.mjs';
import {uniqueArtifact} from './select-published-runs.mjs';
import {assertPriceObservationBounds,extractPriceObservations,priceObservationDigest} from './price-observations.mjs';
import {repository,recoveryWorkflow,recoverySource,checkedArtifact,extractSourceArchive} from './restore-statement-source.mjs';
import {researchPath} from './prepare-statement-cohort.mjs';
import {prepareRecoveryPreflightInputs} from './prepare-statement-recovery-preflight.mjs';
import {replacementSchema,chainedReplacementSchema,isReplacementRequest,validateAbortContinuity,authenticateAbortContinuity,verifyReplacementActivation,readAbortJobLog} from './verify-statement-pre-provider-abort.mjs';

export const branch='improve/mandatory-financial-source-recovery';
export const requestPath='.github/targeted-financial-recovery/request.json';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function exact(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))throw Error(`Invalid closed ${label}`);}
function git(args,cwd=root){return execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:1024**2,timeout:30000}).trim();}
export function boundedFile(path,maximum){
  for(let p=resolve(path);;p=dirname(p)){if(lstatSync(p).isSymbolicLink())throw Error('Linked input path');if(p===dirname(p))break;}
  const stat=lstatSync(path);if(!stat.isFile()||stat.nlink!==1||stat.size<=0||stat.size>maximum)throw Error('Unbounded or nonregular input');
  return readFileSync(path);
}
export function validateRequest(value,now=Date.now()){
  const replacement=isReplacementRequest(value);
  exact(value,['schema_version','operation_id','created_at','expires_at','controller','expected_run_number','source','price_source','selection','limits','publication_authority','financial_admission',...(replacement?['abort_continuity']:[])],'execution request');
  if(!['financial-targeted-recovery-execution-v1',replacementSchema,chainedReplacementSchema].includes(value.schema_version)||value.publication_authority!=='none'||value.financial_admission!==false
    ||typeof value.operation_id!=='string'||!/^targeted-nvda-aaoi-[a-z0-9-]{1,64}$/.test(value.operation_id))throw Error('Invalid artifact-only operation');
  if(replacement)validateAbortContinuity(value);
  const start=Date.parse(value.created_at),end=Date.parse(value.expires_at);
  if(!value.created_at.endsWith('Z')||!value.expires_at.endsWith('Z')||!Number.isFinite(start)||!Number.isFinite(end)
    ||start>now||now>=end||end-start<=0||end-start>2*60*60*1000)throw Error('A new finite current execution request is required');
  exact(value.controller,['parent_sha','parent_tree'],'reviewed controller');
  if(!sha(value.controller.parent_sha)||!sha(value.controller.parent_tree)||!positive(value.expected_run_number))throw Error('Missing exact reviewed parent');
  exact(value.source,['run_id','run_attempt','head_sha','artifact_id','artifact_sha256','archive_manifest_sha256','base_sha256','cohort_sha256'],'source');
  exact(value.price_source,['run_id','run_attempt','head_sha','artifact_id','artifact_sha256','companion_id','companion_sha256','manifest_sha256','research_sha256'],'price source');
  for(const source of [value.source,value.price_source])for(const [key,item]of Object.entries(source)){
    if(key==='head_sha'?!sha(item):key.endsWith('sha256')?!hash(item):!positive(item))throw Error('Malformed immutable source identity');
  }
  exact(value.limits,['max_symbols','max_statement_getter_calls','max_transport_requests','acquisition_budget_seconds','caller_retries'],'limits');
  if(Object.entries({max_symbols:2,max_statement_getter_calls:4,max_transport_requests:1000,acquisition_budget_seconds:1080,caller_retries:0}).some(([key,limit])=>value.limits[key]!==limit))throw Error('Acquisition bound differs from reviewed two-symbol operation');
  if(!Array.isArray(value.selection)||!same(value.selection.map(item=>item.symbol),['NVDA','AAOI']))throw Error('Only ordered NVDA and AAOI are supported');
  for(const item of value.selection){
    exact(item,['symbol','targets','receipts'],'selection');
    if(!same(item.targets,['eps','sales','annual_history'])||!Array.isArray(item.receipts)
      ||!same(item.receipts.map(r=>r.attribute),['quarterly_income_stmt','income_stmt']))throw Error('Explicit full target and original receipt selection required');
    for(const receipt of item.receipts){exact(receipt,['attribute','receipt_sha256','attempt_id','attempt_object_sha256'],'receipt');
      if(!hash(receipt.receipt_sha256)||!hash(receipt.attempt_object_sha256)||typeof receipt.attempt_id!=='string'||receipt.attempt_id.length>100||!receipt.attempt_id)throw Error('Unbound original receipt');}
  }
  return value;
}
export function verifyActivation(request,context,cwd=root){
  if(context.repository!==repository||context.event!=='push'||context.branch!==branch||context.attempt!==1||!sha(context.sha)||!positive(context.id))throw Error('Only the authentic serial activation is supported');
  if(git(['rev-parse','HEAD'],cwd)!==context.sha||git(['status','--porcelain','--untracked-files=all'],cwd))throw Error('Activation checkout is not exact and clean');
  if(git(['rev-list','--parents','-n','1','HEAD'],cwd)!==`${context.sha} ${request.controller.parent_sha}`
    ||git(['rev-parse',`${request.controller.parent_sha}^{tree}`],cwd)!==request.controller.parent_tree)throw Error('Activation is not a single child of the reviewed controller');
  // A code change must receive a separate review before a request-only activation.
  if(isReplacementRequest(request))verifyReplacementActivation(request,context,cwd);
  else if(git(['diff','--name-status',request.controller.parent_sha,context.sha],cwd)!==`A\t${requestPath}`)throw Error('Activation may only add the new execution request');
  const bytes=boundedFile(join(cwd,requestPath),16384);
  if(!same(JSON.parse(bytes),request)||sha256(execFileSync('git',['show',`${context.sha}:${requestPath}`],{cwd,maxBuffer:16384}))!==sha256(bytes))throw Error('Request bytes differ from the committed activation');
  return bytes;
}
function sourceInventory(run,api){
  const list=api(`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`);
  if(!Number.isSafeInteger(list.total_count)||list.total_count<0||list.total_count>100||!Array.isArray(list.artifacts)||list.artifacts.length!==list.total_count)throw Error('Incomplete source artifacts');
  return list.artifacts;
}
export function authenticateRecovery(request,context,api=githubApi,readLog=readAbortJobLog){
  let state=recoverySource(context,api);
  if(isReplacementRequest(request))state=authenticateAbortContinuity(request,state,api,readLog);
  const {current,run,initial}=state;
  const attempt=api(`repos/${repository}/actions/runs/${context.id}/attempts/1`);
  if(initial||current.run_number!==request.expected_run_number||!same([attempt.id,attempt.run_attempt,attempt.head_sha,attempt.head_branch,attempt.path,attempt.event,attempt.status,attempt.workflow_id,attempt.repository?.id,attempt.head_repository?.id,attempt.repository?.full_name,attempt.head_repository?.full_name,attempt.run_number],
    [current.id,1,current.head_sha,branch,recoveryWorkflow,'push','in_progress',current.workflow_id,current.repository.id,current.head_repository.id,repository,repository,request.expected_run_number]))throw Error('Current attempt or one-shot run number changed');
  const inventory=api(`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`);
  if(!Number.isSafeInteger(inventory.total_count)||inventory.total_count>100||inventory.workflow_runs?.length!==inventory.total_count
    ||inventory.workflow_runs.filter(item=>item.id===context.id).length!==1
    ||inventory.workflow_runs.filter(item=>item.head_sha===context.sha).length!==1)throw Error('Activation was previously consumed or inventory is incomplete');
  if(api(`repos/${repository}/git/ref/heads/${branch}`).object?.sha!==context.sha)throw Error('Recovery branch advanced during activation');
  const artifact=checkedArtifact(sourceInventory(run,api),run,false,state.abort??current),source=request.source;
  if(!same([run.id,run.run_attempt,run.head_sha,artifact.id,artifact.digest],
    [source.run_id,source.run_attempt,source.head_sha,source.artifact_id,`sha256:${source.artifact_sha256}`]))throw Error('Latest serial predecessor differs from request');
  return {...state,artifact};
}
export function checkPriceIdentity(request,source,pages){
  if(!source||source.repair)throw Error('No current ordinary canonical price source');
  const companion=uniqueArtifact(pages,`static-site-data-manifest-${source.runId}-${source.attempt}`,source.runId),p=request.price_source;
  if(!same([source.runId,source.attempt,source.artifact.workflow_run.head_sha,source.artifact.id,source.artifact.digest,companion.id,companion.digest,source.manifestHash],
    [p.run_id,p.run_attempt,p.head_sha,p.artifact_id,`sha256:${p.artifact_sha256}`,p.companion_id,`sha256:${p.companion_sha256}`,p.manifest_sha256]))throw Error('Current canonical price source differs from request');
  if(source.manifest.research_generation!==p.research_sha256)throw Error('Canonical research generation differs from request');
  if(source.manifest.transport||source.manifest.design_carry_preview||source.manifest.financial_carry_preview)throw Error('Acquisition requires ordinary canonical source bytes');
  return companion;
}
function downloadBounded(artifact,directory,expectedFile,maximum){
  if(!positive(artifact.size_in_bytes)||artifact.size_in_bytes>512*1024**2||artifact.expired||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest??''))throw Error('Artifact size or identity is invalid');
  mkdirSync(directory,{recursive:false});const zip=join(directory,'artifact.zip'),fd=openSync(zip,'wx');
  try{execFileSync('gh',['api',`repos/${repository}/actions/artifacts/${artifact.id}/zip`],{stdio:['ignore',fd,'pipe'],timeout:180000});}finally{closeSync(fd);}
  if(lstatSync(zip).size!==artifact.size_in_bytes)throw Error('Artifact download size changed');
  execFileSync('python3',['-c',`import sys,zipfile,stat
with zipfile.ZipFile(sys.argv[1]) as z:
 m=z.infolist();assert len(m)==1 and m[0].filename==sys.argv[2] and 0<m[0].file_size<=int(sys.argv[3]) and not stat.S_ISLNK(m[0].external_attr>>16),'Unbounded artifact member'
`,zip,expectedFile,String(maximum)],{stdio:'pipe',timeout:30000});
  return downloadArtifact(artifact,directory,repository,expectedFile);
}
function extractCanonical(archive,destination){
  execFileSync('python3',['-c',`import pathlib,tarfile,sys
with tarfile.open(sys.argv[1]) as t:
 members=t.getmembers();assert len(members)<=30000 and sum(m.size for m in members)<=2*1024**3,'Unbounded canonical archive'
 assert all(m.size<=32*1024**2 for m in members),'Oversized canonical member'
 root=pathlib.Path(sys.argv[2]);root.mkdir(exist_ok=False)
 for m in members:
  n=m.name
  while n.startswith('./'):n=n[2:]
  if n=='static-data' or n.startswith('static-data/'):t.extract(m,root,filter='data')
`,archive,destination],{stdio:'pipe',timeout:120000});
}
// The provider child never receives the GitHub token. Only a fixed, one-shot
// readiness signal is accepted; endpoint selection stays in this parent.
export function executeWithRecheck(command,args,{cwd,env,authenticate,timeout=25*60*1000}){
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(command,args,{cwd,env,stdio:['pipe','inherit','inherit','pipe']});
    let done=false,used=false,authorized=false,message='';
    const timer=setTimeout(()=>fail(Error('Bounded collection process timed out')),timeout);
    const fail=error=>{if(done)return;done=true;clearTimeout(timer);child.kill('SIGTERM');reject(error);};
    child.once('error',fail);child.stdin.on('error',fail);
    child.stdio[3].on('data',chunk=>{
      if(done)return;
      if(used){fail(Error('Repeated provider authentication request'));return;}
      message+=chunk.toString('utf8');
      if(message.length>8||!('recheck\n'.startsWith(message))){fail(Error('Invalid provider authentication request'));return;}
      if(message!=='recheck\n')return;
      used=true;
      Promise.resolve().then(authenticate).then(invocation=>{
        if(done)return;const bytes=JSON.stringify(invocation)+'\n';
        if(Buffer.byteLength(bytes)>32768)throw Error('Unbounded provider authentication response');
        authorized=true;child.stdin.end(bytes);
      }).catch(fail);
    });
    child.once('close',(code,signal)=>{if(done)return;done=true;clearTimeout(timer);
      if(!used||!authorized||code!==0||signal)reject(Error(`Bounded collection stopped (${code??signal}); partial evidence is retained`));else resolvePromise();});
  });
}

export async function run({workspace,jobStartedAt,context,api=githubApi}){
  const requestBytes=boundedFile(join(root,requestPath),16384),request=validateRequest(JSON.parse(requestBytes));
  verifyActivation(request,context);let recovery=authenticateRecovery(request,context,api);
  workspace=resolve(workspace);
  if(workspace===root||workspace.startsWith(root+sep)||root.startsWith(workspace+sep))throw Error('Acquisition workspace must be outside controller');
  for(let part=dirname(workspace);;part=dirname(part)){if(lstatSync(part).isSymbolicLink())throw Error('Linked workspace');if(part===dirname(part))break;}
  mkdirSync(workspace,{recursive:false});
  const livePublication=await preparePublicationVerifier(join(workspace,'publication-verifier'));
  const restored=join(workspace,'source');mkdirSync(restored);const zip=join(restored,'source.zip'),fd=openSync(zip,'wx');
  try{execFileSync('gh',['api',`repos/${repository}/actions/artifacts/${recovery.artifact.id}/zip`],{stdio:['ignore',fd,'pipe'],timeout:120000});}finally{closeSync(fd);}
  if(lstatSync(zip).size!==recovery.artifact.size_in_bytes||sha256(boundedFile(zip,128*1024**2))!==request.source.artifact_sha256)throw Error('Original source ZIP mismatch');
  extractSourceArchive(zip,join(restored,'files'));
  const provenance={schema_version:'financial-source-restore-v1',kind:'recovery_archive',repository,run_id:recovery.run.id,run_attempt:recovery.run.run_attempt,head_sha:recovery.run.head_sha,artifact_id:recovery.artifact.id,artifact_sha256:request.source.artifact_sha256};
  writeFileSync(join(restored,'restored.json'),JSON.stringify(provenance),{flag:'wx'});
  const load=(artifact)=>JSON.parse(boundedFile(join(downloadBounded(artifact,join(workspace,`companion-${artifact.id}`),'source.json',64*1024**2),'source.json'),64*1024**2));
  const live=await livePublication({repository,api});
  const pages=api(`repos/${repository}/actions/artifacts?per_page=100`,true);
  // Authenticate the currently selectable ordinary source, never pick a favorable older export.
  const source=chooseExport(live,pages,repository,api,load);checkPriceIdentity(request,source,pages);
  const directory=downloadBounded(source.artifact,join(workspace,'price'),'artifact.tar',2*1024**3),archive=join(directory,'artifact.tar');
  verifyArchive(source,archive);extractCanonical(archive,join(workspace,'canonical'));
  const canonical=join(workspace,'canonical/static-data'),observations=extractPriceObservations({dataRoot:canonical,manifest:source.manifest});
  assertPriceObservationBounds(observations,source.artifact.created_at);
  if(priceObservationDigest(observations)!==source.priceObservationsDigest)throw Error('Canonical price observations changed');
  const files=join(restored,'files'),s=request.source,p=request.price_source;
  if(sha256(boundedFile(join(files,'archive/manifest.json'),32*1024**2))!==s.archive_manifest_sha256)throw Error('Original archive manifest changed');
  const inputs=join(workspace,'inputs');mkdirSync(inputs);
  const result=prepareRecoveryPreflightInputs({manifestBytes:boundedFile(join(canonical,'manifest.json'),1024**2),
    indexBytes:boundedFile(join(canonical,researchPath(source.manifest)),10*1024**2),sourceBaseBytes:boundedFile(join(files,'base.json'),32*1024**2),
    sourceCohortBytes:boundedFile(join(files,'cohort.json'),1024**2),observedAt:new Date().toISOString(),
    bindings:{canonical_manifest_sha256:p.manifest_sha256,canonical_research_sha256:p.research_sha256,source_archive_manifest_sha256:s.archive_manifest_sha256,source_base_sha256:s.base_sha256,source_cohort_sha256:s.cohort_sha256}});
  const cohortBytes=Buffer.from(JSON.stringify(result.cohort));
  writeFileSync(join(inputs,'base.json'),result.baseBytes,{flag:'wx'});writeFileSync(join(inputs,'cohort.json'),cohortBytes,{flag:'wx'});writeFileSync(join(inputs,'request.json'),requestBytes,{flag:'wx'});
  // Reauthenticate immediately before bounded local preparation/provider work.
  validateRequest(request);verifyActivation(request,context);recovery=authenticateRecovery(request,context,api);
  const finalPages=api(`repos/${repository}/actions/artifacts?per_page=100`,true),finalLive=await livePublication({repository,api});
  const cachedLoad=artifact=>JSON.parse(boundedFile(join(workspace,`companion-${artifact.id}`,'source.json'),64*1024**2));
  checkPriceIdentity(request,chooseExport(finalLive,finalPages,repository,api,cachedLoad),finalPages);
  const invocation={schema_version:'financial-targeted-recovery-invocation-v1',request_sha256:sha256(requestBytes),authenticated_at:new Date().toISOString(),repository,workflow:recoveryWorkflow,event:'push',branch,
    run_id:context.id,run_attempt:1,run_number:recovery.current.run_number,head_sha:context.sha,controller_parent_sha:request.controller.parent_sha,controller_parent_tree:request.controller.parent_tree,
    source:s,price_source:p,base_sha256:sha256(result.baseBytes),cohort_sha256:sha256(cohortBytes),publication_authority:'none',financial_admission:false};
  writeFileSync(join(inputs,'invocation.json'),JSON.stringify(invocation),{flag:'wx'});
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:join(root,'backend')};
  for(const key of ['GH_TOKEN','GITHUB_TOKEN','PYTHONSTARTUP','PYTHONHOME'])delete env[key];
  await executeWithRecheck('python3',[join(root,'.github/scripts/run-statement-targeted-cycle.py'),'--inputs',inputs,'--restored',restored,'--request',join(root,requestPath),
    '--output',join(workspace,'financial-recovery'),'--job-started-at',jobStartedAt],{cwd:root,env,authenticate:async()=>{
      // Real API observations after expensive full-archive preparation. This
      // creates another authentication receipt, never a retimed execution intent.
      validateRequest(request);verifyActivation(request,context);authenticateRecovery(request,context,api);
      const readyPages=api(`repos/${repository}/actions/artifacts?per_page=100`,true),readyLive=await livePublication({repository,api});
      checkPriceIdentity(request,chooseExport(readyLive,readyPages,repository,api,cachedLoad),readyPages);
      if(sha256(boundedFile(join(inputs,'base.json'),32*1024**2))!==invocation.base_sha256
        ||sha256(boundedFile(join(inputs,'cohort.json'),1024**2))!==invocation.cohort_sha256
        ||sha256(boundedFile(join(inputs,'request.json'),16384))!==invocation.request_sha256)throw Error('Prepared authenticated input changed');
      // Slow price reads cannot make an older branch/predecessor observation look fresh.
      validateRequest(request);verifyActivation(request,context);authenticateRecovery(request,context,api);
      return {...invocation,authenticated_at:new Date().toISOString()};
    }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [workspace,jobStartedAt]=process.argv.slice(2);if(!workspace||!jobStartedAt)throw Error('Usage: run-statement-targeted-recovery.mjs NEW_WORKSPACE JOB_STARTED_AT');
  await run({workspace,jobStartedAt,context:{repository:process.env.GITHUB_REPOSITORY,event:process.env.GITHUB_EVENT_NAME,branch:process.env.GITHUB_REF_NAME,
    id:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT),sha:process.env.GITHUB_SHA}});
}
