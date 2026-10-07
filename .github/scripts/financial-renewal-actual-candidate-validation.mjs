// Isolated diagnostic orchestration only. All financial validators are imported
// from the clean exact A checkout. No replacement trust, clock, or source API.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,statfsSync,writeFileSync,writeSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
export const FIXED=Object.freeze({schema_version:'financial-renewal-diagnostic-source-v1',repository:'kusennjp1-ai/screener',repository_id:1203919607,
  head_sha:'22548890d0fe161edf7be3943b1775c4f293d0d9',tree:'8245b42cdff76c1fe51c652227a0eb8d6809cf63',
  request_raw_sha256:'9d2300d07c9b741969ef08119ba4bbef8e1c9f342b5a8c1bb684b5145d02b6bf',
  registry_raw_sha256:'9784d4484c8116e9e742972d07c58f6376312759f98ae5c070a05beacc910d24',
  workflow:'.github/workflows/financial-source-renewal-certification.yml',workflow_name:'Financial Source Renewal Certification',
  run_id:37581569719,run_attempt:1,event:'workflow_run',head_branch:'main',job_name:'Certify same-UI same-price financial source renewal',
  artifact_name:'financial-source-renewal-37581569719-1'});
const mutable=['workflow_id','job_id','job_completed_at','artifact_id','size_in_bytes','sha256','artifact_created_at'];
export const ARCHIVE_LIMIT=8*1024**3, FILE_LIMIT=200000, RESERVE=2*1024**3;
export const STEPS=Object.freeze(['Verify exact predecessor and immutable original authority','Replay certified source and journal-bound receipt delta',
  'Verify same UI, prices, history and all financial surfaces','Verify full logical and physical payload bounds','Seal the exact renewed candidate',
  'Retain complete original archives and sealed renewal candidate']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const positive=value=>Number.isSafeInteger(value)&&value>0;
const clock=value=>{assert.equal(typeof value,'string','Missing real clock');assert.match(value,/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/);const n=Date.parse(value);assert(Number.isFinite(n),'Invalid real clock');return n;};
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const fileHash=path=>execFileSync('sha256sum',[path],{encoding:'utf8'}).split(' ')[0];
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024**2}).trim();
const free=path=>{const s=statfsSync(path);return s.bavail*s.bsize;};

export function validateBinding(binding){
  assert.deepEqual(Object.keys(binding).sort(),[...Object.keys(FIXED),...mutable].sort(),'Unexpected binding fields');
  for(const [key,value]of Object.entries(FIXED))assert.deepEqual(binding[key],value,`Wrong fixed ${key}`);
  for(const key of ['workflow_id','job_id','artifact_id','size_in_bytes'])assert(positive(binding[key]),`Unbound ${key}`);
  assert(binding.size_in_bytes<=ARCHIVE_LIMIT,'Original ZIP exceeds existing archive bound');
  assert.match(binding.sha256??'',/^[a-f0-9]{64}$/,'Unbound original ZIP digest');
  assert(clock(binding.artifact_created_at)<=clock(binding.job_completed_at),'Artifact created after job');
  return binding;
}

