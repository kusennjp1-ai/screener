// Isolated proof for the publisher's ordinary Node heap. No provider or API calls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,readFileSync,statfsSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getHeapStatistics} from 'node:v8';

const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
const work=resolve(input.workRoot),output=resolve(input.reportPath),front=resolve(input.frontendRoot),controllerRoot=resolve(input.controllerRoot);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const RESERVE=8n*1024n**3n;
const report={schema_version:'carry-publisher-default-node-proof-v1',status:'running',scope:'candidate target creation and original carry create/load at publisher-default Node heap',
  evaluated_at:input.evaluatedAt,node:process.version,exec_argv:process.execArgv,node_options_present:Object.hasOwn(process.env,'NODE_OPTIONS'),
  heap_size_limit_bytes:getHeapStatistics().heap_size_limit,resource_checks:[]};
function reserve(directory,bytes,label){
  const disk=statfsSync(directory,{bigint:true}),required=((BigInt(bytes)+disk.bsize-1n)/disk.bsize)*disk.bsize,available=disk.bavail*disk.bsize;
  report.resource_checks.push({label,available_bytes:String(available),required_bytes:String(required),reserve_bytes:String(RESERVE),block_bytes:String(disk.bsize)});
  assert.ok(available>=required+RESERVE,label+': cannot preserve 8 GiB reserve');
}
function pinned(path,expected){
  const stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Linked or non-file code input');
  const bytes=readFileSync(path);assert.equal(blob(bytes),expected,'Selected code blob differs');
  return {path,git_blob:expected,sha256:sha(bytes),bytes:bytes.length};
}
function save(){
  report.heap_size_limit_bytes=getHeapStatistics().heap_size_limit;
  const usage=process.resourceUsage();report.resource_usage={...usage,max_rss_unit:process.platform==='linux'?'KiB':'platform-defined'};
  report.memory_usage=process.memoryUsage();
  const bytes=JSON.stringify(report,null,2)+'\n';assert.ok(Buffer.byteLength(bytes)<=1024*1024,'Default-node report exceeds cap');
  reserve(dirname(output),Buffer.byteLength(bytes),'write default-node report');writeFileSync(output,bytes);
  console.log('CARRY_DEFAULT_NODE_PROOF '+JSON.stringify(report));
}
try{
  assert.equal(process.env.NODE_OPTIONS,undefined,'Default-node proof must omit NODE_OPTIONS');
  assert.deepEqual(process.execArgv,[],'Default-node proof must omit inherited Node CLI flags');
  assert.equal(process.platform,'linux','Default-node maxRSS contract requires the Linux publisher runner');
  assert.ok(work!==join(front,'public')&&!work.startsWith(join(front,'public')+sep));
  mkdirSync(work,{recursive:true});mkdirSync(dirname(output),{recursive:true});
  report.selected_code={
    controller:pinned(join(controllerRoot,'.github/scripts/financial-generation-carry-controller.mjs'),'1f9839d0e11e23b354df2ddb4d28278e409bc7fb'),
    audit:pinned(join(controllerRoot,'.github/scripts/financial-audit-history.mjs'),'6689029d3a56e219a0ce11ef53b930508faed6df'),
    carry:pinned(join(front,'tools/financial-generation-carry.mjs'),'307319067764801afcd28ed65c5e27ae58dfbccd'),
  };
  save(); // Preserve the actual heap contract even if the worker is later killed.
  const {readCarryTargetBase}=await import(pathToFileURL(join(controllerRoot,'.github/scripts/financial-generation-carry-controller.mjs')));
  const {FINANCIAL_AUDIT_MAX_FILE_BYTES}=await import(pathToFileURL(join(controllerRoot,'.github/scripts/financial-audit-history.mjs')));
  const {createFinancialGenerationCarry,loadFinancialGenerationCarry}=await import(pathToFileURL(join(front,'tools/financial-generation-carry.mjs')));
  assert.equal(FINANCIAL_AUDIT_MAX_FILE_BYTES,128*1024*1024);
  reserve(work,FINANCIAL_AUDIT_MAX_FILE_BYTES,'bounded default-node carry output');
  const target=await readCarryTargetBase({root:join(front,'public'),frontendRoot:front});
  assert.equal(target.rows.length,5901,'Default-node proof must cover all 5,901 rows');
  const targetHash=sha(target.bytes);
  report.target={bytes:Buffer.byteLength(target.bytes),sha256:targetHash,rows:target.rows.length,as_of_date:target.asOfDate};
  assert.equal(targetHash,input.expectedTargetSha256,'Default-node target differs from reporting parent');
  const sourceProjection=readFileSync(resolve(input.sourceProjection)),sourceBase=readFileSync(resolve(input.sourceBase));
  assert.equal(sha(sourceProjection),input.sourceProjectionSha256);assert.equal(sha(sourceBase),input.sourceBaseSha256);
  const carry=createFinancialGenerationCarry({sourceProjection,sourceProjectionSha256:input.sourceProjectionSha256,sourceBase,sourceBaseSha256:input.sourceBaseSha256,
    sourceLineage:input.sourceLineage,previousPublicationIdentity:input.previousPublicationIdentity,evaluatedAt:input.evaluatedAt,
    targetBase:target.bytes,targetBaseSha256:targetHash});
  const bytes=JSON.stringify(carry),carryHash=sha(bytes);
  report.carry={bytes:Buffer.byteLength(bytes),sha256:carryHash,financial_generation:carry.financial_generation,unchanged_file_cap_bytes:FINANCIAL_AUDIT_MAX_FILE_BYTES};
  assert.ok(Buffer.byteLength(bytes)<=FINANCIAL_AUDIT_MAX_FILE_BYTES,'Carry exceeds existing 128 MiB financial audit file cap');
  assert.equal(carryHash,input.expectedCarrySha256,'Default-node carry differs from reporting parent');
  const path=join(work,'carry.json');reserve(work,Buffer.byteLength(bytes),'write bounded default-node carry');writeFileSync(path,bytes,{flag:'wx'});reserve(work,0,'after bounded carry write');
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('FINANCIAL_CORRECTION_')||key.startsWith('FINANCIAL_GENERATION_CARRY_'))delete env[key];
  Object.assign(env,{FINANCIAL_EVALUATED_AT:input.evaluatedAt,FINANCIAL_GENERATION_CARRY_PROJECTION:path,FINANCIAL_GENERATION_CARRY_SHA256:carryHash,
    FINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE:input.sourceLineage,FINANCIAL_GENERATION_CARRY_PREVIOUS_IDENTITY:input.previousPublicationIdentity,
    FINANCIAL_GENERATION_CARRY_TARGET_BASE_SHA256:targetHash});
  const loaded=await loadFinancialGenerationCarry({env,rows:target.rows,asOfDate:target.asOfDate});
  assert.equal(sha(JSON.stringify(loaded)),carryHash,'Original loader changed the candidate projection');
  report.original_loader='passed';report.target_hash_matches_parent=true;report.carry_hash_matches_parent=true;
  report.ownership=Object.values(carry.ownership).reduce((counts,status)=>(counts[status]=(counts[status]||0)+1,counts),{});
  report.status='passed';
}catch(error){report.status='failed';report.error=(error.stack||String(error)).slice(0,12000);process.exitCode=1;}
finally{save();}
