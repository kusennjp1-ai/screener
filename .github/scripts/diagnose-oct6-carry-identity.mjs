// Offline full-cohort carry diagnostic. Run only in a disposable approved-UI checkout.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,existsSync,unlinkSync,cpSync,rmSync,statfsSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getHeapStatistics} from 'node:v8';
import {execFileSync,spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
const c=JSON.parse(readFileSync(process.argv[2],'utf8'));
const front=resolve(c.frontendRoot),root=join(front,'public/static-data'),out=resolve(c.outputDir);
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const same=(a,b)=>isDeepStrictEqual(a,b);
assert.ok(out!==root&&!out.startsWith(root+sep)&&!root.startsWith(out+sep));
mkdirSync(out,{recursive:true});
const report={schema_version:'financial-carry-identity-diagnostic-v1',scope:'offline immutable failure replay with exact observed-identity target projection; no publication authority',evaluated_at:c.evaluatedAt,ui_sha:c.uiSha,inputs:c.inputs||{},stages:{},artifacts:{},resources:{reserve_bytes:8*1024**3,checks:[]}};
report.reporting_runtime={node:process.version,node_options:process.env.NODE_OPTIONS??null,heap_size_limit_bytes:getHeapStatistics().heap_size_limit,scope:'historical reconstruction and report generation only; current compiler children and candidate creation/load receive a separate default-node proof'};
report.prior_sequential_export_failure={
  status:'failed_literal_byte_idempotence',run_id:37743571566,run_attempt:1,
  head_sha:'8417f4c199b8ea3eb1f219f90bd66b3b16949566',
  artifact:{id:11535252901,name:'oct6-carry-identity-37743571566-1',bytes:47081780,sha256:'e0712d71b6ad3f9717d27c41ce979fc09affe188585927bb6541eed817ccd529',
    url:'https://github.com/kusennjp1-ai/screener/actions/runs/37743571566/artifacts/11535252901'},
  literal_members:['identity/after1-public-inventory.json','identity/after2-public-inventory.json','identity/roundtrip-file-differences.json','identity/after1-research-target.json','identity/after2-research-target.json','identity/report.json'],
  changed_inventory_entries:19517,added:9756,removed:9753,changed:8,
  saved_value_classification:{collector_run_id:37746072238,rows:5901,equal_nonreference_scalar_leaves:757012,changed_reference_values:9744,changed_reference_symbols:4872,
    reference_fields:['chart_path','research_detail_path'],projected_rows_identical:true,input_binding_changes:11,key_order_changes:0,row_order_changes:0,numeric_token_changes:0},
  coverage_limit:'The original emitted file bodies were not retained. Their semantic equality is not claimed. The failed sequential observation and its literal inventories remain immutable in the pinned original artifact.',
  current_and_default_node_proof:'not reached in that failed run'
};
const RESERVE=8n*1024n**3n;
function requireSpace(directory,bytes,label){
 const fs=statfsSync(directory,{bigint:true}),available=fs.bavail*fs.bsize,requested=((BigInt(bytes)+fs.bsize-1n)/fs.bsize)*fs.bsize;
 report.resources.checks.push({label,available_bytes:String(available),required_bytes:String(requested),reserve_bytes:String(RESERVE),block_bytes:String(fs.bsize)});
 assert.ok(available>=requested+RESERVE,label+': insufficient disk space to preserve 8 GiB reserve');
 return Number(fs.bsize);
}
function copyBudget(source,destination,label){
 const fs=statfsSync(destination,{bigint:true}),block=fs.bsize;let allocation=0n,files=0,directories=0,logical=0n;
 function visit(path){directories++;allocation+=block;for(const item of readdirSync(path,{withFileTypes:true})){const next=join(path,item.name);if(item.isDirectory())visit(next);else{assert.ok(item.isFile(),'Linked or special copy input');const st=lstatSync(next,{bigint:true});logical+=st.size;allocation+=((st.size+block-1n)/block)*block;files++;}}}
 visit(source);requireSpace(destination,allocation,label);return {files,directories,logical_bytes:String(logical),allocated_bytes:String(allocation),block_bytes:String(block)};
}
function compilerBudget(label){const budget=copyBudget(join(front,'public'),out,label);requireSpace(out,BigInt(budget.allocated_bytes)+256n*1024n**2n,label+' scratch');}
function save(name,value,raw=false){const bytes=raw?value:JSON.stringify(value,null,2)+'\n',path=join(out,name);requireSpace(out,Buffer.byteLength(bytes),'write '+name);writeFileSync(path,bytes);requireSpace(out,0,'after '+name);const pin={path:name,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)};report.artifacts[name]=pin;return path;}
function checkpoint(){const bytes=JSON.stringify(report,null,2)+'\n';requireSpace(out,Buffer.byteLength(bytes),'write report.json');writeFileSync(join(out,'report.json'),bytes);
 const stages=Object.fromEntries(Object.entries(report.stages).map(([key,value])=>[key,Object.fromEntries(Object.entries(value).filter(([name])=>!['mismatch_symbols'].includes(name)))]));
 console.log('CARRY_DIAGNOSTIC_SUMMARY '+JSON.stringify({result:report.result||'running',error:report.error?.split('\n').slice(0,2).join(' '),stages,reproduction:report.reproduction,correction:report.correction,current:report.current,roundtrip:report.roundtrip,historical_replay:report.historical_replay,prior_sequential_failure:report.prior_sequential_export_failure&&{run_id:report.prior_sequential_export_failure.run_id,artifact_id:report.prior_sequential_export_failure.artifact.id,changed_inventory_entries:report.prior_sequential_export_failure.changed_inventory_entries,status:report.prior_sequential_export_failure.status},prospective_target:report.prospective_target}));
}
function fail(message){throw Error(message);}
function safeRead(p){assert.equal(typeof p,'string');const path=resolve(root,p);assert.ok(path.startsWith(root+sep)&&!p.split('/').includes('..'));assert.ok(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink());const raw=readFileSync(path);return {path:p,bytes:raw.length,sha256:sha(raw),value:JSON.parse(raw)};}
function inventory(dir){const result={};function visit(p){for(const e of readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const next=join(p,e.name);if(e.isDirectory())visit(next);else{assert.ok(e.isFile());const bytes=readFileSync(next);result[relative(dir,next).split(sep).join('/')]={bytes:bytes.length,sha256:sha(bytes)};}}}visit(dir);return result;}
const helperPath=join(front,'tools/financial-generation-carry.mjs'),helperBytes=readFileSync(helperPath);
const helperBlob=createHash('sha1').update('blob '+helperBytes.length+'\0').update(helperBytes).digest('hex');
assert.equal(c.uiSha,'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac');
assert.equal(helperBlob,'307319067764801afcd28ed65c5e27ae58dfbccd','Approved helper blob changed');
const diagnosticSource=helperBytes.toString('utf8')+'\nexport { identity as diagnosticIdentity, ownership as diagnosticOwnership };\n';
const derivedPath=join(front,'tools/.carry-identity-diagnostic-'+sha(helperBytes).slice(0,16)+'.mjs');
report.helper={path:'tools/financial-generation-carry.mjs',git_blob:helperBlob,sha256:sha(helperBytes),derived_sha256:sha(diagnosticSource),derivation:'exact original UTF-8 bytes plus export-only suffix'};
save('approved-helper.mjs',helperBytes,true);save('diagnostic-helper.mjs',diagnosticSource,true);
requireSpace(join(front,'tools'),Buffer.byteLength(diagnosticSource),'write exact diagnostic helper');
writeFileSync(derivedPath,diagnosticSource,{flag:'wx'});
try {
 const helper=await import(pathToFileURL(helperPath)), inspector=await import(pathToFileURL(derivedPath));
 const {diagnosticIdentity:identity,diagnosticOwnership:ownership}=inspector;
 const {instrumentIdentityEvidence}=await import(pathToFileURL(join(front,'src/static/instrumentApplicability.js')));
 const {mergeScanRows}=await import(pathToFileURL(join(front,'src/static/qualificationAudit.js')));
 const {orderResearchExportRows}=await import(pathToFileURL(join(front,'tools/research-export-order.mjs')));
 const {decodeResearchIndex}=await import(pathToFileURL(join(front,'src/static/researchTransport.js')));
 async function snapshot(stage){
  const manifest=safeRead('manifest.json'),entry=manifest.value.markets?.US||manifest.value,scan=safeRead(entry.pages.scan.path);
  assert.equal(entry.as_of_date,scan.value.as_of_date);
  const chunks=(scan.value.chunks||[]).map(ref=>safeRead(ref.path));
  const seen=new Map(),conflictingRepeats=[];
  for(const payload of [scan,...chunks])for(const row of payload.value.rows||payload.value.initial_rows||[]){
   if(!row||typeof row.symbol!=='string'||!row.symbol.trim())continue;
   if(seen.has(row.symbol)&&!same(seen.get(row.symbol).row,row))conflictingRepeats.push({symbol:row.symbol,first_path:seen.get(row.symbol).path,next_path:payload.path});
   seen.set(row.symbol,{row,path:payload.path});
  }
  save(stage+'-conflicting-repeats.json',conflictingRepeats);
  assert.equal(conflictingRepeats.length,0,'Conflicting duplicate full scan observations');
  assert.equal(new Set((scan.value.chunks||[]).map(ref=>ref.path)).size,(scan.value.chunks||[]).length,'Duplicate chunk references');
  const merged=await orderResearchExportRows(mergeScanRows([scan.value,...chunks.map(p=>p.value)],scan.value.as_of_date),join(front,'public/qualification-audit.json'),scan.value.as_of_date);
  const researchAsset=safeRead(entry.assets.research.path),research=decodeResearchIndex(researchAsset.value);
  assert.equal(research.as_of_date,scan.value.as_of_date);
  assert.equal(merged.length,5901,'Authenticated full source cohort must contain all 5,901 rows');
  assert.equal(new Set(merged.map(r=>r.symbol)).size,merged.length);
  assert.equal(new Set(research.rows.map(r=>r.symbol)).size,research.rows.length);
  assert.deepEqual(merged.map(r=>r.symbol).sort(),research.rows.map(r=>r.symbol).sort());
  const project=rows=>rows.map(row=>({symbol:row.symbol,market:row.market,as_of_date:row.as_of_date,identity:identity(row),evidence:instrumentIdentityEvidence(row)})).sort((a,b)=>a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0);
  const fullProjection=project(merged),compactProjection=project(research.rows),compact=new Map(compactProjection.map(row=>[row.symbol,row]));
  const mismatches=fullProjection.filter(row=>!same(row.identity,compact.get(row.symbol).identity)).map(row=>({symbol:row.symbol,changed:Object.keys(row.identity).filter(k=>!same(row.identity[k],compact.get(row.symbol).identity[k])),full:row,compact:compact.get(row.symbol)}));
  const researchRows=new Map(research.rows.map(row=>[row.symbol,row]));
  const priceMismatches=merged.flatMap(row=>['market','current_price','adv_usd'].filter(key=>!same(row[key],researchRows.get(row.symbol)[key])).map(key=>({symbol:row.symbol,key,full:{present:Object.hasOwn(row,key),value:row[key]},research:{present:Object.hasOwn(researchRows.get(row.symbol),key),value:researchRows.get(row.symbol)[key]}})));
  save(stage+'-price-parity.json',priceMismatches);
  save(stage+'-full-identities.json',fullProjection);save(stage+'-research-identities.json',compactProjection);save(stage+'-mismatches.json',mismatches);
  const pins=[manifest,scan,...chunks,researchAsset].map(({value,...pin})=>({...pin,path:'static-data/'+pin.path}));
  const audit=readFileSync(join(front,'public/qualification-audit.json'));pins.push({path:'qualification-audit.json',bytes:audit.length,sha256:sha(audit)});
  pins.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  save(stage+'-source-files.json',pins);
  // Hash/count the original complete raw target without constructing a >256 MiB string.
  const rawDigest=createHash('sha256');let rawBytes=0;
  const measure=text=>{rawDigest.update(text);rawBytes+=Buffer.byteLength(text);};
  measure('{"market":"US","as_of_date":'+JSON.stringify(research.as_of_date)+',"rows":[');
  merged.forEach((row,index)=>{if(index)measure(',');measure(JSON.stringify(row));});measure(']}');
  const rawFull={bytes:rawBytes,sha256:rawDigest.digest('hex'),cap_bytes:256*1024*1024,exceeds_unchanged_cap:rawBytes>256*1024*1024};
  save(stage+'-raw-full-target-measurement.json',rawFull);
  const projectedRows=merged.map(row=>{
    const value=Object.fromEntries(['symbol','market','as_of_date','current_price','adv_usd','financial_identity'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
    // This target-only wrapper copies every observed field from the approved
    // extractor. It adds no name, identifier, registry value or inferred type.
    value.instrument_identity={observed_contexts:instrumentIdentityEvidence(row)};
    assert.deepEqual(identity(value),identity(row),'Projected full issuer evidence changed '+row.symbol);
    for(const key of ['symbol','market','as_of_date','current_price','adv_usd','financial_identity']){
      assert.equal(Object.hasOwn(value,key),Object.hasOwn(row,key),'Target presence changed '+row.symbol+'/'+key);
      assert.deepEqual(value[key],row[key],'Target context changed '+row.symbol+'/'+key);
    }
    return value;
  });
  const projectedProjection=project(projectedRows);
  assert.deepEqual(projectedProjection.map(row=>({symbol:row.symbol,identity:row.identity})),fullProjection.map(row=>({symbol:row.symbol,identity:row.identity})));
  save(stage+'-projected-identities.json',projectedProjection);
  const inputBindings={schema_version:'carry-target-observed-identity-inputs-v1',files:pins,raw_full_target:rawFull};
  const projected=JSON.stringify({market:'US',as_of_date:research.as_of_date,input_bindings:inputBindings,rows:projectedRows});
  const target=JSON.stringify({market:'US',as_of_date:research.as_of_date,rows:research.rows});
  report.prospective_target={stage,projected_bytes:Buffer.byteLength(projected),research_bytes:Buffer.byteLength(target),raw_full_bytes:rawFull.bytes,unchanged_cap_bytes:256*1024*1024};console.log('CARRY_DIAGNOSTIC_TARGET_SIZE '+JSON.stringify(report.prospective_target));checkpoint();
  assert.ok(Buffer.byteLength(projected)<=256*1024*1024,'Projected target exceeds unchanged 256 MiB cap');assert.ok(Buffer.byteLength(target)<=256*1024*1024,'Research target exceeds unchanged 256 MiB cap');
  save(stage+'-projected-target.json',projected,true);save(stage+'-research-target.json',target,true);
  report.stages[stage]={rows:merged.length,date:research.as_of_date,price_mismatch_count:priceMismatches.length,mismatch_count:mismatches.length,mismatch_symbols:mismatches.map(row=>row.symbol),raw_full_target:rawFull,projected_identity_mismatch_count:0,projected_target_bytes:Buffer.byteLength(projected),projected_target_sha256:sha(projected),research_target_sha256:sha(target),source_files_sha256:sha(JSON.stringify(stable(pins)))};
  const twlo=mismatches.find(row=>row.symbol==='TWLO');if(twlo)console.log('CARRY_DIAGNOSTIC_TWLO '+JSON.stringify(twlo));
  checkpoint();assert.equal(priceMismatches.length,0,'Full Research/scan market-price-liquidity parity failed');return {merged,research,projected,target,fullProjection,compactProjection,projectedProjection,mismatches};
 }
 const before=await snapshot('before');
 const sourceProjection=readFileSync(resolve(c.sourceProjection)),sourceBase=readFileSync(resolve(c.sourceBase));
 assert.equal(sha(sourceProjection),c.sourceProjectionSha256);assert.equal(sha(sourceBase),c.sourceBaseSha256);
 save('source-projection.json',sourceProjection,true);save('source-base.json',sourceBase,true);
 const options={sourceProjection,sourceProjectionSha256:c.sourceProjectionSha256,sourceBase,sourceBaseSha256:c.sourceBaseSha256,sourceLineage:c.sourceLineage,previousPublicationIdentity:c.previousPublicationIdentity,evaluatedAt:c.evaluatedAt};
 function make(target){return helper.createFinancialGenerationCarry({...options,targetBase:target,targetBaseSha256:sha(target)});}
 function environment(path,bytes,base,evaluatedAt=c.evaluatedAt){const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('FINANCIAL_CORRECTION_')||k.startsWith('FINANCIAL_GENERATION_CARRY_'))delete env[k];return {...env,FINANCIAL_EVALUATED_AT:evaluatedAt,FINANCIAL_GENERATION_CARRY_PROJECTION:path,FINANCIAL_GENERATION_CARRY_SHA256:sha(bytes),FINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE:c.sourceLineage,FINANCIAL_GENERATION_CARRY_PREVIOUS_IDENTITY:c.previousPublicationIdentity,FINANCIAL_GENERATION_CARRY_TARGET_BASE_SHA256:sha(base)};}
 const original=make(before.target),originalBytes=JSON.stringify(original);assert.ok(Buffer.byteLength(originalBytes)<=256*1024*1024,'Original carry exceeds unchanged 256 MiB cap');const originalPath=save('original-carry.json',originalBytes,true),originalEnv=environment(originalPath,originalBytes,before.target);
 report.reproduction={target_hash:sha(before.target),carry_hash:sha(originalBytes),expected_target_hash:c.failedTargetBaseSha256,expected_carry_hash:c.failedProjectionSha256};
 try {await helper.loadFinancialGenerationCarry({env:originalEnv,rows:before.merged,asOfDate:before.research.as_of_date});report.reproduction.loader='unexpected_pass';}catch(e){report.reproduction.loader='failed';report.reproduction.error=e.message;}
 checkpoint();
 assert.equal(sha(before.target),c.failedTargetBaseSha256,'Failure baseline did not reproduce; stop before correction proof');
 assert.equal(sha(originalBytes),c.failedProjectionSha256,'Failure carry bytes did not reproduce; stop before correction proof');
 assert.equal(report.reproduction.error,'Financial carry target issuer TWLO mismatch');
 report.proposed_correction={target_bytes:Buffer.byteLength(before.projected),unchanged_json_cap_bytes:256*1024*1024};checkpoint();
 const corrected=make(before.projected),correctedBytes=JSON.stringify(corrected);assert.ok(Buffer.byteLength(correctedBytes)<=256*1024*1024,'Corrected carry exceeds unchanged 256 MiB cap');const correctedPath=save('corrected-carry.json',correctedBytes,true),env=environment(correctedPath,correctedBytes,before.projected);
 const loaded=await helper.loadFinancialGenerationCarry({env,rows:before.merged,asOfDate:before.research.as_of_date});
 assert.deepEqual(loaded,corrected);
 assert.equal(JSON.stringify(make(before.projected)),correctedBytes,'Corrected derivation is nondeterministic');
 const statuses={},changes=[];
 for(const symbol of Object.keys(corrected.ownership).sort()){
  const status=corrected.ownership[symbol];statuses[status]=(statuses[status]||0)+1;
  if(status!=='retained'){const item=corrected.symbols[symbol];assert.ok(Object.values(item.financial_values).every(v=>v===null));assert.deepEqual(item.source_receipts,[]);assert.deepEqual(item.financial_history.annual,[]);assert.deepEqual(item.financial_history.quarterly,[]);}
  if(status!==original.ownership[symbol])changes.push({symbol,before:original.ownership[symbol],after:status});
 }
 save('ownership-changes.json',changes);
 report.correction={target:'closed observed-identity projection of exact approved full scan inputs; every identity and scope equals the raw row',unchanged_loader:'passed',deterministic_derivation:true,ownership:statuses,ownership_changes:changes.length,target_bytes:Buffer.byteLength(before.projected),carry_bytes:Buffer.byteLength(correctedBytes)};
 // Exercise the exact hash-bound private ownership implementation, never a rewritten normalizer.
 const base={symbol:'DIAG',market:'US',company_name:'Example Issuer',quoteType:'EQUITY'},item={market:'US'},negatives=[];
 function check(label,target,expected,source=base,projection=item){const actual=ownership(source,projection,target);negatives.push({label,expected,actual});assert.equal(actual,expected,label);}
 check('equal-positive-name',base,'retained');
 check('case-whitespace-NFKC',{...base,company_name:' ＥＸＡＭＰＬＥ   issuer '},'retained');
 check('different-name',{...base,company_name:'Other Issuer'},'identity_mismatch');
 check('different-type',{...base,quoteType:'ETF'},'identity_mismatch');
 check('nested-market',{...base,financial_historical:{detail_identity:{market:'JP'}}},'identity_mismatch');
 check('nested-symbol',{...base,financial_historical:{detail_identity:{symbol:'OTHER'}}},'identity_mismatch');
 for(const key of ['financial_identity','instrument_identity','financial_history','book_financials','institutional_evidence'])check(key+'-name',{...base,[key]:{name:'Other Issuer'}},'identity_mismatch');
 for(const key of ['company_name','name','product_name','observed_name'])check('historical-'+key,{...base,financial_historical:{detail_identity:{[key]:'Other Issuer'}}},'identity_mismatch');
 for(const kind of ['cik','cusip','isin'])check(kind+'-conflict',{...base,[kind]:'222',financial_source_evidence:{identity:{[kind]:'111'}}},'identity_mismatch');
 const bare={symbol:'DIAG',market:'US'};check('bare-ticker',bare,'unverified_issuer_identity',bare);
 for(const name of ['DIAG','unknown','n/a','0'])check('placeholder-'+name,{...bare,company_name:name},'unverified_issuer_identity',{...bare,company_name:name});
 for(const kind of ['cik','cusip','isin'])check('invalid-'+kind,{...bare,[kind]:'0000000000'},'unverified_issuer_identity',{...bare,[kind]:'0000000000'});
 check('CIK-padding',{...bare,cik:'0000001234'},'retained',{...bare,cik:1234});
 check('missing-source',base,'unowned_symbol',null);
 check('missing-owned-item',base,'unowned_symbol',base,null);
 check('source-conflict',base,'identity_mismatch',{...base,name:'Other Issuer'});
 check('projection-conflict',base,'identity_mismatch',base,{market:'US',financial_source_evidence:{identity:{name:'Other Issuer'}}});
 save('issuer-negatives.json',negatives);report.correction.issuer_checks=negatives.length;checkpoint();
 assert.equal(c.runExports,true,'Set runExports true for the required two-export roundtrip');
 // Production consumes one carried export from a completed ordinary baseline.
 // Compare two full executions of that same boundary from identical literal
 // inputs. Do not relabel the prior output-of-output failure as idempotence.
 const publicReplayRoot=join(front,'public'),replayWork=resolve(c.currentWorkRoot),replayBaseline=join(replayWork,'historical-baseline');
 assert.ok(replayWork!==publicReplayRoot&&!replayWork.startsWith(publicReplayRoot+sep)&&!publicReplayRoot.startsWith(replayWork+sep));
 mkdirSync(replayWork,{recursive:true});assert.equal(existsSync(replayBaseline),false,'Historical replay baseline already exists');
 const literalBaselineInventory=inventory(publicReplayRoot),literalBaselineHash=sha(JSON.stringify(stable(literalBaselineInventory)));
 save('historical-replay-baseline-inventory.json',literalBaselineInventory);
 report.resources.historical_baseline_copy=copyBudget(publicReplayRoot,replayWork,'copy immutable historical replay baseline');checkpoint();
 cpSync(publicReplayRoot,replayBaseline,{recursive:true,errorOnExist:true,force:false});requireSpace(replayWork,0,'after historical replay baseline copy');
 assert.deepEqual(inventory(replayBaseline),literalBaselineInventory,'Historical replay baseline copy changed bytes');
 report.historical_replay={scope:'two single carried exports from the same complete ordinary baseline',baseline_inventory_sha256:literalBaselineHash,baseline_files:Object.keys(literalBaselineInventory).length,financial_evaluated_at:c.evaluatedAt};
 checkpoint();
 let previous=before,previousInventory=null;
 for(let pass=1;pass<=2;pass++){
  const status={};report.stages['export'+pass]=status;
  assert.deepEqual(inventory(replayBaseline),literalBaselineInventory,'Immutable replay baseline changed');
  report.resources['historical_reset_'+pass]=copyBudget(replayBaseline,front,'restore exact historical baseline for replay '+pass);checkpoint();
  rmSync(publicReplayRoot,{recursive:true,force:true});cpSync(replayBaseline,publicReplayRoot,{recursive:true});requireSpace(front,0,'after historical baseline reset '+pass);
  const restored=inventory(publicReplayRoot);assert.deepEqual(restored,literalBaselineInventory,'Replay did not start from exact baseline bytes');
  status.starting_inventory_sha256=sha(JSON.stringify(stable(restored)));status.baseline_reset='exact';checkpoint();
  try{compilerBudget('historical export '+pass);execFileSync(process.execPath,['tools/export-research.mjs'],{cwd:front,env,stdio:'inherit',timeout:10*60*1000});status.export='passed';}catch(e){status.export='failed';status.error=e.message;checkpoint();throw e;}
  const after=await snapshot('after'+pass);
  const map=new Map(before.fullProjection.map(row=>[row.symbol,row.identity]));
  const identityChanges=after.fullProjection.filter(row=>!same(row.identity,map.get(row.symbol))).map(row=>({symbol:row.symbol,before:map.get(row.symbol),after:row.identity}));
  save('after'+pass+'-input-identity-changes.json',identityChanges);
  status.input_identity_changes=identityChanges.length;
  try{await helper.loadFinancialGenerationCarry({env,rows:after.merged,asOfDate:after.research.as_of_date});status.unchanged_loader='passed';}catch(e){status.unchanged_loader='failed';status.loader_error=e.message;checkpoint();throw e;}
  assert.deepEqual(after.fullProjection.map(r=>({symbol:r.symbol,identity:r.identity})),before.fullProjection.map(r=>({symbol:r.symbol,identity:r.identity})),'Full-cohort identity changed after export '+pass);
  const nextInventory=inventory(join(front,'public'));save('after'+pass+'-public-inventory.json',nextInventory);
  if(previousInventory){const paths=[...new Set([...Object.keys(previousInventory),...Object.keys(nextInventory)])].sort(),differences=paths.filter(path=>!same(previousInventory[path],nextInventory[path])).map(path=>({path,before:previousInventory[path]||null,after:nextInventory[path]||null}));save('roundtrip-file-differences.json',differences);report.roundtrip={scope:'literal deterministic replay of one carried export from the same complete ordinary baseline; not sequential re-export idempotence',starting_inventory_sha256:literalBaselineHash,identity_equal:true,byte_deterministic_replay:differences.length===0,changed_files:differences.length};}
  previous=after;previousInventory=nextInventory;checkpoint();
 }
 assert.equal(report.roundtrip.byte_deterministic_replay,true,'Identical-baseline carried exports differ; inspect retained literal inventories');
 rmSync(replayBaseline,{recursive:true,force:true});requireSpace(replayWork,0,'after completed replay baseline release');report.historical_replay.baseline_copy_released=true;checkpoint();

 // Fresh-current proof starts from the authenticated, untouched source copy.
 assert.equal(c.runCurrentProof,true,'Fresh-current proof is required');
 const clean=resolve(c.cleanSourceRoot),work=resolve(c.currentWorkRoot),publicRoot=join(front,'public');
 assert.ok(clean!==publicRoot&&!clean.startsWith(publicRoot+sep)&&!publicRoot.startsWith(clean+sep));
 assert.ok(work!==publicRoot&&!work.startsWith(publicRoot+sep)&&!publicRoot.startsWith(work+sep));
 const cleanInventory=inventory(clean),cleanHash=sha(JSON.stringify(stable(cleanInventory)));
 assert.equal(cleanHash,c.cleanSourceInventorySha256,'Clean authenticated input copy changed');
 save('current-clean-source-inventory.json',cleanInventory);
 report.resources.fresh_reset_copy=copyBudget(clean,front,'copy authenticated clean source');checkpoint();
 rmSync(publicRoot,{recursive:true,force:true});cpSync(clean,publicRoot,{recursive:true});requireSpace(front,0,'after clean source copy');
 mkdirSync(work,{recursive:true});
 const currentTime=new Date().toISOString(),currentEnv={...process.env,FINANCIAL_EVALUATED_AT:currentTime};
 delete currentEnv.NODE_OPTIONS;
 for(const key of Object.keys(currentEnv))if(key.startsWith('FINANCIAL_CORRECTION_')||key.startsWith('FINANCIAL_GENERATION_CARRY_'))delete currentEnv[key];
 report.current={evaluated_at:currentTime,basis:'actual phase clock after authenticated clean reset',clean_inventory_sha256:cleanHash,build_scope:'data export and history only; Vite/UI build omitted',child_runtime:'publisher default Node options; NODE_OPTIONS omitted',parent_runtime:'reporting process only; separately labelled heap'};
 checkpoint();
 const command=(tool,environment)=>{compilerBudget('current '+tool);const childEnv={...environment};delete childEnv.NODE_OPTIONS;assert.equal(childEnv.NODE_OPTIONS,undefined);return execFileSync(process.execPath,[tool],{cwd:front,env:childEnv,stdio:'inherit',timeout:10*60*1000});};
 command('tools/export-research.mjs',currentEnv);
 const currentBefore=await snapshot('current-before'),baseline=join(work,'baseline');
 assert.ok(!baseline.startsWith(clean+sep)&&baseline!==clean);
 report.resources.current_baseline_copy=copyBudget(publicRoot,work,'copy complete current baseline');checkpoint();
 rmSync(baseline,{recursive:true,force:true});cpSync(publicRoot,baseline,{recursive:true});requireSpace(work,0,'after current baseline copy');
 const fresh=helper.createFinancialGenerationCarry({...options,evaluatedAt:currentTime,targetBase:currentBefore.projected,targetBaseSha256:sha(currentBefore.projected)});
 const freshBytes=JSON.stringify(fresh);assert.ok(Buffer.byteLength(freshBytes)<=128*1024*1024,'Fresh carry exceeds existing 128 MiB audit file cap');const freshPath=save('current-carry.json',freshBytes,true),freshEnv=environment(freshPath,freshBytes,currentBefore.projected,currentTime);
 await helper.loadFinancialGenerationCarry({env:freshEnv,rows:currentBefore.merged,asOfDate:currentBefore.research.as_of_date});
 delete freshEnv.NODE_OPTIONS;
 // Repeat candidate target/create/load in a small independent process using
 // exactly the Node defaults used by the publisher, at this same phase clock.
 const defaultNodePath=join(resolve(c.controllerRoot),'.github/scripts/prove-carry-default-node.mjs'),defaultNodeBytes=readFileSync(defaultNodePath);
 const defaultNodeBlob=createHash('sha1').update('blob '+defaultNodeBytes.length+'\0').update(defaultNodeBytes).digest('hex');
 assert.equal(defaultNodeBlob,'e86e78ddc373ba170fdbe6e8ed956692bf461722','Default-node diagnostic code changed');
 const defaultNodeReport=join(out,'current-default-node-proof.json');
 const defaultNodeInput={schema_version:'carry-publisher-default-node-input-v1',controllerRoot:resolve(c.controllerRoot),frontendRoot:front,workRoot:join(work,'default-node'),
  reportPath:defaultNodeReport,evaluatedAt:currentTime,sourceProjection:resolve(c.sourceProjection),sourceProjectionSha256:c.sourceProjectionSha256,
  sourceBase:resolve(c.sourceBase),sourceBaseSha256:c.sourceBaseSha256,sourceLineage:c.sourceLineage,previousPublicationIdentity:c.previousPublicationIdentity,
  expectedTargetSha256:sha(currentBefore.projected),expectedCarrySha256:sha(freshBytes)};
 const defaultNodeConfig=save('current-default-node-input.json',defaultNodeInput),defaultEnv={...freshEnv};delete defaultEnv.NODE_OPTIONS;
 requireSpace(out,129*1024*1024,'default-node bounded carry and report outputs');
 const worker=spawnSync(process.execPath,[defaultNodePath,defaultNodeConfig],{cwd:front,env:defaultEnv,stdio:'inherit',timeout:10*60*1000,killSignal:'SIGKILL'});
 report.current.default_node_process={code_blob:defaultNodeBlob,status:worker.status,signal:worker.signal||null,error:worker.error?.message||null,node_options_present:Object.hasOwn(defaultEnv,'NODE_OPTIONS')};
 let defaultProof=null;
 try{const bytes=readFileSync(defaultNodeReport);assert.ok(bytes.length<=1024*1024,'Default-node report exceeds cap');defaultProof=JSON.parse(bytes);report.artifacts['current-default-node-proof.json']={path:'current-default-node-proof.json',bytes:bytes.length,sha256:sha(bytes)};}catch(error){report.current.default_node_process.report_error=error.message;}
 report.current.default_node_proof=defaultProof&&{status:defaultProof.status,node:defaultProof.node,exec_argv:defaultProof.exec_argv,node_options_present:defaultProof.node_options_present,heap_size_limit_bytes:defaultProof.heap_size_limit_bytes,max_rss:defaultProof.resource_usage?.maxRSS,max_rss_unit:defaultProof.resource_usage?.max_rss_unit,target:defaultProof.target,carry:defaultProof.carry,original_loader:defaultProof.original_loader};
 checkpoint();
 assert.ifError(worker.error);assert.equal(worker.signal,null,'Default-node carry proof was interrupted');assert.equal(worker.status,0,'Default-node carry proof failed');
 assert.equal(defaultProof?.status,'passed');assert.equal(defaultProof?.node_options_present,false);assert.deepEqual(defaultProof?.exec_argv,[]);
 assert.equal(defaultProof.target.sha256,sha(currentBefore.projected));assert.equal(defaultProof.carry.sha256,sha(freshBytes));

 // Complete universe/date/market/price admission negatives use the original loader.
 const admission=[];
 async function reject(label,rows,asOfDate,pattern){let error;try{await helper.loadFinancialGenerationCarry({env:freshEnv,rows,asOfDate});}catch(e){error=e.message;}admission.push({label,error:error||null});assert.ok(error&&pattern.test(error),label);}
 await reject('missing-row',currentBefore.merged.slice(1),currentBefore.research.as_of_date,/target universe/);
 await reject('duplicate-row',[...currentBefore.merged,currentBefore.merged[0]],currentBefore.research.as_of_date,/target universe/);
 await reject('wrong-destination-date',currentBefore.merged,'2000-01-01',/target universe/);
 for(const [key,value]of [['market','JP'],['as_of_date','2000-01-01'],['current_price',-1],['adv_usd',-1]]){
  const rows=[{...currentBefore.merged[0],[key]:value},...currentBefore.merged.slice(1)];
  await reject('changed-'+key,rows,currentBefore.research.as_of_date,/target row mismatch|target .*mismatch/);
 }
 for(const [label,mutation]of [
  ['observed-issuer-identifier',row=>({...row,instrument_identity:{observed_contexts:[...instrumentIdentityEvidence(row),{cusip:'POSTBINDING-CONFLICT'}]}})],
  ['observed-issuer-name',row=>({...row,financial_identity:{...row.financial_identity,observed_contexts:[...(row.financial_identity?.observed_contexts||[]),{name:'Postbinding conflicting issuer'}]}})],
 ]){
  const rows=[mutation(currentBefore.merged[0]),...currentBefore.merged.slice(1)];
  await reject('postbinding-'+label,rows,currentBefore.research.as_of_date,/target issuer .* mismatch/);
 }
 const missingPath='diagnostic-absent-'+sha(freshBytes)+'.json';assert.throws(()=>safeRead(missingPath),/ENOENT/);
 assert.throws(()=>mergeScanRows([{as_of_date:'2000-01-01',rows:[]}],currentBefore.research.as_of_date),/Mixed or missing snapshot dates/);
 const duplicateInput={as_of_date:currentBefore.research.as_of_date,rows:[currentBefore.merged[0],{...currentBefore.merged[0],company_name:'Conflicting synthetic issuer'}]};
 const duplicated=mergeScanRows([duplicateInput],currentBefore.research.as_of_date);
 assert.equal(duplicated.length,1);assert.equal(duplicated[0].technical_audit.valid,false);
 assert.ok(duplicated[0].technical_audit.errors.includes('同一銘柄のデータが矛盾'));
 admission.push({label:'contradictory-duplicate-copy',quarantined_by_approved_merge:true});
 admission.push({label:'missing-chunk-file',rejected:true},{label:'mixed-chunk-date',rejected:true});
 save('current-admission-negatives.json',admission);
 command('tools/export-research.mjs',freshEnv);
 command('tools/record-candidate-history.mjs',freshEnv);
 const currentAfter=await snapshot('current-after');
 await helper.loadFinancialGenerationCarry({env:freshEnv,rows:currentAfter.merged,asOfDate:currentAfter.research.as_of_date});
 assert.deepEqual(currentAfter.fullProjection.map(r=>({symbol:r.symbol,identity:r.identity})),currentBefore.fullProjection.map(r=>({symbol:r.symbol,identity:r.identity})),'Current build changed full-cohort identity');
 report.current.target_bytes=Buffer.byteLength(currentBefore.projected);report.current.carry_bytes=Buffer.byteLength(freshBytes);report.current.unchanged_json_cap_bytes=256*1024*1024;
 // Carry source clock/evidence cells stay exact; actual now never refreshes them.
 const originalSymbols=JSON.parse(sourceProjection).symbols;
 const {projectFinancialRow,FINANCIAL_FIELDS}=await import(pathToFileURL(join(front,'src/static/financialCurrent.js')));
 const {overlayFinancialCorrection}=await import(pathToFileURL(join(front,'tools/financial-correction-overlay.mjs')));
 const checkedAt=Date.now(),expiry=[],preserved=[];
 for(const row of currentBefore.merged){
  const item=fresh.symbols[row.symbol];if(fresh.ownership[row.symbol]!=='retained')continue;
  const old=originalSymbols[row.symbol];
  assert.equal(item.financial_current.t,old.financial_current.t);
  assert.deepEqual(item.financial_current.p,old.financial_current.p);
  assert.deepEqual(item.source_receipts,old.source_receipts);
  assert.deepEqual(item.financial_history.annual,old.financial_history.annual);
  assert.deepEqual(item.financial_history.quarterly,old.financial_history.quarterly);
  preserved.push(row.symbol);
  const projected=projectFinancialRow(overlayFinancialCorrection(row,fresh),{now:checkedAt,asOfDate:currentBefore.research.as_of_date});
  for(const [fieldId,tuple]of Object.entries(item.financial_current.p||{}))if(tuple[5]<checkedAt){
   const field=FINANCIAL_FIELDS[Number(fieldId)];
   const state=projected.financial_current_state.fields[field];
   assert.notEqual(state.source_validated,true,'Expired source was revived');
   assert.equal(state.value,null,'Expired source retained current value');
   expiry.push({symbol:row.symbol,field,original_expiry:tuple[5],checked_at:checkedAt,reason:state.reason});
  }
 }
 save('current-expiry-observations.json',expiry);save('current-preserved-source-symbols.json',preserved);
 report.current.original_clocks_preserved_symbols=preserved.length;report.current.already_expired_fields_unknown=expiry.length;report.current.checked_at=new Date(checkedAt).toISOString();
 checkpoint();
 try{command('tools/check-data-quality.mjs',freshEnv);report.current.data_quality='passed';}catch(e){report.current.data_quality='failed';report.current.data_quality_error=e.message;checkpoint();throw e;}
 const controller=await import(pathToFileURL(join(resolve(c.controllerRoot),'.github/scripts/financial-generation-carry-controller.mjs')));
 const actualCheckTime=Date.now();
 const compatibility=await controller.verifyCarriedBundle({baselineRoot:baseline,root:publicRoot,frontendRoot:front,carry:fresh,evaluatedAt:actualCheckTime});
 save('current-carried-bundle-verification.json',compatibility);
 report.current.verify_carried_bundle='passed';report.current.final_checked_at=new Date(actualCheckTime).toISOString();
 assert.deepEqual(readFileSync(helperPath),helperBytes,'Approved helper changed during diagnostic');
 report.current.final_source_input_unchanged=sha(JSON.stringify(stable(inventory(clean))))===cleanHash;
 assert.equal(report.current.final_source_input_unchanged,true);

 report.result='passed';checkpoint();
} catch(error){report.result='failed';report.error=error.stack||error.message;checkpoint();process.exitCode=1;}
finally{unlinkSync(derivedPath);}
