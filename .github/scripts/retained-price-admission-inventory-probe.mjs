// Read-only A10 admission API diagnosis. No source or publication authority.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync,mkdirSync,openSync,readFileSync,writeFileSync,writeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {readRepositorySnapshot,validateSnapshot,classifyTransport,LIMITS,REPOSITORY,REPOSITORY_ID,route} from './retained-price-repository-inventory.mjs';

const HEAD='946139f8f9ee9082b03a6f68b0b18fc11d00d2a1';
const SOURCE=37784325862,CI=37781353727,BRANCH='finite-admission-inventory-probe-a10';
const SCRIPT='.github/scripts/retained-price-admission-inventory-probe.mjs';
const WORKFLOW='.github/workflows/retained-price-admission-inventory-probe.yml';
const REQUEST='.github/retained-price-oct6-source.json';
const CORE='.github/scripts/retained-price-repository-inventory.mjs';
const CORE_SHA='d3c9d451322b491c0dbecf063850fa2ac97a4e67';
const DISABLED_SHA='3b2bc955ce66ba5a97e7dd9b3a5587c605b4350a';
const TARGETS=[{name:'ci',id:294252465,path:'.github/workflows/ci.yml',event:'push'},
  {name:'static',id:294257497,path:'.github/workflows/static-site.yml',event:'workflow_run'},
  {name:'publisher',id:364666954,path:'.github/workflows/research-ui-release.yml',event:'workflow_run'}];
const positive=n=>Number.isSafeInteger(n)&&n>0;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const check=(value,reason)=>{if(!value)throw Object.assign(Error(reason),{probeReason:reason});};
const digest=(raw,algorithm='sha256')=>createHash(algorithm).update(raw).digest('hex');
const blob=raw=>digest(Buffer.concat([Buffer.from('blob '+raw.length+'\0'),raw]),'sha1');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:1024**2}).trim();
const canonical=v=>JSON.stringify(v,(_k,x)=>object(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0)):x);
const utc=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*Z$/.test(v)&&Number.isFinite(Date.parse(v));
const sameRepo=r=>r?.repository?.id===REPOSITORY_ID&&r.repository.full_name===REPOSITORY
  &&r.head_repository?.id===REPOSITORY_ID&&r.head_repository.full_name===REPOSITORY;
const identity=r=>Object.fromEntries(['id','run_attempt','workflow_id','path','head_sha','head_branch','event',
  'status','conclusion','created_at','run_started_at','updated_at'].map(k=>[k,r[k]]));
function safeHeaders(headers){
  const result={};
  for(const [key,value] of headers){
    if(/^(?:x-ratelimit-(?:limit|remaining|reset|used)|retry-after|content-length)$/.test(key)&&/^\d{1,15}$/.test(value))result[key]=value;
    if(key==='x-github-request-id'&&/^[a-zA-Z0-9:-]{1,128}$/.test(value))result[key]=value;
  }
  if(headers.has('retry-after'))result.retry_after_present=true;
  return result;
}
function filteredRoute(t){return 'repos/'+REPOSITORY+'/actions/workflows/'+t.id+'/runs?branch=main&event='+t.event+'&head_sha='+HEAD+'&per_page=100';}
function listed(r,t){return object(r)&&positive(r.id)&&positive(r.run_attempt)&&r.workflow_id===t.id&&r.path===t.path
  &&r.head_sha===HEAD&&r.head_branch==='main'&&r.event===t.event&&sameRepo(r);}
