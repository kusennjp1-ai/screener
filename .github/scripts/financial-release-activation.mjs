// Publication authority comes only from current-main gates and immutable tested
// artifacts. A preview or source certificate never grants that authority.
import { execFileSync } from 'node:child_process';
import { appendFileSync, closeSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contract, digest, parseCorrectionIntent, verifyCorrectionSource, verifyCorrectionChecks, verifyCorrectionConsumerChecks, dataInventory, verifyConsumerCapability, restoreCorrectionSource } from './financial-correction.mjs';
import { comparePreviewDataIsolated } from './financial-preview-comparison.mjs';
import { parseCertifiedPreviewSelection, CERTIFIED_PREVIEW_SCHEMA, NATIVE_PROJECTOR_PATH } from './financial-candidate-preview-v2.mjs';
import { bootstrap, downloadArtifact, inventoryDigest, livePublication, safePath, sha256, uiInventory } from './publication-state.mjs';
import { githubApi, sameRepository } from './publication-gate.mjs';
import { priceObservationDigest, extractPriceObservations } from './price-observations.mjs';
import { uniqueArtifact } from './select-published-runs.mjs';
import policy from '../../contracts/financial_release_v1.json' with { type: 'json' };

export { policy as financialReleasePolicy };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const identity = value => typeof value === 'string' && /^[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(value);
const exact = (value, keys, name) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw Error(`Invalid closed financial release ${name}`); };
const equal = (a, b, message) => { if (digest(a) !== digest(b)) throw Error(`Financial release ${message} mismatch`); };
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => { mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, JSON.stringify(value)); };
const git = (root, args) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const scratch = () => join(process.env.RUNNER_TEMP || '/tmp', 'financial-release-candidate');

