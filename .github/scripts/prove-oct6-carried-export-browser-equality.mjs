// Bounded Vite-only builds over one already-verified current bundle.
// Exporter execution, composition, deployment and browser/CSV acceptance are outside this proof.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,readFileSync,readdirSync,rmSync,statfsSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {verifyDiagnosticTooling} from './install-oct6-carried-export-tooling.mjs';
import {verifyPublisherToolingCheckout} from './retained-price-publisher-tooling.mjs';
const work=join(process.env.RUNNER_TEMP,'carry-identity-diagnostic'),reports=join(work,'reports'),front=resolve('release/frontend'),checkout=resolve('release'),publicRoot=join(front,'public'),dist=join(work,'paired-vite-dist');
const receiptPath=join(process.env.RUNNER_TEMP,'oct6-tooling-provenance/installation.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const pin=bytes=>({git_blob:blob(bytes),bytes:bytes.length,sha256:sha(bytes)});
const BEFORE={git_blob:'dac7f8784a0bc836ab6977e1e88ca643c49c01ed',bytes:23200,sha256:'90e9f7316b34f171a726bc9245805e67e8d316b7367e288924ce568583fc3946'};
const AFTER={git_blob:'1f630be308dd2ce604c26635c3d67243c7e48944',bytes:23247,sha256:'f9e0ad58f7bbaf911eab2943fcfb18df32f6ee881c3847272f5201e448d9cf40'};
const exporter=join(front,'tools/export-research.mjs'),fixture=resolve('.github/scripts/fixtures/publisher-export-research-oct6-carry-v1.mjs'),after=readFileSync(fixture);
const report={schema_version:'oct6-paired-vite-diagnostic-v1',status:'running',started_at:new Date().toISOString(),scope:'genuine Vite-only compile and complete paired dist equality over the same current public data and environment; no composition, publication, browser or CSV acceptance authority',builds:[],resource_checks:[]};
function reserve(extra,label){const disk=statfsSync(work,{bigint:true}),needed=((BigInt(extra)+disk.bsize-1n)/disk.bsize)*disk.bsize,available=disk.bavail*disk.bsize;report.resource_checks.push({label,available_bytes:String(available),required_bytes:String(needed),reserve_bytes:String(8n*1024n**3n)});assert.ok(available>=needed+8n*1024n**3n,'Eight GiB reserve would be exceeded: '+label);}
function budget(root){const block=statfsSync(work,{bigint:true}).bsize;let allocated=block,files=0,logical=0n;function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory()){allocated+=block;walk(path);}else{assert.ok(entry.isFile(),'Linked or special input');const size=lstatSync(path,{bigint:true}).size;allocated+=((size+block-1n)/block)*block;logical+=size;files++;}}}walk(root);return {allocated,files,logical};}
function inventory(root){const value={};function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else{assert.ok(entry.isFile(),'Linked or special inventory member');const raw=readFileSync(path);value[relative(root,path).split(sep).join('/')]={bytes:raw.length,sha256:sha(raw)};}}}walk(root);return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0));}
function save(name,value){const raw=JSON.stringify(value,null,2)+'\n';reserve(Buffer.byteLength(raw),'save '+name);writeFileSync(join(reports,name),raw);return {path:name,bytes:Buffer.byteLength(raw),sha256:sha(raw)};}
function checkpoint(){save('paired-vite-report.json',report);console.log('PAIRED_VITE_DIAGNOSTIC '+JSON.stringify({status:report.status,builds:report.builds,complete_dist_equal:report.complete_dist_equal,public_data_unchanged:report.public_data_unchanged,error:report.error}));}
try{
 assert.deepEqual(pin(after),AFTER);
 const qualityBytes=readFileSync(join(reports,'identity/report.json')),quality=JSON.parse(qualityBytes);
 assert.equal(quality.result,'passed','Complete current proof must succeed before browser compilation');
 assert.equal(quality.current.data_quality,'passed');assert.equal(quality.current.verify_carried_bundle,'passed');
 assert.equal(quality.current.default_node_proof.status,'passed');
 assert.equal(quality.tooling_provenance.no_unrelated_source_changes,true);
 report.current_proof={report_sha256:sha(qualityBytes),evaluated_at:quality.current.evaluated_at,full_data_quality:'passed',full_verify_carried_bundle:'passed',default_node:'passed'};
 const before=execFileSync('git',['-C',checkout,'show','1e1943e1d5f78a738a05baa69eb9f2e8508e32ac:frontend/tools/export-research.mjs']);
 assert.deepEqual(pin(before),BEFORE);
 const initial=verifyDiagnosticTooling(front,receiptPath);report.original_browser_base=initial.receipt.original_browser_base;report.modified_publisher_data_tool=initial.receipt.modified_publisher_data_tool;
 const viteConfig=readFileSync(join(front,'vite.config.js'));assert.equal(blob(viteConfig),'47d43acafde635f86e2033ea8f89e764c057656b');
 assert.equal(blob(readFileSync(join(front,'package.json'))),'81dab927e85fea4031e3bca6e9751b6007b613f8');
 assert.equal(blob(readFileSync(join(front,'package-lock.json'))),'3533b0f6ff61b73235da8765bccbdc754add0294');
 report.vite_config={git_blob:blob(viteConfig),sha256:sha(viteConfig),reviewed_hooks:['react','precache-manifest'],exporter_invocation:false};
 const env={...process.env};delete env.NODE_OPTIONS;
 assert.equal(env.VITE_STATIC_SITE,'true');assert.equal(env.VITE_BASE_PATH,'/screener/');
 const viteEnv=Object.fromEntries(Object.entries(env).filter(([key])=>key.startsWith('VITE_')).sort(([a],[b])=>a<b?-1:a>b?1:0));
 report.shared_environment={vite_variables:Object.keys(viteEnv),vite_values_sha256:sha(JSON.stringify(viteEnv)),node_options_present:Object.hasOwn(env,'NODE_OPTIONS'),node:process.version};
 const originalPublic=inventory(publicRoot);report.current_public_inventory=save('paired-vite-current-public-inventory.json',originalPublic);
 const outputs=[];
 for(const [label,code,expected]of [['original-tooling',before,BEFORE],['amended-tooling',after,AFTER]]){
  rmSync(dist,{recursive:true,force:true});reserve(0,'after prior dist cleanup');
  writeFileSync(exporter,code);verifyDiagnosticTooling(front,receiptPath,{expectedExporter:expected});verifyPublisherToolingCheckout(front,{amended:label==='amended-tooling'});
  assert.deepEqual(inventory(publicRoot),originalPublic,'Public input changed between paired builds');
  const copy=budget(publicRoot);reserve(copy.allocated+256n*1024n**2n,'Vite public output and compile scratch');
  const entry={label,exporter:expected,status:'running',started_at:new Date().toISOString(),public_input_sha256:report.current_public_inventory.sha256,public_files:copy.files,public_logical_bytes:String(copy.logical),
   command:['node','node_modules/vite/bin/vite.js','build','--outDir',dist,'--emptyOutDir'],node_options_present:Object.hasOwn(env,'NODE_OPTIONS')};
  report.builds.push(entry);checkpoint();
  const child=spawnSync(process.execPath,[join(front,'node_modules/vite/bin/vite.js'),'build','--outDir',dist,'--emptyOutDir'],{cwd:front,env,stdio:'inherit',timeout:100000,killSignal:'SIGKILL'});
  entry.exit_status=child.status;entry.signal=child.signal;entry.error=child.error?.message||null;entry.finished_at=new Date().toISOString();
  assert.ifError(child.error);assert.equal(child.signal,null,'Vite compile interrupted');assert.equal(child.status,0,'Vite-only compile failed');
  reserve(0,'after Vite compile');verifyDiagnosticTooling(front,receiptPath,{expectedExporter:expected});verifyPublisherToolingCheckout(front,{amended:label==='amended-tooling'});
  assert.deepEqual(inventory(publicRoot),originalPublic,'Vite hook changed current public input');
  const output=inventory(dist);assert.ok(output['index.html'],'Missing built index.html');assert.ok(output['precache-manifest.json'],'Missing generated precache manifest');assert.ok(Object.keys(output).some(path=>path.startsWith('assets/')&&path.endsWith('.js')),'Missing browser JavaScript');
  entry.inventory=save('paired-vite-'+label+'-dist-inventory.json',output);entry.files=Object.keys(output).length;entry.status='passed';outputs.push(output);checkpoint();
 }
 assert.deepEqual(outputs[0],outputs[1],'Original/amended tooling changed browser or public dist assets');
 report.complete_dist_equal=true;report.public_data_unchanged=true;report.status='passed';
}catch(error){report.status='failed';report.error=(error.stack||String(error)).slice(0,12000);process.exitCode=1;}
finally{
 try{assert.deepEqual(pin(after),AFTER);writeFileSync(exporter,after);const final=verifyDiagnosticTooling(front,receiptPath);report.final_pure_amended_checkout=verifyPublisherToolingCheckout(front,{amended:true});report.final_amended_tooling_restored=true;report.final_code_check=save('paired-vite-final-code-check.json',final);}catch(error){report.status='failed';report.restore_error=(error.stack||String(error)).slice(0,12000);process.exitCode=1;}
 rmSync(dist,{recursive:true,force:true});report.finished_at=new Date().toISOString();checkpoint();
}