function analyzeFiltered(pages,t){
  if(!Array.isArray(pages)||pages.length<1||pages.length>10)return {status:'inconsistent',reason:'page-bound'};
  const total=pages[0]?.total_count,ids=new Set(),runs=[];
  if(!Number.isSafeInteger(total)||total<0||total>1000||pages.length!==Math.max(1,Math.ceil(total/100)))
    return {status:'inconsistent',reason:'total-or-page-count'};
  for(let i=0;i<pages.length;i++){
    const p=pages[i];
    if(!object(p)||p.total_count!==total||!Array.isArray(p.workflow_runs)
      ||p.workflow_runs.length!==Math.min(100,Math.max(0,total-i*100)))return {status:'inconsistent',reason:'changing-or-incomplete-page'};
    for(const r of p.workflow_runs){
      if(!listed(r,t))return {status:'inconsistent',reason:'listed-identity'};
      if(ids.has(r.id))return {status:'inconsistent',reason:'duplicate-run'};
      ids.add(r.id);runs.push(r);
    }
  }
  return {status:'complete',total,ids:[...ids],runs};
}
function filteredLinks(link,t,page,total){
  check(typeof link==='string'&&link.length<=8192,'filtered-link-bound');
  const relations=new Map(),last=Math.max(1,Math.ceil(total/100));
  for(const part of link?link.split(','):[]){
    const match=/^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(part);
    check(match&&!relations.has(match[2]),'filtered-link-shape');
    let u;try{u=new URL(match[1]);}catch{throw Object.assign(Error('filtered-link-url'),{probeReason:'filtered-link-url'});}
    const n=u.searchParams.get('page'),q=[...u.searchParams];
    check(u.origin==='https://api.github.com'&&!u.username&&!u.password&&!u.hash
      &&u.pathname==='/repos/'+REPOSITORY+'/actions/workflows/'+t.id+'/runs','http-or-security-denial');
    check(q.length===5&&new Set(q.map(([k])=>k)).size===5&&u.searchParams.get('branch')==='main'
      &&u.searchParams.get('event')===t.event&&u.searchParams.get('head_sha')===HEAD&&u.searchParams.get('per_page')==='100'
      &&/^[1-9]\d*$/.test(n??'')&&Number(n)<=last,'filtered-link-query');
    relations.set(match[2],Number(n));
  }
  check(page<last?relations.get('next')===page+1:!relations.has('next'),'filtered-incomplete-pagination');
  for(const [rel,n] of [['prev',page-1],['first',1],['last',last]])
    check(!relations.has(rel)||relations.get(rel)===n,'filtered-inconsistent-pagination');
  return Object.fromEntries(relations);
}
function selfTest(){
  const t=TARGETS[1],r={id:SOURCE,run_attempt:1,workflow_id:t.id,path:t.path,head_sha:HEAD,head_branch:'main',event:t.event,
    repository:{id:REPOSITORY_ID,full_name:REPOSITORY},head_repository:{id:REPOSITORY_ID,full_name:REPOSITORY}};
  check(analyzeFiltered([{total_count:1,workflow_runs:[r]}],t).status==='complete','self-test-valid');
  check(analyzeFiltered([{total_count:0,workflow_runs:[]}],t).status==='complete','self-test-empty-diagnostic');
  check(analyzeFiltered([{total_count:2,workflow_runs:[r,r]}],t).reason==='duplicate-run','self-test-duplicate');
  check(analyzeFiltered([{total_count:2,workflow_runs:[r]}],t).status==='inconsistent','self-test-incomplete');
  check(analyzeFiltered([{total_count:1,workflow_runs:[{...r,head_sha:'a'.repeat(40)}]}],t).reason==='listed-identity','self-test-wrong-head');
  check(analyzeFiltered([{total_count:1,workflow_runs:[{...r,run_attempt:2}]}],t).runs[0].run_attempt===2,'self-test-rerun-preserved');
  check(filteredLinks('',t,1,1)&&true,'self-test-no-link');
  let rejected=false;try{filteredLinks('<https://evil.invalid/a>; rel="next"',t,1,101);}catch(e){rejected=e.probeReason==='http-or-security-denial';}
  check(rejected,'self-test-foreign-link');
  console.log('Probe parser self-tests passed');
}
const report={schema_version:'retained-price-admission-inventory-probe-v1',diagnostic_only:true,publication_authority:false,
  head_sha:HEAD,source_run_id:SOURCE,ci_run_id:CI,observation_kind:'present_time_retrieval_not_original_failure_response',raw_responses:[],filtered:[],snapshots:[]};
