// Closed, independent authorities. The original policy remains immutable; an
// unbound packed policy cannot certify, activate, or authorize a receipt.
import legacy from '../../contracts/financial_performance_exception_v1.json' with {type:'json'};
import packed from '../../contracts/financial_performance_exception_v2.json' with {type:'json'};
import {createHash} from 'node:crypto';

export const exceptionType='performance-exception-v1';
export const packedExceptionType='performance-exception-v2';
export const packedExceptionCandidateSchema='financial-performance-candidate-v2';
export const exceptionVersions=[1,2];
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const exact=(v,keys,label)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))throw Error(`Invalid closed packed exception ${label}`);};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const captureKeys=['captured_ui','capture_head_sha','capture_base_sha','ci_run_id','design_run_id','design_job_id','capture_attempt','diagnostic','design_artifact','report_sha256','review_sha256','failures','budgets','capture_ci_jobs','design_steps','activation_not_after','screenshot_keys','transport_sha256'];
const timingFailure=/^(?:1440|390): (?:Q1 candidate median \d+(?:\.\d+)?ms > 4200ms|Q1 method switch \d+(?:\.\d+)?ms > 480ms|P1 exact limits not met \(3500ms \/ 400ms \/ 200ms\)|D9 first paint opportunity \d+(?:\.\d+)?ms > 50ms|D9 run [123]: first frame \d+(?:\.\d+)?ms \(limit 50ms\))$/;

export function validatePackedExceptionPolicy(value) {
  exact(value,['schema_version','enabled','capture'],'policy');
  if(value.schema_version!=='financial-performance-exception-policy-v2'||typeof value.enabled!=='boolean')throw Error('Unknown packed exception policy');
  if(!value.enabled){if(value.capture!==null)throw Error('Disabled packed exception cannot retain an active capture');return value;}
  const p=value.capture;exact(p,captureKeys,'capture');exact(p.captured_ui,['sha','tree','digest'],'captured UI');
  if(!sha(p.captured_ui.sha)||p.captured_ui.sha===legacy.captured_ui.sha||!sha(p.captured_ui.tree)||!hash(p.captured_ui.digest)||!sha(p.capture_head_sha)||!sha(p.capture_base_sha)
    ||!['ci_run_id','design_run_id','design_job_id','capture_attempt'].every(k=>positive(p[k]))
    ||!['report_sha256','review_sha256','transport_sha256'].every(k=>hash(p[k]))||!Number.isFinite(Date.parse(p.activation_not_after)))throw Error('Incomplete packed exception capture');
  exact(p.diagnostic,['id','name','sha256','bytes'],'diagnostic');exact(p.design_artifact,['id','name','sha256'],'Design artifact');
  if(!positive(p.diagnostic.id)||!positive(p.diagnostic.bytes)||p.diagnostic.bytes>8589934592||!hash(p.diagnostic.sha256)
    ||p.diagnostic.name!==`unapproved-financial-diagnostic-${p.design_run_id}-${p.capture_attempt}`||!positive(p.design_artifact.id)||!hash(p.design_artifact.sha256)
    ||p.design_artifact.name!==`design-acceptance-${p.captured_ui.sha}`)throw Error('Unbound packed exception artifacts');
  exact(p.budgets,Object.keys(legacy.budgets),'budgets');
  if(Object.keys(legacy.budgets).some(k=>p.budgets[k]!==legacy.budgets[k]))throw Error('Packed exception cannot change strict budgets');
  if(!Array.isArray(p.failures)||!p.failures.length||new Set(p.failures).size!==p.failures.length||p.failures.some(f=>!timingFailure.test(f)))throw Error('Packed exception contains a nonperformance or incomplete-measurement failure');
  if(!Array.isArray(p.screenshot_keys)||!p.screenshot_keys.length||p.screenshot_keys.some(k=>typeof k!=='string'||!k)||new Set(p.screenshot_keys).size!==p.screenshot_keys.length)throw Error('Missing exact packed screenshot coverage');
  if(!Array.isArray(p.capture_ci_jobs)||p.capture_ci_jobs.length!==legacy.capture_ci_jobs.length)throw Error('Incomplete packed capture CI');
  for(const expected of legacy.capture_ci_jobs){
    const matches=p.capture_ci_jobs.filter(j=>j.name===expected.name);if(matches.length!==1)throw Error('Packed capture CI identity changed');
    exact(matches[0],['name','id','conclusion'],'capture CI job');
    if(!positive(matches[0].id)||matches[0].conclusion!==expected.conclusion)throw Error('Packed capture CI conclusion changed');
  }
  if(digest(p.design_steps)!==digest(legacy.design_steps))throw Error('Packed exception cannot waive nonperformance workflow failures');
  return value;
}

