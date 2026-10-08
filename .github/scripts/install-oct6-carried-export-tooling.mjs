// Exact-one-file diagnostic tooling overlay. This is not publisher admission authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,rmSync,statfsSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifyPublisherToolingCheckout} from './retained-price-publisher-tooling.mjs';
const UI='1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',TREE='1c0219a170dcbdeb1af539e4cf7a04018251ca02',FRONT='0ba620a84264e1ff026898beed3fbc8ad5894618';
const AMENDED_TREE='b042d1ca1aee5fc19ac6a75ed96aea88f69e6723',AMENDED_FRONT='1e0bfd47daf9f9b6f77ceb8f8d68343165ab4f31';
const SOURCE='frontend/tools/export-research.mjs',FIXTURE='.github/scripts/fixtures/publisher-export-research-oct6-carry-v1.mjs';
const BEFORE={git_blob:'dac7f8784a0bc836ab6977e1e88ca643c49c01ed',bytes:23200,sha256:'90e9f7316b34f171a726bc9245805e67e8d316b7367e288924ce568583fc3946'};
const AFTER={git_blob:'1f630be308dd2ce604c26635c3d67243c7e48944',bytes:23247,sha256:'f9e0ad58f7bbaf911eab2943fcfb18df32f6ee881c3847272f5201e448d9cf40'};
const OLD='    canonicalChart=projectFinancialPayload(overlayFinancialChart(await read(paths.get(symbol)),correction,symbol),{now:evaluatedAt,asOfDate:scan.as_of_date,market:row.market});';
const NEW='    canonicalChart=overlayFinancialChart(await read(paths.get(symbol)),correction,symbol);\n    if (!carry) canonicalChart=projectFinancialPayload(canonicalChart,{now:evaluatedAt,asOfDate:scan.as_of_date,market:row.market});';
const PUBLIC_BROWSER_SOURCE=[
  {
    "path": "frontend/public/fire.svg",
    "mode": "100644",
    "bytes": 1086,
    "sha256": "6096e30617c717cdedb4f4bce75c8b631be3175f5cad2235f9969b6568a400f7",
    "git_blob": "b594d5bdd1af41bde3a7295f1a172601d5b89b18"
  },
  {
    "path": "frontend/public/manifest.webmanifest",
    "mode": "100644",
    "bytes": 602,
    "sha256": "f9bca7fbce819f5188de2cce068d8081de5d1fc3411b1fb9612fbbbb92480744",
    "git_blob": "007970c9b1d0c4a8fc152458b2559c69d7c872a9"
  },
  {
    "path": "frontend/public/static-transport-capability.json",
    "mode": "100644",
    "bytes": 117,
    "sha256": "28a3532eadb5929cb6f4b3871c6f57bd37fef536764870bba31dc933b8781bdd",
    "git_blob": "846ea31f39f91d0e981695a31ba30fbf25d608bc"
  },
  {
    "path": "frontend/public/strategy-scorecard.json",
    "mode": "100644",
    "bytes": 2345,
    "sha256": "b24929a57c5952da0adeff2b8fa7e0986e230b5cf3560939acea4d3cc7682a38",
    "git_blob": "1707fa85c85ea1eeadc98a529680c511fedf2583"
  },
  {
    "path": "frontend/public/sw.js",
    "mode": "100644",
    "bytes": 4957,
    "sha256": "0bba0e242e62556f48b750a66a8e815c292d32890ec66685cc2146f89c0b77cf",
    "git_blob": "d5d024f7973653fab5dc09b0cfe3816d7d3012e7"
  }
];
const DATA_FILES=new Set(['frontend/public/research-daily.json','frontend/public/portfolio-model.json','frontend/public/qualification-audit.json','frontend/public/ibd-reference.json']);
const mutableDataPath=path=>path.startsWith('frontend/public/static-data/')||DATA_FILES.has(path);
const sha=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const pin=b=>({git_blob:blob(b),bytes:b.length,sha256:sha(b)});
const git=(checkout,args,options={})=>execFileSync('git',['-C',checkout,...args],{encoding:'utf8',...options}).trim();
function reserve(directory,bytes=0){const disk=statfsSync(directory,{bigint:true}),block=disk.bsize,required=((BigInt(bytes)+block-1n)/block)*block;assert.ok(disk.bavail*block>=8n*1024n**3n+required,'Diagnostic tooling would exceed the 8 GiB reserve');}
function selected(checkout){
 assert.equal(git(checkout,['rev-parse','HEAD']),UI);
 assert.equal(git(checkout,['rev-parse','HEAD^{tree}']),TREE);
 assert.equal(git(checkout,['rev-parse','HEAD:frontend']),FRONT);
 const remote=git(checkout,['remote','get-url','origin']);assert.match(remote,/^(https:\/\/github\.com\/|git@github\.com:)kusennjp1-ai\/screener(?:\.git)?$/);
}
function entries(checkout){
 const raw=execFileSync('git',['-C',checkout,'ls-tree','-r','-z','--full-tree',UI],{encoding:'utf8'});
 return raw.split('\0').filter(Boolean).map(line=>{const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert.ok(match,'Unexpected original tracked entry');return {path:match[3],mode:match[1],git_blob:match[2]};});
}
function file(checkout,entry,expectedBlob=entry.git_blob){
 const path=resolve(checkout,entry.path);assert.ok(path.startsWith(checkout+sep));
 const stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Linked or non-file source');
 const raw=readFileSync(path);assert.equal(blob(raw),expectedBlob,'Unrelated source changed: '+entry.path);
 assert.equal(Boolean(stat.mode&0o111),entry.mode==='100755','Source executable mode changed: '+entry.path);
 return {...entry,...pin(raw)};
}
function extraSources(checkout){
 const untracked=execFileSync('git',['-C',checkout,'ls-files','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
 const helper=readFileSync(join(checkout,'frontend/tools/financial-generation-carry.mjs'));
 const allowed='frontend/tools/.carry-identity-diagnostic-'+sha(helper).slice(0,16)+'.mjs';
 for(const path of untracked){
  if(mutableDataPath(path))continue;
  assert.equal(path,allowed,'Untracked unrelated source: '+path);
  assert.deepEqual(readFileSync(join(checkout,path)),Buffer.from(helper.toString('utf8')+'\nexport { identity as diagnosticIdentity, ownership as diagnosticOwnership };\n'),'Diagnostic helper derivation changed');
 }
}
export function verifyDiagnosticTooling(frontendRoot,receiptPath,{expectedExporter=AFTER}={}){
 const frontend=resolve(frontendRoot),checkout=resolve(frontend,'..');assert.equal(relative(checkout,frontend),'frontend');
 selected(checkout);
 const raw=readFileSync(receiptPath),receipt=JSON.parse(raw);
 assert.equal(receipt.schema_version,'oct6-diagnostic-tooling-installation-v1');assert.equal(receipt.status,'passed');
 assert.deepEqual(receipt.original_browser_base,{commit_sha:UI,full_tree_sha:TREE,frontend_tree_sha:FRONT});
 assert.deepEqual(receipt.modified_publisher_data_tool,{id:'diagnostic-oct6-carry-chart-once-v1',derived_full_tree_sha:AMENDED_TREE,derived_frontend_tree_sha:AMENDED_FRONT,path:SOURCE,...AFTER});
 assert.deepEqual(receipt.public_browser_source,PUBLIC_BROWSER_SOURCE);
 assert.deepEqual(receipt.before,{path:SOURCE,...BEFORE});assert.deepEqual(receipt.fixture,{path:FIXTURE,...AFTER});
 const original=entries(checkout).filter(entry=>!mutableDataPath(entry.path));
 assert.deepEqual(receipt.source_inventory.map(({path,mode})=>({path,mode})),original.map(({path,mode})=>({path,mode})));
 for(let i=0;i<original.length;i++){
  const entry=original[i],saved=receipt.source_inventory[i];
  assert.equal(saved.git_blob,entry.git_blob,'Receipt changed original source identity');
  const actual=file(checkout,entry,entry.path===SOURCE?expectedExporter.git_blob:entry.git_blob);
  if(entry.path===SOURCE)assert.deepEqual(pin(readFileSync(join(checkout,SOURCE))),expectedExporter);
  else assert.deepEqual(actual,saved,'Receipt source bytes mismatch');
 }
 extraSources(checkout);reserve(checkout);
 return {receipt,receipt_pin:{bytes:raw.length,sha256:sha(raw)},checked_at:new Date().toISOString(),exporter:expectedExporter,no_unrelated_source_changes:true};
}
export function restoreDiagnosticBrowserPublic(frontendRoot,receiptPath){
 const frontend=resolve(frontendRoot),checkout=resolve(frontend,'..');assert.equal(relative(checkout,frontend),'frontend');selected(checkout);
 const receipt=JSON.parse(readFileSync(receiptPath));assert.equal(receipt.status,'passed');assert.deepEqual(receipt.public_browser_source,PUBLIC_BROWSER_SOURCE);
 const tracked=entries(checkout),restored=[];
 for(const expected of PUBLIC_BROWSER_SOURCE){
  const entry=tracked.find(item=>item.path===expected.path);assert.ok(entry);assert.equal(entry.mode,expected.mode);assert.equal(entry.git_blob,expected.git_blob);
  const raw=execFileSync('git',['-C',checkout,'show',UI+':'+expected.path]);assert.deepEqual(pin(raw),{git_blob:expected.git_blob,bytes:expected.bytes,sha256:expected.sha256});
  const target=resolve(checkout,expected.path);assert.ok(target.startsWith(join(frontend,'public')+sep));
  reserve(frontend,raw.length+4096);
  if(existsSync(target)){const stat=lstatSync(target);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.deepEqual(readFileSync(target),raw,'Unexpected collision with authenticated browser public source');}
  else{writeFileSync(target,raw,{flag:'wx',mode:0o644});restored.push(expected.path);}
  assert.deepEqual(file(checkout,entry),expected);
 }
 reserve(frontend);
 return {schema_version:'oct6-diagnostic-browser-public-restoration-v1',status:'passed',restored_at:new Date().toISOString(),original_ui_commit:UI,original_full_tree_sha:TREE,files:PUBLIC_BROWSER_SOURCE,restored_paths:restored,scope:'exact five tracked browser public files from the original immutable UI tree; authenticated clean data inventory remains untouched'};
}
export async function installDiagnosticTooling(){
 const controller=process.cwd(),checkout=resolve('release'),frontend=join(checkout,'frontend'),directory=join(process.env.RUNNER_TEMP,'oct6-tooling-provenance'),receiptPath=join(directory,'installation.json');
 assert.equal(process.env.GITHUB_REPOSITORY,'kusennjp1-ai/screener');
 assert.equal(process.env.GITHUB_REF,'refs/heads/preview/oct6-carry-tooling-proof-20261008');
 assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
 assert.deepEqual(git(controller,['rev-list','--parents','-n','1','HEAD']).split(' '),[process.env.GITHUB_SHA,'c822e55df34c1cb7b559bfa9f11ecda7018ee3ce']);
 selected(checkout);const pureOriginal=verifyPublisherToolingCheckout(frontend,{amended:false});assert.equal(git(checkout,['status','--porcelain','--untracked-files=all']),'','Disposable original checkout must be untouched');
 const before=readFileSync(join(checkout,SOURCE)),after=readFileSync(join(controller,FIXTURE));
 assert.deepEqual(pin(before),BEFORE);assert.deepEqual(pin(after),AFTER);
 assert.equal(before.toString('utf8').split(OLD).length,2,'Expected unique original line');
 assert.equal(before.toString('utf8').replace(OLD,NEW),after.toString('utf8'),'Fixture has changes outside the exact two-line amendment');
 const sourceInventory=entries(checkout).filter(entry=>!mutableDataPath(entry.path)).map(entry=>file(checkout,entry));
 mkdirSync(directory,{recursive:true});reserve(directory,1024*1024);
 const index=join(directory,'derivation-index'),env={...process.env,GIT_INDEX_FILE:index};
 let derived;
 try{
  git(checkout,['read-tree',UI],{env});
  assert.equal(git(checkout,['hash-object','-w','--stdin'],{input:after}),AFTER.git_blob);
  git(checkout,['update-index','--cacheinfo','100644,'+AFTER.git_blob+','+SOURCE],{env});
  derived=git(checkout,['write-tree'],{env});assert.equal(derived,AMENDED_TREE);
  assert.equal(git(checkout,['rev-parse',derived+':frontend']),AMENDED_FRONT);
 }finally{rmSync(index,{force:true});}
 writeFileSync(join(checkout,SOURCE),after);assert.deepEqual(pin(readFileSync(join(checkout,SOURCE))),AFTER);
 assert.equal(git(checkout,['diff','--name-only']),SOURCE);
 const pureAmended=verifyPublisherToolingCheckout(frontend,{amended:true});
 const receipt={schema_version:'oct6-diagnostic-tooling-installation-v1',status:'passed',scope:'exact-one-file disposable diagnostic overlay only; no production amendment, admission, publication or browser acceptance authority',installed_at:new Date().toISOString(),
  repository:'kusennjp1-ai/screener',diagnostic_head:process.env.GITHUB_SHA,diagnostic_parent:'c822e55df34c1cb7b559bfa9f11ecda7018ee3ce',
  original_browser_base:{commit_sha:UI,full_tree_sha:TREE,frontend_tree_sha:FRONT},
  modified_publisher_data_tool:{id:'diagnostic-oct6-carry-chart-once-v1',derived_full_tree_sha:derived,derived_frontend_tree_sha:AMENDED_FRONT,path:SOURCE,...AFTER},
  pure_checkout_checks:{module_git_blob:'57689ae8df9a57efd84a03e6058a27885b9a548f',original:pureOriginal,amended:pureAmended,scope:'pure physical checkout verification only; no publisher admission API called'},
  public_browser_source:PUBLIC_BROWSER_SOURCE,
  before:{path:SOURCE,...BEFORE},fixture:{path:FIXTURE,...AFTER},changed_files:[SOURCE],source_inventory:sourceInventory,
  patch:{before:OLD,after:NEW,all_other_bytes_unchanged:true},prior_proof:{run_id:37754058326,run_attempt:1,scope:'isolated complete alias diagnostic collection; old current proof failed quality at ADM and never reached final comparator',retained_fundamentals_failures:73,exclusive_reason:'stale_reporting_period lost through second projection'},
  future_production_requirement:'A real composed publication with browser and CSV deployment acceptance plus separately admitted publisher amendment remains required.'};
 const receiptBytes=JSON.stringify(receipt,null,2)+'\n';reserve(directory,Buffer.byteLength(receiptBytes));writeFileSync(receiptPath,receiptBytes,{flag:'wx'});
 const verified=verifyDiagnosticTooling(frontend,receiptPath);writeFileSync(join(directory,'installation-verification.json'),JSON.stringify(verified,null,2)+'\n');
 console.log('DIAGNOSTIC_TOOLING_INSTALLATION '+JSON.stringify({status:'passed',receipt_pin:verified.receipt_pin,original_browser_base:receipt.original_browser_base,modified_publisher_data_tool:receipt.modified_publisher_data_tool,scope:receipt.scope}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await installDiagnosticTooling();
