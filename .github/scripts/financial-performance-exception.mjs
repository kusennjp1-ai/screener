// A single immutable capture may receive an explicitly recorded performance
// exception. This is separate authority; the failed Design run stays failed.
import {execFileSync} from 'node:child_process';
import {appendFileSync,closeSync,cpSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import policy from '../../contracts/financial_performance_exception_v1.json' with {type:'json'};
import releasePolicy from '../../contracts/financial_release_v1.json' with {type:'json'};
import {githubApi,sameRepository,workflowPath} from './publication-gate.mjs';
import {dataFiles,downloadArtifact,inventoryDigest,livePublication,sha256,safePath} from './publication-state.mjs';
import {contract,dataInventory,digest,verifyCorrectionChecks} from './financial-correction.mjs';

export {policy as performanceExceptionPolicy};
export const exceptionType='performance-exception-v1';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const exact=(v,keys,label)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))throw Error(`Invalid closed performance exception ${label}`);};
const equal=(a,b,label)=>{if(digest(a)!==digest(b))throw Error(`Performance exception ${label} mismatch`);};
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const write=(p,v)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(v));};
const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const repo='kusennjp1-ai/screener';
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const blob=v=>v===null||v&&Object.keys(v).sort().join(',')==='mode,sha'&&['100644','100755'].includes(v.mode)&&sha(v.sha);

