// Metadata-only diagnostic. It grants no source or publication authority.
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {REPOSITORY,REPOSITORY_ID,LIMITS,readRepositorySnapshot,validateSnapshot} from './retained-price-repository-inventory.mjs';
import {createConditionalDeploymentJobsReader,withConditionalDeploymentJobsReader,noteScopedInventoryRead} from './conditional-deployment-jobs.mjs';
import {validateReceipt,deploymentAnchor} from './publication-state.mjs';
import {parsePublicationReceipt,PUBLICATION_METADATA_BYTES} from './financial-audit-history.mjs';
import {validateFinancialReleaseReceipt} from './financial-release-activation.mjs';
import {runKey} from './conditional-deployment-jobs-worker.mjs';

const SITE='https://kusennjp1-ai.github.io/screener/';
const CONTROL=37858469362,NEVER_READ_JOBS=37781492974,KNOWN_SOURCE=37867375775;
const SHA=/^[a-f0-9]{40}$/;
const positive=v=>Number.isSafeInteger(v)&&v>0;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const check=(ok,reason)=>{if(!ok)throw Object.assign(Error(reason),{diagnosticReason:reason});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const FIELDS=['GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA','GITHUB_WORKFLOW_SHA'];
const PUBLIC_TOTAL_BYTES=16*1024*1024,STDOUT_BYTES=256*1024;
const MODEL=Object.freeze({producer_gates:5,publisher_gates:22,producer_live_reads:4,publisher_live_reads:17,
  producer_original_authentications:5,publisher_original_authentications:14,publisher_invocations:9,
  producer_deployment_rounds:8,publisher_deployment_rounds:34,producer_native_snapshot_calls:13,
  publisher_native_snapshot_calls:50,native_snapshot_calls:63,standalone_selector_catalogue_rounds:6});

function quota(headers){
  const out={};
  for(const name of ['limit','used','remaining','reset']){
    const value=headers.get('x-ratelimit-'+name);
    check(typeof value==='string'&&/^\d{1,15}$/.test(value)&&Number.isSafeInteger(Number(value)),'missing-or-invalid-quota');
    out[name]=Number(value);
  }
  check(headers.get('x-ratelimit-resource')==='core'&&positive(out.limit)&&out.used+out.remaining===out.limit&&positive(out.reset),'invalid-core-quota');
  return out;
}
async function readBytes(response,maximum){
  check(response.body&&typeof response.body[Symbol.asyncIterator]==='function','invalid-metadata-body');
  let size=0;const chunks=[];
  for await(const chunk of response.body){check(chunk instanceof Uint8Array,'invalid-metadata-body');size+=chunk.byteLength;
    check(size<=maximum,'metadata-byte-bound');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function parse(bytes){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{check(false,'invalid-metadata-json');}}

export function historicalCandidates(runs,anchor){
  check(Array.isArray(runs)&&Number.isFinite(anchor?.completed),'invalid-candidate-input');
  return runs.filter(run=>run.repository?.full_name===REPOSITORY&&run.head_repository?.full_name===REPOSITORY
    &&run.head_branch==='main'&&['.github/workflows/research-ui-release.yml','.github/workflows/static-site.yml'].includes(run.path)
    &&Date.parse(run.updated_at)>=anchor.completed);
}
export function demandLowerBound({snapshotPages,historicalPagesLowerBound,renewalDepth=null}){
  check(positive(snapshotPages)&&Number.isSafeInteger(historicalPagesLowerBound)&&historicalPagesLowerBound>=0,'invalid-demand-input');
  check(renewalDepth===null||(Number.isSafeInteger(renewalDepth)&&renewalDepth>=0&&renewalDepth<=32),'invalid-renewal-depth');
  // H counts terminal candidates only. Each complete all-attempt inventory has
  // at least one page, including an empty inventory. Active rows are extra.
  const native=MODEL.native_snapshot_calls*snapshotPages;
  const producerHistorical=MODEL.producer_deployment_rounds*historicalPagesLowerBound;
  const publisherCold=MODEL.publisher_invocations*historicalPagesLowerBound;
  const renewalMinimum=renewalDepth===null?null:21*14*renewalDepth;
  return {native_snapshot_primary:native,publisher_ordinary_primary_floor:0,
    producer_historical_fresh_200_primary:producerHistorical,publisher_cold_historical_200_primary:publisherCold,
    unconditional_primary_lower_bound:native+producerHistorical+publisherCold,
    additional_renewal_primary_lower_bound:renewalMinimum,
    callback_reserve_included:false,assumed_hourly_reset:false,
    future_candidate_membership:'scenario assumes these historical members remain in each fresh catalogue; clocks and new deployments may change later cutoffs'};
}
function scenarios(N,H){
  // Cost graph derived from the retained controller; these are labelled inputs,
  // not measured proof page counts. P=1 is retained A13 producer evidence only.
  const P=1,A=1;
  const producerDirect=137+10*P,producerPages=50+10*P+8*(H+A),producerNative=13*N;
  const publisherDirect=558+44*P,publisherPages=197+44*P+34*A,publisherNative=50*N;
  const route=19+4*P+3*2+4*1+N,setup=11;
  const callbacks=2*12+2*10+10+(14+4*P+N)+route+8;
  const knownBase=producerDirect+producerPages+producerNative+publisherDirect+publisherPages+publisherNative+route+setup+callbacks;
  return {assumptions:{excluded_noop_callbacks_per_gate:P,active_jobs_pages_per_round:A,holds:2,failed_callbacks:1,
      ignored_producer_callbacks:2,held_publisher_callbacks:2,wrong_head_producer_callbacks:1,
      contending_producer_callbacks:1,matching_source_publisher_callbacks:1,manual_publisher_callbacks:1},
    producer:{direct:producerDirect,ordinary_pages:producerPages,native_pages:producerNative,historical_fresh_200_pages:8*H},
    publisher:{direct:publisherDirect,ordinary_pages:publisherPages,native_pages:publisherNative,
      historical_requests:34*H,normal_cold_200:9*H,normal_warm_304:25*H,
      no_etag_or_changed_new_evicted_200:34*H},
    source_publication_route:route,controller_setup:setup,concurrent_callback_reserve:callbacks,
    normal_primary_estimate_under_inputs:knownBase+9*H,no_savings_primary_estimate_under_inputs:knownBase+34*H,
    raw_owned_request_estimate_under_inputs:knownBase+34*H,
    unresolved:['weighted historical and ordinary jobs pages','future candidate changes','actual future P and A',
      'additional renewal Git and CI-admission proof reads','other same-bucket work and cumulative callback arrival bound'],
    genuine_publication_or_source_data:false};
}

export async function measureBudget({fetcher=fetch,run,env=process.env}={}){
  const initial=Object.fromEntries(FIELDS.map(key=>[key,env[key]]));
  check(initial.GITHUB_REPOSITORY===REPOSITORY&&initial.GITHUB_REPOSITORY_ID===String(REPOSITORY_ID)
    &&positive(Number(initial.GITHUB_RUN_ID))&&initial.GITHUB_RUN_ATTEMPT==='1'
    &&SHA.test(initial.GITHUB_SHA??'')&&initial.GITHUB_WORKFLOW_SHA===initial.GITHUB_SHA,'invalid-diagnostic-invocation');
  const scope={repository:REPOSITORY,repository_id:REPOSITORY_ID,run_id:Number(initial.GITHUB_RUN_ID),
    run_attempt:1,controller_sha:initial.GITHUB_SHA};
  const binding=()=>FIELDS.every(key=>env[key]===initial[key]);
  const report={schema_version:'conditional-deployment-jobs-budget-measurement-v1',diagnostic_only:true,
    source_authority:false,publication_authority:false,budgetAccepted:false,status:'started',scope,
    snapshots_acquired:0,ordinary_metadata:{requests_issued:0,http_200:0,http_other_status:0,status_unknown:0,returned_job_pages:0,body_bytes:0,observations:[]},
    public_metadata:{requests_issued:0,http_200:0,body_bytes:0},
    native_snapshot_transport:{requests_issued:0,http_200:0,http_other_status:0,status_unknown:0,observations:[]},model:MODEL};
  let reader,finalMeasurement=null,latestQuota=null;
  const apiValues=new Map();
  const publicRead=async path=>{
    check(path==='publication.json'||/^static-data\/financial-corrections\/release-[a-f0-9]{64}\.json$/.test(path),'undeclared-public-metadata-path');
    const url=new URL(path,SITE);url.searchParams.set('publication_check',String(Date.now()));
    report.public_metadata.requests_issued++;
    const response=await fetcher(url,{redirect:'error',cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
    check(response.status===200&&!response.redirected,'public-metadata-http-failure');
    report.public_metadata.http_200++;
    const bytes=await readBytes(response,PUBLICATION_METADATA_BYTES);report.public_metadata.body_bytes+=bytes.length;
    check(report.public_metadata.body_bytes<=PUBLIC_TOTAL_BYTES,'public-metadata-total-byte-bound');return bytes;
  };
  const apiRead=async endpoint=>{
    check(binding(),'diagnostic-binding-changed');
    check(latestQuota===null||latestQuota.remaining>100,'ordinary-metadata-reserve-before-request');
    report.ordinary_metadata.requests_issued++;
    const response=await fetcher('https://api.github.com/'+endpoint,{redirect:'error',cache:'no-store',
      headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+env.GH_TOKEN,'X-GitHub-Api-Version':'2022-11-28',
        'User-Agent':'screener-conditional-jobs-budget-diagnostic'},signal:AbortSignal.timeout(10000)});
    const observation={status:response.status,quota:{},retry_after_present:response.headers.has('retry-after')};
    for(const key of ['limit','used','remaining','reset']){
      const value=response.headers.get('x-ratelimit-'+key);
      if(typeof value==='string'&&/^\d{1,15}$/.test(value)&&Number.isSafeInteger(Number(value)))observation.quota[key]=Number(value);
    }
    report.ordinary_metadata.observations.push(observation);
    if(response.status===200)report.ordinary_metadata.http_200++;else report.ordinary_metadata.http_other_status++;
    check(![401,403,429].includes(response.status),'ordinary-metadata-terminal-http-'+response.status);
    check(!observation.retry_after_present,'ordinary-metadata-terminal-retry-after');
    check(response.status===200&&!response.redirected,'ordinary-metadata-http-or-redirect-failure');
    latestQuota=quota(response.headers);
    check(latestQuota.remaining>=(report.ordinary_metadata.requests_issued===1?170:100),'ordinary-metadata-reserve-failure');
    const bytes=await readBytes(response,LIMITS.pageBytes);
    report.ordinary_metadata.body_bytes+=bytes.length;
    check(report.ordinary_metadata.body_bytes<=LIMITS.bytes,'ordinary-metadata-total-byte-bound');
    return {value:parse(bytes),link:response.headers.get('link')??''};
  };
  try{
    check(typeof env.GH_TOKEN==='string'&&env.GH_TOKEN.length>0,'missing-existing-token');
    reader=createConditionalDeploymentJobsReader({scope,excludedIds:[KNOWN_SOURCE,NEVER_READ_JOBS],...(run?{run}:{}),
      token:()=>env.GH_TOKEN,binding,report:value=>{finalMeasurement=value;}});
    await withConditionalDeploymentJobsReader(reader,async()=>{
      const receiptBytes=await publicRead('publication.json'),receipt=validateReceipt(parsePublicationReceipt(receiptBytes));
      check(receipt.approval?.type==='performance-exception-v2','unexpected-current-publication-approval');
      report.predecessor={run_id:receipt.run_id,run_attempt:receipt.run_attempt,approval_type:receipt.approval.type,
        financial_metadata_authenticated:false,renewal_depth:null,certification_ci_admission:null,publisher_ci_admission:null};
      check(receipt.run_id!==NEVER_READ_JOBS,'forbidden-anchor-jobs');
      const attemptRoute='repos/'+REPOSITORY+'/actions/runs/'+receipt.run_id+'/attempts/'+receipt.run_attempt;
      const attempt=(await apiRead(attemptRoute)).value;apiValues.set(attemptRoute,attempt);
      check(attempt.repository?.id===REPOSITORY_ID&&attempt.head_repository?.id===REPOSITORY_ID,'foreign-anchor-repository');
      const firstJobs=attemptRoute+'/jobs?per_page=100',pages=[];let expectedTotal=null,allJobs=0,next=firstJobs;
      for(let page=1;next;page++){
        check(page<=10,'anchor-job-page-bound');
        const response=await apiRead(next),value=response.value;
        check(object(value)&&Number.isSafeInteger(value.total_count)&&value.total_count>=0&&value.total_count<=1000
          &&Array.isArray(value.jobs)&&value.jobs.length<=100,'invalid-anchor-job-page');
        if(expectedTotal===null)expectedTotal=value.total_count;
        check(value.total_count===expectedTotal&&value.jobs.length===Math.min(100,Math.max(0,expectedTotal-(page-1)*100)),'changing-or-incomplete-anchor-job-total');
        check(value.jobs.every(job=>positive(job.id)&&job.run_id===receipt.run_id),'foreign-anchor-job');
        pages.push(value);allJobs+=value.jobs.length;report.ordinary_metadata.returned_job_pages++;
        const expectedPages=Math.max(1,Math.ceil(expectedTotal/100));
        next=page<expectedPages?firstJobs+'&page='+(page+1):null;
        if(next)check(response.link.includes('<https://api.github.com/'+next+'>; rel="next"'),'incomplete-anchor-job-link');
      }
      check(allJobs===expectedTotal&&new Set(pages.flatMap(p=>p.jobs).map(j=>j.id)).size===allJobs,'incomplete-anchor-jobs');
      apiValues.set(firstJobs,pages);
      const anchor=deploymentAnchor(receipt,REPOSITORY,(endpoint,paginate=false)=>{
        check(apiValues.has(endpoint)&&paginate===Array.isArray(apiValues.get(endpoint)),'unplanned-anchor-resource');return apiValues.get(endpoint);
      });
      report.anchor={run_id:anchor.runId,run_attempt:anchor.attempt,completed_at:new Date(anchor.completed).toISOString()};
      let snapshotFailureReason=null;
      const snapshotFetcher=async(url,options)=>{
        try{
        check(binding(),'diagnostic-binding-changed');
        check(typeof url==='string'&&/^https:\/\/api\.github\.com\/repositories\/1203919607\/actions\/runs\?per_page=50&page=[1-9]\d*$/.test(url),'unexpected-snapshot-route');
        // Up to three native requests can be in flight. This is observed
        // headroom only; another job can consume the same bucket at any time.
        check(latestQuota&&latestQuota.remaining>=103,'snapshot-reserve-before-request');
        report.native_snapshot_transport.requests_issued++;
        const response=await fetcher(url,options);
        const observation={status:response.status,quota:{},retry_after_present:response.headers.has('retry-after')};
        for(const key of ['limit','used','remaining','reset']){
          const value=response.headers.get('x-ratelimit-'+key);
          if(typeof value==='string'&&/^\d{1,15}$/.test(value)&&Number.isSafeInteger(Number(value)))observation.quota[key]=Number(value);
        }
        report.native_snapshot_transport.observations.push(observation);
        if(response.status===200)report.native_snapshot_transport.http_200++;else report.native_snapshot_transport.http_other_status++;
        check(![401,403,429].includes(response.status),'snapshot-terminal-http-'+response.status);
        check(!observation.retry_after_present,'snapshot-terminal-retry-after');
        check(response.status===200&&!response.redirected,'snapshot-http-or-redirect-failure');
        latestQuota=quota(response.headers);
        check(latestQuota.remaining>=100,'snapshot-reserve-failure');
        return response;
        }catch(error){
          if(error?.diagnosticReason&&(!snapshotFailureReason||/terminal-http|retry-after/.test(error.diagnosticReason)))snapshotFailureReason=error.diagnosticReason;
          throw error;
        }
      };
      const snapshot=await readRepositorySnapshot({timeoutMs:LIMITS.attemptMs,requiredIds:[scope.run_id,CONTROL],fetcher:snapshotFetcher,token:env.GH_TOKEN});
      report.snapshots_acquired=1;
      noteScopedInventoryRead({schema_version:'retained-price-repository-snapshot-v1',call_id:'budget-one-snapshot',
        attempt:1,status:snapshot.status,page_evidence:snapshot.evidence});
      check(snapshot.status==='complete','repository-snapshot-'+(snapshotFailureReason??snapshot.reason));
      const validated=validateSnapshot(snapshot.pages,[scope.run_id,CONTROL]),own=validated.runs.find(row=>row.id===scope.run_id);
      check(own.run_attempt===1&&own.head_sha===scope.controller_sha&&own.repository.id===REPOSITORY_ID
        &&own.head_repository.id===REPOSITORY_ID,'snapshot-own-binding-mismatch');
      const candidates=historicalCandidates(validated.runs,anchor);
      for(const row of candidates)runKey(row); // Same bounded run schema as the final worker; no jobs read.
      const terminal=candidates.filter(row=>row.status==='completed');
      report.inventory={complete:true,pages:validated.pages.length,total_runs:validated.total,
        deployment_candidates:candidates.length,terminal_candidates:terminal.length,
        mutable_candidates:candidates.length-terminal.length,denied_jobs_candidate_count:terminal.filter(row=>row.id===NEVER_READ_JOBS).length,
        historical_job_pages_lower_bound:terminal.length,all_candidate_job_pages_lower_bound:candidates.length,historical_job_pages_exact:null,
        worker_cap_historical_job_pages:terminal.length*10,worker_cap_all_candidate_job_pages:candidates.length*10};
      const floor=demandLowerBound({snapshotPages:validated.pages.length,historicalPagesLowerBound:terminal.length});
      report.demand=floor;
      report.decisive_negative=floor.unconditional_primary_lower_bound>5000;
      report.historical_candidate_jobs_read=false;
      // Candidate cardinality is enough for a decisive negative. Never issue a
      // diagnostic jobs request to the denied historical endpoint or every row.
      const fixed=validated.runs.find(row=>row.id===CONTROL);
      check(fixed.status==='completed'&&fixed.conclusion==='failure'&&fixed.run_attempt===1
        &&fixed.repository.id===REPOSITORY_ID&&fixed.head_repository.id===REPOSITORY_ID
        &&fixed.head_branch==='main'&&fixed.workflow_id===364666954&&fixed.path==='.github/workflows/research-ui-release.yml','unexpected-fixed-control-row');
      check(latestQuota&&latestQuota.remaining>=120,'control-batches-reserve-headroom');
      const before=reader.stats().counts;
      const cold=reader.read([fixed]);check(cold.has(CONTROL),'missing-cold-control');
      const afterCold=reader.stats().counts;
      const warm=reader.read([fixed]);check(warm.has(CONTROL),'missing-warm-control');
      const afterWarm=reader.stats().counts;
      const coldJobsDigest=digest(JSON.stringify(cold.get(CONTROL))),warmJobsDigest=digest(JSON.stringify(warm.get(CONTROL)));
      check(coldJobsDigest===warmJobsDigest,'control-job-membership-changed');
      report.control={run_id:CONTROL,run_attempt:1,completed_failed:true,job_count:cold.get(CONTROL).length,parsed_jobs_sha256:coldJobsDigest,
        cold_requests:afterCold.conditional_requests_issued-before.conditional_requests_issued,
        cold_http_200:afterCold.conditional_http_200-before.conditional_http_200,
        cold_http_304:afterCold.conditional_http_304-before.conditional_http_304,
        warm_requests:afterWarm.conditional_requests_issued-afterCold.conditional_requests_issued,
        warm_http_200:afterWarm.conditional_http_200-afterCold.conditional_http_200,
        warm_http_304:afterWarm.conditional_http_304-afterCold.conditional_http_304,
        cache_bytes:reader.stats().cache_bytes,protocol_savings_observed:afterWarm.conditional_http_304>afterCold.conditional_http_304};
      // Receipt metadata alone establishes chain depth. Transition CI-admission
      // flags stay unknown: this target never follows financial history assets.
      if(receipt.financial_release){
        const reference=receipt.financial_release,bytes=await publicRead(reference.path);
        check(digest(bytes)===reference.sha256,'public-release-metadata-binding-changed');
        const financial=validateFinancialReleaseReceipt(parse(bytes));
        check(financial.schema_version===reference.schema_version&&financial.financial_generation===receipt.financial_generation
          &&financial.lineage_sha256===receipt.financial_lineage_sha256&&financial.ui.approved_sha===receipt.ui_sha
          &&financial.ui.digest===receipt.ui_digest&&JSON.stringify(financial.ui.approval)===JSON.stringify(receipt.approval),'public-release-metadata-disagrees');
        report.predecessor.financial_metadata_authenticated=true;
        report.predecessor.renewal_depth=financial.renewal?.transitions.length??0;
        report.demand=demandLowerBound({snapshotPages:validated.pages.length,historicalPagesLowerBound:terminal.length,
          renewalDepth:report.predecessor.renewal_depth});
      }
      check(digest(await publicRead('publication.json'))===digest(receiptBytes),'public-receipt-changed-during-diagnostic');
      check(binding(),'diagnostic-binding-changed');
      report.scenario=scenarios(validated.pages.length,terminal.length);
      report.status='complete';
      report.lower_bound_exceeds_fresh_remaining=latestQuota?report.demand.unconditional_primary_lower_bound>latestQuota.remaining:null;
      report.reason=report.decisive_negative?'mandatory-primary-floor-exceeds-5000':'complete-weighted-demand-and-callback-bounds-not-established';
      report.unresolved_inputs=['exact historical and ordinary job page weights','future cutoff and candidate membership',
        'fresh production-run quota and all same-bucket competing work','bounded cumulative callback arrivals',
        ...(report.predecessor.renewal_depth?['renewal transition ci_admission fields and immutable Git proof costs']:[])];
    });
  }catch(error){
    reader?.dispose('failed');report.status='failed';report.measurement_incomplete=true;
    report.reason=error?.diagnosticReason??error?.conditionalReason??'metadata-or-validation-failure';
  }
  if(finalMeasurement){
    report.owned_counts=finalMeasurement.counts;
    report.historical_batches=(finalMeasurement.historical_batches??[]).map(batch=>({
      batch:batch.batch,status:batch.status,elapsed_ms:batch.elapsed_ms,stdout_bytes:batch.stdout_bytes,stdout_sha256:batch.stdout_sha256,
      requests_issued:batch.requests_issued,http_200:batch.http_200,http_304:batch.http_304,
      first_actual_route_quota:batch.first_actual_route_quota,last_actual_route_quota:batch.last_actual_route_quota}));
    report.measurement_incomplete=report.status!=='complete'||finalMeasurement.measurement_incomplete;
    const last=report.historical_batches.at(-1)?.last_actual_route_quota;
    if(last?.['x-ratelimit-remaining']!==undefined)latestQuota={limit:last['x-ratelimit-limit'],used:last['x-ratelimit-used'],
      remaining:last['x-ratelimit-remaining'],reset:last['x-ratelimit-reset']};
  }
  report.ordinary_metadata.status_unknown=report.ordinary_metadata.requests_issued-report.ordinary_metadata.observations.length;
  report.native_snapshot_transport.status_unknown=report.native_snapshot_transport.requests_issued-report.native_snapshot_transport.observations.length;
  if(report.native_snapshot_transport.status_unknown>0)report.measurement_incomplete=true;
  if(report.ordinary_metadata.status_unknown>0)report.measurement_incomplete=true;
  report.last_valid_actual_route_quota=latestQuota;
  report.quota_header_deltas_are_shared_bucket_observations=true;
  report.quota_reset_credited=false;
  if(report.demand&&latestQuota){
    report.remaining_minus_mandatory_floor=latestQuota.remaining-report.demand.unconditional_primary_lower_bound;
    report.lower_bound_exceeds_fresh_remaining=report.remaining_minus_mandatory_floor<0;
  }
  report.transport_reserve=100;
  report.first_actions_response_required_remaining=170;
  report.transport_reserve_isolation_guaranteed=false;
  report.budget_reserve_established=false;
  check(Buffer.byteLength(JSON.stringify(report))<=STDOUT_BYTES,'diagnostic-stdout-byte-bound');
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await measureBudget();
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.status!=='complete')process.exitCode=1;
}
