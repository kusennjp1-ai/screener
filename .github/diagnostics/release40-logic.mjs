// Diagnostic facts only. No release, source, or publication authority.
import {createHash} from 'node:crypto';
export const REPOSITORY='kusennjp1-ai/screener', REPOSITORY_ID=1203919607;
export const BRANCH='diagnostic/release40-cohort-quota-20261010';
export const JOB_NAME='Read-only cohort and quota';
export const DEFAULT_CUTOFF='2026-10-03T01:12:40Z';
export const LIMITS=Object.freeze({weightedPages:192,historyRequests:200,foreignActivePages:2,ownPages:1,
  historyMs:120000,snapshotMs:30000,phaseMs:190000,wholeMs:420000,reserve:228,
  // Two 40-page snapshots, two 200-start history passes, and up to 8 CLI reads.
  maximumDiagnosticStarts:488,minimumInitialRemaining:716,reportBytes:1024*1024});
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const safeElapsed=value=>Number.isFinite(value)&&value>=0?Math.ceil(value):null;
export function ensure(value,code){if(!value)throw Object.assign(new Error(code),{diagnosticCode:code});}
export function safeCode(error){
  const code=error?.diagnosticCode??error?.inventoryReason??error?.conditionalReason??error?.code;
  return typeof code==='string'&&/^[a-z][a-z0-9-]{0,99}$/.test(code)?code:'diagnostic-failed';
}
export function quota(value){
  const q={limit:value?.limit,remaining:value?.remaining,used:value?.used,reset_epoch:value?.reset_epoch??value?.reset,resource:value?.resource};
  ensure([q.limit,q.remaining,q.used,q.reset_epoch].every(Number.isSafeInteger)&&q.limit>0&&q.used>=0&&q.remaining>=0
    &&q.used+q.remaining===q.limit&&q.reset_epoch>0&&q.resource==='core','missing-or-invalid-actual-quota');
  return q;
}
export function safeHeaders(headers){
  const out={};
  for(const key of ['x-ratelimit-limit','x-ratelimit-used','x-ratelimit-remaining','x-ratelimit-reset']){
    const v=headers?.[key];if(typeof v==='string'&&/^\d{1,15}$/.test(v)&&Number.isSafeInteger(Number(v)))out[key]=Number(v);
  }
  if(headers?.retry_after_present===true)out.retry_after_present=true;
  return out;
}
export function safeWorkflowLinks(value,workflow){
  ensure(typeof value==='string'&&Buffer.byteLength(value)<=8192,'probe-link-bound');
  const expected=new Map([['research-ui-release.yml',364666954],['static-site.yml',294257497]]).get(workflow);
  ensure(expected,'unapproved-probe-workflow');
  const links=[],relations=new Set();
  for(const part of value?value.split(','):[]){
    const match=/^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(part);
    ensure(match&&!relations.has(match[2]),'probe-link-shape');relations.add(match[2]);
    let url;try{url=new URL(match[1]);}catch{ensure(false,'probe-link-shape');}
    ensure(url.origin==='https://api.github.com'&&!url.username&&!url.password&&!url.hash,'probe-link-unsafe-origin');
    const path=/^\/(repos\/kusennjp1-ai\/screener|repositories\/1203919607)\/actions\/workflows\/([A-Za-z0-9.-]+)\/runs$/.exec(url.pathname);
    ensure(path&&(path[2]===workflow||path[2]===String(expected)),'probe-link-foreign-path');
    const query=[...url.searchParams];
    ensure(query.length<=3&&new Set(query.map(([k])=>k)).size===query.length
      &&query.every(([key,v])=>key==='branch'?v==='main':key==='per_page'?v==='100':key==='page'&&/^[1-9]\d{0,5}$/.test(v)),
      'probe-link-unsafe-query');
    links.push({relation:match[2],origin:url.origin,path:url.pathname,query:Object.fromEntries(query.sort(([a],[b])=>a.localeCompare(b)))});
  }
  return links;
}
export function cohortFacts(runs,runKey){
  ensure(Array.isArray(runs)&&runs.length>0&&new Set(runs.map(r=>r.id)).size===runs.length,'empty-or-duplicate-cohort');
  const identities=runs.map(r=>({id:r.id,run_attempt:r.run_attempt,run_key:runKey(r)})).sort((a,b)=>a.id-b.id);
  return {runs:runs.length,membership_sha256:hash(JSON.stringify(identities.map(r=>[r.id,r.run_attempt]))),
    identities_sha256:hash(JSON.stringify(identities)),identities};
}
export function checkCohortLowerBound(runs,currentRun){
  ensure(runs.length>0&&runs.length<=LIMITS.weightedPages,'cohort-minimum-weight-exceeds-192');
  ensure(runs.filter(r=>r.id!==currentRun&&r.status!=='completed').length<=LIMITS.foreignActivePages,'foreign-active-minimum-weight-exceeds-2');
}
export function historyFacts(result,runs,currentRun){
  const rows=new Map(runs.map(r=>[r.id,r]));
  ensure(result?.status==='complete'&&Array.isArray(result.jobs)&&result.jobs.length===rows.size
    &&new Set(result.jobs.map(r=>r.run_id)).size===rows.size,'incomplete-history');
  let weight=0,foreignActive=0,own=0;
  const pageWeights=result.jobs.map(entry=>{
    const run=rows.get(entry.run_id);ensure(run&&Array.isArray(entry.pages)&&entry.pages.length>0,'incomplete-history');
    const pages=entry.pages.length;weight+=pages;
    if(run.id===currentRun)own+=pages;else if(run.status!=='completed')foreignActive+=pages;
    return {run_id:run.id,pages};
  }).sort((a,b)=>a.run_id-b.run_id);
  ensure(result.observations.length===weight&&weight<=LIMITS.historyRequests,'history-request-bound');
  const observations=result.observations.map(o=>{
    ensure(rows.has(o.run_id)&&o.page_validated===true&&[200,304].includes(o.status)
      &&(o.status!==304||o.page_revalidated===true),'unvalidated-history');
    return {run_id:o.run_id,run_key:o.run_key,status:o.status,conditional:o.conditional,
      page_revalidated:o.page_revalidated,quota:quota(o.quota),elapsed_ms:Math.ceil(o.elapsed_ms),
      received_body_bytes:o.received_body_bytes,representation_body_bytes:o.representation_body_bytes,
      body_sha256:o.body_sha256,etag_sha256:o.etag_received===null?null:hash(o.etag_received)};
  });
  return {weighted_pages:weight,foreign_active_weighted_pages:foreignActive,own_weighted_pages:own,
    admitted:weight<=LIMITS.weightedPages&&foreignActive<=LIMITS.foreignActivePages&&own<=LIMITS.ownPages,
    page_weights_sha256:hash(JSON.stringify(pageWeights)),page_weights:pageWeights,
    http_200:observations.filter(o=>o.status===200).length,http_304:observations.filter(o=>o.status===304).length,
    terminal_200:observations.filter(o=>o.status===200&&rows.get(o.run_id).status==='completed'&&o.run_id!==currentRun).length,
    observations};
}
export function assess(cold,warm,boundary,policies,now=Date.now(),cliSamples=[]){
  const q=quota(boundary),nativePages=[cold,warm].flatMap(p=>p.inventory?.pages??[]);
  const sameWindow=[...[cold,warm].flatMap(p=>p.history.observations),...cliSamples].every(o=>
    o.quota.limit===q.limit&&o.quota.reset_epoch===q.reset_epoch&&o.quota.resource===q.resource)
    &&nativePages.every(p=>{
      const h=p.safe_headers;
      return p.status===200&&p.quota?.resource==='core'&&p.quota.limit===q.limit&&p.quota.reset_epoch===q.reset_epoch
        &&p.quota.remaining===h?.['x-ratelimit-remaining']&&h&&!h.retry_after_present&&['limit','used','remaining','reset'].every(k=>Number.isSafeInteger(h['x-ratelimit-'+k]))
        &&h['x-ratelimit-limit']===q.limit&&h['x-ratelimit-reset']===q.reset_epoch
        &&h['x-ratelimit-used']+h['x-ratelimit-remaining']===q.limit;
    });
  // Samples are a shared-token balance, never attributed request counts.
  const allHistory=[cold,warm].flatMap(p=>p.history.observations);
  const native=nativePages.map(p=>p.safe_headers).filter(h=>h
    &&h['x-ratelimit-limit']===q.limit&&h['x-ratelimit-reset']===q.reset_epoch
    &&Number.isSafeInteger(h['x-ratelimit-remaining'])).map(h=>h['x-ratelimit-remaining']);
  const ownedStarts=cliSamples.length+[cold,warm].reduce((n,p)=>n+(p.inventory?.pages?.length??0)+p.history.observations.length,0);
  const earlier=[...allHistory.map(o=>o.quota.remaining),...native,...cliSamples.map(s=>s.quota)
    .filter(s=>s.limit===q.limit&&s.reset_epoch===q.reset_epoch).map(s=>s.remaining)];
  // Charge every owned start after an earlier regional sample conservatively by
  // subtracting the entire diagnostic start count. This may double-charge earlier
  // calls and 304s, but no later high regional sample restores spent headroom.
  const minimum=Math.max(0,Math.min(q.remaining,...earlier.map(remaining=>remaining-ownedStarts)));
  const stable=cold.cohort.membership_sha256===warm.cohort.membership_sha256
    &&cold.cohort.identities_sha256===warm.cohort.identities_sha256
    &&cold.history.page_weights_sha256===warm.history.page_weights_sha256;
  const roles=Object.fromEntries(Object.entries(policies).map(([role,p])=>[role,{
    original_primary:p.original_primary,retained_reserve:p.retained_reserve,
    // Conservative fresh-role fit, not an invocation of the production opener.
    actual_window_fits_original_allocation:sameWindow&&q.reset_epoch*1000>now&&q.limit>=p.original_primary&&minimum>=p.original_primary}]));
  const measuredAccepted=cold.history.admitted&&warm.history.admitted&&stable&&sameWindow
    &&q.reset_epoch*1000>now&&warm.history.terminal_200<=Math.min(...Object.values(policies).map(p=>p.extra_primary.terminal_miss));
  return {budgetAccepted:measuredAccepted&&Object.values(roles).every(r=>r.actual_window_fits_original_allocation),
    measured_cohort_accepted:measuredAccepted,stable_membership_and_identity:stable,same_quota_window:sameWindow,
    conservative_minimum_remaining:minimum,conservative_sample_debt:ownedStarts,
    sample_debt_basis:'One conservative modeled unit per owned transport start; CLI internal wire/primary consumption remains unknown.',
    roles,whole_release_certified:false,publication_authority:false,
    qualification:'Read-only measured cohort and conservative window fit; genuine producer/publisher registration and the full release path were not executed.'};
}