export function parseFinancialReleaseRequest(value) {
  exact(value, ['schema_version','correction','source_validation','destination_projection'], 'request');
  if (value.schema_version !== 'financial-release-request-v1') throw Error('Unknown financial release request');
  parseCorrectionIntent(JSON.stringify(value.correction));
  parseCertifiedPreviewSelection(value.source_validation, value.destination_projection);
  return value;
}
export function readFinancialReleaseRequest(root = process.cwd()) {
  const path=join(root,policy.request_path);
  let stat;try{stat=lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('Invalid financial release request file');
  return parseFinancialReleaseRequest(read(path));
}
export function parseFinancialActivationCandidate(value) {
  exact(value,['schema_version','repository','workflow','head_sha','run_id','run_attempt','job_id','artifact_id','artifact_name','artifact_sha256','candidate_record_sha256','projection_sha256','preview_receipt_sha256'],'activation pin');
  if(value.schema_version!=='financial-activation-candidate-v1'||value.repository!==bootstrap.repository||value.workflow!==policy.candidate_workflow
    ||!sha(value.head_sha)||!['run_id','run_attempt','job_id','artifact_id'].every(key=>positive(value[key]))
    ||value.artifact_name!==`financial-release-candidate-${value.run_id}-${value.run_attempt}`
    ||!['artifact_sha256','candidate_record_sha256','projection_sha256','preview_receipt_sha256'].every(key=>hash(value[key])))throw Error('Invalid pinned financial candidate');
  return value;
}
export function readFinancialActivationCandidate(root=process.cwd()) {
  const path=join(root,policy.activation_candidate_path);
  let stat;try{stat=lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('Invalid financial activation pin file');
  return parseFinancialActivationCandidate(read(path));
}
export function protectedCodeInventory(root, revision) {
  if(!sha(revision))throw Error('Invalid protected code revision');
  const files={};
  for(const record of git(root,['ls-tree','-r',revision]).split('\n')) {
    const match=/^([0-7]+) (blob|tree|commit) ([a-f0-9]{40})\t(.+)$/.exec(record);
    if(!match)throw Error('Invalid protected Git tree');
    const [,mode,type,id,path]=match;
    if(!policy.protected_prefixes.some(prefix=>path.startsWith(prefix)))continue;
    if(type!=='blob'||!['100644','100755'].includes(mode)||!safePath(path))throw Error('Linked or unsupported protected source');
    files[path]={mode,sha:id};
  }
  if(!files['frontend/package-lock.json']||!files[NATIVE_PROJECTOR_PATH])throw Error('Incomplete protected source inventory');
  return files;
}
export function completeInventory(root) {
  const files={};
  const walk=(directory,prefix='')=>{for(const entry of readdirSync(directory,{withFileTypes:true})){
    const path=prefix+entry.name;if(!safePath(path))throw Error('Unsafe candidate path');
    if(entry.isDirectory())walk(join(directory,entry.name),`${path}/`);
    else if(entry.isFile())files[path]=sha256(readFileSync(join(directory,entry.name)));
    else throw Error('Candidate contains a link or special file');
  }};walk(root);return files;
}
export function validateCandidateRecord(record) {
  exact(record,['schema_version','producer','captured_ui','request_sha256','preview_receipt_sha256','corrected_inventory_sha256','protected_code_sha256'],'candidate record');
  exact(record.producer,['repository','workflow','head_sha','run_id','run_attempt'],'producer');
  exact(record.captured_ui,['sha','tree','digest'],'captured UI');
  if(record.schema_version!=='financial-release-candidate-v1'||record.producer.repository!==bootstrap.repository||record.producer.workflow!==policy.candidate_workflow
    ||!sha(record.producer.head_sha)||!positive(record.producer.run_id)||!positive(record.producer.run_attempt)||!sha(record.captured_ui.sha)||!sha(record.captured_ui.tree)
    ||!['request_sha256','preview_receipt_sha256','corrected_inventory_sha256','protected_code_sha256'].every(key=>hash(record[key]))||!hash(record.captured_ui.digest))throw Error('Invalid financial candidate identity');
  return record;
}
export function verifyCandidateAttempt({artifact,run,jobs,record,mainSha,approval,now=Date.now()}) {
  const reference=approval?.runs?.find(item=>item.path===policy.candidate_workflow);
  if(approval?.type!=='gates'||approval.sha!==mainSha||!reference||reference.id!==run.id||reference.attempt!==run.run_attempt
    ||run.head_sha!==mainSha)throw Error('Candidate lacks the exact current-main Design gate');
  return verifyCandidateArtifactAttempt({artifact,run,jobs,record,now});
}
function verifyCandidateArtifactAttempt({artifact,run,jobs,record,now=Date.now()}) {
  validateCandidateRecord(record);
  if(run.id!==record.producer.run_id||run.run_attempt!==record.producer.run_attempt||record.producer.head_sha!==run.head_sha
    ||!sameRepository(run,bootstrap.repository)||run.path!==policy.candidate_workflow||run.head_branch!=='main'||run.event!=='push'||run.status!=='completed'||run.conclusion!=='success')throw Error('Candidate lacks the exact current-main Design gate');
  const matching=jobs.filter(job=>job.name===policy.candidate_job&&job.run_attempt===run.run_attempt);
  if(matching.length!==1||!positive(matching[0].id)||matching[0].run_id!==run.id||matching[0].head_sha!==run.head_sha||matching[0].status!=='completed'||matching[0].conclusion!=='success')throw Error('Candidate Design job is not successful');
  const job=matching[0];
  for(const name of policy.candidate_steps){const steps=(job.steps||[]).filter(step=>step.name===name);if(steps.length!==1||steps[0].conclusion!=='success')throw Error(`Candidate was not tested: ${name}`);}
  const clocks=[job.started_at,job.completed_at,artifact.created_at].map(Date.parse);
  if(!positive(artifact.id)||artifact.name!==`financial-release-candidate-${run.id}-${run.run_attempt}`||artifact.expired!==false
    ||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest||'')||!positive(artifact.size_in_bytes)||artifact.size_in_bytes>policy.maximum_archive_bytes
    ||artifact.workflow_run?.id!==run.id||artifact.workflow_run?.head_sha!==run.head_sha||clocks.some(value=>!Number.isFinite(value))
    ||!Number.isFinite(Date.parse(run.run_started_at))||Date.parse(run.run_started_at)>clocks[0]||clocks[0]>clocks[1]
    ||clocks[2]<clocks[0]||clocks[2]>clocks[1]||clocks[1]>now||artifact.expires_at&&(!Number.isFinite(Date.parse(artifact.expires_at))||Date.parse(artifact.expires_at)<=now))throw Error('Candidate artifact is not bound to its exact tested attempt');
  return {repository:bootstrap.repository,workflow:policy.candidate_workflow,head_sha:run.head_sha,run_id:run.id,run_attempt:run.run_attempt,job_id:job.id,
    artifact_id:artifact.id,artifact_name:artifact.name,artifact_sha256:artifact.digest.slice(7),candidate_receipt_sha256:record.preview_receipt_sha256,record_sha256:digest(record)};
}
export function verifyPinnedCandidateAttempt({pin,recordBytes,artifact,run,jobs,now=Date.now()}) {
  parseFinancialActivationCandidate(pin);
  const record=validateCandidateRecord(JSON.parse(recordBytes));
  if(sha256(recordBytes)!==pin.candidate_record_sha256||record.captured_ui.sha!==record.producer.head_sha)throw Error('Pinned original candidate record changed');
  const reference=verifyCandidateArtifactAttempt({artifact,run,jobs,record,now});
  for(const key of ['repository','workflow','head_sha','run_id','run_attempt','job_id','artifact_id','artifact_name','artifact_sha256'])if(reference[key]!==pin[key])throw Error(`Pinned candidate ${key} changed`);
  if(record.preview_receipt_sha256!==pin.preview_receipt_sha256)throw Error('Pinned preview receipt changed');
  return record;
}
export function verifyPinnedCandidateBindings({pin,record,originalRecordBytes,previewReceiptBytes,projectionBytes}) {
  parseFinancialActivationCandidate(pin);validateCandidateRecord(record);
  const original=validateCandidateRecord(JSON.parse(originalRecordBytes));
  if(sha256(originalRecordBytes)!==pin.candidate_record_sha256||sha256(previewReceiptBytes)!==pin.preview_receipt_sha256
    ||sha256(projectionBytes)!==pin.projection_sha256)throw Error('Pinned candidate bytes changed');
  equal(original.producer,{repository:pin.repository,workflow:pin.workflow,head_sha:pin.head_sha,run_id:pin.run_id,run_attempt:pin.run_attempt},'original candidate producer');
  if(original.captured_ui.sha!==original.producer.head_sha)throw Error('An activation pin must identify the original capture');
  for(const key of Object.keys(original).filter(key=>key!=='producer'))equal(record[key],original[key],`retained candidate ${key}`);
  const receipt=JSON.parse(previewReceiptBytes);
  if(record.preview_receipt_sha256!==pin.preview_receipt_sha256||receipt.financial?.projection_sha256!==pin.projection_sha256)throw Error('Pinned projection/receipt binding changed');
  equal(receipt.candidate_ui,original.captured_ui,'original captured UI');
  return original;
}
function verifyPinnedCandidateBundle(pin,candidate,record) {
  equal(read(join(candidate,'activation-candidate.json')),pin,'activation pin');
  const projections=Object.entries(completeInventory(join(candidate,'projection'))).filter(([,checksum])=>checksum===pin.projection_sha256);
  if(projections.length!==1)throw Error('Pinned destination projection missing or ambiguous');
  return verifyPinnedCandidateBindings({pin,record,originalRecordBytes:readFileSync(join(candidate,'captured-candidate.json')),
    previewReceiptBytes:readFileSync(join(candidate,'preview-receipt.json')),projectionBytes:readFileSync(join(candidate,'projection',projections[0][0]))});
}
function pinnedCandidateEvidence(pin,api=githubApi) {
  const evidence=attemptEvidence(pin,api),artifacts=evidence.artifacts.filter(item=>item.id===pin.artifact_id||item.name===pin.artifact_name);
  if(artifacts.length!==1)throw Error('Pinned candidate artifact missing or ambiguous');
  return {artifact:artifacts[0],run:evidence.run,jobs:evidence.jobs};
}
export function extractCandidateTar(archive, root) {
  mkdirSync(root,{recursive:true});
  execFileSync('python3',['-c',`import tarfile,pathlib,sys,shutil
root=pathlib.Path(sys.argv[2]);seen=set();total=0
with tarfile.open(sys.argv[1]) as t:
 for m in t:
  n=m.name
  while n.startswith('./'):n=n[2:]
  n=n.rstrip('/')
  if not n or n=='.':continue
  assert not n.startswith('/') and '\\\\' not in n and all(p not in ('','.','..') for p in n.split('/')) and n not in seen,'Unsafe or duplicate candidate member'
  assert m.isfile() or m.isdir(),'Linked or special candidate member'
  seen.add(n);total+=m.size
  assert len(seen)<=int(sys.argv[3]) and total<=int(sys.argv[4]),'Candidate archive exceeds bounds'
  p=root/n
  if m.isdir():p.mkdir(parents=True,exist_ok=True)
  else:
   p.parent.mkdir(parents=True,exist_ok=True)
   with t.extractfile(m) as source,p.open('xb') as target:shutil.copyfileobj(source,target)
`,archive,root,String(policy.maximum_archive_files),String(policy.maximum_archive_bytes)],{stdio:'pipe'});
}
function downloadZip(reference,path) {
  mkdirSync(dirname(path),{recursive:true});const fd=openSync(path,'wx');
  try{execFileSync('gh',['api',`repos/${reference.repository}/actions/artifacts/${reference.artifact_id}/zip`],{stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
  if(sha256(readFileSync(path))!==reference.artifact_sha256)throw Error('Pinned source/certificate ZIP changed');
}
function attemptEvidence(reference,api=githubApi,certifier=false) {
  const base=`repos/${reference.repository}/actions/runs/${reference.run_id}`;
  const result={run:api(`${base}/attempts/${reference.run_attempt}`),jobs:api(`${base}/attempts/${reference.run_attempt}/jobs?per_page=100`,true).flatMap(page=>page.jobs),artifacts:api(`${base}/artifacts?per_page=100`,true).flatMap(page=>page.artifacts)};
  if(certifier){result.commit=api(`repos/${reference.repository}/git/commits/${reference.head_sha}`);result.tree=api(`repos/${reference.repository}/git/trees/${result.commit.tree.sha}?recursive=1`);}
  return result;
}

export async function prepareDesignCandidate(root=process.cwd()) {
  const request=readFinancialReleaseRequest(root),pin=readFinancialActivationCandidate(root);
  if(pin&&!request)throw Error('Activation pin has no release request');
  if(!request){if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'candidate=false\n');return null;}
  const live=await livePublication();
  if(live.financialRelease&&digest(live.financialRelease.lineage.source)===digest(request.correction.source)
    &&digest(live.financialRelease.lineage.certificate)===digest(request.source_validation.certificate)){
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'candidate=false\n');return null;
  }
  if(live.identity!==request.correction.previous_publication_identity)throw Error('Candidate predecessor was superseded');
  if(pin)return restorePinnedDesignCandidate({root,request,pin,live});
  const out=scratch(), inputs=join(out,'inputs');mkdirSync(inputs,{recursive:true});
  const pages=githubApi(`repos/${bootstrap.repository}/actions/artifacts?per_page=100`,true);
  const predecessor=live.receipt?uniqueArtifact(pages,live.receipt.artifact_name,live.receipt.run_id):live.legacyArtifact;
  if(!predecessor)throw Error('Candidate requires the complete immutable predecessor');
  downloadArtifact(predecessor,join(inputs,'predecessor'),bootstrap.repository);
  // Preview verifies and extracts its own retained ZIP. Do not keep a second
  // predecessor-sized TAR throughout the two candidate builds.
  rmSync(join(inputs,'predecessor/artifact.tar'));
  const source=request.correction.source,certificate=request.source_validation.certificate;
  downloadZip(source,join(inputs,'source.zip'));downloadZip(certificate,join(inputs,'certificate.zip'));
  const revision=git(root,['rev-parse','HEAD']),tree=git(root,['rev-parse','HEAD^{tree}']);
  const preview={schema_version:CERTIFIED_PREVIEW_SCHEMA,kind:'unpublished_financial_candidate',candidate_ui:{sha:revision,tree},correction:request.correction,source_validation:request.source_validation,destination_projection:request.destination_projection};
  write(join(inputs,'request.json'),preview);write(join(inputs,'evidence.json'),{live,predecessor_artifact:predecessor,source:attemptEvidence(source),certifier:attemptEvidence(certificate,githubApi,true)});
  const {preparePreview}=await import('./financial-candidate-preview.mjs');
  const result=await preparePreview({requestPath:join(inputs,'request.json'),evidencePath:join(inputs,'evidence.json'),candidateRoot:root,
    predecessorZip:join(inputs,'predecessor/artifact.zip'),sourceZip:join(inputs,'source.zip'),certificateZip:join(inputs,'certificate.zip'),output:join(out,'prepared'),python:process.env.FINANCIAL_REPLAY_PYTHON||process.env.FINANCIAL_CORRECTION_PYTHON||'python3'});
  write(join(out,'prepared/release-request.json'),request);
  write(join(out,'prepared/protected-code.json'),protectedCodeInventory(root,revision));
  rmSync(inputs,{recursive:true,force:true});
  rmSync(join(out,'prepared/candidate-source'),{recursive:true,force:true});
  rmSync(join(out,'prepared/candidate-source.tar'),{force:true});
  // The workflow measures this exact directory and seals it only afterwards.
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`candidate=true\npath=${out}/prepared\n`);
  if(process.env.GITHUB_ENV)appendFileSync(process.env.GITHUB_ENV,`FINANCIAL_CANDIDATE_DIR=${out}/prepared\n`);
  return result;
}

export async function restorePinnedDesignCandidate({root,request,pin,live,api=githubApi}) {
  const out=scratch(),candidate=join(out,'prepared'),directory=join(out,'pinned-input');
  const evidence=pinnedCandidateEvidence(pin,api);
  const record=restorePinnedCandidateArchive({pin,evidence,directory,candidate});
  equal(read(join(candidate,'protected-code.json')),protectedCodeInventory(root,git(root,['rev-parse','HEAD'])),'retained protected UI/projector code equivalence');
  rmSync(directory,{recursive:true,force:true});
  const result=await verifyCandidatePayload({candidate,request,record},live,root,api);
  // Design uses this reconstructed exact predecessor only for its comparison
  // baseline. The corrected directory and original evaluation clock stay put.
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`candidate=true\npath=${candidate}\n`);
  if(process.env.GITHUB_ENV)appendFileSync(process.env.GITHUB_ENV,`FINANCIAL_CANDIDATE_DIR=${candidate}\n`);
  return result;
}

