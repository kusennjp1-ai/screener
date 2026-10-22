// Offline consistency checks only. This module cannot authorize publication.
// Default full-release gates and all live receipt readers remain unchanged.
import {createHash} from 'node:crypto';
import {parsePublicationReceipt} from './financial-audit-history.mjs';
import {measuredPerformanceFailures} from '../../frontend/tools/limited-research-assessment.mjs';
export const LIMITED_SCOPE = 'limited-research-preview-v1';
export const LIMITED_ACTIVATION_ENABLED = false;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export const limitedDigest = bytes => createHash('sha256').update(bytes).digest('hex');
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).sort().join('|') !== keys.slice().sort().join('|')) throw Error(`Invalid closed ${label}`);
}
function run(value, label) {
  exact(value,['id','attempt'],label);
  if (![value.id,value.attempt].every(n=>Number.isSafeInteger(n)&&n>0)) throw Error(`Invalid ${label}`);
}
export function parseLimitedDocument(bytes) {
  if (Buffer.byteLength(bytes)>256*1024) throw Error('Limited document too large');
  return parsePublicationReceipt(bytes);
}
export function validateLimitedApproval(value, now=Date.now()) {
  exact(value,['schema_version','scope_id','status','created_at','expires_at','controller_sha','ui','predecessor','data','evidence','accepted_performance_failures','owner_acceptance'],'limited approval');
  if (value.schema_version!=='limited-research-approval-v1'||value.scope_id!==LIMITED_SCOPE||!['draft','approved'].includes(value.status)) throw Error('Unsupported limited scope');
  const start=Date.parse(value.created_at),end=Date.parse(value.expires_at);
  if (typeof value.created_at!=='string'||typeof value.expires_at!=='string'||!value.created_at.endsWith('Z')||!value.expires_at.endsWith('Z')
    || !Number.isFinite(now)||!Number.isFinite(start)||!Number.isFinite(end)||start>now||now>=end||end<=start||end-start>86400000) throw Error('Finite current activation window required');
  if(!sha(value.controller_sha))throw Error('Exact controller required');
  exact(value.ui,['sha','inventory_sha256'],'UI binding');
  if(!sha(value.ui.sha)||!hash(value.ui.inventory_sha256))throw Error('Exact UI binding required');
  exact(value.predecessor,['identity','receipt_sha256'],'predecessor');
  if(!text(value.predecessor.identity)||!hash(value.predecessor.receipt_sha256))throw Error('Exact predecessor required');
  exact(value.data,['manifest_sha256','logical_inventory_sha256','financial_lineage_sha256'],'frozen admitted data');
  if(!hash(value.data.manifest_sha256)||!hash(value.data.logical_inventory_sha256)
    || !(value.data.financial_lineage_sha256===null||hash(value.data.financial_lineage_sha256)))throw Error('Exact admitted data required');
  exact(value.evidence,['ci','assessment_run','assessment_sha256','review_sha256','screenshots_sha256','notice_sha256'],'evidence');
  run(value.evidence.ci,'CI attempt');run(value.evidence.assessment_run,'assessment attempt');
  for(const field of ['assessment_sha256','review_sha256','screenshots_sha256','notice_sha256'])if(!hash(value.evidence[field]))throw Error('Missing exact evidence hash');
  const failures=value.accepted_performance_failures;
  if(!Array.isArray(failures)||failures.length>64||failures.some(f=>!text(f))||new Set(failures).size!==failures.length)throw Error('Invalid exact performance limitations');
  if(value.status==='draft') {if(value.owner_acceptance!==null)throw Error('Draft cannot claim owner acceptance');}
  else {
    exact(value.owner_acceptance,['reference','accepted_at'],'owner acceptance');
    const accepted=Date.parse(value.owner_acceptance.accepted_at);
    if(!text(value.owner_acceptance.reference)||typeof value.owner_acceptance.accepted_at!=='string'||!value.owner_acceptance.accepted_at.endsWith('Z')||!Number.isFinite(accepted)||accepted<start||accepted>now)throw Error('Explicit scope acceptance required');
  }
  return value;
}
export function verifyLimitedEvidence(approval, {assessmentBytes,reviewBytes,screenshotsBytes,noticeBytes}, now=Date.now()) {
  validateLimitedApproval(approval,now);
  for(const [field,bytes] of [['assessment_sha256',assessmentBytes],['review_sha256',reviewBytes],['screenshots_sha256',screenshotsBytes],['notice_sha256',noticeBytes]])
    if(!(typeof bytes==='string'||Buffer.isBuffer(bytes))||limitedDigest(bytes)!==approval.evidence[field])throw Error(`Changed ${field}`);
  const assessment=parseLimitedDocument(assessmentBytes),review=parseLimitedDocument(reviewBytes),screenshots=parseLimitedDocument(screenshotsBytes);
  if(assessment.schema_version!=='limited-research-assessment-v1'||assessment.scope_id!==LIMITED_SCOPE||assessment.publication_authority!=='none'||assessment.ui_sha!==approval.ui.sha)throw Error('Assessment scope/UI mismatch');
  if(!Array.isArray(assessment.blocking_failures)||assessment.blocking_failures.length)throw Error('Non-waivable assessment failures remain');
  if(!equal(assessment.accepted_performance_limitations,approval.accepted_performance_failures))throw Error('Performance limitations differ');
  const measured=measuredPerformanceFailures({performance:assessment.performance_measurements,radar:assessment.radar_measurements});
  if(approval.accepted_performance_failures.some(f=>!measured.has(f)))throw Error('Accepted limitation is not a measured performance failure');
  if(!Array.isArray(assessment.original_design_failures)||assessment.original_design_failures.some(f=>!approval.accepted_performance_failures.includes(f)))throw Error('Unaccepted original failure');
  if(!Array.isArray(assessment.financial_cases)||assessment.financial_cases.length!==10)throw Error('All five cases at both viewports required');
  const expected=new Set(['NVDA','FUTU','AAOI','ALH','AVT'].flatMap(symbol=>[`${symbol}/1440/dark`,`${symbol}/390/light`]));
  for(const item of assessment.financial_cases) {
    const key=`${item.symbol}/${item.viewport?.width}/${item.theme}`;
    if(!expected.delete(key)||item.error||!['demonstrated','unavailable'].includes(item.source?.original_category?.status))throw Error('Missing or duplicate actual-state financial case');
    if(item.source.original_category.status==='unavailable'&&!text(item.source.original_category.reason))throw Error('Unavailable category needs reason');
  }
  exact(review,['schema_version','scope_id','ui_sha','assessment_sha256','reviewer','screens'],'screenshot review');
  if(review.schema_version!=='limited-research-review-v1'||review.scope_id!==LIMITED_SCOPE||review.ui_sha!==approval.ui.sha||review.assessment_sha256!==approval.evidence.assessment_sha256||!text(review.reviewer))throw Error('Review identity mismatch');
  if(!screenshots||typeof screenshots!=='object'||Array.isArray(screenshots)||!Object.keys(screenshots).length||Object.values(screenshots).some(v=>!hash(v)))throw Error('Invalid screenshot inventory');
  if(!Array.isArray(assessment.screens)||!assessment.screens.length)throw Error('Assessment screenshot bindings missing');
  const captured=new Map();
  for(const screen of assessment.screens){
    if(!text(screen.key)||!hash(screen.sha256)||captured.has(screen.key))throw Error('Invalid assessment screenshot binding');
    captured.set(screen.key,screen.sha256);
  }
  if(captured.size!==Object.keys(screenshots).length||[...captured].some(([key,digest])=>screenshots[key]!==digest))throw Error('Assessment screenshot inventory differs');
  for(const symbol of ['NVDA','FUTU','AAOI','ALH','AVT'])for(const [width,theme] of [[1440,'dark'],[390,'light']]){
    const views=['evidence','annual-viewport',...(['FUTU','ALH'].includes(symbol)?['history']:[]),...(symbol==='NVDA'?['selection','purchase']:[])];
    for(const view of views)if(!captured.has(`financial-${symbol}-${view}/${width}/${theme}`))throw Error('Required financial screenshot missing');
  }
  if(!Array.isArray(review.screens)||review.screens.length!==Object.keys(screenshots).length)throw Error('Incomplete screenshot review');
  const seen=new Set();
  for(const screen of review.screens) {
    exact(screen,['key','screenshot_sha256','scores'],'review screen');
    if(!text(screen.key)||seen.has(screen.key)||screenshots[screen.key]!==screen.screenshot_sha256)throw Error('Screenshot mismatch');seen.add(screen.key);
    exact(screen.scores,['design','usability','originality','content'],'review scores');
    for(const score of Object.values(screen.scores)) {
      exact(score,['value','reason'],'review score');
      if(!Number.isFinite(score.value)||score.value<8||score.value>10||!text(score.reason))throw Error('Unacceptable screenshot score');
    }
  }
  return {assessment,review};
}
// Caller-supplied snapshots establish consistency only, not authentication.
// The final publisher must independently obtain them through the established
// livePublication/source pipeline; it must never use this result as authority.
export function prepareLimitedPreview(approval,evidence,context,now=Date.now()) {
  verifyLimitedEvidence(approval,evidence,now);
  exact(context,['controller_sha','ui','predecessor','data','correction_hold','renewal_hold','source_admission_pending'],'preflight context');
  if(context.correction_hold!==false||context.renewal_hold!==false||context.source_admission_pending!==false)throw Error('Existing source/correction/renewal hold remains');
  for(const key of ['controller_sha','ui','predecessor','data'])if(!equal(approval[key],context[key]))throw Error(`Frozen ${key} changed`);
  return {schema_version:'limited-research-preflight-v1',scope_id:LIMITED_SCOPE,status:'locally-consistent',publication_authority:'none',activation_allowed:false,
    approval_sha256:limitedDigest(JSON.stringify(approval)),blocking_integration:['Authenticated exact-run evidence verification','Financial carry and all receipt-consumer approval integration','Final immutable compose/recheck and one-shot activation'],data_refresh_allowed:false,financial_admission_allowed:false};
}
export function activateLimitedPreview() {throw Error('Limited preview activation is disabled; offline preflight is not publication authority');}
