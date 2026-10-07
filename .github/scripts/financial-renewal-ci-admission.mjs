// A CI completion is scheduling evidence, never source or financial authority.
// Every admitted commit changes precisely one existing registry blob. Existing
// request parsers, controller inventories, replay and final expiry gates remain
// mandatory in callers. Dependencies are function arguments, never CLI switches.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {bootstrap,sha256} from './publication-state.mjs';
import {contract,digest,verifyCorrectionChecks} from './financial-correction.mjs';
import {githubApi} from './publication-gate.mjs';
import policy from '../../contracts/financial_source_renewal_v1.json' with {type:'json'};

const repository=bootstrap.repository, repositoryId=1203919607;
const registryPath='contracts/financial_source_renewal_v1.json';
const paths=Object.freeze({request:'.github/financial-source-renewal-request.json',pin:'.github/financial-source-renewal-candidate.json',intent:'.github/financial-source-renewal-release.json'});
const workflows=Object.freeze({certify:'.github/workflows/financial-source-renewal-certification.yml',publish:'.github/workflows/research-ui-release.yml'});
const ciWorkflow='.github/workflows/ci.yml', proofSchema='financial-renewal-ci-admission-proof-v1';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const gitPath=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=4096&&!/[\x00-\x1f\x7f\\]/.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const exact=(value,keys,label)=>{if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))throw Error(`Invalid closed renewal CI ${label}`);};
const equal=(a,b,label)=>{if(digest(a)!==digest(b))throw Error(`Renewal CI ${label} mismatch`);};
const keys=phase=>phase==='certify'?['request']:['request','pin','intent'];
function phaseCheck(phase){if(!Object.hasOwn(workflows,phase))throw Error('Invalid renewal CI phase');}
function clock(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('Invalid renewal CI clock');return Date.parse(value);}
const blobSha=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
function validateControls(value,phase){exact(value,keys(phase),'control hashes');if(!Object.values(value).every(hash))throw Error('Invalid renewal CI raw control hash');}
export function validateRenewalCiAdmission(value){
  if(value===null)return null;
  exact(value,['phase','reviewed_commit','reviewed_tree','controls'],'admission');phaseCheck(value.phase);
  if(!sha(value.reviewed_commit)||!sha(value.reviewed_tree))throw Error('Invalid renewal CI reviewed Git identity');
  validateControls(value.controls,value.phase);return value;
}
function registry(value){
  const expected={...policy,ci_admission:null};
  const normalized={...value,ci_admission:value?.ci_admission??null};
  exact(normalized,Object.keys(expected),'registry');
  if(typeof normalized.publication_enabled!=='boolean'||!Array.isArray(normalized.reviewed_controllers)||normalized.reviewed_controllers.length>policy.maximum_transitions
    ||!Array.isArray(normalized.reviewed_consumer_transitions))throw Error('Invalid bounded renewal CI registry');
  const fixed=v=>({...v,ci_admission:null,publication_enabled:false,reviewed_controllers:[],reviewed_consumer_transitions:[]});
  equal(fixed(normalized),fixed(expected),'fixed registry metadata');
  validateRenewalCiAdmission(normalized.ci_admission);return normalized;
}
function localBytes(root,path,optional=false){
  let stat;try{stat=lstatSync(join(root,path));}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0||stat.size>policy.maximum_control_bytes)throw Error('Invalid bounded local renewal CI control');
  return readFileSync(join(root,path));
}
export function renewalCiEligibility({root=process.cwd(),phase}={}){
  phaseCheck(phase);const bytes=localBytes(root,registryPath),value=registry(JSON.parse(bytes));
  const raw=Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,localBytes(root,path,true)]));
  const controls=Object.fromEntries(Object.entries(raw).filter(([,bytes])=>bytes!==null).map(([key,bytes])=>[key,sha256(bytes)]));
  const result={status:'hold',phase,admission:value.ci_admission,registry_sha256:sha256(bytes),controls};
  if(!Object.keys(controls).length)return {...result,status:'disabled'};
  if(!value.ci_admission||value.ci_admission.phase!==phase||keys(phase).some(key=>!raw[key]))return result;
  if(phase==='certify'&&(raw.pin||raw.intent))return result;
  if(value.publication_enabled!==(phase==='publish'))throw Error('Renewal CI publication flag differs from admitted phase');
  equal(Object.fromEntries(keys(phase).map(key=>[key,controls[key]])),value.ci_admission.controls,'local admission controls');
  return {...result,status:'eligible'};
}
function git(root,args){return execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).trim();}
function checkoutTree(root){
  const out=Object.create(null);let count=0;for(const line of execFileSync('git',['ls-tree','-r','-z','--full-tree','HEAD'],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).split('\0').filter(Boolean)){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    if(!match||!gitPath(match[3])||Object.hasOwn(out,match[3])||++count>30000)throw Error('Invalid complete renewal CI checkout tree');
    out[match[3]]={mode:match[1],sha:match[2]};
  }return out;
}
function remoteCommit(api,head){
  if(!sha(head))throw Error('Invalid renewal CI commit');
  const commit=api(`repos/${repository}/git/commits/${head}`);
  if(commit?.sha!==head||!sha(commit.tree?.sha)||!Array.isArray(commit.parents)||commit.parents.some(p=>!sha(p?.sha)))throw Error('Invalid immutable renewal CI commit');
  return commit;
}
function remoteTree(api,tree){
  const response=api(`repos/${repository}/git/trees/${tree}?recursive=1`);
  if(response?.sha!==tree||response.truncated!==false||!Array.isArray(response.tree)||response.tree.length>60000)throw Error('Incomplete renewal CI Git tree');
  const files=Object.create(null),seen=new Set();let count=0;
  for(const entry of response.tree){
    if(!gitPath(entry?.path)||seen.has(entry.path)||!sha(entry.sha))throw Error('Invalid renewal CI Git path');seen.add(entry.path);
    if(entry.type==='tree'&&entry.mode==='040000')continue;
    if(entry.type!=='blob'||!['100644','100755'].includes(entry.mode)||++count>30000)throw Error('Nonregular or oversized renewal CI Git tree');
    files[entry.path]={mode:entry.mode,sha:entry.sha};
  }
  if(!count)throw Error('Empty renewal CI Git tree');return files;
}
function remoteBytes(api,path,head,files){
  const response=api(`repos/${repository}/contents/${path}?ref=${head}`);
  if(response?.type!=='file'||response.path!==path||response.encoding!=='base64'||typeof response.content!=='string'||!positive(response.size)||response.size>policy.maximum_control_bytes
    ||!sha(response.sha)||!files[path]||response.sha!==files[path].sha)throw Error('Invalid immutable renewal CI content');
  const bytes=Buffer.from(response.content,'base64');
  if(bytes.length!==response.size||blobSha(bytes)!==response.sha)throw Error('Renewal CI immutable raw bytes mismatch');return bytes;
}
function soleRegistryDelta(before,after){
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(path=>digest(before[path]??null)!==digest(after[path]??null));
  if(changed.length!==1||changed[0]!==registryPath||!before[registryPath]||!after[registryPath]||before[registryPath].mode!==after[registryPath].mode)throw Error('Renewal CI admission must change only the existing registry blob');
}
function verifyEdge(api,head,admission,registryHash,controls,depth=0){
  validateRenewalCiAdmission(admission);if(!admission||depth>1)throw Error('Invalid renewal CI admission edge');
  const executing=remoteCommit(api,head),reviewed=remoteCommit(api,admission.reviewed_commit);
  if(executing.parents.length!==1||executing.parents[0].sha!==reviewed.sha||reviewed.tree.sha!==admission.reviewed_tree)throw Error('Renewal CI admission is not the exact direct reviewed child');
  const before=remoteTree(api,reviewed.tree.sha),after=remoteTree(api,executing.tree.sha);soleRegistryDelta(before,after);
  const beforeBytes=remoteBytes(api,registryPath,reviewed.sha,before),afterBytes=remoteBytes(api,registryPath,head,after);
  const beforeRegistry=registry(JSON.parse(beforeBytes)),afterRegistry=registry(JSON.parse(afterBytes));
  if(sha256(afterBytes)!==registryHash)throw Error('Renewal CI raw registry mismatch');equal(afterRegistry.ci_admission,admission,'immutable admission');equal(controls,admission.controls,'proof controls');
  const raw={};for(const key of keys(admission.phase)){
    const first=remoteBytes(api,paths[key],reviewed.sha,before),second=remoteBytes(api,paths[key],head,after);
    if(sha256(first)!==controls[key]||sha256(second)!==controls[key])throw Error('Renewal CI immutable control hash mismatch');raw[key]=JSON.parse(first);
  }
  if(admission.phase==='certify'){
    if(beforeRegistry.ci_admission!==null||beforeRegistry.publication_enabled!==false||afterRegistry.publication_enabled!==false
      ||before[paths.pin]||before[paths.intent]||after[paths.pin]||after[paths.intent])throw Error('Renewal CI certification review is not an unarmed request');
    equal({...afterRegistry,ci_admission:null},beforeRegistry,'certification registry-only activation');
  }else{
    if(beforeRegistry.publication_enabled!==false||afterRegistry.publication_enabled!==true||beforeRegistry.ci_admission?.phase!=='certify'
      ||afterRegistry.reviewed_controllers.length!==beforeRegistry.reviewed_controllers.length+1)throw Error('Renewal CI publication must append exactly one reviewed controller');
    const review=afterRegistry.reviewed_controllers.at(-1),certification=remoteCommit(api,raw.pin?.head_sha);
    exact(review,['controller_sha','controller_tree','certification_sha','certification_tree','protected_code_sha256','request_sha256','pin_sha256','intent_sha256','request_raw_sha256','pin_raw_sha256','intent_raw_sha256'],'appended reviewed controller');
    if(!hash(review.protected_code_sha256))throw Error('Invalid renewal CI reviewed controller hash');
    if(review?.controller_sha!==reviewed.sha||review.controller_tree!==reviewed.tree.sha||review.certification_sha!==certification.sha||review.certification_tree!==certification.tree.sha
      ||['request','pin','intent'].some(key=>review[`${key}_raw_sha256`]!==controls[key]||review[`${key}_sha256`]!==digest(raw[key])))throw Error('Renewal CI appended controller does not bind the reviewed controls');
    if(beforeRegistry.reviewed_controllers.some(item=>item.controller_sha===review.controller_sha&&item.certification_sha===review.certification_sha))throw Error('Duplicate renewal CI controller authority');
    equal({...afterRegistry,publication_enabled:false,ci_admission:beforeRegistry.ci_admission,reviewed_controllers:afterRegistry.reviewed_controllers.slice(0,-1)},beforeRegistry,'publication registry-only activation');
    const certFiles=remoteTree(api,certification.tree.sha),certBytes=remoteBytes(api,registryPath,certification.sha,certFiles);
    if(!certBytes.equals(beforeBytes))throw Error('Renewal CI staging changed raw certification registry bytes');
    equal(registry(JSON.parse(certBytes)),beforeRegistry,'unchanged certification registry');
    // B may have merge parents, but its entire tree must preserve A and add
    // precisely the two existing candidate controls. No protected-prefix filter
    // or canonical JSON comparison can exempt another staged byte or mode.
    const staged=[...new Set([...Object.keys(certFiles),...Object.keys(before)])].filter(path=>digest(certFiles[path]??null)!==digest(before[path]??null)).sort();
    if(certFiles[paths.pin]||certFiles[paths.intent]||!before[paths.pin]||!before[paths.intent]
      ||staged.length!==2||staged[0]!==[paths.pin,paths.intent].sort()[0]||staged[1]!==[paths.pin,paths.intent].sort()[1])throw Error('Renewal CI staging must add only the exact pin and intent files');
    verifyEdge(api,certification.sha,beforeRegistry.ci_admission,sha256(certBytes),{request:controls.request},depth+1);
  }
  return {reviewed:{head_sha:reviewed.sha,tree:reviewed.tree.sha,registry_sha256:sha256(beforeBytes)},executing:{head_sha:head,tree:executing.tree.sha},files:after};
}
function repos(value){return value?.repository?.full_name===repository&&value.repository.id===repositoryId&&value?.head_repository?.full_name===repository&&value.head_repository.id===repositoryId;}
const runKeys=['run_id','run_attempt','workflow','workflow_id','head_sha','event','head_branch','repository','repository_id','head_repository','head_repository_id','created_at','run_started_at'];
function runIdentity(run){return {run_id:run.id,run_attempt:run.run_attempt,workflow:run.path,workflow_id:run.workflow_id,head_sha:run.head_sha,event:run.event,head_branch:run.head_branch,
  repository:run.repository?.full_name,repository_id:run.repository?.id,head_repository:run.head_repository?.full_name,head_repository_id:run.head_repository?.id,created_at:run.created_at,run_started_at:run.run_started_at};}
