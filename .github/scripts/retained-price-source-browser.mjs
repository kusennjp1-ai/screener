// Finite real-data acceptance for the authenticated Oct6 source after ordinary
// carry/composition, observed on the approved daily brief's stock screen
// (#/brief/stock/SYMBOL). No fixtures, browser clock overrides, or publication writes.
// An approved UI without that screen (the retired research workspace) fails closed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createReadStream,existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {dirname,extname,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {publisherToolingBoundary,publisherToolingReceipt,verifyPublisherToolingCheckout,consumePublisherToolingBrowserProof} from './retained-price-publisher-tooling.mjs';

export const BROWSER_LIMITS=Object.freeze({milliseconds:360000,reportBytes:8*1024**2,screenshotBytes:8*1024**2,fileBytes:64*1024**2,servedBytes:512*1024**2,requests:4000});
const TARGET='2026-10-06',BASE='/screener/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const equal=(a,b,message)=>assert.deepEqual(a,b,message);
function bytes(path,cap=BROWSER_LIMITS.fileBytes){const stat=lstatSync(path);assert(stat.isFile()&&!stat.isSymbolicLink()&&realpathSync(path)===resolve(path)&&stat.size<=cap,'Unsafe or oversized proof input: '+path);return readFileSync(path);}
const read=path=>JSON.parse(bytes(path));
const regularRoot=path=>{assert.equal(realpathSync(path),resolve(path),'Linked root');assert(lstatSync(path).isDirectory(),'Missing directory');return path;};

export function localBrowserUrl(value,origin){try{const url=new URL(value);return url.origin===origin&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password;}catch{return false;}}
// Exact approved-UI imports remain aborted. This is classification of denied
// attempts, never permission to contact a font host or change the approved UI.
export const EXPECTED_BLOCKED_FONT_STYLESHEETS=Object.freeze([
  'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap',
]);
export const BROWSER_NETWORK_LIMITS=Object.freeze({events:64,fieldChars:2048,bytes:256*1024});
export const BROWSER_NETWORK_CONTRACT='Every external HTTP request is aborted and every WebSocket is closed without connecting. Require zero unexpected attempts and zero successful external HTTP/WebSocket accesses; separately retain at most one exact approved blocked font stylesheet attempt per URL per case. network_denials retains all denied URL evidence.';

