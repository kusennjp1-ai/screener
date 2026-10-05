// Artifact-only cold Chromium comparison. This is an isolated packet transport
// diagnostic, not an app readiness, switch-performance or release acceptance run.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
import {fingerprintResearchBundle} from './ranking-packet-diagnostic-proof.mjs';
import {readDiagnosticSource} from './ranking-packet-diagnostic-source.mjs';

const BASE_SHA='776ba38f857ba6f24617be67892d1e85dad78da0';
const BASE_TREE='e95fc0667237a5aa773d57c194f59ab1d8047d7f';
const LOCAL_BASE_SHA='05ecf74c076b17f90efe117c23ea3bc20da52416';
const WIRE_SHA='10310c30693f0bc80d5ebc3b49428d422fdf64e1e5361fe5d849a058f1642690';
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,arg,index,all)=>index%2===0?[...pairs,[arg,all[index+1]]]:pairs,[]));
if(Object.keys(args).sort().join(',')!=='--baseline,--output,--wire'||Object.values(args).some(value=>!value))throw Error('Expected --baseline PATH --wire PATH --output PATH');
const roots={baseline:await realpath(resolve(args['--baseline'],'frontend')),candidate:await realpath(resolve('.'))};
const output=resolve(args['--output']),wire=await readFile(resolve(args['--wire']));
const sha=value=>createHash('sha256').update(value).digest('hex');
assert.ok(wire.length<=16*1024*1024,'Diagnostic wire exceeds 16 MiB');assert.equal(sha(wire),WIRE_SHA);
const git=(root,...gitArgs)=>execFileSync('git',['-C',root,...gitArgs],{encoding:'utf8'}).trim();
assert.equal(git(roots.baseline,'rev-parse','HEAD'),BASE_SHA);
assert.equal(git(roots.baseline,'rev-parse','HEAD^{tree}'),BASE_TREE);
const candidateSha=git(roots.candidate,'rev-parse','HEAD');
assert.match(candidateSha,/^[a-f0-9]{40}$/);assert.equal(git(roots.candidate,'status','--porcelain','--untracked-files=no'),'','Candidate source must be committed');
for(const file of ['package.json','package-lock.json'])assert.equal(sha(await readFile(join(roots.baseline,file))),sha(await readFile(join(roots.candidate,file))),`Dependency ${file} differs`);
await mkdir(output,{recursive:true});
const evaluation={now:Date.now(),generation:WIRE_SHA,evaluationEpoch:1},input=JSON.parse(wire);
assert.ok(!input.chunks?.length,'Diagnostic requires one exact complete wire, without secondary fetches');
const bundles={};for(const flavor of ['baseline','candidate']){
 const {prepareResearchBundle}=await import(pathToFileURL(join(roots[flavor],'src/static/researchPreprocess.js')));
 bundles[flavor]=prepareResearchBundle([input],input.as_of_date,evaluation);
}
assert.deepStrictEqual(bundles.candidate,bundles.baseline);
assert.equal(bundles.baseline.rows.length,5901);
const expected=await fingerprintResearchBundle(bundles.baseline),date=bundles.baseline.date;
const manifest={schema:'ranking-packet-diagnostic-v1',purpose:'UNAPPROVED review-only packet transport experiment; no release authority',
 source:{baseline_commit:BASE_SHA,baseline_tree:BASE_TREE,equivalent_local_baseline_commit:LOCAL_BASE_SHA,candidate_commit:candidateSha,wire_sha256:WIRE_SHA,wire_bytes:wire.length,artifact_id:11319208142,source_run_id:37244922910,source_run_attempt:1,github_run_head_sha:BASE_SHA,capture_checkout_sha:'5895525a5688eca4ee31e6768d577fb8ea76d1d2'},
 evaluation,expected,dependencies_sha256:sha(await readFile(join(roots.candidate,'package-lock.json'))),sources:{},
 method:'Fresh browser process and context for every trial; no warmup excluded; alternating baseline/candidate pairs; identical input/evaluation/dependencies; CDP CPU 4x on main page; actual module Worker and receiver; post-completion proof/byte audit outside timed endpoint; no app rendering.',samples:[],failures:[],complete:false};
