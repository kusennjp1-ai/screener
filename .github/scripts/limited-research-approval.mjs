import {remoteProtectedCodeInventory} from './financial-performance-exception.mjs';
// Versioned UI-only authority. Financial source authority is never granted here.
import {createHash} from 'node:crypto';
import {parseLimitedDocument,validateLimitedApproval,verifyLimitedEvidence,LIMITED_SCOPE} from './limited-research-preview.mjs';
import contract from '../../contracts/financial_correction_v1.json' with {type:'json'};
export const LIMITED_APPROVAL_PATH='.github/limited-research-preview/approval.json';
export const LIMITED_WORKFLOW='.github/workflows/limited-research-assessment.yml';
export const LIMITED_JOB='Limited research preview assessment';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function closed(v,keys,label){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.slice().sort().join('|'))throw Error(`Invalid closed limited ${label}`);}
export const isLimitedPreviewApproval=v=>v?.type===LIMITED_SCOPE;
export function parseLimitedPreviewUiApproval(v){
  closed(v,['type','sha','ui_digest','controller_sha','approval_sha256','approval_path','financial','checks'],'UI approval');
  if(!isLimitedPreviewApproval(v)||!sha(v.sha)||!sha(v.controller_sha)||!hash(v.ui_digest)||!hash(v.approval_sha256)||v.approval_path!==LIMITED_APPROVAL_PATH)throw Error('Invalid limited UI authority');
  const f=v.financial;
  closed(f,['previous_publication_identity','lineage_sha256','financial_generation','evaluated_at','source_projection','source_base','evaluation_sha256','price_input'],'frozen financial scope');
  if(!/^[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(f.previous_publication_identity)||!['lineage_sha256','financial_generation','evaluation_sha256'].every(k=>hash(f[k]))||!Number.isFinite(Date.parse(f.evaluated_at)))throw Error('Invalid frozen financial identity');
  for(const [key,kind] of [['source_projection','source-projection'],['source_base','source-base']]){closed(f[key],['path','sha256'],key);if(!hash(f[key].sha256)||f[key].path!==`static-data/financial-corrections/${kind}-${f[key].sha256}.json`)throw Error('Invalid frozen source asset');}
  closed(f.price_input,['artifact_id','artifact_sha256','manifest_sha256','price_observations_sha256','known_price_dates_sha256'],'frozen price');
  if(!positive(f.price_input.artifact_id)||Object.entries(f.price_input).some(([k,v])=>k!=='artifact_id'&&!hash(v)))throw Error('Invalid frozen price binding');
  validateLimitedPreviewChecks(v,v.checks);return v;
}
export function validateLimitedPreviewChecks(ui,checks){
  if(!Array.isArray(checks)||checks.length!==contract.required_ci_jobs.length+1)throw Error('Missing limited consumer checks');
  for(const check of checks)closed(check,['workflow','run_id','run_attempt','job_id','name','head_sha','conclusion'],'check');
  for(const name of [...contract.required_ci_jobs,LIMITED_JOB]){
    const matches=checks.filter(c=>c.name===name),c=matches[0];
    if(matches.length!==1||!['run_id','run_attempt','job_id'].every(k=>positive(c[k]))||c.head_sha!==ui.sha||c.conclusion!=='success'||c.workflow!==(name===LIMITED_JOB?LIMITED_WORKFLOW:'.github/workflows/ci.yml'))throw Error('Invalid limited consumer check');
  }
  if(ui.checks&&!equal(ui.checks,checks))throw Error('Limited check binding changed');return checks;
}
export function frozenFinancial(live){const f=live.financialRelease;if(!f)throw Error('Limited preview requires existing admitted financial lineage');return {previous_publication_identity:live.identity,lineage_sha256:f.lineage_sha256,financial_generation:f.financial_generation,evaluated_at:f.evaluated_at,source_projection:f.source_projection,source_base:f.source_base,evaluation_sha256:f.evaluation_projection.sha256,price_input:f.price_input};}
export function verifyLimitedPreviewFinancialScope(receipt,approval){
  parseLimitedPreviewUiApproval(approval);const f=approval.financial;
  if(receipt.mode!=='carry'||receipt.candidate!==null||receipt.ui.approved_sha!==approval.sha||receipt.ui.captured_sha!==approval.sha||receipt.ui.digest!==approval.ui_digest||!equal(receipt.ui.approval,approval))throw Error('Limited approval only authorizes its exact frozen UI carry');
  for(const key of ['previous_publication_identity','lineage_sha256','financial_generation','evaluated_at','source_projection','source_base','price_input'])if(!equal(receipt[key],f[key]))throw Error(`Limited frozen ${key} changed`);
  if(receipt.evaluation_projection.sha256!==f.evaluation_sha256)throw Error('Limited evaluation changed');return receipt;
}
export function parseLimitedReleaseControl(bytes,{activation=false,now=Date.now()}={}){
  const c=parseLimitedDocument(bytes);closed(c,['schema_version','approval','capture','financial','assessment','review','screenshots','notice'],'release control');
  if(c.schema_version!=='limited-research-release-control-v1')throw Error('Unknown limited control');
  // Expiration limits new activation only; accepted deployments remain auditable.
  validateLimitedApproval(c.approval,activation?now:Date.parse(c.approval.owner_acceptance?.accepted_at));
  if(c.approval.status!=='approved')throw Error('Explicit accepted limited scope required');
  closed(c.capture,['run_id','run_attempt','job_id','artifact_id','artifact_name','artifact_sha256','capture_sha256'],'capture pin');
  if(!['run_id','run_attempt','job_id','artifact_id'].every(k=>positive(c.capture[k]))||!hash(c.capture.artifact_sha256)||!hash(c.capture.capture_sha256)||c.capture.artifact_name!==`limited-research-preview-${c.capture.run_id}-${c.capture.run_attempt}`||c.capture.run_id!==c.approval.evidence.assessment_run.id||c.capture.run_attempt!==c.approval.evidence.assessment_run.attempt)throw Error('Invalid exact limited capture');
  return c;
}
export function verifyLimitedControlEvidence(control,assessmentBytes){
  return verifyLimitedEvidence(control.approval,{assessmentBytes,reviewBytes:control.review,screenshotsBytes:control.screenshots,noticeBytes:control.notice},Date.parse(control.approval.owner_acceptance.accepted_at));
}
export function immutableFile(api,repository,path,revision,max=262144){
  const file=api(`repos/${repository}/contents/${path}?ref=${revision}`);
  if(file.type!=='file'||file.encoding!=='base64'||!Number.isSafeInteger(file.size)||file.size<=0||file.size>max||typeof file.content!=='string')throw Error('Missing immutable limited control');
  const bytes=Buffer.from(file.content,'base64');if(bytes.length!==file.size)throw Error('Immutable limited control size changed');return bytes;
}
export function verifyLimitedRuns(control,repository,api,{artifact=false,now=Date.now()}={}){
  const checks=[];let selected;
  for(const [file,ref,names,event] of [['.github/workflows/ci.yml',control.approval.evidence.ci,contract.required_ci_jobs,'push'],[LIMITED_WORKFLOW,control.approval.evidence.assessment_run,[LIMITED_JOB],'workflow_dispatch']]){
    const run=api(`repos/${repository}/actions/runs/${ref.id}/attempts/${ref.attempt}`);
    if(run.id!==ref.id||run.run_attempt!==ref.attempt||run.repository?.full_name!==repository||run.head_repository?.full_name!==repository||run.path!==file||run.head_sha!==control.approval.ui.sha||run.head_branch!=='main'||run.event!==event||run.status!=='completed'||run.conclusion!=='success')throw Error('Exact limited evidence attempt is not successful');
    const jobs=api(`repos/${repository}/actions/runs/${ref.id}/attempts/${ref.attempt}/jobs?per_page=100`,true).flatMap(p=>p.jobs);
    for(const name of names){const matches=jobs.filter(j=>j.name===name&&j.run_attempt===ref.attempt);const j=matches[0];if(matches.length!==1||!positive(j.id)||j.run_id!==ref.id||j.head_sha!==run.head_sha||j.status!=='completed'||j.conclusion!=='success'||![j.started_at,j.completed_at].every(t=>typeof t==='string'&&Number.isFinite(Date.parse(t)))||Date.parse(j.started_at)>Date.parse(j.completed_at)||Date.parse(j.completed_at)>now)throw Error('Missing successful limited consumer job');checks.push({workflow:file,run_id:ref.id,run_attempt:ref.attempt,job_id:j.id,name,head_sha:run.head_sha,conclusion:'success'});if(name===LIMITED_JOB){if(j.id!==control.capture.job_id)throw Error('Limited assessment job changed');selected={run,job:j};}}
  }
  if(artifact){
    const a=api(`repos/${repository}/actions/artifacts/${control.capture.artifact_id}`),{run,job}=selected;
    if(a.id!==control.capture.artifact_id||a.name!==control.capture.artifact_name||a.digest!==`sha256:${control.capture.artifact_sha256}`||a.expired!==false||a.workflow_run?.id!==run.id||a.workflow_run?.head_sha!==run.head_sha||a.workflow_run?.head_branch!=='main'||!positive(a.size_in_bytes)||a.size_in_bytes>2147483648||!Number.isFinite(Date.parse(a.created_at))||!Number.isFinite(Date.parse(job.started_at))||!Number.isFinite(Date.parse(job.completed_at))||Date.parse(a.created_at)<Date.parse(job.started_at)||Date.parse(a.created_at)>Date.parse(job.completed_at)||!Number.isFinite(Date.parse(a.expires_at))||Date.parse(a.expires_at)<=now)throw Error('Invalid or expired limited capture artifact');selected.artifact=a;
  }
  return {checks,...selected};
}

export function verifyLimitedPreviewUiApproval(receipt,repository,api){
  const ui=parseLimitedPreviewUiApproval(receipt.approval);
  if(ui.sha!==receipt.ui_sha||ui.ui_digest!==receipt.ui_digest)throw Error('Limited UI bytes differ');
  const bytes=immutableFile(api,repository,ui.approval_path,ui.controller_sha);
  if(digest(bytes)!==ui.approval_sha256)throw Error('Immutable limited approval changed');
  const control=parseLimitedReleaseControl(bytes);
  if(control.approval.ui.sha!==ui.sha||control.approval.ui.inventory_sha256!==ui.ui_digest||!equal(control.financial,ui.financial))throw Error('Limited frozen approval binding changed');
  verifyLimitedControlEvidence(control,control.assessment);
  if(!equal(remoteProtectedCodeInventory(control.approval.controller_sha,api),remoteProtectedCodeInventory(ui.controller_sha,api))||!equal(remoteProtectedCodeInventory(ui.sha,api),remoteProtectedCodeInventory(ui.controller_sha,api)))throw Error('Limited controller protected code changed since capture');
  const verified=verifyLimitedRuns(control,repository,api);
  if(!equal(verified.checks,ui.checks))throw Error('Limited immutable jobs changed');
  return {control,checks:verified.checks};
}
