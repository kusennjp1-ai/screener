// Bounded offline setup for the exact A8 financial carry failure.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,rmSync,statfsSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {restorePublishedFinancialSource,validateFinancialReleaseReceipt} from './financial-release-activation.mjs';
const work=join(process.env.RUNNER_TEMP,'carry-identity-diagnostic'),reports=join(work,'reports'),prior=join(work,'prior'),clean=join(work,'clean-source');
const frontend=resolve('release/frontend'),publicRoot=join(frontend,'public'),controller=process.cwd();
const hash=b=>createHash('sha256').update(b).digest('hex');
const save=(name,value)=>writeFileSync(join(reports,name),JSON.stringify(value,null,2)+'\n');
const reserve=(extra=0)=>{const disk=statfsSync(work);assert.ok(disk.bavail*disk.bsize>=8*1024**3+extra,'Eight GiB reserve would be exceeded');};
function inventory(root){const value={};function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else{assert.ok(entry.isFile());const raw=readFileSync(path);value[relative(root,path).split(sep).join('/')]={bytes:raw.length,sha256:hash(raw)};}}}walk(root);return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0));}
const result={schema_version:'a8-carry-identity-setup-v1',scope:'diagnostic only; no publication or source authority',started_at:new Date().toISOString(),status:'running'};
try{
 assert.equal(execFileSync('git',['-C','release','rev-parse','HEAD'],{encoding:'utf8'}).trim(),'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac');
 assert.equal(execFileSync('git',['rev-parse','HEAD^'],{encoding:'utf8'}).trim(),'c822e55df34c1cb7b559bfa9f11ecda7018ee3ce');
 const raw=readFileSync(join(prior,'publication.json'));assert.equal(hash(raw),'0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a');
 const publication=JSON.parse(raw),reference=publication.financial_release;
 assert.equal(publication.run_id,37456692717);assert.equal(publication.run_attempt,1);
 assert.equal(publication.financial_lineage_sha256,'2828fbf2d497ae32c29ddb46a34903a9c1c8494862e127ba67dff9880e356a13');
 assert.match(reference.path,/^static-data\/financial-corrections\/release-[a-f0-9]{64}\.json$/);
 const receiptBytes=readFileSync(join(prior,reference.path));assert.equal(hash(receiptBytes),reference.sha256);
 const receipt=validateFinancialReleaseReceipt(JSON.parse(receiptBytes));assert.equal(receipt.lineage_sha256,publication.financial_lineage_sha256);
 const reads=[];
 const fetcher=async(input,options={})=>{
  const url=new URL(input),prefix='/screener/';
  assert.equal(url.origin,'https://kusennjp1-ai.github.io');assert.ok(url.pathname.startsWith(prefix));assert.ok(!options.method||options.method==='GET');
  const name=decodeURIComponent(url.pathname.slice(prefix.length));
  assert.ok((name.startsWith('static-data/financial-corrections/')||name.startsWith('static-data/_financial-audit-transport/'))&&!name.includes('\\')&&name.split('/').every(x=>x&&x!=='.'&&x!=='..'));
  const path=resolve(prior,name);assert.ok(path.startsWith(prior+sep));const info=lstatSync(path);assert.ok(info.isFile()&&!info.isSymbolicLink());
  const bytes=readFileSync(path);reads.push({path:name,bytes:bytes.length,sha256:hash(bytes)});return new Response(bytes,{status:200});
 };
 const auditRoot=join(work,'carry-source');reserve(Object.keys(publication.financial_audit_files).length*(128*1024*1024+4096));await restorePublishedFinancialSource({receipt:publication,financialRelease:receipt},auditRoot,fetcher);
 const auditInventory=inventory(auditRoot);reserve(Object.values(auditInventory).reduce((n,p)=>n+p.bytes+4096,0));
 cpSync(join(auditRoot,'static-data/financial-corrections'),join(clean,'static-data/financial-corrections'),{recursive:true});
 reserve();const cleanInventory=inventory(clean),cleanInventoryBytes=JSON.stringify(cleanInventory);
 save('clean-source-inventory.json',cleanInventory);save('prior-local-audit-reads.json',reads);
 if(existsSync(publicRoot))rmSync(publicRoot,{recursive:true});reserve(Object.values(cleanInventory).reduce((n,p)=>n+p.bytes+4096,0));cpSync(clean,publicRoot,{recursive:true});reserve();
 const env={...process.env,FINANCIAL_EVALUATED_AT:'2026-10-08T04:18:00.254Z'};
 for(const key of Object.keys(env))if(key.startsWith('FINANCIAL_CORRECTION_')||key.startsWith('FINANCIAL_GENERATION_CARRY_'))delete env[key];
 reserve(Object.values(cleanInventory).reduce((n,p)=>n+p.bytes+4096,0)+256*1024*1024);
 execFileSync(process.execPath,['tools/export-research.mjs'],{cwd:frontend,env,stdio:'inherit',timeout:600000});
 const config={frontendRoot:frontend,outputDir:join(reports,'identity'),uiSha:'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',
  inputs:JSON.parse(readFileSync(join(reports,'pins.json'),'utf8')),evaluatedAt:'2026-10-08T04:18:00.254Z',
  sourceProjection:join(auditRoot,receipt.source_projection.path),sourceProjectionSha256:receipt.source_projection.sha256,
  sourceBase:join(auditRoot,receipt.source_base.path),sourceBaseSha256:receipt.source_base.sha256,sourceLineage:receipt.lineage_sha256,
  previousPublicationIdentity:'37456692717/1/0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a/ab65c8bb05f33cadd1eec71c858ed67a6ba7578ed9772c7d9ccbf24873161dd0',
  failedTargetBaseSha256:'2bbcb0cad9afcc427585cc4ca1dc930ef9a90824d8fbdb5371be6d84f40e1e70',failedProjectionSha256:'1d0d9176dc23303edb6e02d0917e1bd2d3f9135c23d8ef322466878c0d20639c',
  runExports:true,runCurrentProof:true,cleanSourceRoot:clean,cleanSourceInventorySha256:hash(cleanInventoryBytes),controllerRoot:controller,currentWorkRoot:join(work,'current-proof')};
 writeFileSync(join(work,'config.json'),JSON.stringify(config,null,2)+'\n');
 result.status='passed';result.config_sha256=hash(readFileSync(join(work,'config.json')));result.clean_source_inventory_sha256=hash(cleanInventoryBytes);
}catch(error){result.status='failed';result.error=error.stack||String(error);process.exitCode=1;}
finally{result.finished_at=new Date().toISOString();save('setup-result.json',result);}
