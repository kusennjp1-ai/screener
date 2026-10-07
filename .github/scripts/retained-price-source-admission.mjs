// One inactive-by-default Oct6 source derivation. A diagnostic is never a source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,realpathSync,writeFileSync,appendFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PRICE_REQUEST_PATH,PRICE_CI,priceControllerRoot,priceReadApi,verifyPriceActivation,verifyPriceSourceCompletion,isVerifiedPriceSourceProof} from './retained-price-ci-admission.mjs';

export const ROOT=join(dirname(fileURLToPath(import.meta.url)),'../../');
export const REPAIR_SCHEMA='retained-price-source-declaration-v1';
export const IMMUTABLE_REQUEST_SHA256='516bfb60f2bc6114767840a9f5a1563343f74e2537ece362cc7b6ea88d446c1e';
const repo='kusennjp1-ai/screener',prefix=`repos/${repo}`,MAX_JSON=64*1024**2;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const gitHash=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
const sort=value=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;
export const canonical=value=>Buffer.from(JSON.stringify(sort(value)));
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const binding=bytes=>({bytes:Buffer.byteLength(bytes),sha256:digest(bytes)});
const equal=(a,b,why)=>assert.equal(digest(canonical(a)),digest(canonical(b)),why);
export function closed(value,keys,why){assert(value&&typeof value==='object'&&!Array.isArray(value),why);assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),why);return value;}
function readRaw(path,cap=MAX_JSON){const full=resolve(path),stat=lstatSync(full);assert(stat.isFile()&&!stat.isSymbolicLink()&&realpathSync(full)===full&&stat.size<=cap,'Unsafe/oversized source proof file');return readFileSync(full);}
export function validateRepairRequest(value){
  assert(value?.schema_version==='retained-price-oct6-source-v1'&&typeof value.enabled==='boolean','Invalid finite repair request');
  const {enabled,activation,...body}=value;assert.equal(digest(canonical(body)),IMMUTABLE_REQUEST_SHA256,'Unreviewed finite request body or unknown field');
  if(!enabled)assert.equal(activation,null,'Disabled repair must have no activation');
  else{closed(activation,['reviewed_parent_sha','reviewed_parent_tree','disabled_request_sha256','not_before','not_after'],'Invalid activation envelope');
    assert(gitHash(activation.reviewed_parent_sha)&&gitHash(activation.reviewed_parent_tree)&&hash(activation.disabled_request_sha256),'Invalid activation identities');
    assert(iso(activation.not_before)&&iso(activation.not_after)&&Date.parse(activation.not_before)<Date.parse(activation.not_after),'Invalid activation interval');}
  return value;
}
export function readRepairRequest(root=ROOT){const path=join(root,PRICE_REQUEST_PATH);if(!existsSync(path))return null;const raw=readRaw(path,128*1024),value=validateRepairRequest(JSON.parse(raw));return {raw,value,sha256:digest(raw)};}
export function repairControllerRoot(){
  return priceControllerRoot();
}
export function assertRepairPredecessor(live,request){
  validateRepairRequest(request);assert(request.enabled,'Repair is inactive');
  assert(live?.identity===request.predecessor.identity&&live.uiSha===request.approved_ui.sha,'Actual current repair predecessor or approved UI changed');
  assert(live.financialRelease?.lineage_sha256===request.predecessor.financial_lineage_sha256
    &&live.financialRelease.financial_generation===request.predecessor.financial_generation,'Actual current financial lineage changed');
  return true;
}
const sameRepo=run=>['repository','head_repository'].every(k=>run?.[k]?.id===1203919607&&run[k].full_name===repo);
function paged(get,endpoint,key){const pages=get(endpoint,true);assert(Array.isArray(pages)&&pages.length>0&&pages.length<=100,'Incomplete source pages');const total=pages[0].total_count;
  assert(Number.isSafeInteger(total)&&total>=0&&pages.every(p=>p.total_count===total&&Array.isArray(p[key])),'Invalid source page count');
  const all=pages.flatMap(p=>p[key]);assert(all.length===total&&all.every(v=>positive(v.id))&&new Set(all.map(v=>v.id)).size===all.length,'Missing/duplicate source inventory');return all;}
function step(job,name){const selected=job.steps.filter(s=>s.name===name);assert.equal(selected.length,1,`Missing source step ${name}`);const s=selected[0];
  assert(s.status==='completed'&&s.conclusion==='success'&&iso(s.started_at)&&iso(s.completed_at)&&Date.parse(s.started_at)>=Date.parse(job.started_at)&&Date.parse(s.completed_at)>=Date.parse(s.started_at)&&Date.parse(s.completed_at)<=Date.parse(job.completed_at),'Source step status/clock changed');return s;}

