// One dated ordinary, price-only carry repair. This is not finite-source,
// financial-renewal, preview, or new-UI authority. All financial gates remain.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
const freeze=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);};
export const ORDINARY_CARRY=freeze({
  schema_version:'ordinary-carry-tooling-identity-v1',amendment_id:'oct9-carry-single-projection-v1',repository:'kusennjp1-ai/screener',
  role:'ordinary_data_only',not_before:'2026-10-10T00:00:00Z',not_after:'2026-10-10T14:59:00Z',
  ui_sha:'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',ui_tree:'1c0219a170dcbdeb1af539e4cf7a04018251ca02',
  ui_digest:'72fd791b42a691e286279cada721207a812d13b13233e814d0c2cfde73571788',
  original_exporter_sha256:'90e9f7316b34f171a726bc9245805e67e8d316b7367e288924ce568583fc3946',
  temporary_exporter_sha256:'f9e0ad58f7bbaf911eab2943fcfb18df32f6ee881c3847272f5201e448d9cf40',
  source:{artifact_id:11659250929,artifact_bytes:300364092,artifact_sha256:'de47f97f7c713ce70627ca9507f5cbece64ac6e441f581aee3fadb1be9c46a45',run_id:38017220147,run_attempt:1,head_sha:'2e289c42c00e0d0bad05263ab8273a257dc0ae8e',created_at:'2026-10-10T04:22:09Z',manifest_sha256:'da830e8202fe9a7cd4cc9c9d383c9069ccb5e13fb3db564ac46ee52a8d4a60a9',price_observations_sha256:'e8107f9b61d4de7f25a81367b0e94b3367d0b9124f9838b647ea1a4f8462deb7',as_of_date:'2026-10-09'},
  predecessor:{identity:'37456692717/1/0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a/ab65c8bb05f33cadd1eec71c858ed67a6ba7578ed9772c7d9ccbf24873161dd0',receipt_sha256:'0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a',transport_root_sha256:'12e0304288a72e92f1efbe7bd59aa0b3b16272b1f0c201412d3b4870a4481d11',lineage_sha256:'2828fbf2d497ae32c29ddb46a34903a9c1c8494862e127ba67dff9880e356a13',generation:'69c80cd8bfa2a4bedf891aea1e82229b4d6768e59914f15fb9ef9e09b51c7de7',source_projection_sha256:'a93042a6f6ad40c9bbf0f518bf5580d1a1a014e2fc70380569edcde76c965b9a',source_base_sha256:'94d3f1f08869fe625c678e64c1699bf024050c7a5208847168a67c3c0e2b8b27'}
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const same=(a,b,message)=>assert.deepEqual(ordered(a),ordered(b),message);
const digest=v=>sha(JSON.stringify(ordered(v)));
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const gitHash=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const iso=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*Z$/.test(v)&&Number.isFinite(Date.parse(v));
const positive=v=>Number.isSafeInteger(v)&&v>0;
const closed=(v,keys,message)=>{assert(v&&typeof v==='object'&&!Array.isArray(v),message);same(Object.keys(v).sort(),keys.slice().sort(),message);};
export const ORDINARY_ENTRY='.ordinary-carry-oct9-export.mjs';
export const HISTORY_PATH='static-data/financial-history.json';
function regular(path,cap=128*1024**2){assert(realpathSync(path)===resolve(path),'Linked ordinary tooling input');const st=lstatSync(path);assert(st.isFile()&&!st.isSymbolicLink()&&st.size<=cap,'Unsafe ordinary tooling input');return readFileSync(path);}
export function ordinaryCarrySelected(state){return state.source?.artifact?.id===ORDINARY_CARRY.source.artifact_id||Boolean(state.ordinaryCarryTooling);}
export function assertOrdinaryClock(now){assert(Number.isFinite(now)&&now>=Date.parse(ORDINARY_CARRY.not_before)&&now<=Date.parse(ORDINARY_CARRY.not_after),'Ordinary carry execution window is closed');return new Date(now).toISOString();}
export function validateOrdinaryContext(state,context){
  assert(state.decision?.publish&&state.decision.mode==='data'&&state.carry&&!state.source?.receiptHash&&!state.source?.publication&&!state.source?.repair&&!state.publisherTooling&&!state.sourceRecovery&&!state.correction&&!state.activation&&!state.renewal&&!state.decision.migration&&!state.designCarryPreview,'Ordinary carry is an exclusive data-only route');
  const p=ORDINARY_CARRY.source,s=state.source,a=s.artifact,live=state.live,prior=live.financialRelease;
  same({artifact_id:a.id,artifact_bytes:a.size_in_bytes,artifact_sha256:a.digest?.slice(7),run_id:s.runId,run_attempt:s.attempt,head_sha:a.workflow_run?.head_sha,created_at:a.created_at,manifest_sha256:s.manifestHash,price_observations_sha256:s.priceObservationsDigest,as_of_date:s.manifest.markets?.US?.as_of_date},p,'Ordinary carry selected source changed');
  assert(a.digest===`sha256:${p.artifact_sha256}`&&a.name===`static-site-data-${p.run_id}-${p.run_attempt}`&&a.workflow_run?.id===p.run_id,'Ordinary source identity mismatch');
  assert(state.sourceSha===ORDINARY_CARRY.ui_sha&&live.uiSha===ORDINARY_CARRY.ui_sha&&live.uiDigest===ORDINARY_CARRY.ui_digest&&live.identity===ORDINARY_CARRY.predecessor.identity&&live.receiptHash===ORDINARY_CARRY.predecessor.receipt_sha256,'Ordinary carry approved UI/predecessor changed');
  assert(prior?.mode==='carry'||prior?.mode==='activation','Ordinary carry requires active authenticated financial release');
  for(const [key,value]of Object.entries({lineage_sha256:prior.lineage_sha256,generation:prior.financial_generation,source_projection_sha256:prior.source_projection.sha256,source_base_sha256:prior.source_base.sha256,transport_root_sha256:live.receipt?.transport?.root?.sha256}))assert(value===ORDINARY_CARRY.predecessor[key],'Ordinary predecessor '+key+' changed');
  assert(state.historyReconciliation?.admitted_observations===650&&state.historyReconciliation?.source_artifact_digest===a.digest,'Ordinary carry lost selected 650-observation history');
  closed(context,['controller','caller','event','ui_only','now'],'Ordinary context fields');
  closed(context.controller,['head','tree'],'Ordinary controller fields');closed(context.caller,['run_id','run_attempt','job_id','started_at'],'Ordinary caller fields');
  assert(context.event==='workflow_dispatch'&&context.ui_only===true&&context.controller.head===state.controllerSha&&gitHash(context.controller.head)&&gitHash(context.controller.tree),'Ordinary carry requires explicit current-controller UI-only dispatch');
  assert(positive(context.caller.run_id)&&context.caller.run_attempt===1&&positive(context.caller.job_id)&&iso(context.caller.started_at)&&Date.parse(context.caller.started_at)<=context.now,'Invalid ordinary carry caller/clock');
  assertOrdinaryClock(context.now);
  return true;
}
// Stream the pinned ZIP and TAR; inspect every member before deriving absence.
// No guessed file or unpinned live response is an admissible raw source.
export function authenticateOrdinaryArchive({zip,tar}){
  for(const path of [zip,tar]){assert(realpathSync(path)===resolve(path)&&lstatSync(path).isFile(),'Unsafe ordinary source archive');}
  const report=JSON.parse(execFileSync('python3',['-c',`import sys,hashlib,json,zipfile,tarfile,pathlib
z,t,expected,expected_bytes=sys.argv[1:]
def digest(path):
 with open(path,'rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
assert pathlib.Path(z).stat().st_size==int(expected_bytes) and pathlib.Path(t).stat().st_size<=2*1024**3,'Ordinary archive size limit'
before={p:(pathlib.Path(p).stat().st_dev,pathlib.Path(p).stat().st_ino,pathlib.Path(p).stat().st_size,pathlib.Path(p).stat().st_mtime_ns,pathlib.Path(p).stat().st_ctime_ns) for p in (z,t)}
zsha=digest(z);assert zsha==expected,'Unpinned ordinary ZIP'
with zipfile.ZipFile(z) as a:
 entries=a.infolist(); assert len(entries)==1 and entries[0].filename=='artifact.tar' and not entries[0].is_dir() and entries[0].file_size<=2*1024**3, 'Unexpected source ZIP members'
 with a.open(entries[0]) as f:member=hashlib.file_digest(f,'sha256').hexdigest()
actual=digest(t);assert member==actual,'TAR differs from pinned ZIP'
files={};seen=set()
with tarfile.open(t) as a:
 for m in a:
  p=m.name
  while p.startswith('./'):p=p[2:]
  p=p.rstrip('/')
  if not p or p=='.':continue
  assert not p.startswith('/') and '\\\\' not in p and all(x not in ('','.','..') for x in p.split('/')) and p not in seen,'Unsafe archive member'
  assert m.isfile() or m.isdir(),'Linked or special archive member'
  seen.add(p)
  if m.isfile() and p.startswith('static-data/'):
   with a.extractfile(m) as f:files[p]=hashlib.file_digest(f,'sha256').hexdigest()
assert digest(z)==zsha and digest(t)==actual,'Source archive changed during inspection'
assert before=={p:(pathlib.Path(p).stat().st_dev,pathlib.Path(p).stat().st_ino,pathlib.Path(p).stat().st_size,pathlib.Path(p).stat().st_mtime_ns,pathlib.Path(p).stat().st_ctime_ns) for p in (z,t)},'Source archive identity changed during inspection'
print(json.dumps({'zip_sha256':zsha,'zip_bytes':pathlib.Path(z).stat().st_size,'tar_sha256':actual,'files':files},sort_keys=True))`,zip,tar,ORDINARY_CARRY.source.artifact_sha256,String(ORDINARY_CARRY.source.artifact_bytes)],{encoding:'utf8',maxBuffer:32*1024**2,timeout:300000}));
  assert(report.zip_sha256===ORDINARY_CARRY.source.artifact_sha256&&report.zip_bytes===ORDINARY_CARRY.source.artifact_bytes,'Unpinned ordinary ZIP');
  assert(report.files['static-data/manifest.json']===ORDINARY_CARRY.source.manifest_sha256,'Ordinary raw manifest changed');
  assert(!Object.hasOwn(report.files,HISTORY_PATH),'Ordinary empty history requires authenticated source absence');
  return {artifact_sha256:report.zip_sha256,tar_sha256:report.tar_sha256,raw_static_inventory_sha256:digest(report.files),source_history_present:false,manifest_sha256:report.files['static-data/manifest.json']};
}
const emptyHistory=()=>JSON.stringify({as_of_date:ORDINARY_CARRY.source.as_of_date,results:{}});
export function materializeOrdinaryHistory(root){
  const path=join(root,HISTORY_PATH);assert(!existsSync(path),'Authenticated absent history appeared before derivation');
  assert(realpathSync(dirname(path))===resolve(dirname(path)),'Linked ordinary history parent');
  writeFileSync(path,emptyHistory(),{flag:'wx',mode:0o644});assert.equal(sha(regular(path)),sha(emptyHistory()));
  return {schema_version:'ordinary-empty-history-derivation-v1',path:HISTORY_PATH,source_present:false,action:'materialize_empty_derived_container',as_of_date:ORDINARY_CARRY.source.as_of_date,baseline_sha256:sha(emptyHistory())};
}
export function ordinaryExporterBytes(original){
  assert.equal(sha(original),ORDINARY_CARRY.original_exporter_sha256,'Unreviewed original ordinary exporter');
  const line='    canonicalChart=projectFinancialPayload(overlayFinancialChart(await read(paths.get(symbol)),correction,symbol),{now:evaluatedAt,asOfDate:scan.as_of_date,market:row.market});';
  assert.equal(original.toString().split(line).length,2,'Ordinary exporter amendment is not unique');
  const bytes=Buffer.from(original.toString().replace(line,'    canonicalChart=overlayFinancialChart(await read(paths.get(symbol)),correction,symbol);\n    if (!carry) canonicalChart=projectFinancialPayload(canonicalChart,{now:evaluatedAt,asOfDate:scan.as_of_date,market:row.market});'));
  assert.equal(sha(bytes),ORDINARY_CARRY.temporary_exporter_sha256);return bytes;
}
export async function withOrdinaryExporter(frontend,run){
  const path=join(frontend,'tools',ORDINARY_ENTRY),bytes=ordinaryExporterBytes(regular(join(frontend,'tools/export-research.mjs')));
  assert(realpathSync(dirname(path))===resolve(dirname(path)),'Linked ordinary exporter parent');
  writeFileSync(path,bytes,{flag:'wx',mode:0o644});
  const before=lstatSync(path);
  const verify=()=>{const after=lstatSync(path);assert.equal(sha(regular(path)),ORDINARY_CARRY.temporary_exporter_sha256);assert.equal(after.mode&0o777,0o644);assert.equal(after.ino,before.ino);assert.equal(after.dev,before.dev);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(after.ctimeMs,before.ctimeMs);};
  try{verify();return await run(path);}
  finally{
    try{verify();}finally{
      assert(realpathSync(dirname(path))===resolve(dirname(path)),'Ordinary exporter parent changed before cleanup');
      rmSync(path);
    }
  }
}
function carryIdentity(state){
  const bytes=regular(state.carry.projectionPath),carry=JSON.parse(bytes),prior=state.live.financialRelease;
  assert.equal(sha(bytes),state.carry.projectionSha256,'Ordinary carry projection changed');
  assert.equal(carry.schema_version,'financial-generation-carry-v1');
  same(carry.bindings,{source_projection_sha256:prior.source_projection.sha256,source_base_sha256:prior.source_base.sha256,source_lineage_sha256:prior.lineage_sha256,previous_publication_identity:state.live.identity,target_base_sha256:state.carry.targetBaseSha256},'Ordinary carry provenance changed');
  assert.equal(carry.financial_evaluated_at,state.carry.evaluatedAt);assert.equal(carry.target_base_sha256??carry.bindings?.target_base_sha256,state.carry.targetBaseSha256);
  assert.equal(sha(regular(join(state.carry.sourceRoot,prior.source_projection.path))),prior.source_projection.sha256);
  assert.equal(sha(regular(join(state.carry.sourceRoot,prior.source_base.path))),prior.source_base.sha256);
  return {projection_sha256:sha(bytes),target_base_sha256:state.carry.targetBaseSha256,generation:carry.financial_generation,evaluated_at:carry.financial_evaluated_at};
}
const HISTORY_KEYS=['schema_version','predecessor_selection_sha256','predecessor_performance_sha256','selected_selection_sha256','selected_performance_sha256','output_selection_sha256','output_performance_sha256','published_observations','admitted_observations','cohorts','selections','source_artifact_digest','predecessor_digest'];
function portableHistory(state){return Object.fromEntries(HISTORY_KEYS.map(key=>[key,state.historyReconciliation[key]]));}
export async function ordinaryAwaitSnapshot(state,context,operation){
  const before=digest({state,context}),value=await operation();
  assert.equal(digest({state,context}),before,'Ordinary context mutated during verification');assertOrdinaryClock(Date.now());return value;
}
export async function verifyOrdinaryInputs(state,context,paths){
  validateOrdinaryContext(state,context);
  return ordinaryAwaitSnapshot(state,context,async()=>{
    const {verifyPublisherToolingCheckout}=await import('./retained-price-publisher-tooling.mjs');
    // Reuse only this immutable full-source byte validator, not finite authority.
    verifyPublisherToolingCheckout(paths.frontend,{amended:false});
    const {dataInventoryDigest}=await import('./publication-state.mjs');
    return {controller:structuredClone(context.controller),caller:structuredClone(context.caller),source:authenticateOrdinaryArchive(paths),predecessor_identity:state.live.identity,history_reconciliation:portableHistory(state),history_reconciliation_sha256:digest(portableHistory(state)),baseline_sha256:state.carry.baseline?dataInventoryDigest(state.carry.baseline):null,carry:state.carry.projectionPath?carryIdentity(state):null};
  });
}
export async function prepareOrdinaryCarry(state,context,paths){
  assert(!state.ordinaryCarryTooling,'Ordinary carry preparation may occur only once');
  const inputs=await verifyOrdinaryInputs(state,context,paths);assert.equal(inputs.carry,null,'Ordinary baseline must precede carry evaluation');
  const history=materializeOrdinaryHistory(join(paths.frontend,'public'));
  state.ordinaryCarryTooling={phase:'baseline',inputs,history,prepared_at:assertOrdinaryClock(Date.now())};
  return state.ordinaryCarryTooling;
}
export async function bindOrdinaryCarry(state,context,paths){
  assert.equal(state.ordinaryCarryTooling?.phase,'baseline');const inputs=await verifyOrdinaryInputs(state,context,paths),tool=state.ordinaryCarryTooling;
  same({...inputs,carry:null,baseline_sha256:null},tool.inputs,'Ordinary inputs changed during baseline preparation');
  assert.equal(sha(regular(join(state.carry.baseline,HISTORY_PATH))),tool.history.baseline_sha256,'Ordinary empty baseline changed');
  assert(Date.parse(inputs.carry.evaluated_at)>=Date.parse(tool.prepared_at)&&Date.parse(inputs.carry.evaluated_at)>=Date.parse(context.caller.started_at),'Ordinary carry evaluation predates its actual preparation');
  tool.inputs=inputs;tool.phase='prepared';tool.bound_at=assertOrdinaryClock(Date.now());
}
export async function checkOrdinaryCarry(state,context,paths){
  const inputs=await verifyOrdinaryInputs(state,context,paths),tool=state.ordinaryCarryTooling;
  assert(tool&&['prepared','building','built','composing','composed','rechecked'].includes(tool.phase),'Missing completed ordinary carry preparation');
  same(inputs,tool.inputs,'Ordinary source, caller, projection or predecessor changed');
  assert.equal(sha(regular(join(state.carry.baseline,HISTORY_PATH))),tool.history.baseline_sha256,'Ordinary history baseline changed');
  assert(Date.parse(inputs.carry.evaluated_at)<=context.now&&Date.parse(tool.bound_at)<=context.now,'Future ordinary carry evaluation');
  assertOrdinaryClock(Date.now());return inputs;
}
const composeProofs=new WeakMap();
export async function beginOrdinaryComposition(state,context,paths,readOutputDigest){
  if(composeProofs.has(state)){composeProofs.delete(state);state.ordinaryCarryTooling.phase='failed';throw Error('Interleaved ordinary composition');}
  assert.equal(state.ordinaryCarryTooling?.phase,'built');
  const proof=Object.freeze({input_digest:digest(state.ordinaryCarryTooling.inputs),build:digest(state.ordinaryCarryTooling.build)});
  assert.equal(readOutputDigest(),state.ordinaryCarryTooling.build.output_sha256,'Ordinary built output changed before composition');
  composeProofs.set(state,proof);state.ordinaryCarryTooling.phase='composing';
  try{
    await checkOrdinaryCarry(state,context,paths);assert.equal(composeProofs.get(state),proof,'Ordinary composition offer invalidated');
    assert.equal(readOutputDigest(),state.ordinaryCarryTooling.build.output_sha256,'Ordinary built output changed during composition admission');return proof;
  }catch(error){composeProofs.delete(state);state.ordinaryCarryTooling.phase='failed';throw error;}
}
export async function completeOrdinaryComposition(proof,state,context,paths,publication,readActualUiDigest){
  assert.equal(composeProofs.get(state),proof,'Missing actual ordinary composition invocation');assert(proof,'Missing ordinary composition proof');
  composeProofs.delete(state);assert.equal(state.ordinaryCarryTooling.phase,'composing');
  await checkOrdinaryCarry(state,context,paths);
  assert.equal(digest(state.ordinaryCarryTooling.inputs),proof.input_digest);assert.equal(digest(state.ordinaryCarryTooling.build),proof.build);
  assert.equal(readActualUiDigest(),ORDINARY_CARRY.ui_digest,'Ordinary composed UI bytes changed');
  assert(state.financialPrepared?.receipt?.mode==='carry'&&state.financialPrepared.receipt.evaluation_projection.sha256===state.carry.projectionSha256,'Ordinary receipt lacks verified carried bundle');
  same(publication.financial_release,state.financialPrepared.reference,'Ordinary final financial reference changed');
  const tool=state.ordinaryCarryTooling;
  const receipt={schema_version:'ordinary-carry-tooling-receipt-v1',identity:ORDINARY_CARRY,inputs:tool.inputs,history:tool.history,prepared_at:tool.prepared_at,bound_at:tool.bound_at,build:tool.build,composed_at:assertOrdinaryClock(Date.now()),financial_release:publication.financial_release,financial_generation:publication.financial_generation,financial_lineage_sha256:publication.financial_lineage_sha256,ui_sha:publication.ui_sha,ui_digest:publication.ui_digest};
  validateOrdinaryCarryReceipt(receipt,publication);tool.phase='composed';tool.receipt=receipt;return receipt;
}
export function validateOrdinaryCarryReceipt(v,publication){
  closed(v,['schema_version','identity','inputs','history','prepared_at','bound_at','build','composed_at','financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'],'Unknown ordinary tooling receipt field');
  assert.equal(v.schema_version,'ordinary-carry-tooling-receipt-v1');same(v.identity,ORDINARY_CARRY,'Unreviewed ordinary identity');
  closed(v.inputs,['controller','caller','source','predecessor_identity','history_reconciliation','history_reconciliation_sha256','baseline_sha256','carry'],'Unknown ordinary inputs');
  closed(v.inputs.controller,['head','tree'],'Unknown ordinary receipt controller');closed(v.inputs.caller,['run_id','run_attempt','job_id','started_at'],'Unknown ordinary receipt caller');
  closed(v.inputs.source,['artifact_sha256','tar_sha256','raw_static_inventory_sha256','source_history_present','manifest_sha256'],'Unknown ordinary source proof');
  closed(v.inputs.carry,['projection_sha256','target_base_sha256','generation','evaluated_at'],'Unknown ordinary carry proof');
  assert(gitHash(v.inputs.controller.head)&&gitHash(v.inputs.controller.tree)&&positive(v.inputs.caller.run_id)&&v.inputs.caller.run_attempt===1&&positive(v.inputs.caller.job_id),'Invalid ordinary controller/caller');
  assert(v.inputs.source.artifact_sha256===ORDINARY_CARRY.source.artifact_sha256&&v.inputs.source.manifest_sha256===ORDINARY_CARRY.source.manifest_sha256&&v.inputs.source.source_history_present===false&&hash(v.inputs.source.tar_sha256)&&hash(v.inputs.source.raw_static_inventory_sha256),'Invalid ordinary raw source proof');
  closed(v.inputs.history_reconciliation,HISTORY_KEYS,'Unknown ordinary history reconciliation');
  const history=v.inputs.history_reconciliation;
  assert(history.schema_version==='candidate-history-reconciliation-v1'&&history.admitted_observations===650&&history.published_observations===0&&history.cohorts===4&&history.selections===5&&history.source_artifact_digest==='sha256:'+ORDINARY_CARRY.source.artifact_sha256&&HISTORY_KEYS.filter(k=>k.endsWith('_sha256')).every(k=>hash(history[k]))&&digest(history)===v.inputs.history_reconciliation_sha256,'Invalid ordinary preserved-history proof');
  assert(v.inputs.predecessor_identity===ORDINARY_CARRY.predecessor.identity&&hash(v.inputs.history_reconciliation_sha256)&&hash(v.inputs.baseline_sha256)&&['projection_sha256','target_base_sha256','generation'].every(k=>hash(v.inputs.carry[k])),'Invalid ordinary projection proof');
  same(v.history,{schema_version:'ordinary-empty-history-derivation-v1',path:HISTORY_PATH,source_present:false,action:'materialize_empty_derived_container',as_of_date:ORDINARY_CARRY.source.as_of_date,baseline_sha256:sha(emptyHistory())},'Invalid ordinary history derivation');
  closed(v.build,['started_at','finished_at','output_sha256'],'Unknown ordinary build proof');assert(hash(v.build.output_sha256));
  const dates=[v.inputs.caller.started_at,v.prepared_at,v.inputs.carry.evaluated_at,v.bound_at,v.build.started_at,v.build.finished_at,v.composed_at];
  assert(dates.every(iso)&&dates.slice(1).every((d,i)=>Date.parse(d)>=Date.parse(dates[i])),'Ordinary lifecycle chronology changed');
  assert(dates.slice(1).every(d=>Date.parse(d)>=Date.parse(ORDINARY_CARRY.not_before)&&Date.parse(d)<=Date.parse(ORDINARY_CARRY.not_after)),'Ordinary historical execution outside reviewed window');
  assert(!publication.publisher_tooling&&publication.controller_sha===v.inputs.controller.head&&publication.run_id===v.inputs.caller.run_id&&publication.run_attempt===1&&publication.data_source?.artifact_id===ORDINARY_CARRY.source.artifact_id&&publication.data_source.run_id===ORDINARY_CARRY.source.run_id&&publication.data_source.attempt===1,'Ordinary publication caller/source mismatch');
  for(const key of ['financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'])same(v[key],publication[key],'Ordinary receipt '+key+' changed');
  assert(v.ui_sha===ORDINARY_CARRY.ui_sha&&v.ui_digest===ORDINARY_CARRY.ui_digest&&v.financial_lineage_sha256===ORDINARY_CARRY.predecessor.lineage_sha256&&v.financial_generation===v.inputs.carry.generation,'Ordinary final identity changed');return v;
}

export function assertOrdinaryReceiptBinding(state,publication,financialReceipt){
  const v=validateOrdinaryCarryReceipt(publication.ordinary_carry_tooling,publication),tool=state.ordinaryCarryTooling;
  assert(tool&&['composed','rechecked'].includes(tool.phase),'Ordinary receipt before completed composition');
  for(const key of ['inputs','history','prepared_at','bound_at','build'])same(v[key],tool[key],'Ordinary final '+key+' is not the authenticated state');
  same(v,tool.receipt,'Ordinary composed receipt changed');
  assert(financialReceipt?.mode==='carry'&&financialReceipt.evaluation_projection.sha256===v.inputs.carry.projection_sha256&&financialReceipt.evaluated_at===v.inputs.carry.evaluated_at&&financialReceipt.financial_generation===v.inputs.carry.generation&&financialReceipt.lineage_sha256===ORDINARY_CARRY.predecessor.lineage_sha256&&financialReceipt.previous_publication_identity===ORDINARY_CARRY.predecessor.identity,'Ordinary receipt differs from verified financial release');
  return true;
}