export function browserRequestMetadata(request,page,origin){
  const value={url:null,method:null,resource_type:null,navigation:null,frame_url:null,page_url:null,current_local_main_frame:false,metadata_complete:false};
  try{
    value.url=request.url();value.method=request.method();value.resource_type=request.resourceType();value.navigation=request.isNavigationRequest();
    const frame=request.frame();value.frame_url=frame.url();value.page_url=page.url();
    value.current_local_main_frame=frame===page.mainFrame()&&frame.page()===page&&frame.parentFrame()===null&&value.frame_url===value.page_url&&localBrowserUrl(value.frame_url,origin)&&localBrowserUrl(value.page_url,origin);
    value.metadata_complete=[value.url,value.method,value.resource_type,value.frame_url,value.page_url].every(x=>typeof x==='string'&&x.length>0&&x.length<=BROWSER_NETWORK_LIMITS.fieldChars)&&typeof value.navigation==='boolean';
  }catch{/* Missing/throwing frame or request metadata is an unexpected attempt. */}
  return value;
}
export function classifyBlockedFontAttempt(value,seen){
  if(!value?.metadata_complete)return 'missing-or-invalid-metadata';
  if(!EXPECTED_BLOCKED_FONT_STYLESHEETS.includes(value.url))return 'unapproved-url';
  if(value.method!=='GET')return 'unexpected-method';
  if(value.resource_type!=='stylesheet')return 'unexpected-resource-type';
  if(value.navigation!==false)return 'navigation-request';
  if(value.current_local_main_frame!==true)return 'other-or-nonlocal-frame';
  if(seen.has(value.url))return 'repeated-font-attempt';
  return 'expected-blocked-font-stylesheet';
}
export function createBrowserNetworkGate({origin,getPage,denials,symbol}){
  const evidence={symbol,contract:BROWSER_NETWORK_CONTRACT,expected_blocked_stylesheets:[],unexpected_attempts:[],successful_external_http:[],successful_external_websocket:[],limits:BROWSER_NETWORK_LIMITS,retention_failed:false,retained_bytes:0,events:0,dropped_events:0};
  const seen=new Set(),sockets=new Map();let retainedBytes=0,pending=0;
  const bounded=value=>{
    const result={};for(const [key,item]of Object.entries(value)){
      if(typeof item==='string'&&item.length>BROWSER_NETWORK_LIMITS.fieldChars){evidence.retention_failed=true;result[key]=item.slice(0,BROWSER_NETWORK_LIMITS.fieldChars);result[key+'_truncated']=true;}
      else if(item===null||['string','boolean'].includes(typeof item)||(typeof item==='number'&&Number.isFinite(item)))result[key]=item;
      else {evidence.retention_failed=true;result[key]=null;}
    }return result;
  };
  const retain=(kind,value,denial=false)=>{
    evidence.events++;const record=bounded(value),raw=JSON.stringify(record),url=record.url;
    const size=Buffer.byteLength(raw)+(denial?Buffer.byteLength(typeof url==='string'?url:'[unavailable URL]'):0);
    if(evidence.events>BROWSER_NETWORK_LIMITS.events||retainedBytes+size>BROWSER_NETWORK_LIMITS.bytes){evidence.retention_failed=true;evidence.dropped_events++;return;}
    retainedBytes+=size;evidence.retained_bytes=retainedBytes;evidence[kind].push(record);if(denial)denials.push(typeof url==='string'?url:'[unavailable URL]');
  };
  const readUrl=value=>{try{const url=value.url();return typeof url==='string'?url:null;}catch{return null;}};
  const route=async route=>{
    let request;try{request=route.request();}catch{}const url=readUrl(request);
    if(localBrowserUrl(url,origin))return route.continue();
    pending++;let page;try{page=getPage();}catch{}const metadata=browserRequestMetadata(request,page,origin);let reason=classifyBlockedFontAttempt(metadata,seen),blocked=false;
    if(EXPECTED_BLOCKED_FONT_STYLESHEETS.includes(metadata.url))seen.add(metadata.url);
    try{await route.abort('failed');blocked=true;}catch{reason='abort-failed';}
    finally{retain(reason==='expected-blocked-font-stylesheet'&&blocked?'expected_blocked_stylesheets':'unexpected_attempts',{...metadata,reason,blocked},true);pending--;}
  };
  const routeWebSocket=async socket=>{
    pending++;const url=readUrl(socket);let blocked=false;
    try{await socket.close();blocked=true;}catch{}
    finally{retain('unexpected_attempts',{url,resource_type:'websocket',reason:'websocket-attempt',blocked},true);pending--;}
  };
  const observeHttpResponse=response=>{
    const url=readUrl(response);if(localBrowserUrl(url,origin))return;
    // Blob/data responses are browser-owned bytes, not successful HTTP access.
    // This does not change the request route: every nonlocal routed request aborts.
    try{const protocol=new URL(url).protocol;if(protocol==='blob:'||protocol==='data:')return;}catch{}
    let status=null;try{status=response.status();}catch{}
    retain('successful_external_http',{url,status,reason:'external-http-response'});
  };
  const observeWebSocketCreated=event=>{
    if(sockets.size>=BROWSER_NETWORK_LIMITS.events||typeof event.requestId!=='string'||event.requestId.length>BROWSER_NETWORK_LIMITS.fieldChars||typeof event.url!=='string'||event.url.length>BROWSER_NETWORK_LIMITS.fieldChars){evidence.retention_failed=true;return;}
    sockets.set(event.requestId,event.url);
  };
  const observeWebSocketHandshake=event=>{
    const url=sockets.get(event.requestId);
    // A response proves external access even when the upgrade was rejected.
    if(!url){retain('unexpected_attempts',{url:null,reason:'websocket-handshake-without-metadata'});return;}
    if(!localBrowserUrl(url,origin))retain('successful_external_websocket',{url,status:event.response?.status??null,reason:'external-websocket-handshake-response'});
  };
  const attach=async(context,page)=>{
    context.on('response',observeHttpResponse);
    const session=await context.newCDPSession(page);
    session.on('Network.webSocketCreated',observeWebSocketCreated);
    session.on('Network.webSocketHandshakeResponseReceived',observeWebSocketHandshake);
    await session.send('Network.enable');return session;
  };
  const assertClean=()=>{
    assert.equal(pending,0,'Unsettled external abort or WebSocket close');
    assert.equal(evidence.retention_failed,false,'Network evidence exceeded its bounded retention');
    assert.equal(evidence.unexpected_attempts.length,0,'Browser attempted unexpected external network or WebSocket');
    assert.equal(evidence.successful_external_http.length,0,'Browser received an external HTTP response');
    assert.equal(evidence.successful_external_websocket.length,0,'Browser received an external WebSocket handshake response');
  };
  return {evidence,route,routeWebSocket,attach,assertClean,observeHttpResponse,observeWebSocketCreated,observeWebSocketHandshake};
}
// The brief stock screen at desktop width: symbol, price and the selected chart period.
export const BRIEF_SYMBOL_SELECTOR='.brief-stockhead h2 > span:first-child',BRIEF_PRICE_SELECTOR='.brief-stockhead h2 > span:nth-child(2)';
export const FALLBACK_FONT_SELECTORS=Object.freeze([BRIEF_SYMBOL_SELECTOR,BRIEF_PRICE_SELECTOR,'.brief-periods button[aria-pressed="true"]']);