export function restorePinnedCandidateArchive({pin,evidence,directory,candidate}) {
  parseFinancialActivationCandidate(pin);
  // Metadata must agree before download; downloadArtifact checks the ZIP bytes.
  if(evidence.artifact.digest!==`sha256:${pin.artifact_sha256}`||evidence.artifact.id!==pin.artifact_id)throw Error('Pinned candidate ZIP changed');
  downloadArtifact(evidence.artifact,directory,bootstrap.repository,'candidate.tar',policy.maximum_archive_bytes);
  rmSync(candidate,{recursive:true,force:true});extractCandidateTar(join(directory,'candidate.tar'),candidate);
  if(existsSync(join(candidate,'captured-candidate.json'))||existsSync(join(candidate,'activation-candidate.json')))throw Error('Activation handoff cannot chain another handoff');
  const recordBytes=readFileSync(join(candidate,'candidate.json'));
  const record=verifyPinnedCandidateAttempt({pin,recordBytes,...evidence});
  cpSync(join(candidate,'candidate.json'),join(candidate,'captured-candidate.json'));write(join(candidate,'activation-candidate.json'),pin);
  verifyPinnedCandidateBundle(pin,candidate,record);
  return record;
}

export async function sealDesignCandidate(root=process.cwd(),candidate=process.env.FINANCIAL_CANDIDATE_DIR) {
  if(!candidate)throw Error('Missing tested candidate directory');
  const testedSha=git(root,['rev-parse','HEAD']);
  if(process.env.GITHUB_SHA!==testedSha)throw Error('Design producer must be the actual tested checkout');
  const {validatePreviewReceipt}=await import('./financial-candidate-preview.mjs');
  const receiptBytes=readFileSync(join(candidate,'preview-receipt.json')),receipt=validatePreviewReceipt(JSON.parse(receiptBytes));
  if(receipt.schema_version!==CERTIFIED_PREVIEW_SCHEMA||existsSync(join(candidate,'corrected/publication.json')))throw Error('Only an unpublished certified candidate can be sealed');
  if(inventoryDigest(dataInventory(join(candidate,'corrected')))!==receipt.bundles.corrected_data_sha256||inventoryDigest(uiInventory(join(candidate,'corrected')))!==receipt.candidate_ui.digest)throw Error('Design testing changed candidate bytes');
  const record=validateCandidateRecord({schema_version:'financial-release-candidate-v1',producer:{repository:bootstrap.repository,workflow:policy.candidate_workflow,head_sha:testedSha,run_id:Number(process.env.GITHUB_RUN_ID),run_attempt:Number(process.env.GITHUB_RUN_ATTEMPT)},captured_ui:receipt.candidate_ui,
    request_sha256:digest(read(join(candidate,'release-request.json'))),preview_receipt_sha256:sha256(receiptBytes),corrected_inventory_sha256:inventoryDigest(completeInventory(join(candidate,'corrected'))),protected_code_sha256:digest(protectedCodeInventory(root,receipt.candidate_ui.sha))});
  equal(read(join(candidate,'protected-code.json')),protectedCodeInventory(root,receipt.candidate_ui.sha),'captured protected source');
  equal(read(join(candidate,'protected-code.json')),protectedCodeInventory(root,testedSha),'tested protected source');
  const pin=readFinancialActivationCandidate(root);
  if(pin)verifyPinnedCandidateBundle(pin,candidate,record);
  else if(existsSync(join(candidate,'activation-candidate.json'))||existsSync(join(candidate,'captured-candidate.json')))throw Error('Retained candidate lost its activation pin');
  write(join(candidate,'candidate.json'),record);
  const archive=join(dirname(candidate),'candidate.tar');
  const members=['candidate.json','release-request.json','protected-code.json','preview-receipt.json','verification.json','request.json','evidence.json','target-base.json','projection','corrected','baseline','original-source','original-certification','original-predecessor'];
  if(pin)members.push('captured-candidate.json','activation-candidate.json');
  // Validate before tar: never follow symlinks or archive arbitrary extra paths.
  for(const member of members){const path=join(candidate,member);if(lstatSync(path).isDirectory())completeInventory(path);else if(!lstatSync(path).isFile())throw Error('Special candidate audit file');}
  execFileSync('tar',['-cf',archive,'-C',candidate,...members],{stdio:'pipe'});
  return record;
}

