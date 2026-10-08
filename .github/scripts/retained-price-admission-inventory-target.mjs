// Read-only same-token validation of the final admission adapter.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync,mkdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRetainedPriceAdmissionApi,createRetainedPriceAdmissionInventory} from './retained-price-admission-inventory.mjs';
import {validateSnapshot,REPOSITORY,REPOSITORY_ID} from './retained-price-repository-inventory.mjs';
import {priceReadApi} from './retained-price-ci-admission.mjs';
import {admissionSnapshotResult} from './fixtures/retained-price-admission-inventory.mjs';
const BASE='ee1dc4c819460f1069818b4320f4122aaef254c9',HEAD='946139f8f9ee9082b03a6f68b0b18fc11d00d2a1';
const PRODUCTION_TREE='b94af31a92ad3d8f4947abe12f4a5f0cde675d05';
const SOURCE=37784325862,CI=37781353727,BRANCH='finite-admission-inventory-repair-a10';
const SCRIPT='.github/scripts/retained-price-admission-inventory-target.mjs',WORKFLOW='.github/workflows/retained-price-admission-inventory-target.yml';
const BINDINGS=[{"path":".github/scripts/retained-price-admission-inventory.mjs","sha":"c0c7a0c1f9681f73c49fba43b297430964725e0c"},{"path":".github/scripts/retained-price-ci-admission.mjs","sha":"b68cad9664fb8f80d97c351d6ba87f66fe6e83df"},{"path":".github/scripts/retained-price-ci-admission.test.mjs","sha":"c5e288196e9f76ca9a9a2171daa5a24e0944af80"},{"path":".github/scripts/retained-price-admission-inventory.test.mjs","sha":"317bb5cbdc9704b5b64af6232d8bb6b61f3581a1"},{"path":".github/scripts/fixtures/retained-price-admission-inventory.mjs","sha":"d82e32b8f216ab92a40942703f99d6b404682f50"},{"path":".github/scripts/publication-gate.mjs","sha":"449f55f4a5ff6d3c3b2d20a705f52d65d11d5c61"},{"path":".github/scripts/retained-price-source-readers.test.mjs","sha":"291e5df64c17c28200c6fac2db2c30906a0e75d1"},{"path":".github/scripts/retained-price-source-admission.test.mjs","sha":"67801f27c610f657c0ba06a46f2c7fb4fcadfe48"},{"path":".github/workflows/ci.yml","sha":"08236e1df81a5d667e0b27c2c8cf2b7e9a28e2a7"}];
const check=(v,reason)=>{if(!v)throw Error(reason);};
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const blob=raw=>createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:1024**2}).trim();
const sameRepo=r=>r?.repository?.id===REPOSITORY_ID&&r.repository.full_name===REPOSITORY&&r.head_repository?.id===REPOSITORY_ID&&r.head_repository.full_name===REPOSITORY;
const identity=r=>Object.fromEntries(['id','run_attempt','workflow_id','path','head_sha','head_branch','event','status','conclusion','run_started_at'].map(k=>[k,r[k]]));
const utc=s=>typeof s==='string'&&s.endsWith('Z')&&Number.isFinite(Date.parse(s));
const tasks=[{id:294252465,path:'.github/workflows/ci.yml',event:'push'},{id:294257497,path:'.github/workflows/static-site.yml',event:'workflow_run'},
  {id:364666954,path:'.github/workflows/research-ui-release.yml',event:'workflow_run'}];
const endpoint=t=>'repos/'+REPOSITORY+'/actions/workflows/'+t.id+'/runs?branch=main&event='+t.event+'&head_sha='+HEAD+'&per_page=100';
let output=null;
const report={schema_version:'retained-price-admission-inventory-target-v1',diagnostic_only:true,publication_authority:false,
  observation_kind:'present_time_retrieval_not_original_failure_response',head_sha:HEAD,source_run_id:SOURCE,ci_run_id:CI,worker_attempts:[],inventory:[],negative_checks:[]};