// Source markers (in the git-verified approved checkout) of the one screen this proof drives.
// Every marker is present in both brief-carrying approved UIs (c5d1884 and the brief-only app).
export const BRIEF_UI_MARKERS=Object.freeze([
  ['src/static/StaticAppShell.jsx','path="/brief/*"'],
  ['src/static/brief/BriefApp.jsx',String.raw`/^\/brief\/stock\/([^/]+)$/`],
  ['src/static/brief/BriefApp.jsx','className="brief-stockhead"'],
  ['src/static/brief/PriceChart.jsx','data-testid="brief-price-chart"'],
  ['src/static/brief/priceChart.js','足チャート（${bars[0].date}〜${bars[n - 1].date}）'],
  ['src/static/brief/StockView.jsx','brief-chartcard'],
  ['src/static/brief/StockView.jsx','の日足は未取得'],
  ['tools/design-static-assets.mjs','export async function createDesignAssetObserver'],
].map(Object.freeze));
const RESEARCH_WORKSPACE_PAGE='src/static/pages/ResearchPage.jsx';
/** `read(path)` returns the approved checkout's text for a frontend-relative path, or null when absent. */
export function detectApprovedUi(read){
  const missing=BRIEF_UI_MARKERS.filter(([path,marker])=>{const text=read(path);return typeof text!=='string'||!text.includes(marker);}).map(([path,marker])=>`${path}: ${marker}`);
  const workspace=typeof read(RESEARCH_WORKSPACE_PAGE)==='string';
  return {kind:missing.length?(workspace?'research-workspace':'unknown'):'brief',retired_workspace_present:workspace,missing};
}
export function requireBriefUi(detection,sha){
  if(detection?.kind==='brief'&&Array.isArray(detection.missing)&&detection.missing.length===0)return detection;
  const what=detection?.kind==='research-workspace'?'the retired research workspace':'not a recognised daily brief';
  throw Error(`Approved UI ${sha} is ${what} (missing ${(detection?.missing||['detection']).join('; ')}). The finite price browser proof verifies only the brief stock screen #/brief/stock/SYMBOL and never guesses another UI's selectors; approve a daily-brief UI before publishing a finite price repair.`);
}
export const briefStockUrl=(pageUrl,symbol)=>`${pageUrl}#/brief/stock/${encodeURIComponent(symbol)}`;
// The stock screen opens on its 6-month daily range (130 sessions).
export const BRIEF_CHART_SESSIONS=130;
const BRIEF_CHART_LABEL=/^(\S+) の(日|週)足チャート（(\d{4}-\d{2}-\d{2})〜(\d{4}-\d{2}-\d{2})）。/;
export function parseBriefChartLabel(label){
  const match=typeof label==='string'&&label.length<=4096?label.match(BRIEF_CHART_LABEL):null;
  return match?{symbol:match[1],interval:match[2]==='日'?'day':'week',first:match[3],last:match[4]}:null;
}
/**
 * The rendered chart against the chart payload the browser actually received: same symbol, the
 * daily range's first and last sessions, one candle per shown session. A repaired row's last candle
 * is the repaired session; retained older history must end before it.
 */
export function requireBriefChart({label,candles},{symbol,bars,target,retained=false}){
  const parsed=parseBriefChartLabel(label);assert(parsed,'Brief price chart has no readable label');
  assert.equal(parsed.symbol,symbol,'Brief chart shows another symbol');assert.equal(parsed.interval,'day','Brief chart is not the daily chart');
  assert(Array.isArray(bars)&&bars.length>0&&bars.every(bar=>/^\d{4}-\d\d-\d\d$/.test(bar?.date)),'Served chart has no dated bars');
  const shown=Math.min(BRIEF_CHART_SESSIONS,bars.length);
  assert.equal(parsed.last,bars.at(-1).date,'Brief chart last candle differs from the served chart');
  assert.equal(parsed.first,bars.at(-shown).date,'Brief chart range differs from the served chart');
  assert.equal(candles,shown,'Brief chart candles differ from the served sessions');
  if(retained)assert(parsed.last<target,'Older retained history was presented as the repaired session');
  else assert.equal(parsed.last,target,'Brief chart last candle is not the repaired session');
  return {...parsed,candles};
}
export const retainedHistoryNote=(final,target)=>`日足は ${final} までです（分析基準日 ${target} の日足は未取得）`;
export function requireFallbackFontSample(sample){
  assert(sample&&typeof sample.selector==='string'&&sample.selector.length<=128,'Missing scoped font sample');
  const box=sample.geometry;
  assert(box&&['x','y','width','height','viewport_width','client_width','scroll_width'].every(key=>Number.isFinite(box[key]))&&box.width>0&&box.height>0&&box.viewport_width>0&&box.client_width>=0&&box.scroll_width>=0,'Invalid scoped text geometry');
  if(sample.visible_in_viewport)assert(box.x>=-1&&box.x+box.width<=box.viewport_width+1&&(!box.client_width||box.scroll_width<=box.client_width+1),'Scoped visible fallback text is horizontally clipped');
  assert(typeof sample.computed_font_family==='string'&&sample.computed_font_family.length<=512,'Unbounded requested font family');
  assert(Array.isArray(sample.platform_fonts)&&sample.platform_fonts.length>0&&sample.platform_fonts.length<=16,'Missing/unbounded actual selected platform fonts');
  for(const font of sample.platform_fonts)assert(typeof font.familyName==='string'&&font.familyName.length>0&&font.familyName.length<=128&&font.isCustomFont===false&&Number.isSafeInteger(font.glyphCount)&&font.glyphCount>0,'Selected text did not use an actual platform fallback font');
  return sample;
}
export async function captureFallbackTypography(page,session){
  await page.evaluate(()=>document.fonts.ready);
  await session.send('DOM.enable');await session.send('CSS.enable');
  const {root}=await session.send('DOM.getDocument',{depth:0});const samples=[];
  for(const selector of FALLBACK_FONT_SELECTORS){
    const element=page.locator(selector);assert.equal(await element.count(),1,'Scoped font node must be unique: '+selector);
    const visual=await element.evaluate(node=>{
      const box=node.getBoundingClientRect(),style=getComputedStyle(node);
      return {computed_font_family:style.fontFamily,geometry:{x:box.x,y:box.y,width:box.width,height:box.height,viewport_width:innerWidth,client_width:node.clientWidth,scroll_width:node.scrollWidth},visible_in_viewport:box.bottom>0&&box.top<innerHeight};
    });
    const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector});assert(nodeId,'Scoped font node unavailable to Chromium');
    const {fonts}=await session.send('CSS.getPlatformFontsForNode',{nodeId});
    samples.push(requireFallbackFontSample({selector,...visual,platform_fonts:fonts.map(({familyName,isCustomFont,glyphCount})=>({familyName,isCustomFont,glyphCount}))}));
  }
  return {scope:'Three brief stock-screen text nodes (symbol, price, selected chart period); actual Chromium-selected platform fonts and horizontal fit only, not Design acceptance',selection_source:'CDP CSS.getPlatformFontsForNode; computed font-family is requested CSS, not selection proof',samples};
}