export async function selectActivationCandidate({live,request,mainSha,approval,pages,root=process.cwd(),pin=readFinancialActivationCandidate(root),api=githubApi,directory=join(process.env.RUNNER_TEMP||'/tmp','verified-publication/activation')}) {
  parseFinancialReleaseRequest(request);
  parseFinancialActivationCandidate(pin);
  if(live.identity!==request.correction.previous_publication_identity)throw Error('Activation predecessor was superseded');
  const design=approval?.runs?.find(item=>item.path===policy.candidate_workflow);
  if(!design)throw Error('Activation requires current-main CI and Design');
  const artifact=uniqueArtifact(pages,`financial-release-candidate-${design.id}-${design.attempt}`,design.id);
  const run=api(`repos/${bootstrap.repository}/actions/runs/${design.id}/attempts/${design.attempt}`);
  const jobs=api(`repos/${bootstrap.repository}/actions/runs/${design.id}/attempts/${design.attempt}/jobs?per_page=100`,true).flatMap(page=>page.jobs);
  downloadArtifact(artifact,directory,bootstrap.repository,'candidate.tar',policy.maximum_archive_bytes);
  const candidate=join(directory,'files');rmSync(candidate,{recursive:true,force:true});extractCandidateTar(join(directory,'candidate.tar'),candidate);
  const record=read(join(candidate,'candidate.json'));
  const reference=verifyCandidateAttempt({artifact,run,jobs,record,mainSha,approval});
  equal(request,read(join(candidate,'release-request.json')),'requested candidate');
  if(record.request_sha256!==digest(request)||record.protected_code_sha256!==digest(read(join(candidate,'protected-code.json'))))throw Error('Candidate request/code binding changed');
  equal(read(join(candidate,'protected-code.json')),protectedCodeInventory(root,mainSha),'protected UI/projector code equivalence');
  const checks=verifyCorrectionChecks(bootstrap.repository,mainSha,api);
  const consumerChecks=verifyCorrectionConsumerChecks({uiSha:mainSha,approval},bootstrap.repository,api);
  const state={candidate,reference,record,checks,consumerChecks,request,pin,mainSha,approval};
  await verifyActivationCandidate(state,live,root,api);
  return state;
}

