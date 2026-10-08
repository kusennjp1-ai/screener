// Exact A11 source FUTU capture-only diagnostic. Not the unavailable composed A11 output.
// No carried financial, application UI/CSV, full-quality or publication authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,rmSync,statfsSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {inventoryDigest,uiInventory} from './publication-state.mjs';
import {previewPublication,transportDescriptor,validateTransportPreview} from './static-transport-publication.mjs';

const SOURCE={run_id:37796977804,run_attempt:1,head_sha:'f4e00a1c840cb15b2b4a84c2ca442c0dbd60a607',artifact_id:11559992871,artifact_bytes:318517277,artifact_sha256:'a48c7653cf6fce0fb5915146b68d218c333b9764521407847353321886f65690'};
const UI={sha:'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',tree:'1c0219a170dcbdeb1af539e4cf7a04018251ca02',frontend_tree:'0ba620a84264e1ff026898beed3fbc8ad5894618'};
const CODE={candidate:'385ca311d0b0d26d76f0bab2826a5114bf15a368',candidate_tests:'f026057acb54bbf2fb61095cfbb9d421c8031e5d',control:'096506586e6bb8db095b41c9caf2ae0419a26917',observer:'fde092e9a7471bdfe6d77193f5419af40cdedd08',pack:'50dc1464c810dec2faf4a899cc2d67eb07c5b981',codec:'a75476fc51e86c0a42639c91d6f6790fabd3337f',verify:'9fc86b39d2b192f443b4acff02dabf86431fd3c0',format:'acabf63305082f8d2a2217e0b76db5ad6afadcff'};
const ROOT=resolve(process.env.RUNNER_TEMP,'oct6-actual-futu-capture'),REPORT=join(ROOT,'reports'),FRONT=resolve('release/frontend'),SOURCE_ROOT=join(ROOT,'source');
const CAP=64*1024**2,RESERVE=8n*1024n**3n,REPETITIONS=32;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const blob=raw=>createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
const regular=(path,cap=CAP)=>{const s=lstatSync(path);assert(s.isFile()&&!s.isSymbolicLink()&&realpathSync(path)===resolve(path)&&s.size<=cap,'Unsafe/oversized input '+path);return readFileSync(path);};
const parse=path=>JSON.parse(regular(path));
const safe=path=>typeof path==='string'&&/^[A-Za-z0-9_.\/-]+$/.test(path)&&!path.startsWith('/')&&path.split('/').every(x=>x&&x!=='.'&&x!=='..');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024**2,timeout:120000}).trim();
const report={schema_version:'oct6-actual-futu-capture-v1',status:'running',publication_authority:'none',source_authority:'historical authenticated A11 source input only',
 scope:'Capture primitive only. Unchanged A11 source FUTU logical bytes are newly encoded in a diagnostic transport fixture. This is not A11 composed output or carried financial, application UI, CSV, full-quality, source replay or publication acceptance.',
 source:SOURCE,decoder_source:UI,code:CODE,started_at:new Date().toISOString(),conditions:[],resource_checks:[],network_denials:[],network_cases:[]};