let output=null,token=null,ownId=null,rawBytes=0;
const save=(name,value)=>writeFileSync(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
function capture(label,{allowRoutes=null,limit=64*1024**2}={}){
  let used=0;
  return async (url,options)=>{
    check(typeof url==='string'&&url.startsWith('https://api.github.com/')&&!/[#\r\n]/.test(url),'http-or-security-denial');
    const endpoint=url.slice('https://api.github.com/'.length);
    check(allowRoutes?allowRoutes.has(endpoint):/^repositories\/1203919607\/actions\/runs\?per_page=50&page=(?:[1-9]|[1-3]\d|40)$/.test(endpoint),'unexpected-route');
    check(options?.redirect==='error'&&options?.cache==='no-store','unsafe-transport-options');
    const response=await fetch(url,options);
    const n=report.raw_responses.length+1,filename=label+'-'+String(n).padStart(3,'0')+'.body';
    const fact={file:filename,requested_route:endpoint,status:response.status,safe_headers:safeHeaders(response.headers),
      body_bytes:0,body_sha256:null,body_complete:false};
    report.raw_responses.push(fact);
    check(response.url===url&&!response.redirected&&response.status===200
      &&!response.headers.has('retry-after')&&response.headers.get('x-ratelimit-remaining')!=='0','http-or-security-denial');
    const fd=openSync(join(output,filename),'wx'),hash=createHash('sha256');
    const body={async *[Symbol.asyncIterator](){
      try{
        check(response.body&&typeof response.body[Symbol.asyncIterator]==='function','invalid-response-body');
        for await(const chunk of response.body){
          check(chunk instanceof Uint8Array,'invalid-response-body');
          check(fact.body_bytes+chunk.byteLength<=LIMITS.pageBytes&&used+chunk.byteLength<=limit
            &&rawBytes+chunk.byteLength<=160*1024**2,'probe-byte-bound');
          let written=0;while(written<chunk.byteLength){const count=writeSync(fd,chunk,written,chunk.byteLength-written);check(count>0,'raw-body-write-failed');written+=count;}
          fact.body_bytes+=chunk.byteLength;used+=chunk.byteLength;rawBytes+=chunk.byteLength;hash.update(chunk);yield chunk;
        }
        fact.body_complete=true;
      }finally{fact.body_sha256=hash.digest('hex');closeSync(fd);}
    }};
    return {status:response.status,headers:response.headers,url:response.url,redirected:response.redirected,body};
  };
}
async function json(endpoint,label,{timeoutMs=10000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await capture(label,{allowRoutes:new Set([endpoint]),limit:16*1024**2})('https://api.github.com/'+endpoint,
      {headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'User-Agent':'retained-price-admission-inventory-probe'},
        redirect:'error',cache:'no-store',signal:controller.signal});
    const chunks=[];for await(const chunk of response.body)chunks.push(chunk);
    const raw=Buffer.concat(chunks);
    let text,value;try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);value=JSON.parse(text);}catch{throw Object.assign(Error('invalid-json'),{probeReason:'invalid-json'});}
    return {value,link:response.headers.get('link')??''};
  }finally{clearTimeout(timer);}
}
async function inventory(endpoint,key,label){
  const pages=[];let count=1,total=null;
  for(let page=1;page<=count;page++){
    const {value}=await json(endpoint+(page===1?'':'&page='+page),label);
    check(object(value)&&Number.isSafeInteger(value.total_count)&&value.total_count>=0&&value.total_count<=1000,'resource-inventory-bound');
    if(total===null){total=value.total_count;count=Math.max(1,Math.ceil(total/100));}
    check(value.total_count===total&&Array.isArray(value[key])&&value[key].length===Math.min(100,Math.max(0,total-(page-1)*100)),'resource-inventory-incomplete');
    pages.push(value);
  }
  const items=pages.flatMap(p=>p[key]);check(items.every(x=>positive(x?.id))&&new Set(items.map(x=>x.id)).size===items.length,'resource-inventory-duplicate');
  return items;
}
async function exactRun(id,t,head,event,{active=false}={}){
  const root='repos/'+REPOSITORY+'/actions/runs/'+id;
  const current=(await json(root,'run-'+id)).value,original=(await json(root+'/attempts/1','attempt-'+id)).value;
  for(const r of [current,original])check(r.id===id&&r.run_attempt===1&&r.workflow_id===t.id&&r.path===t.path
    &&r.head_sha===head&&r.head_branch===(active?BRANCH:'main')&&r.event===event&&sameRepo(r)
    &&utc(r.created_at)&&utc(r.run_started_at)&&utc(r.updated_at),'direct-run-identity');
  const a=identity(original),b=identity(current);
  // Endpoint metadata clocks are literal observations, not identity fields.
  for(const k of ['created_at','updated_at']){delete a[k];delete b[k];}
  check(canonical(a)===canonical(b),'current-original-attempt-conflict');
  check(Date.parse(current.created_at)<=Date.parse(current.run_started_at)
    &&Date.parse(current.created_at)<=Date.parse(original.created_at)
    &&Date.parse(original.created_at)<=Date.parse(original.updated_at)
    &&Date.parse(original.created_at)<=Date.parse(current.updated_at)
    &&Date.parse(current.run_started_at)<=Date.parse(current.updated_at)
    &&Date.parse(current.run_started_at)<=Date.parse(original.updated_at)
    &&Date.parse(current.updated_at)<=Date.now()&&Date.parse(original.updated_at)<=Date.now()
    &&(active||Date.parse(current.updated_at)<=Date.parse(original.updated_at)),'direct-run-clocks');
  check(active?current.status==='in_progress'&&current.conclusion===null:current.status==='completed','direct-run-status');
  return {current,original};
}
async function readFiltered(t){
  const pages=[],links=[],start=performance.now();let count=1,total=null;
  try{
    for(let page=1;page<=count;page++){
      const left=Math.floor(15000-(performance.now()-start));check(left>0,'filtered-time-bound');
      const {value,link}=await json(filteredRoute(t)+(page===1?'':'&page='+page),'filtered-'+t.name,{timeoutMs:Math.min(10000,left)});
      pages.push(value);
      check(object(value)&&Number.isSafeInteger(value.total_count)&&value.total_count>=0&&value.total_count<=1000,'filtered-total-bound');
      if(total===null){total=value.total_count;count=Math.max(1,Math.ceil(total/100));}
      check(total===value.total_count,'filtered-changing-total');
      links.push(filteredLinks(link,t,page,total));
    }
    const analysis=analyzeFiltered(pages,t);return {...analysis,target:t.name,endpoint:filteredRoute(t),pages,links};
  }catch(e){
    if(e.probeReason==='http-or-security-denial'||classifyTransport(e).inventoryReason==='http-or-security-denial')
      throw Object.assign(Error('http-or-security-denial'),{probeReason:'http-or-security-denial'});
    return {status:'inconsistent',reason:e.probeReason??'filtered-transport-failure',target:t.name,endpoint:filteredRoute(t),pages,links};
  }
}
function select(runs,t){return runs.filter(r=>listed(r,t));}
function compare(filtered,snapshot,t){
  const projected=select(snapshot.runs,t),a=filtered.runs??[],b=new Map(projected.map(r=>[r.id,r]));
  return {workflow:t.name,filtered_status:filtered.status,filtered_authoritative:false,repository_ids:projected.map(r=>r.id),
    filtered_ids:filtered.ids??null,missing_from_filtered:filtered.status==='complete'?projected.filter(r=>!a.some(x=>x.id===r.id)).map(r=>r.id):null,
    absent_from_repository:filtered.status==='complete'?a.filter(r=>!b.has(r.id)).map(r=>r.id):null,
    identity_conflicts:filtered.status==='complete'?a.filter(r=>b.has(r.id)&&canonical(identity(r))!==canonical(identity(b.get(r.id))))
      .map(r=>({id:r.id,filtered:identity(r),repository:identity(b.get(r.id))})):null,
    source_attempts:projected.filter(r=>r.id===SOURCE).map(r=>({id:r.id,run_attempt:r.run_attempt}))};
}
async function main(){
  check(process.argv.length===2,'unexpected-arguments');selfTest();
  check(process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_REPOSITORY===REPOSITORY
    &&Number(process.env.GITHUB_REPOSITORY_ID)===REPOSITORY_ID&&process.env.GITHUB_REF==='refs/heads/'+BRANCH
    &&process.env.GITHUB_RUN_ATTEMPT==='1'&&process.env.GITHUB_WORKFLOW_SHA===process.env.GITHUB_SHA
    &&process.env.GITHUB_WORKFLOW_REF===REPOSITORY+'/'+WORKFLOW+'@refs/heads/'+BRANCH,'probe-execution-context');
  ownId=Number(process.env.GITHUB_RUN_ID);check(positive(ownId)&&ownId!==SOURCE&&ownId!==CI,'probe-run-id');
  check(git('rev-parse','HEAD')===process.env.GITHUB_SHA&&git('show','-s','--format=%P','HEAD')===HEAD,'probe-historical-parent');
  check(git('diff','--name-only',HEAD,'HEAD').split('\n').sort().join('|')===[REQUEST,SCRIPT,WORKFLOW].sort().join('|'),'probe-tree-scope');
  check(blob(readFileSync(CORE))===CORE_SHA&&blob(readFileSync(REQUEST))===DISABLED_SHA,'unchanged-core-or-disabled-request');
  const request=JSON.parse(readFileSync(REQUEST));check(request.enabled===false&&request.activation===null,'probe-activation-enabled');
  token=process.env.GH_TOKEN;check(typeof token==='string'&&token.length>0,'missing-actions-token');
  output=resolve(process.env.RUNNER_TEMP,'retained-price-admission-inventory-probe');mkdirSync(output,{recursive:false});
  report.probe_run_id=ownId;report.probe_head_sha=process.env.GITHUB_SHA;report.core_blob_sha=CORE_SHA;report.started_at=new Date().toISOString();
  report.direct={source:await exactRun(SOURCE,TARGETS[1],HEAD,'workflow_run'),ci:await exactRun(CI,TARGETS[0],HEAD,'push')};
  check(report.direct.source.current.conclusion==='failure'&&report.direct.ci.current.conclusion==='success','changed-historical-result');
  const sourceJobs=await inventory('repos/'+REPOSITORY+'/actions/runs/'+SOURCE+'/attempts/1/jobs?per_page=100','jobs','source-jobs');
  const ciJobs=await inventory('repos/'+REPOSITORY+'/actions/runs/'+CI+'/attempts/1/jobs?per_page=100','jobs','ci-jobs');
  report.direct.source_jobs=sourceJobs;report.direct.ci_jobs=ciJobs;
  check([...sourceJobs,...ciJobs].every(j=>j.run_attempt===1&&j.head_sha===HEAD&&j.status==='completed'
    &&j.run_id===(sourceJobs.includes(j)?SOURCE:CI)),'historical-job-identity');
  const routeJob=sourceJobs.filter(j=>j.name==='select-markets');
  check(sourceJobs.length===5&&['select-markets','ensure_daily_price_release','build-market','combine-and-build','promote-daily-source']
    .every(name=>sourceJobs.filter(j=>j.name===name).length===1)&&routeJob.length===1&&routeJob[0].id===113335067274&&routeJob[0].conclusion==='failure'
    &&sourceJobs.filter(j=>j!==routeJob[0]).every(j=>j.conclusion==='skipped'&&j.steps?.length===0),'historical-source-work-changed');
  const failedStep=routeJob[0].steps?.filter(s=>s.name==='Admit only the finite exact-main price CI trigger');
  check(failedStep?.length===1&&failedStep[0].conclusion==='failure','historical-admission-step-changed');
  for(const name of ['Backend Quality Gates','Frontend','Static Browser Regression']){
    const jobs=ciJobs.filter(j=>j.name===name);check(jobs.length===1&&jobs[0].conclusion==='success','historical-required-ci-changed');
  }
  report.direct.source_artifacts=await inventory('repos/'+REPOSITORY+'/actions/runs/'+SOURCE+'/artifacts?per_page=100','artifacts','source-artifact-metadata');
  check(report.direct.source_artifacts.length===0,'historical-source-artifacts-changed');
  check(Date.parse(report.direct.ci.current.updated_at)<=Date.parse(report.direct.source.current.created_at),'source-is-not-post-ci');
  report.historical_classification='post_ci_failed_admission_consumed';
  const own=(await json('repos/'+REPOSITORY+'/actions/runs/'+ownId,'probe-identity')).value;
  check(positive(own.workflow_id)&&own.path===WORKFLOW,'probe-workflow-identity');
  report.direct.probe=await exactRun(ownId,{id:own.workflow_id,path:WORKFLOW},process.env.GITHUB_SHA,'push',{active:true});
  for(const t of TARGETS)report.filtered.push(await readFiltered(t));
  const start=performance.now();
  for(let n=1;n<=2;n++){
    const left=Math.floor(60000-(performance.now()-start));check(left>0,'snapshot-total-time-bound');
    const result=await readRepositorySnapshot({timeoutMs:Math.min(30000,left),requiredIds:[SOURCE,ownId],
      fetcher:capture('repository-'+n),token});
    save('snapshot-'+n+'.json',result);
    const facts={number:n,status:result.status,reason:result.reason??null,pages:result.pages?.length??null,
      body_bytes:result.body_bytes,evidence:result.evidence,required_ids:[SOURCE,CI,ownId],
      repository_snapshot_sha256:digest(JSON.stringify(result.pages??null))};
    report.snapshots.push(facts);
    check(result.status==='complete','repository-snapshot-'+(result.reason??'failed'));
    const snapshot=validateSnapshot(result.pages,[SOURCE,ownId]);
    check(snapshot.runs.every(r=>(r.workflow_id===TARGETS[0].id)===(r.path===TARGETS[0].path)),'repository-ci-workflow-identity-conflict');
    validateSnapshot(result.pages,[CI,ownId]);
    for(const anchor of [SOURCE,CI,ownId])check(snapshot.runs.filter(r=>r.id===anchor).length===1,'snapshot-anchor-absent-or-duplicate');
    for(const [id,expected] of [[SOURCE,report.direct.source.current],[CI,report.direct.ci.current]])
      check(listed(snapshot.runs.find(r=>r.id===id),id===SOURCE?TARGETS[1]:TARGETS[0])
        &&canonical(identity(snapshot.runs.find(r=>r.id===id)))===canonical(identity(expected)),'snapshot-historical-run-conflict');
    const probe=snapshot.runs.find(r=>r.id===ownId);
    check(probe.run_attempt===1&&probe.head_sha===process.env.GITHUB_SHA&&probe.path===WORKFLOW&&probe.workflow_id===own.workflow_id
      &&probe.event==='push'&&probe.head_branch===BRANCH&&sameRepo(probe),'snapshot-probe-identity');
    facts.comparisons=TARGETS.map((t,i)=>compare(report.filtered[i],snapshot,t));
    facts.repository_total_count=snapshot.total;
  }
  check(performance.now()-start<=60000,'snapshot-total-time-bound');
  report.snapshot_elapsed_ms=Math.ceil(performance.now()-start);
  report.direct_after={source:await exactRun(SOURCE,TARGETS[1],HEAD,'workflow_run'),ci:await exactRun(CI,TARGETS[0],HEAD,'push'),
    probe:await exactRun(ownId,{id:own.workflow_id,path:WORKFLOW},process.env.GITHUB_SHA,'push',{active:true})};
  for(const name of ['source','ci'])for(const endpoint of ['current','original']){
    const before=identity(report.direct[name][endpoint]),after=identity(report.direct_after[name][endpoint]);
    for(const k of ['created_at','updated_at']){delete before[k];delete after[k];}
    check(canonical(before)===canonical(after),'historical-run-changed-during-probe');
  }
  report.status='complete';report.finished_at=new Date().toISOString();
  save('report.json',report);
  console.log(JSON.stringify({status:report.status,probe_run_id:ownId,snapshot_pages:report.snapshots.map(s=>s.pages),
    filtered:report.filtered.map(f=>({target:f.target,status:f.status,reason:f.reason??null,ids:f.ids??null})),
    comparisons:report.snapshots.map(s=>s.comparisons),snapshot_elapsed_ms:report.snapshot_elapsed_ms}));
}
if(process.argv[2]==='--self-test'){check(process.argv.length===3,'unexpected-arguments');selfTest();}
else try{await main();}catch(e){
  report.status='failed';report.reason=e.probeReason??e.inventoryReason??'probe-transport-or-validation-failure';
  report.finished_at=new Date().toISOString();if(output)writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.error(JSON.stringify({status:'failed',reason:report.reason}));process.exitCode=1;
}