export async function verifyActivationCandidate(state,live,root=process.cwd(),api=githubApi) {
  const {candidate,request,record}=state;
  if(live.identity!==request.correction.previous_publication_identity)throw Error('Activation predecessor was superseded');
  equal(read(join(candidate,'candidate.json')),record,'sealed candidate record');
  equal(readFinancialActivationCandidate(root),state.pin,'current activation pin');
  verifyPinnedCandidateBundle(state.pin,candidate,record);
  verifyPinnedCandidateAttempt({pin:state.pin,recordBytes:readFileSync(join(candidate,'captured-candidate.json')),...pinnedCandidateEvidence(state.pin,api)});
  const runBase=`repos/${bootstrap.repository}/actions/runs/${state.reference.run_id}`;
  const run=api(`${runBase}/attempts/${state.reference.run_attempt}`);
  const jobs=api(`${runBase}/attempts/${state.reference.run_attempt}/jobs?per_page=100`,true).flatMap(page=>page.jobs);
  const artifacts=api(`${runBase}/artifacts?per_page=100`,true).flatMap(page=>page.artifacts).filter(item=>item.name===state.reference.artifact_name);
  if(artifacts.length!==1)throw Error('Candidate artifact disappeared or became ambiguous');
  equal(verifyCandidateAttempt({artifact:artifacts[0],run,jobs,record,mainSha:state.mainSha,approval:state.approval}),state.reference,'current candidate authority');
  equal(read(join(candidate,'protected-code.json')),protectedCodeInventory(root,state.mainSha),'current protected source');
  equal(verifyCorrectionChecks(bootstrap.repository,state.mainSha,api),state.checks,'current controller checks');
  equal(verifyCorrectionConsumerChecks({uiSha:state.mainSha,approval:state.approval},bootstrap.repository,api),state.consumerChecks,'current consumer checks');
  return verifyCandidatePayload(state,live,root,api);
}

