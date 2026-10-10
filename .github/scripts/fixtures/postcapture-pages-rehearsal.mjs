import {boundedGhCliPrelude} from './bounded-gh-cli.mjs';
// Diagnostic only. Real #99 bytes and the failed producer/successful companion
// are immutable inputs. Future Git/CI/publisher authority and one price tick
// exist ONLY in a disposable Git repository. No provider or remote is called.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,chmodSync,closeSync,cpSync,existsSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,rmSync,statfsSync,statSync,truncateSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {bootstrap,sha256} from '../publication-state.mjs';
import {contract,digest} from '../financial-correction.mjs';
import {financialReleasePolicy,protectedCodeInventory} from '../financial-release-activation.mjs';
import {renewalPolicy,consumerCodeInventory,renewalControllerCodeInventory,reviewedMain135ConsumerTransition} from '../financial-source-renewal.mjs';
import {POSTCAPTURE_RENEWAL_REQUEST,POSTCAPTURE_SOURCE_GUARD} from '../financial-candidate-preview-postcapture.mjs';
import {extractPriceObservations,priceObservationDigest} from '../price-observations.mjs';
import {archiveApiPayload,assertOriginalFinancialClocks,assertSyntheticPriceAdvance} from './financial-release-archive-lifecycle.mjs';
import {renewalLifecycleFixture,verifyNestedRenewalBytes,read,write} from './financial-source-renewal-lifecycle.mjs';
import {compareRenewalTargets} from './renewal-target-diagnostics.mjs';
import {runtimeIdentity,writeSealedCheckpoint,verifySealedCheckpoint,restoreCheckpointController,releaseConsumedCandidateTar,writePublicationCheckpoint,verifyPublicationCheckpoint,restorePublicationController} from './postcapture-rehearsal-checkpoint.mjs';

const ownRoot=fileURLToPath(new URL('../../../',import.meta.url));
const prefix=`repos/${bootstrap.repository}`;
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000}).trim();
const fileHash=path=>execFileSync('sha256sum',[path],{encoding:'utf8',timeout:180000}).split(' ')[0];
const roles=['pages','old-source','old-cert','failed-source','companion'];
export const ACTUAL=Object.freeze({
  reviewed_entry_sha256:'9dfd45176aee0dbc79cf46a10ece5ba5446991f67f7d5d94aa6dd0473624f635',
  ui_sha:'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',ui_tree:'1c0219a170dcbdeb1af539e4cf7a04018251ca02',
  ui_digest:'72fd791b42a691e286279cada721207a812d13b13233e814d0c2cfde73571788',
  initial_release_sha256:'fe36a0bc261ca032b9b6682533da57e915fc40c6855cf0d4757082cce42f02a4',
  source_base_sha256:'94d3f1f08869fe625c678e64c1699bf024050c7a5208847168a67c3c0e2b8b27',
  source_projection_sha256:'a93042a6f6ad40c9bbf0f518bf5580d1a1a014e2fc70380569edcde76c965b9a',
  pages:{run_id:37456692717,run_attempt:1,artifact_id:11421722413,head_sha:'8a490df5b0a873637781a8e4e5351cece9313f37',artifact_sha256:'1ab2594be91d3bbc8716481c730a9afdf22eb4ca554fcd5d02770b92252de4eb'},
  'old-source':{run_id:37203329163,run_attempt:8,artifact_id:11307162746,head_sha:'4b27798b9b04528737938bb5844a8d86a704c58d',artifact_sha256:'c4b07d50e357fb556fda62c419f0d549a1a7e62fd62dccd3a501d4d563939dbb'},
  'old-cert':{run_id:37212616278,run_attempt:1,artifact_id:11307009412,head_sha:'2a8f31dac1192850ea690392273f006ed58a396f',artifact_sha256:'fbe0e5e2a8a683596acaa6a133c8e642215fde0e4f332449cc635feec3a11958'},
  'failed-source':{run_id:37478731832,run_attempt:1,artifact_id:11420873789,head_sha:'4715b218cc25720d1d3be455930554e1e6282136',artifact_sha256:'266b2118cefe4a51dcf0981b4e60c35ba76524e1f35cf9633f8c26691f68d2bd'},
  companion:{run_id:37495003542,run_attempt:1,artifact_id:11426862690,head_sha:'28e298ee21ea275629a94e7066ac8835b7654182',artifact_sha256:'f63ecbe50b61b49666abdfaa6bf2f30605a7ddb31af82d8a2e20da3ca1859d23'},
});

export function assertActualIdentities(input,review){
  assert.equal(input.schema_version,'postcapture-pages-rehearsal-inputs-v1');assert.equal(input.publication_authority,false);
  assert.deepEqual(Object.keys(input.paths).sort(),[...roles].sort(),'exactly five immutable input roles are required');
  for(const role of roles)for(const [key,value]of Object.entries(ACTUAL[role]))assert.equal(input.paths[role].reference[key],value,`${role} ${key}`);
  for(const [key,value]of Object.entries(ACTUAL.companion))assert.equal(review.reference[key],value,`companion reviewed ${key}`);
  for(const [key,value]of Object.entries(ACTUAL['failed-source']))assert.equal(review.source[key],value,`failed source reviewed ${key}`);
  assert.equal(review.reference.receipt_sha256,'f5e925de47bfe9dc5f00f28b179e6d4e124b24d2f793692390e08177e55f57d5');
}

