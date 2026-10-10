// Read-only production anchor prefix. No arbitrary cutoff and no full-publication claim.
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {REPOSITORY,REPOSITORY_ID,ensure,hash,quota,safeElapsed} from './release40-logic.mjs';
const SITE='https://kusennjp1-ai.github.io/screener/';
export async function readLiveAnchor({candidateRoot,ledger,expected=null,fetcher=globalThis.fetch,
  command=(args,options)=>execFileSync('gh',args,{stdio:['ignore','pipe','pipe'],timeout:options.timeoutMs,maxBuffer:options.maxBuffer})}){
  const mod=name=>import(pathToFileURL(join(candidateRoot,'.github/scripts',name)).href);
  const [publication,metadata,api]=await Promise.all([mod('publication-state.mjs'),mod('financial-audit-history.mjs'),mod('bounded-github-api.mjs')]);
  ensure(publication.bootstrap.site_url===SITE&&publication.bootstrap.repository===REPOSITORY,'foreign-publication-site');
  ensure(ledger&&Array.isArray(ledger.cli)&&Array.isArray(ledger.public)&&Number.isSafeInteger(ledger.starts),'missing-anchor-ledger');
  const read=async(path,maximum)=>{
    ensure(['publication.json','static-data/manifest.json'].includes(path),'foreign-publication-path');
    const url=new URL(path,SITE);url.searchParams.set('publication_check',String(Date.now()));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000),started=performance.now();
    const fact={path,status:null,bytes:0,sha256:null,elapsed_ms:null};ledger.public.push(fact);
    try{
      const response=await fetcher(url.href,{method:'GET',cache:'no-store',credentials:'omit',redirect:'error',
        headers:{'Cache-Control':'no-cache'},signal:controller.signal});fact.status=response.status;
      ensure(response.status===200&&!response.redirected&&(response.url===''||response.url===url.href),'missing-or-denied-live-publication');
      ensure(response.body&&typeof response.body[Symbol.asyncIterator]==='function','invalid-publication-body');
      const chunks=[];
      for await(const chunk of response.body){ensure(chunk instanceof Uint8Array,'invalid-publication-body');
        fact.bytes+=chunk.byteLength;ensure(fact.bytes<=maximum,'live-publication-byte-cap');chunks.push(Buffer.from(chunk));}
      const bytes=Buffer.concat(chunks);fact.sha256=hash(bytes);return bytes;
    }finally{clearTimeout(timer);controller.abort();fact.elapsed_ms=Math.ceil(performance.now()-started);}
  };
  // Missing/404 receipts fail here: do not substitute an old date or silently
  // invoke production's legacy fallback without its separate legacy validation.
  const receiptBytes=await read('publication.json',metadata.PUBLICATION_METADATA_BYTES);
  const manifestBytes=await read('static-data/manifest.json',1024*1024);
  const receipt=publication.validateReceipt(metadata.parsePublicationReceipt(receiptBytes));
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
  ensure(publication.dataChronology(manifest)&&receipt.data_manifest_sha256===hash(manifestBytes)
    &&receipt.verification_universe.as_of_date===manifest.markets.US?.as_of_date,'live-receipt-manifest-mismatch');
  ensure(/^[a-f0-9]{40}$/.test(receipt.controller_sha??''),'missing-live-controller-identity');
  const scope={repository:REPOSITORY,repository_id:REPOSITORY_ID,run_id:receipt.run_id,
    run_attempt:receipt.run_attempt,controller_sha:receipt.controller_sha};
  const prefix='repos/'+REPOSITORY+'/actions/runs/'+receipt.run_id+'/attempts/'+receipt.run_attempt;
  const budget={beforeRequest:()=>{ensure(++ledger.starts<=6,'anchor-cli-start-cap');return ledger.starts;},afterRequest:f=>{
    ensure(f.status===200&&!f.retry_after_present,'anchor-api-denial');
    ledger.cli.push({status:f.status,quota:quota(f.quota),elapsed_ms:safeElapsed(f.elapsed_ms)});
  }};
  let run=null,jobs=null;
  const reader=(endpoint,paginate=false)=>{
    if(endpoint===prefix&&paginate===false){
      run=api.readBoundedRequiredCaller(endpoint,{scope,command,budget,timeoutMs:10000});
      ensure(run.repository?.id===REPOSITORY_ID&&run.head_repository?.id===REPOSITORY_ID
        &&run.head_sha===receipt.controller_sha&&run.status==='completed'&&run.conclusion==='success','live-anchor-run-identity');
      return run;
    }
    ensure(endpoint===prefix+'/jobs?per_page=100'&&paginate===true&&run,'unexpected-anchor-api-route');
    const pages=api.readBoundedGitHubPages(endpoint,{command,budget,timeoutMs:20000,maximumPages:2});
    jobs=pages.flatMap(p=>p.jobs);
    ensure(jobs.every(j=>j.run_id===run.id&&j.run_attempt===receipt.run_attempt&&j.head_sha===run.head_sha
      &&j.head_branch===run.head_branch&&j.workflow_name===run.name),'live-anchor-job-identity');
    return pages;
  };
  // The production function, not the diagnostic, decides the deployment cutoff.
  const anchor=publication.deploymentAnchor(receipt,REPOSITORY,reader);
  const proof={receipt_sha256:hash(receiptBytes),manifest_sha256:hash(manifestBytes),anchor,
    job_ids:jobs.map(j=>j.id).sort((a,b)=>a-b),cutoff:new Date(anchor.completed).toISOString(),
    validation:'unchanged receipt/manifest and deploymentAnchor production prefix',full_live_publication_verified:false};
  ensure(expected===null||JSON.stringify(proof)===JSON.stringify(expected),'live-anchor-changed');
  return proof;
}
