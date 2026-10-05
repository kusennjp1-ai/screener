// Test-only, synthetic certificate fixtures using controller-owned reviewed requests.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyCorrectionSource, canonical, digest} from '../financial-correction.mjs';
import {sha256} from '../publication-state.mjs';

const local = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const trust = local('../../../contracts/financial_source_certification_trust_v1.json');
const hashes = Object.fromEntries(Object.entries(trust.files).map(([path, item]) => [path, item.sha256]));
const H = 'a'.repeat(64), producerSha = trust.reviewed_requests[0].request.source.head_sha, certifierSha = 'c'.repeat(40), repository = 'kusennjp1-ai/screener';
const source = (reviewIndex = 0) => structuredClone(trust.reviewed_requests[reviewIndex].request.source);

function evidence(reference, certifier = false) {
  const start = certifier ? '2026-10-04T12:00:00Z' : '2026-10-04T11:00:00Z';
  const end = certifier ? '2026-10-04T12:30:00Z' : '2026-10-04T11:30:00Z';
  const branch = certifier ? 'preview/financial-source-certification' : 'improve/mandatory-financial-source-recovery';
  const run = {id:reference.run_id, run_attempt:reference.run_attempt, head_sha:reference.head_sha, path:reference.workflow, head_branch:branch,
    event:'push', status:'completed', conclusion:certifier ? 'success' : 'failure', run_started_at:start,
    repository:{full_name:repository, id:7}, head_repository:{full_name:repository, id:7}};
  const job = {id:certifier ? reference.job_id : 31, run_id:reference.run_id, run_attempt:reference.run_attempt, head_sha:reference.head_sha,
    name:certifier ? 'certify-source-artifacts' : 'statement-recovery', status:'completed', conclusion:run.conclusion, started_at:start, completed_at:end};
  const artifact = {id:reference.artifact_id, name:reference.artifact_name, expired:false, digest:`sha256:${reference.artifact_sha256}`, size_in_bytes:1000,
    created_at:certifier ? '2026-10-04T12:29:00Z' : '2026-10-04T11:29:00Z', expires_at:'2099-01-01T00:00:00Z',
    workflow_run:{id:reference.run_id, head_sha:reference.head_sha, head_branch:branch, repository_id:7, head_repository_id:7}};
  return {run, jobs:[job], artifacts:[artifact]};
}