for(const flavor of ['baseline','candidate'])for(const name of ['researchWorker.js','researchWorkerPackets.js','researchPreprocess.js'])manifest.sources[`${flavor}/${name}`]=sha(await readFile(join(roots[flavor],'src/static',name)));
manifest.sources.source_router=sha(await readFile(new URL('./ranking-packet-diagnostic-source.mjs',import.meta.url)));
manifest.sources.harness=sha(await readFile(new URL(import.meta.url)));manifest.sources.proof=sha(await readFile(new URL('./ranking-packet-diagnostic-proof.mjs',import.meta.url)));
const workerSource=`
const flavor=new URL(location.href).searchParams.get('flavor');
if(!['baseline','candidate'].includes(flavor))throw Error('Invalid flavor');
const originalPost=self.postMessage.bind(self);let currentKind;
const stats={handler_ms:{rows:0,ranking:0,complete:0},post_ms:{rows:0,ranking:0,complete:0}};
self.postMessage=message=>{if(message.packet)currentKind=message.packet.kind;const begin=performance.now();originalPost(message);if(message.packet)stats.post_ms[currentKind]+=performance.now()-begin;};
await import('/'+flavor+'/src/static/researchWorker.js');
const productionHandler=self.onmessage;
self.onmessage=async event=>{const begin=performance.now();currentKind=undefined;await productionHandler(event);if(currentKind){stats.handler_ms[currentKind]+=performance.now()-begin;if(currentKind==='complete')originalPost({diagnostic_stats:stats});}};
originalPost({diagnostic_worker_ready:true});
`;
const html=`<!doctype html><meta charset="utf-8"><title>Ranking packet diagnostic</title><p>Review-only ranking packet diagnostic</p><script type="module">
import {fingerprintResearchBundle} from '/proof.mjs';
window.runTrial=async config=>{
 const {createResearchReceiver}=await import('/'+config.flavor+'/src/static/researchWorkerPackets.js');
 const {validResearchEvaluation}=await import('/'+config.flavor+'/src/static/researchPreprocess.js');
 const receive=createResearchReceiver(),packets=[],stats={counts:{rows:0,ranking:0,complete:0},handler_ms:{rows:0,ranking:0,complete:0},max_handler_ms:{rows:0,ranking:0,complete:0},acknowledgements:0};
 const worker=new Worker('/worker.mjs?flavor='+config.flavor,{type:'module',name:'research-data'});let firstPacket,lastRowEnd,firstRanking,result,requestAt;
 return new Promise((accept,reject)=>{
 const timeout=setTimeout(()=>{worker.terminate();reject(Error('Diagnostic trial timed out'));},90000);
 const finish=error=>{clearTimeout(timeout);worker.terminate();accept({...stats,measurement_error:error.message,partial:true});};worker.onerror=event=>finish(Error(event.message));
 worker.onmessage=async({data})=>{try{
  if(data.diagnostic_worker_ready){requestAt=performance.now();worker.postMessage({operation:'research',url:location.origin+'/wire.json',baseUrl:location.origin+'/',sha256:config.wire_sha,date:config.date,evaluation:config.evaluation});return;}
  if(data.error)throw Error(data.error);
  if(data.diagnostic_stats){
   if(!result)throw Error('Stats arrived before complete');
   stats.worker=data.diagnostic_stats;
   const encoder=new TextEncoder();stats.packet_bytes={rows:[],ranking:[],complete:[]};
   for(const packet of packets){const bytes=encoder.encode(JSON.stringify({packet})).byteLength;stats.packet_bytes[packet.kind].push(bytes);if(packet.kind==='rows'&&packet.rows.length>150)throw Error('Oversized row packet');if(packet.kind==='ranking'&&config.flavor==='candidate'&&bytes>65536)throw Error('Oversized ranking packet');}
   if(stats.counts.rows!==40||stats.counts.complete!==1||stats.acknowledgements!==packets.length-1)throw Error('Packet/ACK endpoint mismatch');
   stats.proof=await fingerprintResearchBundle(result);
   clearTimeout(timeout);worker.terminate();accept(stats);return;
  }
  const packet=data.packet;if(!packet||result)throw Error('Packet after completion');
  const start=performance.now();firstPacket??=start;if(packet.kind==='ranking')firstRanking??=start;
  result=receive(packet);
  if(result&&(result.generation!==config.evaluation.generation||result.evaluation_epoch!==config.evaluation.evaluationEpoch||result.evaluated_at!==config.evaluation.now||result.date!==config.date||!validResearchEvaluation(result)))throw Error('Invalid completion evaluation');
  const end=performance.now();stats.counts[packet.kind]++;stats.handler_ms[packet.kind]+=end-start;stats.max_handler_ms[packet.kind]=Math.max(stats.max_handler_ms[packet.kind],end-start);packets.push(packet);
  if(packet.kind==='rows')lastRowEnd=end;
  if(result){stats.ranking_tail_ms=end-lastRowEnd;stats.first_ranking_to_complete_ms=end-firstRanking;stats.delivery_ms=end-firstPacket;stats.request_to_complete_ms=end-requestAt;stats.complete_at=end;performance.mark('ranking-diagnostic:complete');}
  else{stats.acknowledgements++;worker.postMessage({operation:'next-packet'});}
 }catch(error){finish(error);}};
 });
};
</script>`;
const servedSources=new Map();
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;let body,type='text/javascript';
  if(pathname==='/'){body=html;type='text/html';}
  else if(pathname==='/worker.mjs')body=workerSource;
  else if(pathname==='/proof.mjs')body=await readFile(new URL('./ranking-packet-diagnostic-proof.mjs',import.meta.url));
  else if(pathname==='/wire.json'){body=wire;type='application/json';}
  else{
   ({body,type}=await readDiagnosticSource(roots,pathname));servedSources.set(pathname,sha(body));
  }
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self'"});res.end(body);
 }catch{res.writeHead(404).end();}
});
await new Promise(accept=>server.listen(0,'127.0.0.1',accept));
const origin=`http://127.0.0.1:${server.address().port}`;
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}])for(let pair=0;pair<4;pair++)for(const flavor of pair%2?['candidate','baseline']:['baseline','candidate']){
  const trial={viewport,pair,flavor,cpu_rate:4,fresh_browser_process:true,started_at:new Date().toISOString(),errors:[]};let browser,deadlineTimer;
  try{
   const execution=(async()=>{
    browser=await chromium.launch({timeout:20000});
    const version=browser.version(),context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const cdp=await context.newCDPSession(page);await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await page.goto(origin,{timeout:15000});await page.waitForFunction(()=>typeof window.runTrial==='function',null,{timeout:15000});
    const measured=await page.evaluate(config=>window.runTrial(config),{flavor,wire_sha:WIRE_SHA,date,evaluation});
    return {...measured,chromium_version:version,errors};
   })();
   const deadline=new Promise((_,reject)=>{deadlineTimer=setTimeout(()=>reject(Error('Whole cold trial exceeded 90 seconds')),90000);});
   Object.assign(trial,await Promise.race([execution,deadline]));
   if(trial.measurement_error)throw Error(trial.measurement_error);
   assert.deepStrictEqual(trial.proof,expected,'Full value/identity proof differs');assert.deepStrictEqual(trial.errors,[]);trial.verified=true;
  }catch(error){trial.error=error.stack;trial.verified=false;manifest.failures.push(`${viewport.width}/pair${pair}/${flavor}: ${error.message}`);}
  finally{
   clearTimeout(deadlineTimer);manifest.samples.push(trial);
   const persist=async()=>{await writeFile(join(output,`trial-${viewport.width}-${pair}-${flavor}.json`),JSON.stringify(trial,null,2));await writeFile(join(output,'report.json'),JSON.stringify(manifest,null,2));};
   // Persist the attempted trial even when browser cleanup itself fails.
   await persist();let cleanupTimer,cleanupFailed=false;
   try{if(browser)await Promise.race([browser.close(),new Promise((_,reject)=>{cleanupTimer=setTimeout(()=>reject(Error('Browser cleanup exceeded 10 seconds')),10000);})]);}
   catch(error){cleanupFailed=true;trial.cleanup_error=error.message;trial.verified=false;manifest.aborted_reason='Browser cleanup failed; later trials were not started';manifest.failures.push(`${viewport.width}/pair${pair}/${flavor} cleanup: ${error.message}`);}
   finally{clearTimeout(cleanupTimer);await persist();}
   if(cleanupFailed)throw Error(manifest.aborted_reason);
  }

 }
 manifest.served_sources_sha256=Object.fromEntries([...servedSources.entries()].sort(([a],[b])=>a.localeCompare(b)));
 manifest.complete=manifest.samples.length===16&&manifest.failures.length===0;
 if(manifest.complete){
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return(sorted[1]+sorted[2])/2;};
  manifest.paired_results=[1440,390].map(width=>{const samples=manifest.samples.filter(sample=>sample.viewport.width===width);return {width,ranking_tail_medians_ms:Object.fromEntries(['baseline','candidate'].map(flavor=>[flavor,median(samples.filter(sample=>sample.flavor===flavor).map(sample=>sample.ranking_tail_ms))])),candidate_minus_baseline_ms:Array.from({length:4},(_,pair)=>samples.find(sample=>sample.pair===pair&&sample.flavor==='candidate').ranking_tail_ms-samples.find(sample=>sample.pair===pair&&sample.flavor==='baseline').ranking_tail_ms)};});
 }
 await writeFile(join(output,'report.json'),JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({complete:manifest.complete,trials:manifest.samples.length,failures:manifest.failures},null,2));
 if(!manifest.complete)process.exitCode=1;
}finally{await new Promise(accept=>server.close(accept));}
