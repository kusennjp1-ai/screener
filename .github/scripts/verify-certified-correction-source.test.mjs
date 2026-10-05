import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyCorrectionSource, canonical, digest} from './financial-correction.mjs';
import {parseCertificateReference} from './verify-certified-correction-source.mjs';
import {sha256} from './publication-state.mjs';

const local = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const trust = local('../../contracts/financial_source_certification_trust_v1.json');
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

function fixture(reviewIndex = 0) {
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

test('exact successful certificate binds failed source and grants source validation only',()=>{
  const f=fixture();try{const result=f.check();assert.equal(result.job.conclusion,'failure');assert.equal(result.certification.source_execution.producer_exit_code,3);
    assert.equal(result.certification.certifier_job.conclusion,'success');assert.equal(result.certification.publication_authority,'none');
    assert.equal(result.certification.projection.cohort_count,1);assert.deepEqual(result.certification.source_timestamp_bounds,{earliest:null,latest:null});
    assert.ok(f.calls.includes(`repos/${repository}/actions/runs/${f.source.run_id}/attempts/${f.source.run_attempt}`));
    assert.throws(()=>verifyCorrectionSource(f.source,f.api),/not successful/);
  }finally{f.cleanup();}
});

test('both individually reviewed tree/request identities are accepted',()=>{
  assert.equal(trust.reviewed_requests.length,2);
  assert.deepEqual(trust.reviewed_requests.map(review=>review.request.source.run_attempt),[3,8]);
  for(const index of [0,1]){const f=fixture(index);try{
    const result=f.check();
    assert.equal(result.job.conclusion,'failure');
    assert.equal(result.job.run_attempt,[3,8][index]);
    assert.equal(result.certification.reviewed_source_request.tree_sha,f.review.tree_sha);
    assert.equal(result.certification.reviewed_source_request.request_sha256,f.review.request.canonical_sha256);
  }finally{f.cleanup();}}
});

test('the reviewed partial certificate cannot stand in for the final source',()=>{
  for(const [certificateReview,requestedReview] of [[0,1],[1,0]]){const f=fixture(certificateReview);try{
    assert.throws(()=>verifyCorrectionSource(source(requestedReview),f.api,{reference:f.reference,certificateZipPath:f.zip}),/reviewed request source/);
  }finally{f.cleanup();}}
});

test('reviewed runtime files do not authorize an unlisted request or tree',()=>{
  const f=fixture();try{
    f.tree.tree.find(item=>item.path===f.review.request.path).sha='d'.repeat(40);
    assert.throws(f.check,/committed request/);
    f.commit.tree.sha='e'.repeat(40);
    assert.throws(f.check,/tree is not independently reviewed/);
  }finally{f.cleanup();}
});

test('closed opt-in rejects blanket flags, caller trust, and incomplete references',()=>{
  const f=fixture();try{
    for(const value of [true,{accept_failed:true},{reference:f.reference,certificateZipPath:f.zip,trust}, {reference:{...f.reference,success:true},certificateZipPath:f.zip}])assert.throws(()=>verifyCorrectionSource(f.source,f.api,value));
    for(const key of Object.keys(f.reference)){const bad={...f.reference};delete bad[key];assert.throws(()=>parseCertificateReference(bad));}
  }finally{f.cleanup();}
});

for(const [label,mutate] of [
 ['repository',f=>f.reference.repository='evil/repo'],['workflow',f=>f.reference.workflow='.github/workflows/ci.yml'],['head',f=>f.reference.head_sha='d'.repeat(40)],
 ['run',f=>f.certifier.run.id++],['attempt',f=>f.certifier.run.run_attempt++],['fork',f=>f.certifier.run.head_repository.id++],['branch',f=>f.certifier.run.head_branch='main'],
 ['event',f=>f.certifier.run.event='workflow_dispatch'],['run failure',f=>f.certifier.run.conclusion='failure'],['run pending',f=>f.certifier.run.status='in_progress'],
 ['job ID',f=>f.certifier.jobs[0].id++],['job attempt',f=>f.certifier.jobs[0].run_attempt++],['job head',f=>f.certifier.jobs[0].head_sha=producerSha],
 ['job skipped',f=>f.certifier.jobs[0].conclusion='skipped'],['job pending',f=>f.certifier.jobs[0].status='in_progress'],['job duplicate',f=>f.certifier.jobs.push({...f.certifier.jobs[0]})],
 ['artifact ID',f=>f.certifier.artifacts[0].id++],['artifact hash',f=>f.certifier.artifacts[0].digest=`sha256:${H}`],['artifact expiry',f=>f.certifier.artifacts[0].expired=true],
 ['artifact expired clock',f=>f.certifier.artifacts[0].expires_at='2026-10-01T00:00:00Z'],['artifact wrong interval',f=>f.certifier.artifacts[0].created_at='2026-10-04T11:29:00Z'],
 ['artifact wrong repo',f=>f.certifier.artifacts[0].workflow_run.repository_id++],['artifact duplicate',f=>f.certifier.artifacts.push({...f.certifier.artifacts[0]})],
 ['unreviewed tree',f=>f.commit.tree.sha='d'.repeat(40)],['truncated tree',f=>f.tree.truncated=true],['changed workflow file',f=>f.tree.tree.find(item=>item.path.endsWith('financial-source-certification.yml')).sha='d'.repeat(40)],
 ['missing validation file',f=>f.tree.tree.pop()],['symlink validation file',f=>f.tree.tree[0].mode='120000'],['wrong ZIP',f=>writeFileSync(f.zip,'forged')],
 ['wrong certificate hash',f=>f.reference.certificate_sha256=H],['original outcome changed',f=>f.producer.run.conclusion='success'],
 ['original job changed',f=>f.producer.jobs[0].id++],['original artifact changed',f=>f.producer.artifacts[0].id++],['original attempt changed',f=>f.producer.run.run_attempt++],
 ['original artifact expired',f=>f.producer.artifacts[0].expired=true],['original job incomplete',f=>f.producer.jobs[0].status='in_progress'],
 ['original artifact size differs',f=>f.producer.artifacts[0].size_in_bytes++],['original artifact clock differs',f=>f.producer.artifacts[0].created_at='2026-10-04T11:28:00Z'],
])test(`certified source rejects ${label}`,()=>{const f=fixture();try{mutate(f);assert.throws(f.check);}finally{f.cleanup();}});

for(const key of Object.keys(source()))test(`certificate must equal the exact requested source ${key}`,()=>{
  const f=fixture();try{f.source[key]=typeof f.source[key]==='number'?f.source[key]+1:key==='head_sha'?'d'.repeat(40):key.endsWith('sha256')?'d'.repeat(64):`${f.source[key]}-other`;assert.throws(f.check);}finally{f.cleanup();}
});

for(const [label,mutate] of [
 ['additional certificate key',c=>c.success=true],['additional nested key',c=>c.validation.trusted=true],['changed policy',c=>c.validation.policy_sha256=H],
 ['changed contract',c=>c.validation.contract_sha256=H],['different certifier head',c=>c.validation.code_sha=producerSha],
 ['renewed source clock',c=>c.projection.source_timestamp_bounds.latest='2026-10-04T12:20:00Z'],['full coverage assertion',c=>c.projection.complete_availability_required=true],
 ['publication assertion',c=>c.published=true],['provider authority',c=>c.source_execution.further_provider_work_allowed=true],
 ['producer failure rewritten',c=>c.source_execution.producer_run_conclusion='success'],['producer exit rewritten',c=>c.source_execution.producer_exit_code=0],
 ['producer job rewritten',c=>c.source_execution.producer_job_id++],['cohort denominator narrowed',c=>c.projection.cohort_count=2],
 ['source binding changed',c=>c.bindings.cohort_sha256='d'.repeat(64)],['projection hash changed',c=>c.projection.sha256=H],
 ['outside certifier clock',c=>c.evaluated_at='2026-10-04T13:00:00Z'],
])test(`certificate rejects ${label}`,()=>{const f=fixture();try{f.update(mutate);assert.throws(f.check);}finally{f.cleanup();}});

for(const [label,mutate] of [
 ['unreviewed manifest',f=>f.files['validation-code-manifest.json']=canonical({...hashes,'evil.py':H})],
 ['changed manifest hash',f=>f.files['validation-code-manifest.json']=canonical({...hashes,[Object.keys(hashes)[0]]:H})],
 ['changed original API transcript',f=>f.files['source-api-evidence.json']=canonical({...f.producer,run:{...f.producer.run,conclusion:'success'}})],
 ['different request',f=>f.files['request.json']=canonical({schema_version:'financial-source-certification-v1',source:{...f.source,run_attempt:4}})],
 ['projection bytes',f=>f.files[f.certificate.projection.path]='{}'],
 ['duplicate JSON key',f=>f.files['certificate.json']=f.files['certificate.json'].replace('"published":false','"published":true,"published":false')],
 ['unexpected member',f=>f.files['run-me.py']='print("bad")'],
])test(`archive rejects ${label}`,()=>{const f=fixture();try{mutate(f);f.pack();assert.throws(f.check);}finally{f.cleanup();}});

test('unsafe and duplicate ZIP members fail even with updated outer artifact hashes',()=>{const f=fixture();try{
  for(const entries of [[['../outside.json','{}']],[['certificate.json',f.files['certificate.json']]]]){f.pack(entries);assert.throws(f.check);}
}finally{f.cleanup();}});

test('truncated API inventory does not authorize certification',()=>{const f=fixture();try{
  assert.throws(()=>verifyCorrectionSource(f.source,(path)=>path.includes('/jobs?')?{total_count:2,jobs:[]}:f.api(path),{reference:f.reference,certificateZipPath:f.zip}),/Incomplete bounded/);
}finally{f.cleanup();}});

test('two bounded metadata files may return more than four MiB combined',()=>{const f=fixture();try{
  const padding='x'.repeat(2300000);
  f.producer.run.extra_api_metadata=padding;
  f.files['source-api-evidence.json']=canonical(f.producer);
  f.update(c=>{
    c.bindings.source_api_evidence_sha256=sha256(f.files['source-api-evidence.json']);
    c.source_execution.failures=[{attempt_id:padding,symbol:'AAA',attribute:'income_stmt',outcome:'failed',failure_kind:'empty_getter_result',
      category:'ordinary_empty_statement',http_statuses:[200],attempted_at:'2026-10-04T11:10:00Z',completed_at:'2026-10-04T11:11:00Z',source_object_sha256:H}];
    c.source_execution.empty_getter_count=1;
  });
  assert.equal(f.check().job.conclusion,'failure');
}finally{f.cleanup();}});

test('default correction entry points retain approval checks and preview grants no publication authority',()=>{
  const controller=readFileSync(new URL('./select-release-source.mjs',import.meta.url),'utf8');
  assert.ok(!controller.includes('certificateZipPath'));assert.ok(!controller.includes('verifyCertifiedCorrectionSource'));
  for(const needle of ['verifyCorrectionChecks','verifyCorrectionConsumerChecks','verifyConsumerCapability','compareCorrectionData','previous_publication_identity'])assert.ok(controller.includes(needle));
  const preview=readFileSync(new URL('./financial-candidate-preview.mjs',import.meta.url),'utf8');
  assert.match(preview,/publication_authority: 'none'/);assert.ok(!preview.includes('certificateZipPath'));
});
