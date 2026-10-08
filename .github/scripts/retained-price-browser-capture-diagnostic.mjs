// Synthetic browser-body diagnosis only. No source or publication authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createReadStream,existsSync,lstatSync,mkdirSync,openSync,closeSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync,writeSync} from 'node:fs';
import {dirname,extname,join,resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createBrowserNetworkGate,EXPECTED_BLOCKED_FONT_STYLESHEETS,captureFallbackTypography,BROWSER_LIMITS,localBrowserUrl} from './retained-price-source-browser.mjs';
import {createDiagnosticCapturePage} from './retained-price-browser-capture-adapter.mjs';

const BASE='b464cd32691853b7128189f4e3350b74959468bb',BRANCH='finite-browser-capture-diagnostic-a11';
const UI={sha:'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',tree:'1c0219a170dcbdeb1af539e4cf7a04018251ca02',frontend:'0ba620a84264e1ff026898beed3fbc8ad5894618'};
const APPROVED=resolve('.capture-approved/frontend'),OUTPUT=resolve(process.env.RUNNER_TEMP||'/tmp','browser-capture-diagnostic'),WORK=resolve(process.env.RUNNER_TEMP||'/tmp','browser-capture-fixtures');
const SCRIPT='.github/scripts/retained-price-browser-capture-diagnostic.mjs',WORKFLOW='.github/workflows/retained-price-browser-capture-diagnostic.yml';
const DIAGNOSTIC_FILES=[SCRIPT,WORKFLOW,'.github/scripts/retained-price-browser-capture-adapter.mjs','.github/scripts/retained-price-browser-capture-adapter.test.mjs'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',maxBuffer:1024**2}).trim();
const check=(v,message)=>assert(v,message);
const paths=['research-details/NVDA-small.json','research-details/FUTU-small.json','research-details/FUTU-one.json','research-details/FUTU-eight.json','research-details/FUTU-eighteen.json','research-details/FUTU-twentyone.json'];
const expectedEncodedMiB=[0.1,0.1,1,8,18,21];
const report={schema_version:'retained-price-browser-capture-diagnostic-v1',diagnostic_only:true,publication_authority:false,source_authority:false,
  scope:'Synthetic packed actual-response capture; no real financial acceptance or publication',limits:BROWSER_LIMITS,cases:[],fixtures:[],network_denials:[],server:[],started_at:new Date().toISOString()};
let browser,server,timer,approved,assets,deadline=false;
function safeError(error){return {name:typeof error?.name==='string'?error.name:'Error',message:String(error?.message??error).slice(0,2048)};}
function save(){
  const raw=JSON.stringify(report,null,2)+'\n';check(Buffer.byteLength(raw)<=BROWSER_LIMITS.reportBytes,'Diagnostic report cap exhausted');
  writeFileSync(join(OUTPUT,'report.json'),raw);
}
function writePayload(file,symbol,size){
  mkdirSync(dirname(file),{recursive:true});const fd=openSync(file,'wx');
  const prefix='{"symbol":'+JSON.stringify(symbol)+',"as_of_date":"2026-10-06","zero":-0,"absent":null,"payload":"',suffix='"}\n';
  const chars=Math.ceil(size*1024**2*4/3),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let state=0x31415927,remaining=chars;
  try{
    writeSync(fd,prefix);
    while(remaining>0){
      const count=Math.min(65536,remaining),chunk=Buffer.allocUnsafe(count);
      for(let n=0;n<count;n++){state^=state<<13;state^=state>>>17;state^=state<<5;chunk[n]=alphabet.charCodeAt(state&63);}
      writeSync(fd,chunk);remaining-=count;
    }
    writeSync(fd,suffix);
  }finally{closeSync(fd);}
  const bytes=statSync(file).size;check(bytes<=BROWSER_LIMITS.fileBytes,'Synthetic input exceeds existing file cap');return {symbol,payload_chars:chars,decoded_bytes:bytes,decoded_sha256:hash(readFileSync(file))};
}
const html='<!doctype html><meta charset="utf-8"><title>Capture diagnostic</title><style>'+EXPECTED_BLOCKED_FONT_STYLESHEETS.map(url=>'@import url("'+url+'");').join('')+
  'body{font-family:Inter,"Zen Kaku Gothic New",sans-serif;margin:20px}.symbol-title h2{font-size:24px}.research-symbol-price strong{font-size:22px}button{font-size:18px}</style>'+
  '<link rel="icon" href="./favicon.svg"><div class="symbol-title"><h2>NVDA</h2></div><div class="research-symbol-price"><strong>診断</strong></div><div id="research-detail-tabs"><button id="load" aria-selected="true">財務・機関</button></div>'+
  '<script type="module">import {createStaticTransport} from "./_approved/transport/index.mjs";'+
  'window.fixture={state:"idle"};window.configure=configuration=>{window.configuration=configuration;document.querySelector("h2").textContent=configuration.symbol;window.fixture={state:"idle"};};'+
  'document.querySelector("#load").onclick=()=>{window.fixture.state="loading";window.fixture.promise=(async()=>{const c=window.configuration;'+
  'if(c.abort){const controller=new AbortController();const response=await fetch(new URL(c.assetPath,location.href),{signal:controller.signal,cache:"no-store"});controller.abort();await response.arrayBuffer();return;}'+
  'const transport=await createStaticTransport({baseURL:new URL("./",location.href).href,expectedRoot:c.expectedRoot});try{const value=await transport.readJson("static-data/"+c.logical);window.fixture={state:"passed",symbol:value.symbol,payload_chars:value.payload.length};}finally{transport.dispose();}})().catch(error=>{window.fixture={state:"failed",error:error.message,error_name:error.name};});};'+
  'window.ready=true;</script>';
async function fixture(){
  const source=join(WORK,'source'),packed=join(WORK,'packed');mkdirSync(source,{recursive:true});
  const manifest={as_of_date:'2026-10-06',research_generation:'synthetic-capture',assets:{research:{path:'research-index.json'}}};
  const manifestBytes=Buffer.from(JSON.stringify(manifest));mkdirSync(join(source,'static-data'),{recursive:true});
  writeFileSync(join(source,'static-data/manifest.json'),manifestBytes,{flag:'wx'});
  writeFileSync(join(source,'static-data/research-index.json'),JSON.stringify({as_of_date:'2026-10-06',rows:paths.map((path,index)=>({symbol:index===0?'NVDA':'FUTU',research_detail_path:path}))}),{flag:'wx'});
  writeFileSync(join(source,'index.html'),html,{flag:'wx'});
  writeFileSync(join(source,'favicon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="#555" d="M0 0h8v8H0z"/></svg>',{flag:'wx'});
  for(const name of ['index.mjs','codec.mjs','format.mjs']){
    const path=join(source,'_approved/transport',name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,readFileSync(join(APPROVED,'src/static/transport',name)),{flag:'wx'});
  }
  for(let n=0;n<paths.length;n++)report.fixtures.push({logical_path:'static-data/'+paths[n],...writePayload(join(source,'static-data',paths[n]),n===0?'NVDA':'FUTU',expectedEncodedMiB[n])});
  const receipt=await approved.pack({source,output:packed,bindings:{manifestSha256:hash(manifestBytes),uiInventorySha256:'b'.repeat(64),
    financialGeneration:null,financialLineageSha256:null,sourceCommit:'a'.repeat(40),appCommit:'a'.repeat(40),candidateId:'c'.repeat(64)}});
  const publication=approved.previewPublication({uiSha:'a'.repeat(40),uiDigest:'b'.repeat(64),manifestSha256:hash(manifestBytes)});
  publication.transport=approved.transportDescriptor(receipt,{uiSha:'a'.repeat(40),uiDigest:'b'.repeat(64)});
  writeFileSync(join(packed,'publication.json'),JSON.stringify(publication),{flag:'wx'});
  const root=JSON.parse(readFileSync(join(packed,receipt.expectedRoot.path))),entries=[];
  for(const f of report.fixtures){
    const id=parseInt(hash(Buffer.from(f.logical_path)).slice(0,2),16),shard=JSON.parse(readFileSync(join(packed,root.shards[id].path)));
    const entry=shard.files.find(e=>e.path===f.logical_path);check(entry&&entry.decodedBytes===f.decoded_bytes&&entry.decodedSha256===f.decoded_sha256,'Real packer fixture mismatch');
    check(entry.encodedBytes<=BROWSER_LIMITS.fileBytes,'Packed fixture exceeds file cap');Object.assign(f,{physical_path:entry.assetPath,kind:entry.kind,encoded_bytes:entry.encodedBytes,encoded_sha256:entry.encodedSha256});entries.push(entry);
  }
  // Negative input only: coherently repin one wrong decoded hash. The real
  // observer/decoder must reject it; this never grants production authority.
  const corruptedRoot=structuredClone(root),id=parseInt(hash(Buffer.from(report.fixtures[1].logical_path)).slice(0,2),16);
  const shard=JSON.parse(readFileSync(join(packed,root.shards[id].path)));shard.files.find(e=>e.path===report.fixtures[1].logical_path).decodedSha256='f'.repeat(64);
  const shardBytes=approved.canonicalBytes(shard),shardHash=hash(shardBytes),shardPath='static-data/_transport/shard-'+shardHash+'.json';
  writeFileSync(join(packed,shardPath),shardBytes,{flag:'wx'});corruptedRoot.shards[id]={id:root.shards[id].id,path:shardPath,bytes:shardBytes.length,sha256:shardHash};
  corruptedRoot.generation=hash(approved.canonicalBytes(approved.generationBody(corruptedRoot)));const rootBytes=approved.canonicalBytes(corruptedRoot),rootHash=hash(rootBytes),rootPath='static-data/_transport/root-'+rootHash+'.json';
  writeFileSync(join(packed,rootPath),rootBytes,{flag:'wx'});
  const wrongReceipt={...receipt,expectedRoot:{path:rootPath,bytes:rootBytes.length,sha256:rootHash,generation:corruptedRoot.generation,bindings:corruptedRoot.bindings}};
  const wrongPublication=structuredClone(publication);wrongPublication.transport=approved.transportDescriptor(wrongReceipt,{uiSha:'a'.repeat(40),uiDigest:'b'.repeat(64)});
  return {packed,receipt,entries,publication,wrongReceipt,wrongPublication,root};
}
async function serve(site){
  let requests=0,served=0,active=null;const records=[];const failure=[];
  const native=createServer((request,response)=>{
    let record;
    try{
      check(['GET','HEAD'].includes(request.method),'Unexpected diagnostic HTTP method');check(++requests<=BROWSER_LIMITS.requests,'Diagnostic request cap exhausted');
      const url=new URL(request.url,'http://127.0.0.1');check(url.pathname.startsWith('/screener/'),'Unexpected diagnostic base');
      const relative=decodeURIComponent(url.pathname.slice('/screener/'.length))||'index.html';check(!relative.includes('\\')&&relative.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Unsafe diagnostic path');
      const file=resolve(site.packed,relative);check(file.startsWith(site.packed+sep),'Diagnostic path escape');
      record={id:requests,case_id:active?.id??null,method:request.method,path:relative,started_ms:performance.now(),status:null,declared_bytes:null,stream_bytes:0,finished:false,early_close:false};records.push(record);
      response.once('finish',()=>{record.finished=true;record.finished_ms=performance.now();});
      let abortTimer;
      response.once('close',()=>{clearTimeout(abortTimer);record.closed_ms=performance.now();record.early_close=!record.finished;
        if(record.abort_body_withheld)record.abort_close_observed=record.early_close;});
      if(!existsSync(file)){record.status=404;response.writeHead(404);response.end();return;}
      const stat=lstatSync(file);check(stat.isFile()&&!stat.isSymbolicLink()&&realpathSync(file)===file&&stat.size<=BROWSER_LIMITS.fileBytes,'Unsafe/oversized diagnostic file');
      const target=active?.entry?.assetPath===relative,mode=target?active.mode:null;
      if(target&&mode==='404'){record.status=404;response.writeHead(404);response.end();return;}
      let memory=relative==='publication.json'&&active?.mode==='bad-decoded-hash'?Buffer.from(JSON.stringify(site.wrongPublication)):null;
      if(target&&mode==='bad-encoded-hash'){memory=readFileSync(file);memory[15]^=1;}
      const length=memory?.length??stat.size;served+=request.method==='HEAD'?0:length;check(served<=BROWSER_LIMITS.servedBytes,'Diagnostic served-byte cap exhausted');
      const type={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream';
      record.status=200;record.declared_bytes=length;record.mime_type=type;
      response.writeHead(200,{'Content-Type':type,'Content-Length':length,'Cache-Control':'no-store'});
      if(request.method==='HEAD'){response.end();return;}
      if(target&&mode==='aborted'){
        record.abort_body_withheld=true;record.abort_close_observed=false;response.flushHeaders();
        abortTimer=setTimeout(()=>{record.abort_not_observed=true;response.destroy();},1500);return;
      }
      if(target&&mode==='incomplete'){
        const prefix=readFileSync(file).subarray(0,1024);record.stream_bytes=prefix.length;response.write(prefix);setTimeout(()=>response.destroy(),15);return;
      }
      if(memory){record.stream_bytes=memory.length;response.end(memory);return;}
      const stream=createReadStream(file);stream.on('data',chunk=>record.stream_bytes+=chunk.length);stream.on('error',error=>{record.stream_error=safeError(error);response.destroy();});stream.pipe(response);
    }catch(error){failure.push(safeError(error));if(!response.headersSent)response.writeHead(400);response.destroy();}
  });
  await new Promise((ok,bad)=>{native.once('error',bad);native.listen(0,'127.0.0.1',ok);});
  return {origin:'http://127.0.0.1:'+native.address().port,setCase:value=>{active=value;},records,failures:failure,
    stats:()=>({requests,served_bytes:served}),close:()=>new Promise((ok,bad)=>{native.close(error=>error?bad(error):ok());native.closeAllConnections();})};
}
async function warmupExtras(page,context,session){
  if(!session)session=await context.newCDPSession(page);
  const typography=await captureFallbackTypography(page,session);
  const [download]=await Promise.all([page.waitForEvent('download'),page.evaluate(()=>{
    const data='synthetic capture warmup\n'.repeat(65536),url=URL.createObjectURL(new Blob([data],{type:'text/csv'})),anchor=document.createElement('a');
    anchor.href=url;anchor.download='synthetic-warmup.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  })]);
  const stream=await download.createReadStream();check(stream,'Warmup download missing');let count=0;const digest=createHash('sha256');
  for await(const chunk of stream){count+=chunk.length;check(count<=BROWSER_LIMITS.csvBytes,'Warmup CSV cap exhausted');digest.update(chunk);}
  const screenshot=await page.screenshot({fullPage:false});check(screenshot.length<=BROWSER_LIMITS.screenshotBytes,'Warmup screenshot cap exhausted');
  return {typography,csv:{bytes:count,sha256:digest.digest('hex'),synthetic:true},screenshot:{bytes:screenshot.length,sha256:hash(screenshot),contents_retained:false}};
}
async function one(site,{index,eager,observer,pass,mode='normal',gc=false,warmup=false}){
  check(!deadline,'Diagnostic deadline exceeded');
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ja-JP',serviceWorkers:'block',acceptDownloads:true});
  const id=report.cases.length+1,result={id,label:warmup?'first-context-NVDA':'following-context-FUTU',index,pass,mode,gc,eager,observer,
    fixture:report.fixtures[index],started_ms:performance.now(),events:[],request_events:[],stage:'setup',status:'running'};
  report.cases.push(result);save();
  let page,session,capture,assetsForCase=assets,caseError=null,closed=false,actionStarted=null,actionFinished=null;
  const gate=createBrowserNetworkGate({origin:server.origin,getPage:()=>page,denials:report.network_denials,symbol:(warmup?'NVDA':'FUTU')+'-'+id});
  result.network=gate.evidence;server.setCase({id,entry:site.entries[index],mode});
  const recordEvent=(kind,request)=>{check(result.request_events.length<64,'Case request event cap exhausted');const path=new URL(request.url()).pathname;
    if(path.includes('_transport/gzip/'))result.request_events.push({kind,url:request.url(),at_ms:performance.now(),failure:request.failure()?.errorText??null});};
  try{
    await context.route('**/*',gate.route);await context.routeWebSocket('**/*',gate.routeWebSocket);page=await context.newPage();page.setDefaultTimeout(45000);
    if(observer)session=await gate.attach(context,page);else context.on('response',gate.observeHttpResponse);
    page.on('requestfinished',request=>recordEvent('requestfinished',request));page.on('requestfailed',request=>recordEvent('requestfailed',request));
    await page.goto(server.origin+'/screener/');await page.waitForFunction(()=>window.ready===true);
    if(mode==='bad-decoded-hash')assetsForCase=await approved.createDesignAssetObserver({baseURL:server.origin+'/screener/',fetchImpl:(url,options)=>{
      check(localBrowserUrl(url,server.origin),'Negative observer attempted external access');return fetch(url,{...options,signal:AbortSignal.timeout(45000)});}});
    await page.evaluate(c=>window.configure(c),{symbol:warmup?'NVDA':'FUTU',logical:paths[index],assetPath:site.entries[index].assetPath,
      expectedRoot:mode==='bad-decoded-hash'?site.wrongReceipt.expectedRoot:site.receipt.expectedRoot,abort:mode==='aborted'});
    capture=createDiagnosticCapturePage(page,{eager,deadlineMs:45000,onEvent:event=>result.events.push(event)});
    result.stage='observeJson';
    const action=async()=>{
      actionStarted=performance.now();await page.locator('#load').click();
      if(gc){
        await page.waitForFunction(()=>window.fixture.state==='passed'||window.fixture.state==='failed');
        if(!session)session=await context.newCDPSession(page);
        await session.send('HeapProfiler.collectGarbage');await page.waitForTimeout(250);
      }
      actionFinished=performance.now();
    };
    let observed;
    try{observed=await assetsForCase.observeJson(capture.page,paths[index],action);}
    catch(error){caseError=error;result.capture_error=safeError(error);}
    result.action={started_ms:actionStarted,finished_ms:actionFinished};
    if(caseError){
      const bodyErrors=[...capture.originalBodyErrors().values()];
      result.exact_original_body_error=bodyErrors.some(error=>error===caseError);
      result.exact_original_waiter_error=capture.records.some(r=>r.waiter?.error_ref===caseError);
      if(['aborted','incomplete'].includes(mode))check(result.exact_original_body_error||result.exact_original_waiter_error||/encoded length|encoded SHA-256/.test(caseError.message),'Failed transfer did not preserve body, waiter or integrity failure');
      else if(mode==='bad-encoded-hash')check(/encoded SHA-256/.test(caseError.message),'Bad encoded bytes were not rejected');
      else if(mode==='bad-decoded-hash')check(/decoded SHA-256/.test(caseError.message),'Bad decoded pin was not rejected');
      else if(mode==='404')check(/browser HTTP 404/.test(caseError.message),'HTTP failure was not retained');
      else check(result.exact_original_body_error&&/Network\.getResponseBody|No data found|inspector cache|session.*closed/i.test(caseError.message),'Unexpected positive fixture failure');
      if(mode==='aborted'){
        await page.waitForFunction(()=>window.fixture.state==='failed');result.ui=await page.evaluate(()=>({...window.fixture,promise:undefined}));
        check(result.ui.error_name==='AbortError','Controlled browser abort did not reject the page body read');
      }
      result.status=mode==='normal'?'observed-capture-failure':'expected-rejection';
    }else{
      check(mode==='normal','Negative input unexpectedly passed');
      check(observed.value.symbol===(warmup?'NVDA':'FUTU')&&observed.value.payload.length===report.fixtures[index].payload_chars
        &&Object.is(observed.value.zero,-0)&&observed.value.absent===null,'Synthetic decoded value mismatch');
      result.observation=observed.observation;check(observed.observation.decoded_sha256===report.fixtures[index].decoded_sha256,'Approved observer hash changed');
      await page.waitForFunction(()=>window.fixture.state==='passed'||window.fixture.state==='failed');result.ui=await page.evaluate(()=>({...window.fixture,promise:undefined}));
      check(result.ui.state==='passed','Actual browser transport rejected a positive fixture');
      if(warmup)result.warmup=await warmupExtras(page,context,session);
      result.status='captured';
    }
  }catch(error){result.status='diagnostic-error';result.error=safeError(error);throw error;}
  finally{
    result.stage='cleanup';let cleanupFailure=null;
    const retainCleanup=(error,key)=>{result[key]=safeError(error);cleanupFailure??=error;};
    try{if(assetsForCase!==assets)assetsForCase.dispose();}catch(error){retainCleanup(error,'observer_cleanup_error');}
    // Close the owning context before draining a waiter left by a failed action.
    try{await context.close();closed=true;}catch(error){retainCleanup(error,'close_error');}
    if(capture){
      try{await capture.drain();result.drain='settled';}
      catch(error){result.drain_error=safeError(error);if(!caseError&&result.status!=='diagnostic-error')cleanupFailure??=error;}
      try{await capture.dispose();}
      catch(error){result.dispose_error=safeError(error);if(!caseError&&result.status!=='diagnostic-error')cleanupFailure??=error;}
      try{
        result.capture=capture.snapshot();result.capture_clock_origin_ms=result.capture.diagnostics.clock_origin_ms;
        check(Number.isFinite(result.capture_clock_origin_ms),'Capture clock origin missing');
        check(result.capture.diagnostics.disposed&&result.capture.diagnostics.pending_count===0
          &&result.capture.diagnostics.retained_body_promises===0&&result.capture.diagnostics.retained_responses===0,'Capture adapter retained pending work or response references');
      }catch(error){retainCleanup(error,'capture_cleanup_error');}
    }
    try{check(closed,'Diagnostic browser context cleanup failed');gate.assertClean();}catch(error){retainCleanup(error,'network_cleanup_error');}
    try{
      const requests=server.records.filter(r=>r.case_id===id&&r.path===site.entries[index].assetPath&&r.method==='GET');
      result.physical_request_count=requests.length;check(requests.length===1,'Unexpected repeated/independent physical fetch');
      if(mode==='aborted')check(requests[0].abort_body_withheld===true&&requests[0].stream_bytes===0
        &&requests[0].early_close===true&&requests[0].abort_close_observed===true&&!requests[0].abort_not_observed
        &&result.request_events.some(event=>event.kind==='requestfailed'),'Controlled abort did not interrupt an incomplete physical transfer');
    }catch(error){retainCleanup(error,'transfer_cleanup_error');}
    if(cleanupFailure){result.cleanup_error=safeError(cleanupFailure);result.status='diagnostic-error';}
    result.finished_ms=performance.now();result.stage='finished';
    try{save();}catch(error){cleanupFailure??=error;}
    if(cleanupFailure)throw cleanupFailure;
  }
}
function plannedCases(){
  const plan=[];
  for(let pass=1;pass<=3;pass++)for(let index=1;index<paths.length;index++){
    if(index>=4&&pass===3||index===5&&pass>=2)continue;
    for(const observer of [false,true])for(const eager of [false,true]){
      plan.push({index:0,eager,observer,pass,warmup:true});plan.push({index,eager,observer,pass});
    }
  }
  for(const observer of [false,true])for(const eager of [false,true])plan.push({index:3,eager,observer,pass:0,gc:true});
  for(const eager of [false,true])plan.push({index:4,eager,observer:true,pass:0,gc:true});
  for(const mode of ['aborted','incomplete','404','bad-encoded-hash','bad-decoded-hash'])for(const eager of [false,true])
    plan.push({index:1,eager,observer:true,pass:0,mode});
  return plan;
}
function plannedBytes(site,plan){
  const payload=plan.reduce((total,item)=>total+site.entries[item.index].encodedBytes,0);
  const uiFiles=['index.html','favicon.svg',...['index.mjs','format.mjs','codec.mjs'].map(name=>'_approved/transport/'+name)];
  const ui=uiFiles.reduce((total,path)=>total+statSync(join(site.packed,path)).size,0);
  const largestRoot=Math.max(site.receipt.expectedRoot.bytes,site.wrongReceipt.expectedRoot.bytes);
  const largestShard=Math.max(...site.root.shards.map(s=>s.bytes),256*1024);
  // Every fixture page has one HTML/module/icon bootstrap and one root/shard
  // lookup. Charge twice those bytes, maximum permitted shard size, and a
  // separate host-observer allowance. These are planned bounds, not new caps.
  const browserOverhead=2*plan.length*(ui+largestRoot+largestShard);
  const hostOverhead=8*1024**2,reserve=8*1024**2;
  const conservativeTotal=payload+browserOverhead+hostOverhead+reserve;
  check(conservativeTotal<=BROWSER_LIMITS.servedBytes,'Planned fixture matrix exceeds unchanged aggregate byte cap');
  return {payload_bytes:payload,browser_metadata_and_ui_bound:browserOverhead,host_observer_bound:hostOverhead,
    additional_margin_bytes:reserve,conservative_total_bytes:conservativeTotal,aggregate_cap_bytes:BROWSER_LIMITS.servedBytes};
}

async function main(){
  check(process.argv.length===2,'Diagnostic accepts no arguments');
  check(process.env.GITHUB_REPOSITORY==='kusennjp1-ai/screener'&&process.env.GITHUB_EVENT_NAME==='push'
    &&process.env.GITHUB_REF==='refs/heads/'+BRANCH&&process.env.GITHUB_RUN_ATTEMPT==='1','Unexpected diagnostic execution');
  const root=process.cwd();check(git(root,'show','-s','--format=%P','HEAD')===BASE,'Wrong diagnostic parent');
  check(git(root,'diff','--name-only',BASE,'HEAD').split('\n').sort().join('|')===DIAGNOSTIC_FILES.sort().join('|'),'Unreviewed diagnostic changes');
  check(gitBlob(readFileSync('.github/scripts/retained-price-source-browser.mjs'))==='096506586e6bb8db095b41c9caf2ae0419a26917','Shared current browser handler changed');
  check(gitBlob(readFileSync('.github/scripts/retained-price-browser-capture-adapter.mjs'))==='aaa39e2af7350ba6848367ea4627c5e0b1a519d8','Diagnostic adapter changed');
  const request=JSON.parse(readFileSync('.github/retained-price-oct6-source.json'));check(request.enabled===false&&request.activation===null,'Finite source remains enabled');
  check(git(dirname(APPROVED),'rev-parse','HEAD')===UI.sha&&git(dirname(APPROVED),'rev-parse','HEAD^{tree}')===UI.tree
    &&git(dirname(APPROVED),'rev-parse','HEAD:frontend')===UI.frontend,'Wrong approved checkout');
  execFileSync('git',['-C',dirname(APPROVED),'diff','--quiet','HEAD','--'],{stdio:['ignore','pipe','pipe']});
  for(const [path,pin] of [['tools/design-static-assets.mjs','fde092e9a7471bdfe6d77193f5419af40cdedd08'],['tools/static-transport/pack.mjs','50dc1464c810dec2faf4a899cc2d67eb07c5b981'],['package-lock.json','3533b0f6ff61b73235da8765bccbdc754add0294']])
    check(gitBlob(readFileSync(join(APPROVED,path)))===pin,'Approved helper/packer/lock changed');
  check(!existsSync(OUTPUT)&&!existsSync(WORK),'Diagnostic output must be fresh');mkdirSync(OUTPUT);mkdirSync(WORK);
  report.run_id=Number(process.env.GITHUB_RUN_ID);report.head_sha=process.env.GITHUB_SHA;report.approved_ui=UI;save();
  timer=setTimeout(()=>{deadline=true;void browser?.close();},BROWSER_LIMITS.milliseconds);
  const load=path=>import(pathToFileURL(join(APPROVED,path)).href);
  const [observer,packer,format,publication]=await Promise.all(['tools/design-static-assets.mjs','tools/static-transport/pack.mjs','src/static/transport/format.mjs','../.github/scripts/static-transport-publication.mjs'].map(load));
  approved={...observer,...packer,...format,...publication};
  const require=createRequire(join(APPROVED,'package.json')),version=require('playwright/package.json').version;
  check(version==='1.59.1','Wrong locked Playwright version');report.playwright=version;
  const site=await fixture();server=await serve(site);
  assets=await approved.createDesignAssetObserver({baseURL:server.origin+'/screener/',fetchImpl:(url,options)=>{
    check(localBrowserUrl(url,server.origin),'Observer attempted external access');return fetch(url,{...options,signal:AbortSignal.timeout(45000)});}});
  check(assets.packed,'Diagnostic must exercise packed responses');
  browser=await require('playwright').chromium.launch({headless:true});report.browser=browser.version();check(report.browser==='147.0.7727.15','Unexpected actual locked Chromium');save();
  const plan=plannedCases();report.case_plan=plan;report.planned_bytes=plannedBytes(site,plan);save();
  for(const item of plan)await one(site,item);
  check(!deadline,'Diagnostic deadline exceeded');
  const captureFailures=report.cases.filter(c=>c.status==='observed-capture-failure');
  report.actual_A11_cause_established=false;
  report.interpretation=captureFailures.length===0?'Synthetic matrix did not reproduce the A11 capture failure':
    captureFailures.every(c=>c.index>=4||c.gc)?'Only artificial oversized or forced-GC cases failed; this does not establish the A11 cause':
      'An ordinary synthetic capture sequence failed; failed A11 FUTU payload/request facts remain unavailable, so causation is not established';
  report.summary={ordinary_small_control_failures:captureFailures.filter(c=>c.index<4&&!c.gc).length,captures:report.cases.filter(c=>c.status==='captured').length,observed_capture_failures:report.cases.filter(c=>c.status==='observed-capture-failure').length,
    expected_rejections:report.cases.filter(c=>c.status==='expected-rejection').length,cases:report.cases.length};
  report.status='diagnostic-completed';report.finished_at=new Date().toISOString();save();
}
try{await main();}catch(error){report.status='diagnostic-failed';report.error=safeError(error);report.finished_at=new Date().toISOString();process.exitCode=1;}
finally{
  clearTimeout(timer);assets?.dispose();
  try{await browser?.close();}catch(error){report.cleanup_error=safeError(error);process.exitCode=1;}
  if(server){report.server=server.records;report.server_summary=server.stats();report.server_failures=server.failures;try{await server.close();}catch(error){report.cleanup_error??=safeError(error);process.exitCode=1;}}
  if(existsSync(OUTPUT)){try{save();}catch(error){console.error(safeError(error));process.exitCode=1;}}
  if(existsSync(WORK))rmSync(WORK,{recursive:true,force:true});
  console.log(JSON.stringify({status:report.status,diagnostic_only:true,publication_authority:false,source_authority:false,summary:report.summary,error:report.error??null}));
}