export function verifySourceMetadata(binding,{run,latest,jobs,artifacts,workflow},now=Date.now()){
  validateBinding(binding);assert(Number.isSafeInteger(now)&&now>0);
  for(const r of [run,latest]){
    for(const [key,expected]of Object.entries({id:binding.run_id,run_attempt:1,head_sha:binding.head_sha,head_branch:'main',event:'workflow_run',path:binding.workflow,name:binding.workflow_name,workflow_id:binding.workflow_id,status:'completed',conclusion:'success'}))assert.deepEqual(r?.[key],expected,`Source run ${key}`);
    for(const key of ['repository','head_repository']){assert.equal(r[key]?.full_name,binding.repository);assert.equal(r[key]?.id,binding.repository_id);}
    assert(clock(r.created_at)<=clock(r.run_started_at)&&clock(r.run_started_at)<=clock(r.updated_at)&&clock(r.updated_at)<=now,'Source run chronology');
  }
  assert.equal(workflow.id,binding.workflow_id);assert.equal(workflow.path,binding.workflow);assert.equal(workflow.name,binding.workflow_name);
  const found=jobs.filter(j=>j.name===binding.job_name);assert.equal(found.length,1,'Missing or ambiguous certification job');const job=found[0];
  for(const [key,expected]of Object.entries({id:binding.job_id,run_id:binding.run_id,run_attempt:1,head_sha:binding.head_sha,status:'completed',conclusion:'success',completed_at:binding.job_completed_at}))assert.deepEqual(job[key],expected,`Source job ${key}`);
  assert(clock(run.run_started_at)<=clock(job.started_at)&&clock(job.started_at)<=clock(job.completed_at)&&clock(job.completed_at)<=clock(run.updated_at),'Source job chronology');
  let previous=clock(job.started_at);const selected=[];
  for(const [i,name]of STEPS.entries()){
    const matches=(job.steps??[]).filter(s=>s.name===name);assert.equal(matches.length,1,`Missing or duplicate ${name}`);const s=matches[0];
    assert.equal(s.number,i+9);assert.equal(s.status,'completed');assert.equal(s.conclusion,'success');
    assert(previous<=clock(s.started_at)&&clock(s.started_at)<=clock(s.completed_at)&&clock(s.completed_at)<=clock(job.completed_at),'Certification step chronology');
    previous=clock(s.completed_at);selected.push(s);
  }
  const refs=artifacts.filter(a=>a.id===binding.artifact_id||a.name===binding.artifact_name);assert.equal(refs.length,1,'Missing or ambiguous candidate artifact');const artifact=refs[0];
  for(const [key,expected]of Object.entries({id:binding.artifact_id,name:binding.artifact_name,size_in_bytes:binding.size_in_bytes,digest:`sha256:${binding.sha256}`,expired:false,created_at:binding.artifact_created_at}))assert.deepEqual(artifact[key],expected,`Source artifact ${key}`);
  for(const [key,expected]of Object.entries({id:binding.run_id,head_sha:binding.head_sha,head_branch:'main',repository_id:binding.repository_id,head_repository_id:binding.repository_id}))assert.deepEqual(artifact.workflow_run?.[key],expected,`Artifact run ${key}`);
  const upload=selected.at(-1);assert(clock(upload.started_at)<=clock(artifact.created_at)&&clock(artifact.created_at)<=clock(upload.completed_at),'Artifact outside upload window');
  assert(clock(artifact.created_at)<clock(artifact.expires_at)&&clock(artifact.expires_at)>now,'Artifact expired');
  return {artifact,run,job,workflow};
}

export function storageBudget({zipBytes,tarBytes,extractedBytes,candidateRestoreBytes,predecessorRestoreBytes,sourceBytes,fileCount,availableBytes}){
  for(const value of Object.values(arguments[0]))assert(Number.isSafeInteger(value)&&value>=0,'Invalid measured storage value');
  assert(zipBytes>0&&zipBytes<=ARCHIVE_LIMIT&&tarBytes>0&&tarBytes<=ARCHIVE_LIMIT&&extractedBytes<=ARCHIVE_LIMIT&&fileCount<=FILE_LIMIT,'Existing archive bounds exceeded');
  // ZIP, TAR, metadata and dependencies already exist and are excluded from free.
  // Two restores conservatively cover the simultaneous canonical roots plus
  // comparator shadow rewrites; source replay scratch and filesystem blocks
  // have independent allowances. No old fixed decoded-size estimate is used.
  const additionalBytes=extractedBytes+2*candidateRestoreBytes+2*predecessorRestoreBytes+2*sourceBytes+fileCount*4096+RESERVE;
  assert(Number.isSafeInteger(additionalBytes));assert(availableBytes>=additionalBytes,`Insufficient measured space: need ${additionalBytes}, have ${availableBytes}`);
  return {zipBytes,tarBytes,extractedBytes,candidateRestoreBytes,predecessorRestoreBytes,sourceBytes,fileCount,availableBytes,additionalBytes,reserveBytes:RESERVE};
}