export function parsePerformanceApproval(value,{activation=false,now=Date.now()}={}) {
  exact(value,['schema_version','scope','approved_at','activation_not_after','captured_ui','request_sha256','preview_receipt_sha256','projection_sha256','report_sha256','review','failures','budgets','captured_code_sha256','controller_code_sha256','controller_changes'],'approval');
  if(value.schema_version!=='financial-performance-approval-v1'||value.scope!=='one-captured-financial-repair'
    ||!stamp(value.approved_at)||!stamp(value.activation_not_after)||Date.parse(value.approved_at)>now
    ||Date.parse(value.activation_not_after)<=Date.parse(value.approved_at)
    ||Date.parse(value.activation_not_after)>Date.parse('2026-10-07T10:46:54.945Z')
    ||activation&&now>=Date.parse(value.activation_not_after))throw Error('Missing or expired exact performance approval');
  equal(value.captured_ui,policy.captured_ui,'capture');equal(value.failures,policy.failures,'unaltered failures');equal(value.budgets,policy.budgets,'unchanged budgets');
  if(!['request_sha256','preview_receipt_sha256','projection_sha256','captured_code_sha256','controller_code_sha256'].every(k=>hash(value[k]))||value.report_sha256!==policy.report_sha256)throw Error('Invalid performance approval bindings');
  exact(value.review,['path','sha256'],'review');
  if(!safePath(value.review.path)||!/^docs\/design-review\/[A-Za-z0-9.-]+\.json$/.test(value.review.path)||value.review.sha256!==policy.review_sha256)throw Error('Performance approval lacks the exact nonperformance review');
  if(!value.controller_changes||Array.isArray(value.controller_changes)||!Object.keys(value.controller_changes).length)throw Error('Missing explicit controller change inventory');
  for(const [path,change] of Object.entries(value.controller_changes)){
    exact(change,['before','after'],'controller change');
    if(!policy.controller_only_paths.includes(path)||!blob(change.before)||!blob(change.after)||change.after===null||digest(change.before)===digest(change.after))throw Error('Unapproved consumer/projector or controller change');
  }
  return value;
}
export function readPerformanceApproval(root=process.cwd(),options) {
  const path=join(root,policy.approval_path);let stat;
  try{stat=lstatSync(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('Invalid performance approval file');
  return parsePerformanceApproval(read(path),options);
}
export function verifyExceptionCode({approval,captured,current}) {
  parsePerformanceApproval(approval);
  if(digest(captured)!==approval.captured_code_sha256||digest(current)!==approval.controller_code_sha256)throw Error('Exact protected controller/capture inventory changed');
  const changed={};
  for(const path of new Set([...Object.keys(captured),...Object.keys(current)])){
    const before=captured[path]??null,after=current[path]??null;
    if(digest(before)!==digest(after))changed[path]={before,after};
  }
  equal(changed,approval.controller_changes,'enumerated controller-only changes');
  return true;
}
export function validateExceptionCandidate(record) {
  exact(record,['schema_version','producer','captured_ui','request_sha256','preview_receipt_sha256','corrected_inventory_sha256','protected_code_sha256','approval_sha256','controller_code_sha256'],'candidate');
  exact(record.producer,['repository','workflow','head_sha','run_id','run_attempt'],'producer');
  if(record.schema_version!=='financial-performance-candidate-v1'||record.producer.repository!==repo||record.producer.workflow!==policy.workflow
    ||!sha(record.producer.head_sha)||!positive(record.producer.run_id)||!positive(record.producer.run_attempt)
    ||!['request_sha256','preview_receipt_sha256','corrected_inventory_sha256','protected_code_sha256','approval_sha256','controller_code_sha256'].every(k=>hash(record[k])))throw Error('Invalid exception candidate');
  equal(record.captured_ui,policy.captured_ui,'sealed capture');return record;
}
export function parseExceptionPin(pin) {
  exact(pin,['schema_version','repository','workflow','head_sha','run_id','run_attempt','job_id','artifact_id','artifact_name','artifact_sha256','candidate_record_sha256','projection_sha256','preview_receipt_sha256','approval_sha256'],'candidate pin');
  if(pin.schema_version!=='financial-performance-candidate-pin-v1'||pin.repository!==repo||pin.workflow!==policy.workflow||!sha(pin.head_sha)
    ||!['run_id','run_attempt','job_id','artifact_id'].every(k=>positive(pin[k]))||pin.artifact_name!==`financial-performance-candidate-${pin.run_id}-${pin.run_attempt}`
    ||!['artifact_sha256','candidate_record_sha256','projection_sha256','preview_receipt_sha256','approval_sha256'].every(k=>hash(pin[k])))throw Error('Invalid exact exception pin');return pin;
}
export function parseExceptionUiApproval(value) {
  exact(value,['type','sha','ui_digest','controller_sha','approval_sha256','certificate'],'UI approval');
  parseExceptionPin(value.certificate);
  if(value.type!==exceptionType||value.sha!==policy.captured_ui.sha||value.ui_digest!==policy.captured_ui.digest
    ||value.controller_sha!==value.certificate.head_sha||value.approval_sha256!==value.certificate.approval_sha256)throw Error('Invalid exception UI identity');return value;
}
function attempt(reference,api) {
  const base=`repos/${repo}/actions/runs/${reference.run_id}`;
  return {run:api(`${base}/attempts/${reference.run_attempt}`),jobs:api(`${base}/attempts/${reference.run_attempt}/jobs?per_page=100`,true).flatMap(p=>p.jobs)};
}
function validRun(run,id,attemptId,path,head,event,conclusion){
  if(run.id!==id||run.run_attempt!==attemptId||!sameRepository(run,repo)||run.path!==path||run.head_sha!==head||run.event!==event||run.status!=='completed'||run.conclusion!==conclusion)throw Error('Exception workflow attempt identity/conclusion changed');
}
function jobIdentity(job,run,name){return {workflow:run.path,run_id:run.id,run_attempt:run.run_attempt,job_id:job.id,name,head_sha:run.head_sha};}
function passedJobs(run,jobs,names){return names.map(name=>{
  const matches=jobs.filter(j=>j.name===name&&j.run_attempt===run.run_attempt);
  if(matches.length!==1||!positive(matches[0].id)||matches[0].run_id!==run.id||matches[0].head_sha!==run.head_sha||matches[0].status!=='completed'||matches[0].conclusion!=='success')throw Error('Exception required job failed or changed');
  return jobIdentity(matches[0],run,name);
});}
export function verifyOriginalExceptionCapture(api=githubApi) {
  const ci=attempt({run_id:policy.ci_run_id,run_attempt:policy.capture_attempt},api),design=attempt({run_id:policy.design_run_id,run_attempt:policy.capture_attempt},api);
  validRun(ci.run,policy.ci_run_id,policy.capture_attempt,workflowPath('ci.yml'),policy.capture_head_sha,'pull_request','success');
  validRun(design.run,policy.design_run_id,policy.capture_attempt,workflowPath('design-acceptance.yml'),policy.capture_head_sha,'pull_request','failure');
  const checks=policy.capture_ci_jobs.map(expected=>{
    const matches=ci.jobs.filter(j=>j.name===expected.name&&j.run_attempt===policy.capture_attempt);
    if(matches.length!==1||matches[0].id!==expected.id||matches[0].run_id!==ci.run.id||matches[0].head_sha!==ci.run.head_sha||matches[0].status!=='completed'||matches[0].conclusion!==expected.conclusion)throw Error('Original PR CI job evidence changed');
    return {...jobIdentity(matches[0],ci.run,expected.name),conclusion:expected.conclusion};
  });
  const jobs=design.jobs.filter(j=>j.name==='Real-data design and performance budgets'&&j.run_attempt===policy.capture_attempt);
  if(jobs.length!==1||jobs[0].id!==policy.design_job_id||jobs[0].run_id!==design.run.id||jobs[0].head_sha!==design.run.head_sha||jobs[0].status!=='completed'||jobs[0].conclusion!=='failure')throw Error('Original failed Design job changed');
  for(const expected of policy.design_steps){const steps=(jobs[0].steps||[]).filter(step=>step.name===expected.name);if(steps.length!==1||steps[0].conclusion!==expected.conclusion)throw Error('Original Design step evidence changed');}
  if((jobs[0].steps||[]).some(step=>step.conclusion==='failure'&&!policy.design_steps.some(expected=>expected.name===step.name&&expected.conclusion==='failure')))throw Error('Original Design has a nonperformance workflow failure');
  const commit=api(`repos/${repo}/git/commits/${policy.captured_ui.sha}`);
  if(commit.sha!==policy.captured_ui.sha||commit.tree?.sha!==policy.captured_ui.tree)throw Error('Original executed capture tree changed');
  equal(commit.parents?.map(p=>p.sha),[policy.capture_base_sha,policy.capture_head_sha],'PR merge parents');
  return {ci,design,checks};
}
export function verifyExceptionCertificate(pin,api=githubApi,{artifact=false,now=Date.now()}={}) {
  parseExceptionPin(pin);const evidence=attempt(pin,api),{run,jobs}=evidence;
  validRun(run,pin.run_id,pin.run_attempt,policy.workflow,pin.head_sha,'workflow_run','success');
  if(run.head_branch!=='main')throw Error('Exception certificate must be main-only');
  const checks=passedJobs(run,jobs,[policy.job]),job=jobs.find(j=>j.id===pin.job_id);
  if(!job||checks[0].job_id!==pin.job_id)throw Error('Exception certificate job changed');
  for(const name of policy.steps){const steps=(job.steps||[]).filter(s=>s.name===name);if(steps.length!==1||steps[0].conclusion!=='success')throw Error('Exception certificate step not successful');}
  if(artifact){
    const artifacts=api(`repos/${repo}/actions/runs/${pin.run_id}/artifacts?per_page=100`,true).flatMap(p=>p.artifacts).filter(a=>a.id===pin.artifact_id||a.name===pin.artifact_name);
    if(artifacts.length!==1)throw Error('Missing or ambiguous exception certificate artifact');
    verifyExceptionArtifact(artifacts[0],pin,run,job,now);evidence.artifact=artifacts[0];
  }
  return {...evidence,checks:checks.map(c=>({...c,conclusion:'success'}))};
}
function verifyExceptionArtifact(artifact,pin,run,job,now){
  const clocks=[run.run_started_at,job.started_at,artifact.created_at,job.completed_at].map(Date.parse);
  if(artifact.id!==pin.artifact_id||artifact.name!==pin.artifact_name||artifact.digest!==`sha256:${pin.artifact_sha256}`||artifact.expired!==false
    ||artifact.workflow_run?.id!==run.id||artifact.workflow_run?.head_sha!==run.head_sha||artifact.workflow_run?.head_branch!=='main'
    ||!positive(artifact.size_in_bytes)||artifact.size_in_bytes>8589934592||clocks.some(t=>!Number.isFinite(t))||clocks.some((t,i)=>i&&t<clocks[i-1])||clocks.at(-1)>now
    ||!stamp(artifact.expires_at)||Date.parse(artifact.expires_at)<=now)throw Error('Invalid exact exception artifact');
}
export function remoteProtectedCodeInventory(revision,api=githubApi) {
  if(!sha(revision))throw Error('Invalid immutable controller revision');
  const commit=api(`repos/${repo}/git/commits/${revision}`);
  if(commit.sha!==revision||!sha(commit.tree?.sha))throw Error('Invalid immutable controller commit');
  const tree=api(`repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  if(tree.sha!==commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree))throw Error('Incomplete immutable controller tree');
  const files={},seen=new Set();
  for(const item of tree.tree){
    if(!safePath(item.path)||seen.has(item.path))throw Error('Unsafe or duplicate immutable controller path');seen.add(item.path);
    if(item.type==='tree')continue;
    if(!releasePolicy.protected_prefixes.some(prefix=>item.path.startsWith(prefix)))continue;
    if(item.type!=='blob'||!['100644','100755'].includes(item.mode)||!sha(item.sha))throw Error('Special immutable protected source');
    files[item.path]={mode:item.mode,sha:item.sha};
  }
  if(!files['frontend/package-lock.json']||!files['backend/app/scripts/export_native_annual_projection.py'])throw Error('Incomplete immutable protected source');
  return files;
}
export function verifyImmutableExceptionController(approval,revision,api=githubApi){
  return verifyExceptionCode({approval,captured:remoteProtectedCodeInventory(policy.captured_ui.sha,api),current:remoteProtectedCodeInventory(revision,api)});
}
export function verifyPerformanceUiApproval(receipt,repository=repo,api=githubApi) {
  if(repository!==repo)throw Error('Wrong exception repository');
  const ui=receipt.approval;parseExceptionUiApproval(ui);
  if(receipt.ui_sha!==ui.sha||receipt.ui_digest!==ui.ui_digest)throw Error('Exception approval cannot authorize different UI bytes');
  const content=api(`repos/${repo}/contents/${policy.approval_path}?ref=${ui.controller_sha}`);
  if(content.type!=='file'||content.encoding!=='base64'||typeof content.content!=='string'||content.size>32768)throw Error('Missing immutable exception approval');
  const bytes=Buffer.from(content.content,'base64');if(bytes.length!==content.size||sha256(bytes)!==ui.approval_sha256)throw Error('Immutable exception approval changed');
  const approval=parsePerformanceApproval(JSON.parse(bytes)); // Historical UI approval does not expire with activation/source evidence.
  verifyImmutableExceptionController(approval,ui.controller_sha,api);
  const original=verifyOriginalExceptionCapture(api),certificate=verifyExceptionCertificate(ui.certificate,api);
  const source=api(`repos/${repo}/contents/${releasePolicy.request_path}?ref=${ui.controller_sha}`);
  if(source.type!=='file'||source.encoding!=='base64'||typeof source.content!=='string'||source.size>16384)throw Error('Missing immutable exception financial request');
  const requestBytes=Buffer.from(source.content,'base64'),request=JSON.parse(requestBytes);
  if(requestBytes.length!==source.size||digest(request)!==approval.request_sha256)throw Error('Immutable exception financial request changed');
  exact(request,['schema_version','correction','source_validation','destination_projection'],'original financial request');
  if(request.schema_version!=='financial-release-request-v1')throw Error('Wrong exception financial request');
  return {approval,request,checks:[...original.checks,...certificate.checks]};
}
export function verifyExceptionFinancialScope(financial,verified){
  if(!financial||financial.ui?.approval?.type!==exceptionType)throw Error('Exception requires its financial release lineage');
  if(financial.source_projection?.sha256!==verified.approval.projection_sha256)throw Error('Exception original financial projection changed');
  equal(financial.lineage?.source,verified.request.correction.source,'original financial source');
  equal(financial.lineage?.certificate,verified.request.source_validation.certificate,'original financial certificate');
  if(financial.mode==='activation'&&financial.previous_publication_identity!==verified.request.correction.previous_publication_identity)throw Error('Exception original predecessor changed');
  return financial;
}
export function validateExceptionChecks(ui,checks) {
  parseExceptionUiApproval(ui);
  if(!Array.isArray(checks)||checks.length!==contract.required_ci_jobs.length+1)throw Error('Missing exception consumer checks');
  for(const check of checks)exact(check,['workflow','run_id','run_attempt','job_id','name','head_sha','conclusion'],'consumer check');
  for(const name of [...contract.required_ci_jobs,policy.job]){
    const matches=checks.filter(c=>c.name===name),cert=name===policy.job;
    if(matches.length!==1||!positive(matches[0].job_id)||matches[0].run_id!==(cert?ui.certificate.run_id:policy.ci_run_id)
      ||matches[0].run_attempt!==(cert?ui.certificate.run_attempt:policy.capture_attempt)||matches[0].head_sha!==(cert?ui.controller_sha:policy.capture_head_sha)
      ||matches[0].workflow!==(cert?policy.workflow:workflowPath('ci.yml'))||matches[0].conclusion!==(cert?'success':policy.capture_ci_jobs.find(j=>j.name===name).conclusion)||matches[0].job_id!==(cert?ui.certificate.job_id:policy.capture_ci_jobs.find(j=>j.name===name).id))throw Error('Exception consumer check identity changed');
  }return checks;
}
export function verifyPerformanceReview({approval,reportBytes,reviewBytes,screenshots}) {
  parsePerformanceApproval(approval,{activation:true});
  if(sha256(reportBytes)!==policy.report_sha256||sha256(reviewBytes)!==policy.review_sha256)throw Error('Exact nonperformance report/review bytes changed');
  return validatePerformanceReviewContent({report:JSON.parse(reportBytes),review:JSON.parse(reviewBytes),screenshots});
}
export function validatePerformanceReviewContent({report,review,screenshots}) {
  if(report.commit!==policy.captured_ui.sha||review.observed_commit!==report.commit||review.captured_tree!==policy.captured_ui.tree||review.report_json_sha256!==policy.report_sha256
    ||review.performance_exception_approved!==false||review.release_approved!==false||review.objective_nonperformance_failure_count!==0)throw Error('Historical review was changed or relabeled');
  equal(report.failures,policy.failures,'all original failures');equal(review.objective_failures,report.failures,'review failures');
  if(report.screens?.length!==134||review.screens?.length!==134||new Set(report.screens.map(s=>s.key)).size!==134||new Set(review.screens.map(s=>s.key)).size!==134)throw Error('Incomplete exact screenshot coverage');
  for(const screen of report.screens){
    const rated=review.screens.find(s=>s.key===screen.key);
    if(!rated||rated.screenshot!==screen.screenshot||!safePath(screen.screenshot)||!hash(rated.sha256)||screenshots[screen.screenshot]!==rated.sha256)throw Error('Reviewed screenshot bytes changed');
    for(const key of ['design','usability','originality','content'])if(typeof rated.scores?.[key]?.value!=='number'||rated.scores[key].value<8||rated.scores[key].value>10||!rated.scores[key].reason)throw Error('Nonperformance review score failed');
    for(const key of ['smallTargets','fontIssues','radiusIssues','asciiNegativeValues'])if(!Array.isArray(screen.metrics?.[key])||screen.metrics[key].length)throw Error('Objective nonperformance finding remains');
    if(screen.metrics.horizontalOverflow!==false||!Array.isArray(screen.axe)||screen.axe.length)throw Error('Objective nonperformance finding remains');
  }
  return {report_sha256:policy.report_sha256,review_sha256:policy.review_sha256,screenshots_sha256:digest(screenshots),failure_count:report.failures.length};
}

export function readExceptionPin(root=process.cwd()) {
  const path=join(root,policy.pin_path);let stat;try{stat=lstatSync(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('Invalid exception pin file');
  return parseExceptionPin(read(path));
}
export function readExceptionReleaseIntent(root=process.cwd()) {
  const path=join(root,policy.release_intent_path);let stat;try{stat=lstatSync(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('Invalid exception release intent file');
  const value=read(path);exact(value,['schema_version','approval_sha256','candidate_record_sha256','previous_publication_identity'],'release intent');
  if(value.schema_version!=='financial-performance-release-intent-v1'||!hash(value.approval_sha256)||!hash(value.candidate_record_sha256)
    ||!/^\d+\/\d+\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(value.previous_publication_identity))throw Error('Invalid exact exception release intent');return value;
}
function assertCurrent(root,api=githubApi){
  const revision=git(root,['rev-parse','HEAD']);
  if(api(`repos/${repo}/git/ref/heads/main`).object.sha!==revision)throw Error('Exception controller is no longer current main');
  return revision;
}
function downloadZip(reference,path){
  if(!existsSync(path)){
    mkdirSync(dirname(path),{recursive:true});const fd=openSync(path,'wx');
    try{execFileSync('gh',['api',`repos/${repo}/actions/artifacts/${reference.id}/zip`],{stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
  }
  if(execFileSync('sha256sum',[path],{encoding:'utf8'}).split(' ')[0]!==reference.sha256)throw Error('Immutable exception input ZIP changed');
}
export function verifyRetainedDesignArchive(path){
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0||stat.size>8589934592
    ||execFileSync('sha256sum',[path],{encoding:'utf8'}).split(' ')[0]!==policy.design_artifact.sha256)throw Error('Retained original Design ZIP changed');
}
function captureArtifacts(original,api=githubApi){
  const artifacts=api(`repos/${repo}/actions/runs/${policy.design_run_id}/artifacts?per_page=100`,true).flatMap(p=>p.artifacts);
  const job=original.design.jobs.find(j=>j.id===policy.design_job_id);
  for(const expected of [policy.diagnostic,policy.design_artifact]){
    const matches=artifacts.filter(a=>a.id===expected.id||a.name===expected.name),a=matches[0];
    if(matches.length!==1||a.id!==expected.id||a.name!==expected.name||a.digest!==`sha256:${expected.sha256}`||a.expired!==false||!positive(a.size_in_bytes)||a.size_in_bytes>8589934592
      ||expected.bytes&&a.size_in_bytes!==expected.bytes||a.workflow_run?.id!==policy.design_run_id||a.workflow_run?.head_sha!==policy.capture_head_sha
      ||![a.created_at,a.expires_at,job.started_at,job.completed_at].every(stamp)||Date.parse(a.expires_at)<=Date.now()
      ||Date.parse(a.created_at)<Date.parse(job.started_at)||Date.parse(a.created_at)>Date.parse(job.completed_at))throw Error('Exact original PR diagnostic evidence is unavailable');
  }
}
export async function prepareExceptionCertification(root=process.cwd(),api=githubApi){
  const started=performance.now(),phase=name=>console.log(JSON.stringify({phase:name,elapsed_ms:Math.round(performance.now()-started)}));
  const approval=readPerformanceApproval(root);
  if(!approval){
    if(readExceptionPin(root)||readExceptionReleaseIntent(root))throw Error('Exception controls have no approval');if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'candidate=false\n');return null;}
  const revision=assertCurrent(root,api),event=read(process.env.GITHUB_EVENT_PATH);
  if(process.env.GITHUB_SHA!==revision)throw Error('Certifier workflow head differs from the current checkout');
  if(process.env.GITHUB_EVENT_NAME!=='workflow_run'||!sameRepository(event.workflow_run,repo)||event.workflow_run.head_sha!==revision||event.workflow_run.path!==workflowPath('ci.yml')
    ||event.workflow_run.head_branch!=='main'||event.workflow_run.event!=='push'||event.workflow_run.status!=='completed'||event.workflow_run.conclusion!=='success')throw Error('Exception certification needs exact current-main successful CI completion');
  const checks=verifyCorrectionChecks(repo,revision,api);
  if(checks.some(c=>c.run_id!==event.workflow_run.id||c.run_attempt!==event.workflow_run.run_attempt))throw Error('Stale CI completion cannot certify an exception');
  const approvalBytes=readFileSync(join(root,policy.approval_path)),pin=readExceptionPin(root);
  if(pin){if(pin.approval_sha256!==sha256(approvalBytes))throw Error('Existing exception pin belongs to a different approval');if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'candidate=false\n');return null;}
  parsePerformanceApproval(approval,{activation:true});
  const {protectedCodeInventory,readFinancialReleaseRequest}=await import('./financial-release-activation.mjs');
  verifyExceptionCode({approval,captured:protectedCodeInventory(root,policy.captured_ui.sha),current:protectedCodeInventory(root,revision)});
  const prior=api(`repos/${repo}/actions/workflows/financial-performance-certification.yml/runs?branch=main&head_sha=${revision}&per_page=100`,true).flatMap(p=>p.workflow_runs);
  if(prior.some(r=>sameRepository(r,repo)&&r.head_sha===revision&&r.path===policy.workflow&&r.head_branch==='main'&&r.event==='workflow_run'&&r.status==='completed'&&r.conclusion==='success')){
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'candidate=false\n');return null;
  }
  const original=verifyOriginalExceptionCapture(api);captureArtifacts(original,api);
  const request=readFinancialReleaseRequest(root);
  if(!request||digest(request)!==approval.request_sha256)throw Error('Exception release request changed');
  const live=await livePublication({api});
  if(live.identity!==request.correction.previous_publication_identity)throw Error('Exception predecessor was superseded');
  const out=join(process.env.RUNNER_TEMP||'/tmp','financial-performance-certification'),candidate=join(out,'candidate'),inputs=join(out,'inputs');
  if(existsSync(out))throw Error('Exception certification scratch must be new');mkdirSync(inputs,{recursive:true});
  phase('download original diagnostic and Design evidence');
  for(const [name,reference]of [['diagnostic',policy.diagnostic],['design',policy.design_artifact]])downloadZip(reference,join(inputs,`${name}.zip`));
  phase('verify and extract immutable diagnostic');
  const extractor=join(root,'.github/scripts/restore-financial-diagnostic.py');
  execFileSync('python3',[extractor,'diagnostic',join(inputs,'diagnostic.zip'),candidate],{stdio:'pipe'});
  execFileSync('python3',[extractor,'design',join(inputs,'design.zip'),join(candidate,'design-evidence')],{stdio:'pipe'});
  cpSync(join(inputs,'design.zip'),join(candidate,'design-evidence/original-design-artifact.zip'));
  verifyRetainedDesignArchive(join(candidate,'design-evidence/original-design-artifact.zip'));
  const metadata=read(join(candidate,'diagnostic-metadata.json'));
  equal(metadata.captured_ui,policy.captured_ui,'diagnostic capture');
  equal(metadata.producer,{repository:repo,head_sha:policy.captured_ui.sha,run_id:String(policy.design_run_id),run_attempt:String(policy.capture_attempt)},'diagnostic executed producer');
  if(metadata.workflow!==workflowPath('design-acceptance.yml')||metadata.design_status!=='failure'||metadata.preview_receipt_sha256!==approval.preview_receipt_sha256||metadata.projection_sha256!==approval.projection_sha256)throw Error('Original diagnostic metadata changed');
  if(sha256(readFileSync(join(candidate,'design-evidence/design-input-provenance.json')))!==approval.preview_receipt_sha256)throw Error('Design measured different financial input');
  cpSync(join(root,approval.review.path),join(candidate,'review.json'));
  const review=verifyPerformanceReview({approval,reportBytes:readFileSync(join(candidate,'design-evidence/report.json')),reviewBytes:readFileSync(join(candidate,'review.json')),screenshots:read(join(candidate,'design-evidence/screenshots.json'))});
  writeFileSync(join(candidate,'performance-approval.json'),approvalBytes);write(join(candidate,'controller-code.json'),protectedCodeInventory(root,revision));write(join(candidate,'nonperformance-verification.json'),review);
  equal(read(join(candidate,'release-request.json')),request,'original request');
  phase('original report and all screenshot hashes verified');
  const capturedRoot=join(out,'captured-source');
  execFileSync('git',['clone','--shared','--no-checkout',root,capturedRoot],{stdio:'pipe'});git(capturedRoot,['checkout','--detach',policy.captured_ui.sha]);
  if(git(capturedRoot,['rev-parse','HEAD^{tree}'])!==policy.captured_ui.tree)throw Error('Captured checkout tree changed');
  const evidence=read(join(candidate,'evidence.json'));
  for(const [directory,reference]of [['original-source',request.correction.source],['original-certification',request.source_validation.certificate]]){
    downloadZip({id:reference.artifact_id,sha256:reference.artifact_sha256},join(candidate,directory,directory==='original-source'?'source.zip':'artifact.zip'));
  }
  const predecessorArtifact=evidence.predecessor_artifact;
  downloadArtifact(predecessorArtifact,join(candidate,'original-predecessor'),repo);
  const {extractCandidateTar}=await import('./financial-release-activation.mjs');
  extractCandidateTar(join(candidate,'original-predecessor/artifact.tar'),join(candidate,'predecessor'));rmSync(join(candidate,'original-predecessor/artifact.tar'));
  const preview=read(join(candidate,'preview-receipt.json')),frontend=join(capturedRoot,'frontend'),publicRoot=join(frontend,'public');
  rmSync(join(publicRoot,'static-data'),{recursive:true,force:true});mkdirSync(publicRoot,{recursive:true});
  cpSync(join(candidate,'predecessor/static-data'),join(publicRoot,'static-data'),{recursive:true});
  for(const file of dataFiles)cpSync(join(candidate,'predecessor',file),join(publicRoot,file));
  phase('reconstruct exact original baseline');
  execFileSync(process.execPath,['tools/export-research.mjs'],{cwd:frontend,stdio:'pipe',env:{...process.env,FINANCIAL_EVALUATED_AT:preview.financial.evaluated_at}});
  const baseline=join(candidate,'baseline');mkdirSync(baseline);renameSync(join(publicRoot,'static-data'),join(baseline,'static-data'));
  for(const file of dataFiles)renameSync(join(publicRoot,file),join(baseline,file));
  if(inventoryDigest(dataInventory(baseline))!==preview.bundles.baseline_data_sha256)throw Error('Reconstructed original baseline changed');
  write(join(out,'state.json'),{candidate,capturedRoot,request,controllerSha:revision,checks,approval_sha256:sha256(approvalBytes),live});
  rmSync(inputs,{recursive:true,force:true});
  phase('baseline hash and original inputs verified');
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`candidate=true\npath=${out}\n`);
  return {candidate,capturedRoot};
}
export async function sealExceptionCertification(root=process.cwd(),api=githubApi){
  const started=performance.now(),phase=name=>console.log(JSON.stringify({phase:name,elapsed_ms:Math.round(performance.now()-started)}));
  const out=join(process.env.RUNNER_TEMP||'/tmp','financial-performance-certification'),state=read(join(out,'state.json')),candidate=state.candidate;
  if(assertCurrent(root,api)!==state.controllerSha)throw Error('Certification controller changed');
  const approval=readPerformanceApproval(root,{activation:true});
  if(sha256(readFileSync(join(root,policy.approval_path)))!==state.approval_sha256)throw Error('Certification approval changed');
  equal(verifyCorrectionChecks(repo,state.controllerSha,api),state.checks,'controller CI');
  const {completeInventory,protectedCodeInventory,verifyCandidatePayload}=await import('./financial-release-activation.mjs');
  verifyExceptionCode({approval,captured:protectedCodeInventory(root,policy.captured_ui.sha),current:protectedCodeInventory(root,state.controllerSha)});
  const live=await livePublication({api});if(live.identity!==state.live.identity)throw Error('Certification predecessor changed');
  verifyOriginalExceptionCapture(api);
  const record=validateExceptionCandidate({schema_version:'financial-performance-candidate-v1',producer:{repository:repo,workflow:policy.workflow,head_sha:state.controllerSha,run_id:Number(process.env.GITHUB_RUN_ID),run_attempt:Number(process.env.GITHUB_RUN_ATTEMPT)},
    captured_ui:policy.captured_ui,request_sha256:approval.request_sha256,preview_receipt_sha256:approval.preview_receipt_sha256,
    corrected_inventory_sha256:inventoryDigest(completeInventory(join(candidate,'corrected'))),protected_code_sha256:approval.captured_code_sha256,
    approval_sha256:state.approval_sha256,controller_code_sha256:approval.controller_code_sha256});
  verifyRetainedDesignArchive(join(candidate,'design-evidence/original-design-artifact.zip'));
  phase('recheck complete financial, predecessor, expiry and price proofs');
  const checked=await verifyCandidatePayload({candidate,request:state.request,record},live,state.capturedRoot,api);
  if(checked.receipt.financial.projection_sha256!==approval.projection_sha256)throw Error('Exception projection changed');
  phase('financial proofs passed; preserve exact tested bytes');
  write(join(candidate,'candidate.json'),record);
  const members=['candidate.json','release-request.json','protected-code.json','preview-receipt.json','verification.json','request.json','evidence.json','target-base.json','projection','corrected','baseline','original-source','original-certification','original-predecessor','performance-approval.json','controller-code.json','diagnostic-metadata.json','design-evidence','review.json','nonperformance-verification.json'];
  for(const member of members){const path=join(candidate,member),stat=lstatSync(path);if(stat.isDirectory())completeInventory(path);else if(!stat.isFile()||stat.isSymbolicLink())throw Error('Special exception audit file');}
  phase('archive certified candidate');
  execFileSync('tar',['-cf',join(out,'candidate.tar'),'-C',candidate,...members],{stdio:'pipe'});
  phase('artifact ready; no publication performed');
  return record;
}
export async function selectExceptionActivation({live,request,mainSha,root=process.cwd(),api=githubApi,directory=join(process.env.RUNNER_TEMP||'/tmp','verified-publication/exception')}){
  const approval=readPerformanceApproval(root,{activation:true}),pin=readExceptionPin(root),intent=readExceptionReleaseIntent(root);
  if(!releasePolicy.activation_enabled)throw Error('Financial activation is disabled');
  if(!approval||!pin||!intent)throw Error('Exact exception activation is not enabled');
  const approvalBytes=readFileSync(join(root,policy.approval_path));
  if(pin.approval_sha256!==sha256(approvalBytes)||intent.approval_sha256!==pin.approval_sha256||intent.candidate_record_sha256!==pin.candidate_record_sha256
    ||intent.previous_publication_identity!==live.identity||request.correction.previous_publication_identity!==live.identity||digest(request)!==approval.request_sha256)throw Error('Exception activation intent changed or predecessor superseded');
  const {protectedCodeInventory,extractCandidateTar}=await import('./financial-release-activation.mjs');
  verifyExceptionCode({approval,captured:protectedCodeInventory(root,policy.captured_ui.sha),current:protectedCodeInventory(root,mainSha)});
  const authority=verifyExceptionCertificate(pin,api,{artifact:true});
  downloadArtifact(authority.artifact,directory,repo,'candidate.tar',8589934592);
  const candidate=join(directory,'files');if(existsSync(candidate))throw Error('Exception activation output exists');extractCandidateTar(join(directory,'candidate.tar'),candidate);
  const recordBytes=readFileSync(join(candidate,'candidate.json')),record=validateExceptionCandidate(JSON.parse(recordBytes));
  if(sha256(recordBytes)!==pin.candidate_record_sha256||record.approval_sha256!==pin.approval_sha256||record.preview_receipt_sha256!==pin.preview_receipt_sha256||pin.projection_sha256!==approval.projection_sha256)throw Error('Exception candidate pin changed');
  equal(record.producer,{repository:repo,workflow:policy.workflow,head_sha:pin.head_sha,run_id:pin.run_id,run_attempt:pin.run_attempt},'certificate producer');
  const uiApproval={type:exceptionType,sha:policy.captured_ui.sha,ui_digest:policy.captured_ui.digest,controller_sha:pin.head_sha,approval_sha256:pin.approval_sha256,certificate:pin};
  const consumer=verifyPerformanceUiApproval({ui_sha:policy.captured_ui.sha,ui_digest:policy.captured_ui.digest,approval:uiApproval},repo,api);
  const capturedRoot=join(directory,'captured-source');execFileSync('git',['clone','--shared','--no-checkout',root,capturedRoot],{stdio:'pipe'});git(capturedRoot,['checkout','--detach',policy.captured_ui.sha]);
  const reference={repository:repo,workflow:policy.workflow,head_sha:pin.head_sha,run_id:pin.run_id,run_attempt:pin.run_attempt,job_id:pin.job_id,artifact_id:pin.artifact_id,artifact_name:pin.artifact_name,artifact_sha256:pin.artifact_sha256,candidate_receipt_sha256:pin.preview_receipt_sha256,record_sha256:pin.candidate_record_sha256};
  const state={candidate,capturedRoot,reference,record,checks:verifyCorrectionChecks(repo,mainSha,api),consumerChecks:consumer.checks,request,pin,mainSha,approval:uiApproval,exception:true};
  await verifyExceptionActivation(state,live,root,api);return state;
}
export async function verifyExceptionActivation(state,live,root=process.cwd(),api=githubApi){
  const approval=readPerformanceApproval(root,{activation:true}),pin=readExceptionPin(root),intent=readExceptionReleaseIntent(root);
  if(!releasePolicy.activation_enabled)throw Error('Financial activation is disabled');
  if(!approval||!pin||!intent||intent.previous_publication_identity!==live.identity||intent.approval_sha256!==state.pin.approval_sha256||intent.candidate_record_sha256!==state.pin.candidate_record_sha256)throw Error('Exception activation intent changed');
  equal(pin,state.pin,'active pin');equal(read(join(state.candidate,'candidate.json')),state.record,'sealed record');
  const bytes=readFileSync(join(root,policy.approval_path));
  if(sha256(bytes)!==state.pin.approval_sha256||sha256(readFileSync(join(state.candidate,'performance-approval.json')))!==state.pin.approval_sha256)throw Error('Exception approval bytes changed');
  const {protectedCodeInventory,verifyCandidatePayload}=await import('./financial-release-activation.mjs');
  verifyExceptionCode({approval,captured:protectedCodeInventory(root,policy.captured_ui.sha),current:protectedCodeInventory(root,state.mainSha)});
  const sealedController=protectedCodeInventory(root,state.pin.head_sha);
  equal(read(join(state.candidate,'controller-code.json')),sealedController,'sealed controller code');
  verifyExceptionCode({approval,captured:protectedCodeInventory(root,policy.captured_ui.sha),current:sealedController});
  if(state.record.controller_code_sha256!==approval.controller_code_sha256||state.record.protected_code_sha256!==approval.captured_code_sha256)throw Error('Exception code seal changed');
  verifyExceptionCertificate(pin,api,{artifact:true});
  equal(verifyCorrectionChecks(repo,state.mainSha,api),state.checks,'activation controller checks');
  const consumer=verifyPerformanceUiApproval({ui_sha:policy.captured_ui.sha,ui_digest:policy.captured_ui.digest,approval:state.approval},repo,api);
  equal(consumer.checks,state.consumerChecks,'activation consumer checks');
  verifyRetainedDesignArchive(join(state.candidate,'design-evidence/original-design-artifact.zip'));
  verifyPerformanceReview({approval,reportBytes:readFileSync(join(state.candidate,'design-evidence/report.json')),reviewBytes:readFileSync(join(state.candidate,'review.json')),screenshots:read(join(state.candidate,'design-evidence/screenshots.json'))});
  return verifyCandidatePayload(state,live,state.capturedRoot,api);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let completed=false;process.once('beforeExit',()=>{if(!completed){console.error('Performance certification did not complete');process.exitCode=1;}});
  const command=process.argv[2];
  Promise.resolve().then(()=>command==='prepare'?prepareExceptionCertification():command==='seal'?sealExceptionCertification():Promise.reject(Error('Expected prepare or seal')))
    .then(()=>{completed=true;},error=>{completed=true;console.error(error.stack||error);process.exitCode=1;});
}
