import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {REPOSITORY,DEFAULT_CUTOFF,LIMITS,ensure,safeCode,safeHeaders,quota,cohortFacts,checkCohortLowerBound,historyFacts} from './release40-logic.mjs';

export async function measurePhase(input){
  const {candidateRoot,context,directory,anchors,phase,output}=input;
  const result={schema_version:'release40-readonly-phase-v1',phase,status:'failed',budgetAccepted:false,
    cutoff:DEFAULT_CUTOFF,cutoff_basis:'pinned production selector default; no live-anchor parity claim',
    candidate_sha:context.controller_sha,publication_authority:false};
  let reader=null,handle=null;
  const mod=name=>import(pathToFileURL(join(candidateRoot,'.github/scripts',name)).href);
  try{
    ensure(['cold','warm'].includes(phase),'invalid-phase');
    const [inventory,cache,transport,worker,publication]=await Promise.all([
      mod('retained-price-repository-inventory.mjs'),mod('conditional-deployment-jobs-cache.mjs'),
      mod('conditional-deployment-jobs.mjs'),mod('conditional-deployment-jobs-worker.mjs'),mod('publication-state.mjs')]);
    const nativeQuotas=new Map();
    const raw=await inventory.readRepositorySnapshot({timeoutMs:LIMITS.snapshotMs,requiredIds:anchors,
      fetcher:async(url,options)=>{
        const match=/^https:\/\/api\.github\.com\/repositories\/1203919607\/actions\/runs\?per_page=50&page=([1-9]\d?)$/.exec(url);
        ensure(match&&Number(match[1])<=40,'unexpected-inventory-route');
        const response=await globalThis.fetch(url,options),h=response.headers;
        const value={resource:h.get('x-ratelimit-resource')};
        for(const key of ['limit','used','remaining','reset']){
          const raw=h.get('x-ratelimit-'+key);ensure(typeof raw==='string'&&/^\d{1,15}$/.test(raw),'missing-or-invalid-actual-quota');value[key]=Number(raw);
        }
        nativeQuotas.set(Number(match[1]),quota(value));
        return response;
      }});
    result.inventory={status:raw.status,body_bytes:raw.body_bytes,pages:raw.evidence.map(e=>({
      page_number:e.page_number,status:e.status,observed_total:e.observed_total,row_count:e.row_count,
      body_bytes:e.body_bytes,body_sha256:e.body_sha256,ids_sha256:e.ids_sha256,safe_headers:safeHeaders(e.safe_headers),
      quota:nativeQuotas.get(e.page_number)??null}))};
    ensure(raw.status==='complete','fresh-full-inventory-failed');
    const snapshot=inventory.validateSnapshot(raw.pages,anchors);
    result.inventory.repository_runs=snapshot.total;
    handle=cache.openJobCache({context,directory});
    const before=handle.loadVerified();
    ensure(phase==='cold'?before.generation===0&&before.pages.length===0:before.generation>=1,'unexpected-cache-generation');
    result.cache_before={generation:before.generation,pages:before.pages.length};
    const scope=Object.fromEntries(['repository','repository_id','run_id','run_attempt','controller_sha'].map(k=>[k,context[k]]));
    let selected=null;
    reader=transport.createConditionalDeploymentJobsReader({scope,jobCache:handle,report:()=>{},
      run:(command,args,options)=>{
        // Existing synchronous reader and worker are unchanged. Add the same finite
        // 200-start bound the production finite controller supplies to its worker.
        ensure(command===process.execPath&&args.at(-1)===join(candidateRoot,'.github/scripts/conditional-deployment-jobs-worker.mjs'),'unexpected-worker');
        const config=JSON.parse(options.input);config.maximumRequests=LIMITS.historyRequests;
        let raw;
        try{raw=execFileSync(command,args,{...options,input:JSON.stringify(config)});}
        catch(error){
          try{const failed=JSON.parse(error.stdout);result.history_failure={status:failed.status,
            reason:typeof failed.reason==='string'&&/^[a-z0-9-]+$/.test(failed.reason)?failed.reason:'worker-failed',
            requests_observed:failed.observations?.length??null};}catch{}
          throw Object.assign(new Error('history-worker-failed'),{diagnosticCode:'history-worker-failed'});
        }
        const actual=JSON.parse(raw);
        result.history=historyFacts(actual,selected,scope.run_id);
        ensure(result.history.admitted,'weighted-cohort-or-active-capacity-exceeded');
        return raw;
      }});
    const originalRead=reader.read;
    reader.read=runs=>{
      selected=runs;
      result.cohort=cohortFacts(runs,worker.runKey);
      checkCohortLowerBound(runs,scope.run_id);
      return originalRead(runs);
    };
    const api=(endpoint,paginate)=>{
      ensure(paginate===true,'unexpected-api-call');
      const match=/^repos\/kusennjp1-ai\/screener\/actions\/workflows\/(research-ui-release\.yml|static-site\.yml)\/runs\?branch=main&per_page=100$/.exec(endpoint);
      ensure(match,'unexpected-api-route');
      const id=[...inventory.WORKFLOWS].find(([,file])=>file===match[1])[0];
      const runs=inventory.project(snapshot.runs,id),pages=[];
      for(let i=0;i<Math.max(1,runs.length);i+=100)pages.push({total_count:runs.length,workflow_runs:runs.slice(i,i+100)});
      return pages;
    };
    // This is the unchanged production cohort selection and job-validation path.
    // No fabricated live anchor is supplied and the selected cohort is never sliced.
    const latest=transport.withConditionalDeploymentJobsReader(reader,()=>publication.latestDeployment(REPOSITORY,api));
    result.latest_observed_deployment={run_id:latest.runId,attempt:latest.attempt,completed_epoch_ms:latest.completed};
    result.status='complete';
  }catch(error){result.reason=safeCode(error);}
  finally{
    if(reader&&!reader.disposed)try{reader.dispose('failed');}catch{}
    else if(!reader&&handle)try{handle.dispose('failed');}catch{}
    ensure(Buffer.byteLength(JSON.stringify(result))<=LIMITS.reportBytes,'phase-report-bound');
    writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  }
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
  try{
    const input=readFileSync(0,'utf8');ensure(Buffer.byteLength(input)<=65536,'phase-input-bound');
    const result=await measurePhase(JSON.parse(input));
    process.stdout.write(JSON.stringify({status:result.status,reason:result.reason??null})+'\n');
    process.exitCode=result.status==='complete'?0:1;
  }catch{process.stdout.write('{"status":"failed","reason":"phase-process-failed"}\n');process.exitCode=1;}
}