function completePages(pages,key){
  assert(Array.isArray(pages)&&pages.length>0&&pages.length<=10,'Incomplete API pagination');const total=pages[0].total_count;
  assert(Number.isSafeInteger(total)&&total>=0&&total<=1000);assert.equal(pages.length,Math.max(1,Math.ceil(total/100)));
  const all=[],seen=new Set();for(let i=0;i<pages.length;i++){assert.equal(pages[i].total_count,total);const items=pages[i][key];assert(Array.isArray(items));assert.equal(items.length,Math.min(100,Math.max(0,total-i*100)));for(const item of items){assert(positive(item.id)&&!seen.has(item.id));seen.add(item.id);all.push(item);}}return all;
}
async function download(binding,path){
  assert(free(dirname(path))>=binding.size_in_bytes+RESERVE,'Insufficient ZIP download space');
  const fd=openSync(path,'wx'),digest=createHash('sha256');let bytes=0;
  try{await new Promise((resolveDone,reject)=>{
    const child=spawn('gh',['api',`repos/${binding.repository}/actions/artifacts/${binding.artifact_id}/zip`],{stdio:['ignore','pipe','inherit']});let failure;
    child.on('error',reject);child.stdout.on('data',chunk=>{try{bytes+=chunk.length;assert(bytes<=binding.size_in_bytes,'Download exceeds exact artifact size');digest.update(chunk);let offset=0;while(offset<chunk.length)offset+=writeSync(fd,chunk,offset,chunk.length-offset);}catch(error){failure=error;child.kill('SIGTERM');}});
    child.on('close',code=>failure?reject(failure):code!==0?reject(Error(`Artifact download exited ${code}`)):resolveDone());
  });assert.equal(bytes,binding.size_in_bytes);assert.equal(digest.digest('hex'),binding.sha256);}finally{closeSync(fd);}
}