// Serialized below into the transport executable. It never resolves a network
// alias, writes to GitHub, or answers an unknown API endpoint.
export function offlineApiResponse(config,endpoint,paginate,gitRead){
  if(endpoint===`${prefix}/git/ref/heads/main`)return {object:{sha:config.currentSha}};
  if(Object.hasOwn(config.api,endpoint))return archiveApiPayload(config.api[endpoint],paginate);
  const exact=`${paginate?'GET_PAGES':'GET'} ${endpoint}`,alternate=`${paginate?'GET':'GET_PAGES'} ${endpoint}`;
  if(Object.hasOwn(config.api,exact))return config.api[exact];
  if(Object.hasOwn(config.api,alternate))return paginate?[config.api[alternate]]:archiveApiPayload(config.api[alternate],false);
  if(endpoint.startsWith(`${prefix}/git/commits/`)){
    const sha=endpoint.split('/').at(-1),[tree,parents]=gitRead(sha,'show','-s','--format=%T%n%P',sha).split('\n');
    return {sha,tree:{sha:tree},parents:(parents||'').split(' ').filter(Boolean).map(sha=>({sha}))};
  }
  if(endpoint.startsWith(`${prefix}/git/trees/`)){
    const sha=endpoint.split('/').at(-1).split('?')[0];
    return {sha,truncated:false,tree:gitRead(sha,'ls-tree','-r',sha).split('\n').filter(Boolean).map(line=>{
      const [meta,path]=line.split('\t'),[mode,type,sha]=meta.split(' ');return {path,mode,type,sha};
    })};
  }
  if(endpoint.startsWith(`${prefix}/contents/`)){
    const [path,revision]=endpoint.slice(`${prefix}/contents/`.length).split('?ref=');
    assert.ok(revision&&/^[a-f0-9]{40}$/.test(revision),'immutable content revision required');
    const bytes=gitRead(revision,'show',`${revision}:${path}`,{binary:true});
    return {type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')};
  }
  throw Error(`Unmatched offline API read: ${endpoint}`);
}

export function installOfflineTransport(f,{python}){
  const bin=join(f.root,'bin'),deny=join(f.root,'python-deny'),configPath=join(f.root,'transport.json');mkdirSync(deny);
  write(join(bin,'gh'),`#!${process.execPath}\n${boundedGhCliPrelude}const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const prefix=${JSON.stringify(prefix)},args=process.argv.slice(2),config=JSON.parse(fs.readFileSync(process.env.RENEWAL_FIXTURE_CONFIG));
if(args[0]!=='api'||args.slice(1,-1).some(arg=>!['--paginate','--slurp'].includes(arg)))throw Error('Only exact offline GitHub reads are allowed');
const endpoint=args.at(-1);fs.appendFileSync(process.env.RENEWAL_FIXTURE_TRACE,JSON.stringify({api:endpoint})+'\\n');
if(Object.hasOwn(config.zips,endpoint)){const fd=fs.openSync(config.zips[endpoint],'r'),buffer=Buffer.alloc(1024*1024);let size;try{while((size=fs.readSync(fd,buffer,0,buffer.length,null))>0){let n=0;while(n<size)n+=fs.writeSync(1,buffer,n,size-n);}}finally{fs.closeSync(fd);}process.exit(0);}
function gitRead(sha,...args){let options={};if(typeof args.at(-1)==='object')options=args.pop();const root=config.gitRoots.find(root=>cp.spawnSync('git',['-C',root,'cat-file','-e',sha],{timeout:10000}).status===0);if(!root)throw Error('Missing immutable local Git object '+sha);const b=cp.execFileSync('git',['-C',root,...args],{maxBuffer:64*1024*1024,timeout:60000});return options.binary?b:b.toString().trim();}
${archiveApiPayload.toString()}
${offlineApiResponse.toString().replace('export function ','function ')}
process.stdout.write(JSON.stringify(offlineApiResponse(config,endpoint,args.includes('--paginate'),gitRead)));\n`);chmodSync(join(bin,'gh'),0o755);
  write(join(f.root,'transport.mjs'),`import {readFileSync,appendFileSync,existsSync,realpathSync,statSync} from 'node:fs';import {join,relative,isAbsolute} from 'node:path';
import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';import dgram from 'node:dgram';import {syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';import {performance} from 'node:perf_hooks';
const config=JSON.parse(readFileSync(${JSON.stringify(configPath)})),base=new URL(${JSON.stringify(bootstrap.site_url)});
// Diagnostic timing only. Child arguments/results, timeouts, exit status and
// all production verification remain unchanged. No result enters authority.
const timingPath=${JSON.stringify(join(f.root,'child-process-phases.jsonl'))};
for(const name of ['execFileSync','spawnSync']){const original=childProcess[name];childProcess[name]=function(...args){
 const start=performance.now(),at=new Date().toISOString();let result,error;
 try{return result=Reflect.apply(original,this,args);}catch(value){error=value;throw value;}finally{
  const size=existsSync(timingPath)?statSync(timingPath).size:0;if(size<8*1024*1024){const entry={schema_version:'diagnostic-child-timing-v1',pid:process.pid,operation:name,command:String(args[0]).slice(-180),arguments:Array.isArray(args[1])?args[1].slice(0,4).map(value=>String(value).slice(0,120)):[],at,elapsed_ms:Math.round(performance.now()-start),status:error?.status??result?.status??(error||result?.error?'error':0)};if(size+Buffer.byteLength(JSON.stringify(entry))+1>=8*1024*1024)entry.truncated_after_record=true;appendFileSync(timingPath,JSON.stringify(entry)+'\\n');}
 }
};}
const denied=()=>{appendFileSync(process.env.RENEWAL_FIXTURE_TRACE,JSON.stringify({blocked_network:true})+'\\n');throw Error('Network/provider access denied during actual-artifact rehearsal');};
for(const module of [http,https])for(const name of ['request','get'])module[name]=denied;
net.connect=net.createConnection=net.Socket.prototype.connect=tls.connect=dgram.createSocket=denied;
for(const key of ['lookup','resolve','resolve4','resolve6','reverse'])dns[key]=denied;
syncBuiltinESMExports();
globalThis.fetch=async(input,options={})=>{const url=new URL(input),path=url.pathname.slice(base.pathname.length);
if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||path.includes('..')||path.includes('\\\\')||options.redirect!=='error'||options.method&&options.method!=='GET')return denied();
if(!config.liveRoot)throw Error('No retained physical Pages root');
// A negative test changes only this declared simulated response. It cannot
// mutate or replace the original retained #99 ZIP or physical tree.
if(path==='publication.json'&&config.racePublicationPath){if(config.racePublicationPath!==${JSON.stringify(join(f.root,'race-publication.json'))})return denied();return new Response(readFileSync(config.racePublicationPath));}
const target=join(config.liveRoot,path);
if(!existsSync(target))return new Response(null,{status:404});const inside=relative(realpathSync(config.liveRoot),realpathSync(target));if(inside.startsWith('..')||isAbsolute(inside))return denied();
appendFileSync(process.env.RENEWAL_FIXTURE_TRACE,JSON.stringify({pages:path})+'\\n');return new Response(readFileSync(target));};
// The real clock is deliberately untouched. Source receipt/proof clocks are
// immutable, while a newly performed projection records its actual evaluation.
`);
  write(join(deny,'sitecustomize.py'),`import sys, socket, resource\nlimit=3*1024**3\nsoft,hard=resource.getrlimit(resource.RLIMIT_AS)\nif hard!=resource.RLIM_INFINITY: limit=min(limit,hard)\nresource.setrlimit(resource.RLIMIT_AS,(limit,limit))\ndef forbidden(*args, **kwargs):\n raise RuntimeError('Provider/socket access denied during actual-artifact rehearsal')\ndef audit(event, args):\n if event.startswith('socket.') and event not in ('socket.__new__',): forbidden()\nsys.addaudithook(audit)\nfor name in ('connect','connect_ex','sendto'): setattr(socket.socket,name,forbidden)\nsocket.create_connection=socket.getaddrinfo=forbidden\n# Pure retained-frame normalizers import these packages. Importing them is not\n# acquisition; transport and getter entry points are independently disabled.\ntry:\n import curl_cffi\n curl_cffi.Curl.perform=forbidden\nexcept ModuleNotFoundError: pass\ntry:\n import yfinance as yf\n from yfinance.data import YfData\n yf.download=forbidden\n for name in ('get','post','get_raw_json','cache_get'): setattr(YfData,name,forbidden)\n for name in ('history','get_info','get_income_stmt','get_balance_sheet','get_cash_flow'): setattr(yf.Ticker,name,forbidden)\nexcept ModuleNotFoundError: pass\n`);
  const pythonPath=execFileSync(python,['-c','import sys;print(sys.executable)'],{encoding:'utf8',timeout:10000}).trim();
  write(join(bin,'python3'),`#!${process.execPath}\nconst cp=require('node:child_process');const env={...process.env,PYTHONPATH:${JSON.stringify(deny)}+(process.env.PYTHONPATH?':'+process.env.PYTHONPATH:'')};const result=cp.spawnSync(${JSON.stringify(pythonPath)},process.argv.slice(2),{env,stdio:'inherit'});if(result.error)throw result.error;process.exit(result.status??1);\n`);chmodSync(join(bin,'python3'),0o755);
  f.python=join(bin,'python3');f.env.FINANCIAL_REPLAY_PYTHON=f.python;f.env.PYTHONPATH=deny;
  for(const key of ['OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'])f.env[key]='1';
  for(const key of Object.keys(f.env))if(/^(?:GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|.*_API_KEY|.*_ACCESS_TOKEN)$/.test(key))delete f.env[key];
  f.save();
}

// One appended price observation at the unchanged final close/volume is an
// explicit synthetic feed. Never change original bars or financial timestamps.
export function advanceSyntheticPrices(publicRoot,targetBase,{date='2026-10-05',evaluatedAt=new Date().toISOString()}={}){
  const root=join(publicRoot,'static-data'),manifest=read(join(root,'manifest.json')),entry=manifest.markets.US;
  assert.ok(date>entry.as_of_date&&date<=evaluatedAt.slice(0,10),'synthetic next-price day must advance and cannot be in the future');
  const targetSymbols=new Set(targetBase.rows.map(row=>row.symbol));assert.equal(targetSymbols.size,targetBase.rows.length);
  const catalog=read(join(root,entry.assets.charts.path)),expected=new Set(),withoutHistory=new Set();
  for(const item of catalog.symbols){
    if(!targetSymbols.has(item.symbol))continue;
    const value=item.path?read(join(root,item.path)):null;
    if(!value?.bars?.length){withoutHistory.add(item.symbol);continue;}
    assert.equal(value.symbol??value.stock_data?.symbol,item.symbol);expected.add(item.path);
  }
  const shift=value=>{value.as_of_date=date;for(const key of ['rows','initial_rows','preview_rows','results','stocks','members'])if(Array.isArray(value[key]))for(const row of value[key])row.as_of_date=date;return value;};
  const scanPath=join(root,entry.pages.scan.path),scan=read(scanPath);write(scanPath,shift(scan));
  for(const item of scan.chunks||[])write(join(root,item.path),shift(read(join(root,item.path))));
  for(const name of ['financial-history.json','sector-prices.json'])if(existsSync(join(root,name))){
    const path=join(root,name),value=read(path);value.as_of_date=date;
    if(name==='financial-history.json')for(const item of Object.values(value.results||{}))item.as_of_date=date;
    write(path,value);
  }
  const excluded=new Set(['candidate-history','candidate-performance-history','financial-corrections','financial-lineage','_transport']);
  const paths=[],symbols=new Set();
  function visit(folder){for(const item of readdirSync(folder,{withFileTypes:true})){
    const path=join(folder,item.name);assert.ok(!item.isSymbolicLink());
    if(item.isDirectory()){if(!excluded.has(item.name))visit(path);continue;}
    assert.ok(item.isFile());if(!item.name.endsWith('.json'))continue;
    const value=read(path),symbol=Array.isArray(value?.bars)?value.symbol??value.stock_data?.symbol:null;
    if(!symbol||!targetSymbols.has(symbol)||value.market&&value.market!=='US')continue;
    const before=value.bars;
    if(before.length){assert.ok(before.at(-1).date<date);value.bars=[...before,{...before.at(-1),date}];}
    value.as_of_date=date;for(const key of ['stock_data','fundamentals'])if(value[key])value[key].as_of_date=date;
    write(path,value);
    if(before.length){assertSyntheticPriceAdvance(before,read(path).bars,date);paths.push(path.slice(root.length+1));symbols.add(symbol);}
  }}visit(root);
  assert.ok(expected.size>0);for(const path of expected)assert.ok(paths.includes(path),`unadvanced canonical chart ${path}`);
  manifest.as_of_date=date;manifest.generated_at=evaluatedAt;entry.as_of_date=date;write(join(root,'manifest.json'),manifest);
  return {date,target_rows:targetBase.rows.length,canonical_chart_paths:expected.size,advanced_alias_paths:paths.length,
    advanced_symbols:[...symbols].sort(),catalog_symbols_without_history:withoutHistory.size,all_updated_ohlcv_prefixes_preserved:true};
}

function assertionsForLive(live){
  assert.equal(live.receipt.run_id,ACTUAL.pages.run_id);assert.equal(live.receipt.run_attempt,1);
  assert.equal(live.uiSha,ACTUAL.ui_sha);assert.equal(live.uiDigest,ACTUAL.ui_digest);
  assert.equal(live.approval.type,'performance-exception-v2');assert.equal(live.financialRelease.mode,'activation');
  assert.equal(live.receipt.financial_release.sha256,ACTUAL.initial_release_sha256);
  assert.equal(live.financialRelease.source_base.sha256,ACTUAL.source_base_sha256);
  assert.equal(live.financialRelease.source_projection.sha256,ACTUAL.source_projection_sha256);
  assert.equal(live.manifest.markets.US.as_of_date,'2026-10-02');
  assert.equal(live.verificationUniverse.total,1895);assert.equal(live.verificationUniverse.verified,1846);
  for(const role of ['old-source','old-cert'])for(const [key,value]of Object.entries(ACTUAL[role]))assert.equal(live.financialRelease.lineage[role==='old-source'?'source':'certificate'][key],value);
}

export async function runPostcapturePagesRehearsal(inputPath,{output,runtimeRoot=ownRoot,nodeModules=join(ownRoot,'frontend/node_modules'),python=process.env.FINANCIAL_REPLAY_PYTHON||'python3',stage='full',checkpoint,checkpointSha256}={}){
  assert.ok(['full','seal','publish','carry'].includes(stage),'invalid rehearsal stage');
  if(['publish','carry'].includes(stage))assert.ok(checkpoint&&checkpointSha256,'publish/carry require an exact checkpoint and hash');
  else assert.equal(Boolean(checkpoint||checkpointSha256),false,'only publish/carry accept a checkpoint');
  runtimeIdentity(runtimeRoot); // Reject changed executable code before an expensive stage.
  const input=read(resolve(inputPath)),reviewedEntry=join(ownRoot,'.github/scripts/fixtures/postcapture-reviewed-entry.json');
  assert.equal(fileHash(reviewedEntry),ACTUAL.reviewed_entry_sha256,'diagnostic companion review bytes changed');
  const review=read(reviewedEntry);assertActualIdentities(input,review);
  const storage=read(input.storage_preflight);assert.equal(storage.passed,true);assert.equal(storage.logical_decode_performed,false);assert.equal(storage.L,2034508208);
  const directory=resolve(output||input.output||join(dirname(resolve(inputPath)),'rehearsal'));
  assert.equal(existsSync(directory),false,'rehearsal output must be new');
  assert.notEqual(directory,resolve(runtimeRoot));assert.ok(!resolve(runtimeRoot).startsWith(directory+'/'),'disposable root cannot contain source checkout');
  for(const role of roles){assert.equal(fileHash(input.paths[role].zip),ACTUAL[role].artifact_sha256,`${role} ZIP identity`);assert.ok(statSync(input.paths[role].root).isDirectory());}
  const originalControls=Object.fromEntries(['contracts/financial_source_renewal_v1.json','contracts/financial_source_postcapture_trust_v1.json',
    'contracts/financial_performance_exception_v2.json',financialReleasePolicy.request_path,...readdirSync(join(runtimeRoot,'.github')).filter(name=>/^financial-performance-(?:candidate|release).*\.json$/.test(name)).map(name=>`.github/${name}`)]
    .filter(path=>existsSync(join(runtimeRoot,path))).map(path=>[path,fileHash(join(runtimeRoot,path))]));
  assert.equal(read(join(runtimeRoot,'contracts/financial_source_renewal_v1.json')).publication_enabled,false);
  assert.deepEqual(read(join(runtimeRoot,'contracts/financial_source_renewal_v1.json')).reviewed_controllers,[]);
  assert.deepEqual(read(join(runtimeRoot,'contracts/financial_source_renewal_v1.json')).reviewed_consumer_transitions,[]);
  assert.deepEqual(read(join(runtimeRoot,'contracts/financial_source_postcapture_trust_v1.json')).reviewed_requests,[]);
  const began=performance.now(),deadline=Date.now()+95*60*1000;
  const f=renewalLifecycleFixture({directory,runtimeRoot,nodeModules,python,keep:true});
  const report={schema_version:'postcapture-pages-rehearsal-report-v1',publication_authority:false,outcome:'incomplete',
    actual_inputs:Object.fromEntries(roles.map(role=>[role,ACTUAL[role]])),synthetic_future_authority:true,synthetic_next_price_observations:true,
    source_clocks:'literal immutable acquisition/companion clocks',evaluation_clock:'actual wall clock',stage,provider_calls:0,production_registry_entries_written:0,phases:[]};
  const reportPath=join(directory,'report.json'),heartbeat=join(directory,'phases.jsonl');
  const saveReport=()=>write(reportPath,report);
  const event=(phase,status,extra={})=>{const value={phase,status,at:new Date().toISOString(),elapsed_ms:Math.round(performance.now()-began),...extra};appendFileSync(heartbeat,JSON.stringify(value)+'\n');report.current_phase=value;saveReport();return value;};
  f.checkpoint=(phase,extra={})=>{const value=event(phase,'complete',extra);report.phases.push(value);saveReport();console.log(`Postcapture Pages rehearsal: ${phase}`);};
  const invoke=(label,command,args=[],{cwd=f.checkout,extra={},timeout=15*60*1000,additionalBytes=0,expectedFailure}={})=>{
    const remaining=deadline-Date.now();assert.ok(remaining>10000,'95-minute lifecycle bound exhausted');timeout=Math.min(timeout,remaining-1000);
    const space=statfsSync(directory),availableBytes=space.bavail*space.bsize;
    assert.ok(availableBytes>=storage.reserve_bytes+additionalBytes,`${label}: insufficient measured free space for bounded next phase`);
    f.save();const ordinal=String(report.phases.length).padStart(3,'0'),stem=label.replace(/[^a-z0-9]+/gi,'-').slice(0,90),path=join(directory,'commands',`${ordinal}-${stem}.log`);mkdirSync(dirname(path),{recursive:true});
    event(label,'start',{timeout_ms:timeout,log:path.slice(directory.length+1),available_bytes:availableBytes,additional_bytes:additionalBytes,reserve_bytes:storage.reserve_bytes});const fd=openSync(path,'w');let result;
    try{result=spawnSync('timeout',['--signal=TERM','--kill-after=10s',`${Math.ceil(timeout/1000)}s`,command,...args],{cwd,env:{...f.env,RENEWAL_FIXTURE_NOW:f.now,RELEASE_SHA:f.head,GITHUB_SHA:f.head,...extra},stdio:['ignore',fd,fd],timeout:timeout+15000});}
    finally{closeSync(fd);}
    if(expectedFailure&&!result.error&&result.status!==0&&![124,137,143].includes(result.status)){
      const text=readFileSync(path,'utf8');assert.match(text,expectedFailure,`negative failed for an unexpected reason: ${label}`);
      f.checkpoint(label,{expected_rejection:true,log:path.slice(directory.length+1)});return text;
    }
    if(result.error||result.status!==0){event(label,'failed',{status:result.status,error:result.error?.message,log:path.slice(directory.length+1)});throw Error(`${label} failed (${result.status}): ${result.error?.message||''}; see ${path}`);}
    assert.equal(Boolean(expectedFailure),false,`negative unexpectedly passed: ${label}`);
    f.checkpoint(label,{log:path.slice(directory.length+1)});return readFileSync(path,'utf8');
  };
  f.run=(command,args,options={})=>invoke(`${command.split('/').at(-1)} ${args.join(' ').slice(0,100)}`,command,args,options);
  f.evaluate=(code,extra={})=>{const path=join(f.checkout,'.postcapture-diagnostic-evaluate.mjs');write(path,code);try{return invoke('Evaluate actual artifact proof',process.execPath,[path],{extra});}finally{rmSync(path,{force:true});}};
  f.command=name=>invoke(`Publisher ${name}`,process.execPath,[join(f.checkout,'.github/scripts/select-release-source.mjs'),name],{timeout:20*60*1000,additionalBytes:({'plan':4,'restore':3,'compose':2,'recheck':2,'prepare-carry':2}[name]||0)*storage.L});
  f.certifyCommand=name=>invoke(`Certifier ${name}`,process.execPath,[join(f.checkout,'.github/scripts/financial-source-renewal-certification.mjs'),name],{extra:{GITHUB_WORKFLOW_REF:`${bootstrap.repository}/${renewalPolicy.workflow}@refs/heads/main`},timeout:name==='prepare'?30*60*1000:20*60*1000,additionalBytes:name==='prepare'?5*storage.L:2*storage.L});
  f.exportData=(frontend,extra={})=>invoke('Compile complete research data',process.execPath,['tools/export-research.mjs'],{cwd:frontend,extra:{FINANCIAL_EVALUATED_AT:new Date().toISOString(),...extra},timeout:15*60*1000});
  f.readLive=()=>JSON.parse(invoke('Authenticate simulated live publication',process.execPath,['--input-type=module','-e',"import {livePublication} from './.github/scripts/publication-state.mjs';console.log(JSON.stringify(await livePublication()));"]));
  f.archive=(source,name,member='artifact.tar')=>{const zip=join(directory,`${name}.zip`);invoke(`Archive ${name}`,f.python,['-c',
    'import shutil,subprocess,sys,zipfile\np=subprocess.Popen(["tar","-cf","-","-C",sys.argv[1],"."],stdout=subprocess.PIPE)\ntry:\n with zipfile.ZipFile(sys.argv[2],"x",compression=zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as z:\n  with z.open(sys.argv[3],"w",force_zip64=True) as dst:shutil.copyfileobj(p.stdout,dst,1024*1024)\n assert p.wait()==0,"tar failed"\nfinally:\n p.stdout.close()\n if p.poll() is None:p.kill();p.wait()',source,zip,member]);return zip;};
  f.artifact=(zip,id,name,run,sha)=>{f.config.zips[`${prefix}/actions/artifacts/${id}/zip`]=zip;return {id,name,expired:false,digest:`sha256:${fileHash(zip)}`,size_in_bytes:statSync(zip).size,created_at:f.now,expires_at:'2099-01-01T00:00:00Z',workflow_run:{id:run,head_sha:sha,head_branch:'main',repository_id:7,head_repository_id:7}};};
  const setRun=id=>{f.setRun(id);f.env.GITHUB_RUN_ID=String(id);f.setTime(new Date().toISOString());};
  const negative=(label,command,reason)=>invoke(label,process.execPath,[join(f.checkout,'.github/scripts/select-release-source.mjs'),command],{timeout:3*60*1000,expectedFailure:reason});
  function publish(dist,id,label){
    const destination=join(directory,label);renameSync(dist,destination);f.config.liveRoot=destination;
    const publication=read(join(destination,'publication.json'));assert.equal(publication.run_id,id);
    f.setTime(new Date().toISOString());const zip=f.archive(destination,label),artifact=f.artifact(zip,id+60000,publication.artifact_name,id,publication.controller_sha),stamp=f.now;
    f.registration({run_id:id,run_attempt:1},{run:f.workflow(id,'.github/workflows/research-ui-release.yml',publication.controller_sha,{event:'workflow_dispatch',start:stamp}),
      jobs:[{id:id*10,run_id:id,run_attempt:1,head_sha:publication.controller_sha,status:'completed',conclusion:'success',started_at:stamp,completed_at:stamp,
        steps:[{name:'Deploy to GitHub Pages',conclusion:'success',started_at:stamp,completed_at:stamp}]}],artifacts:[artifact]});
    f.api[`${prefix}/actions/artifacts?per_page=100`]=[{artifacts:[artifact]}];f.save();return f.readLive();
  }
  try{
    const objects=git(runtimeRoot,'rev-parse','--path-format=absolute','--git-path','objects');mkdirSync(join(f.checkout,'.git/objects/info'),{recursive:true});write(join(f.checkout,'.git/objects/info/alternates'),objects+'\n');
    assert.equal(git(f.checkout,'rev-parse',`${ACTUAL.ui_sha}^{tree}`),ACTUAL.ui_tree,'the real captured UI Git object is required');
    f.config.gitRoots.push(resolve(runtimeRoot));
    const recorded=read(input.api_evidence),responses=recorded.responses||recorded.api||recorded;
    assert.ok(Object.hasOwn(responses,`GET ${prefix}/actions/runs/${ACTUAL.pages.run_id}/attempts/1`),'missing authenticated #99 API');
    for(const key of Object.keys(f.api))delete f.api[key];Object.assign(f.api,responses);
    for(const role of roles)f.config.zips[`${prefix}/actions/artifacts/${ACTUAL[role].artifact_id}/zip`]=resolve(input.paths[role].zip);
    f.config.liveRoot=resolve(input.paths.pages.root);f.setUi(ACTUAL.ui_sha);setRun(990400);installOfflineTransport(f,{python});
    const live=f.readLive();assertionsForLive(live);f.setSeed({live});
    const initialRequest=readFileSync(join(f.checkout,financialReleasePolicy.request_path));
    f.checkpoint('Authenticated exact #99 Pages UI, complete prices, universe and original v2 authority',{publication_identity:live.identity,price_series:Object.keys(live.priceObservations).length,ui_files:Object.keys(live.uiFiles).length});
    const publicRoot=join(f.checkout,'frontend/public'),target=join(directory,'request-target-base.json');
    const candidate=join(f.env.RUNNER_TEMP,'financial-source-renewal-certification/prepared');
    let request,targetBase,a,record,zip,consumerTransition;
    if(stage==='carry'){
      const retained=verifyPublicationCheckpoint({directory:checkpoint,checkpointSha256,runtimeRoot,actualInputs:report.actual_inputs});
      restorePublicationController({directory:checkpoint,manifest:retained,fixture:f,runtimeRoot});
      cpSync(join(checkpoint,'request-target-base.json'),target,{force:false,errorOnExist:true});targetBase=read(target);
      const renewedRoot=join(directory,'simulated-renewal');
      invoke('Restore exact retained renewed physical Pages bytes',f.python,[join(runtimeRoot,'.github/scripts/restore-postcapture-publication-checkpoint.py'),join(checkpoint,'renewed-pages.zip'),renewedRoot],{additionalBytes:storage.P});
      assert.equal(fileHash(join(renewedRoot,'publication.json')),retained.publication_sha256);
      f.config.liveRoot=renewedRoot;f.config.zips[`${prefix}/actions/artifacts/1050401/zip`]=join(resolve(checkpoint),'renewed-pages.zip');f.save();
      const renewed=f.readLive();assert.equal(renewed.identity,retained.renewed_identity);assert.equal(renewed.financialRelease.lineage_sha256,retained.lineage_sha256);
      assert.deepEqual(renewed.financialRelease.source_projection,retained.source_projection);assert.deepEqual(renewed.financialRelease.source_base,retained.source_base);
      report.consumed_checkpoint={sha256:checkpointSha256,sealed_checkpoint_sha256:retained.sealed_checkpoint_sha256,files:retained.files};report.negative_controls=[];
      f.checkpoint('Authenticated exact retained renewal publication and historical authority',report.consumed_checkpoint);
      const carried=await carryActualRenewal(f,{invoke,publish,targetBase,initialRequest,renewed,report,directory,setRun});
      for(const [path,sum]of Object.entries(originalControls))assert.equal(fileHash(join(runtimeRoot,path)),sum,`production control changed: ${path}`);
      report.outcome='retained-actual-renewal-and-synthetic-next-price-carry-passed';report.renewed_publication_identity=renewed.identity;report.carried_publication_identity=carried.identity;report.final_source_lineage=carried.financialRelease.lineage_sha256;
      f.checkpoint('Verified retained renewal carry; production controls unchanged');return {directory,report};
    }
    if(stage==='publish'){
      const retained=verifySealedCheckpoint({directory:checkpoint,checkpointSha256,runtimeRoot,actualInputs:report.actual_inputs});
      restoreCheckpointController({directory:checkpoint,manifest:retained,fixture:f,runtimeRoot});
      cpSync(join(checkpoint,'request-target-base.json'),target,{force:false,errorOnExist:true});
      request=retained.request;targetBase=read(target);a=retained.certification.sha;record=read(join(checkpoint,'candidate.json'));zip=join(resolve(checkpoint),'sealed-renewal.zip');
      consumerTransition=reviewedMain135ConsumerTransition();f.save();
      report.consumed_checkpoint={sha256:checkpointSha256,runtime:retained.runtime,certification:retained.certification,evaluated_at:retained.evaluated_at,sealed_at:retained.sealed_at,files:retained.files};
      f.checkpoint('Verified exact retained sealed checkpoint; all production checks remain required',report.consumed_checkpoint);
    }else{
      f.evaluate(`import {rmSync,readFileSync,writeFileSync} from 'node:fs';import {canonicalPublication} from './.github/scripts/static-transport-publication.mjs';
        const root=${JSON.stringify(f.liveRoot)},out=${JSON.stringify(publicRoot)};rmSync(out,{recursive:true,force:true});
        const logical=await canonicalPublication({root,frontendRoot:${JSON.stringify(join(f.checkout,'frontend'))},publication:${JSON.stringify(live.receipt)},restore:out});
        if(logical!==out)throw Error('Expected a complete decoded #99 tree');
        for(const [path,sum]of Object.entries(${JSON.stringify(live.receipt.financial_audit_files)})){const {sha256}=await import('./.github/scripts/publication-state.mjs');if(sha256(readFileSync(out+'/'+path))!==sum)throw Error('Original audit mismatch '+path);}`);
      const targetEvaluatedAt=new Date().toISOString();
      f.exportData(join(f.checkout,'frontend'),{FINANCIAL_EVALUATED_AT:targetEvaluatedAt});f.targetBase(publicRoot,target);targetBase=read(target);assert.equal(targetBase.rows.length,5901);
      rmSync(publicRoot,{recursive:true,force:true});git(f.checkout,'restore','--worktree','--','frontend/public');
      const priceInput={artifact_id:ACTUAL.pages.artifact_id,artifact_sha256:ACTUAL.pages.artifact_sha256,manifest_sha256:live.manifestHash,price_observations_sha256:priceObservationDigest(live.priceObservations),known_price_dates_sha256:priceObservationDigest(live.knownPriceDates)};
      const financialRequest={schema_version:POSTCAPTURE_RENEWAL_REQUEST,correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:live.identity,source:review.source},
        source_validation:{guard:POSTCAPTURE_SOURCE_GUARD,certificate:review.reference},destination_projection:{projector:'native_annual_destination_v1',policy:'financial-correction-native-annual-v1'}};
      request={schema_version:'financial-source-renewal-request-v1',previous_publication_identity:live.identity,previous_release:live.receipt.financial_release,previous_lineage_sha256:live.financialRelease.lineage_sha256,
        previous_financial_generation:live.financialRelease.financial_generation,origin_release:live.receipt.financial_release,ui:{sha:live.uiSha,digest:live.uiDigest,approval_sha256:digest(live.approval)},
        consumer_code_sha256:digest(consumerCodeInventory(protectedCodeInventory(f.checkout,f.uiSha))),financial_request:financialRequest,
        target:{evaluated_at:targetEvaluatedAt,base_sha256:fileHash(target),manifest_sha256:live.manifestHash,price_observations_sha256:priceInput.price_observations_sha256,known_price_dates_sha256:priceInput.known_price_dates_sha256,universe_sha256:digest(live.verificationUniverse)},price_input:priceInput,maximum_new_receipts:400};
      const trustPath='contracts/financial_source_postcapture_trust_v1.json',trust=read(join(f.checkout,trustPath));assert.deepEqual(trust.reviewed_requests,[]);trust.reviewed_requests.push(review);write(join(f.checkout,trustPath),trust);
      write(join(f.checkout,renewalPolicy.request_path),request);
      const compatibilityRegistryPath='contracts/financial_source_renewal_v1.json',compatibilityRegistry=read(join(f.checkout,compatibilityRegistryPath));
      assert.deepEqual(compatibilityRegistry.reviewed_consumer_transitions,[]);
      consumerTransition=reviewedMain135ConsumerTransition();compatibilityRegistry.reviewed_consumer_transitions.push(consumerTransition);
      write(join(f.checkout,compatibilityRegistryPath),compatibilityRegistry);
      a=f.commit('SYNTHETIC diagnostic A: exact companion, nine-pair controller review and renewal request',[trustPath,renewalPolicy.request_path,compatibilityRegistryPath]);f.ci(a,991400);f.save();
      try{f.certifyCommand('prepare');}finally{
        // Preserve both complete selected targets even when preparation fails.
        // The bounded field report is explanatory and grants no acceptance.
        for(const [name,retained]of [['target-base.json','certified-target-base.json'],['target-base-binding.json','target-base-binding.json']]){
          const path=join(candidate,name);if(existsSync(path))cpSync(path,join(directory,retained),{errorOnExist:true,force:false});
        }
        if(existsSync(join(directory,'certified-target-base.json'))){
          const comparison=compareRenewalTargets(target,join(directory,'certified-target-base.json'),{evaluatedAt:targetEvaluatedAt});
          write(join(directory,'target-base-comparison.json'),comparison);
          report.target_base_comparison=comparison;event('Complete selected target comparison','recorded',{evaluated_at:targetEvaluatedAt,expected_rows:comparison.expected.rows,actual_rows:comparison.actual.rows,exact_bytes_equal:comparison.exact_bytes_equal,differences:comparison.differences});
        }
      }
      assert.equal(report.target_base_comparison?.exact_bytes_equal,true,'complete selected target bytes must match');
      assert.equal(report.target_base_comparison.actual.rows,5901,'complete original target cohort required');
      for(const name of ['verify-source','verify-surfaces','verify-bounds','seal'])f.certifyCommand(name);
      record=read(join(candidate,'candidate.json'));const tar=join(dirname(candidate),'candidate.tar');zip=join(directory,'sealed-renewal.zip');
      invoke('Package real sealed renewal candidate',f.python,['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"x",compression=zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as z:z.write(sys.argv[2],"candidate.tar")',zip,tar]);
      rmSync(tar);
      if(stage==='seal'){
        const syntheticApi=Object.fromEntries(Object.entries(f.api).filter(([key])=>!Object.hasOwn(responses,key)));
        const retained=writeSealedCheckpoint({directory:join(directory,'checkpoint'),runtimeRoot,checkout:f.checkout,zip,candidate,target,actualInputs:report.actual_inputs,sourceReport:{target_base_comparison:report.target_base_comparison},syntheticApi});
        report.retained_checkpoint={sha256:retained.sha256,files:retained.manifest.files,runtime:retained.manifest.runtime,certification:retained.manifest.certification};
        report.outcome='sealed-checkpoint-retained-and-readback-verified';
        for(const [path,sum]of Object.entries(originalControls))assert.equal(fileHash(join(runtimeRoot,path)),sum,`production control changed: ${path}`);
        f.checkpoint('Durably retained exact sealed candidate and checkpoint integrity; lifecycle consumption pending',report.retained_checkpoint);
        return {directory,report};
      }
    }
    const pin={schema_version:'financial-source-renewal-pin-v1',repository:bootstrap.repository,workflow:renewalPolicy.workflow,head_sha:a,run_id:990400,run_attempt:1,job_id:9904000,artifact_id:1050400,
      artifact_name:'financial-source-renewal-990400-1',artifact_sha256:fileHash(zip),candidate_record_sha256:fileHash(stage==='publish'?join(checkpoint,'candidate.json'):join(candidate,'candidate.json')),request_sha256:digest(request)};
    const intent={schema_version:'financial-source-renewal-intent-v1',kind:'same-ui-same-price-financial-source-renewal',request_sha256:digest(request),pin_sha256:digest(pin),previous_publication_identity:live.identity,not_after:new Date(deadline).toISOString()};
    write(join(f.checkout,renewalPolicy.pin_path),pin);write(join(f.checkout,renewalPolicy.intent_path),intent);
    const b=f.commit('SYNTHETIC diagnostic B: sealed candidate pin and explicit intent',[renewalPolicy.pin_path,renewalPolicy.intent_path]);f.ci(b,992400);
    const controllerReview={controller_sha:b,controller_tree:git(f.checkout,'rev-parse',`${b}^{tree}`),certification_sha:a,certification_tree:git(f.checkout,'rev-parse',`${a}^{tree}`),protected_code_sha256:digest(renewalControllerCodeInventory(protectedCodeInventory(f.checkout,b))),
      ...Object.fromEntries(Object.entries({request,pin,intent}).flatMap(([key,value])=>[[`${key}_sha256`,digest(value)],[`${key}_raw_sha256`,fileHash(join(f.checkout,renewalPolicy[`${key}_path`]))]]))};
    const registryPath='contracts/financial_source_renewal_v1.json',registry=read(join(f.checkout,registryPath));registry.publication_enabled=true;registry.reviewed_controllers.push(controllerReview);write(join(f.checkout,registryPath),registry);
    const c=f.commit('SYNTHETIC diagnostic C: finite exact disposable controller review',[registryPath]);f.ci(c,993400);f.setTime(new Date().toISOString());
    const artifact=f.artifact(zip,pin.artifact_id,pin.artifact_name,pin.run_id,a),stamp=f.now;
    f.registration(pin,{run:f.workflow(pin.run_id,renewalPolicy.workflow,a,{event:'workflow_dispatch',start:record.sealed_at}),jobs:[{id:pin.job_id,run_id:pin.run_id,run_attempt:1,head_sha:a,name:renewalPolicy.job,status:'completed',conclusion:'success',started_at:record.sealed_at,completed_at:stamp,steps:renewalPolicy.steps.map(name=>({name,conclusion:'success'}))}],artifacts:[artifact]});
    const prepared={candidate,record,runId:pin.run_id,generation:{name:'actual-companion'},live};
    report.synthetic_authority={a,b,c,pin,review:controllerReview,consumer_transition:consumerTransition};f.checkpoint('Sealed complete actual-data companion renewal',{candidate_record_sha256:pin.candidate_record_sha256,source_delta_sha256:record.source_delta_sha256});
    // The exact sealed ZIP is now the original candidate. Production plan must
    // restore it itself; retaining two expanded candidates exceeds our budget.
    rmSync(candidate,{recursive:true,force:true});
    setRun(990401);write(f.env.GITHUB_EVENT_PATH,{inputs:{financial_source_renewal:JSON.stringify(intent)}});f.restoreReleaseCode();f.save();
    const intentPath=join(f.checkout,renewalPolicy.intent_path),intentBytes=readFileSync(intentPath);rmSync(intentPath);
    try{negative('Reject missing current renewal intent before plan','plan',/complete committed request, pin and explicit intent/);}finally{write(intentPath,intentBytes);}
    write(f.env.GITHUB_EVENT_PATH,{inputs:{financial_source_renewal:JSON.stringify({...intent,pin_sha256:'0'.repeat(64)})}});
    try{negative('Reject wrong explicit renewal intent before plan','plan',/explicit dispatch intent changed/);}finally{write(f.env.GITHUB_EVENT_PATH,{inputs:{financial_source_renewal:JSON.stringify(intent)}});}
    const ciEndpoint=`${prefix}/actions/runs/993400/attempts/1`,ciRecord=f.api[ciEndpoint];f.api[ciEndpoint]={...ciRecord,head_sha:'0'.repeat(40)};
    try{negative('Reject wrong exact current-controller CI head before plan','plan',/controller CI attempt is not successful/);}finally{f.api[ciEndpoint]=ciRecord;f.save();}
    f.command('plan');assert.equal(f.state().decision.mode,'renewal');
    prepared.candidate=f.state().renewal.candidate;releaseConsumedCandidateTar(f.state().renewal.directory);
    f.command('restore');rmSync(join(f.checkout,'release/frontend/public'),{recursive:true,force:true});
    f.command('compose');
    const dist=join(f.checkout,'release/frontend/dist'),renewedPublication=read(join(dist,'publication.json'));
    assert.equal(renewedPublication.ui_digest,live.uiDigest);assert.deepEqual(renewedPublication.ui_files,live.uiFiles);
    assert.deepEqual(renewedPublication.price_observations,live.priceObservations);assert.deepEqual(renewedPublication.known_price_dates,live.knownPriceDates);assert.deepEqual(renewedPublication.verification_universe,live.verificationUniverse);
    write(join(directory,'race-publication.json'),Buffer.concat([readFileSync(join(f.liveRoot,'publication.json')),Buffer.from('\n')]));f.config.racePublicationPath=join(directory,'race-publication.json');
    try{negative('Reject changed predecessor receipt bytes before final logical decode','recheck',/Live UI or data changed; discard this superseded publication/);}finally{delete f.config.racePublicationPath;rmSync(join(directory,'race-publication.json'));f.save();}
    const overlimit=join(dist,'diagnostic-overlimit.bin');write(overlimit,Buffer.alloc(0));truncateSync(overlimit,1_000_000_001);
    try{negative('Reject sparse over-limit completed physical Pages payload','recheck',/Uncompressed site file bytes exceed the 1 GB Pages limit/);}finally{rmSync(overlimit);}
    invoke('Verify final renewed physical and TAR bounds after metadata',f.python,[join(f.checkout,'.github/scripts/check-pages-payload.py'),dist]);
    report.negative_controls=['missing current intent','wrong explicit intent','wrong current-controller CI head','predecessor receipt byte race','physical Pages over-limit'];
    f.command('recheck');f.command('recheck');
    verifyNestedRenewalBytes(f,prepared,dist);
    const renewed=publish(dist,990401,'simulated-renewal');assert.equal(renewed.financialRelease.mode,'renewal');assert.deepEqual(renewed.financialRelease.lineage.source,review.source);assert.deepEqual(renewed.financialRelease.lineage.certificate,review.reference);
    assert.equal(renewed.financialRelease.renewal.origin.sha256,ACTUAL.initial_release_sha256);
    f.checkpoint('Complete publisher renewal passed both rechecks and retained all original audit bytes',{publication_identity:renewed.identity,financial_generation:renewed.financialRelease.financial_generation});
    if(stage==='publish'){
      const syntheticApi=Object.fromEntries(Object.entries(f.api).filter(([key])=>!Object.hasOwn(responses,key)));
      const retained=writePublicationCheckpoint({directory:join(directory,'checkpoint'),runtimeRoot,fixture:f,zip:join(directory,'simulated-renewal.zip'),target,actualInputs:report.actual_inputs,renewed,sealedCheckpointSha256:checkpointSha256,syntheticApi});
      report.retained_checkpoint={sha256:retained.sha256,files:retained.manifest.files,runtime:retained.manifest.runtime,controller:retained.manifest.controller,sealed_checkpoint_sha256:checkpointSha256};
      report.outcome='actual-renewal-publication-retained-and-readback-verified';report.renewed_publication_identity=renewed.identity;
      for(const [path,sum]of Object.entries(originalControls))assert.equal(fileHash(join(runtimeRoot,path)),sum,`production control changed: ${path}`);
      f.checkpoint('Durably retained exact verified renewal publication; ordinary carry pending',report.retained_checkpoint);return {directory,report};
    }
    // Only generated candidate duplicates are released. All five exact input
    // archives and the published renewal remain available throughout the carry.
    rmSync(join(f.env.RUNNER_TEMP,'verified-publication/renewal'),{recursive:true,force:true});rmSync(dirname(candidate),{recursive:true,force:true});
    const carried=await carryActualRenewal(f,{invoke,publish,targetBase,initialRequest,renewed,report,directory,setRun});
    for(const [path,sum]of Object.entries(originalControls))assert.equal(fileHash(join(runtimeRoot,path)),sum,`production control changed: ${path}`);
    report.outcome='actual-99-companion-renewal-and-synthetic-next-price-carry-passed';report.renewed_publication_identity=renewed.identity;report.carried_publication_identity=carried.identity;
    report.final_source_lineage=carried.financialRelease.lineage_sha256;report.maximum_rss_kib=process.resourceUsage().maxRSS;f.checkpoint('Verified complete lifecycle; production registries and initial v2 controls unchanged');
    return {directory,report};
  }catch(error){report.outcome='failed';report.error={message:error.message,stack:error.stack};event('Lifecycle','failed',{error:error.message});throw error;}
}

