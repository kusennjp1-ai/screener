// Read-only cohort evidence; diagnostic_collected is never acceptance-gate success.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,openSync,closeSync,readSync,writeSync,mkdirSync,statfsSync} from 'node:fs';
import {resolve,join,relative,sep,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const MiB=1024**2,GiB=1024**3,RESERVE=8n*1024n**3n;
const CAPS=Object.freeze({json_file_bytes:256*MiB,examined_json_bytes:16*GiB,inventory_file_bytes:4*GiB,inventory_total_bytes:64*GiB,files:100000,depth:32,path_bytes:1024,record_bytes:8*MiB,artifact_file_bytes:64*MiB,artifact_total_bytes:GiB,stdout_bytes:2*MiB});
const EXCLUDED=new Set(['candidate-history','candidate-performance-history','financial-corrections','financial-lineage']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>object(value)||Array.isArray(value)?Object.hasOwn(value,key):false;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const sort=values=>[...values].sort();
const compare=(a,b)=>isDeepStrictEqual(a,b);
const count=(map,key)=>{map[key]=(map[key]||0)+1;};
const clock=value=>typeof value==='number'?value:Date.parse(value);

// A body is a canonical tagged tree, not JSON's lossy value serialization.
// Object keys encode presence; undefined, null, holes, -0 and nonfinite numbers
// have distinct tags. Plain/null-prototype objects also remain distinct.
function typed(value,stack=new Set()){
 if(value===undefined)return ['undefined'];
 if(value===null)return ['null'];
 if(typeof value==='string')return ['string',value];
 if(typeof value==='boolean')return ['boolean',value];
 if(typeof value==='number')return ['number',Object.is(value,-0)?'-0':Number.isNaN(value)?'NaN':value===Infinity?'Infinity':value===-Infinity?'-Infinity':String(value)];
 if(typeof value==='bigint')return ['bigint',String(value)];
 assert.ok(typeof value==='object','Unsupported typed body value');
 assert.ok(!stack.has(value),'Cyclic typed body');stack.add(value);
 const proto=Object.getPrototypeOf(value);
 assert.ok(Array.isArray(value)||proto===Object.prototype||proto===null,'Unsupported typed body prototype');
 assert.equal(Object.getOwnPropertySymbols(value).length,0,'Symbol-keyed typed body');
 const entries=Object.keys(value).sort().map(key=>[key,typed(value[key],stack)]);
 const result=Array.isArray(value)?['array',value.length,entries]:['object',proto===null?'null':'Object',entries];
 stack.delete(value);return result;
}
function typedHash(value){
 const hash=createHash('sha256'),stack=new Set();
 function visit(item){
  if(item===null||typeof item!=='object'){hash.update(JSON.stringify(typed(item)));return;}
  assert.ok(!stack.has(item),'Cyclic typed hash');stack.add(item);
  const proto=Object.getPrototypeOf(item);assert.ok(Array.isArray(item)||proto===Object.prototype||proto===null);assert.equal(Object.getOwnPropertySymbols(item).length,0);
  hash.update(Array.isArray(item)?'["array",'+item.length+',[':'["object",'+JSON.stringify(proto===null?'null':'Object')+',[');
  let first=true;for(const key of Object.keys(item).sort()){if(!first)hash.update(',');first=false;hash.update('['+JSON.stringify(key)+',');visit(item[key]);hash.update(']');}
  hash.update(']]');stack.delete(item);
 }
 visit(value);return hash.digest('hex');
}
function rawSlot(row,key){return {own:own(row,key),typed:typed(row?.[key])};}
function safeRelative(name){
 assert.equal(typeof name,'string');assert.ok(name.length&&Buffer.byteLength(name)<=CAPS.path_bytes&&!isAbsolute(name)&&!name.includes('\\')&&!name.includes('\0'));
 assert.ok(name.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Unsafe relative path');return name;
}
function safeFile(base,name){
 safeRelative(name);const path=resolve(base,name);assert.ok(path.startsWith(base+sep));
 let cursor=base;assert.ok(lstatSync(cursor).isDirectory()&&!lstatSync(cursor).isSymbolicLink());
 for(const part of name.split('/')){cursor=join(cursor,part);const st=lstatSync(cursor);assert.ok(!st.isSymbolicLink(),'Symlink input');assert.ok(cursor===path?st.isFile():st.isDirectory(),'Special input');}
 return path;
}
function fileDigest(path,limit){
 const st=lstatSync(path);assert.ok(st.isFile()&&!st.isSymbolicLink());assert.ok(st.size<=limit,'File cap exceeded '+path);
 const fd=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(MiB);let bytes=0;
 try{for(;;){const length=readSync(fd,buffer,0,buffer.length,null);if(!length)break;hash.update(buffer.subarray(0,length));bytes+=length;assert.ok(bytes<=limit,'Growing file cap exceeded '+path);}}
 finally{closeSync(fd);}
 assert.equal(bytes,st.size,'Input changed while hashing '+path);return {bytes,sha256:hash.digest('hex')};
}
function inventory(base){
 assert.ok(lstatSync(base).isDirectory()&&!lstatSync(base).isSymbolicLink());
 const result={};let files=0,total=0;
 function visit(dir,depth){
  assert.ok(depth<=CAPS.depth,'Inventory depth cap');
  for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
   const path=join(dir,entry.name),name=relative(base,path).split(sep).join('/');safeRelative(name);
   const st=lstatSync(path);assert.ok(!st.isSymbolicLink(),'Symlink in inventory');
   if(st.isDirectory())visit(path,depth+1);
   else{assert.ok(st.isFile(),'Special file in inventory');assert.ok(++files<=CAPS.files,'Inventory file cap');const pin=fileDigest(path,CAPS.inventory_file_bytes);total+=pin.bytes;assert.ok(total<=CAPS.inventory_total_bytes,'Inventory aggregate cap');result[name]=pin;}
  }
 }
 visit(base,0);return {files,total_bytes:total,entries:result};
}
// Match original overlay.jsonFiles membership and sorted return order exactly,
// while failing closed on unsafe, linked or special entries.
function jsonFiles(base){
 const result=[];
 function visit(dir,prefix,depth){
  assert.ok(depth<=CAPS.depth,'JSON depth cap');
  for(const entry of readdirSync(dir,{withFileTypes:true})){
   const name=prefix?prefix+'/'+entry.name:entry.name;safeRelative(name);
   const path=join(dir,entry.name),st=lstatSync(path);assert.ok(!st.isSymbolicLink(),'Symlink in JSON bundle');
   if(st.isDirectory()){if(!EXCLUDED.has(entry.name))visit(path,name,depth+1);}
   else{assert.ok(st.isFile(),'Special file in JSON bundle');if(entry.name.endsWith('.json'))result.push(name);}
  }
 }
 visit(base,'',0);assert.ok(result.length<=CAPS.files,'JSON file count cap');return result.sort();
}
export async function collectCarryChartAliasStates({frontendRoot,baselineRoot,publicRoot,outputDir,carry,carryBytes,inputs={},pipeline={}}){
 const front=resolve(frontendRoot),baseline=resolve(baselineRoot),publicDir=resolve(publicRoot),data=join(publicDir,'static-data'),baselineData=join(baseline,'static-data'),out=resolve(outputDir);
 assert.ok(!out.startsWith(publicDir+sep)&&out!==publicDir&&!out.startsWith(baseline+sep)&&out!==baseline);
 assert.ok(!publicDir.startsWith(out+sep)&&!baseline.startsWith(out+sep));
 mkdirSync(out,{recursive:true});assert.equal(readdirSync(out).length,0,'Collector output must be empty');
 let outputBytes=0,examinedBytes=0,coverageComplete=true;
 const report={schema_version:'all-chart-alias-carry-state-diagnostic-v1',result:'running',acceptance_gate_success:false,quality_gate:'not_run',carried_bundle_comparator:'not_run',scope:'read-only cohort collection and in-memory attribution; no publication authority',caps:CAPS,inputs,pipeline,artifacts:[],throws:[],code:[],disk:{reserve_bytes:String(RESERVE),checks:0,minimum_available_bytes:null},counts:{cohort:0,current_examined_json:0,baseline_examined_json:0,current_matching_charts:0,baseline_matching_charts:0,current_aliases:0,baseline_aliases:0,compared_aliases:0,state_compared_aliases:0,aliases_without_original_state:0,gate_mismatched_aliases:0,presence_different_aliases:0},categories:{aliases:{},ownership:{},reason_transitions:{},state_key_changes:{},expiry:{},variant_gate_mismatch:{},variant_state_mismatch:{}}};
 const sets={gate:new Set(),state:new Set(),presence:new Set(),throws:new Set(),any:new Set()},variantSets={};
 const streams=new Map(),bodyHashes=new Set(),adm=[],admBaseline=[],unmatched=[],coverage=new Map();let admBytes=0;
 function space(bytes,label){
  const fs=statfsSync(out,{bigint:true}),available=fs.bavail*fs.bsize,requested=((BigInt(bytes)+fs.bsize-1n)/fs.bsize)*fs.bsize;
  report.disk.checks++;if(report.disk.minimum_available_bytes===null||available<BigInt(report.disk.minimum_available_bytes))report.disk.minimum_available_bytes=String(available);
  assert.ok(available>=requested+RESERVE,'Collector cannot preserve 8 GiB reserve: '+label);
 }
 space(CAPS.artifact_total_bytes,'complete finite artifact budget');
 function stream(name){
  if(streams.has(name))return streams.get(name);
  const state={name,part:0,fd:null,path:null,bytes:0,hash:null,buffer:[],bufferBytes:0};
  function closePart(){if(state.fd!==null){closeSync(state.fd);report.artifacts.push({path:state.path,bytes:state.bytes,sha256:state.hash.digest('hex')});state.fd=null;}}
  function newPart(){state.path=name+'-'+String(state.part++).padStart(3,'0')+'.ndjson';state.fd=openSync(join(out,state.path),'wx');state.bytes=0;state.hash=createHash('sha256');}
  function flush(){
   if(!state.bufferBytes)return;const bytes=Buffer.concat(state.buffer,state.bufferBytes);state.buffer=[];state.bufferBytes=0;
   if(state.fd===null)newPart();if(state.bytes+bytes.length>CAPS.artifact_file_bytes){closePart();newPart();}
   assert.ok(outputBytes+bytes.length<=CAPS.artifact_total_bytes,'Artifact aggregate cap; cohort is incomplete');space(bytes.length,state.path);
   let offset=0;while(offset<bytes.length)offset+=writeSync(state.fd,bytes,offset,bytes.length-offset);
   state.hash.update(bytes);state.bytes+=bytes.length;outputBytes+=bytes.length;
  }
  const api={append(value){const bytes=Buffer.from(JSON.stringify(value)+'\n');assert.ok(bytes.length<=CAPS.record_bytes,'Artifact record cap; cohort is incomplete');if(state.bufferBytes+bytes.length>MiB)flush();state.buffer.push(bytes);state.bufferBytes+=bytes.length;if(state.bufferBytes>=MiB)flush();},close(){flush();closePart();}};
  streams.set(name,api);return api;
 }
 function body(value){
  const encoding=typed(value),bytes=JSON.stringify(encoding),hash=sha(bytes);
  if(!bodyHashes.has(hash)){stream('typed-bodies').append({sha256:hash,encoding});bodyHashes.add(hash);}
  return hash;
 }
 function slot(row,key){return {own:own(row,key),body_sha256:body(row?.[key])};}
 function scopes(row){return {symbol:slot(row,'symbol'),market:slot(row,'market'),as_of_date:slot(row,'as_of_date'),technical_audit_date:slot(row?.technical_audit,'as_of_date'),financial_identity:slot(row,'financial_identity'),observed_scope:slot(row?.financial_identity,'observed_scope'),prior_observed_scopes:slot(row?.financial_identity,'prior_observed_scopes')};}
 function proof(row){return Object.fromEntries(['r','p','t','a','s','m'].map(key=>[key,slot(row?.financial_current,key)]));}
 function noteThrow(stage,error,symbol=null,path=null,alias=null){
  coverageComplete=false;const item={stage,symbol,path,alias,error:error.stack||String(error)};report.throws.push(item);stream('throws').append(item);if(symbol){sets.throws.add(symbol);sets.any.add(symbol);const covered=coverage.get(symbol);if(covered)covered.throws++;}
 }
 function parse(base,name,which){
  const path=safeFile(base,name),st=lstatSync(path);assert.ok(st.size<=CAPS.json_file_bytes,'Examined JSON file cap '+name);assert.ok(examinedBytes+st.size<=CAPS.examined_json_bytes,'Examined aggregate JSON cap');
  const raw=readFileSync(path);assert.equal(raw.length,st.size);examinedBytes+=raw.length;
  const pin={tree:which,path:name,bytes:raw.length,sha256:sha(raw)};stream('examined-json').append(pin);report.counts[which+'_examined_json']++;
  return {pin,value:JSON.parse(raw)};
 }
 function pinCode(name,expected){
  const raw=readFileSync(safeFile(front,name)),actual=blob(raw);assert.equal(actual,expected,'Pinned approved code changed '+name);report.code.push({path:name,git_blob:actual,sha256:sha(raw),bytes:raw.length});return raw;
 }
 let publicBefore=null,baselineBefore=null,carryBeforeHash=null;
 try{
  pinCode('tools/financial-generation-carry.mjs','307319067764801afcd28ed65c5e27ae58dfbccd');
  pinCode('tools/financial-correction-overlay.mjs','ecd24f06c2be76ff40e949813ac0fb07d2f664ee');
  pinCode('src/static/financialCurrent.js','5c7a2b16b09149cab4498f1bc0d4d210a65a6a65');
  pinCode('tools/export-research.mjs','dac7f8784a0bc836ab6977e1e88ca643c49c01ed');
  const selfRaw=readFileSync(new URL(import.meta.url));report.code.push({path:'.github/scripts/collect-carry-chart-alias-states.mjs',git_blob:blob(selfRaw),sha256:sha(selfRaw),bytes:selfRaw.length});
  const {projectFinancialRow,projectFinancialPayload,FINANCIAL_FIELDS,currentFinancialHistory}=await import(pathToFileURL(join(front,'src/static/financialCurrent.js')));
  const {overlayFinancialCorrection,overlayFinancialChart,CORRECTION_FIELDS,CORRECTION_METADATA_FIELDS,CORRECTION_DEPENDENT_FIELDS,correctionMetadata}=await import(pathToFileURL(join(front,'tools/financial-correction-overlay.mjs')));
  const {decodeResearchIndex}=await import(pathToFileURL(join(front,'src/static/researchTransport.js')));
  const {instrumentApplicability}=await import(pathToFileURL(join(front,'src/static/instrumentApplicability.js')));
  assert.ok(Array.isArray(CORRECTION_FIELDS)&&Array.isArray(CORRECTION_METADATA_FIELDS));assert.equal(CORRECTION_METADATA_FIELDS.length,6);
  report.typed_body_codec={schema:'lossless-tagged-tree-v1',hash:'sha256(JSON.stringify(encoding))',property_presence:'sorted object keys and slot.own; omitted properties differ from own undefined',number_tokens:['finite String(number)','-0','NaN','Infinity','-Infinity'],array_presence:'length and sorted own enumerable key entries preserve holes',object_prototypes:['Object','null'],references:'body_sha256 resolves to a complete typed-bodies NDJSON record'};
  report.field_derivation={source:'original named exports; no helper rewrite',correction_fields:[...CORRECTION_FIELDS],financial_fields:[...FINANCIAL_FIELDS],metadata_fields:[...CORRECTION_METADATA_FIELDS]};
  const builtAt=clock(carry.financial_evaluated_at),checkAt=Date.now();assert.ok(Number.isSafeInteger(builtAt)&&checkAt>=builtAt);
  report.built_at=builtAt;report.checked_at=checkAt;report.built_at_iso=new Date(builtAt).toISOString();report.checked_at_iso=new Date(checkAt).toISOString();
  const actualCarryBytes=typeof carryBytes==='string'?Buffer.from(carryBytes):carryBytes;
  assert.ok(Buffer.isBuffer(actualCarryBytes)&&actualCarryBytes.length<=128*MiB);assert.deepEqual(JSON.parse(actualCarryBytes),carry);
  carryBeforeHash=typedHash(carry);
  report.carry={typed_sha256:carryBeforeHash,bytes:actualCarryBytes.length,sha256:sha(actualCarryBytes),financial_generation:carry.financial_generation,source_financial_generation:carry.source_financial_generation,bindings:carry.bindings,ownership_body_sha256:body(carry.ownership),uses_original_object:true,scope_capability:'original admitted carry object passed directly; never JSON-cloned for overlay'};
  const symbols=Object.keys(carry.symbols).sort();assert.equal(symbols.length,5901);report.counts.cohort=symbols.length;
  for(const symbol of symbols)coverage.set(symbol,{symbol,ownership:carry.ownership[symbol],current_chart_paths:[],baseline_chart_paths:[],current_aliases:0,baseline_aliases:0,compared_aliases:0,state_compared_aliases:0,gate_mismatched_aliases:0,presence_different_aliases:0,throws:0,research:null,chart_index:[],detail:null});
  publicBefore=inventory(publicDir);baselineBefore=inventory(baseline);stream('public-before-inventory').append(publicBefore);stream('baseline-before-inventory').append(baselineBefore);
  const manifestRead=parse(data,'manifest.json','current'),entry=manifestRead.value.markets?.US||manifestRead.value;
  const researchRead=parse(data,entry.assets.research.path,'current'),research=decodeResearchIndex(researchRead.value),chartRead=parse(data,entry.assets.charts.path,'current');
  report.binding={manifest:manifestRead.pin,research_index:researchRead.pin,chart_index:chartRead.pin,as_of_date:research.as_of_date,research_generation:manifestRead.value.research_generation};
  assert.equal(sha(readFileSync(safeFile(data,entry.assets.research.path))),manifestRead.value.research_generation);
  assert.deepEqual(research.rows.map(row=>row.symbol).sort(),symbols);assert.equal(new Set(research.rows.map(row=>row.symbol)).size,5901);
  const canonical=new Map(research.rows.map(row=>[row.symbol,row]));
  const detailCache=new Map();
  for(const row of research.rows){
   const covered=coverage.get(row.symbol);covered.research={source:researchRead.pin,symbol:row.symbol,market:rawSlot(row,'market'),as_of_date:rawSlot(row,'as_of_date'),chart_path:rawSlot(row,'chart_path'),research_detail_path:rawSlot(row,'research_detail_path'),scopes:scopes(row),state:slot(row,'financial_current_state')};
   if(typeof row.research_detail_path==='string'){
    try{const detail=parse(data,row.research_detail_path,'current');detailCache.set(row.symbol,{pin:detail.pin,chart_path:detail.value.chart_path});covered.detail={source:detail.pin,symbol:rawSlot(detail.value,'symbol'),market:rawSlot(detail.value,'market'),as_of_date:rawSlot(detail.value,'as_of_date'),chart_path:rawSlot(detail.value,'chart_path'),research_detail_path:rawSlot(detail.value,'research_detail_path'),scopes:scopes(detail.value),state:slot(detail.value,'financial_current_state')};}
    catch(error){noteThrow('detail-pointer',error,row.symbol,row.research_detail_path);}
   }else noteThrow('detail-pointer',Error('Missing canonical detail pointer'),row.symbol);
  }
  for(const item of chartRead.value.symbols||[]){
   const covered=coverage.get(item.symbol);if(covered)covered.chart_index.push({path:rawSlot(item,'path'),symbol:rawSlot(item,'symbol'),source:chartRead.pin});
  }
  const metadata=correctionMetadata(carry),fields=[...FINANCIAL_FIELDS,'eps_growth_quarterly','eps_growth_annual','financial_current','instrument_applicability','financial_identity',...CORRECTION_METADATA_FIELDS];
  const variantNames=['payload_exporter_options','payload_with_symbol','overlay_chart','overlay_then_payload_exporter_options'];
  for(const name of variantNames)variantSets[name]={gate:new Set(),state:new Set(),presence:new Set(),throws:new Set()};
  function aliases(value){
   const result=[];if(CORRECTION_FIELDS.some(key=>Object.hasOwn(value,key)))result.push(['root',value]);
   for(const key of ['stock_data','fundamentals'])if(object(value[key]))result.push([key,value[key]]);
   return result;
  }
  function chartSymbol(value){return Array.isArray(value?.bars)?value.symbol??value.stock_data?.symbol:null;}
  function compareRow(actual,expected,stateRequired,gateFields){
   const deltas=fields.map(field=>({field,gate:gateFields.includes(field),actual:slot(actual,field),expected:slot(expected,field),value_equal:compare(actual?.[field],expected?.[field]),presence_equal:own(actual,field)===own(expected,field)}));
   const state={compared:stateRequired,actual:slot(actual,'financial_current_state'),expected:slot(expected,'financial_current_state'),equal:stateRequired?compare(actual?.financial_current_state,expected?.financial_current_state):null};
   return {fields:deltas.filter(item=>!item.value_equal||!item.presence_equal),state,gate_mismatch:deltas.some(item=>item.gate&&!item.value_equal)||(stateRequired&&!state.equal),presence_difference:deltas.some(item=>!item.presence_equal)||own(actual,'financial_current_state')!==own(expected,'financial_current_state')};
  }
  function gateContract(row){
   const rowItem=carry.symbols[row?.symbol];
   return {rowItem,branch:rowItem?'carry_item':'safe_no_item',fields:rowItem?fields:[...FINANCIAL_FIELDS,'financial_current']};
  }
  function expectation(row,contract=gateContract(row),project=projectFinancialRow,overlay=overlayFinancialCorrection){
   return contract.rowItem?project(overlay({...row,symbol:row.symbol,market:contract.rowItem.market,as_of_date:contract.rowItem.as_of_date},carry),{now:builtAt}):project(row,{now:builtAt,asOfDate:research.as_of_date});
  }
  function scanners(actual,expected){
   const differences=[];let compared=0;
   for(const key of ['screener_results','screener_details','screeners'])if(object(actual?.[key]))for(const [name,value]of Object.entries(actual[key]))if(/^(minervini|canslim|ipo|custom)$/i.test(name)){
    compared++;if(!compare(value,expected?.[key]?.[name]))differences.push({container:key,scanner:name,actual:body(value),expected:body(expected?.[key]?.[name])});
   }
   return {compared,mismatches:differences,gate_mismatch:differences.length>0};
  }
  // Regression: a financial root with no own symbol must never enter carry
  // overlay solely because its containing chart matched a carry symbol.
  const missingSymbolRoot={market:carry.symbols[symbols[0]].market,as_of_date:research.as_of_date,[FINANCIAL_FIELDS[0]]:null};
  const missingContract=gateContract(missingSymbolRoot),calls=[];
  const probe=expectation(missingSymbolRoot,missingContract,(row,options)=>{calls.push({row,options});return row;},()=>{throw Error('Root/no-item regression incorrectly invoked carry overlay');});
  assert.equal(missingContract.branch,'safe_no_item');assert.deepEqual(missingContract.fields,[...FINANCIAL_FIELDS,'financial_current']);assert.equal(probe,missingSymbolRoot);assert.equal(calls.length,1);assert.deepEqual(calls[0].options,{now:builtAt,asOfDate:research.as_of_date});
  assert.equal(gateContract({symbol:symbols[0]}).branch,'carry_item');
  assert.equal(gateContract({...missingSymbolRoot,symbol:undefined}).branch,'safe_no_item');
  report.internal_branch_regression={status:'passed',root_missing_symbol:'safe_no_item',root_own_undefined_symbol:'safe_no_item',root_known_symbol:'carry_item',no_item_fields:[...missingContract.fields],no_item_options:calls[0].options};
  function invariants(row,containing,item){
   return {scope:scopes(row),proof:proof(row),metadata:Object.fromEntries(CORRECTION_METADATA_FIELDS.map(field=>[field,{actual:slot(row,field),expected:body(metadata[field]),equal:compare(row?.[field],metadata[field])}])),correction_fields:body(Object.fromEntries(CORRECTION_FIELDS.filter(field=>own(row,field)).map(field=>[field,row[field]]))),dependent_nonnull:CORRECTION_DEPENDENT_FIELDS.filter(field=>own(row,field)&&row[field]!==null).map(field=>({field,value:slot(row,field)})),containing_root_scope:scopes(containing),carry_scope:{market:body(item.market),as_of_date:body(item.as_of_date)}};
  }
  function invariantChanges(original,candidate){
   const scope=[];for(const key of ['symbol','market','as_of_date'])if(!compare(original?.[key],candidate?.[key])||own(original,key)!==own(candidate,key))scope.push({key,original:slot(original,key),variant:slot(candidate,key)});
   for(const key of ['observed_scope','prior_observed_scopes'])if(!compare(original?.financial_identity?.[key],candidate?.financial_identity?.[key])||own(original?.financial_identity,key)!==own(candidate?.financial_identity,key))scope.push({key:'financial_identity.'+key,original:slot(original?.financial_identity,key),variant:slot(candidate?.financial_identity,key)});
   const proofChanges=[];for(const key of ['r','p','t','a','s','m'])if(!compare(original?.financial_current?.[key],candidate?.financial_current?.[key])||own(original?.financial_current,key)!==own(candidate?.financial_current,key))proofChanges.push({key,original:slot(original?.financial_current,key),variant:slot(candidate?.financial_current,key)});
   const financialValues=[];for(const key of CORRECTION_FIELDS)if(!compare(original?.[key],candidate?.[key])||own(original,key)!==own(candidate,key))financialValues.push({key,original:slot(original,key),variant:slot(candidate,key)});
   return {scope_changes:scope,proof_changes:proofChanges,financial_value_changes:financialValues,state_equal_to_original:compare(original?.financial_current_state,candidate?.financial_current_state)};
  }
  function stateCounts(actual,expected,alias,ownership){
   for(const key of sort(new Set([...Object.keys(actual||{}),...Object.keys(expected||{})])).filter(key=>key!=='fields'))if(!compare(actual?.[key],expected?.[key])||own(actual,key)!==own(expected,key))count(report.categories.state_key_changes,alias+'/'+ownership+'/state.'+key);
   for(const field of FINANCIAL_FIELDS){
    const a=actual?.fields?.[field],e=expected?.fields?.[field];
    count(report.categories.reason_transitions,alias+'/'+ownership+'/'+field+'/'+JSON.stringify(typed(a?.reason))+' => '+JSON.stringify(typed(e?.reason)));
    for(const key of sort(new Set([...Object.keys(a||{}),...Object.keys(e||{})])))if(!compare(a?.[key],e?.[key])||own(a,key)!==own(e,key))count(report.categories.state_key_changes,alias+'/'+ownership+'/'+field+'.'+key);
   }
  }
  for(const which of ['baseline','current']){
   const base=which==='baseline'?baselineData:data,paths=jsonFiles(base),seen=new Set();
   for(const path of paths){
    let file;try{file=parse(base,path,which);}catch(error){noteThrow(which+'-json',error,null,path);continue;}
    const value=file.value,symbol=chartSymbol(value);if(!carry.symbols[symbol])continue;
    const item=carry.symbols[symbol],covered=coverage.get(symbol);covered[which+'_chart_paths'].push(path);report.counts[which+'_matching_charts']++;seen.add(path);
    if(which==='baseline'){
     // Record containing scope for every matching chart, even alias-free charts.
     const record={symbol,ownership:carry.ownership[symbol],source:file.pin,containing_root:scopes(value),containing_stock_data:scopes(value.stock_data),aliases:aliases(value).map(([alias,row])=>({alias,scope:scopes(row),proof:proof(row),state:slot(row,'financial_current_state'),correction_field_ownership:Object.fromEntries(CORRECTION_FIELDS.map(field=>[field,own(row,field)]))}))};
     stream('baseline-chart-scopes').append(record);covered.baseline_aliases+=record.aliases.length;report.counts.baseline_aliases+=record.aliases.length;
     if(symbol==='ADM'){const encoded={source:file.pin,root_scope:typed(Object.fromEntries(['symbol','market','as_of_date','financial_identity'].filter(k=>own(value,k)).map(k=>[k,value[k]]))),alias_scopes:record};const bytes=Buffer.byteLength(JSON.stringify(encoded));assert.ok(admBytes+bytes<=CAPS.stdout_bytes,'ADM printed proof cap');admBytes+=bytes;admBaseline.push(encoded);}
     continue;
    }
    const chartBefore=structuredClone(value),itemBefore=structuredClone(item);
    const exporterOptions={now:builtAt,asOfDate:research.as_of_date,market:canonical.get(symbol)?.market};
    const variants=new Map();
    for(const name of variantNames){
     try{
      const result=name==='payload_exporter_options'?projectFinancialPayload(value,exporterOptions):name==='payload_with_symbol'?projectFinancialPayload(value,{...exporterOptions,symbol}):name==='overlay_chart'?overlayFinancialChart(value,carry,symbol):projectFinancialPayload(overlayFinancialChart(value,carry,symbol),exporterOptions);
      assert.deepEqual(value,chartBefore,'Variant mutated original chart '+name+'/'+path);assert.deepEqual(item,itemBefore,'Variant mutated original carry symbol '+name+'/'+symbol);
      variants.set(name,{value:result});
     }catch(error){const message=error.stack||String(error);variants.set(name,{error:message});variantSets[name].throws.add(symbol);noteThrow('variant/'+name,error,symbol,path);}
    }
    assert.deepEqual(value,chartBefore,'Attribution variant mutated the original chart '+path);
    const locations=aliases(value);stream('current-chart-containers').append({symbol,ownership:carry.ownership[symbol],source:file.pin,root_scope:scopes(value),stock_data_scope:scopes(value.stock_data),chart_metadata:Object.fromEntries(CORRECTION_METADATA_FIELDS.map(field=>[field,slot(value,field)])),alias_names:locations.map(([alias])=>alias),eps_line:slot(value,'eps_line')});
    for(const [alias,original]of locations){
     covered.current_aliases++;report.counts.current_aliases++;count(report.categories.aliases,alias);count(report.categories.ownership,alias+'/'+carry.ownership[symbol]);
     const stateRequired=own(original,'financial_current_state'),row=alias==='root'?original:{...original,symbol:original.symbol??symbol};
     const record={symbol,ownership:carry.ownership[symbol],alias,source:file.pin,full_contract:false,original_state_own:stateRequired,containing_root:scopes(value),containing_stock_data:scopes(value.stock_data),original_alias_scope:scopes(original),gate_row_scope:scopes(row),actual_state:slot(original,'financial_current_state'),actual_proof:proof(original),carry_proof:proof(item),carry_financial_values_sha256:body(item.financial_values),original_correction_field_ownership:Object.fromEntries(CORRECTION_FIELDS.map(field=>[field,own(original,field)])),references:{chart_index:covered.chart_index,research_chart_path:covered.research.chart_path,detail:covered.detail,active_research_chart:canonical.get(symbol)?.chart_path===path,active_chart_index:covered.chart_index.some(ref=>compare(ref.path.typed,typed(path)))}};
     if(!stateRequired)report.counts.aliases_without_original_state++;
     try{
      const contract=gateContract(row),expected=expectation(row,contract);
      record.gate_branch=contract.branch;record.gate_symbol=rawSlot(row,'symbol');record.gate_fields=[...contract.fields];
      record.expected_state=slot(expected,'financial_current_state');record.expected_proof=proof(expected);record.expected_scope=scopes(expected);
      record.comparison=compareRow(row,expected,stateRequired,contract.fields);record.scanner_comparison=scanners(row,expected);record.actual_invariants=invariants(row,value,item);record.expected_invariants=invariants(expected,value,item);
      record.applicability_gate=contract.rowItem?.instrument_applicability?{actual:slot(row,'instrument_applicability'),computed:body(instrumentApplicability(row)),equal:compare(row.instrument_applicability,instrumentApplicability(row))}:null;
      covered.compared_aliases++;report.counts.compared_aliases++;
      if(stateRequired){covered.state_compared_aliases++;report.counts.state_compared_aliases++;stateCounts(original.financial_current_state,expected.financial_current_state,alias,carry.ownership[symbol]);}
      if(record.comparison.gate_mismatch||record.scanner_comparison.gate_mismatch||record.applicability_gate?.equal===false){covered.gate_mismatched_aliases++;report.counts.gate_mismatched_aliases++;sets.gate.add(symbol);sets.any.add(symbol);}
      if(stateRequired&&!record.comparison.state.equal)sets.state.add(symbol);
      if(record.comparison.presence_difference){covered.presence_different_aliases++;report.counts.presence_different_aliases++;sets.presence.add(symbol);sets.any.add(symbol);}
      record.expiry=[];
      let current;try{current=projectFinancialRow(row,{now:checkAt});}catch(error){noteThrow('later-row',error,symbol,path,alias);record.later_error=error.stack||String(error);}
      for(const [fieldId,tuple]of Object.entries(item.financial_current?.p||{})){
       const field=FINANCIAL_FIELDS[Number(fieldId)];if(!field)continue;
       const category=typeof tuple?.[5]!=='number'?'invalid_expiry':tuple[5]<builtAt?'expired_at_build':tuple[5]<checkAt?'expired_between_build_and_check':'not_expired_at_check';
       const observation={field,proof_reason:item.financial_current.r?.[Number(fieldId)],expiry:slot(tuple,'5'),category,built_actual_state:body(original.financial_current_state?.fields?.[field]),built_expected_state:body(expected.financial_current_state?.fields?.[field]),later_state:body(current?.financial_current_state?.fields?.[field])};record.expiry.push(observation);count(report.categories.expiry,alias+'/'+carry.ownership[symbol]+'/'+category);
      }
      const historyBefore=currentFinancialHistory(item.financial_history,symbol,item.as_of_date,builtAt),historyAfter=currentFinancialHistory(item.financial_history,symbol,item.as_of_date,checkAt);
      record.history_at_build=body(historyBefore);record.history_at_check=body(historyAfter);
      record.variants={};
      for(const name of variantNames){
       const candidate=variants.get(name);
       if(candidate.error){record.variants[name]={error:candidate.error};continue;}
       const candidateRow=alias==='root'?candidate.value:candidate.value?.[alias];
       const variantRecord={comparison:compareRow(candidateRow,expected,stateRequired,contract.fields),scanner_comparison:scanners(candidateRow,expected),invariant_deltas:invariantChanges(original,candidateRow),containing_invariant_deltas:invariantChanges(value,candidate.value),invariants:invariants(candidateRow,candidate.value,item),state:slot(candidateRow,'financial_current_state'),proof:proof(candidateRow)};
       record.variants[name]=variantRecord;
       if(variantRecord.comparison.gate_mismatch||variantRecord.scanner_comparison.gate_mismatch){count(report.categories.variant_gate_mismatch,name+'/'+alias+'/'+carry.ownership[symbol]);variantSets[name].gate.add(symbol);}
       if(variantRecord.comparison.presence_difference)variantSets[name].presence.add(symbol);
       if(stateRequired&&!variantRecord.comparison.state.equal){count(report.categories.variant_state_mismatch,name+'/'+alias+'/'+carry.ownership[symbol]);variantSets[name].state.add(symbol);}
      }
      if(symbol==='ADM'){
       const printed={path,source_sha256:file.pin.sha256,alias,ownership:carry.ownership[symbol],state_compared:stateRequired,actual_state:rawSlot(original,'financial_current_state'),expected_state:rawSlot(expected,'financial_current_state'),root_scope:typed(Object.fromEntries(['symbol','market','as_of_date','financial_identity'].filter(k=>own(value,k)).map(k=>[k,value[k]]))),stock_data_scope:typed(Object.fromEntries(['symbol','market','as_of_date','financial_identity'].filter(k=>own(value.stock_data,k)).map(k=>[k,value.stock_data[k]]))),alias_scope:typed(Object.fromEntries(['symbol','market','as_of_date','financial_identity'].filter(k=>own(original,k)).map(k=>[k,original[k]]))),gate_mismatch:record.comparison.gate_mismatch};
       const bytes=Buffer.byteLength(JSON.stringify(printed));assert.ok(admBytes+bytes<=CAPS.stdout_bytes,'ADM printed proof cap');admBytes+=bytes;adm.push(printed);
      }
     }catch(error){record.error=error.stack||String(error);noteThrow('current-alias',error,symbol,path,alias);}
     stream('current-aliases').append(record);
    }
   }
   if(which==='current'){
    for(const symbol of symbols){
     const covered=coverage.get(symbol),row=canonical.get(symbol);
     for(const [kind,path]of [['research_chart',row.chart_path],['detail_chart',detailCache.get(symbol)?.chart_path],...covered.chart_index.map(ref=>['chart_index',ref.path.typed[0]==='string'?ref.path.typed[1]:undefined])]){
      if(path==null)continue;if(typeof path!=='string'||!seen.has(path)){const record={symbol,kind,path:typed(path),reason:'pointer_not_in_matching_chart_enumeration'};unmatched.push(record);noteThrow('active-pointer-coverage',Error(record.reason),symbol,typeof path==='string'?path:null);}
     }
    }
   }
  }
  for(const symbol of symbols){const item=coverage.get(symbol);item.no_current_chart=item.current_chart_paths.length===0;item.no_current_alias=item.current_aliases===0;item.no_baseline_chart=item.baseline_chart_paths.length===0;item.no_baseline_alias=item.baseline_aliases===0;stream('symbol-coverage').append(item);}
  report.counts.current_symbols_with_charts=[...coverage.values()].filter(item=>!item.no_current_chart).length;
  report.counts.current_symbols_with_aliases=[...coverage.values()].filter(item=>!item.no_current_alias).length;
  report.counts.baseline_symbols_with_charts=[...coverage.values()].filter(item=>!item.no_baseline_chart).length;
  report.counts.baseline_symbols_with_aliases=[...coverage.values()].filter(item=>!item.no_baseline_alias).length;
  report.counts.current_symbols_without_charts=symbols.length-report.counts.current_symbols_with_charts;
  report.counts.current_symbols_without_aliases=symbols.length-report.counts.current_symbols_with_aliases;
  report.mismatched_symbols=Object.fromEntries(Object.entries(sets).map(([name,values])=>[name,sort(values)]));report.variant_mismatched_symbols=Object.fromEntries(Object.entries(variantSets).map(([name,kinds])=>[name,Object.fromEntries(Object.entries(kinds).map(([kind,values])=>[kind,sort(values)]))]));report.unmatched_active_pointers=unmatched;report.examined_json_bytes=examinedBytes;report.typed_body_count=bodyHashes.size;
 }catch(error){coverageComplete=false;report.error=error.stack||String(error);}
 finally{
  try{
   const publicAfter=inventory(publicDir),baselineAfter=inventory(baseline);stream('public-after-inventory').append(publicAfter);stream('baseline-after-inventory').append(baselineAfter);
   report.read_only={public_before_sha256:publicBefore?sha(JSON.stringify(publicBefore)):null,public_after_sha256:sha(JSON.stringify(publicAfter)),baseline_before_sha256:baselineBefore?sha(JSON.stringify(baselineBefore)):null,baseline_after_sha256:sha(JSON.stringify(baselineAfter)),public_unchanged:publicBefore!==null&&compare(publicBefore,publicAfter),baseline_unchanged:baselineBefore!==null&&compare(baselineBefore,baselineAfter)};
   assert.equal(report.read_only.public_unchanged,true,'Collector changed public bytes');assert.equal(report.read_only.baseline_unchanged,true,'Collector changed baseline bytes');
   for(const pin of report.code.filter(item=>!item.path.startsWith('.github/')))assert.equal(blob(readFileSync(safeFile(front,pin.path))),pin.git_blob,'Pinned helper changed during collection');
  }catch(error){coverageComplete=false;report.inventory_error=error.stack||String(error);}
  for(const writer of streams.values())try{writer.close();}catch(error){coverageComplete=false;report.artifact_error=error.stack||String(error);}
 }
 try{assert.equal(typedHash(carry),carryBeforeHash,'Collector mutated actual admitted carry');report.carry.in_memory_unchanged=true;}catch(error){coverageComplete=false;report.carry_mutation_error=error.stack||String(error);}
 report.complete=coverageComplete;report.result=coverageComplete?'diagnostic_collected':'diagnostic_incomplete';report.finished_at=new Date().toISOString();report.output_bytes=outputBytes;
 const proofText='CHART_ALIAS_DIAGNOSTIC '+JSON.stringify({result:report.result,complete:report.complete,acceptance_gate_success:false,built_at:report.built_at,checked_at:report.checked_at,counts:report.counts,categories:report.categories,mismatched_symbols:report.mismatched_symbols,variant_mismatched_symbols:report.variant_mismatched_symbols,throws:report.throws.length,read_only:report.read_only,adm_actual_expected_and_scopes:adm,adm_baseline_scopes:admBaseline})+'\n';
 if(Buffer.byteLength(proofText)>CAPS.stdout_bytes){report.complete=false;report.result='diagnostic_incomplete';report.stdout_error='Complete requested printed proof exceeds explicit stdout cap';}
 const reportBytes=Buffer.from(JSON.stringify(report,null,2)+'\n');assert.ok(reportBytes.length<=CAPS.artifact_file_bytes&&outputBytes+reportBytes.length<=CAPS.artifact_total_bytes,'Collector report cap; no successful cohort claim');
 space(reportBytes.length,'collector report');const reportFd=openSync(join(out,'report.json'),'wx');try{let offset=0;while(offset<reportBytes.length)offset+=writeSync(reportFd,reportBytes,offset,reportBytes.length-offset);}finally{closeSync(reportFd);}space(0,'after collector');
 if(report.stdout_error)console.log('CHART_ALIAS_DIAGNOSTIC '+JSON.stringify({result:report.result,complete:false,error:report.stdout_error,report_sha256:sha(reportBytes)}));else process.stdout.write(proofText);
 const result={result:report.result,complete:report.complete,acceptance_gate_success:false,counts:report.counts,mismatched_symbols:report.mismatched_symbols,variant_mismatched_symbols:report.variant_mismatched_symbols,throws:report.throws.length,built_at:report.built_at,checked_at:report.checked_at,read_only:report.read_only,report:{path:'chart-alias-states/report.json',bytes:reportBytes.length,sha256:sha(reportBytes)},code:report.code,caps:CAPS,output_bytes:outputBytes+reportBytes.length};
 if(!report.complete){const error=Error('Chart alias collection incomplete: '+(report.error||report.inventory_error||report.artifact_error||report.stdout_error||'coverage-affecting throws'));error.diagnostic=result;throw error;}
 return result;
}