async function verifyCandidatePayload(state,live,root,api) {
  const {candidate,request,record}=state;
  if(live.identity!==request.correction.previous_publication_identity)throw Error('Candidate predecessor was superseded');
  if(git(root,['rev-parse',`${record.captured_ui.sha}^{tree}`])!==record.captured_ui.tree)throw Error('Captured consumer commit/tree changed');
  equal(read(join(candidate,'protected-code.json')),protectedCodeInventory(root,record.captured_ui.sha),'captured source Git objects');
  equal(request,read(join(candidate,'release-request.json')),'requested candidate');
  if(record.request_sha256!==digest(request)||record.protected_code_sha256!==digest(read(join(candidate,'protected-code.json'))))throw Error('Candidate request/code binding changed');
  const {validatePreviewReceipt,verifyExistingPredecessor,verifyPredecessor}=await import('./financial-candidate-preview.mjs');
  const receiptBytes=readFileSync(join(candidate,'preview-receipt.json')),receipt=validatePreviewReceipt(JSON.parse(receiptBytes));
  if(receipt.schema_version!==CERTIFIED_PREVIEW_SCHEMA||sha256(receiptBytes)!==record.preview_receipt_sha256||digest(receipt.candidate_ui)!==digest(record.captured_ui)
    ||receipt.previous_publication.identity!==live.identity||receipt.financial.generation===live.receipt?.financial_generation)throw Error('Activation preview identity/progress changed');
  if(sha256(readFileSync(join(candidate,'verification.json')))!==receipt.verification_sha256||sha256(readFileSync(join(candidate,'evidence.json')))!==receipt.source_evidence_sha256)throw Error('Activation evidence changed');
  equal(receipt.source,request.correction.source,'preview source');
  equal(receipt.source_validation.certificate.reference,request.source_validation.certificate,'preview certificate');
  if(inventoryDigest(completeInventory(join(candidate,'corrected')))!==record.corrected_inventory_sha256||inventoryDigest(dataInventory(join(candidate,'corrected')))!==receipt.bundles.corrected_data_sha256
    ||inventoryDigest(dataInventory(join(candidate,'baseline')))!==receipt.bundles.baseline_data_sha256||inventoryDigest(uiInventory(join(candidate,'corrected')))!==receipt.candidate_ui.digest)throw Error('Tested candidate bytes changed');
  const certified=verifyCorrectionSource(request.correction.source,api,{reference:request.source_validation.certificate,certificateZipPath:join(candidate,'original-certification/artifact.zip')});
  equal(certified.certification,receipt.source_validation.certificate,'current source certification');
  const sourceRoot=restoreCorrectionSource(request.correction.source,join(candidate,'original-source'),certified);
  const evidence=read(join(candidate,'evidence.json')),prior=join(candidate,'predecessor');
  if(!existsSync(prior)){mkdirSync(prior,{recursive:true});const zipdir=join(candidate,'original-predecessor');downloadArtifact(evidence.predecessor_artifact,zipdir,bootstrap.repository);extractCandidateTar(join(zipdir,'artifact.tar'),prior);rmSync(join(zipdir,'artifact.tar'));}
  verifyExistingPredecessor(join(candidate,'original-predecessor/artifact.zip'),prior,evidence.predecessor_artifact);
  verifyPredecessor(prior,live,evidence.predecessor_artifact,live.identity);
  const frontend=join(root,'frontend');
  const {compareCandidateBaselineData}=await import('./financial-candidate-baseline.mjs');
  // Finish the full compiler proof before retaining the large native projection.
  const baseline=await compareCandidateBaselineData(prior,join(candidate,'baseline'),frontend);
  const target=join(candidate,'target-base.json'),source=request.correction.source;
  const replay=JSON.parse(execFileSync(process.env.FINANCIAL_REPLAY_PYTHON||process.env.FINANCIAL_CORRECTION_PYTHON||'python3',[join(root,NATIVE_PROJECTOR_PATH),'--archive',join(sourceRoot,'archive'),'--archive-sha256',source.archive_manifest_sha256,
    '--base',join(sourceRoot,'base.json'),'--cohort',join(sourceRoot,'cohort.json'),'--cohort-sha256',source.cohort_sha256,'--target-base',target,'--target-base-sha256',sha256(readFileSync(target)),
    '--target-publication-identity',live.identity,'--evaluated-at',receipt.financial.evaluated_at,'--output-dir',join(dirname(candidate),'replayed-projection')],{encoding:'utf8',maxBuffer:2*1024*1024,env:{...process.env,PYTHONPATH:join(root,'backend'),LITELLM_LOCAL_MODEL_COST_MAP:'true'}}));
  if(replay.projection_sha256!==receipt.financial.projection_sha256)throw Error('Candidate financial projection is not independently reproducible');
  const projection=read(replay.projection_path);
  if(live.financialRelease&&projection.receipt_inventory_sha256===live.financialRelease.lineage.receipt_inventory_sha256)throw Error('Activation has no new independently sourced receipt inventory');
  const correction=comparePreviewDataIsolated(join(candidate,'baseline'),join(candidate,'corrected'),frontend,projection,{evaluatedAt:receipt.financial.evaluated_at});
  const consumer=await verifyConsumerCapability(frontend);
  const compatibility=await consumer.verifyCorrectionCompatibility({root:join(candidate,'corrected/static-data'),projection,evaluatedAt:Date.now()});
  const verification=read(join(candidate,'verification.json'));
  equal(baseline,verification.baseline_equality,'baseline semantic proof');equal(correction,verification.correction_equality,'financial-only proof');equal(compatibility,verification.compatibility,'consumer compatibility');
  const manifest=read(join(candidate,'corrected/static-data/manifest.json'));
  if(priceObservationDigest(extractPriceObservations({dataRoot:join(candidate,'corrected/static-data'),manifest}))!==priceObservationDigest(live.priceObservations))throw Error('Activation changed original price observations');
  state.projectionPath=replay.projection_path;state.previewReceipt=receipt;
  return {projection,receipt};
}