export function certifiedSourceFixture(reviewIndex = 0) {
  const root = mkdtempSync(join(tmpdir(), 'certified-source-')), zip = join(root, 'certificate.zip'), src = source(reviewIndex), review = trust.reviewed_requests[reviewIndex];
  const reference = {schema_version:'financial-source-certificate-reference-v1', repository,
    workflow:'.github/workflows/financial-source-certification.yml', head_sha:certifierSha, run_id:22, run_attempt:1, job_id:41,
    artifact_id:199, artifact_name:`financial-source-certification-${certifierSha}-1`, artifact_sha256:H, certificate_sha256:H};
  const producer = evidence(src), certifier = evidence(reference, true);
  const bindings = Object.fromEntries(['archive_manifest_sha256','acquisition_base_sha256','cohort_sha256'].map(key=>[key,src[key]]));
  const classifications = {eps_growth_yy:'unknown', sales_growth_yy:'unknown', annual_history:'unknown'};
  const projection = {schema_version:'financial-source-certified-projection-v1', evaluated_at:'2026-10-04T12:20:00Z', source_data_as_of:'2026-10-02',
    knowledge_basis:'current_observation_at_source_capture', point_in_time:false, source_publication_date:null, qualification_authority:false,
    symbols:{AAA:{availability_classification:classifications}}, receipt_inventory:[], bindings};
  const counts = Object.fromEntries(Object.keys(classifications).map(field => [field, {ordinary:0, nonpositive:0, source_limited:0, unknown:1}]));
  const certificate = {schema_version:'financial-source-certification-v1', kind:'source_artifact_validation', result:'certified', evaluated_at:projection.evaluated_at,
    validation:{code_sha:certifierSha, contract_version:'financial-source-certification-v1', contract_sha256:hashes['contracts/financial_source_certification_v1.json'],
      projection_policy:'original-receipts-current-availability-v1', policy_sha256:digest(hashes), reviewed_projector_migrations:[]},
    source:structuredClone(src), bindings:{...bindings, cycle_sha256:H, source_api_evidence_sha256:digest(producer), request_sha256:digest({schema_version:'financial-source-certification-v1', source:src})},
    projection:{schema_version:projection.schema_version, path:`projections/${digest(projection)}.json`, sha256:digest(projection), receipt_inventory_sha256:digest([]),
      source_timestamp_bounds:{earliest:null,latest:null}, counts, cohort_count:1, retained_receipts:0, retained_symbols:0, attempted_symbols:1, source_data_as_of:projection.source_data_as_of,
      knowledge_basis:projection.knowledge_basis, point_in_time:false, source_publication_date:null, qualification_authority:false, complete_availability_required:false},
    source_execution:{producer_run_conclusion:'failure', producer_job_conclusion:'failure', producer_job_id:31, producer_exit_code:3,
      provider_state:'no_block_observed', provider_failures:[], failures:[], empty_getter_count:0, unknown_failure_count:0, attempt_outcome_counts:{failed:1},
      further_provider_work_allowed:false, original_outcomes_retained:true, certification_is_complete_availability:false, failure_inventory_scope:'cumulative_archive',
      producer_batch:{summary_sha256:H, plan_sha256:H, attempts_sha256:H, statement_getter_calls:1, empty_getter_count:0, unknown_failure_count:0, attempt_outcome_counts:{failed:1}}}, published:false};
  const files = {'certificate.json':canonical(certificate), 'request.json':canonical({schema_version:'financial-source-certification-v1',source:src}),
    'source-api-evidence.json':canonical(producer), 'validation-code-manifest.json':canonical(hashes), [certificate.projection.path]:canonical(projection)};
  const commit = {sha:certifierSha, tree:{sha:review.tree_sha}};
  const tree = {sha:review.tree_sha, truncated:false, tree:[...Object.entries(trust.files).map(([path,item])=>({path,type:'blob',mode:'100644',sha:item.git_blob_sha})), {path:review.request.path,type:'blob',mode:'100644',sha:review.request.git_blob_sha}]};
  const calls = [];
  function pack(extraMembers = []) {
    execFileSync('python3', ['-c', 'import json,sys,zipfile\nx=json.load(sys.stdin)\nwith zipfile.ZipFile(sys.argv[1],"w",compression=zipfile.ZIP_DEFLATED) as z:\n for k,v in x:z.writestr(k,v)', zip],
      {input:JSON.stringify([...Object.entries(files),...extraMembers]),stdio:['pipe','pipe','pipe']});
    const bytes = readFileSync(zip);
    reference.artifact_sha256=sha256(bytes); reference.certificate_sha256=sha256(files['certificate.json']);
    Object.assign(certifier.artifacts[0], {digest:`sha256:${reference.artifact_sha256}`,size_in_bytes:bytes.length});
  }
  const api = (endpoint, paginate = false) => {
    calls.push(endpoint);
    if(endpoint === `repos/${repository}/git/commits/${certifierSha}`) return commit;
    if(endpoint === `repos/${repository}/git/trees/${review.tree_sha}?recursive=1`) return tree;
    for(const [ref,value] of [[src,producer],[reference,certifier]]) {
      const base=`repos/${repository}/actions/runs/${ref.run_id}`;
      if(endpoint === `${base}/attempts/${ref.run_attempt}`) return value.run;
      if(endpoint === `${base}/attempts/${ref.run_attempt}/jobs?per_page=100`) return paginate ? [{jobs:value.jobs}] : {total_count:value.jobs.length,jobs:value.jobs};
      if(endpoint === `${base}/artifacts?per_page=100`) return paginate ? [{artifacts:value.artifacts}] : {total_count:value.artifacts.length,artifacts:value.artifacts};
    }
    throw Error(`Unexpected API endpoint ${endpoint}`);
  };
  pack();
  return {root,zip,source:src,review,reference,producer,certifier,certificate,projection,files,commit,tree,calls,pack,api,
    check:()=>verifyCorrectionSource(src,api,{reference,certificateZipPath:zip}),
    update(fn){fn(certificate);files['certificate.json']=canonical(certificate);pack();},
    cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