export function requireActualClock(value,browserNow,hostNow=Date.now()){
  const parsed=typeof value==='string'?Date.parse(value):value;
  assert(Number.isFinite(parsed)&&Number.isFinite(browserNow)&&Math.abs(hostNow-browserNow)<30000&&Math.abs(parsed-browserNow)<90000,'Browser/report clock is not the actual current clock');return parsed;
}
export function selectBrowserCases(rows,prepared){
  assert(Array.isArray(rows)&&rows.length===5901&&new Set(rows.map(r=>r.symbol)).size===rows.length,'Incomplete/duplicate composed research universe');
  assert(prepared?.target_as_of_date===TARGET,'Unexpected replay target');const map=new Map(rows.map(row=>[row.symbol,row]));
  const selected=[{symbol:'NVDA',category:'ordinary-usd'},{symbol:'FUTU',category:'native-hkd-annual'},{symbol:'ALH',category:'partial-annual-history'}];
  const retained=prepared.patches?.filter(p=>p.row&&map.has(p.symbol)).sort((a,b)=>a.symbol.localeCompare(b.symbol)).find(p=>p.symbol==='LPSN');
  assert(retained,'Required LPSN retained older history is unavailable');
  const undated=prepared.row_quarantines?.filter(p=>map.has(p.symbol)).sort((a,b)=>a.symbol.localeCompare(b.symbol))[0];assert(undated,'Required undated quarantine is unavailable');
  selected.push({symbol:retained.symbol,category:'retained-older-history',patch:retained},{symbol:undated.symbol,category:'undated-quarantine'});
  assert.equal(new Set(selected.map(x=>x.symbol)).size,5,'Browser cases overlap');
  return selected.map(item=>{const summary=map.get(item.symbol);assert(summary&&summary.as_of_date===TARGET&&summary.research_detail_path,item.symbol+': missing target row/detail');return {...item,summary};});
}
export function requireFinancialCategory(row,category,nativeContract){
  const history=row.financial_history,currency=history?.annual_currency||history?.currency,annual=history?.annual;
  assert(history?.symbol===row.symbol&&history.as_of_date===TARGET&&history.status==='available'&&Array.isArray(annual),'Missing carried source history');
  assert(history.basis==='reported_diluted_eps'&&typeof history.source==='string'&&history.source.trim()&&Number.isFinite(Date.parse(history.retrieved_at)),'Missing original source identity/clock');
  assert(annual.every((p,index)=>/^\d{4}-\d\d-\d\d$/.test(p.end)&&p.end<=TARGET&&(!index||p.end>annual[index-1].end)&&(p.eps===null||Number.isFinite(p.eps))),'Malformed original annual observations');
  const numeric=annual.filter(p=>Number.isFinite(p.eps)).length;
  if(category==='ordinary-usd')assert(currency==='USD'&&numeric>=4,'Ordinary USD annual source unavailable');
  else if(category==='native-hkd-annual')assert(currency==='HKD'&&nativeContract(history,row.symbol)&&numeric>=4,'Native receipt-bound HKD source unavailable');
  else if(category==='partial-annual-history')assert(numeric>0&&numeric<4,'Partial annual EPS source unavailable');
  else throw Error('Unexpected financial case');
  return {currency,annual,numeric_periods:numeric,annual_observed_at:history.annual_source?.observed_at||history.retrieved_at};
}
export function inspectHistoryExpiry(row,now,historyDeadlines,currentHistory,nativeSchema){
  const history=row.financial_history,current=currentHistory(history,row.symbol,TARGET,now,row),deadlines=historyDeadlines(history);
  const observed=history.schema_version===nativeSchema?{annual:history.annual_source?.observed_at,quarterly:history.quarterly_retrieved_at}:{annual:history.retrieved_at,quarterly:history.retrieved_at};
  const components={};
  for(const name of ['annual','quarterly']){
    const stamp=typeof observed[name]==='string'?Date.parse(observed[name]):NaN,expiry=stamp+72*3600000,sourcePeriods=history[name]?.length||0;
    if(Number.isFinite(expiry))assert(deadlines.includes(expiry),'Component expiry differs from approved source clock');
    const expired=sourcePeriods>0&&Number.isFinite(expiry)&&expiry<now;
    if(expired){assert.equal(current[name].length,0,'Expired '+name+' source history became current');if(name==='annual')assert.equal(current.annualGrowth,null);else {assert.equal(current.epsYoY,null);assert.equal(current.salesYoY,null);}}
    components[name]={observed_at:observed[name]||null,expires_at:Number.isFinite(expiry)?new Date(expiry).toISOString():null,source_periods:sourcePeriods,current_periods:current[name].length,expired};
  }
  return {evaluated_at:new Date(now).toISOString(),components,expired_components:Object.values(components).filter(value=>value.expired).length};
}
export function interruptRejection(reject,events=process){
  const handlers=Object.fromEntries(['SIGTERM','SIGINT'].map(signal=>[signal,()=>reject(Error('Browser proof interrupted: '+signal))]));
  for(const [signal,handler] of Object.entries(handlers))events.on(signal,handler);
  return ()=>{for(const [signal,handler] of Object.entries(handlers))events.removeListener(signal,handler);};
}
export function requireUnknownPrice(row){
  assert.equal(row.as_of_date,TARGET);for(const key of ['current_price','price_change_1d','adv_usd','rs_rating','se_pivot_price','vcp_pivot'])assert.equal(row[key],null,row.symbol+': revived '+key);
  assert.notEqual(row.technical_audit?.valid,true,'Quarantined price became verified');
}
export function requireCarryBinding(publication,state,carryRaw){
  assert.equal(sha(carryRaw),state.carry.projectionSha256,'Actual carry projection changed');const carry=JSON.parse(carryRaw),receipt=state.financialPrepared.receipt,previous=state.live.financialRelease;
  assert(receipt?.mode==='carry'&&receipt.previous_publication_identity===state.live.identity,'Missing actual ordinary carry receipt');
  assert.equal(publication.financial_generation,receipt.financial_generation,'Composed generation differs from carry receipt');
  assert.equal(publication.financial_generation,carry.financial_generation,'Composed generation differs from actual carry projection');
  assert.equal(sha(JSON.stringify(receipt)),publication.financial_release.sha256,'Prepared carry receipt differs from composed reference');
  assert.equal(receipt.evaluation_projection.sha256,sha(carryRaw),'Receipt does not bind actual carry bytes');
  assert.equal(publication.financial_lineage_sha256,previous.lineage_sha256,'Carry changed source lineage');
  assert.equal(carry.bindings.source_lineage_sha256,previous.lineage_sha256,'Carry projection changed lineage');
  assert.equal(carry.bindings.previous_publication_identity,state.live.identity,'Carry predecessor changed');
  const original=JSON.parse(carry.source_projection_json);assert.equal(sha(carry.source_projection_json),previous.source_projection.sha256,'Original source projection changed');
  assert.equal(carry.bindings.source_projection_sha256,previous.source_projection.sha256,'Carry source binding changed');
  assert.equal(carry.source_financial_generation,original.financial_generation,'Original source generation changed');
  return {financial_generation:carry.financial_generation,source_financial_generation:carry.source_financial_generation,previous_financial_generation:previous.financial_generation};
}
export async function startReleaseServer(root){
  regularRoot(root);let requests=0,servedBytes=0;const failures=[];
  const server=createServer((request,response)=>{
    try{
      assert(['GET','HEAD'].includes(request.method),'Unexpected method');assert(++requests<=BROWSER_LIMITS.requests,'Request bound exhausted');
      const url=new URL(request.url,'http://127.0.0.1');assert(url.pathname.startsWith(BASE),'Unexpected URL base');
      const relative=decodeURIComponent(url.pathname.slice(BASE.length))||'index.html';assert(!relative.includes('\\')&&!relative.split('/').some(p=>!p||p==='.'||p==='..'),'Unsafe URL path');
      const file=resolve(root,relative);assert(file.startsWith(root+sep),'Path escapes release');
      if(!existsSync(file)){response.writeHead(404);response.end();return;}
      assert.equal(realpathSync(file),file,'Linked release asset');const stat=statSync(file);assert(stat.isFile()&&stat.size<=BROWSER_LIMITS.fileBytes,'Unsafe/oversized browser asset');
      servedBytes+=request.method==='HEAD'?0:stat.size;assert(servedBytes<=BROWSER_LIMITS.servedBytes,'Browser byte bound exhausted');
      const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}[extname(file)]||'application/octet-stream';
      response.writeHead(200,{'Content-Type':type,'Content-Length':stat.size,'Cache-Control':'no-cache'});
      if(request.method==='HEAD')response.end();else createReadStream(file).on('error',()=>response.destroy()).pipe(response);
    }catch(error){failures.push(error.message);response.writeHead(400);response.end();}
  });
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  return {origin:`http://127.0.0.1:${server.address().port}`,stats:()=>({requests,served_bytes:servedBytes,failures}),close:()=>new Promise((ok,bad)=>{server.close(error=>error?bad(error):ok());server.closeAllConnections();})};
}
async function loadApprovedFrontend(frontend,expected,onDetect){
  regularRoot(frontend);const repository=dirname(frontend),git=(...args)=>execFileSync('git',['-C',repository,...args],{encoding:'utf8',maxBuffer:16*1024**2}).trim();
  assert.equal(git('rev-parse','HEAD'),expected.sha,'Consumer checkout is not exact approved UI');assert.equal(git('rev-parse','HEAD:frontend'),expected.frontend_tree,'Approved frontend tree changed');
  verifyPublisherToolingCheckout(frontend,{amended:true});
  // Decide which UI this is from its own sources before importing or driving anything.
  const detection=detectApprovedUi(path=>{const file=join(frontend,path);return existsSync(file)?bytes(file,4*1024**2).toString('utf8'):null;});
  onDetect(detection);const ui=requireBriefUi(detection,expected.sha);
  const load=path=>import(pathToFileURL(join(frontend,path)).href);
  const [observer,financial,history,position,transport]=await Promise.all(['tools/design-static-assets.mjs','src/static/financialCurrent.js','src/static/financialHistory.js','src/static/positionGeometry.js','src/static/researchTransport.js'].map(load));
  const require=createRequire(join(frontend,'package.json'));return {...observer,...financial,...history,...position,...transport,ui,chromium:require('playwright').chromium};
}
// Waits until the brief's chart card settles: a labelled chart, or a final placeholder.
const settledChart=page=>page.waitForFunction(()=>{
  const card=document.querySelector('.brief-right .brief-chartcard');if(!card)return null;
  const chart=card.querySelector('[data-testid="brief-price-chart"][aria-label]');
  if(chart)return {state:'chart',label:chart.getAttribute('aria-label'),candles:chart.querySelectorAll('svg rect.bc-up, svg rect.bc-down').length,note:card.querySelector('.brief-asof')?.textContent||null};
  const text=card.querySelector('.brief-chart-placeholder')?.textContent||'';
  return /取得できません|未配信/.test(text)?{state:'placeholder',text,note:card.querySelector('.brief-asof')?.textContent||null}:null;
}).then(handle=>handle.jsonValue());
export async function inspectCase({browser,server,assets,model,item,generation,output,network,networkCases}){
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ja-JP',serviceWorkers:'block'});
  let page,closed=false;const gate=createBrowserNetworkGate({origin:server.origin,getPage:()=>page,denials:network,symbol:item.symbol});networkCases.push(gate.evidence);
  let session;const errors=[];
  try{
    await context.route('**/*',gate.route);await context.routeWebSocket('**/*',gate.routeWebSocket);
    page=await context.newPage();session=await gate.attach(context,page);page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(error.message));
    const currentUrl=server.origin+BASE,staticUrl=path=>new URL('static-data/'+path,currentUrl).href;
    const bootstrap=Promise.all([page.waitForResponse(r=>r.url()===staticUrl('manifest.json')),page.waitForResponse(r=>r.url()===new URL('publication.json',currentUrl).href)]);
    const go=()=>page.goto(briefStockUrl(currentUrl,item.symbol));
    const result={symbol:item.symbol,category:item.category,as_of_date:TARGET,screen:'#/brief/stock/'+item.symbol};
    // The chart and detail the brief actually received, decoded through the publication's own transport.
    let chartAsset=null,detailAsset=null;
    if(item.category==='undated-quarantine')await go();
    else if(item.category==='retained-older-history'){assert(item.summary.chart_path,'Retained chart path unavailable');chartAsset=await assets.observeJson(page,item.summary.chart_path,go);}
    else{assert(item.summary.chart_path,item.symbol+': repaired chart path unavailable');chartAsset=await assets.observeJson(page,item.summary.chart_path,async()=>{detailAsset=await assets.observeJson(page,item.summary.research_detail_path,go);});}
    const [manifestResponse,publicationResponse]=await bootstrap;await assets.assertBrowserBootstrap(manifestResponse,publicationResponse);
    await page.waitForFunction(([selector,symbol])=>document.querySelector(selector)?.textContent.trim()===symbol,[BRIEF_SYMBOL_SELECTOR,item.symbol]);
    const price=(await page.locator(BRIEF_PRICE_SELECTOR).textContent()).trim(),chart=await settledChart(page);
    if(item.category==='retained-older-history'||item.category==='undated-quarantine'){
      requireUnknownPrice(item.summary);assert.equal(price,model.money(null),'UI revived quarantined price');
      if(chartAsset){const {verifyRetainedChart}=await import('./oct6-retained-price-rehearsal.mjs');verifyRetainedChart(chartAsset.value,item.patch,TARGET);
        const final=chartAsset.value.bars.at(-1).date;assert(final<TARGET,'Retained history was relabeled current');
        // Older bars may be drawn only with their own last session and an explicit as-of note, or refused.
        if(chart.state==='chart'){result.retained_history={observation:chartAsset.observation,final_bar:final,shown_as:'labelled-older-history',chart:requireBriefChart(chart,{symbol:item.symbol,bars:chartAsset.value.bars,target:TARGET,retained:true})};
          assert(chart.note?.includes(retainedHistoryNote(final,TARGET)),'Older bars shown without their as-of session');}
        else{assert.match(chart.text,/日足チャートを取得できません/,'Retained chart neither labelled nor refused');result.retained_history={observation:chartAsset.observation,final_bar:final,shown_as:'refused',current_chart_rejected:true};}
      }else{assert.equal(item.summary.chart_path,null,'Undated row gained a chart');assert.equal(chart.state,'placeholder','Undated row shows a chart');assert.match(chart.text,/この銘柄の日足チャートは未配信です。/,'Undated chart placeholder missing');result.undated={current_price:null,chart_path:null};}
    }else{
      assert(Number.isFinite(item.summary.current_price)&&item.summary.technical_audit?.as_of_date===TARGET,'Ordinary case lacks Oct6 price evidence');
      const served=chartAsset.value;assert(served.symbol===item.symbol&&served.as_of_date===TARGET&&!served.retained_price_history,'Served chart is not the repaired session');
      assert.equal(chart.state,'chart','Repaired chart not drawn');assert.equal(chart.note,null,'Repaired session labelled as older history');
      result.chart={...requireBriefChart(chart,{symbol:item.symbol,bars:served.bars,target:TARGET}),observation:chartAsset.observation};
      assert.equal(price,model.money(item.summary.current_price),'Brief price differs from the repaired row');result.price=price;
      const loaded=detailAsset;
      assert(loaded.value.symbol===item.symbol&&loaded.value.as_of_date===TARGET&&loaded.value.financial_current?.t===item.summary.financial_current?.t,'Browser detail/list generation mismatch');
      const browserNow=await page.evaluate(()=>Date.now()),now=requireActualClock(browserNow,browserNow);
      const merged=model.mergeFinancialDetail(item.summary,loaded.value,{now,asOfDate:TARGET,generation,detailGeneration:generation,expectedDetailPath:item.summary.research_detail_path,detailPath:item.summary.research_detail_path});
      result.source=requireFinancialCategory(merged,item.category,model.nativeAnnualHistoryContract);result.expiry=inspectHistoryExpiry(merged,now,model.financialHistoryDeadlines,model.currentFinancialHistory,model.NATIVE_ANNUAL_SCHEMA);
      result.detail=loaded.observation;
    }
    result.typography=await captureFallbackTypography(page,session);
    const screen=await page.screenshot({fullPage:false});assert(screen.length<=BROWSER_LIMITS.screenshotBytes,'Screenshot exceeds bound');writeFileSync(join(output,item.symbol+'.png'),screen,{flag:'wx'});result.screenshot={path:item.symbol+'.png',bytes:screen.length,sha256:sha(screen),scope:'one viewport; DOM and served-chart assertions cover additional fields'};
    await context.close();closed=true;assert.equal(errors.length,0,'Browser runtime error: '+errors.join('; '));gate.assertClean();return result;
  }finally{if(!closed)await context.close();}
}