export function sourceLineage({source,certificate,sourceProjectionSha256,receiptInventorySha256,projectionPolicy}) {
  const value={schema_version:'financial-source-lineage-v1',source,certificate,source_projection_sha256:sourceProjectionSha256,receipt_inventory_sha256:receiptInventorySha256,policy:projectionPolicy};
  parseCorrectionIntent(JSON.stringify({schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:`1/1/${'0'.repeat(64)}/${'0'.repeat(64)}`,source}));
  parseCertifiedPreviewSelection({guard:'certified_source_artifact_v1',certificate},{projector:'native_annual_destination_v1',policy:projectionPolicy?.id});
  exact(projectionPolicy,['id','contract_sha256','projector_sha256'],'source policy');
  if(!hash(sourceProjectionSha256)||!hash(receiptInventorySha256)||!hash(projectionPolicy.contract_sha256)||!hash(projectionPolicy.projector_sha256))throw Error('Invalid financial source lineage');
  return {id:digest(value),value};
}
function assetReference(kind,bytes) {
  const checksum=sha256(bytes);return {path:`static-data/financial-corrections/${kind}-${checksum}.json`,sha256:checksum};
}
function validateAssetReference(reference,kind) {
  exact(reference,['path','sha256'],`${kind} asset`);
  if(!hash(reference.sha256)||reference.path!==`static-data/financial-corrections/${kind}-${reference.sha256}.json`)throw Error('Invalid content-addressed financial asset');
}
export function validateFinancialReleaseReceipt(value) {
  exact(value,['schema_version','mode','previous_publication_identity','lineage','lineage_sha256','source_projection','source_base','evaluation_projection','financial_generation','evaluated_at','ui','price_input','candidate','data_inventory_sha256'],'receipt');
  if(value.schema_version!=='financial-release-receipt-v1'||!['activation','carry'].includes(value.mode)||!identity(value.previous_publication_identity)
    ||!hash(value.lineage_sha256)||digest(value.lineage)!==value.lineage_sha256||!hash(value.financial_generation)||!Number.isFinite(Date.parse(value.evaluated_at))||!hash(value.data_inventory_sha256))throw Error('Invalid financial release receipt identity');
  exact(value.lineage,['schema_version','source','certificate','source_projection_sha256','receipt_inventory_sha256','policy'],'source lineage');
  const lineage=sourceLineage({source:value.lineage.source,certificate:value.lineage.certificate,sourceProjectionSha256:value.lineage.source_projection_sha256,receiptInventorySha256:value.lineage.receipt_inventory_sha256,projectionPolicy:value.lineage.policy});
  if(lineage.id!==value.lineage_sha256)throw Error('Invalid financial lineage binding');
  validateAssetReference(value.source_projection,'source-projection');validateAssetReference(value.source_base,'source-base');
  validateAssetReference(value.evaluation_projection,value.mode==='activation'?'source-projection':'carry-projection');
  if(value.source_projection.sha256!==value.lineage.source_projection_sha256)throw Error('Financial source projection changed lineage');
  exact(value.ui,['approved_sha','captured_sha','digest','approval','checks'],'UI');
  if(!sha(value.ui.approved_sha)||!sha(value.ui.captured_sha)||!hash(value.ui.digest)||value.ui.approval?.type!=='gates'||value.ui.approval.sha!==value.ui.approved_sha
    ||!Array.isArray(value.ui.checks)||value.ui.checks.length!==contract.required_ci_jobs.length+1)throw Error('Invalid financial release UI approval');
  for(const name of [...contract.required_ci_jobs,policy.candidate_job]){
    const checks=value.ui.checks.filter(item=>item.name===name);
    if(checks.length!==1||!['job_id','run_id','run_attempt'].every(key=>positive(checks[0][key]))||checks[0].head_sha!==value.ui.approved_sha
      ||checks[0].workflow!==`.github/workflows/${name===policy.candidate_job?'design-acceptance.yml':'ci.yml'}`)throw Error('Invalid financial release gate job');
  }
  exact(value.price_input,['artifact_id','artifact_sha256','manifest_sha256','price_observations_sha256','known_price_dates_sha256'],'price input');
  if(!positive(value.price_input.artifact_id)||!['artifact_sha256','manifest_sha256','price_observations_sha256','known_price_dates_sha256'].every(key=>hash(value.price_input[key])))throw Error('Invalid financial price input');
  if(value.mode==='activation'){
    exact(value.candidate,['repository','workflow','head_sha','run_id','run_attempt','job_id','artifact_id','artifact_name','artifact_sha256','candidate_receipt_sha256','record_sha256'],'activation candidate');
    if(value.candidate.repository!==bootstrap.repository||value.candidate.workflow!==policy.candidate_workflow||value.candidate.head_sha!==value.ui.approved_sha||!['run_id','run_attempt','job_id','artifact_id'].every(key=>positive(value.candidate[key]))||!['artifact_sha256','candidate_receipt_sha256','record_sha256'].every(key=>hash(value.candidate[key])))throw Error('Invalid activated candidate reference');
    equal(value.source_projection,value.evaluation_projection,'activation projection');
  }else if(value.candidate!==null)throw Error('A carry cannot claim new activation authority');
  return value;
}
export function writeFinancialReleaseReceipt({dist,mode,previousIdentity,lineage,sourceProjectionBytes,sourceBaseBytes,evaluationBytes,generation,evaluatedAt,ui,priceInput,candidate=null}) {
  const sourceProjection=assetReference('source-projection',sourceProjectionBytes),sourceBase=assetReference('source-base',sourceBaseBytes);
  const evaluated=assetReference(mode==='activation'?'source-projection':'carry-projection',evaluationBytes);
  for(const [ref,bytes]of [[sourceProjection,sourceProjectionBytes],[sourceBase,sourceBaseBytes],[evaluated,evaluationBytes]]){
    const path=join(dist,ref.path);mkdirSync(dirname(path),{recursive:true});
    if(existsSync(path)&&sha256(readFileSync(path))!==ref.sha256)throw Error('Financial audit asset was replaced');
    writeFileSync(path,bytes);
  }
  const receipt=validateFinancialReleaseReceipt({schema_version:'financial-release-receipt-v1',mode,previous_publication_identity:previousIdentity,lineage:lineage.value,lineage_sha256:lineage.id,
    source_projection:sourceProjection,source_base:sourceBase,evaluation_projection:evaluated,financial_generation:generation,evaluated_at:evaluatedAt,ui,price_input:priceInput,candidate,
    data_inventory_sha256:inventoryDigest(dataInventory(dist))});
  const bytes=JSON.stringify(receipt),reference=assetReference('release',bytes);writeFileSync(join(dist,reference.path),bytes);
  return {receipt,reference:{schema_version:'financial-release-receipt-v1',...reference},added:[...new Set([sourceProjection.path,sourceBase.path,evaluated.path,reference.path])]};
}
export function verifyFinancialReleaseAssets(root,reference,publication=null) {
  exact(reference,['schema_version','path','sha256'],'publication reference');
  if(reference.schema_version!=='financial-release-receipt-v1')throw Error('Unknown financial release reference');
  validateAssetReference({path:reference.path,sha256:reference.sha256},'release');
  const bytes=readFileSync(join(root,reference.path));if(sha256(bytes)!==reference.sha256)throw Error('Financial release receipt changed');
  const receipt=validateFinancialReleaseReceipt(JSON.parse(bytes));
  for(const ref of [receipt.source_projection,receipt.source_base,receipt.evaluation_projection])if(sha256(readFileSync(join(root,ref.path)))!==ref.sha256)throw Error('Financial lineage asset changed');
  if(inventoryDigest(dataInventory(root,[reference.path]))!==receipt.data_inventory_sha256)throw Error('Financial release inventory changed');
  if(publication&&(publication.financial_generation!==receipt.financial_generation||publication.financial_lineage_sha256!==receipt.lineage_sha256||publication.ui_sha!==receipt.ui.approved_sha||publication.ui_digest!==receipt.ui.digest||publication.data_inventory_sha256!==inventoryDigest(dataInventory(root))))throw Error('Publication and financial release disagree');
  return receipt;
}
export function assertFinancialLineageContinuity(live,candidate) {
  if(!live?.financialRelease)return;
  if(candidate?.lineage_sha256!==live.financialRelease.lineage_sha256)throw Error('An ordinary release cannot drop or replace active financial lineage');
  equal(candidate.lineage,live.financialRelease.lineage,'carried source lineage');
  equal(candidate.source_projection,live.financialRelease.source_projection,'carried source projection');
  equal(candidate.source_base,live.financialRelease.source_base,'carried source base');
}
export async function restorePublishedFinancialSource(live,root,fetcher=fetch) {
  const receipt=validateFinancialReleaseReceipt(live.financialRelease),reference=live.receipt?.financial_release;
  if(!reference||receipt.lineage_sha256!==live.receipt.financial_lineage_sha256)throw Error('Missing active publication lineage');
  // These immutable source bytes remain served by the current publication after
  // its operational Actions artifact expires. Every byte is still hash-bound
  // to the verified live receipt; no provider or certificate clock is renewed.
  const refs=[reference,receipt.source_projection,receipt.source_base,receipt.evaluation_projection];
  for(const ref of refs){
    if(!safePath(ref.path)||!hash(ref.sha256))throw Error('Unsafe live financial reference');
    const url=new URL(ref.path,bootstrap.site_url);url.searchParams.set('publication_check',String(Date.now()));
    const response=await fetcher(url,{cache:'no-store',headers:{'Cache-Control':'no-cache'},redirect:'error'});
    if(!response.ok)throw Error(`Cannot restore active financial lineage: ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(sha256(bytes)!==ref.sha256)throw Error('Live financial source bytes disagree with the approved lineage');
    const path=join(root,ref.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);
  }
  equal(read(join(root,reference.path)),receipt,'restored live financial receipt');
  return root;
}

async function runCommand(command) {
  if(command==='design-prepare')await prepareDesignCandidate();
  else if(command==='design-seal')await sealDesignCandidate();
  else throw Error('Expected design-prepare or design-seal');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  // Finish evaluating this module before lazy preview/publication imports can
  // re-enter it through select-release-source or live receipt validation.
  // A pending promise alone cannot keep Node alive. Do not report success if
  // the event loop drains before the command has actually finished.
  let completed=false;
  process.once('beforeExit',()=>{
    if(!completed){console.error('Financial release command did not complete');process.exitCode=1;}
  });
  runCommand(process.argv[2]).then(
    ()=>{completed=true;},
    error=>{completed=true;console.error(error.stack||error);process.exitCode=1;},
  );
}