/** Fresh original records only. The legacy schema describes original-input proof,
 * never authority of this new producer or the earlier diagnostic caller. */
export function authenticateOriginals({api=priceReadApi,request,caller,controller,now=Date.now()}={}){
  validateRepairRequest(request);assert(request.enabled,'Repair is inactive');const responses={},response_sha256={},selected={},archives={};
  const get=(endpoint,pages=false)=>{const key=`${pages?'GET_PAGES':'GET'} ${endpoint}`;if(!Object.hasOwn(responses,key)){responses[key]=api(endpoint,pages);response_sha256[key]=digest(Buffer.from(JSON.stringify(responses[key])));}return responses[key];};
  const pins=request.originals,roles={candidate:{...pins.candidate,tree:'2186101e92e1f71771936831cea0a40e410975f7',workflow:'.github/workflows/static-site.yml',workflow_id:294257497,job:'combine-and-build'},
    prior:{...pins.prior,artifact_name:`github-pages-${pins.prior.run_id}-1`,tree:'00a8eaa6b14b977f31f24ac9f708872c2dbe5ee9',workflow:'.github/workflows/research-ui-release.yml',workflow_id:364666954,job:'publish'}};
  const repository=get(prefix);assert(repository.id===1203919607&&repository.full_name===repo&&repository.private===false&&repository.visibility==='public'&&repository.default_branch==='main'&&repository.owner?.id===265297436&&repository.owner.login==='kusennjp1-ai','Original repository identity changed');
  for(const [role,pin]of Object.entries(roles)){
    const run=get(`${prefix}/actions/runs/${pin.run_id}/attempts/1`),current=get(`${prefix}/actions/runs/${pin.run_id}`);
    for(const r of [run,current])assert(r.id===pin.run_id&&r.run_attempt===1&&r.head_sha===pin.head_sha&&r.head_branch==='main'&&r.path===pin.workflow&&r.workflow_id===pin.workflow_id&&sameRepo(r)&&r.status==='completed'&&['success','failure'].includes(r.conclusion)&&r.head_commit?.id===pin.head_sha&&r.head_commit.tree_id===pin.tree&&(role==='candidate'?['schedule','workflow_dispatch'].includes(r.event):r.event==='workflow_run'&&r.run_number===99&&r.conclusion==='success'),'Original source run changed');
    equal([run.id,run.run_attempt,run.head_sha,run.event,run.conclusion],[current.id,current.run_attempt,current.head_sha,current.event,current.conclusion],'Original source attempt is no longer current');
    const commit=get(`${prefix}/git/commits/${pin.head_sha}`);assert(commit.sha===pin.head_sha&&commit.tree?.sha===pin.tree,'Original source Git tree changed');
    const jobs=paged(get,`${prefix}/actions/runs/${pin.run_id}/attempts/1/jobs?per_page=100`,'jobs');
    assert(jobs.every(j=>j.run_id===pin.run_id&&j.run_attempt===1&&j.head_sha===pin.head_sha&&j.status==='completed'),'Original job scope changed');
    const found=jobs.filter(j=>j.name===pin.job&&j.conclusion==='success');assert.equal(found.length,1,'Ambiguous original producer');const job=found[0];assert(iso(job.started_at)&&iso(job.completed_at)&&iso(run.run_started_at)&&Date.parse(job.started_at)>=Date.parse(run.run_started_at)&&Date.parse(job.completed_at)>=Date.parse(job.started_at)&&Date.parse(job.completed_at)<=now,'Invalid original job clock');
    for(const name of role==='candidate'?['Build static frontend','Upload verified data export','Preserve dated export provenance for release selection']:['Run actions/upload-pages-artifact@v4','Deploy to GitHub Pages'])step(job,name);
    if(role==='prior')assert.equal(job.id,112314516098,'Historical deployment job changed');
    const all=paged(get,`${prefix}/actions/runs/${pin.run_id}/artifacts?per_page=100`,'artifacts');
    const values=role==='candidate'?[['candidate',pin.artifact_id,pin.artifact_name,pin.bytes,pin.sha256],['companion',pin.companion_artifact_id,`static-site-data-manifest-${pin.run_id}-1`,pin.companion_bytes,pin.companion_sha256]]:[['prior',pin.artifact_id,pin.artifact_name,pin.bytes,pin.sha256]];
    for(const [name,id,artifactName,bytes,sha256]of values){const matches=all.filter(a=>a.name===artifactName);assert.equal(matches.length,1,'Ambiguous original archive');const a=matches[0];
      assert(a.id===id&&a.size_in_bytes===bytes&&a.digest==='sha256:'+sha256&&a.expired===false&&iso(a.created_at)&&iso(a.expires_at)&&Date.parse(a.expires_at)>now&&a.workflow_run?.id===pin.run_id&&a.workflow_run.head_sha===pin.head_sha&&a.workflow_run.head_branch==='main'&&a.workflow_run.repository_id===1203919607&&a.workflow_run.head_repository_id===1203919607&&Date.parse(a.created_at)>=Date.parse(job.started_at)&&Date.parse(a.created_at)<=Date.parse(job.completed_at),'Original archive identity/clock changed');
      if(role==='prior')assert(Date.parse(a.created_at)<=Date.parse(step(job,'Deploy to GitHub Pages').started_at),'Historical archive postdates deploy');
      selected[name]={run,current,jobs,producer_job:job,artifact:a};archives[name]={artifact_id:id,artifact_name:artifactName,bytes,sha256,artifact:a};
    }
  }
  const runtimePath=join(ROOT,'.github/scripts/fixtures/retained-price-producer-runtime-oct6.json'),runtimeRaw=readRaw(runtimePath);
  assert.equal(digest(runtimeRaw),'ee0d0ac8caab92b3932ea7505b8f340640be3156c7a2d7cc64497c4a808c4195','Original producer runtime review changed');
  const runtime=JSON.parse(runtimeRaw),tree=get(`${prefix}/git/trees/${roles.candidate.tree}?recursive=1`);assert(tree.sha===roles.candidate.tree&&tree.truncated===false,'Incomplete original producer tree');
  assert(tree.tree.some(x=>x.path===runtime.workflow_path&&x.sha===runtime.workflow_git_blob_sha&&x.mode==='100644')&&tree.tree.some(x=>x.path==='backend/app/services/static_site_export_service.py'&&x.sha==='358938e52b903ae6bfed4d80a8f73160389ddd1e'&&x.mode==='100644'),'Original arithmetic code changed');
  const main=get(`${prefix}/git/ref/heads/main`);
  return {archives,evidence:{schema_version:'oct6-retained-price-rehearsal-api-v1',publication_authority:false,provider_work:false,observed_at:new Date(now).toISOString(),caller,
    reviewed_historical_main:{sha:'22548890d0fe161edf7be3943b1775c4f293d0d9',tree:'8245b42cdff76c1fe51c652227a0eb8d6809cf63'},
    current_main_observation:{role:'current_controller_observation_only',sha:main.object.sha,controller},approved_ui:request.approved_ui,producer_runtime:runtime,selected,responses,response_sha256}};
}