export async function runPhase(phase,root,candidate,reports){
  // This is deliberately the first operation, before imports, filesystem
  // creation, subprocesses or network. The checked-in null binding cannot run.
  const bindingBytes=readFileSync(join(here,'financial-renewal-actual-candidate-binding.json'));
  const binding=validateBinding(JSON.parse(bindingBytes));
  assert(['setup','retrieval','verification'].includes(phase));root=resolve(root);candidate=resolve(candidate);reports=resolve(reports);
  assert.equal(git(root,'rev-parse','HEAD'),binding.head_sha);assert.equal(git(root,'rev-parse','HEAD^{tree}'),binding.tree);
  assert.equal(git(root,'status','--porcelain','--untracked-files=no'),'','A checkout is modified');
  if(phase==='setup'){
    mkdirSync(reports,{recursive:true});assert(process.env.RUNNER_TEMP,'Missing runner temp directory');
    const runtime=join(resolve(process.env.RUNNER_TEMP),'financial-renewal-validation-python');assert(!existsSync(runtime),'Runtime destination must be new');
    const requestPath=join(root,'.github/financial-source-renewal-request.json');assert.equal(fileHash(requestPath),binding.request_raw_sha256);
    const ui=json(requestPath).ui.sha;assert.equal(ui,'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac');
    // This published consumer may be outside fetched main ancestry. Match A's
    // certifier workflow: retain the exact object without changing the checkout.
    execFileSync('git',['-C',root,'fetch','--no-tags','origin',ui],{stdio:'inherit'});
    execFileSync('npm',['ci','--prefix',join(root,'frontend'),'--ignore-scripts','--no-audit','--no-fund'],{stdio:'inherit'});
    execFileSync('python3',['-m','venv',runtime],{stdio:'inherit'});
    execFileSync(join(runtime,'bin/python'),['-m','pip','install','-r',join(root,'.github/scripts/financial-release-projection-requirements.txt')],{stdio:'inherit'});
    assert.equal(git(root,'status','--porcelain','--untracked-files=no'),'','A checkout changed during setup');
    const result={status:'locked-runtime-installed',phase,publication_authority:'none',binding_sha256:hash(bindingBytes),completed_at:new Date().toISOString()};
    save(join(reports,'setup-result.json'),result);return result;
  }
  const load=name=>import(pathToFileURL(join(root,'.github/scripts',name)).href);
  const gate=await load('publication-gate.mjs'),state=await load('publication-state.mjs'),renewal=await load('financial-source-renewal.mjs'),cert=await load('financial-source-renewal-certification.mjs'),release=await load('financial-release-activation.mjs'),ci=await load('financial-renewal-ci-admission.mjs'),correction=await load('financial-correction.mjs'),audit=await load('financial-audit-transport.mjs');
  assert.equal(release.financialReleasePolicy.maximum_archive_bytes,ARCHIVE_LIMIT);assert.equal(release.financialReleasePolicy.maximum_archive_files,FILE_LIMIT);
  mkdirSync(reports,{recursive:true});const directory=dirname(candidate);mkdirSync(directory,{recursive:true});
  const archive=join(directory,'candidate.tar'),zip=join(directory,'artifact.zip'),metadata=join(directory,'metadata'),retrievalPath=join(reports,'retrieval-result.json');
  const report={schema_version:'financial-renewal-independent-diagnostic-v1',publication_authority:'none',phase,started_at:new Date().toISOString(),binding_sha256:hash(bindingBytes),source:binding};
  return gate.withInvocationImmutableGitApi(binding.repository,async()=>{
    const api=gate.githubApi,prefix=`repos/${binding.repository}`;
    const authority=()=>{
      assert.equal(api(`${prefix}/git/ref/heads/main`).object?.sha,binding.head_sha,'Main changed from A');
      const commit=api(`${prefix}/git/commits/${binding.head_sha}`);assert.equal(commit.sha,binding.head_sha);assert.equal(commit.tree?.sha,binding.tree);
      const controls=renewal.readRenewalControls(root);assert(controls.request&&!controls.pin&&!controls.intent,'A must remain certification-only');
      const registryBytes=readFileSync(join(root,'contracts/financial_source_renewal_v1.json'));assert.equal(hash(registryBytes),binding.registry_raw_sha256);const registry=renewal.validateRenewalRegistry(JSON.parse(registryBytes));assert.equal(registry.publication_enabled,false);assert.equal(registry.ci_admission?.phase,'certify');
      assert.equal(fileHash(join(root,renewal.renewalPolicy.request_path)),binding.request_raw_sha256);
      const source=verifySourceMetadata(binding,{run:api(`${prefix}/actions/runs/${binding.run_id}/attempts/1`),latest:api(`${prefix}/actions/runs/${binding.run_id}`),
        jobs:completePages(api(`${prefix}/actions/runs/${binding.run_id}/attempts/1/jobs?per_page=100`,true),'jobs'),
        artifacts:completePages(api(`${prefix}/actions/runs/${binding.run_id}/artifacts?per_page=100`,true),'artifacts'),workflow:api(`${prefix}/actions/workflows/${binding.workflow_id}`)});
      const checks=correction.verifyCorrectionChecks(binding.repository,binding.head_sha,api);return {controls,registryBytes,source,checks};
    };
    const before=authority(),live=await state.livePublication({api});renewal.verifyRenewalPredecessor(before.controls.request,live);
    report.live_identity=live.identity;report.checks=before.checks;report.source_observation=before.source;
    if(phase==='retrieval'){
      assert(!existsSync(candidate)&&!existsSync(zip)&&!existsSync(archive)&&!existsSync(metadata),'Retrieval destinations must be new');
      await download(binding,zip);const minimalBinding=join(directory,'archive-binding.json');save(minimalBinding,{artifact_id:binding.artifact_id,size_in_bytes:binding.size_in_bytes,sha256:binding.sha256});
      const inspectionPath=join(reports,'archive-preflight.json');execFileSync('python3',[join(here,'financial-renewal-validation-archive.py'),'--zip',zip,'--binding',minimalBinding,'--candidate-tar',archive,'--metadata',metadata,'--report',inspectionPath],{stdio:'inherit'});
      const inspection=json(inspectionPath),transport=json(join(metadata,'transport.json')),record=renewal.validateRenewalCandidate(json(join(metadata,'candidate.json')));
      assert.equal(hash(readFileSync(join(metadata,'transport.json'))),record.transport_sha256);
      const publication=json(join(metadata,'corrected/publication.json')),context=transport.financial_audit;
      assert.equal(transport.schema_version,'financial-renewal-candidate-transport-v1');assert(context);
      const candidateBudget=audit.financialAuditRestoreBudget({root:join(metadata,'corrected'),publication:{...publication,financial_release:context.financial_release,financial_audit_files:context.financial_audit_files,financial_audit_transport:context.financial_audit_transport}});
      const predecessorBudget=audit.financialAuditRestoreBudget({root:join(metadata,'predecessor'),publication:json(join(metadata,'predecessor/publication.json'))});
      const sourceBytes=['original-source','original-certification','original-previous-source','original-previous-certification'].reduce((sum,key)=>sum+(inspection.top_level_bytes[key]??0),0);
      report.storage=storageBudget({zipBytes:binding.size_in_bytes,tarBytes:inspection.tar_bytes,extractedBytes:inspection.extracted_bytes,candidateRestoreBytes:candidateBudget.restoreBytes,predecessorRestoreBytes:predecessorBudget.restoreBytes,sourceBytes,fileCount:inspection.entry_count,availableBytes:free(directory)});
      report.archive=inspection;
      release.extractCandidateTar(archive,candidate);report.archive_readback=cert.verifySealedRenewalArchive({candidate,archive});
      const after=authority();assert.deepEqual(after.checks,before.checks);const finalLive=await state.livePublication({api});renewal.verifyRenewalPredecessor(before.controls.request,finalLive);assert.equal(finalLive.identity,live.identity);
      report.status='retrieved-and-closed-archive-verified';report.completed_at=new Date().toISOString();save(retrievalPath,report);return report;
    }
    const retrieved=json(retrievalPath);assert.equal(retrieved.binding_sha256,report.binding_sha256);assert.equal(retrieved.status,'retrieved-and-closed-archive-verified');assert.equal(retrieved.live_identity,live.identity);
    assert.equal(fileHash(zip),binding.sha256);assert.equal(lstatSync(zip).size,binding.size_in_bytes);assert.equal(fileHash(archive),retrieved.archive.tar_sha256);assert.equal(lstatSync(archive).size,retrieved.archive.tar_bytes);
    report.archive_readback_before=cert.verifySealedRenewalArchive({candidate,archive});
    const request=renewal.parseRenewalRequest(json(join(candidate,'renewal-request.json'))),record=renewal.validateRenewalCandidate(json(join(candidate,'candidate.json'))),controller=json(join(candidate,'certification-controller.json')),preview=json(join(candidate,'preview-receipt.json'));
    assert.deepEqual(request,before.controls.request);assert.deepEqual(record.producer,{repository:binding.repository,workflow:binding.workflow,head_sha:binding.head_sha,run_id:binding.run_id,run_attempt:1});
    assert.deepEqual(preview.controller,{sha:binding.head_sha,tree:binding.tree});assert.equal(controller.head_sha,binding.head_sha);assert.equal(controller.tree,binding.tree);
    assert(readFileSync(join(candidate,'certification-registry.json')).equals(before.registryBytes));assert.deepEqual(controller.checks,before.checks);
    const checkProof=()=>ci.verifyRenewalCiProof(controller.ci_admission,{api,historical:true,expectedHead:binding.head_sha,expectedTree:binding.tree,expectedChecks:controller.checks,expectedPhase:'certify',expectedCaller:{run_id:binding.run_id,run_attempt:1,head_sha:binding.head_sha,workflow:binding.workflow}});
    checkProof();assert(clock(before.source.job.started_at)<=clock(record.sealed_at)&&clock(record.sealed_at)<=clock(before.source.artifact.created_at),'Seal outside artifact-producing job');
    renewal.verifyRenewalPredecessor(request,live);
    // Recheck measured headroom after extraction and before both canonical roots.
    const s=retrieved.storage;assert(free(directory)>=s.additionalBytes-s.extractedBytes,'Insufficient replay headroom');
    const sources=await cert.verifyRenewalCertificationSources({root,candidate,request,live});
    const replay=await renewal.verifyPreparedRenewal({root,candidate,request,record,live,previousSourceRoot:sources.previousSourceRoot,api});
    report.bounds=cert.verifyRenewalCertificationBounds({candidate});report.archive_readback_after=cert.verifySealedRenewalArchive({candidate,archive});
    assert.equal(fileHash(zip),binding.sha256);assert.equal(fileHash(archive),retrieved.archive.tar_sha256);
    const after=authority();assert.deepEqual(after.checks,controller.checks);checkProof();const finalLive=await state.livePublication({api});renewal.verifyRenewalPredecessor(request,finalLive);assert.equal(finalLive.identity,live.identity);
    await renewal.verifyRenewalEvaluationCurrent({request,projection:replay.projection,frontendRoot:join(root,'frontend')});
    assert.equal(git(root,'status','--porcelain','--untracked-files=no'),'','A checkout changed');assert.equal(hash(readFileSync(join(here,'financial-renewal-actual-candidate-binding.json'))),report.binding_sha256);
    report.candidate_record_sha256=fileHash(join(candidate,'candidate.json'));report.record=record;report.source_delta=replay.sourceDelta;
    for(const name of ['candidate.json','renewal-request.json','certification-controller.json','certification-registry.json','source-delta.json']){const bytes=readFileSync(join(candidate,name));assert(bytes.length<=16*1024**2);writeFileSync(join(reports,`original-${name}`),bytes,{flag:'wx'});}
    report.status='actual-candidate-independent-replay-passed';report.completed_at=new Date().toISOString();save(join(reports,'verification-result.json'),report);
    return report;
  });
}
export function runToCompletion(work){
  let completed=false;
  process.once('beforeExit',()=>{if(!completed){console.error('Independent renewal validation did not complete');process.exitCode=1;}});
  Promise.resolve().then(work).then(result=>{completed=true;console.log(JSON.stringify({status:result.status,phase:result.phase,publication_authority:'none'}));},error=>{completed=true;console.error(error.stack??error);process.exitCode=1;});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runToCompletion(()=>runPhase(...process.argv.slice(2)));
}
