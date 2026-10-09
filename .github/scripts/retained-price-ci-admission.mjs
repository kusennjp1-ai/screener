// A finite CI completion schedules one reviewed price replay. It grants no
// source, financial, UI or publication authority by itself.
import {execFileSync} from 'node:child_process';
import {createRetainedPriceAdmissionInventory} from './retained-price-admission-inventory.mjs';
import {hasScopedConditionalJobContext,bindScopedConditionalCaller} from './conditional-deployment-jobs.mjs';
import {createHash} from 'node:crypto';
import {appendFileSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PRICE_REQUEST_PATH='.github/retained-price-oct6-source.json';
export const PRICE_CI=Object.freeze({repository:'kusennjp1-ai/screener',repositoryId:1203919607,
  ci:{id:294252465,path:'.github/workflows/ci.yml'},producer:{id:294257497,path:'.github/workflows/static-site.yml'},
  publisher:{id:364666954,path:'.github/workflows/research-ui-release.yml'}});
export const PRICE_HOLD_STEP='Hold finite retained-price activation';
export const PRICE_REPAIR_STEP='Verify finite retained-price repair';
const prefix=`repos/${PRICE_CI.repository}`;
const sourceProofs=new WeakMap();
const runObservations=new WeakMap();
const admissionDiagnostics=new WeakMap();
export function priceAdmissionDiagnostic(result){return admissionDiagnostics.get(result)??null;}
function recordAdmission(result,observations){
  const raw=JSON.stringify({schema_version:'retained-price-ci-diagnostic-v1',observations},null,2);
  require(Buffer.byteLength(raw)<=8*1024**2,'admission diagnostic exceeds bounded output');
  admissionDiagnostics.set(result,raw);console.log(raw);return result;
}
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export function isVerifiedPriceSourceProof(proof,{sourceRunId,controllerSha,controllerTree}={}){
  const context=proof&&sourceProofs.get(proof);if(!context)return false;
  try{
    const current=readRequest(context.root);
    return Boolean(current?.value.enabled&&checksum(current.raw)===proof.activation.request_sha256
      &&git(context.root,'rev-parse','HEAD')===proof.activation.executing.sha
      &&context.api(`${prefix}/git/ref/heads/main`)?.object?.sha===proof.activation.executing.sha
      &&Date.now()<clock(current.value.activation.not_after)
      &&(!sourceRunId||proof.producer.id===sourceRunId)&&(!controllerSha||proof.activation.executing.sha===controllerSha)&&(!controllerTree||proof.activation.executing.tree===controllerTree));
  }catch{return false;}
}
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const checksum=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const canonical=v=>JSON.stringify(v,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const equal=(a,b,label)=>{if(canonical(a)!==canonical(b))throw Error(`Finite price ${label} changed`);};
const require=(ok,label)=>{if(!ok)throw Error(`Finite price ${label}`);};
const exact=(value,keys,label)=>require(object(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|'),`invalid closed ${label}`);
const clock=value=>{require(typeof value==='string'&&/^\d{4}-\d\d-\d\dT.*Z$/.test(value)&&Number.isFinite(Date.parse(value)),'invalid UTC clock');return Date.parse(value);};
const pathSafe=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=4096&&!/[\x00-\x1f\x7f\\]/.test(value)&&!value.startsWith('/')&&value.split('/').every(x=>x&&x!=='.'&&x!=='..');
const sameRepo=run=>run?.repository?.full_name===PRICE_CI.repository&&run.repository.id===PRICE_CI.repositoryId&&run.head_repository?.full_name===PRICE_CI.repository&&run.head_repository.id===PRICE_CI.repositoryId;
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024**2}).trim();
export function priceReadApi(endpoint,paginate=false){return JSON.parse(execFileSync('gh',['api',...(paginate?['--paginate','--slurp']:[]),endpoint],{encoding:'utf8',maxBuffer:64*1024**2}));}
export function priceControllerRoot(){
  if(process.env.RETAINED_PRICE_CONTROLLER_ROOT===undefined)return process.cwd();
  const temp=process.env.RUNNER_TEMP,workspace=process.env.GITHUB_WORKSPACE,root=process.env.RETAINED_PRICE_CONTROLLER_ROOT;
  require(typeof temp==='string'&&isAbsolute(temp)&&typeof workspace==='string'&&isAbsolute(workspace)
    &&root===join(temp,'retained-price-controller'),'unexpected clean controller path');
  require(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink()&&realpathSync(root)===root,'linked clean controller root');
  require(git(root,'rev-parse','--show-toplevel')===root,'replaced clean controller root');
  const common=resolve(root,git(root,'rev-parse','--git-common-dir'));
  require(realpathSync(common)===realpathSync(join(workspace,'.git')),'controller is not the original checkout worktree');
  const entries=git(workspace,'worktree','list','--porcelain').split('\n\n').map(block=>block.split('\n'));
  const matching=entries.filter(lines=>lines.includes(`worktree ${root}`));
  require(matching.length===1&&matching[0].includes('detached'),'controller is not registered detached worktree');
  return root;
}
export function priceExecution(){return {event_name:process.env.GITHUB_EVENT_NAME,repository:process.env.GITHUB_REPOSITORY,repository_id:Number(process.env.GITHUB_REPOSITORY_ID),ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,workflow_ref:process.env.GITHUB_WORKFLOW_REF,workflow_sha:process.env.GITHUB_WORKFLOW_SHA,run_id:Number(process.env.GITHUB_RUN_ID),run_attempt:Number(process.env.GITHUB_RUN_ATTEMPT)};}
function readRequest(root){
  const path=join(root,PRICE_REQUEST_PATH);let stat;try{stat=lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  require(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=1024**2,'request is not a bounded regular file');
  const raw=readFileSync(path),value=JSON.parse(raw);require(object(value)&&value.schema_version==='retained-price-oct6-source-v1'&&typeof value.enabled==='boolean'&&Object.hasOwn(value,'activation'),'invalid request envelope');
  if(!value.enabled)require(value.activation===null,'disabled request has activation');
  return {raw,value};
}
function treeFiles(response){
  require(sha(response?.sha)&&response.truncated===false&&Array.isArray(response.tree)&&response.tree.length>0&&response.tree.length<=60000,'incomplete Git tree');
  const files={},seen=new Set();for(const item of response.tree){require(pathSafe(item?.path)&&!seen.has(item.path)&&sha(item.sha),'invalid Git tree entry');seen.add(item.path);
    if(item.type==='tree'&&item.mode==='040000')continue;
    require(item.type==='blob'&&['100644','100755'].includes(item.mode),'nonregular Git tree member');files[item.path]={sha:item.sha,mode:item.mode};}
  require(Object.keys(files).length>0&&Object.keys(files).length<=30000,'unbounded Git file inventory');return files;
}
function remoteCommit(api,id){const c=api(`${prefix}/git/commits/${id}`);require(c?.sha===id&&sha(c.tree?.sha)&&Array.isArray(c.parents)&&c.parents.every(p=>sha(p?.sha)),'invalid immutable commit');return c;}
function remoteTree(api,id){const t=api(`${prefix}/git/trees/${id}?recursive=1`);require(t?.sha===id,'Git tree identity mismatch');return treeFiles(t);}
function remoteRequest(api,head,files){
  const v=api(`${prefix}/contents/${PRICE_REQUEST_PATH}?ref=${head}`);require(v?.type==='file'&&v.path===PRICE_REQUEST_PATH&&v.encoding==='base64'&&positive(v.size)&&v.size<=1024**2&&typeof v.content==='string'&&v.sha===files[PRICE_REQUEST_PATH]?.sha,'unbound request bytes');
  const bytes=Buffer.from(v.content,'base64');require(bytes.length===v.size&&blob(bytes)===v.sha,'request Git blob mismatch');return bytes;
}
function localTree(root){
  const files={};for(const line of execFileSync('git',['ls-tree','-r','-z','--full-tree','HEAD'],{cwd:root,encoding:'utf8',maxBuffer:32*1024**2}).split('\0').filter(Boolean)){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);require(match&&pathSafe(match[3])&&!Object.hasOwn(files,match[3]),'invalid checkout tree');files[match[3]]={mode:match[1],sha:match[2]};}
  git(root,'diff','--quiet','HEAD','--');require(!git(root,'ls-files','--others','--exclude-standard'),'untracked checkout inputs');return files;
}
export function verifyPriceActivation({root=priceControllerRoot(),api=priceReadApi,now=Date.now()}={}){
  const request=readRequest(root);if(!request||!request.value.enabled)return {status:'disabled'};
  const a=request.value.activation;exact(a,['reviewed_parent_sha','reviewed_parent_tree','disabled_request_sha256','not_before','not_after'],'activation');
  require(sha(a.reviewed_parent_sha)&&sha(a.reviewed_parent_tree)&&hash(a.disabled_request_sha256)&&Number.isFinite(now),'invalid activation binding');
  const start=clock(a.not_before),end=clock(a.not_after);require(start<=now&&now<end&&end-start>0&&end-start<=24*3600*1000,'activation outside finite window');
  const head=git(root,'rev-parse','HEAD'),tree=git(root,'rev-parse','HEAD^{tree}');require(sha(head)&&sha(tree),'invalid local Git identity');
  const repo=api(prefix);require(repo?.id===PRICE_CI.repositoryId&&repo.full_name===PRICE_CI.repository&&repo.default_branch==='main','official repository changed');
  require(api(`${prefix}/git/ref/heads/main`)?.object?.sha===head,'controller is no longer current main');
  const current=remoteCommit(api,head),parent=remoteCommit(api,a.reviewed_parent_sha);
  require(current.tree.sha===tree&&parent.tree.sha===a.reviewed_parent_tree&&current.parents.length===1&&current.parents[0].sha===parent.sha,'not exact reviewed parent child');
  const before=remoteTree(api,parent.tree.sha),after=remoteTree(api,tree);equal(localTree(root),after,'checkout');
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>canonical(before[p]??null)!==canonical(after[p]??null));
  require(changed.length===1&&changed[0]===PRICE_REQUEST_PATH&&before[PRICE_REQUEST_PATH]?.mode==='100644'&&after[PRICE_REQUEST_PATH]?.mode==='100644','activation must change only existing request blob');
  const oldRaw=remoteRequest(api,parent.sha,before),newRaw=remoteRequest(api,head,after);require(checksum(oldRaw)===a.disabled_request_sha256&&newRaw.equals(request.raw),'request bytes changed');
  const old=JSON.parse(oldRaw);require(old.enabled===false&&old.activation===null,'parent request is not disabled');
  equal({...request.value,enabled:false,activation:null},old,'immutable request body');
  return {status:'active',request:request.value,request_sha256:checksum(request.raw),reviewed_parent:{sha:parent.sha,tree:parent.tree.sha,request_sha256:checksum(oldRaw)},executing:{sha:head,tree},verified_at:now,files:after};
}
function runIdentity(run){return Object.fromEntries(['id','run_attempt','workflow_id','path','head_sha','head_branch','event','created_at','run_started_at','repository','head_repository'].map(k=>[k,['repository','head_repository'].includes(k)?{id:run[k]?.id,full_name:run[k]?.full_name}:run[k]]));}
function completedIdentity(run){return {...runIdentity(run),status:run.status,conclusion:run.conclusion,updated_at:run.updated_at};}
function observedRunIdentity(run){return run.status==='in_progress'&&run.conclusion===null?{...runIdentity(run),status:run.status,conclusion:run.conclusion}:completedIdentity(run);}
function validRun(run,workflow,head,event,{attempt=false}={}){
  require(positive(run?.id)&&run.run_attempt===1&&run.workflow_id===workflow.id&&run.path===workflow.path&&run.head_sha===head&&run.head_branch==='main'&&run.event===event&&sameRepo(run),'wrong run identity/current attempt');
  const created=clock(run.created_at),started=clock(run.run_started_at);
  if(!attempt)require(created<=started,'invalid run clocks');
}
function completeInventory(api,endpoint,key,validate){
  const pages=api(endpoint,true);require(Array.isArray(pages)&&pages.length>0&&pages.length<=10,'missing complete API inventory');
  const total=pages[0]?.total_count;require(Number.isSafeInteger(total)&&total>=0&&total<=1000&&pages.length===Math.max(1,Math.ceil(total/100)),'unbounded API inventory');
  const result=[],ids=new Set();for(let i=0;i<pages.length;i++){const page=pages[i];require(page.total_count===total&&Array.isArray(page[key])&&page[key].length===Math.min(100,Math.max(0,total-i*100)),'truncated API inventory');
    for(const item of page[key]){require(positive(item?.id)&&!ids.has(item.id),'duplicate API identity');ids.add(item.id);validate(item);result.push(item);}}
  return result;
}
function runs(api,workflow,head,event){return completeInventory(api,`${prefix}/actions/workflows/${workflow.id}/runs?branch=main&event=${event}&head_sha=${head}&per_page=100`,'workflow_runs',r=>require(r.path===workflow.path&&r.workflow_id===workflow.id&&r.head_sha===head&&r.head_branch==='main'&&r.event===event&&sameRepo(r)&&positive(r.run_attempt),'invalid listed run'));}
function jobs(api,id){return completeInventory(api,`${prefix}/actions/runs/${id}/attempts/1/jobs?per_page=100`,'jobs',j=>require(j.run_id===id&&j.run_attempt===1&&sha(j.head_sha),'invalid listed job'));}
function exactAttempt(api,id,workflow,head,event){
  const original=api(`${prefix}/actions/runs/${id}/attempts/1`),current=api(`${prefix}/actions/runs/${id}`);validRun(original,workflow,head,event,{attempt:true});validRun(current,workflow,head,event);
  const observedAt=Date.now();
  require(original.id===id&&current.id===id,'wrong run response');
  // GitHub's attempt creation is a distinct observation, sometimes after the
  // run has started; attempt metadata may also finish updating after the run.
  // The run endpoint alone defines run chronology. Keep both literal resources
  // and exact attempt/head/status/start bindings, never an arithmetic tolerance.
  const attemptIdentity={...observedRunIdentity(original),created_at:current.created_at};
  if(current.status!=='in_progress'||current.conclusion!==null)attemptIdentity.updated_at=current.updated_at;
  equal(observedRunIdentity(current),attemptIdentity,'current/original attempt');
  require(Number.isFinite(observedAt)&&clock(current.created_at)<=clock(original.created_at)&&clock(original.created_at)<=clock(original.updated_at)
    &&clock(original.created_at)<=clock(current.updated_at)
    &&clock(current.run_started_at)<=clock(current.updated_at)&&clock(current.run_started_at)<=clock(original.updated_at)
    &&clock(current.updated_at)<=observedAt&&clock(original.updated_at)<=observedAt
    &&(current.status!=='completed'||clock(current.updated_at)<=clock(original.updated_at)),'invalid attempt observation clocks');
  runObservations.set(current,{run:structuredClone(current),attempt:structuredClone(original)});return current;
}
function verifyCi(api,activation,payload=null){
  const head=activation.executing.sha,listed=runs(api,PRICE_CI.ci,head,'push').sort((a,b)=>b.id-a.id);require(listed.length>0,'no exact controller CI');
  const run=exactAttempt(api,listed[0].id,PRICE_CI.ci,head,'push');equal(completedIdentity(listed[0]),completedIdentity(run),'listed CI');
  require(run.status==='completed'&&run.conclusion==='success'&&clock(run.run_started_at)<=clock(run.updated_at)&&clock(run.updated_at)<=activation.verified_at,'CI is not terminal success');
  if(payload)equal(completedIdentity(payload),completedIdentity(run),'CI completion payload');
  const all=jobs(api,run.id),required=['Backend Quality Gates','Frontend','Static Browser Regression'];
  const checks=required.map(name=>{const found=all.filter(j=>j.name===name);require(found.length===1,'missing or duplicate required CI job');const j=found[0];require(j.head_sha===head&&j.status==='completed'&&j.conclusion==='success'&&clock(j.started_at)>=clock(run.run_started_at)&&clock(j.completed_at)>=clock(j.started_at)&&clock(j.completed_at)<=clock(run.updated_at),'required CI job failed or changed');return{id:j.id,name};});
  return {run,checks,jobs:all,required_completed_at:Math.max(...all.filter(j=>required.includes(j.name)).map(j=>clock(j.completed_at)))};
}
function ciObservation(ci){return {...runObservations.get(ci.run),jobs:ci.jobs};}
function verifyContext(api,activation,execution,workflow){
  const head=activation.executing.sha;require(execution.event_name==='workflow_run'&&execution.repository===PRICE_CI.repository&&execution.repository_id===PRICE_CI.repositoryId&&execution.ref==='refs/heads/main'&&execution.sha===head&&execution.workflow_sha===head&&execution.workflow_ref===`${PRICE_CI.repository}/${workflow.path}@refs/heads/main`&&positive(execution.run_id)&&execution.run_attempt===1,'execution is not exact original main workflow');
  const own=exactAttempt(api,execution.run_id,workflow,head,'workflow_run');require(own.status==='in_progress'&&own.conclusion===null&&clock(own.run_started_at)<=activation.verified_at,'caller is not active original attempt');return own;
}
function verifyEvent(event){require(event?.action==='completed'&&event.repository?.id===PRICE_CI.repositoryId&&event.repository.full_name===PRICE_CI.repository&&event.repository.default_branch==='main','invalid completed event repository');}
const terminalConclusions=new Set(['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure']);
function ignoredCiCallback(api,activation,payload,own){
  const head=payload?.head_sha;
  require(head===activation.executing.sha||head===activation.reviewed_parent.sha,'CI callback is not exact activation or reviewed parent');
  if(head===activation.executing.sha&&payload.conclusion==='success')return false;
  const run=exactAttempt(api,payload.id,PRICE_CI.ci,head,'push');equal(completedIdentity(payload),completedIdentity(run),'ignored CI completion payload');
  require(run.status==='completed'&&terminalConclusions.has(run.conclusion)&&clock(run.run_started_at)<=clock(run.updated_at)
    &&clock(run.updated_at)<=activation.verified_at&&clock(run.updated_at)<=clock(own.created_at),'ignored CI is not terminal before callback');
  return run;
}
const producerAdmission='Admit only the finite exact-main price CI trigger';
const publisherAdmission='Route the finite price activation before any publication';
const producerPick='Run ASIA=\'["HK","IN","JP","KR","TW","CN","SG","MY","AU"]\'';
function preAdmissionCallback(api,activation,listed,workflow,ci){
  const run=exactAttempt(api,listed.id,workflow,activation.executing.sha,'workflow_run');equal(completedIdentity(listed),completedIdentity(run),'pre-admission callback list');
  require(run.status==='completed'&&['failure','cancelled','success'].includes(run.conclusion)
    &&clock(run.run_started_at)<=clock(run.updated_at)&&clock(run.updated_at)<ci.required_completed_at
    &&clock(runObservations.get(run).attempt.updated_at)<ci.required_completed_at,'activation already consumed by possible admitted callback');
  const all=jobs(api,run.id),artifacts=completeInventory(api,`${prefix}/actions/runs/${run.id}/artifacts?per_page=100`,'artifacts',()=>{});
  require(artifacts.length===0,'pre-admission callback has artifacts');
  const observation={run:runObservations.get(run),jobs:all,artifacts,required_ci_run_id:ci.run.id,required_ci_job_completed_at:new Date(ci.required_completed_at).toISOString()};
  if(all.length===0){require(run.conclusion==='cancelled','zero-job callback is not cancelled');return {...observation,reason:'cancelled_before_jobs_and_required_ci'};}
  const producer=workflow===PRICE_CI.producer,name=producer?'select-markets':'Route exact renewal CI admission';
  const expectedJobs=producer?[name,'ensure_daily_price_release','build-market','combine-and-build','promote-daily-source']:[name,'publish'];
  require(all.length===expectedJobs.length&&expectedJobs.every(n=>all.filter(j=>j.name===n).length===1),'unknown or incomplete pre-admission job inventory');
  require(all.every(j=>j.head_sha===activation.executing.sha&&j.status==='completed'&&Array.isArray(j.steps)),'nonterminal pre-admission job inventory');
  require(all.every(j=>clock(j.started_at)<ci.required_completed_at&&clock(j.completed_at)<ci.required_completed_at),'pre-admission job reaches CI admission');
  const route=all.find(j=>j.name===name);
  require(all.filter(j=>j!==route).every(j=>j.conclusion==='skipped'&&j.steps.length===0),'pre-admission downstream work started');
  // Skipped jobs/steps carry GitHub placeholder clocks, including inverted
  // timestamps. They are never treated as executed work or chronology proof.
  require(clock(route.started_at)>=clock(run.run_started_at)&&clock(route.completed_at)>=clock(route.started_at)&&clock(route.completed_at)<=clock(run.updated_at),'invalid executed admission job clocks');
  const noop=producer&&run.conclusion==='success';
  require(route.conclusion===(noop?'success':'failure')&&run.conclusion===(noop?'success':'failure'),'uncertain admission callback');
  const expectedSteps=[['Set up job',1,'success'],['Run actions/checkout@v4',2,'success'],['Run actions/setup-node@v4',3,'success'],
    [producer?producerAdmission:publisherAdmission,4,noop?'success':'failure'],
    ...(producer?[["Run python - <<'PY'",5,'skipped'],[producerPick,6,noop?'success':'skipped']]
      :[[PRICE_HOLD_STEP,5,'skipped'],['Resolve only the exact admitted renewal route',6,'skipped'],['Ordinary non-CI publication: /',7,'skipped']]),
    ['Post Run actions/setup-node@v4',producer?11:13,noop?'success':'skipped'],['Post Run actions/checkout@v4',producer?12:14,'success'],['Complete job',producer?13:15,'success']];
  require(route.steps.length===expectedSteps.length,'incomplete admission step inventory');
  for(let i=0;i<expectedSteps.length;i++){
    const step=route.steps[i],[stepName,number,conclusion]=expectedSteps[i];
    require(step.name===stepName&&step.number===number&&step.status==='completed'&&step.conclusion===conclusion,'unknown or executed post-admission step');
    require(clock(step.started_at)<ci.required_completed_at&&clock(step.completed_at)<ci.required_completed_at,'pre-admission step reaches CI admission');
    if(conclusion!=='skipped')require(clock(step.started_at)>=clock(route.started_at)&&clock(step.completed_at)>=clock(step.started_at)&&clock(step.completed_at)<=clock(route.completed_at),'invalid executed admission step clocks');
  }
  return {...observation,reason:noop?'successful_noop_before_required_ci':'failed_admission_before_required_ci'};
}
function verifyWinningProducer(api,activation,producer,{active=false,root=process.cwd(),ci}={}){
  const all=runs(api,PRICE_CI.producer,activation.executing.sha,'workflow_run').sort((a,b)=>a.id-b.id);
  const winner=all.find(r=>r.id===producer.id);require(winner&&winner.run_attempt===1,'missing winning producer');
  equal(observedRunIdentity(winner),observedRunIdentity(producer),'winning producer list');
  const excluded=all.filter(r=>r.id<producer.id).map(r=>preAdmissionCallback(api,activation,r,PRICE_CI.producer,ci));
  for(const later of all.filter(r=>r.id>producer.id))require(later.run_attempt===1,'replayed producer attempt');
  const source=readFileSync(join(root,PRICE_CI.producer.path),'utf8');
  // The whole workflow blob is bound by the immutable activation edge. Also
  // assert the lock we rely on; no queued duplicate can become a winner later.
  require(source.includes("format('static-site-oct6-{0}', github.event.workflow_run.head_sha)")&&/cancel-in-progress:\s*false/.test(source),'missing finite producer concurrency lock');
  const allJobs=jobs(api,producer.id);if(active)require(allJobs.some(j=>['select-markets','combine-and-build'].includes(j.name)&&j.head_sha===activation.executing.sha&&j.status==='in_progress'&&j.conclusion===null),'missing active producer lock job');
  return {jobs:allJobs,excluded};
}
export function verifyPriceCiProducer({root=priceControllerRoot(),event,execution=priceExecution(),api=priceReadApi,now=Date.now()}={}){
  const activation=verifyPriceActivation({root,api,now});if(activation.status==='disabled')return {status:'disabled',repair:false};
  verifyEvent(event);const own=verifyContext(api,activation,execution,PRICE_CI.producer);
  const ignored=ignoredCiCallback(api,activation,event.workflow_run,own);
  if(ignored)return recordAdmission({status:'noop',repair:false},{reason:'authenticated_predecessor_or_unsuccessful_ci',ci:runObservations.get(ignored),producer:runObservations.get(own)});
  const scoped=createRetainedPriceAdmissionInventory(api,{requiredIds:[own.id,event.workflow_run.id],head:activation.executing.sha});
  try{
    const ci=verifyCi(scoped,activation,event.workflow_run);
    require(clock(ci.run.updated_at)<=clock(own.created_at),'producer predates CI completion');const winner=verifyWinningProducer(scoped,activation,own,{active:true,root,ci});
    return recordAdmission({status:'verified',repair:true,activation,trigger:completedIdentity(ci.run),checks:ci.checks,producer:runIdentity(own)},
      {ci:ciObservation(ci),producer:runObservations.get(own),excluded_callbacks:winner.excluded});
  }finally{scoped.dispose();}
}
function verifySource(api,activation,sourceRun,root,proofApi=api){
  require(positive(sourceRun?.id),'missing source run');const source=exactAttempt(api,sourceRun.id,PRICE_CI.producer,activation.executing.sha,'workflow_run');equal(completedIdentity(sourceRun),completedIdentity(source),'producer completion');
  require(source.status==='completed'&&source.conclusion==='success'&&clock(source.updated_at)<=activation.verified_at,'producer is not terminal success');const ci=verifyCi(api,activation);require(clock(ci.run.updated_at)<=clock(source.created_at),'producer predates controller CI');
  const winner=verifyWinningProducer(api,activation,source,{root,ci}),found=winner.jobs.filter(j=>j.name==='combine-and-build');require(found.length===1,'missing genuine combine-and-build');
  const job=found[0];require(job.head_sha===activation.executing.sha&&job.status==='completed'&&job.conclusion==='success'&&clock(job.started_at)>=clock(source.run_started_at)&&clock(job.completed_at)>=clock(job.started_at)&&clock(job.completed_at)<=clock(source.updated_at),'invalid completed producer job');
  for(const name of ['Build static frontend',PRICE_REPAIR_STEP,'Upload verified data export','Record exact export attempt and dated evidence','Preserve dated export provenance for release selection']){
    const steps=job.steps?.filter(s=>s.name===name);require(steps?.length===1&&steps[0].status==='completed'&&steps[0].conclusion==='success','required genuine producer step missing or failed');}
  const proof=freeze({status:'verified',activation,trigger:completedIdentity(ci.run),checks:ci.checks,producer:completedIdentity(source),job:{id:job.id,name:job.name,started_at:job.started_at,completed_at:job.completed_at}});sourceProofs.set(proof,{root,api:proofApi});
  return recordAdmission(proof,{ci:ciObservation(ci),producer:runObservations.get(source),excluded_callbacks:winner.excluded});
}
export function verifyPriceSourceCompletion({root=priceControllerRoot(),sourceRun,event,api=priceReadApi,now=Date.now()}={}){
  const activation=verifyPriceActivation({root,api,now});require(activation.status==='active','source request is disabled');
  if(event){verifyEvent(event);sourceRun=event.workflow_run;}
  if(positive(sourceRun))sourceRun=api(`${prefix}/actions/runs/${sourceRun}`);
  require(positive(sourceRun?.id),'missing source run');
  const scoped=createRetainedPriceAdmissionInventory(api,{requiredIds:[sourceRun.id,activation.request.predecessor?.run_id],head:activation.executing.sha});
  try{return verifySource(scoped,activation,sourceRun,root,api);}finally{scoped.dispose();}
}
export function registerPricePublisherTransportCaller(proof,{api,execution=priceExecution(),now=Date.now()}={}){
  if(!hasScopedConditionalJobContext(PRICE_CI.repository))return false;
  const context=proof&&sourceProofs.get(proof);
  require(context&&typeof api==='function'&&context.api===api,'publisher transport requires the original verified source proof/API');
  require(resolve(context.root)===resolve(priceControllerRoot()),'publisher transport requires the original source controller root');
  const request=readRequest(context.root),executing=proof.activation.executing;
  require(request?.value.enabled&&checksum(request.raw)===proof.activation.request_sha256,'publisher transport source request changed');
  require(Number.isFinite(now)&&clock(request.value.activation.not_before)<=now&&now<clock(request.value.activation.not_after),'publisher transport activation expired');
  require(git(context.root,'rev-parse','HEAD')===executing.sha&&git(context.root,'rev-parse','HEAD^{tree}')===executing.tree,'publisher transport source controller changed');
  const run=verifyContext(api,proof.activation,execution,PRICE_CI.publisher),all=jobs(api,run.id);
  const found=all.filter(job=>job.name==='publish');require(found.length===1,'publisher transport requires one active publish job');
  const job=found[0];
  require(job.head_sha===executing.sha&&job.status==='in_progress'&&job.conclusion===null
    &&clock(job.started_at)>=clock(run.run_started_at)&&clock(job.started_at)<=now,'publisher transport publish job is not active');
  // This immutable identity was verified by the branded source activation.
  // Its projection is sufficient for transport binding; no new commit GET.
  const controller={head:executing.sha,tree:executing.tree},commit={sha:executing.sha,tree:{sha:executing.tree}};
  return bindScopedConditionalCaller({repository:PRICE_CI.repository,controller,
    caller:{run,attempt:1,job,commit,job_started_at:job.started_at},role:'publisher',
    criticalIds:[proof.producer.id,proof.trigger.id]});
}
function priorHold(api,activation,listed,ci){
  if(listed.conclusion!=='success')return preAdmissionCallback(api,activation,listed,PRICE_CI.publisher,ci);
  const run=exactAttempt(api,listed.id,PRICE_CI.publisher,activation.executing.sha,'workflow_run');equal(completedIdentity(listed),completedIdentity(run),'previous hold run');require(run.status==='completed'&&run.conclusion==='success','previous publication caller is not a completed hold');
  const all=jobs(api,run.id),route=all.filter(j=>j.name==='Route exact renewal CI admission'),publish=all.filter(j=>j.name==='publish');
  require(all.length===2&&route.length===1&&publish.length===1&&all.every(j=>j.head_sha===activation.executing.sha&&j.status==='completed')&&route[0].conclusion==='success'&&publish[0].conclusion==='skipped','previous caller is not a proven no-publication hold');
  const marker=route[0].steps?.filter(s=>s.name===PRICE_HOLD_STEP);require(marker?.length===1&&marker[0].status==='completed'&&marker[0].conclusion==='success','previous caller lacks exact hold marker');
  return {reason:'verified_finite_publication_hold',run:runObservations.get(run),jobs:all};
}
export function routePricePublication({root=priceControllerRoot(),event,execution=priceExecution(),api=priceReadApi,now=Date.now()}={}){
  const activation=verifyPriceActivation({root,api,now});if(activation.status==='disabled')return {price_wait:false,price_source:false};
  // This exact activation reserves its predecessor for the one repaired source.
  // All competing CI/Design/ordinary source events remain no-op, never fallback.
  if(execution.event_name!=='workflow_run')return {price_wait:true,price_source:false};
  verifyEvent(event);const own=verifyContext(api,activation,execution,PRICE_CI.publisher);
  if(event.workflow_run?.path!==PRICE_CI.producer.path||event.workflow_run?.event!=='workflow_run'||event.workflow_run?.head_sha!==activation.executing.sha)
    return recordAdmission({price_wait:true,price_source:false},{reason:'finite_publication_hold',publisher:runObservations.get(own)});
  const scoped=createRetainedPriceAdmissionInventory(api,{requiredIds:[own.id,event.workflow_run.id],head:activation.executing.sha});
  try{
    const proof=verifySource(scoped,activation,event.workflow_run,root,api);require(clock(proof.producer.updated_at)<=clock(own.created_at),'publication caller predates genuine source');
    const all=runs(scoped,PRICE_CI.publisher,activation.executing.sha,'workflow_run');require(all.some(r=>r.id===own.id),'missing publication caller inventory');
    const ci=verifyCi(scoped,activation),prior=[];
    for(const item of all){if(item.id===own.id){equal(observedRunIdentity(item),observedRunIdentity(own),'publication caller list');continue;}if(item.id<own.id)prior.push(priorHold(scoped,activation,item,ci));else require(item.run_attempt===1,'replayed publication successor');}
    return recordAdmission({price_wait:false,price_source:true,source_run_id:proof.producer.id,source_run_attempt:1},
      {source:JSON.parse(priceAdmissionDiagnostic(proof)).observations,publisher:runObservations.get(own),prior_callbacks:prior});
  }finally{scoped.dispose();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,...extra]=process.argv.slice(2);require(!extra.length&&['producer-route','publication-route'].includes(command),'unknown closed CI routing command');
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const result=command==='producer-route'?verifyPriceCiProducer({event}):routePricePublication({event});
  const output=command==='producer-route'?{repair:result.repair}:result;
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(output).map(([key,value])=>`${key}=${value}\n`).join(''));
  console.log(JSON.stringify(output));
}