const REPAIR_KEYS=['schema_version','request_sha256','producer_controller_tree','predecessor_identity','artifact','payload_json','payload_sha256','physical_inventory_json','physical_inventory_sha256'];
export function parseRepairDeclaration(value){
  closed(value,REPAIR_KEYS,'Unknown repair declaration field');assert(value.schema_version===REPAIR_SCHEMA&&hash(value.request_sha256)&&gitHash(value.producer_controller_tree),'Invalid repair declaration');
  closed(value.artifact,['id','name','bytes','sha256'],'Invalid declared source archive');assert(positive(value.artifact.id)&&positive(value.artifact.bytes)&&hash(value.artifact.sha256),'Invalid declared archive identity');
  for(const name of ['payload','physical_inventory'])assert(typeof value[name+'_json']==='string'&&Buffer.byteLength(value[name+'_json'])<=MAX_JSON&&hash(value[name+'_sha256'])&&digest(value[name+'_json'])===value[name+'_sha256'],'Unbound/oversized source proof');
  assert(Buffer.byteLength(value.payload_json)+Buffer.byteLength(value.physical_inventory_json)<=MAX_JSON,'Combined source proof exceeds bound');
  return {declaration:{raw:Buffer.from(value.payload_json),value:JSON.parse(value.payload_json),sha256:value.payload_sha256},physical:{raw:Buffer.from(value.physical_inventory_json),value:JSON.parse(value.physical_inventory_json),sha256:value.physical_inventory_sha256}};
}
export function authenticateRepairSource({root=repairControllerRoot(),source,api=priceReadApi,now=Date.now()}={}){
  const request=readRepairRequest(root);assert(request?.value.enabled,'Finite repaired source is inactive');const repair=source.repair,parsed=parseRepairDeclaration(repair);
  assert(repair.request_sha256===request.sha256&&repair.predecessor_identity===request.value.predecessor.identity,'Repair request/predecessor declaration changed');
  const currentRun=api(`${prefix}/actions/runs/${source.runId}`),proof=verifyPriceSourceCompletion({root,sourceRun:currentRun,api,now});
  assert(isVerifiedPriceSourceProof(proof,{sourceRunId:source.runId,controllerSha:proof.activation.executing.sha,controllerTree:repair.producer_controller_tree}),'Missing actual finite producer proof');
  const producer={run_id:proof.producer.id,run_attempt:proof.producer.run_attempt,head_sha:proof.producer.head_sha,job:{id:proof.job.id,started_at:proof.job.started_at,completed_at:proof.job.completed_at}};
  const expectedProducer={...producer,job:{id:producer.job.id,started_at:producer.job.started_at}};
  equal(parsed.declaration.value.producer,expectedProducer,'Payload belongs to another producer');
  assert(iso(parsed.declaration.value.evaluated_at)&&Date.parse(parsed.declaration.value.evaluated_at)>=Date.parse(producer.job.started_at)&&Date.parse(parsed.declaration.value.evaluated_at)<=Date.parse(producer.job.completed_at),'Producer evaluation was not sampled in its real job');
  assert(parsed.declaration.value.request_sha256===request.sha256&&parsed.declaration.value.schema_version==='retained-price-source-payload-v1','Payload request changed');equal(parsed.declaration.value.approved_ui,request.value.approved_ui,'Payload approved UI changed');
  for(const a of [source.artifact,source.companion]){assert(a&&positive(a.id),'Missing source artifact');const fresh=api(`${prefix}/actions/artifacts/${a.id}`);equal(fresh,a,'Selected source artifact changed');assert(a.expired===false&&iso(a.expires_at)&&Date.parse(a.expires_at)>now&&a.workflow_run?.id===producer.run_id&&a.workflow_run.head_sha===producer.head_sha&&Date.parse(a.created_at)>=Date.parse(producer.job.started_at)&&Date.parse(a.created_at)<=Date.parse(producer.job.completed_at),'Source artifact/companion producer clock changed');}
  equal(repair.artifact,{id:source.artifact.id,name:source.artifact.name,bytes:source.artifact.size_in_bytes,sha256:source.artifact.digest?.replace(/^sha256:/,'')},'Repair archive binding changed');
  return {request,activation:proof.activation,producer:proof.producer,...parsed,artifact:source.artifact,companion:source.companion,proof};
}