function validRun(run,head,workflow,event){
  if(!positive(run?.id)||run.run_attempt!==1||!positive(run.workflow_id)||run.path!==workflow||run.head_sha!==head||run.event!==event||run.head_branch!=='main'||!repos(run)
    ||clock(run.created_at)>clock(run.run_started_at))throw Error('Invalid exact renewal CI run identity');
}
function triggerIdentity(run){return {...runIdentity(run),status:run.status,conclusion:run.conclusion,updated_at:run.updated_at};}
function validTrigger(run,head){validRun(run,head,ciWorkflow,'push');if(run.status!=='completed'||run.conclusion!=='success'||clock(run.run_started_at)>clock(run.updated_at))throw Error('Renewal CI trigger is not completed successful push CI');}
function validateStoredRun(value,workflow,event,extra=[]){
  exact(value,[...runKeys,...extra],'stored run');
  if(!positive(value.run_id)||value.run_attempt!==1||!positive(value.workflow_id)||value.workflow!==workflow||!sha(value.head_sha)||value.event!==event||value.head_branch!=='main'
    ||value.repository!==repository||value.repository_id!==repositoryId||value.head_repository!==repository||value.head_repository_id!==repositoryId
    ||clock(value.created_at)>clock(value.run_started_at))throw Error('Invalid stored renewal CI identity');
}
function validateChecks(checks,head,trigger){
  if(!Array.isArray(checks)||checks.length!==contract.required_ci_jobs.length)throw Error('Missing exact renewal CI checks');
  const ids=new Set();for(const name of contract.required_ci_jobs){const found=checks.filter(item=>item?.name===name);if(found.length!==1)throw Error('Missing or duplicate renewal CI check');const check=found[0];
    exact(check,['workflow','run_id','run_attempt','job_id','name','head_sha'],'check');
    if(check.workflow!==ciWorkflow||check.head_sha!==head||check.run_id!==trigger.run_id||check.run_attempt!==1||!positive(check.job_id)||ids.has(check.job_id))throw Error('Invalid renewal CI check identity');ids.add(check.job_id);
  }
}
export function validateRenewalCiProof(proof){
  exact(proof,['schema_version','producer_event','phase','repository','repository_id','admission','admission_sha256','registry_sha256','reviewed','executing','controls','trigger','checks','caller'],'proof');
  phaseCheck(proof.phase);validateRenewalCiAdmission(proof.admission);validateControls(proof.controls,proof.phase);
  exact(proof.reviewed,['head_sha','tree','registry_sha256'],'reviewed commit');exact(proof.executing,['head_sha','tree'],'executing commit');
  if(proof.schema_version!==proofSchema||proof.producer_event!=='workflow_run'||proof.repository!==repository||proof.repository_id!==repositoryId
    ||!proof.admission||proof.admission.phase!==proof.phase||!hash(proof.admission_sha256)||proof.admission_sha256!==digest(proof.admission)||!hash(proof.registry_sha256)
    ||!sha(proof.reviewed.head_sha)||!sha(proof.reviewed.tree)||!hash(proof.reviewed.registry_sha256)||!sha(proof.executing.head_sha)||!sha(proof.executing.tree)
    ||proof.reviewed.head_sha!==proof.admission.reviewed_commit||proof.reviewed.tree!==proof.admission.reviewed_tree)throw Error('Invalid renewal CI proof binding');
  equal(proof.controls,proof.admission.controls,'stored control hashes');
  validateStoredRun(proof.trigger,ciWorkflow,'push',['status','conclusion','updated_at']);
  validateStoredRun(proof.caller,workflows[proof.phase],'workflow_run',['workflow_sha','workflow_ref','ref']);
  if(proof.trigger.status!=='completed'||proof.trigger.conclusion!=='success'||clock(proof.trigger.run_started_at)>clock(proof.trigger.updated_at)
    ||proof.trigger.head_sha!==proof.executing.head_sha||proof.caller.head_sha!==proof.executing.head_sha||proof.caller.workflow_sha!==proof.executing.head_sha
    ||proof.caller.ref!=='refs/heads/main'||proof.caller.workflow_ref!==`${repository}/${workflows[proof.phase]}@refs/heads/main`
    ||clock(proof.trigger.updated_at)>clock(proof.caller.created_at))throw Error('Invalid renewal CI producer chronology');
  validateChecks(proof.checks,proof.executing.head_sha,proof.trigger);return proof;
}
// GitHub's filtered workflow run API is capped at 1,000. Above that bound the
// inventory is unknowable through this interface, so admission fails closed.
function completeRuns(api,workflow,head,event){
  const endpoint=`repos/${repository}/actions/workflows/${workflow.split('/').at(-1)}/runs?branch=main&${event?`event=${event}&`:''}head_sha=${head}&per_page=100`;
  const pages=api(endpoint,true);if(!Array.isArray(pages)||!pages.length||pages.length>10)throw Error('Incomplete renewal CI run inventory');
  const total=pages[0]?.total_count;
  if(!Number.isSafeInteger(total)||total<0||total>1000||pages.length!==Math.max(1,Math.ceil(total/100)))throw Error('Unbounded renewal CI run inventory');
  const runs=[],ids=new Set();for(let index=0;index<pages.length;index++){
    const page=pages[index],count=Math.min(100,Math.max(0,total-index*100));
    if(page?.total_count!==total||!Array.isArray(page.workflow_runs)||page.workflow_runs.length!==count)throw Error('Truncated renewal CI run inventory');
    for(const run of page.workflow_runs){if(!positive(run?.id)||ids.has(run.id)||run.path!==workflow||run.head_sha!==head||run.head_branch!=='main'||!repos(run)||!positive(run.run_attempt)||!positive(run.workflow_id)
      ||typeof run.event!=='string'||!run.event||typeof run.status!=='string'||!run.status||(event&&run.event!==event))throw Error('Ambiguous renewal CI run inventory');ids.add(run.id);runs.push(run);}
  }return runs;
}
function checkRepo(api){const repo=api(`repos/${repository}`);if(repo?.full_name!==repository||repo.id!==repositoryId||repo.default_branch!=='main')throw Error('Invalid official renewal CI repository');}
function completeJobs(api,runId,attempt){
  const pages=api(`repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,true);
  if(!Array.isArray(pages)||!pages.length||pages.length>10)throw Error('Missing complete renewal CI jobs');
  const total=pages[0]?.total_count;
  if(!Number.isSafeInteger(total)||total<0||total>1000||pages.length!==Math.max(1,Math.ceil(total/100)))throw Error('Unbounded renewal CI jobs');
  const jobs=[],ids=new Set();for(let index=0;index<pages.length;index++){
    const page=pages[index],count=Math.min(100,Math.max(0,total-index*100));
    if(page?.total_count!==total||!Array.isArray(page.jobs)||page.jobs.length!==count)throw Error('Truncated renewal CI jobs');
    for(const job of page.jobs){if(!positive(job?.id)||ids.has(job.id)||job.run_id!==runId||job.run_attempt!==attempt||!sha(job.head_sha))throw Error('Ambiguous renewal CI job identity');ids.add(job.id);jobs.push(job);}
  }return jobs;
}
function verifyJobs(api,proof){
  const jobs=completeJobs(api,proof.trigger.run_id,1);
  for(const check of proof.checks){const found=jobs.filter(job=>job.name===check.name);if(found.length!==1)throw Error('Missing or duplicate required renewal CI job');const job=found[0];
    if(job.id!==check.job_id||job.head_sha!==proof.executing.head_sha||job.status!=='completed'||job.conclusion!=='success'
      ||clock(job.started_at)<clock(proof.trigger.run_started_at)||clock(job.started_at)>clock(job.completed_at)||clock(job.completed_at)>clock(proof.trigger.updated_at)
      ||clock(job.completed_at)>clock(proof.caller.created_at))throw Error('Renewal CI required job identity or clock changed');
  }
}
const ordinaryMarker=/^Ordinary non-CI publication: ([1-9][0-9]*)\/([1-9][0-9]*)$/;
const terminalConclusions=new Set(['success','failure','neutral','cancelled','timed_out','action_required','skipped','stale','startup_failure']);
function verifyOrdinaryNonCiRun(api,listed,proof){
  const head=proof.executing.head_sha,base=`repos/${repository}/actions/runs/${listed.id}`;
  const run=api(`${base}/attempts/1`),latest=api(base);validRun(run,head,workflows.publish,'workflow_run');validRun(latest,head,workflows.publish,'workflow_run');
  if(run.id!==listed.id||run.workflow_id!==proof.caller.workflow_id||listed.workflow_id!==proof.caller.workflow_id||listed.run_attempt!==1||run.status!=='completed'||run.conclusion!=='success'||listed.status!=='completed'||listed.conclusion!=='success'
    ||clock(run.updated_at)<clock(run.run_started_at)||clock(run.updated_at)>clock(proof.caller.run_started_at))throw Error('Prior renewal CI caller lacks a terminal ordinary publication');
  equal(triggerIdentity(listed),triggerIdentity(run),'listed prior ordinary caller');
  equal(triggerIdentity(latest),triggerIdentity(run),'prior ordinary caller latest attempt');
  const jobs=completeJobs(api,run.id,1),route=jobs.filter(job=>job.name==='Route exact renewal CI admission'),publish=jobs.filter(job=>job.name==='publish');
  if(jobs.length!==2||route.length!==1||publish.length!==1||jobs.some(job=>job.head_sha!==head||job.status!=='completed')||route[0].conclusion!=='success'
    ||!['success','skipped'].includes(publish[0].conclusion))throw Error('Prior renewal CI caller lacks exact ordinary routing and publication jobs');
  const markers=route[0].steps?.filter(step=>typeof step.name==='string'&&step.name.startsWith('Ordinary non-CI publication:'))??[];
  if(markers.length!==1||markers[0].status!=='completed'||markers[0].conclusion!=='success')throw Error('Prior renewal CI caller lacks its authenticated ordinary marker');
  const match=ordinaryMarker.exec(markers[0].name),sourceId=Number(match?.[1]),attempt=Number(match?.[2]);
  if(!match||!positive(sourceId)||!positive(attempt))throw Error('Invalid ordinary renewal CI source marker');
  const source=api(`repos/${repository}/actions/runs/${sourceId}/attempts/${attempt}`),sourceLatest=api(`repos/${repository}/actions/runs/${sourceId}`);
  if(source?.id!==sourceId||source.run_attempt!==attempt||!positive(source.workflow_id)||source.head_sha!==head||source.head_branch!=='main'||!repos(source)
    ||!((source.path==='.github/workflows/design-acceptance.yml'&&source.event==='push')||(source.path==='.github/workflows/static-site.yml'&&['schedule','workflow_dispatch'].includes(source.event)))
    ||source.status!=='completed'||!terminalConclusions.has(source.conclusion)||clock(source.created_at)>clock(source.run_started_at)||clock(source.run_started_at)>clock(source.updated_at)
    ||clock(source.updated_at)>clock(run.created_at))throw Error('Prior ordinary marker is not an exact completed non-CI source');
  equal(triggerIdentity(sourceLatest),triggerIdentity(source),'ordinary source latest attempt');
  const router=route[0],marker=markers[0];
  if(clock(router.started_at)<clock(run.run_started_at)||clock(router.started_at)>clock(marker.started_at)||clock(marker.started_at)>clock(marker.completed_at)
    ||clock(marker.completed_at)>clock(router.completed_at)||clock(router.completed_at)>clock(run.updated_at))throw Error('Prior ordinary routing marker clock mismatch');
  if(publish[0].conclusion==='success'&&(clock(publish[0].started_at)<clock(router.completed_at)||clock(publish[0].started_at)>clock(publish[0].completed_at)||clock(publish[0].completed_at)>clock(run.updated_at)))throw Error('Prior ordinary publication clock mismatch');
}
function verifyQueuedSuccessor(api,listed,proof,files,now){
  if(listed.id<=proof.caller.run_id||listed.status!=='queued'||listed.conclusion!==null||listed.run_attempt!==1||listed.event!=='workflow_run'||listed.workflow_id!==proof.caller.workflow_id)
    throw Error('Renewal CI admitted head has another or ambiguous caller run');
  const endpoint=`repos/${repository}/actions/runs/${listed.id}`,latest=api(endpoint),attempt=api(`${endpoint}/attempts/1`);
  for(const run of [listed,latest,attempt])if(run?.id!==listed.id||run.run_attempt!==1||run.workflow_id!==proof.caller.workflow_id||run.path!==workflows[proof.phase]
    ||run.head_sha!==proof.executing.head_sha||run.head_branch!=='main'||run.event!=='workflow_run'||!repos(run)||run.status!=='queued'||run.conclusion!==null
    ||clock(run.created_at)<clock(proof.caller.created_at)||clock(run.created_at)>now)throw Error('Renewal CI successor is no longer exactly queued');
  equal(runIdentity(latest),runIdentity(attempt),'queued successor attempt');
  const currentJobs=completeJobs(api,proof.caller.run_id,1),name=proof.phase==='publish'?'publish':policy.job,matching=currentJobs.filter(job=>job.name===name);
  if(matching.length!==1||matching[0].head_sha!==proof.executing.head_sha||matching[0].status!=='in_progress'||matching[0].conclusion!==null
    ||clock(matching[0].started_at)<clock(proof.caller.run_started_at))throw Error('Renewal CI queued successor lacks the current active job lock');
  const bytes=remoteBytes(api,workflows[proof.phase],proof.executing.head_sha,files),source=bytes.toString('utf8'),group=proof.phase==='publish'?'research-ui-release':'financial-source-renewal-certification';
  if(source.split('\n').filter(line=>line==='concurrency:').length!==1||/^[ \t]+concurrency:/m.test(source)
    ||!source.includes(`\nconcurrency:\n  group: ${group}\n  cancel-in-progress: false\n`))throw Error('Renewal CI workflow concurrency lock changed');
}
// The event and controller identity cannot substitute for executing the named
// admission step. Recheck its API-authenticated job on every current proof use,
// including while that very step is running; retain only stable run identity in
// the proof so later successful checks produce the same sealed bytes.
function verifyCallerGateJob(api,proof,caller,{historical,now}){
  const jobs=completeJobs(api,proof.caller.run_id,1),name=proof.phase==='publish'?'publish':policy.job,matches=jobs.filter(job=>job.name===name);
  if(matches.length!==1)throw Error('Renewal CI own admission job is missing or duplicated');
  const job=matches[0],started=clock(job.started_at);
  if(job.head_sha!==proof.executing.head_sha||started<clock(caller.run_started_at)||started>now
    ||(historical?(job.status!=='completed'||job.conclusion!=='success'||clock(job.completed_at)<started||clock(job.completed_at)>clock(caller.updated_at))
      :(job.status!=='in_progress'||job.conclusion!==null||job.completed_at!==null)))throw Error('Renewal CI own admission job identity, state or clock mismatch');
  const names=['Admit exact successful main CI renewal',...(historical&&proof.phase==='publish'?['Deploy to GitHub Pages']:[])];
  let previous=started;
  for(const name of names){
    const steps=job.steps?.filter(step=>step.name===name)??[];
    if(steps.length!==1)throw Error('Renewal CI admission or deployment step is missing or duplicated');
    const step=steps[0],begin=clock(step.started_at);
    if(begin<previous||begin>now)throw Error('Renewal CI admission or deployment step clock mismatch');
    if(!historical&&step.status==='in_progress'){
      if(step.conclusion!==null||step.completed_at!==null)throw Error('Renewal CI in-progress admission step is inconsistent');
    }else{
      if(step.status!=='completed'||step.conclusion!=='success'||clock(step.completed_at)<begin||clock(step.completed_at)>now
        ||(historical&&clock(step.completed_at)>clock(job.completed_at)))throw Error('Renewal CI admission or deployment step failed or has inconsistent clocks');
      previous=clock(step.completed_at);
    }
  }
}
function verifyReplayInventory(api,proof,files,now){
  const runs=completeRuns(api,workflows[proof.phase],proof.executing.head_sha),own=runs.filter(run=>run.id===proof.caller.run_id);
  if(own.length!==1||own[0].run_attempt!==1||own[0].event!=='workflow_run'||own[0].workflow_id!==proof.caller.workflow_id||own[0].status!=='in_progress'||own[0].conclusion!==null)
    throw Error('Renewal CI admitted head lacks its exact current caller');
  for(const run of runs){if(run.id===proof.caller.run_id)continue;
    if(run.id>proof.caller.run_id)verifyQueuedSuccessor(api,run,proof,files,now);
    else if(proof.phase==='publish')verifyOrdinaryNonCiRun(api,run,proof);
    else throw Error('Renewal CI admitted head has a prior caller run');
  }
}
export function verifyRenewalCiProof(proof,{api=githubApi,historical=false,expectedHead,expectedTree,expectedChecks,expectedPhase,expectedCaller,now=Date.now()}={}){
  validateRenewalCiProof(proof);if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid renewal CI verification clock');
  if(expectedHead!==undefined&&proof.executing.head_sha!==expectedHead||expectedTree!==undefined&&proof.executing.tree!==expectedTree||expectedPhase!==undefined&&proof.phase!==expectedPhase)throw Error('Renewal CI expected execution mismatch');
  if(expectedChecks!==undefined)equal(proof.checks,expectedChecks,'expected checks');
  if(expectedCaller!==undefined)for(const [key,value]of Object.entries(expectedCaller)){if(!Object.hasOwn(proof.caller,key))throw Error('Unknown expected renewal CI caller key');equal(proof.caller[key],value,'expected caller');}
  checkRepo(api);
  const edge=verifyEdge(api,proof.executing.head_sha,proof.admission,proof.registry_sha256,proof.controls);
  equal(edge.reviewed,proof.reviewed,'reviewed commit');equal(edge.executing,proof.executing,'executing commit');
  const trigger=api(`repos/${repository}/actions/runs/${proof.trigger.run_id}/attempts/1`);validTrigger(trigger,proof.executing.head_sha);equal(triggerIdentity(trigger),proof.trigger,'immutable triggering attempt');
  const caller=api(`repos/${repository}/actions/runs/${proof.caller.run_id}/attempts/1`);validRun(caller,proof.executing.head_sha,workflows[proof.phase],'workflow_run');
  equal(runIdentity(caller),Object.fromEntries(runKeys.map(key=>[key,proof.caller[key]])),'immutable caller attempt');
  if(clock(caller.run_started_at)>now)throw Error('Renewal CI caller is in the future');
  verifyJobs(api,proof);
  if(historical){
    if(caller.status!=='completed'||caller.conclusion!=='success'||clock(caller.updated_at)<clock(caller.run_started_at)||clock(caller.updated_at)>now)throw Error('Historical renewal CI caller is not terminal successful');
    verifyCallerGateJob(api,proof,caller,{historical:true,now});
  }else{
    if(caller.status!=='in_progress'||caller.conclusion!==null)throw Error('Renewal CI caller is not the active original attempt');
    verifyCallerGateJob(api,proof,caller,{historical:false,now});
    if(api(`repos/${repository}/git/ref/heads/main`)?.object?.sha!==proof.executing.head_sha)throw Error('Renewal CI execution is no longer current main');
    const latestTrigger=api(`repos/${repository}/actions/runs/${proof.trigger.run_id}`);validTrigger(latestTrigger,proof.executing.head_sha);equal(triggerIdentity(latestTrigger),proof.trigger,'latest triggering attempt');
    const latestCaller=api(`repos/${repository}/actions/runs/${proof.caller.run_id}`);validRun(latestCaller,proof.executing.head_sha,workflows[proof.phase],'workflow_run');equal(runIdentity(latestCaller),runIdentity(caller),'latest caller attempt');
    if(latestCaller.status!=='in_progress'||latestCaller.conclusion!==null)throw Error('Renewal CI latest caller is not active');
    const ciRuns=completeRuns(api,ciWorkflow,proof.executing.head_sha,'push').sort((a,b)=>b.id-a.id);
    if(ciRuns[0]?.id!==proof.trigger.run_id||ciRuns[0]?.run_attempt!==1)throw Error('Renewal CI trigger was superseded');
    equal(verifyCorrectionChecks(repository,proof.executing.head_sha,api),proof.checks,'latest required controller CI');
    verifyReplayInventory(api,proof,edge.files,now);
  }
  return proof;
}
function environmentContext(){return {event_name:process.env.GITHUB_EVENT_NAME,repository:process.env.GITHUB_REPOSITORY,repository_id:Number(process.env.GITHUB_REPOSITORY_ID),ref:process.env.GITHUB_REF,
  sha:process.env.GITHUB_SHA,workflow_ref:process.env.GITHUB_WORKFLOW_REF,workflow_sha:process.env.GITHUB_WORKFLOW_SHA,run_id:Number(process.env.GITHUB_RUN_ID),run_attempt:Number(process.env.GITHUB_RUN_ATTEMPT)};}
// Cheap local rejection only. This result grants no authority; every caller
// still executes the full remote admission proof after operational preflight.
export function renewalCiLocalContext({root=process.cwd(),phase,event,context=environmentContext()}={}){
  const eligible=renewalCiEligibility({root,phase});if(eligible.status!=='eligible')return {eligible};
  exact(context,['event_name','repository','repository_id','ref','sha','workflow_ref','workflow_sha','run_id','run_attempt'],'execution context');
  const head=git(root,['rev-parse','HEAD']),tree=git(root,['rev-parse','HEAD^{tree}']);
  git(root,['diff','--exit-code','--quiet','HEAD','--']);
  if(context.event_name!=='workflow_run'||context.repository!==repository||context.repository_id!==repositoryId||context.ref!=='refs/heads/main'||context.sha!==head||context.workflow_sha!==head
    ||context.workflow_ref!==`${repository}/${workflows[phase]}@refs/heads/main`||!positive(context.run_id)||context.run_attempt!==1)throw Error('Renewal CI execution context is not exact main');
  const payload=event??JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  if(payload?.action!=='completed'||payload.repository?.id!==repositoryId||payload.repository.full_name!==repository||payload.repository.default_branch!=='main')throw Error('Invalid renewal CI completion event');
  validTrigger(payload.workflow_run,head);
  return {eligible,head,tree,payload,context};
}
export function verifyRenewalCiAdmission({root=process.cwd(),phase,event,context=environmentContext(),api=githubApi}={}){
  const local=renewalCiLocalContext({root,phase,event,context}),{eligible,head,tree,payload}=local;
  if(eligible.status!=='eligible')return eligible;
  const caller=api(`repos/${repository}/actions/runs/${context.run_id}/attempts/1`);validRun(caller,head,workflows[phase],'workflow_run');
  const checks=verifyCorrectionChecks(repository,head,api);
  const edge=verifyEdge(api,head,eligible.admission,eligible.registry_sha256,eligible.admission.controls);
  if(edge.executing.tree!==tree)throw Error('Renewal CI checkout tree differs from executing commit');equal(checkoutTree(root),edge.files,'complete checkout tree');
  for(const key of keys(phase)){const bytes=localBytes(root,paths[key]);if(blobSha(bytes)!==edge.files[paths[key]]?.sha)throw Error('Renewal CI working controls differ from committed bytes');}
  if(blobSha(localBytes(root,registryPath))!==edge.files[registryPath]?.sha)throw Error('Renewal CI working registry differs from committed bytes');
  const proof={schema_version:proofSchema,producer_event:'workflow_run',phase,repository,repository_id:repositoryId,admission:eligible.admission,admission_sha256:digest(eligible.admission),registry_sha256:eligible.registry_sha256,
    reviewed:edge.reviewed,executing:edge.executing,controls:eligible.admission.controls,trigger:triggerIdentity(payload.workflow_run),checks,
    caller:{...runIdentity(caller),workflow_sha:context.workflow_sha,workflow_ref:context.workflow_ref,ref:context.ref}};
  return verifyRenewalCiProof(proof,{api,expectedHead:head,expectedTree:tree,expectedPhase:phase});
}