const profile=v=>({version:v,type:`performance-exception-v${v}`,approval_schema:`financial-performance-approval-v${v}`,
  candidate_schema:`financial-performance-candidate-v${v}`,pin_schema:`financial-performance-candidate-pin-v${v}`,intent_schema:`financial-performance-release-intent-v${v}`});
export function exceptionPolicyForVersion(version,{allowDisabled=false}={}) {
  if(version===1)return {...legacy,...profile(1)};
  if(version!==2)throw Error('Unknown performance exception version');
  validatePackedExceptionPolicy(packed);
  if(!packed.enabled&&!allowDisabled)throw Error('Packed performance exception has no reviewed capture');
  return {...profile(2),...(packed.capture||{}),enabled:packed.enabled,
    approval_path:'.github/financial-performance-approval-v2.json',pin_path:'.github/financial-performance-candidate-v2.json',release_intent_path:'.github/financial-performance-release-v2.json',
    workflow:legacy.workflow,job:legacy.job,steps:legacy.steps,
    controller_only_paths:[...legacy.controller_only_paths.filter(p=>p!=='contracts/financial_performance_exception_v1.json'),
      'contracts/financial_performance_exception_v2.json','.github/scripts/financial-performance-policy.mjs',
      '.github/scripts/financial-performance-exception-v2.test.mjs','.github/scripts/financial-performance-packed-carry.test.mjs',
      '.github/scripts/financial-candidate-preview-v2.test.mjs','.github/scripts/fixtures/financial-release-archive-lifecycle.mjs','.github/scripts/financial-release-archive-lifecycle.test.mjs',
      // Exact reviewed audit-retention helpers and their verification surfaces.
      // Runtime UI, financial projectors, v1 authority and future paths stay out.
      '.github/scripts/financial-audit-history.mjs','.github/scripts/financial-audit-history.test.mjs',
      '.github/scripts/financial-audit-transport.mjs','.github/scripts/financial-audit-transport.test.mjs',
      '.github/scripts/financial-release-activation.test.mjs','.github/scripts/financial-release-lifecycle.test.mjs',
      '.github/scripts/static-transport-publication.mjs','.github/scripts/static-transport-publication.test.mjs','.github/scripts/static-transport-carry.test.mjs',
      'frontend/src/static/staticPublication.test.js','frontend/tools/production-bootstrap-diagnostic.mjs','frontend/tools/production-bootstrap-diagnostic.test.mjs']};
}
export function exceptionPolicyFor(value) {
  for(const version of exceptionVersions){const p=profile(version);if(value?.type===p.type||[p.approval_schema,p.candidate_schema,p.pin_schema,p.intent_schema].includes(value?.schema_version))return exceptionPolicyForVersion(version);}
  throw Error('Unknown performance exception authority');
}
export const isPerformanceException=value=>[exceptionType,packedExceptionType].includes(value?.type);
export const isExceptionCandidate=value=>exceptionVersions.some(v=>value?.schema_version===`financial-performance-candidate-v${v}`);
export const isPackedCandidate=value=>['financial-release-candidate-v2',packedExceptionCandidateSchema].includes(value?.schema_version);