export async function verifyRepairRestore({source,selectedRoot,live,output,jobStart,api=priceReadApi,root=repairControllerRoot()}={}){
  const authenticated=authenticateRepairSource({root,source,api});assertRepairPredecessor(live,authenticated.request.value);
  const {replayRetainedSource}=await import('./retained-price-source-driver.mjs');
  return replayRetainedSource({root,output,jobStart,authority:authorityExports(),api,source,selectedRoot,live});
}
export function prepareCleanController(output,{root=ROOT,api=priceReadApi}={}){
  const request=readRepairRequest(root);if(!request?.value.enabled)return {active:false};const active=verifyPriceActivation({root,api});
  assert(process.env.RUNNER_TEMP&&resolve(output)===resolve(process.env.RUNNER_TEMP,'retained-price-controller')&&!existsSync(output),'Invalid clean controller destination');
  execFileSync('git',['worktree','add','--detach',resolve(output),active.executing.sha],{cwd:root,stdio:'pipe',timeout:120000});
  const verified=verifyPriceActivation({root:resolve(output),api});equal(verified.executing,active.executing,'Detached controller identity changed');
  if(process.env.GITHUB_ENV)appendFileSync(process.env.GITHUB_ENV,`RETAINED_PRICE_CONTROLLER_ROOT=${resolve(output)}\n`);return {active:true,root:resolve(output),...active.executing};
}
export function authorityExports(){return {ROOT,readRepairRequest,validateRepairRequest,authenticateOriginals,assertRepairPredecessor,authenticateRepairSource,digest,canonical,binding,repairControllerRoot};}
async function main(argv){
  // Enter after module evaluation: the publication reader also imports this
  // finite adapter. Only immutable Git objects are cached for this invocation.
  const {withInvocationImmutableGitApi,githubApi}=await import('./publication-gate.mjs');
  return withInvocationImmutableGitApi(repo,async()=>{
    if(argv[0]==='prepare-controller'){assert(argv.length===3&&argv[1]==='--output','Invalid prepare-controller command');console.log(JSON.stringify(prepareCleanController(argv[2],{api:githubApi})));return;}
    const {runRetainedSourceCommand}=await import('./retained-price-source-driver.mjs');await runRetainedSourceCommand(argv,{root:repairControllerRoot(),authority:authorityExports(),api:githubApi});
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let completed=false;
  process.once('beforeExit',()=>{if(!completed){console.error('Finite source command did not complete');process.exitCode=1;}});
  main(process.argv.slice(2)).then(()=>{completed=true;},error=>{completed=true;console.error(error.stack||error);process.exitCode=1;});
}