function reserve(extra,label){const disk=statfsSync(ROOT,{bigint:true});const needed=((BigInt(extra)+disk.bsize-1n)/disk.bsize)*disk.bsize,free=disk.bavail*disk.bsize;report.resource_checks.push({label,free_bytes:String(free),needed_bytes:String(needed),reserve_bytes:String(RESERVE)});assert(free>=RESERVE+needed,'Eight GiB reserve exceeded: '+label);}
function save(){const raw=JSON.stringify(report,null,2)+'\n';assert(Buffer.byteLength(raw)<=4*1024**2,'Capture evidence exceeds4MiB print bound within unchanged8MiB report cap');reserve(Buffer.byteLength(raw),'bounded report');writeFileSync(join(REPORT,'capture-report.json'),raw);}
function verifyDecoderCheckout(){
 assert.equal(git(dirname(FRONT),'rev-parse','HEAD'),UI.sha);assert.equal(git(dirname(FRONT),'rev-parse','HEAD^{tree}'),UI.tree);assert.equal(git(dirname(FRONT),'rev-parse','HEAD:frontend'),UI.frontend_tree);
 for(const line of execFileSync('git',['-C',dirname(FRONT),'ls-tree','-r','-z','HEAD','frontend/src/static','frontend/tools/static-transport','frontend/tools/design-static-assets.mjs','frontend/package.json','frontend/package-lock.json','.github/scripts','contracts'],{encoding:'utf8',maxBuffer:32*1024**2}).split('\0').filter(Boolean)){
  const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert(m&&safe(m[3]),'Unexpected pinned decoder source');assert.equal(blob(regular(join(dirname(FRONT),m[3]))),m[2],'Pinned decoder changed '+m[3]);
 }
 assert.equal(blob(regular(join(FRONT,'tools/design-static-assets.mjs'))),CODE.observer);
 assert.equal(blob(regular(join(FRONT,'tools/static-transport/pack.mjs'))),CODE.pack);
 assert.equal(blob(regular(join(FRONT,'src/static/transport/codec.mjs'))),CODE.codec);
 assert.equal(blob(regular(join(FRONT,'tools/static-transport/verify.mjs'))),CODE.verify);
 assert.equal(blob(regular(join(FRONT,'src/static/transport/format.mjs'))),CODE.format);
}
async function main(){
 assert.equal(process.argv.length,2,'Capture diagnostic accepts no caller inputs');assert.equal(process.execArgv.length,0,'No loader/clock hooks');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'Capture uses default Node; no options or loader overrides');
 assert.equal(process.env.GITHUB_REPOSITORY,'kusennjp1-ai/screener');assert.equal(process.env.GITHUB_REF,'refs/heads/preview/oct6-actual-futu-capture-20261008');assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(git(process.cwd(),'rev-parse','HEAD^'),'b464cd32691853b7128189f4e3350b74959468bb');
 verifyDecoderCheckout();assert.equal(blob(regular(resolve('.github/scripts/retained-price-source-browser.mjs'))),CODE.candidate);assert.equal(blob(regular(resolve('.github/scripts/retained-price-source-browser.test.mjs'))),CODE.candidate_tests);
 const acquisitionRaw=regular(join(REPORT,'acquisition-result.json')),acquisition=JSON.parse(acquisitionRaw);
 assert.equal(acquisition.status,'passed');assert.equal(acquisition.publication_authority,'none');assert.equal(acquisition.result.complete_physical_inventory_verified,true);
 assert.equal(acquisition.source.artifact,SOURCE.artifact_id);assert.equal(acquisition.source.sha256,SOURCE.artifact_sha256);
 const inventoryRaw=regular(join(ROOT,'inputs/verified-dist-inventory.json')),inventory=JSON.parse(inventoryRaw);assert.equal(sha(inventoryRaw),acquisition.result.inventory_sha256);
 const metadataRaw=regular(join(ROOT,'inputs/source.json'));assert.equal(metadataRaw.length,acquisition.companion_json.bytes);assert.equal(sha(metadataRaw),acquisition.companion_json.sha256);
 const metadata=JSON.parse(metadataRaw),manifestRaw=regular(join(SOURCE_ROOT,'static-data/manifest.json')),manifest=JSON.parse(manifestRaw);
 assert.equal(sha(manifestRaw),acquisition.result.source_manifest_sha256);assert.equal(sha(manifestRaw),metadata.manifest_sha256);assert.equal(manifestRaw.toString('utf8'),metadata.manifest_json);
 const checkFile=relative=>{assert(safe(relative),'Unsafe declared source path');const path=resolve(SOURCE_ROOT,relative);assert(path.startsWith(SOURCE_ROOT+sep));const raw=regular(path),pin=inventory[relative];assert(pin&&pin.bytes===raw.length&&pin.sha256===sha(raw),'Selected source body changed '+relative);return raw;};
 const research=manifest.markets?.US?.assets?.research?.path;assert(safe(research),'Missing declared Research path');
 const {decodeResearchIndex}=await import(pathToFileURL(join(FRONT,'src/static/researchTransport.js')).href);
 const index=decodeResearchIndex(JSON.parse(checkFile('static-data/'+research)));
 assert.equal(index.as_of_date,'2026-10-06');const matches=index.rows.filter(row=>row.symbol==='FUTU');assert.equal(matches.length,1,'Declared FUTU membership is not unique');
 const row=matches[0],logical=row.research_detail_path;assert(safe(logical)&&logical.startsWith('research-details/'),'Missing declared FUTU detail path');
 const raw=checkFile('static-data/'+logical),value=JSON.parse(raw);assert.equal(value.symbol,'FUTU');assert.equal(value.as_of_date,'2026-10-06');
 report.source_selection={source_manifest_sha256:sha(manifestRaw),source_research_path:research,source_research_sha256:inventory['static-data/'+research].sha256,logical_path:logical,bytes:raw.length,sha256:sha(raw),acquisition_report_sha256:sha(acquisitionRaw),source_file_unchanged:true};
 const input=join(ROOT,'probe-input'),packed=join(ROOT,'probe-packed');assert(!existsSync(input)&&!existsSync(packed),'Probe destinations must be new');reserve(4*raw.length+16*1024**2,'bounded single-member fixture');mkdirSync(join(input,'static-data',dirname(logical)),{recursive:true});
 copyFileSync(join(SOURCE_ROOT,'static-data',logical),join(input,'static-data',logical));
 // This fixture bootstrap is deliberately not the authentic source/application manifest.
 const probeManifest={schema_version:'oct6-single-asset-capture-fixture-v1',publication_authority:'none',scope:'One authenticated source logical asset; not an application bundle',source_manifest_sha256:sha(manifestRaw),logical_path:logical,financial_generation:null};
 const probeManifestRaw=JSON.stringify(probeManifest);writeFileSync(join(input,'static-data/manifest.json'),probeManifestRaw);
 writeFileSync(join(input,'capture.html'),'<!doctype html><meta charset="utf-8"><title>Actual source capture diagnostic</title><p>Capture-only diagnostic driver.</p>');
 const uiDigest=inventoryDigest(uiInventory(input)),bindings={manifestSha256:sha(probeManifestRaw),uiInventorySha256:uiDigest,financialGeneration:null,financialLineageSha256:null,sourceCommit:process.env.GITHUB_SHA,appCommit:process.env.GITHUB_SHA,candidateId:sha(acquisitionRaw)};
 const {pack}=await import(pathToFileURL(join(FRONT,'tools/static-transport/pack.mjs')).href),{verify}=await import(pathToFileURL(join(FRONT,'tools/static-transport/verify.mjs')).href);
 const packedResult=await pack({source:input,output:packed,bindings});const checked=await verify({packed,expectedRoot:packedResult.expectedRoot,source:input});
 const publication=previewPublication({uiSha:process.env.GITHUB_SHA,uiDigest,manifestSha256:sha(probeManifestRaw)});publication.transport=transportDescriptor(checked,{uiSha:process.env.GITHUB_SHA,uiDigest});validateTransportPreview(publication);writeFileSync(join(packed,'publication.json'),JSON.stringify(publication));
 report.probe={fixture_manifest_sha256:sha(probeManifestRaw),fixture_manifest_is_source_manifest:false,application_ui_asserted:false,financial_authority:null,transport_root:publication.transport.root,logical_files:checked.logicalFiles,physical_bytes:checked.physicalBytes};
 const gzipEntries=Object.entries(checked.physicalInventory).filter(([path])=>path.startsWith('static-data/_transport/gzip/'));assert.equal(gzipEntries.length,1);
 const [probePhysical,probePin]=gzipEntries[0];assert(probePin.bytes<=CAP);
 const physicalBytes=Object.values(checked.physicalInventory).reduce((sum,pin)=>sum+pin.bytes,0),publicationBytes=Buffer.byteLength(JSON.stringify(publication)),htmlBytes=regular(join(packed,'capture.html')).length;
 const plannedRequests=2*(Object.keys(checked.physicalInventory).length+2+REPETITIONS*3);
 const plannedBytes=2*(physicalBytes+publicationBytes+REPETITIONS*(htmlBytes+probePin.bytes));
 assert(plannedRequests<=4000&&plannedBytes<=512*1024**2,'Fixed two-condition probe plan exceeds aggregate request/served-byte bounds');
 report.aggregate_plan={conditions:2,requests_upper_bound:plannedRequests,served_bytes_upper_bound:plannedBytes,request_cap:4000,served_bytes_cap:512*1024**2,
  basis:'All physical metadata/assets once per condition plus publication/HEAD and each fresh-context fixture HTML, payload and optional404favicon; actual counters are also checked after every case.'};
 const checkAggregate=()=>{const totals=report.conditions.reduce((sum,item)=>({requests:sum.requests+(item.server?.requests||0),served_bytes:sum.served_bytes+(item.server?.served_bytes||0)}),{requests:0,served_bytes:0});assert(totals.requests<=4000&&totals.served_bytes<=512*1024**2,'Aggregate two-condition server bounds exceeded');report.aggregate_actual=totals;};

 const {createDesignAssetObserver}=await import(pathToFileURL(join(FRONT,'tools/design-static-assets.mjs')).href);
 const candidate=await import(pathToFileURL(resolve('.github/scripts/retained-price-source-browser.mjs')).href);
 assert.deepEqual(candidate.BROWSER_LIMITS,{milliseconds:360000,csvBytes:8*1024**2,reportBytes:8*1024**2,screenshotBytes:8*1024**2,fileBytes:64*1024**2,servedBytes:512*1024**2,requests:4000});
 const sibling=resolve('.github/scripts/.oct6-actual-futu-control.mjs');assert(!existsSync(sibling));const controlRaw=execFileSync('git',['cat-file','blob',CODE.control],{maxBuffer:CAP});assert.equal(blob(controlRaw),CODE.control);writeFileSync(sibling,controlRaw,{flag:'wx'});
 let browser,timer;try{
  const control=await import(pathToFileURL(sibling).href),require=createRequire(join(FRONT,'package.json'));assert.equal(require('playwright/package.json').version,'1.59.1');
  const core=dirname(require.resolve('playwright-core/package.json')),chromiumInfo=JSON.parse(regular(join(core,'browsers.json'))).browsers.find(item=>item.name==='chromium');assert(chromiumInfo&&chromiumInfo.browserVersion.startsWith('147.'));
  browser=await require('playwright').chromium.launch({headless:true});assert.equal(browser.version(),chromiumInfo.browserVersion);report.runtime={node:process.version,playwright:'1.59.1',chromium:browser.version(),revision:chromiumInfo.revision,exec_argv:process.execArgv,node_options_present:false};
  const run=async()=>{
   for(const [label,serverModule,header]of [['baseline-no-store',control,'no-store'],['candidate-no-cache',candidate,'no-cache']]){
    const condition={label,server_blob:label==='baseline-no-store'?CODE.control:CODE.candidate,expected_header:header,repetitions:REPETITIONS,captures:[],protocol_failures:[]};report.conditions.push(condition);save();
    let server,assets;try{
     server=await serverModule.startReleaseServer(packed);const origin=server.origin,baseURL=origin+'/screener/';
     const head=await fetch(baseURL+'capture.html',{method:'HEAD',cache:'no-cache'});assert(head.ok&&head.headers.get('cache-control')===header);assert.equal((await head.arrayBuffer()).byteLength,0);
     assets=await createDesignAssetObserver({baseURL,fetchImpl:(url,options)=>{assert(serverModule.localBrowserUrl(url,origin));return fetch(url,{...options,signal:AbortSignal.timeout(45000)});}});
     assert(assets.packed);const expected=await assets.readJson(logical);assert.deepEqual(expected,value);
     for(let iteration=0;iteration<REPETITIONS;iteration++){
      let page,context,session,native=null;const gate=serverModule.createBrowserNetworkGate({origin,getPage:()=>page,denials:report.network_denials,symbol:'FUTU-'+label+'-'+iteration});report.network_cases.push(gate.evidence);
      try{
       context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',gate.route);await context.routeWebSocket('**/*',gate.routeWebSocket);page=await context.newPage();session=await gate.attach(context,page);page.setDefaultTimeout(45000);
       const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(baseURL+'capture.html');
       // Keep the literal approved observer; never patch it or synthesize a missing response.
       // The physical path is content-addressed by the exact bytes encoded above.
       const physical=probePhysical,pin=probePin,expectedEncoded=pin.sha256,url=new URL(physical,baseURL).href;
       try{
        const observed=await assets.observeJson(page,logical,async()=>{
         native=await page.evaluate(async({url,cap})=>{
          const response=await fetch(url,{cache:'force-cache',redirect:'error',headers:{Accept:'application/octet-stream'}});const reader=response.body.getReader(),parts=[];let size=0;
          try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>cap)throw Error('Native encoded byte cap exceeded');parts.push(new Uint8Array(value));}}
          finally{reader.releaseLock();}
          const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
          const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
          return {status:response.status,bytes:size,sha256:digest,eof:true,cache_control:response.headers.get('cache-control')};
         },{url,cap:CAP});
         assert(native.eof&&native.status===200&&native.bytes===pin.bytes&&native.sha256===expectedEncoded&&native.cache_control===header,'Native page response differs from exact encoded source');
        });
        assert.deepEqual(observed.value,value);assert.equal(observed.observation.decoded_bytes,raw.length);assert.equal(observed.observation.decoded_sha256,sha(raw));assert.equal(observed.observation.physical_path,physical);assert.equal(observed.observation.kind,'gzip');assert.equal(observed.observation.source,'actual browser response');
        condition.captures.push({iteration,native,observation:observed.observation,encoded_bytes:pin.bytes,encoded_sha256:expectedEncoded});
       }catch(error){
        const exact=/Protocol error \(Network\.getResponseBody\): No data found for resource with given identifier/.test(error.message);
        if(label!=='baseline-no-store'||!exact)throw error;
        assert(native?.eof&&native.status===200&&native.bytes===pin.bytes&&native.sha256===expectedEncoded,'Baseline failure occurred before exact native EOF/hash');
        condition.protocol_failures.push({iteration,error:error.message.slice(0,2048),native,physical_path:physical,encoded_bytes:pin.bytes,encoded_sha256:expectedEncoded});
       }
       assert.equal(errors.length,0,'Probe page runtime errors');await context.close();context=null;gate.assertClean();condition.server=server.stats();checkAggregate();save();
      }finally{if(context)await context.close();}
     }
     condition.completed=true;condition.server=server.stats();checkAggregate();assert.equal(condition.server.failures.length,0,'Shared server rejected a request');condition.control_reproduced=condition.protocol_failures.length>0;
     if(label==='candidate-no-cache')assert.equal(condition.captures.length,REPETITIONS,'Candidate did not capture every response');
    }finally{assets?.dispose();if(server){await server.close();condition.server=server.stats();checkAggregate();}}
   }
  };
  await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Unchanged6-minute actual capture deadline exceeded')),360000);})]);
  assert.equal(sha(checkFile('static-data/'+logical)),report.source_selection.sha256);assert.equal(blob(regular(resolve('.github/scripts/retained-price-source-browser.mjs'))),CODE.candidate);verifyDecoderCheckout();
  report.status='passed';report.note='Baseline protocol failures remain recorded, never retried. A successful candidate capture is not application/financial/CSV/publication acceptance.';
 }finally{clearTimeout(timer);if(browser)await browser.close();rmSync(sibling,{force:true});}
}
main().catch(error=>{report.status='failed';report.error=(error.stack||String(error)).slice(0,8192);process.exitCode=1;}).finally(()=>{report.finished_at=new Date().toISOString();save();});