export async function runBrowserProof(){
  assert.equal(process.argv.length,2,'Browser proof accepts no caller input/clock overrides');
  assert.equal(process.execArgv.length,0,'Browser proof accepts no loader/clock hooks');
  assert(!process.env.NODE_PATH&&(!process.env.NODE_OPTIONS||/^--max-old-space-size=\d+$/.test(process.env.NODE_OPTIONS)),'Unexpected browser runtime loader options');
  const [{readRepairRequest,repairControllerRoot},{uiInventory,inventoryDigest,validateReceipt}]=await Promise.all([import('./retained-price-source-admission.mjs'),import('./publication-state.mjs')]);
  const root=repairControllerRoot(),scratch=join(process.env.RUNNER_TEMP||'/tmp','verified-publication'),statePath=join(scratch,'state.json'),state=JSON.parse(bytes(statePath)),request=readRepairRequest(root)?.value;
  await publisherToolingBoundary(state,'browser-before');writeFileSync(statePath,JSON.stringify(state));const stateRaw=bytes(statePath);
  const proof=consumePublisherToolingBrowserProof(state);
  assert(state.source?.repair&&state.carry?.priceSourceProof&&state.carry?.assessment&&state.financialPrepared&&state.decision.mode==='data','Browser gate requires authenticated finite source after ordinary carry/composition');
  const frontend=resolve('release/frontend'),dist=regularRoot(join(frontend,'dist')),publicationRaw=bytes(join(dist,'publication.json')),publication=validateReceipt(JSON.parse(publicationRaw));
  assert(publication.ui_sha===request.approved_ui.sha&&publication.ui_sha===state.live.uiSha&&publication.ui_digest===state.live.uiDigest,'Composed UI approval differs from authenticated predecessor');
  equal(uiInventory(dist),publication.ui_files,'Composed UI bytes differ');assert.equal(inventoryDigest(publication.ui_files),state.live.uiDigest);
  assert(publication.data_source.artifact_id===state.source.artifact.id&&publication.financial_lineage_sha256===state.live.financialRelease.lineage_sha256,'Composed price/financial lineage differs');
  equal(publication.financial_release,state.financialPrepared.reference,'Composed carry receipt differs');
  equal(publication.publisher_tooling,publisherToolingReceipt(state,publication),'Composed publisher tooling receipt differs');
  const carryIdentity=requireCarryBinding(publication,state,bytes(state.carry.projectionPath,128*1024**2));
  const preparedRaw=bytes(join(proof.replayRoot,'prepared.json'));equal({bytes:preparedRaw.length,sha256:sha(preparedRaw)},request.repair.prepared,'Replay preparation changed');
  const output=join(scratch,'finite-source-browser');assert(!existsSync(output),'Browser report directory must be new');mkdirSync(output);let server,browser,assets,timer,removeInterrupts;
  const report={schema_version:'retained-price-source-browser-v1',status:'running',scope:'finite actual composed data/DOM gate on the approved daily brief stock screen; not Design screenshot acceptance',publication_sha256:sha(publicationRaw),approved_ui:request.approved_ui,ui_digest:publication.ui_digest,source_artifact:state.source.artifact.id,financial_lineage:publication.financial_lineage_sha256,carry:carryIdentity,publisher_tooling:publication.publisher_tooling,started_at:new Date().toISOString(),clock:'actual browser and host time; no overrides',cases:[],network_denials:[],network_contract:BROWSER_NETWORK_CONTRACT,network_cases:[]};
  const save=()=>{const raw=JSON.stringify(report,null,2)+'\n';assert(Buffer.byteLength(raw)<=BROWSER_LIMITS.reportBytes,'Browser report exceeds bound');writeFileSync(join(output,'report.json'),raw);};save();
  try{
    const run=async()=>{
      const model=await loadApprovedFrontend(frontend,request.approved_ui,ui=>{report.ui=ui;save();});server=await startReleaseServer(dist);
      assets=await model.createDesignAssetObserver({baseURL:server.origin+BASE,fetchImpl:(url,options)=>{assert(localBrowserUrl(url,server.origin),'Observer attempted nonlocal network');return fetch(url,{...options,signal:AbortSignal.timeout(45000)});}});
      assert.equal(assets.manifest.markets?.US?.as_of_date,TARGET,'Composed manifest is not Oct6');assert.equal(assets.manifest.financial_generation,publication.financial_generation,'Browser manifest lost actual carry generation');assert(assets.packed,'Finite composed release must retain packed transport');
      assert.equal(sha(bytes(join(dist,'static-data/manifest.json'))),publication.data_manifest_sha256,'Composed manifest changed');
      const index=model.decodeResearchIndex(await assets.readJson(assets.manifest.markets.US.assets.research.path));const selected=selectBrowserCases(index.rows,JSON.parse(preparedRaw));
      browser=await model.chromium.launch({headless:true});report.browser=browser.version();report.node=process.version;
      for(const item of selected){report.active_case={symbol:item.symbol,category:item.category};save();report.cases.push(await inspectCase({browser,server,assets,model,item,generation:assets.manifest.research_generation||assets.manifest.generated_at,output,network:report.network_denials,networkCases:report.network_cases}));save();}
      equal(bytes(statePath),stateRaw,'Publication state changed during browser verification');equal(bytes(join(dist,'publication.json')),publicationRaw,'Publication changed during browser verification');equal(uiInventory(dist),publication.ui_files,'UI changed during browser verification');
      delete report.active_case;report.expired_components=report.cases.reduce((sum,item)=>sum+(item.expiry?.expired_components||0),0);assert(report.expired_components>0,'No real expired financial component was proved; no simulated clock is permitted');report.server=server.stats();assert.equal(report.server.failures.length,0,'Static server rejected a request');report.status='passed';
      await publisherToolingBoundary(state,'browser-after');writeFileSync(statePath,JSON.stringify(state));
    };
    const interrupted=new Promise((_,reject)=>{removeInterrupts=interruptRejection(reject);});
    await Promise.race([run(),interrupted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Finite browser deadline exceeded')),BROWSER_LIMITS.milliseconds);})]);
  }catch(error){report.status='failed';report.error=error.message;throw error;}
  finally{
    clearTimeout(timer);let cleanupError;
    try{assets?.dispose();}catch(error){cleanupError=error;}
    try{await browser?.close();}catch(error){cleanupError??=error;}
    try{if(server)await server.close();}catch(error){cleanupError??=error;}
    if(cleanupError){report.status='failed';report.cleanup_error=cleanupError.message;}
    report.finished_at=new Date().toISOString();try{save();}finally{removeInterrupts?.();}
    if(cleanupError)throw cleanupError;
  }
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))import('./publication-gate.mjs').then(({withInvocationImmutableGitApi})=>withInvocationImmutableGitApi('kusennjp1-ai/screener',runBrowserProof)).then(report=>console.log(JSON.stringify({status:report.status,cases:report.cases.length}))).catch(error=>{console.error(error.stack);process.exitCode=1;});