async function carryActualRenewal(f,{invoke,publish,targetBase,initialRequest,renewed,report,directory,setRun}){
  const previousRoot=f.liveRoot;
  rmSync(join(f.checkout,renewalPolicy.intent_path));f.commit('SYNTHETIC ordinary carry: remove completed renewal intent',[renewalPolicy.intent_path]);f.ci(f.head,994500);
  setRun(990500);write(f.env.GITHUB_EVENT_PATH,{inputs:{}});const frontend=f.restoreReleaseCode(),publicRoot=join(frontend,'public');
  f.evaluate(`import {rmSync} from 'node:fs';import {canonicalPublication} from './.github/scripts/static-transport-publication.mjs';
    const out=${JSON.stringify(publicRoot)};rmSync(out,{recursive:true,force:true});await canonicalPublication({root:${JSON.stringify(previousRoot)},frontendRoot:${JSON.stringify(frontend)},publication:${JSON.stringify(renewed.receipt)},restore:out});rmSync(out+'/publication.json');`);
  const sourceBytes=readFileSync(join(publicRoot,renewed.financialRelease.source_projection.path),'utf8'),historyBytes=readFileSync(join(publicRoot,'static-data/candidate-history/index.json'));
  const advanced=advanceSyntheticPrices(publicRoot,targetBase);f.checkpoint('Appended explicit synthetic prices across the complete real target universe',advanced);
  f.exportData(frontend);assert.deepEqual(readFileSync(join(publicRoot,'static-data/candidate-history/index.json')),historyBytes);
  const zip=f.archive(publicRoot,'synthetic-next-price'),exportRun=990501;f.setTime(new Date().toISOString());
  const asset=f.artifact(zip,1050500,`static-site-data-${exportRun}-1`,exportRun,f.head),manifestBytes=readFileSync(join(publicRoot,'static-data/manifest.json')),
    observations=extractPriceObservations({dataRoot:join(publicRoot,'static-data'),manifest:JSON.parse(manifestBytes)}),metadata=join(directory,'synthetic-next-price.json'),metadataZip=join(directory,'synthetic-next-price-metadata.zip');
  write(metadata,{run_id:exportRun,run_attempt:1,source_sha:f.head,artifact_name:asset.name,manifest_json:manifestBytes.toString(),manifest_sha256:sha256(manifestBytes),price_observations:observations,price_observations_sha256:priceObservationDigest(observations)});
  invoke('Package synthetic price metadata',f.python,['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"x") as z:z.write(sys.argv[2],"source.json")',metadataZip,metadata]);
  const companion=f.artifact(metadataZip,1050501,`static-site-data-manifest-${exportRun}-1`,exportRun,f.head),stamp=f.now;
  f.registration({run_id:exportRun,run_attempt:1},{run:f.workflow(exportRun,'.github/workflows/static-site.yml',f.head,{event:'schedule',start:stamp}),
    jobs:[{id:exportRun*10,name:'combine-and-build',run_id:exportRun,run_attempt:1,head_sha:f.head,status:'completed',conclusion:'success',started_at:stamp,completed_at:stamp,steps:[{name:'Build static frontend',conclusion:'success'}]}],artifacts:[asset,companion]});
  f.api[`${prefix}/actions/artifacts?per_page=100`]=[{artifacts:[asset,companion]}];f.save();rmSync(publicRoot,{recursive:true,force:true});
  f.command('plan');f.command('restore');
  // The real restorer has verified every TAR byte and materialized its complete
  // mutable data. No later carry phase reads this generated transport TAR.
  rmSync(join(f.env.RUNNER_TEMP,'verified-publication',`artifact-${asset.id}`,'artifact.tar'));
  f.command('prepare-carry');
  const state=f.state();assert.ok(state.carry);assert.equal(state.activation,undefined);assert.equal(state.renewal,undefined);
  const carry=read(state.carry.projectionPath),sourceProjection=JSON.parse(sourceBytes);
  assertOriginalFinancialClocks(sourceBytes,carry,state.carry.evaluatedAt);
  const sourceSymbols=Object.keys(sourceProjection.symbols),counts={};
  for(const status of Object.values(carry.ownership))counts[status]=(counts[status]||0)+1;
  const downgraded=sourceSymbols.filter(symbol=>carry.ownership[symbol]!=='retained').map(symbol=>({symbol,status:carry.ownership[symbol]}));
  assert.equal(sourceSymbols.length,1894);assert.equal(Object.keys(carry.ownership).length,5901);
  assert.deepEqual(downgraded,[{symbol:'RH',status:'unverified_issuer_identity'}]);
  assert.equal(counts.retained,1893);assert.equal(counts.unowned_symbol,4007);
  report.carry_ownership={source_cohort_symbols:sourceSymbols.length,target_rows:targetBase.rows.length,counts,source_cohort_downgrades:downgraded,
    retained_source_receipt_and_proof_clocks_unchanged:true,unowned_and_downgraded_finances:'unknown; no raw alias fallback'};
  f.checkpoint('Quantified real source-cohort carry retention and conservative RH downgrade',report.carry_ownership);
  const expiryReport=join(directory,'carry-expiry-proof.json');
  f.evaluate(`import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
    import {overlayFinancialCorrection} from ${JSON.stringify(pathToFileURL(join(frontend,'tools/financial-correction-overlay.mjs')).href)};
    import {projectFinancialRow} from ${JSON.stringify(pathToFileURL(join(frontend,'src/static/financialCurrent.js')).href)};
    import {decodeResearchIndex} from ${JSON.stringify(pathToFileURL(join(frontend,'src/static/researchTransport.js')).href)};
    const carry=JSON.parse(readFileSync(${JSON.stringify(state.carry.projectionPath)})),baseline=${JSON.stringify(state.carry.baseline)},manifest=JSON.parse(readFileSync(baseline+'/static-data/manifest.json'));
    const base=decodeResearchIndex(JSON.parse(readFileSync(baseline+'/static-data/'+manifest.markets.US.assets.research.path)));
    assert.equal(base.as_of_date,${JSON.stringify(advanced.date)});
    const row=overlayFinancialCorrection({...base.rows.find(row=>row.symbol==='NVDA'),eps_growth_yy:999999,sales_growth_yy:999999},carry);
    const expiry=Math.max(...Object.values(carry.symbols.NVDA.financial_current.p).map(proof=>proof[5]));assert.ok(Number.isFinite(expiry));
    const fresh=projectFinancialRow(row,{asOfDate:${JSON.stringify(advanced.date)},market:'US',now:Date.now()}),expired=projectFinancialRow(row,{asOfDate:${JSON.stringify(advanced.date)},market:'US',now:expiry+1});
    for(const field of ['eps_growth_yy','sales_growth_yy']){assert.equal(fresh.financial_current_state.fields[field].availability,'current');assert.equal(expired.financial_current_state.fields[field].availability,'unknown');assert.equal(expired[field],null);}
    writeFileSync(${JSON.stringify(expiryReport)},JSON.stringify({symbol:'NVDA',fresh_eps_availability:'current',expired_eps_availability:'unknown',expired_sales_availability:'unknown',expired_raw_alias_fallback:false,hypothetical_expiry_evaluation:expiry+1,source_bytes_and_clocks_unchanged:true}));`);
  report.expiry_proof=read(expiryReport);report.negative_controls.push('expired retained proof rejects raw financial aliases');
  const carryEnv=Object.fromEntries(readFileSync(f.env.GITHUB_ENV,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
  f.exportData(frontend,carryEnv);invoke('Record ordinary next-price history',process.execPath,['tools/record-candidate-history.mjs'],{cwd:frontend,extra:carryEnv});
  const dist=join(frontend,'dist');rmSync(dist,{recursive:true,force:true});renameSync(publicRoot,dist);
  for(const path of Object.keys(renewed.uiFiles)){mkdirSync(dirname(join(dist,path)),{recursive:true});cpSync(join(previousRoot,path),join(dist,path));}
  for(const name of ['compose','recheck','recheck'])f.command(name);
  invoke('Verify final carried physical and TAR bounds after metadata',f.python,[join(f.checkout,'.github/scripts/check-pages-payload.py'),dist]);
  const proofPath=join(directory,'carry-retained-byte-proof.json');
  f.evaluate(`import assert from 'node:assert/strict';import {readFileSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';
    import {verifyTransportPublication} from './.github/scripts/static-transport-publication.mjs';import {AUDIT_TRANSPORT_PREFIX} from './.github/scripts/financial-audit-transport.mjs';import {sha256} from './.github/scripts/publication-state.mjs';
    import {verify} from ${JSON.stringify(pathToFileURL(join(frontend,'tools/static-transport/verify.mjs')).href)};
    import {decodeResearchIndex} from ${JSON.stringify(pathToFileURL(join(frontend,'src/static/researchTransport.js')).href)};
    const before=${JSON.stringify(previousRoot)},after=${JSON.stringify(dist)},old=${JSON.stringify(renewed.receipt)},publication=JSON.parse(readFileSync(join(after,'publication.json'))),restore=${JSON.stringify(join(directory,'carry-logical-proof'))};
    rmSync(restore,{recursive:true,force:true});try{
      const checked=await verifyTransportPublication({root:after,frontendRoot:${JSON.stringify(frontend)},publication,restore});assert.ok(checked.auditTransport);
      for(const [path,sum]of Object.entries(old.financial_audit_files))assert.equal(publication.financial_audit_files[path],sum,'carry changed retained original audit');
      const priorAudit=await verify({packed:join(before,AUDIT_TRANSPORT_PREFIX),expectedRoot:old.financial_audit_transport.root});
      const source=${JSON.stringify(renewed.financialRelease.source_projection)};assert.equal(sha256(readFileSync(join(restore,source.path))),source.sha256);
      const manifest=JSON.parse(readFileSync(join(restore,'static-data/manifest.json'))),rows=decodeResearchIndex(JSON.parse(readFileSync(join(restore,'static-data',manifest.markets.US.assets.research.path)))).rows;
      assert.deepEqual(rows.map(r=>r.symbol).sort(),${JSON.stringify(targetBase.rows.map(row=>row.symbol).sort())});
      const history=JSON.parse(readFileSync(join(restore,'static-data/candidate-history/index.json'))),prior=${historyBytes.toString()};assert.deepEqual(history.snapshots.slice(0,prior.snapshots.length),prior.snapshots);
      let payloads=0;for(const [path,entry]of Object.entries(priorAudit.physicalInventory))if(path.startsWith('static-data/_transport/gzip/')){
        assert.equal(checked.auditTransport.physicalInventory[path]?.sha256,entry.sha256,'carry changed retained compressed payload hash');
        assert.deepEqual(readFileSync(join(after,AUDIT_TRANSPORT_PREFIX,path)),readFileSync(join(before,AUDIT_TRANSPORT_PREFIX,path)),'carry changed retained compressed payload bytes');payloads++;
      }
      assert.ok(payloads>0,'no retained inner compressed payloads were compared');
      writeFileSync(${JSON.stringify(proofPath)},JSON.stringify({retained_audit_files:Object.keys(old.financial_audit_files).length,retained_inner_payloads:payloads,complete_target_rows:rows.length,original_source_bytes_unchanged:true,original_financial_clocks_unchanged:true,historical_snapshots_retained:true}));
    }finally{rmSync(restore,{recursive:true,force:true});}`);
  const carried=publish(dist,990500,'simulated-carry');assert.equal(carried.financialRelease.mode,'carry');
  for(const key of ['lineage','source_projection','source_base','renewal'])assert.deepEqual(carried.financialRelease[key],renewed.financialRelease[key]);
  assert.equal(carried.uiDigest,renewed.uiDigest);assert.deepEqual(carried.uiFiles,renewed.uiFiles);assert.deepEqual(carried.approval,renewed.approval);
  assert.deepEqual(readFileSync(join(f.checkout,financialReleasePolicy.request_path)),initialRequest);
  for(const symbol of advanced.advanced_symbols)assert.equal(carried.priceObservations[JSON.stringify(['US','chart',symbol])],advanced.date);
  assert.equal(existsSync(join(f.checkout,renewalPolicy.intent_path)),false);
  f.checkpoint('Ordinary carry passed real compiler, both final rechecks and historical renewal authority after intent removal',{publication_identity:carried.identity,...read(proofPath)});return carried;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={};let input;
  for(let i=0;i<args.length;i++){const key=args[i];assert.ok(['--inputs','--output','--runtime-root','--node-modules','--python','--stage','--checkpoint','--checkpoint-sha256'].includes(key)&&args[i+1],`Unknown or incomplete option ${key}`);const value=args[++i];if(key==='--inputs')input=value;else options[{'--output':'output','--runtime-root':'runtimeRoot','--node-modules':'nodeModules','--python':'python','--stage':'stage','--checkpoint':'checkpoint','--checkpoint-sha256':'checkpointSha256'}[key]]=value;}
  assert.ok(input,'Usage: postcapture-pages-rehearsal.mjs --inputs INPUT_JSON --output NEW_DIRECTORY');
  console.log(JSON.stringify(await runPostcapturePagesRehearsal(input,options)));
}
