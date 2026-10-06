// Distinct narrow companion route. Empty controller trust admits nothing.
import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {githubApi} from './publication-gate.mjs';

const local = name => readFileSync(new URL(`../../contracts/${name}`,import.meta.url));
const referenceBytes=local('financial_source_postcapture_reference_v1.json');
const requestBytes=local('financial_source_postcapture_request_v1.json');
const schemaBytes=local('financial_source_postcapture_receipt_v1.schema.json');
const contract=JSON.parse(referenceBytes),request=JSON.parse(requestBytes);
const trust=JSON.parse(local('financial_source_postcapture_trust_v1.json'));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const commitSha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const sha256=value=>createHash('sha256').update(value).digest('hex');
const blobSha=value=>createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${value.length}\0`),value])).digest('hex');
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'
  ?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const equal=(a,b,label)=>{if(canonical(a)!==canonical(b))throw Error(`Postcapture ${label} mismatch`);};
const exact=(value,keys,label)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))throw Error(`Invalid closed ${label}`);};
const clock=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('Invalid postcapture clock');return Date.parse(value);};
const REVIEW_KEYS=['reference','tree_sha','source','request','code_manifest','controller_contracts','artifact_layout','captured_inventory_sha256','fresh_receipt_inventory_sha256'];

// Schema discriminator only. Parsing and admission are separate mandatory gates.
export const isPostcaptureReference=value=>value?.schema_version===contract.schema_version;
export function parsePostcaptureReference(value){
  exact(value,contract.reference_keys,'postcapture reference');
  if(!isPostcaptureReference(value)||value.repository!==contract.repository||value.workflow!==contract.validator_workflow
      ||!commitSha(value.head_sha)||!['run_id','run_attempt','job_id','artifact_id'].every(key=>positive(value[key]))
      ||value.artifact_name!==`${contract.artifact_prefix}-${value.head_sha}-${value.run_attempt}`
      ||!hash(value.artifact_sha256)||!hash(value.receipt_sha256))throw Error('Invalid exact postcapture reference');
  return value;
}

function collect(reference,api){
  const base=`repos/${reference.repository}/actions/runs/${reference.run_id}`;
  const bounded=(endpoint,key)=>{const result=api(endpoint);if(!Number.isSafeInteger(result.total_count)||result.total_count<0||result.total_count>100
      ||!Array.isArray(result[key])||result[key].length!==result.total_count)throw Error('Incomplete bounded postcapture API inventory');return result[key];};
  return {run:api(`${base}/attempts/${reference.run_attempt}`),jobs:bounded(`${base}/attempts/${reference.run_attempt}/jobs?per_page=100`,'jobs'),artifacts:bounded(`${base}/artifacts?per_page=100`,'artifacts')};
}

function verifySteps(job,validator){
  if(!Array.isArray(job.steps)||job.steps.length===0||job.steps.length>100||new Set(job.steps.map(step=>step.number)).size!==job.steps.length
      ||job.steps.some(step=>!positive(step.number)||step.status!=='completed'||!['success','failure','skipped'].includes(step.conclusion)
        ||typeof step.name!=='string'||clock(step.started_at)<clock(job.started_at)||clock(step.started_at)>clock(step.completed_at)||clock(step.completed_at)>clock(job.completed_at)))throw Error('Incomplete or contradictory job steps');
  if(validator){
    if(job.steps.some(step=>step.conclusion==='failure'))throw Error('Successful companion contains a failed step');
    for(const name of ['Test exact-source retrieval guards','Test offline companion validation guards','Retrieve only the exact retained source and original job log','Validate captured evidence with acquisition denied','Retain independent validation evidence']){
      const steps=job.steps.filter(step=>step.name===name);if(steps.length!==1||steps[0].conclusion!=='success')throw Error('Companion did not complete every required validation step');
    }
  }else{
    const failed=job.steps.filter(step=>step.conclusion==='failure');
    if(failed.length!==1||failed[0].number!==request.failure_boundary.failed_step_number||failed[0].name!==request.failure_boundary.failed_step_name)throw Error('Original failure boundary changed');
  }
}

function verifyAttempt(reference,evidence,validator,now){
  exact(evidence,['run','jobs','artifacts'],'postcapture API evidence');
  const {run,jobs,artifacts}=evidence;
  if(run.id!==reference.run_id||run.run_attempt!==reference.run_attempt||run.head_sha!==reference.head_sha||run.path!==reference.workflow
      ||run.head_branch!==(validator?contract.validator_branch:'improve/mandatory-financial-source-recovery')||run.event!=='push'
      ||run.status!=='completed'||run.conclusion!==(validator?'success':'failure')
      ||run.repository?.full_name!==reference.repository||run.head_repository?.full_name!==reference.repository
      ||run.repository?.id!==contract.repository_id||run.head_repository?.id!==contract.repository_id)throw Error('Exact terminal companion/source run mismatch');
  if(!Array.isArray(jobs)||jobs.length!==1||!Array.isArray(artifacts)||artifacts.length!==1)throw Error('Unexpected complete companion/source inventory');
  const job=jobs[0];
  if(job.id!==(validator?reference.job_id:request.producer_job_id)||job.name!==(validator?contract.validator_job:contract.source_job)
      ||job.run_id!==reference.run_id||job.run_attempt!==reference.run_attempt||job.head_sha!==reference.head_sha
      ||job.status!=='completed'||job.conclusion!==run.conclusion
      ||!(clock(run.run_started_at)<=clock(job.started_at)&&clock(job.started_at)<=clock(job.completed_at)&&clock(job.completed_at)<=now))throw Error('Exact terminal companion/source job mismatch');
  verifySteps(job,validator);
  const artifact=artifacts[0],binding=artifact.workflow_run;
  if(artifact.id!==reference.artifact_id||artifact.name!==reference.artifact_name||artifact.expired!==false
      ||artifact.digest!==`sha256:${reference.artifact_sha256}`||!positive(artifact.size_in_bytes)||artifact.size_in_bytes>contract.maximum_zip_bytes
      ||binding?.id!==reference.run_id||binding.head_sha!==reference.head_sha||binding.head_branch!==run.head_branch
      ||binding.repository_id!==contract.repository_id||binding.head_repository_id!==contract.repository_id
      ||!(clock(job.started_at)<=clock(artifact.created_at)&&clock(artifact.created_at)<=clock(job.completed_at))
      ||artifact.expires_at!=null&&clock(artifact.expires_at)<=now)throw Error('Exact companion/source artifact mismatch');
  if(!validator&&(artifact.size_in_bytes!==request.artifact_size_bytes||run.head_commit?.tree_id!==request.producer_tree_sha))throw Error('Original source tree/size mismatch');
  return {run,job,artifact};
}

function reviewed(reference,source,entries){
  if(!Array.isArray(entries)||entries.length>32)throw Error('Invalid finite postcapture registry');
  const matches=entries.filter(entry=>canonical(entry.reference)===canonical(reference));
  if(matches.length!==1)throw Error('Postcapture reference is not independently admitted');
  const entry=matches[0];exact(entry,REVIEW_KEYS,'postcapture review');
  equal(entry.source,source,'reviewed source');equal(source,request.source,'controller source');
  exact(entry.request,['path','raw_sha256','canonical_sha256','git_blob_sha'],'reviewed request');
  equal(entry.request,{path:'.github/financial-source-postcapture/request.json',raw_sha256:sha256(requestBytes),canonical_sha256:sha256(canonical(request)),git_blob_sha:blobSha(requestBytes)},'request code binding');
  equal(entry.controller_contracts,{reference_sha256:sha256(referenceBytes),request_sha256:sha256(requestBytes),receipt_schema_sha256:sha256(schemaBytes)},'controller contracts');
  if(!commitSha(entry.tree_sha)||!entry.code_manifest||typeof entry.code_manifest!=='object'||Array.isArray(entry.code_manifest)||Object.keys(entry.code_manifest).length!==53
      ||Object.keys(entry.code_manifest).sort().join('|')!==[...contract.required_code_paths].sort().join('|')
      ||entry.captured_inventory_sha256!==request.captured_inventory.sha256||entry.fresh_receipt_inventory_sha256!==request.refresh.new_receipt_inventory_sha256)throw Error('Incomplete reviewed code/source inventories');
  return entry;
}

function verifyCode(reference,entry,api){
  const commit=api(`repos/${reference.repository}/git/commits/${reference.head_sha}`);
  if(commit.sha!==reference.head_sha||commit.tree?.sha!==entry.tree_sha||!Array.isArray(commit.parents)||commit.parents.length!==1||commit.parents[0].sha!==request.validator.first_parent_sha)throw Error('Companion commit/tree/parent is not reviewed');
  const tree=api(`repos/${reference.repository}/git/trees/${entry.tree_sha}?recursive=1`);
  if(tree.sha!==entry.tree_sha||tree.truncated!==false||!Array.isArray(tree.tree)||tree.tree.length>100000||new Set(tree.tree.map(item=>item.path)).size!==tree.tree.length)throw Error('Incomplete or duplicate companion code tree');
  const items=new Map(tree.tree.map(item=>[item.path,item]));
  for(const [path,expected] of Object.entries(entry.code_manifest)){
    exact(expected,['sha256','git_blob_sha','bytes'],'reviewed code file');
    if(!hash(expected.sha256)||!commitSha(expected.git_blob_sha)||!positive(expected.bytes))throw Error('Malformed reviewed code file');
    const actual=items.get(path);if(actual?.type!=='blob'||actual.mode!=='100644'||actual.sha!==expected.git_blob_sha)throw Error(`Unreviewed companion code blob: ${path}`);
  }
  if(items.get(entry.request.path)?.sha!==entry.request.git_blob_sha)throw Error('Committed companion request blob differs');
  return {commit,tree};
}

export function verifyPostcaptureArchive(path,receiptSha256,reviewedEntry){
  if(reviewedEntry===undefined){
    if(!Array.isArray(trust.reviewed_requests)||trust.reviewed_requests.length>32)throw Error('Invalid finite postcapture registry');
    const matches=trust.reviewed_requests.filter(entry=>entry.reference?.receipt_sha256===receiptSha256);
    if(matches.length!==1)throw Error('Postcapture receipt is not independently admitted');
    reviewedEntry=reviewed(parsePostcaptureReference(matches[0].reference),request.source,trust.reviewed_requests);
  }
  // The subprocess has no registry parameter. Production looks up the same
  // exact receipt in the independently controlled on-disk finite registry.
  const result=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./verify-postcapture-correction-archive.py',import.meta.url)),path,receiptSha256],{encoding:'utf8',maxBuffer:16*1024*1024}));
  if(result.receipt?.validation?.tree_sha!==reviewedEntry.tree_sha)throw Error('Offline reader selected another review');
  return result;
}

export function verifyPostcaptureCorrectionSource(source,certification,api=githubApi,reviewedRequests=trust.reviewed_requests,archiveVerifier=verifyPostcaptureArchive){
  exact(certification,['reference','certificateZipPath'],'postcapture certification input');
  const reference=parsePostcaptureReference(certification.reference),entry=reviewed(reference,source,reviewedRequests);
  if(typeof certification.certificateZipPath!=='string'||!certification.certificateZipPath)throw Error('Missing companion ZIP');
  const now=Date.now(),current=verifyAttempt(reference,collect(reference,api),true,now);
  const {commit,tree}=verifyCode(reference,entry,api);
  const path=certification.certificateZipPath,info=lstatSync(path),bytes=readFileSync(path);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size!==current.artifact.size_in_bytes||bytes.length!==info.size||sha256(bytes)!==reference.artifact_sha256)throw Error('Companion ZIP byte identity mismatch');
  const verified=archiveVerifier(path,reference.receipt_sha256,entry);
  exact(verified,['receipt','source_api_evidence','validator_api_snapshot'],'offline companion result');
  const {receipt,source_api_evidence:recorded,validator_api_snapshot:snapshot}=verified;
  if(sha256(canonical(receipt))!==reference.receipt_sha256)throw Error('Offline receipt body identity mismatch');
  equal(receipt.source,source,'receipt source');
  if(receipt.validation.code_sha!==reference.head_sha||receipt.validation.tree_sha!==entry.tree_sha||receipt.validation.request_sha256!==entry.request.raw_sha256)throw Error('Receipt source/review identity mismatch');
  const evaluated=clock(receipt.evaluated_at);
  const validationStep=current.job.steps.find(step=>step.name==='Validate captured evidence with acquisition denied');
  if(!(clock(current.job.started_at)<=evaluated&&evaluated<=clock(current.artifact.created_at)
      &&clock(validationStep.started_at)<=evaluated&&evaluated<=clock(validationStep.completed_at)))throw Error('Receipt evaluation outside successful companion attempt');
  exact(snapshot,['run','job','commit','tree'],'recorded current validator API');
  for(const key of ['id','run_attempt','head_sha','path','head_branch','event','run_started_at'])equal(snapshot.run[key],current.run[key],`recorded validator run ${key}`);
  for(const key of ['id','run_id','run_attempt','head_sha','name','started_at'])equal(snapshot.job[key],current.job[key],`recorded validator job ${key}`);
  if(snapshot.run.status!=='in_progress'||snapshot.run.conclusion!==null||snapshot.job.status!=='in_progress'||snapshot.job.conclusion!==null)throw Error('Receipt fabricates its own eventual GitHub success');
  equal(snapshot.commit,commit,'recorded validator commit');equal(snapshot.tree,tree,'recorded validator tree');
  equal(receipt.validation.validator_api_snapshot,{run_id:reference.run_id,run_attempt:reference.run_attempt,job_id:reference.job_id,status:'in_progress',authentication:'provided_api_snapshot_requires_independent_authentication',successful_run_attested:false},'receipt current-run snapshot');
  const original=verifyAttempt(source,collect(source,api),false,now),saved=verifyAttempt(source,recorded,false,now);
  for(const key of ['run','job'])for(const field of ['id','run_attempt','head_sha','status','conclusion',...(key==='job'?['started_at','completed_at','steps']:['run_started_at','head_commit'])])equal(saved[key][field],original[key][field],`original ${key}.${field}`);
  for(const field of ['id','name','digest','size_in_bytes','created_at','workflow_run'])equal(saved.artifact[field],original.artifact[field],`original artifact.${field}`);
  if(clock(original.job.completed_at)>evaluated)throw Error('Receipt predates original producer completion');
  equal(receipt.producer_execution,{failed_step_number:10,original_final_guard_result:'failed',original_outcomes_retained:true,producer_batch_exit_code:0,producer_cycle_exit_code:0,producer_job_conclusion:'failure',producer_job_id:request.producer_job_id,producer_run_conclusion:'failure'},'original outcomes');
  equal(receipt.authority,request.authority,'false authority');
  if(sha256(readFileSync(path))!==reference.artifact_sha256)throw Error('Companion ZIP changed during API verification');
  return {artifact:original.artifact,job:{id:original.job.id,run_id:source.run_id,run_attempt:source.run_attempt,name:original.job.name,conclusion:original.job.conclusion},
    certification:{reference,authority:contract.authority,publication_authority:'none',
      reviewed_source_request:{tree_sha:entry.tree_sha,request_sha256:entry.request.raw_sha256,request_canonical_sha256:entry.request.canonical_sha256,request_git_blob_sha:entry.request.git_blob_sha},
      certifier_job:{id:current.job.id,run_id:reference.run_id,run_attempt:reference.run_attempt,name:current.job.name,conclusion:current.job.conclusion},receipt,
      bindings:{acquisition_base_sha256:source.acquisition_base_sha256,archive_manifest_sha256:source.archive_manifest_sha256,cohort_sha256:source.cohort_sha256,
        cycle_sha256:request.failure_boundary.cycle_sha256,batch_summary_sha256:request.failure_boundary.batch_summary_sha256,request_sha256:entry.request.raw_sha256}}};
}