function save(name,value){writeFileSync(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function exact(id,t,head,branch,event,{active=false}={}){
  const root='repos/'+REPOSITORY+'/actions/runs/'+id,current=priceReadApi(root),original=priceReadApi(root+'/attempts/1');
  for(const r of [current,original])check(r.id===id&&r.run_attempt===1&&r.workflow_id===t.id&&r.path===t.path&&r.head_sha===head&&r.head_branch===branch
    &&r.event===event&&sameRepo(r)&&[r.created_at,r.updated_at,r.run_started_at].every(utc),'wrong direct run/attempt identity');
  check(JSON.stringify(identity(current))===JSON.stringify(identity(original)),'direct semantic run/attempt mismatch');
  check(Date.parse(current.created_at)<=Date.parse(current.run_started_at)&&Date.parse(current.created_at)<=Date.parse(original.created_at)
    &&Date.parse(original.created_at)<=Date.parse(original.updated_at)&&Date.parse(original.created_at)<=Date.parse(current.updated_at)
    &&Date.parse(current.run_started_at)<=Date.parse(current.updated_at)&&Date.parse(current.run_started_at)<=Date.parse(original.updated_at)
    &&Date.parse(current.updated_at)<=Date.now()&&Date.parse(original.updated_at)<=Date.now()
    &&(active||Date.parse(current.updated_at)<=Date.parse(original.updated_at)),'invalid direct observation clocks');
  check(active?current.status==='in_progress'&&current.conclusion===null:current.status==='completed','wrong direct status');
  return {current,original};
}
function resourceJobs(id){
  const pages=priceReadApi('repos/'+REPOSITORY+'/actions/runs/'+id+'/attempts/1/jobs?per_page=100',true);
  check(Array.isArray(pages)&&pages.length>0&&pages.length<=10,'job inventory bound');
  const total=pages[0]?.total_count;check(Number.isSafeInteger(total)&&total>=0&&total<=1000&&pages.length===Math.max(1,Math.ceil(total/100)),'job inventory total');
  const jobs=[];
  for(let n=0;n<pages.length;n++){const p=pages[n];check(p.total_count===total&&Array.isArray(p.jobs)&&p.jobs.length===Math.min(100,Math.max(0,total-n*100)),'incomplete jobs');jobs.push(...p.jobs);}
  check(new Set(jobs.map(j=>j.id)).size===jobs.length&&jobs.every(j=>j.run_id===id&&j.run_attempt===1&&j.head_sha===HEAD&&j.status==='completed'),'job identity');
  return jobs;
}
function projected(runs,t){return runs.filter(r=>r.workflow_id===t.id&&r.path===t.path&&r.event===t.event&&r.head_sha===HEAD&&r.head_branch==='main'&&sameRepo(r));}
function rejectVariant(label,result,reason,ownId,own){
  let calls=0,caught=null;const observations=[];
  const api=createRetainedPriceAdmissionApi(()=>{throw Error('No individual fallback in synthetic negative case');},{
    run:()=>{calls++;return JSON.stringify(result);},report:v=>observations.push(v)});
  const scope=createRetainedPriceAdmissionInventory(api,{requiredIds:[SOURCE,ownId],head:HEAD});
  try{
    const ci=scope(endpoint(tasks[0]),true).flatMap(p=>p.workflow_runs);check(ci.some(r=>r.id===CI&&r.run_attempt===1),'missing exact controller CI');
    const source=scope(endpoint(tasks[1]),true).flatMap(p=>p.workflow_runs).find(r=>r.id===SOURCE);check(source?.run_attempt===1,'wrong source attempt');
    const full=validateSnapshot(result.pages,[SOURCE,ownId]),caller=full.runs.find(r=>r.id===ownId);
    check(JSON.stringify(identity(caller))===JSON.stringify(identity(own.current))&&sameRepo(caller),'wrong immediate caller identity');
  }catch(e){caught=e;}finally{scope.dispose();}
  check(caught&&reason.test(caught.message),'negative case failed to reject: '+label);
  check(calls===1,'negative variant widened retries');
  report.negative_checks.push({label,reason:caught.message,worker_reads:calls,observations});
}
function main(){
  check(process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_REPOSITORY===REPOSITORY&&Number(process.env.GITHUB_REPOSITORY_ID)===REPOSITORY_ID
    &&process.env.GITHUB_REF==='refs/heads/'+BRANCH&&process.env.GITHUB_RUN_ATTEMPT==='1'
    &&process.env.GITHUB_WORKFLOW_SHA===process.env.GITHUB_SHA&&process.env.GITHUB_WORKFLOW_REF===REPOSITORY+'/'+WORKFLOW+'@refs/heads/'+BRANCH,'target execution context');
  check(git('rev-parse','HEAD')===process.env.GITHUB_SHA&&git('show','-s','--format=%P','HEAD')===BASE,'target sole reviewed disabled parent');
  const expected=[...BINDINGS.map(x=>x.path),SCRIPT,WORKFLOW].sort().join('|');
  check(git('diff','--name-only',BASE,'HEAD').split('\n').sort().join('|')===expected,'target changes exceed reviewed files');
  for(const b of BINDINGS)check(blob(readFileSync(b.path))===b.sha,'target binding changed '+b.path);
  check(blob(readFileSync('.github/scripts/retained-price-repository-inventory.mjs'))==='d3c9d451322b491c0dbecf063850fa2ac97a4e67','core changed');
  check(blob(readFileSync('.github/retained-price-oct6-source.json'))==='3b2bc955ce66ba5a97e7dd9b3a5587c605b4350a','request changed');
  const request=JSON.parse(readFileSync('.github/retained-price-oct6-source.json'));check(request.enabled===false&&request.activation===null,'target activation is enabled');
  output=resolve(process.env.RUNNER_TEMP,'retained-price-admission-inventory-target');mkdirSync(output,{recursive:false});
  const ownId=Number(process.env.GITHUB_RUN_ID);check(Number.isSafeInteger(ownId)&&ownId>0&&ownId!==SOURCE&&ownId!==CI,'target own run ID');
  const index=join(output,'production.index'),localEnv={...process.env,GIT_INDEX_FILE:index};
  try{
    execFileSync('git',['read-tree','HEAD'],{env:localEnv,stdio:['ignore','pipe','pipe']});
    execFileSync('git',['update-index','--force-remove','--',SCRIPT,WORKFLOW],{env:localEnv,stdio:['ignore','pipe','pipe']});
    const tree=execFileSync('git',['write-tree'],{env:localEnv,encoding:'utf8',maxBuffer:1024**2}).trim();
    check(tree===PRODUCTION_TREE,'target does not contain exact reviewed production tree');report.reviewed_production_tree=tree;
  }finally{try{unlinkSync(index);}catch(e){if(e.code!=='ENOENT')throw e;}}
  report.probe_run_id=ownId;report.probe_head_sha=process.env.GITHUB_SHA;report.started_at=new Date().toISOString();
  report.direct={source:exact(SOURCE,tasks[1],HEAD,'main','workflow_run'),ci:exact(CI,tasks[0],HEAD,'main','push')};
  const ownRecord=priceReadApi('repos/'+REPOSITORY+'/actions/runs/'+ownId);
  report.direct.caller=exact(ownId,{id:ownRecord.workflow_id,path:WORKFLOW},process.env.GITHUB_SHA,BRANCH,'push',{active:true});
  check(report.direct.source.current.conclusion==='failure'&&report.direct.ci.current.conclusion==='success'
    &&Date.parse(report.direct.ci.current.updated_at)<=Date.parse(report.direct.source.current.created_at),'A10 chain changed');
  const sourceJobs=resourceJobs(SOURCE),ciJobs=resourceJobs(CI);report.direct.source_jobs=sourceJobs;report.direct.ci_jobs=ciJobs;
  const selection=sourceJobs.filter(j=>j.name==='select-markets');
  check(sourceJobs.length===5&&selection.length===1&&selection[0].id===113335067274&&selection[0].conclusion==='failure'
    &&sourceJobs.filter(j=>j!==selection[0]).every(j=>j.conclusion==='skipped'&&j.steps.length===0),'A10 source work changed');
  const admission=selection[0].steps.filter(s=>s.name==='Admit only the finite exact-main price CI trigger');
  check(admission.length===1&&admission[0].conclusion==='failure','A10 source failure changed');
  for(const name of ['Backend Quality Gates','Frontend','Static Browser Regression'])check(ciJobs.filter(j=>j.name===name&&j.conclusion==='success').length===1,'A10 required CI changed');
  const artifacts=priceReadApi('repos/'+REPOSITORY+'/actions/runs/'+SOURCE+'/artifacts?per_page=100',true);
  check(Array.isArray(artifacts)&&artifacts.length===1&&artifacts[0].total_count===0&&Array.isArray(artifacts[0].artifacts)&&artifacts[0].artifacts.length===0,'A10 source artifacts changed');
  report.direct.source_artifacts=artifacts;
  report.historical_classification='post_ci_failed_admission_consumed';report.original_failure_response_available=false;
  let captured=null,workerReads=0,individualReads=0;
  const api=createRetainedPriceAdmissionApi((e,p)=>{individualReads++;return priceReadApi(e,p);},{
    run:(node,args,options)=>{
      check(node===process.execPath&&args.length===2&&args[0]==='--max-old-space-size=384'
        &&args[1]===join(process.cwd(),'.github/scripts/retained-price-repository-inventory.mjs'),'unexpected actual worker');
      check(options.timeout<=30000&&options.maxBuffer===64*1024**2,'actual worker bound');
      check(JSON.stringify(JSON.parse(options.input).requiredIds)===JSON.stringify([SOURCE,ownId]),'actual worker anchors changed');
      workerReads++;const raw=execFileSync(node,args,options);captured=JSON.parse(raw);
      writeFileSync(join(output,'worker-attempt-'+workerReads+'.json'),raw,{flag:'wx'});
      report.worker_attempts.push({number:workerReads,bytes:Buffer.byteLength(raw),sha256:hash(raw)});return raw;
    },report:v=>{report.inventory.push(v);appendFileSync(join(output,'inventory.jsonl'),JSON.stringify(v)+'\n');}});
  const scope=createRetainedPriceAdmissionInventory(api,{requiredIds:[SOURCE,ownId],head:HEAD});let snapshots;
  try{
    const first=scope('repos/'+REPOSITORY+'/actions/runs/'+SOURCE);
    check(workerReads===0,'scope was not lazy');
    const lists=tasks.map(t=>scope(endpoint(t),true).flatMap(p=>p.workflow_runs));
    const complete=validateSnapshot(captured.pages,[SOURCE,ownId]);validateSnapshot(captured.pages,[CI,ownId]);snapshots=complete;
    for(let n=0;n<tasks.length;n++)check(JSON.stringify(lists[n])===JSON.stringify(projected(complete.runs,tasks[n])),'actual projection mismatch');
    check(lists[0].some(r=>r.id===CI&&r.run_attempt===1)&&lists[1].some(r=>r.id===SOURCE&&r.run_attempt===1),'actual exact chain missing');
    const caller=complete.runs.find(r=>r.id===ownId);check(JSON.stringify(identity(caller))===JSON.stringify(identity(report.direct.caller.current))&&sameRepo(caller),'actual caller changed');
    const again=scope('repos/'+REPOSITORY+'/actions/runs/'+SOURCE+'/attempts/1');check(first.id===SOURCE&&again.id===SOURCE&&individualReads===2,'individual reads were cached');
    report.projections=lists.map((runs,n)=>({workflow:tasks[n],runs:runs.map(identity)}));
    report.required_run_ids=[SOURCE,CI,ownId];report.repository_total_count=complete.total;report.repository_pages=complete.pages.length;
    report.adapter_worker_reads=workerReads;report.fresh_individual_reads=individualReads;check(workerReads>=1&&workerReads<=2,'worker attempt cap');
  }finally{scope.dispose();}
  let disposed=false;try{scope('repos/'+REPOSITORY+'/actions/runs/'+SOURCE);}catch(e){disposed=/disposed-admission-scope/.test(e.message);}check(disposed,'scope leaked after disposal');
  for(const [label,id] of [['missing immediate caller',ownId],['missing winning source',SOURCE],['missing CI',CI]])
    rejectVariant(label,admissionSnapshotResult(snapshots.runs.filter(r=>r.id!==id)),id===CI?/missing exact controller CI/:/required-run-anchor-absent/,ownId,report.direct.caller);
  rejectVariant('duplicate source',admissionSnapshotResult([...snapshots.runs,snapshots.runs.find(r=>r.id===SOURCE)]),/invalid-or-duplicate-run/,ownId,report.direct.caller);
  const malformed=snapshots.runs.map(r=>r.id===CI?{...r,path:'.github/workflows/invalid.yml',head_sha:'f'.repeat(40)}:r);
  rejectVariant('CI identity conflict outside projected head',admissionSnapshotResult(malformed),/conflicting-workflow-identity/,ownId,report.direct.caller);
  rejectVariant('source rerun',admissionSnapshotResult(snapshots.runs.map(r=>r.id===SOURCE?{...r,run_attempt:2}:r)),/wrong source attempt/,ownId,report.direct.caller);
  const incomplete=structuredClone(captured);incomplete.pages.pop();
  rejectVariant('incomplete repository inventory',incomplete,/incomplete-inventory/,ownId,report.direct.caller);
  report.status='passed';report.finished_at=new Date().toISOString();save('report.json',report);
  console.log(JSON.stringify({status:report.status,diagnostic_only:true,publication_authority:false,probe_run_id:ownId,
    historical_classification:report.historical_classification,repository_pages:report.repository_pages,repository_total_count:report.repository_total_count,
    adapter_worker_reads:workerReads,required_run_ids:report.required_run_ids,negative_checks:report.negative_checks.map(v=>({label:v.label,reason:v.reason}))}));
}
try{main();}catch(e){report.status='failed';report.reason=e.inventoryReason??'target-validation-failed';report.error=e.message;
  if(output)writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.error(JSON.stringify({status:'failed',reason:report.reason,error:e.message}));process.exitCode=1;}
