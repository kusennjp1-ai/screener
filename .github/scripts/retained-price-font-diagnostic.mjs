// Diagnostic-only real Chromium proof of denied public font imports.
// No artifact/source/provider/publication work and no publisher authority input.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {EXPECTED_BLOCKED_FONT_STYLESHEETS,BROWSER_NETWORK_CONTRACT,BROWSER_LIMITS,localBrowserUrl,createBrowserNetworkGate,captureFallbackTypography} from './retained-price-source-browser.mjs';

const UI='1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',LOCK='3533b0f6ff61b73235da8765bccbdc754add0294';
const sources=[
  {path:'frontend/src/static/theme/foundation.css',blob:'d2790d3b3b1764c34a936b26d719fdbce4e35e5f',url:EXPECTED_BLOCKED_FONT_STYLESHEETS[0],served:'/screener/source-foundation.css'},
  {path:'frontend/src/index.css',blob:'3909758330379e3061badf17624a1698288e616a',url:EXPECTED_BLOCKED_FONT_STYLESHEETS[1],served:'/screener/source-index.css'},
];
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const gitBlob=raw=>createHash('sha1').update(Buffer.from('blob '+raw.length+'\0')).update(raw).digest('hex');
const root=resolve('approved-ui'),output=join(process.env.RUNNER_TEMP||'/tmp','retained-price-font-diagnostic');
assert.equal(process.argv.length,2,'Diagnostic accepts no caller overrides');assert.equal(process.execArgv.length,0);assert.equal(process.version,'v22.23.3','Diagnostic must use the actual publisher Node runtime');
assert(!process.env.GH_TOKEN&&!process.env.GITHUB_TOKEN,'Diagnostic must not receive a GitHub token');
assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',maxBuffer:1024}).trim(),UI,'Diagnostic UI checkout is not pinned');
for(const source of sources){source.raw=readFileSync(join(root,source.path));assert(source.raw.length<=64*1024);assert.equal(gitBlob(source.raw),source.blob,'Pinned public CSS changed');assert(source.raw.toString('utf8').startsWith("@import url('"+source.url+"');"));}
const lockRaw=readFileSync(join(root,'frontend/package-lock.json'));assert.equal(gitBlob(lockRaw),LOCK,'Browser runtime lockfile changed');
const require=createRequire(join(root,'frontend/package.json')),lock=JSON.parse(lockRaw),{chromium}=require('playwright');
assert.equal(require('playwright/package.json').version,lock.packages['node_modules/playwright'].version);
assert.equal(require('playwright-core/package.json').version,lock.packages['node_modules/playwright-core'].version);
assert(!existsSync(output),'Diagnostic output must be new');mkdirSync(output,{recursive:true});
const report={schema_version:'retained-price-font-diagnostic-v1',status:'running',scope:'Synthetic text and controls using two exact public approved-UI CSS files. This is not the original NVDA screenshot, real data acceptance, Design acceptance, or publication approval.',approved_ui:UI,lock_blob:LOCK,node:process.version,expected_browser:'147.0.7727.15',playwright:require('playwright/package.json').version,network_contract:BROWSER_NETWORK_CONTRACT,css:sources.map(({raw,...source})=>({...source,bytes:raw.length,sha256:digest(raw)})),cases:[],network_denials:[],started_at:new Date().toISOString()};
const save=()=>{const raw=JSON.stringify(report,null,2)+'\n';assert(Buffer.byteLength(raw)<=BROWSER_LIMITS.reportBytes,'Diagnostic report exceeded 8 MiB');writeFileSync(join(output,'report.json'),raw);};
const markup=links=>'<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Blocked public font diagnostic</title>'+links+'<style>.leader-shell{padding:24px;width:800px;max-width:100%;background:#fafafa;color:#171717}.symbol-title h2{font-size:28px}.research-symbol-price strong{display:block;font-size:24px;margin:16px 0}#research-detail-tabs{display:flex;gap:16px}#research-detail-tabs button{padding:8px 16px;line-height:1.5}p{margin-top:24px}</style></head><body><main class="leader-shell"><div class="symbol-title"><h2 class="mono">TEST</h2></div><div class="research-symbol-price"><strong class="mono">$123.45</strong></div><div id="research-detail-tabs"><button role="tab" aria-selected="true">財務・機関</button><button role="tab" aria-selected="false">購入条件</button></div><p>Synthetic public-CSS diagnostic. Not the retained NVDA image or a data/publication acceptance.</p></main></body></html>';
let browser,server,timer,origin,requests=0,servedBytes=0,upgrades=0;const serverFailures=[];
async function runCase({name,initial='empty.html',action,verify}){
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ja-JP',serviceWorkers:'block',acceptDownloads:true});let page,closed=false;
  const gate=createBrowserNetworkGate({origin,getPage:()=>page,denials:report.network_denials,symbol:'diagnostic:'+name});
  const entry={name,scope:'synthetic diagnostic only',network:gate.evidence,request_failures:[]};report.cases.push(entry);
  context.on('requestfailed',request=>{
    const url=request.url();if(localBrowserUrl(url,origin))return;
    assert(entry.request_failures.length<64,'Diagnostic failure evidence exceeded bound');
    entry.request_failures.push({url,method:request.method(),resource_type:request.resourceType(),error:request.failure()?.errorText??null});
  });
  try{
    await context.route('**/*',gate.route);await context.routeWebSocket('**/*',gate.routeWebSocket);
    page=await context.newPage();page.setDefaultTimeout(8000);const session=await gate.attach(context,page);
    await page.goto(origin+'/screener/'+initial);
    if(action)entry.observation=await action(page,session,context,gate);
    await context.close();closed=true;
    assert.equal(gate.evidence.retention_failed,false);assert.equal(gate.evidence.successful_external_http.length,0);assert.equal(gate.evidence.successful_external_websocket.length,0);
    verify(gate,entry);entry.status='passed';save();
  }catch(error){entry.status='failed';entry.error=error.message;throw error;}
  finally{if(!closed)await context.close();}
}
const insertResource=(page,tag,url)=>page.evaluate(({tag,url})=>new Promise(resolve=>{
  const element=document.createElement(tag);element.onload=()=>resolve('loaded');element.onerror=()=>resolve('blocked');
  if(tag==='link'){element.rel='stylesheet';element.href=url;}else element.src=url;document.head.append(element);
}),{tag,url});
async function negative(name,action,reason,additional=()=>{}){
  await runCase({name,action,verify:(gate,entry)=>{
    assert.equal(gate.evidence.expected_blocked_stylesheets.length,0);
    assert.equal(gate.evidence.unexpected_attempts.length,1);
    const denied=gate.evidence.unexpected_attempts[0];assert.equal(denied.reason,reason);assert.equal(denied.blocked,true);
    assert.throws(()=>gate.assertClean(),/unexpected/);entry.production_gate_rejected=true;additional(denied,entry);
  }});
}
async function run(){
  server=createServer((request,response)=>{
    try{
      assert.equal(request.method,'GET');assert(++requests<=200,'Diagnostic request cap exceeded');
      const path=new URL(request.url,'http://127.0.0.1').pathname,source=sources.find(x=>x.served===path);let raw,type;
      if(source){raw=source.raw;type='text/css; charset=utf-8';}
      else if(path==='/screener/index.html'){raw=Buffer.from(markup(sources.map(x=>'<link rel="stylesheet" href="'+x.served+'">').join('')));type='text/html; charset=utf-8';}
      else if(path==='/screener/frame.html'){raw=Buffer.from(markup('<link rel="stylesheet" href="'+sources[0].served+'">'));type='text/html; charset=utf-8';}
      else if(path==='/screener/empty.html'){raw=Buffer.from(markup(''));type='text/html; charset=utf-8';}
      else{response.writeHead(404);response.end();return;}
      servedBytes+=raw.length;assert(servedBytes<=12*1024**2,'Diagnostic served-byte cap exceeded');
      response.writeHead(200,{'Content-Type':type,'Content-Length':raw.length,'Cache-Control':'no-store'});response.end(raw);
    }catch(error){if(serverFailures.length<10)serverFailures.push(error.message);response.writeHead(400);response.end();}
  });
  server.on('upgrade',(request,socket)=>{upgrades++;socket.destroy();});
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});report.browser=browser.version();assert.equal(report.browser,report.expected_browser,'Diagnostic must use the actual publisher Chromium runtime');
  await runCase({name:'exact-pinned-css-and-fallback',initial:'index.html',action:async(page,session)=>{
    const typography=await captureFallbackTypography(page,session),csv='symbol,price\nTEST,123.45\n';
    const pendingDownload=page.waitForEvent('download');
    const blobUrl=await page.evaluate(csv=>{
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),anchor=document.createElement('a');
      anchor.href=url;anchor.download='synthetic-font-probe.csv';document.body.append(anchor);anchor.click();anchor.remove();return url;
    },csv);
    const download=await pendingDownload,stream=await download.createReadStream();assert(stream,'Actual local Blob CSV download stream unavailable');
    const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;assert(size<=BROWSER_LIMITS.csvBytes);chunks.push(chunk);}
    const downloaded=Buffer.concat(chunks);assert.equal(downloaded.toString('utf8'),csv,'Local Blob CSV bytes changed');await page.evaluate(url=>URL.revokeObjectURL(url),blobUrl);
    const screenshot=await page.screenshot({fullPage:false});assert(screenshot.length<=BROWSER_LIMITS.screenshotBytes);
    writeFileSync(join(output,'synthetic-fallback.png'),screenshot,{flag:'wx'});
    return {typography,csv:{source:'actual browser Blob download using the production response observer',filename:download.suggestedFilename(),bytes:downloaded.length,sha256:digest(downloaded)},screenshot:{path:'synthetic-fallback.png',bytes:screenshot.length,sha256:digest(screenshot),scope:'synthetic diagnostic text/controls; not original retained NVDA screenshot'}};
  },verify:(gate,entry)=>{
    gate.assertClean();assert.equal(gate.evidence.expected_blocked_stylesheets.length,2);
    assert.deepEqual(gate.evidence.expected_blocked_stylesheets.map(x=>x.url).sort(),[...EXPECTED_BLOCKED_FONT_STYLESHEETS].sort());
    assert(gate.evidence.expected_blocked_stylesheets.every(x=>x.blocked&&x.metadata_complete&&x.current_local_main_frame&&x.method==='GET'&&x.resource_type==='stylesheet'&&x.navigation===false));
    assert.equal(entry.request_failures.length,2);assert(entry.request_failures.every(x=>x.error==='net::ERR_FAILED'),'Chromium did not report actual aborts');
  }});
  const font=EXPECTED_BLOCKED_FONT_STYLESHEETS[0];
  await negative('changed-query',page=>insertResource(page,'link',font+'&changed=1'),'unapproved-url',x=>assert.equal(x.resource_type,'stylesheet'));
  await negative('other-same-host-font',page=>insertResource(page,'link','https://fonts.googleapis.com/css2?family=Other&display=swap'),'unapproved-url');
  await negative('fetch-exact-url',page=>page.evaluate(url=>fetch(url).then(()=>false,()=>true),font),'unexpected-resource-type',x=>{assert.equal(x.method,'GET');assert.equal(x.resource_type,'fetch');});
  await negative('post-exact-url',page=>page.evaluate(url=>fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},body:'diagnostic'}).then(()=>false,()=>true),font),'unexpected-method',x=>assert.equal(x.method,'POST'));
  await negative('head-exact-url',page=>page.evaluate(url=>fetch(url,{method:'HEAD'}).then(()=>false,()=>true),font),'unexpected-method',x=>assert.equal(x.method,'HEAD'));
  await negative('image-exact-url',page=>insertResource(page,'img',font),'unexpected-resource-type',x=>assert.equal(x.resource_type,'image'));
  await negative('script-exact-url',page=>insertResource(page,'script',font),'unexpected-resource-type',x=>assert.equal(x.resource_type,'script'));
  await negative('local-child-frame',page=>page.evaluate(()=>new Promise(resolve=>{
    const frame=document.createElement('iframe');frame.onload=()=>resolve(true);frame.src='/screener/frame.html';document.body.append(frame);
  })),'other-or-nonlocal-frame',x=>{assert.equal(x.resource_type,'stylesheet');assert.equal(x.current_local_main_frame,false);assert.equal(x.metadata_complete,true);});
  await negative('other-page-in-context',async(page,session,context)=>{
    const other=await context.newPage();await other.goto(origin+'/screener/frame.html');return true;
  },'other-or-nonlocal-frame',x=>assert.equal(x.current_local_main_frame,false));
  await negative('main-frame-navigation',page=>page.goto(font).then(()=>false,()=>true),'unexpected-resource-type',x=>{assert.equal(x.resource_type,'document');assert.equal(x.navigation,true);});
  const socketAction=url=>page=>page.evaluate(url=>new Promise(resolve=>{
    const socket=new WebSocket(url);socket.addEventListener('close',()=>resolve('closed'));socket.addEventListener('error',()=>resolve('error'));
  }),url);
  await negative('external-websocket',socketAction('wss://example.invalid/font-diagnostic'),'websocket-attempt');
  await negative('local-websocket',socketAction(origin.replace('http:','ws:')+'/socket'),'websocket-attempt');
  await runCase({name:'repeated-exact-imports',initial:'index.html',action:page=>page.reload().then(()=>true),verify:(gate,entry)=>{
    assert.equal(gate.evidence.expected_blocked_stylesheets.length,2);assert.equal(gate.evidence.unexpected_attempts.length,2);
    assert(gate.evidence.unexpected_attempts.every(x=>x.reason==='repeated-font-attempt'&&x.blocked&&x.current_local_main_frame));
    assert.equal(entry.request_failures.length,4);assert.throws(()=>gate.assertClean(),/unexpected/);entry.production_gate_rejected=true;
  }});
  report.server={requests,served_bytes:servedBytes,websocket_upgrades:upgrades,failures:serverFailures};assert.equal(upgrades,0,'A WebSocket reached the local server');assert.equal(serverFailures.length,0);
  report.status='passed';
}
save();
try{await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Finite diagnostic exceeded 120 seconds')),120000);})]);}
catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{
  clearTimeout(timer);
  try{await browser?.close();}catch(error){report.status='failed';report.cleanup_error=error.message;process.exitCode=1;}
  try{if(server)await new Promise((ok,bad)=>{server.close(error=>error?bad(error):ok());server.closeAllConnections();});}catch(error){report.status='failed';report.cleanup_error=error.message;process.exitCode=1;}
  report.finished_at=new Date().toISOString();save();
}
console.log(JSON.stringify({status:report.status,cases:report.cases.length,scope:report.scope}));

if(report.status==='passed'){
  const image=readFileSync(join(output,'synthetic-fallback.png'));
  assert(image.length<=256*1024&&image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Synthetic image bound/signature');
  const record=JSON.stringify({schema_version:'synthetic-font-image-v1',scope:'New synthetic TEST/$123.45 fixture using pinned public CSS; no stock source, portfolio or retained image input',bytes:image.length,sha256:digest(image),base64:image.toString('base64')});
  assert(Buffer.byteLength(record)<=512*1024,'Synthetic image record bound');console.log(record);
}
