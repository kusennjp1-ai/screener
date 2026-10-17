// One dated ordinary, price-only carry repair. This is not finite-source,
// financial-renewal, preview, or new-UI authority. All financial gates remain.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {appendFileSync,closeSync,constants,existsSync,fstatSync,lstatSync,openSync,readFileSync,readSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {verifyCorrectionChecks,contract as correctionContract} from './financial-correction.mjs';
import {dirname,join,resolve} from 'node:path';
const freeze=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);};
export const OCT10_ORDINARY_CARRY=freeze({
  schema_version:'ordinary-carry-tooling-identity-v1',amendment_id:'oct9-carry-single-projection-v1',repository:'kusennjp1-ai/screener',
  role:'ordinary_data_only',not_before:'2026-10-10T00:00:00Z',not_after:'2026-10-10T14:59:00Z',
  ui_sha:'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',ui_tree:'1c0219a170dcbdeb1af539e4cf7a04018251ca02',
  ui_digest:'72fd791b42a691e286279cada721207a812d13b13233e814d0c2cfde73571788',
  original_exporter_sha256:'90e9f7316b34f171a726bc9245805e67e8d316b7367e288924ce568583fc3946',
  temporary_exporter_sha256:'f9e0ad58f7bbaf911eab2943fcfb18df32f6ee881c3847272f5201e448d9cf40',
  source:{artifact_id:11659250929,artifact_bytes:300364092,artifact_sha256:'de47f97f7c713ce70627ca9507f5cbece64ac6e441f581aee3fadb1be9c46a45',run_id:38017220147,run_attempt:1,head_sha:'2e289c42c00e0d0bad05263ab8273a257dc0ae8e',created_at:'2026-10-10T04:22:09Z',manifest_sha256:'da830e8202fe9a7cd4cc9c9d383c9069ccb5e13fb3db564ac46ee52a8d4a60a9',price_observations_sha256:'e8107f9b61d4de7f25a81367b0e94b3367d0b9124f9838b647ea1a4f8462deb7',as_of_date:'2026-10-09'},
  predecessor:{identity:'37456692717/1/0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a/ab65c8bb05f33cadd1eec71c858ed67a6ba7578ed9772c7d9ccbf24873161dd0',receipt_sha256:'0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a',transport_root_sha256:'12e0304288a72e92f1efbe7bd59aa0b3b16272b1f0c201412d3b4870a4481d11',lineage_sha256:'2828fbf2d497ae32c29ddb46a34903a9c1c8494862e127ba67dff9880e356a13',generation:'69c80cd8bfa2a4bedf891aea1e82229b4d6768e59914f15fb9ef9e09b51c7de7',source_projection_sha256:'a93042a6f6ad40c9bbf0f518bf5580d1a1a014e2fc70380569edcde76c965b9a',source_base_sha256:'94d3f1f08869fe625c678e64c1699bf024050c7a5208847168a67c3c0e2b8b27'}
});
// Published historical receipts keep their exact dated identity. A later
// reviewed execution identity must not rewrite the expired Oct 10 contract.
export const OCT11_ORDINARY_CARRY_V2=freeze({
  ...OCT10_ORDINARY_CARRY,
  amendment_id:'oct11-oct9-carry-single-projection-v2',
  not_before:'2026-10-11T00:00:00Z',admit_before:'2026-10-11T09:00:00Z',not_after:'2026-10-11T10:30:00Z',
  source:{artifact_id:11688992276,artifact_bytes:304495007,artifact_sha256:'de6df9c0ce6d571278edb0cf8e0ab505d6eed7f1ed680a6130d7ea994c27f640',run_id:38095197679,run_attempt:1,head_sha:'3165566f0dd1216c2b869dbf0db887ea7494b8d4',created_at:'2026-10-11T02:03:12Z',manifest_sha256:'463fb0d332be33eb4f31aec99cef794258e5c9c69facb78f29a0c5f981982859',price_observations_sha256:'9e752e56a0eab1b9151302e49d02fc98e4f4eb8598e3fa8a1166e4e6489ff26a',as_of_date:'2026-10-09'}
});

// Superseded identities remain immutable, recognized, and readable in receipts.
// The legacy manual alias remains v3; the separate CI identity below has its own admission.
export const OCT11_ORDINARY_CARRY_V3=freeze({
  ...OCT11_ORDINARY_CARRY_V2,
  amendment_id:'oct11-oct9-carry-single-projection-v3',
  source:{artifact_id:11691660552,artifact_bytes:304482110,artifact_sha256:'28a3086136e50450827c14c1b5d58caea668e9c0c24304288520d3b5606959a6',run_id:38103802893,run_attempt:1,head_sha:'3165566f0dd1216c2b869dbf0db887ea7494b8d4',created_at:'2026-10-11T04:10:38Z',manifest_sha256:'c50ac416be6d9bb1aa5388689f4f3bf59b5fbb4a66df92db35b4b2cc38c537ea',price_observations_sha256:'9e752e56a0eab1b9151302e49d02fc98e4f4eb8598e3fa8a1166e4e6489ff26a',as_of_date:'2026-10-09'}
});
// A fresh, bounded ordinary eligibility identity. Disabled request by default.
// Times are part of the reviewed code identity, never mutable activation input.
export const ORDINARY_CI_REQUEST_PATH='.github/ordinary-carry-oct17-request.json';
export const ORDINARY_CI_ADMISSION_STEP='Verify exact ordinary carry CI admission';
export const ORDINARY_CI_IDENTITY=freeze({
  ...OCT11_ORDINARY_CARRY_V3,
  amendment_id:'oct17-oct16-carry-single-projection-v4-ci-v1',invocation:'workflow_run_ci_v1',
  not_before:'2026-10-17T10:00:00Z',admit_before:'2026-10-17T16:00:00Z',not_after:'2026-10-17T22:00:00Z',
  request_path:ORDINARY_CI_REQUEST_PATH,
  controller_base:{sha:'8cf7d9b231a5926696d261da51a4bab531f33cfa',tree:'82d9278408ebdb927a5124453d5c004ebf0306b8'},
  source:{artifact_id:12088584402,artifact_bytes:301825450,artifact_sha256:'ee761e1e5a3f5118d1062e0c9d9bfb65b936d28aeff670788e1479449e6bdf77',run_id:38990637900,run_attempt:1,head_sha:'8cf7d9b231a5926696d261da51a4bab531f33cfa',created_at:'2026-10-17T04:00:18Z',manifest_sha256:'1990d4141b02a1f465561e9ac87ed9565639949f2bde6ce31b1ca56c4fd7f049',price_observations_sha256:'a109f8a21a9ad83df3a50f4ae1d4ffd1aa427b54d36011b1f847ead75f04528b',as_of_date:'2026-10-16'}
});
export const ORDINARY_CARRY=OCT11_ORDINARY_CARRY_V3;
const KNOWN_ORDINARY_CARRIES=Object.freeze([OCT10_ORDINARY_CARRY,OCT11_ORDINARY_CARRY_V2,OCT11_ORDINARY_CARRY_V3,ORDINARY_CI_IDENTITY]);

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
// Recognition is deliberately independent of execution eligibility: an expired
// known source must fail closed, never fall through to generic publication.
export function ordinaryCarrySelected(state){return KNOWN_ORDINARY_CARRIES.some(identity=>state.source?.artifact?.id===identity.source.artifact_id)||Boolean(state.ordinaryCarryAdmission)||Boolean(state.ordinaryCarryTooling);}
export function selectOrdinaryCarryAdmission(state,now,ciProof=null){
  if(state.source?.artifact?.id===ORDINARY_CI_IDENTITY.source.artifact_id){
    assert(ciProof&&verifiedCiProofs.has(ciProof),'Fresh authenticated ordinary CI admission required');
    assert(!state.ordinaryCarryAdmission&&!state.ordinaryCarryTooling,'Ordinary admission cannot replace an existing immutable plan');
    assertOrdinaryClock(now,ORDINARY_CI_IDENTITY);validateOrdinarySelection(state,ORDINARY_CI_IDENTITY,false);assert(ciTime(ciProof.admitted_at)<=now,'Future ordinary selection proof');
    return {identity:structuredClone(ORDINARY_CI_IDENTITY),admitted_at:ciProof.admitted_at,ci_admission:structuredClone(ciProof)};
  }
  assert(!ciProof,'Ordinary CI proof cannot admit a different source');
  if(!ordinaryCarrySelected(state))return null;
  assert(!state.ordinaryCarryAdmission&&!state.ordinaryCarryTooling,'Ordinary admission cannot replace an existing immutable plan');
  const candidates=[ORDINARY_CARRY].filter(identity=>identity.source.artifact_id===state.source?.artifact?.id&&Number.isFinite(now)&&now>=Date.parse(identity.not_before)&&now>=Date.parse(identity.source.created_at)&&now<=Date.parse(identity.admit_before??identity.not_after));
  assert.equal(candidates.length,1,'Known ordinary source has no unique active execution identity');
  return {identity:structuredClone(candidates[0]),admitted_at:new Date(now).toISOString()};
}
function executionIdentity(state){return state?.ordinaryCarryAdmission?.identity?.amendment_id===ORDINARY_CI_IDENTITY.amendment_id?ORDINARY_CI_IDENTITY:ORDINARY_CARRY;}
export function assertOrdinaryClock(now,stateOrIdentity=ORDINARY_CARRY){const identity=stateOrIdentity?.schema_version==='ordinary-carry-tooling-identity-v1'?stateOrIdentity:executionIdentity(stateOrIdentity);assert(KNOWN_ORDINARY_CARRIES.includes(identity),'Unreviewed ordinary execution identity');assert(Number.isFinite(now)&&now>=Date.parse(identity.not_before)&&now<=Date.parse(identity.not_after),'Ordinary carry execution window is closed');return new Date(now).toISOString();}
function validateOrdinarySelection(state,ORDINARY_CARRY,requireHistory){
  assert(state.decision?.publish&&state.decision.mode==='data'&&state.carry&&!state.source?.receiptHash&&!state.source?.publication&&!state.source?.repair&&!state.publisherTooling&&!state.sourceRecovery&&!state.correction&&!state.activation&&!state.renewal&&!state.decision.migration&&!state.designCarryPreview,'Ordinary carry is an exclusive data-only route');
  const p=ORDINARY_CARRY.source,s=state.source,a=s.artifact,live=state.live,prior=live.financialRelease;
  same({artifact_id:a.id,artifact_bytes:a.size_in_bytes,artifact_sha256:a.digest?.slice(7),run_id:s.runId,run_attempt:s.attempt,head_sha:a.workflow_run?.head_sha,created_at:a.created_at,manifest_sha256:s.manifestHash,price_observations_sha256:s.priceObservationsDigest,as_of_date:s.manifest.markets?.US?.as_of_date},p,'Ordinary carry selected source changed');
  assert(a.digest===`sha256:${p.artifact_sha256}`&&a.name===`static-site-data-${p.run_id}-${p.run_attempt}`&&a.workflow_run?.id===p.run_id,'Ordinary source identity mismatch');
  assert(state.sourceSha===ORDINARY_CARRY.ui_sha&&live.uiSha===ORDINARY_CARRY.ui_sha&&live.uiDigest===ORDINARY_CARRY.ui_digest&&live.identity===ORDINARY_CARRY.predecessor.identity&&live.receiptHash===ORDINARY_CARRY.predecessor.receipt_sha256,'Ordinary carry approved UI/predecessor changed');
  assert(prior?.mode==='carry'||prior?.mode==='activation','Ordinary carry requires active authenticated financial release');
  for(const [key,value]of Object.entries({lineage_sha256:prior.lineage_sha256,generation:prior.financial_generation,source_projection_sha256:prior.source_projection.sha256,source_base_sha256:prior.source_base.sha256,transport_root_sha256:live.receipt?.transport?.root?.sha256}))assert(value===ORDINARY_CARRY.predecessor[key],'Ordinary predecessor '+key+' changed');
  if(requireHistory)assert(state.historyReconciliation?.admitted_observations===650&&state.historyReconciliation?.source_artifact_digest===a.digest,'Ordinary carry lost selected 650-observation history');
}
export function validateOrdinaryContext(state,context){
  const ORDINARY_CARRY=executionIdentity(state),ci=ORDINARY_CARRY===ORDINARY_CI_IDENTITY;
  closed(state.ordinaryCarryAdmission,['identity','admitted_at',...(ci?['ci_admission']:[])],'Missing exact ordinary execution admission');
  same(state.ordinaryCarryAdmission.identity,ORDINARY_CARRY,'Ordinary execution identity differs from its immutable plan');
  const admitted=Date.parse(state.ordinaryCarryAdmission.admitted_at);
  assert(iso(state.ordinaryCarryAdmission.admitted_at)&&admitted>=Date.parse(ORDINARY_CARRY.not_before)&&admitted<=Date.parse(ORDINARY_CARRY.admit_before??ORDINARY_CARRY.not_after)&&admitted<=context.now,'Ordinary admission is outside its reviewed start window');
  validateOrdinarySelection(state,ORDINARY_CARRY,true);
  closed(context,['controller','caller','event','ui_only','now',...(ci?['ci_admission']:[])],'Ordinary context fields');
  closed(context.controller,['head','tree'],'Ordinary controller fields');closed(context.caller,['run_id','run_attempt','job_id','started_at'],'Ordinary caller fields');
  if(ci){assert(context.event==='workflow_run'&&context.ui_only===false&&verifiedCiProofs.has(context.ci_admission),'Ordinary carry requires genuine verified CI completion');same(context.ci_admission,state.ordinaryCarryAdmission.ci_admission,'Ordinary CI proof changed');assert(context.ci_admission.activation.executing.sha===state.controllerSha&&context.ci_admission.activation.executing.tree===context.controller.tree,'Ordinary CI controller changed');same(context.caller,{run_id:context.ci_admission.caller.run_id,run_attempt:1,job_id:context.ci_admission.caller.job_id,started_at:context.ci_admission.caller.job_started_at},'Ordinary CI caller changed');}
  else assert(context.event==='workflow_dispatch'&&context.ui_only===true,'Ordinary carry requires explicit current-controller UI-only dispatch');
  assert(context.controller.head===state.controllerSha&&gitHash(context.controller.head)&&gitHash(context.controller.tree),'Ordinary controller identity changed');
  assert(positive(context.caller.run_id)&&context.caller.run_attempt===1&&positive(context.caller.job_id)&&iso(context.caller.started_at)&&Date.parse(context.caller.started_at)<=context.now,'Invalid ordinary carry caller/clock');
  assert(Date.parse(context.caller.started_at)<=admitted,'Ordinary admission predates its caller');
  if(ORDINARY_CARRY.admit_before){
    assert(Date.parse(context.caller.started_at)>=Date.parse(ORDINARY_CARRY.not_before),'Ordinary caller predates this dated execution identity');
    assert(admitted>=Date.parse(ORDINARY_CARRY.source.created_at),'Ordinary admission predates its selected artifact');
  }
  assertOrdinaryClock(context.now,ORDINARY_CARRY);
  return true;
}
// Stream the pinned ZIP and TAR; inspect every member before deriving absence.
// No guessed file or unpinned live response is an admissible raw source.
export function authenticateOrdinaryArchive({zip,tar},ORDINARY_CARRY=globalOrdinaryIdentity()){
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
const globalOrdinaryIdentity=()=>ORDINARY_CARRY;
const emptyHistory=(identity=ORDINARY_CARRY)=>JSON.stringify({as_of_date:identity.source.as_of_date,results:{}});
export function materializeOrdinaryHistory(root,ORDINARY_CARRY=globalOrdinaryIdentity()){
  const path=join(root,HISTORY_PATH);assert(!existsSync(path),'Authenticated absent history appeared before derivation');
  assert(realpathSync(dirname(path))===resolve(dirname(path)),'Linked ordinary history parent');
  writeFileSync(path,emptyHistory(ORDINARY_CARRY),{flag:'wx',mode:0o644});assert.equal(sha(regular(path)),sha(emptyHistory(ORDINARY_CARRY)));
  return {schema_version:'ordinary-empty-history-derivation-v1',path:HISTORY_PATH,source_present:false,action:'materialize_empty_derived_container',as_of_date:ORDINARY_CARRY.source.as_of_date,baseline_sha256:sha(emptyHistory(ORDINARY_CARRY))};
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
  assert.equal(digest({state,context}),before,'Ordinary context mutated during verification');assertOrdinaryClock(Date.now(),state);return value;
}
export async function verifyOrdinaryInputs(state,context,paths){
  const ORDINARY_CARRY=executionIdentity(state);
  validateOrdinaryContext(state,context);
  return ordinaryAwaitSnapshot(state,context,async()=>{
    const {verifyPublisherToolingCheckout}=await import('./retained-price-publisher-tooling.mjs');
    // Reuse only this immutable full-source byte validator, not finite authority.
    verifyPublisherToolingCheckout(paths.frontend,{amended:false});
    const {dataInventoryDigest}=await import('./publication-state.mjs');
    return {...(ORDINARY_CARRY===ORDINARY_CI_IDENTITY?{ci_admission:structuredClone(context.ci_admission)}:{}),...(ORDINARY_CARRY.admit_before?{admitted_at:state.ordinaryCarryAdmission.admitted_at}:{}),controller:structuredClone(context.controller),caller:structuredClone(context.caller),source:authenticateOrdinaryArchive(paths,ORDINARY_CARRY),predecessor_identity:state.live.identity,history_reconciliation:portableHistory(state),history_reconciliation_sha256:digest(portableHistory(state)),baseline_sha256:state.carry.baseline?dataInventoryDigest(state.carry.baseline):null,carry:state.carry.projectionPath?carryIdentity(state):null};
  });
}
export async function prepareOrdinaryCarry(state,context,paths){
  const ORDINARY_CARRY=executionIdentity(state);
  assert(!state.ordinaryCarryTooling,'Ordinary carry preparation may occur only once');
  if(ORDINARY_CARRY.admit_before)assert(Date.now()<=Date.parse(ORDINARY_CARRY.admit_before),'Ordinary preparation start window is closed');
  const inputs=await verifyOrdinaryInputs(state,context,paths);assert.equal(inputs.carry,null,'Ordinary baseline must precede carry evaluation');
  if(ORDINARY_CARRY.admit_before)assert(Date.now()<=Date.parse(ORDINARY_CARRY.admit_before),'Ordinary preparation start window closed during verification');
  const history=materializeOrdinaryHistory(join(paths.frontend,'public'),ORDINARY_CARRY);
  state.ordinaryCarryTooling={phase:'baseline',inputs,history,prepared_at:assertOrdinaryClock(Date.now(),state)};
  return state.ordinaryCarryTooling;
}
export async function bindOrdinaryCarry(state,context,paths){
  assert.equal(state.ordinaryCarryTooling?.phase,'baseline');const inputs=await verifyOrdinaryInputs(state,context,paths),tool=state.ordinaryCarryTooling;
  same({...inputs,carry:null,baseline_sha256:null},tool.inputs,'Ordinary inputs changed during baseline preparation');
  assert.equal(sha(regular(join(state.carry.baseline,HISTORY_PATH))),tool.history.baseline_sha256,'Ordinary empty baseline changed');
  assert(Date.parse(inputs.carry.evaluated_at)>=Date.parse(tool.prepared_at)&&Date.parse(inputs.carry.evaluated_at)>=Date.parse(context.caller.started_at),'Ordinary carry evaluation predates its actual preparation');
  tool.inputs=inputs;tool.phase='prepared';tool.bound_at=assertOrdinaryClock(Date.now(),state);
}
export async function checkOrdinaryCarry(state,context,paths){
  const inputs=await verifyOrdinaryInputs(state,context,paths),tool=state.ordinaryCarryTooling;
  assert(tool&&['prepared','building','built','composing','composed','rechecked'].includes(tool.phase),'Missing completed ordinary carry preparation');
  same(inputs,tool.inputs,'Ordinary source, caller, projection or predecessor changed');
  assert.equal(sha(regular(join(state.carry.baseline,HISTORY_PATH))),tool.history.baseline_sha256,'Ordinary history baseline changed');
  assert(Date.parse(inputs.carry.evaluated_at)<=context.now&&Date.parse(tool.bound_at)<=context.now,'Future ordinary carry evaluation');
  assertOrdinaryClock(Date.now(),state);return inputs;
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
  const ORDINARY_CARRY=executionIdentity(state);
  assert.equal(composeProofs.get(state),proof,'Missing actual ordinary composition invocation');assert(proof,'Missing ordinary composition proof');
  composeProofs.delete(state);assert.equal(state.ordinaryCarryTooling.phase,'composing');
  await checkOrdinaryCarry(state,context,paths);
  assert.equal(digest(state.ordinaryCarryTooling.inputs),proof.input_digest);assert.equal(digest(state.ordinaryCarryTooling.build),proof.build);
  assert.equal(readActualUiDigest(),ORDINARY_CARRY.ui_digest,'Ordinary composed UI bytes changed');
  assert(state.financialPrepared?.receipt?.mode==='carry'&&state.financialPrepared.receipt.evaluation_projection.sha256===state.carry.projectionSha256,'Ordinary receipt lacks verified carried bundle');
  same(publication.financial_release,state.financialPrepared.reference,'Ordinary final financial reference changed');
  const tool=state.ordinaryCarryTooling;
  const receipt={schema_version:ORDINARY_CARRY===ORDINARY_CI_IDENTITY?'ordinary-carry-tooling-receipt-v3':ORDINARY_CARRY.admit_before?'ordinary-carry-tooling-receipt-v2':'ordinary-carry-tooling-receipt-v1',identity:ORDINARY_CARRY,inputs:tool.inputs,history:tool.history,prepared_at:tool.prepared_at,bound_at:tool.bound_at,build:tool.build,composed_at:assertOrdinaryClock(Date.now(),state),financial_release:publication.financial_release,financial_generation:publication.financial_generation,financial_lineage_sha256:publication.financial_lineage_sha256,ui_sha:publication.ui_sha,ui_digest:publication.ui_digest};
  validateOrdinaryCarryReceipt(receipt,publication);tool.phase='composed';tool.receipt=receipt;return receipt;
}
export function validateOrdinaryCarryReceipt(v,publication,options={}){
  closed(v,['schema_version','identity','inputs','history','prepared_at','bound_at','build','composed_at','financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'],'Unknown ordinary tooling receipt field');
  const identity=KNOWN_ORDINARY_CARRIES.find(candidate=>candidate.amendment_id===v.identity?.amendment_id);
  assert(identity,'Unreviewed ordinary identity');same(v.identity,identity,'Unreviewed ordinary identity');
  const ci=identity===ORDINARY_CI_IDENTITY;
  assert.equal(v.schema_version,ci?'ordinary-carry-tooling-receipt-v3':identity.admit_before?'ordinary-carry-tooling-receipt-v2':'ordinary-carry-tooling-receipt-v1');
  closed(v.inputs,['controller','caller','source','predecessor_identity','history_reconciliation','history_reconciliation_sha256','baseline_sha256','carry',...(identity.admit_before?['admitted_at']:[]),...(ci?['ci_admission']:[])],'Unknown ordinary inputs');
  if(ci){validateOrdinaryCiProof(v.inputs.ci_admission);assert(v.inputs.ci_admission.admitted_at===v.inputs.admitted_at,'Ordinary receipt CI admission clock changed');same(v.inputs.controller,{head:v.inputs.ci_admission.activation.executing.sha,tree:v.inputs.ci_admission.activation.executing.tree},'Ordinary receipt CI controller changed');same(v.inputs.caller,{run_id:v.inputs.ci_admission.caller.run_id,run_attempt:1,job_id:v.inputs.ci_admission.caller.job_id,started_at:v.inputs.ci_admission.caller.job_started_at},'Ordinary receipt CI caller changed');verifyOrdinaryCiHistorical(v.inputs.ci_admission,{...options,composedAt:v.composed_at});}
  closed(v.inputs.controller,['head','tree'],'Unknown ordinary receipt controller');closed(v.inputs.caller,['run_id','run_attempt','job_id','started_at'],'Unknown ordinary receipt caller');
  closed(v.inputs.source,['artifact_sha256','tar_sha256','raw_static_inventory_sha256','source_history_present','manifest_sha256'],'Unknown ordinary source proof');
  closed(v.inputs.carry,['projection_sha256','target_base_sha256','generation','evaluated_at'],'Unknown ordinary carry proof');
  assert(gitHash(v.inputs.controller.head)&&gitHash(v.inputs.controller.tree)&&positive(v.inputs.caller.run_id)&&v.inputs.caller.run_attempt===1&&positive(v.inputs.caller.job_id),'Invalid ordinary controller/caller');
  assert(v.inputs.source.artifact_sha256===identity.source.artifact_sha256&&v.inputs.source.manifest_sha256===identity.source.manifest_sha256&&v.inputs.source.source_history_present===false&&hash(v.inputs.source.tar_sha256)&&hash(v.inputs.source.raw_static_inventory_sha256),'Invalid ordinary raw source proof');
  closed(v.inputs.history_reconciliation,HISTORY_KEYS,'Unknown ordinary history reconciliation');
  const history=v.inputs.history_reconciliation;
  assert(history.schema_version==='candidate-history-reconciliation-v1'&&history.admitted_observations===650&&history.published_observations===0&&history.cohorts===4&&history.selections===5&&history.source_artifact_digest==='sha256:'+identity.source.artifact_sha256&&HISTORY_KEYS.filter(k=>k.endsWith('_sha256')).every(k=>hash(history[k]))&&digest(history)===v.inputs.history_reconciliation_sha256,'Invalid ordinary preserved-history proof');
  assert(v.inputs.predecessor_identity===identity.predecessor.identity&&hash(v.inputs.history_reconciliation_sha256)&&hash(v.inputs.baseline_sha256)&&['projection_sha256','target_base_sha256','generation'].every(k=>hash(v.inputs.carry[k])),'Invalid ordinary projection proof');
  same(v.history,{schema_version:'ordinary-empty-history-derivation-v1',path:HISTORY_PATH,source_present:false,action:'materialize_empty_derived_container',as_of_date:identity.source.as_of_date,baseline_sha256:sha(emptyHistory(identity))},'Invalid ordinary history derivation');
  closed(v.build,['started_at','finished_at','output_sha256'],'Unknown ordinary build proof');assert(hash(v.build.output_sha256));
  const dates=[v.inputs.caller.started_at,...(identity.admit_before?[v.inputs.admitted_at]:[]),v.prepared_at,v.inputs.carry.evaluated_at,v.bound_at,v.build.started_at,v.build.finished_at,v.composed_at];
  assert(dates.every(iso)&&dates.slice(1).every((d,i)=>Date.parse(d)>=Date.parse(dates[i])),'Ordinary lifecycle chronology changed');
  if(identity.admit_before)assert(Date.parse(v.inputs.admitted_at)>=Date.parse(identity.source.created_at)&&Date.parse(v.inputs.admitted_at)<=Date.parse(identity.admit_before)&&Date.parse(v.prepared_at)<=Date.parse(identity.admit_before),'Ordinary historical start outside reviewed admission window');
  assert(dates.slice(identity.admit_before?0:1).every(d=>Date.parse(d)>=Date.parse(identity.not_before)&&Date.parse(d)<=Date.parse(identity.not_after)),'Ordinary historical execution outside reviewed window');
  assert(!publication.publisher_tooling&&publication.controller_sha===v.inputs.controller.head&&publication.run_id===v.inputs.caller.run_id&&publication.run_attempt===1&&publication.data_source?.artifact_id===identity.source.artifact_id&&publication.data_source.run_id===identity.source.run_id&&publication.data_source.attempt===1,'Ordinary publication caller/source mismatch');
  for(const key of ['financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'])same(v[key],publication[key],'Ordinary receipt '+key+' changed');
  assert(v.ui_sha===identity.ui_sha&&v.ui_digest===identity.ui_digest&&v.financial_lineage_sha256===identity.predecessor.lineage_sha256&&v.financial_generation===v.inputs.carry.generation,'Ordinary final identity changed');return v;
}

export function assertOrdinaryReceiptBinding(state,publication,financialReceipt){
  const ORDINARY_CARRY=executionIdentity(state);
  const v=validateOrdinaryCarryReceipt(publication.ordinary_carry_tooling,publication),tool=state.ordinaryCarryTooling;
  assert(tool&&['composed','rechecked'].includes(tool.phase),'Ordinary receipt before completed composition');
  same(v.identity,ORDINARY_CARRY,'Non-active historical identity cannot authorize active execution');
  for(const key of ['inputs','history','prepared_at','bound_at','build'])same(v[key],tool[key],'Ordinary final '+key+' is not the authenticated state');
  same(v,tool.receipt,'Ordinary composed receipt changed');
  assert(financialReceipt?.mode==='carry'&&financialReceipt.evaluation_projection.sha256===v.inputs.carry.projection_sha256&&financialReceipt.evaluated_at===v.inputs.carry.evaluated_at&&financialReceipt.financial_generation===v.inputs.carry.generation&&financialReceipt.lineage_sha256===ORDINARY_CARRY.predecessor.lineage_sha256&&financialReceipt.previous_publication_identity===ORDINARY_CARRY.predecessor.identity,'Ordinary receipt differs from verified financial release');
  return true;
}

// Closed CI-completion invocation. No provider, publisher, financial source or
// UI acceptance authority is created by a routing result alone.
const CI_REPO='kusennjp1-ai/screener',CI_PREFIX=`repos/${CI_REPO}`,CI_REPO_ID=1203919607;
const CI_WORKFLOW={id:294252465,path:'.github/workflows/ci.yml'};
const CI_PUBLISHER={id:364666954,path:'.github/workflows/research-ui-release.yml'};
const CI_ROUTE_JOB='Route exact renewal CI admission';
const CI_PROOF_FILE='ordinary-carry-ci-admission.json';
const verifiedCiProofs=new WeakSet(),activeCiProofs=new Map();
const ciBlob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const ciTime=value=>{assert(iso(value),'Invalid ordinary CI UTC clock');return Date.parse(value);};
const ciPath=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=4096&&!/[\x00-\x1f\x7f\\]/.test(value)&&!value.startsWith('/')&&value.split('/').every(p=>p&&p!=='.'&&p!=='..');
const ciSameRepo=run=>['repository','head_repository'].every(key=>run?.[key]?.id===CI_REPO_ID&&run[key].full_name===CI_REPO);
const ciGit=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024**2,timeout:60000}).trim();
export const ordinaryCiIdentityDigest=()=>digest(ORDINARY_CI_IDENTITY);
export function validateOrdinaryCiRequest(value){
  closed(value,['schema_version','plan_id','identity_sha256','enabled','activation'],'Invalid closed ordinary CI request');
  assert(value.schema_version==='ordinary-carry-ci-request-v1'&&value.plan_id===ORDINARY_CI_IDENTITY.amendment_id&&value.identity_sha256===ordinaryCiIdentityDigest()&&typeof value.enabled==='boolean','Unreviewed ordinary CI request');
  if(!value.enabled)assert.equal(value.activation,null,'Disabled ordinary request has activation');
  else{closed(value.activation,['reviewed_parent_sha','reviewed_parent_tree','disabled_request_sha256'],'Invalid ordinary activation');assert(gitHash(value.activation.reviewed_parent_sha)&&gitHash(value.activation.reviewed_parent_tree)&&hash(value.activation.disabled_request_sha256),'Invalid ordinary activation identity');}
  return value;
}
export function readOrdinaryCiRequest(root=process.cwd()){
  const path=join(root,ORDINARY_CI_REQUEST_PATH);let stat;try{stat=lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=16384,'Unsafe ordinary request');
  const raw=regular(path,16384);return {raw,value:validateOrdinaryCiRequest(JSON.parse(raw)),sha256:sha(raw)};
}
export function ordinaryCiExecution(env=process.env){return {event_name:env.GITHUB_EVENT_NAME,repository:env.GITHUB_REPOSITORY,repository_id:Number(env.GITHUB_REPOSITORY_ID),ref:env.GITHUB_REF,sha:env.GITHUB_SHA,workflow_ref:env.GITHUB_WORKFLOW_REF,workflow_sha:env.GITHUB_WORKFLOW_SHA,run_id:Number(env.GITHUB_RUN_ID),run_attempt:Number(env.GITHUB_RUN_ATTEMPT)};}
export function ordinaryCiReadApi(endpoint,paginate=false){
  assert(typeof endpoint==='string'&&endpoint.startsWith(CI_PREFIX)&&!/[\x00-\x20\x7f\\%]/.test(endpoint)&&!endpoint.includes('..')&&!endpoint.includes('://'),'Unsafe ordinary GitHub GET');
  const suffix=endpoint.slice(CI_PREFIX.length);
  assert(suffix===''||/^\/git\/(?:ref\/heads\/main|commits\/[a-f0-9]{40}|trees\/[a-f0-9]{40}\?recursive=1)$/.test(suffix)
    ||/^\/contents\/\.github\/ordinary-carry-oct17-request\.json\?ref=[a-f0-9]{40}$/.test(suffix)
    ||/^\/actions\/runs\/\d+(?:\/attempts\/1)?(?:\/jobs\?per_page=100)?$/.test(suffix)
    ||/^\/actions\/runs\/\d+\/artifacts\?per_page=100$/.test(suffix)
    ||/^\/actions\/workflows\/(?:294252465|364666954|ci\.yml)\/runs\?branch=main&(?:event=push&)?head_sha=[a-f0-9]{40}&per_page=100$/.test(suffix),'Unlisted ordinary GitHub GET');
  // Existing Actions authentication only. The hostname and read method cannot
  // come from the request, event, environment host setting, or a URL redirect.
  return JSON.parse(execFileSync('gh',['api','--hostname','github.com','--method','GET',...(paginate?['--paginate','--slurp']:[]),endpoint],{encoding:'utf8',maxBuffer:32*1024**2,timeout:60000}));
}
function ciCommit(api,id){assert(gitHash(id),'Invalid ordinary Git commit');const c=api(`${CI_PREFIX}/git/commits/${id}`);assert(c?.sha===id&&gitHash(c.tree?.sha)&&Array.isArray(c.parents)&&c.parents.length<=2&&c.parents.every(p=>gitHash(p?.sha))&&new Set(c.parents.map(p=>p.sha)).size===c.parents.length,'Incomplete ordinary Git commit');return c;}
function ciTree(api,id){
  const t=api(`${CI_PREFIX}/git/trees/${id}?recursive=1`);assert(t?.sha===id&&t.truncated===false&&Array.isArray(t.tree)&&t.tree.length>0&&t.tree.length<=60000,'Incomplete ordinary Git tree');
  const files=Object.create(null),seen=new Set();for(const entry of t.tree){assert(ciPath(entry?.path)&&gitHash(entry.sha)&&!seen.has(entry.path),'Invalid ordinary Git entry');seen.add(entry.path);if(entry.type==='tree'&&entry.mode==='040000')continue;assert(entry.type==='blob'&&['100644','100755'].includes(entry.mode),'Nonregular ordinary Git entry');files[entry.path]={sha:entry.sha,mode:entry.mode};}
  assert(Object.keys(files).length>0&&Object.keys(files).length<=30000,'Unbounded ordinary Git inventory');return files;
}
function ciRemoteRequest(api,head,files){
  if(!Object.hasOwn(files,ORDINARY_CI_REQUEST_PATH))return null;
  assert.equal(files[ORDINARY_CI_REQUEST_PATH].mode,'100644','Ordinary request mode changed');
  const value=api(`${CI_PREFIX}/contents/${ORDINARY_CI_REQUEST_PATH}?ref=${head}`);
  assert(value?.type==='file'&&value.path===ORDINARY_CI_REQUEST_PATH&&value.encoding==='base64'&&positive(value.size)&&value.size<=16384&&typeof value.content==='string'&&value.sha===files[ORDINARY_CI_REQUEST_PATH].sha,'Unbound ordinary request blob');
  const raw=Buffer.from(value.content,'base64');assert(raw.length===value.size&&ciBlob(raw)===value.sha,'Ordinary request Git hash changed');return {raw,value:validateOrdinaryCiRequest(JSON.parse(raw)),sha256:sha(raw)};
}
function ciVerifyTrackedBytes(root,files){
  let total=0;const buffer=Buffer.alloc(1024**2);
  for(const [path,entry] of Object.entries(files)){
    const absolute=join(root,path),before=lstatSync(absolute);assert(realpathSync(absolute)===absolute&&before.isFile()&&!before.isSymbolicLink()&&before.size<=32*1024**2,'Unsafe ordinary tracked input');
    total+=before.size;assert(total<=256*1024**2,'Ordinary tracked inputs exceed bound');assert.equal(before.mode&0o111?'100755':'100644',entry.mode,'Ordinary tracked mode changed');
    const fd=openSync(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const opened=fstatSync(fd);assert(opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size&&opened.mtimeMs===before.mtimeMs&&opened.ctimeMs===before.ctimeMs,'Ordinary tracked input replaced');
      const hash=createHash('sha1').update(`blob ${before.size}\0`);let offset=0;while(offset<before.size){const count=readSync(fd,buffer,0,Math.min(buffer.length,before.size-offset),null);assert(count>0,'Ordinary tracked input truncated');hash.update(buffer.subarray(0,count));offset+=count;}assert.equal(readSync(fd,buffer,0,1,null),0,'Ordinary tracked input grew');
      const after=fstatSync(fd);assert(after.dev===before.dev&&after.ino===before.ino&&after.size===before.size&&after.mode===before.mode&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,'Ordinary tracked input changed while reading');assert.equal(hash.digest('hex'),entry.sha,'Ordinary tracked bytes differ from Git tree');const named=lstatSync(absolute);assert(realpathSync(absolute)===absolute&&!named.isSymbolicLink()&&['dev','ino','size','mode','mtimeMs','ctimeMs'].every(key=>named[key]===before[key]),'Ordinary tracked path replaced while reading');
    }finally{closeSync(fd);}
  }
}
function ciLocalTree(root){
  assert(realpathSync(root)===resolve(root)&&ciGit(root,'rev-parse','--show-toplevel')===resolve(root),'Ordinary controller root changed');
  const files=Object.create(null);for(const line of execFileSync('git',['ls-tree','-r','-z','--full-tree','HEAD'],{cwd:root,encoding:'utf8',maxBuffer:32*1024**2,timeout:60000}).split('\0').filter(Boolean)){
    const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert(m&&ciPath(m[3])&&!Object.hasOwn(files,m[3]),'Invalid ordinary local tree');files[m[3]]={mode:m[1],sha:m[2]};}
  ciVerifyTrackedBytes(root,files);execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:root,stdio:'pipe',timeout:60000});assert.equal(ciGit(root,'ls-files','--others','--exclude-standard'),'','Untracked ordinary controller input');return files;
}
function ciRequestOnly(before,after){const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>digest(before[p]??null)!==digest(after[p]??null));same(changed,[ORDINARY_CI_REQUEST_PATH],'Ordinary activation changed more than its request');assert(before[ORDINARY_CI_REQUEST_PATH]?.mode==='100644'&&after[ORDINARY_CI_REQUEST_PATH]?.mode==='100644','Ordinary request was added or changed mode');}
function ciAncestry(api,parent){
  const base=ORDINARY_CI_IDENTITY.controller_base,records=new Map(),active=new Set();
  function visit(id){
    assert(!active.has(id),'Cyclic ordinary ancestry');if(records.has(id))return;
    assert(records.size+active.size<64,'Ordinary ancestry exceeds 64 commits');active.add(id);
    const commit=ciCommit(api,id),files=ciTree(api,commit.tree.sha),request=ciRemoteRequest(api,id,files);
    assert(!request?.value.enabled,'Ordinary identity was previously enabled; rearm forbidden');
    if(id===base.sha){assert.equal(commit.tree.sha,base.tree,'Ordinary base tree changed');assert.equal(request,null,'Ordinary base must predate this request');}
    else{assert(commit.parents.length>0,'Ordinary ancestry escapes reviewed base');for(const p of commit.parents)visit(p.sha);}
    active.delete(id);records.set(id,{sha:id,tree:commit.tree.sha,parents:commit.parents.map(p=>p.sha),request_sha256:request?.sha256??null});
  }
  visit(parent);assert(records.has(base.sha),'Ordinary reviewed base missing');return [...records.values()].sort((a,b)=>a.sha.localeCompare(b.sha));
}
export function verifyOrdinaryCiActivation({root=process.cwd(),api=ordinaryCiReadApi,now=Date.now(),historical=null}={}){
  let request,head,tree;
  if(historical){head=historical.executing.sha;tree=historical.executing.tree;request=ciRemoteRequest(api,head,ciTree(api,tree));assert(request?.value.enabled,'Historical ordinary activation missing');}
  else{request=readOrdinaryCiRequest(root);assert(request?.value.enabled,'Ordinary request is not enabled');assertOrdinaryClock(now,ORDINARY_CI_IDENTITY);head=ciGit(root,'rev-parse','HEAD');tree=ciGit(root,'rev-parse','HEAD^{tree}');
    const repo=api(CI_PREFIX);assert(repo?.id===CI_REPO_ID&&repo.full_name===CI_REPO&&repo.default_branch==='main','Official ordinary repository changed');assert.equal(api(`${CI_PREFIX}/git/ref/heads/main`)?.object?.sha,head,'Ordinary controller is no longer current main');}
  const a=request.value.activation,current=ciCommit(api,head),parent=ciCommit(api,a.reviewed_parent_sha);
  assert(current.tree.sha===tree&&parent.tree.sha===a.reviewed_parent_tree&&current.parents[0]?.sha===parent.sha,'Ordinary reviewed parent edge changed');
  const before=ciTree(api,parent.tree.sha),after=ciTree(api,tree);ciRequestOnly(before,after);if(!historical)same(ciLocalTree(root),after,'Ordinary checkout changed');
  const old=ciRemoteRequest(api,parent.sha,before),remote=ciRemoteRequest(api,head,after);assert(old&&!old.value.enabled&&old.value.activation===null&&old.sha256===a.disabled_request_sha256&&remote.raw.equals(request.raw),'Ordinary reviewed request bytes changed');same({...remote.value,enabled:false,activation:null},old.value,'Ordinary immutable request body changed');
  let mergeParent=null;
  if(current.parents.length===2){const secondary=ciCommit(api,current.parents[1].sha);assert(secondary.parents.length===1&&secondary.parents[0].sha===parent.sha&&secondary.tree.sha===tree,'Ordinary merge is not exact request-only child');const sf=ciTree(api,secondary.tree.sha);ciRequestOnly(before,sf);assert(ciRemoteRequest(api,secondary.sha,sf).raw.equals(remote.raw),'Ordinary merge request differs');mergeParent={sha:secondary.sha,tree:secondary.tree.sha};}
  else assert.equal(current.parents.length,1,'Ordinary activation parent count changed');
  const result={reviewed_parent:{sha:parent.sha,tree:parent.tree.sha,request_sha256:old.sha256},executing:{sha:head,tree},merge_parent:mergeParent,ancestry:ciAncestry(api,parent.sha)};
  if(historical)same(result,historical,'Historical ordinary activation evidence changed');return {request:remote.value,request_sha256:remote.sha256,activation:result};
}
function ciInventory(api,endpoint,key,validate){
  const pages=api(endpoint,true);assert(Array.isArray(pages)&&pages.length>0&&pages.length<=10,'Missing ordinary complete API inventory');const total=pages[0]?.total_count;assert(Number.isSafeInteger(total)&&total>=0&&total<=1000&&pages.length===Math.max(1,Math.ceil(total/100)),'Unbounded ordinary API inventory');
  const found=[],seen=new Set();for(let i=0;i<pages.length;i++){const p=pages[i];assert(p.total_count===total&&Array.isArray(p[key])&&p[key].length===Math.min(100,Math.max(0,total-i*100)),'Truncated ordinary API inventory');for(const item of p[key]){assert(positive(item?.id)&&!seen.has(item.id),'Duplicate ordinary API entry');seen.add(item.id);validate(item);found.push(item);}}return found;
}
function ciJobs(api,id){return ciInventory(api,`${CI_PREFIX}/actions/runs/${id}/attempts/1/jobs?per_page=100`,'jobs',job=>assert(job.run_id===id&&job.run_attempt===1&&gitHash(job.head_sha),'Wrong ordinary job identity'));}
function ciRunCore(run){return Object.fromEntries(['id','run_attempt','workflow_id','path','head_sha','head_branch','event','run_started_at','repository','head_repository'].map(key=>[key,['repository','head_repository'].includes(key)?{id:run[key]?.id,full_name:run[key]?.full_name}:run[key]]));}
function ciRunSnapshot(run){return {...ciRunCore(run),created_at:run.created_at,status:run.status,conclusion:run.conclusion,...(run.status==='completed'?{updated_at:run.updated_at}:{})};}
function ciValidateRun(run,workflow,head,event){assert(positive(run?.id)&&run.run_attempt===1&&run.workflow_id===workflow.id&&run.path===workflow.path&&run.head_sha===head&&run.head_branch==='main'&&run.event===event&&ciSameRepo(run),'Wrong ordinary workflow run');ciTime(run.created_at);ciTime(run.updated_at);if(run.status==='queued'&&run.conclusion===null&&run.run_started_at===null)return;ciTime(run.run_started_at);}
function ciExactRun(api,id,workflow,head,event,{historical=false,now=Date.now()}={}){
  const attempt=api(`${CI_PREFIX}/actions/runs/${id}/attempts/1`);ciValidateRun(attempt,workflow,head,event);assert.equal(attempt.id,id,'Wrong ordinary attempt id');
  if(historical){
    const latest=api(`${CI_PREFIX}/actions/runs/${id}`);assert(latest?.id===id&&positive(latest.run_attempt)&&latest.workflow_id===workflow.id&&latest.path===workflow.path&&latest.head_sha===head&&latest.head_branch==='main'&&latest.event===event&&ciSameRepo(latest),'Historical ordinary run identity changed');
    assert(ciTime(latest.created_at)<=ciTime(attempt.created_at)&&ciTime(latest.created_at)<=ciTime(attempt.run_started_at)&&ciTime(attempt.created_at)<=ciTime(attempt.updated_at)&&ciTime(attempt.run_started_at)<=ciTime(attempt.updated_at)&&ciTime(attempt.updated_at)<=now,'Historical ordinary attempt clocks changed');
    // The immutable run creation clock and attempt creation clock differ in
    // GitHub's API. Later reruns cannot replace the recorded original attempt.
    return {...attempt,created_at:latest.created_at};
  }
  const latest=api(`${CI_PREFIX}/actions/runs/${id}`);ciValidateRun(latest,workflow,head,event);assert.equal(latest.id,id,'Wrong ordinary latest run id');same(ciRunCore(attempt),ciRunCore(latest),'Ordinary attempt identity changed');assert(attempt.status===latest.status&&attempt.conclusion===latest.conclusion,'Ordinary attempt status changed');
  if(latest.status==='queued'&&latest.conclusion===null&&latest.run_started_at===null){assert(ciTime(latest.created_at)<=ciTime(attempt.created_at)&&ciTime(attempt.created_at)<=ciTime(attempt.updated_at)&&ciTime(latest.created_at)<=ciTime(latest.updated_at)&&ciTime(latest.updated_at)<=now&&ciTime(attempt.updated_at)<=now,'Invalid queued ordinary clocks');return latest;}
  assert(ciTime(latest.created_at)<=ciTime(latest.run_started_at)&&ciTime(latest.created_at)<=ciTime(attempt.created_at)&&ciTime(attempt.created_at)<=ciTime(attempt.updated_at)&&ciTime(attempt.created_at)<=ciTime(latest.updated_at)&&ciTime(latest.run_started_at)<=ciTime(latest.updated_at)&&ciTime(latest.run_started_at)<=ciTime(attempt.updated_at)&&ciTime(latest.updated_at)<=now&&ciTime(attempt.updated_at)<=now&&(latest.status!=='completed'||ciTime(latest.updated_at)<=ciTime(attempt.updated_at)),'Invalid ordinary attempt clocks');return latest;
}
function ciTriggerSummary(run){return {id:run.id,run_attempt:1,workflow_id:run.workflow_id,path:run.path,head_sha:run.head_sha,head_branch:run.head_branch,event:run.event,created_at:run.created_at,run_started_at:run.run_started_at,completed_at:run.updated_at};}
function ciVerifyCi(api,head,payload,now,{historical=false}={}){
  let run,checks;
  if(historical){run=ciExactRun(api,payload.id,CI_WORKFLOW,head,'push',{historical:true,now});checks=null;}
  else{const endpoint=`${CI_PREFIX}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${head}&per_page=100`;const listed=ciInventory(api,endpoint,'workflow_runs',r=>ciValidateRun(r,CI_WORKFLOW,head,'push'));assert(listed.length===1&&listed[0].id===payload.id,'Ordinary CI is ambiguous or superseded');run=ciExactRun(api,payload.id,CI_WORKFLOW,head,'push',{now});same(ciRunSnapshot(listed[0]),ciRunSnapshot(run),'Ordinary listed CI changed');same(ciRunSnapshot(payload),ciRunSnapshot(run),'Ordinary CI event changed');checks=verifyCorrectionChecks(CI_REPO,head,api);}
  assert(run.status==='completed'&&run.conclusion==='success'&&ciTime(run.run_started_at)<=ciTime(run.updated_at)&&ciTime(run.updated_at)<=now,'Ordinary CI is not successful before admission');
  const jobs=ciJobs(api,run.id),verified=correctionContract.required_ci_jobs.map(name=>{const found=jobs.filter(j=>j.name===name);assert.equal(found.length,1,'Missing/duplicate ordinary required CI job');const j=found[0];assert(j.head_sha===head&&j.status==='completed'&&j.conclusion==='success'&&ciTime(j.started_at)>=ciTime(run.run_started_at)&&ciTime(j.completed_at)>=ciTime(j.started_at)&&ciTime(j.completed_at)<=ciTime(run.updated_at),'Ordinary required CI job failed or changed');return {workflow:run.path,run_id:run.id,run_attempt:1,job_id:j.id,name,head_sha:head,started_at:j.started_at,completed_at:j.completed_at};});
  if(checks)same(checks,verified.map(({started_at,completed_at,...rest})=>rest),'Existing full controller CI proof disagrees');return {trigger:ciTriggerSummary(run),checks:verified};
}
function ciEvent(event){assert(event?.action==='completed'&&event.repository?.id===CI_REPO_ID&&event.repository.full_name===CI_REPO&&event.repository.default_branch==='main','Wrong ordinary completion event');const r=event.workflow_run;assert(r&&positive(r.id)&&r.run_attempt===1&&ciSameRepo(r)&&r.head_branch==='main'&&r.status==='completed'&&gitHash(r.head_sha),'Invalid ordinary trigger');return r;}
function ciCaller(api,execution,activation,now){
  const head=activation.executing.sha;assert(execution.event_name==='workflow_run'&&execution.repository===CI_REPO&&execution.repository_id===CI_REPO_ID&&execution.ref==='refs/heads/main'&&execution.sha===head&&execution.workflow_sha===head&&execution.workflow_ref===`${CI_REPO}/${CI_PUBLISHER.path}@refs/heads/main`&&positive(execution.run_id)&&execution.run_attempt===1,'Wrong ordinary caller execution');
  const own=ciExactRun(api,execution.run_id,CI_PUBLISHER,head,'workflow_run',{now});assert(own.status==='in_progress'&&own.conclusion===null&&ciTime(own.run_started_at)<=now,'Ordinary caller is not active original attempt');return own;
}
const ciHoldPrefix='Hold ordinary carry v4-ci';
function ciHoldMarker(requestHash,triggerId){assert(hash(requestHash)&&positive(triggerId));return `${ciHoldPrefix} ${requestHash} ${triggerId}/1`;}
// This exact workflow contains only a ':' marker on its existing no-export
// branch. Its event-derived name supplies the parent edge absent from run REST
// metadata; a successful workflow_run alone never proves a hold.
const CI_STATIC_HOLD_WORKFLOW_BLOB='5496e4c947e728c4c122b69ac8bd8ce03964d72c';
function ciStaticNoExportHold(api,run,now,{historical=false,head,parentCI=null}={}){
  assert(gitHash(head)&&run.head_sha===head&&run.status==='completed'&&run.conclusion==='success','Static ordinary hold is not the exact successful head');
  const files=ciTree(api,ciCommit(api,head).tree.sha);same(files['.github/workflows/static-site.yml'],{sha:CI_STATIC_HOLD_WORKFLOW_BLOB,mode:'100644'},'Static no-export marker workflow changed');
  const jobs=ciJobs(api,run.id),names=['select-markets','ensure_daily_price_release','build-market','combine-and-build','promote-daily-source'];
  assert(jobs.length===names.length&&names.every(name=>jobs.filter(j=>j.name===name).length===1)&&jobs.every(j=>j.head_sha===head&&j.status==='completed'),'Static no-export job inventory changed');
  const selected=jobs.find(j=>j.name==='select-markets');assert(selected.conclusion==='success'&&ciTime(selected.started_at)>=ciTime(run.run_started_at)&&ciTime(selected.completed_at)>=ciTime(selected.started_at)&&ciTime(selected.completed_at)<=ciTime(run.updated_at),'Static no-export selection failed');
  assert(jobs.filter(j=>j!==selected).every(j=>j.conclusion==='skipped'&&(j.steps??[]).length===0),'Static no-export hold ran a data/provider job');
  const steps=selected.steps;assert(Array.isArray(steps),'Missing static no-export steps');
  const markers=steps.filter(s=>s.name?.startsWith('Ordinary no-export CI '));assert(markers.length===1,'Missing or duplicate static parent-CI marker');
  const marker=markers[0],match=/^Ordinary no-export CI ([1-9]\d*)\/1\/([a-f0-9]{40})$/.exec(marker.name);
  assert(match&&positive(Number(match[1]))&&match[2]===head,'Invalid static parent-CI marker');
  const required=['Admit only the finite exact-main price CI trigger',`Run ASIA='["HK","IN","JP","KR","TW","CN","SG","MY","AU"]'`,marker.name];
  const skipped="Run python - <<'PY'",optional=['Set up job','Run actions/checkout@v4','Run actions/setup-node@v4','Post Run actions/setup-node@v4','Post Run actions/checkout@v4','Complete job'];
  assert(new Set(steps.map(s=>s.name)).size===steps.length&&steps.every(s=>[...required,skipped,...optional].includes(s.name)&&s.status==='completed'&&['success','skipped'].includes(s.conclusion)),'Unexpected static no-export step');
  for(const name of required){const matches=steps.filter(s=>s.name===name);assert(matches.length===1&&matches[0].conclusion==='success','Static no-export step did not succeed');}
  assert(steps.filter(s=>s.name===skipped&&s.conclusion==='skipped').length===1,'Static no-export hold ran ordinary source policy');
  for(const step of steps.filter(s=>s.conclusion==='success'))assert(ciTime(step.started_at)>=ciTime(selected.started_at)&&ciTime(step.completed_at)>=ciTime(step.started_at)&&ciTime(step.completed_at)<=ciTime(selected.completed_at),'Static no-export step chronology changed');
  const pick=steps.find(s=>s.name===required[1]);assert(ciTime(marker.started_at)>=ciTime(pick.completed_at),'Static parent-CI marker predates no-export selection');
  const parent=ciExactRun(api,Number(match[1]),CI_WORKFLOW,head,'push',{historical,now});assert(!historical||parentCI,'Missing recorded static parent CI');
  if(parentCI){if(historical)ciHistoricalTriggerMatch(ciTriggerSummary(parent),parentCI);else same(ciTriggerSummary(parent),parentCI,'Static hold is not the admitted parent CI');}
  const parentCompleted=parentCI?.completed_at??parent.updated_at;assert(parent.status==='completed'&&['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure'].includes(parent.conclusion)&&ciTime(parentCompleted)<=ciTime(run.created_at),'Static no-export parent CI is not terminal before its child');
  const artifacts=ciInventory(api,`${CI_PREFIX}/actions/runs/${run.id}/artifacts?per_page=100`,'artifacts',()=>{});assert(artifacts.length===0,'Static no-export hold produced an artifact');
  return run;
}
function ciHoldTrigger(api,id,now,{historical=false,head,parentCI=null}={}){
  const latest=api(`${CI_PREFIX}/actions/runs/${id}`);assert(positive(latest?.workflow_id)&&gitHash(latest.head_sha),'Missing ordinary hold trigger');
  if(latest.path==='.github/workflows/static-site.yml'&&latest.workflow_id===294257497&&latest.event==='workflow_run'){
    const run=ciExactRun(api,id,{id:294257497,path:latest.path},head,'workflow_run',{now,historical});return ciStaticNoExportHold(api,run,now,{historical,head,parentCI});
  }
  const allowed=latest.path===CI_WORKFLOW.path&&latest.workflow_id===CI_WORKFLOW.id&&latest.event==='push'||latest.path==='.github/workflows/design-acceptance.yml'&&latest.workflow_id===371793291&&latest.event==='push'||latest.path==='.github/workflows/static-site.yml'&&latest.workflow_id===294257497&&['schedule','workflow_dispatch'].includes(latest.event);
  assert(allowed,'Unlisted ordinary hold trigger');const run=ciExactRun(api,id,{id:latest.workflow_id,path:latest.path},latest.head_sha,latest.event,{now,historical});assert(run.status==='completed'&&['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure'].includes(run.conclusion)&&ciTime(run.updated_at)<=now,'Ordinary hold trigger is not terminal');return run;
}
function ciPriorHold(api,listed,head,requestHash,now,{historical=false,recordedTrigger=null,parentCI=null}={}){
  const run=ciExactRun(api,listed.id,CI_PUBLISHER,head,'workflow_run',{now,historical});if(!historical)same(ciRunSnapshot(listed),ciRunSnapshot(run),'Ordinary prior hold listing changed');assert(run.status==='completed'&&run.conclusion==='success','Earlier ordinary attempt may have been admitted');
  const all=ciJobs(api,run.id),routes=all.filter(j=>j.name===CI_ROUTE_JOB),publishes=all.filter(j=>j.name==='publish');assert(all.length===2&&routes.length===1&&publishes.length===1&&all.every(j=>j.head_sha===head&&j.status==='completed')&&routes[0].conclusion==='success'&&publishes[0].conclusion==='skipped'&&(publishes[0].steps??[]).length===0,'Earlier ordinary caller is not a proven hold');
  const markers=routes[0].steps?.filter(s=>s.name.startsWith(ciHoldPrefix+' '));assert(markers?.length===1&&markers[0].status==='completed'&&markers[0].conclusion==='success','Missing positive ordinary hold marker');
  const match=/^Hold ordinary carry v4-ci ([a-f0-9]{64}) (\d+)\/1$/.exec(markers[0].name);assert(match&&match[1]===requestHash,'Ordinary hold request binding changed');
  const actualTrigger=ciHoldTrigger(api,Number(match[2]),now,{historical,head,parentCI});if(historical)ciHistoricalTriggerMatch(ciTriggerSummary(actualTrigger),recordedTrigger);const trigger=historical?{...actualTrigger,updated_at:recordedTrigger.completed_at}:actualTrigger;assert(ciTime(trigger.updated_at)<=ciTime(run.created_at)&&ciTime(routes[0].started_at)>=ciTime(run.run_started_at)&&ciTime(markers[0].started_at)>=ciTime(routes[0].started_at)&&ciTime(markers[0].completed_at)>=ciTime(markers[0].started_at)&&ciTime(markers[0].completed_at)<=ciTime(routes[0].completed_at)&&ciTime(routes[0].completed_at)<=ciTime(run.updated_at),'Ordinary hold chronology changed');
  assert(!routes[0].steps.some(s=>s.name===ORDINARY_CI_ADMISSION_STEP&&s.conclusion==='success'),'Earlier ordinary hold admitted publication');return {run_id:run.id,run_attempt:1,route_job_id:routes[0].id,publish_job_id:publishes[0].id,marker:markers[0].name,trigger:ciTriggerSummary(trigger)};
}
function ciReplay(api,own,activation,requestHash,now,parentCI){
  const head=activation.executing.sha,all=ciInventory(api,`${CI_PREFIX}/actions/workflows/${CI_PUBLISHER.id}/runs?branch=main&head_sha=${head}&per_page=100`,'workflow_runs',r=>assert(r.workflow_id===CI_PUBLISHER.id&&r.path===CI_PUBLISHER.path&&r.head_sha===head&&r.head_branch==='main'&&ciSameRepo(r)&&positive(r.run_attempt),'Wrong ordinary caller inventory'));
  assert(all.some(r=>r.id===own.id),'Own ordinary caller missing from complete inventory');const prior=[];
  for(const listed of all){if(listed.id===own.id){same(ciRunSnapshot(listed),ciRunSnapshot(own),'Own ordinary caller listing changed');continue;}
    if(listed.id<own.id){assert(ciTime(listed.created_at)<=ciTime(own.created_at),'Ordinary prior caller creation changed');prior.push(ciPriorHold(api,listed,head,requestHash,now,{parentCI}));}
    else{const next=ciExactRun(api,listed.id,CI_PUBLISHER,head,'workflow_run',{now});same(ciRunSnapshot(listed),ciRunSnapshot(next),'Ordinary successor changed');assert(ciTime(next.created_at)>=ciTime(own.created_at)&&next.status==='queued'&&next.conclusion===null&&ciJobs(api,next.id).length===0,'Ordinary successor already started or reran');}}
  return prior.sort((a,b)=>a.run_id-b.run_id);
}
function ciMaybeRegular(path,cap){try{lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}return regular(path,cap);}
async function ciNoConflicts(root){
  const finite=ciMaybeRegular(join(root,'.github/retained-price-oct6-source.json'),128*1024);if(finite){const {readRepairRequest}=await import('./retained-price-source-admission.mjs');assert(!readRepairRequest(root)?.value.enabled,'Competing active finite price route');}
  const {renewalCiEligibility}=await import('./financial-renewal-ci-admission.mjs');const {validateRenewalRegistry}=await import('./financial-source-renewal.mjs');const registry=validateRenewalRegistry(JSON.parse(regular(join(root,'contracts/financial_source_renewal_v1.json'),128*1024)));assert(!registry.publication_enabled&&registry.ci_admission?.phase!=='publish'&&renewalCiEligibility({root,phase:'publish'}).status!=='eligible','Competing eligible financial renewal route');
}
export async function routeOrdinaryCi({root=process.cwd(),event,execution=ordinaryCiExecution(),api=ordinaryCiReadApi,now=Date.now()}={}){
  const request=readOrdinaryCiRequest(root);if(!request)return {ordinary_hold:false,ordinary_ci:false,ordinary_hold_marker:''};
  // A disabled prepared commit withholds authority even after expiry, on a
  // normal merge commit, or when a stale/newer source callback reaches it.
  if(!request.value.enabled)return {ordinary_hold:true,ordinary_ci:false,ordinary_hold_marker:`Hold disabled ordinary carry v4-ci ${request.sha256}`};
  await ciNoConflicts(root);const verified=verifyOrdinaryCiActivation({root,api,now}),trigger=ciEvent(event),own=ciCaller(api,execution,verified.activation,now);
  if(trigger.path!==CI_WORKFLOW.path||trigger.head_sha!==verified.activation.executing.sha||trigger.event!=='push'||trigger.conclusion!=='success'){
    const exact=ciHoldTrigger(api,trigger.id,now,{head:verified.activation.executing.sha});same(ciRunSnapshot(trigger),ciRunSnapshot(exact),'Ordinary hold event changed');assert(ciTime(exact.updated_at)<=ciTime(own.created_at),'Ordinary caller predates hold trigger');return {ordinary_hold:true,ordinary_ci:false,ordinary_hold_marker:ciHoldMarker(verified.request_sha256,trigger.id)};
  }
  ciVerifyCi(api,verified.activation.executing.sha,trigger,now);assert(ciTime(trigger.updated_at)<=ciTime(own.created_at),'Ordinary caller predates CI');return {ordinary_hold:false,ordinary_ci:true,ordinary_hold_marker:''};
}
export function ordinaryCiControllerRoot(){
  const root=process.env.ORDINARY_CI_CONTROLLER_ROOT;if(root===undefined)return process.cwd();
  const workspace=process.env.GITHUB_WORKSPACE,temp=process.env.RUNNER_TEMP;
  assert(typeof workspace==='string'&&resolve(workspace)===workspace&&realpathSync(workspace)===workspace&&typeof temp==='string'&&resolve(temp)===temp&&realpathSync(temp)===temp&&root===join(temp,'ordinary-carry-controller'),'Unexpected ordinary controller path');
  assert(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink()&&realpathSync(root)===root&&ciGit(root,'rev-parse','--show-toplevel')===root,'Linked or replaced ordinary controller');
  assert(realpathSync(resolve(root,ciGit(root,'rev-parse','--git-common-dir')))===realpathSync(join(workspace,'.git')),'Ordinary controller is not the original checkout worktree');
  const records=ciGit(workspace,'worktree','list','--porcelain').split('\n\n').map(v=>v.split('\n')),matches=records.filter(lines=>lines.includes(`worktree ${root}`));assert(matches.length===1&&matches[0].includes('detached'),'Ordinary controller is not registered detached worktree');
  assert(ciGit(workspace,'rev-parse','HEAD')===ciGit(root,'rev-parse','HEAD')&&ciGit(workspace,'rev-parse','HEAD^{tree}')===ciGit(root,'rev-parse','HEAD^{tree}'),'Executing ordinary checkout changed');
  ciVerifyTrackedBytes(workspace,ciLocalTree(root));execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:workspace,stdio:'pipe',timeout:60000});
  const untracked=execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:workspace,encoding:'utf8',maxBuffer:32*1024**2,timeout:60000}).split('\0').filter(Boolean);
  assert(untracked.every(path=>path==='release/'||path.startsWith('release/')),'Unexpected untracked executing controller input');
  if(untracked.length){const selected=join(workspace,'release');assert(lstatSync(selected).isDirectory()&&!lstatSync(selected).isSymbolicLink()&&realpathSync(selected)===selected&&ciGit(selected,'rev-parse','--show-toplevel')===selected&&ciGit(selected,'rev-parse','HEAD')===ORDINARY_CI_IDENTITY.ui_sha,'Unbound selected UI output directory');}
  return root;
}
export function prepareOrdinaryCiController(){
  assert(process.env.ORDINARY_CI_CONTROLLER_ROOT===undefined,'Ordinary controller cannot be prepared twice');const workspace=process.env.GITHUB_WORKSPACE,temp=process.env.RUNNER_TEMP;
  assert(typeof workspace==='string'&&workspace===process.cwd()&&realpathSync(workspace)===workspace&&typeof temp==='string'&&resolve(temp)===temp&&realpathSync(temp)===temp,'Invalid ordinary controller preparation location');
  assert(readOrdinaryCiRequest(workspace)?.value.enabled,'Disabled ordinary controller cannot prepare');ciLocalTree(workspace);
  const head=ciGit(workspace,'rev-parse','HEAD');assert(head===process.env.GITHUB_SHA&&head===process.env.GITHUB_WORKFLOW_SHA&&process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_EVENT_NAME==='workflow_run','Ordinary preparation is not exact current caller');
  const root=join(temp,'ordinary-carry-controller');let found=false;try{lstatSync(root);found=true;}catch(error){if(error.code!=='ENOENT')throw error;}assert(!found,'Ordinary controller destination already exists');
  execFileSync('git',['worktree','add','--detach',root,head],{cwd:workspace,stdio:'pipe',timeout:60000});ciLocalTree(root);
  assert(process.env.GITHUB_ENV,'Missing ordinary environment output');appendFileSync(process.env.GITHUB_ENV,`ORDINARY_CI_CONTROLLER_ROOT=${root}\n`);return {prepared:true,head};
}
function ciProofPath({allowMissing=false}={}){
  const temp=process.env.RUNNER_TEMP;assert(typeof temp==='string'&&resolve(temp)===temp,'Unsafe ordinary proof directory');
  let stat;try{stat=lstatSync(temp);}catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}
  assert(realpathSync(temp)===temp&&stat.isDirectory(),'Unsafe ordinary proof directory');return join(temp,CI_PROOF_FILE);
}
export function validateOrdinaryCiProof(proof){
  closed(proof,['schema_version','plan_id','identity_sha256','request_sha256','request','activation','trigger','checks','caller','admitted_at','prior_holds'],'Invalid closed ordinary CI proof');
  assert(proof.schema_version==='ordinary-carry-ci-proof-v1'&&proof.plan_id===ORDINARY_CI_IDENTITY.amendment_id&&proof.identity_sha256===ordinaryCiIdentityDigest()&&hash(proof.request_sha256),'Unreviewed ordinary CI proof');validateOrdinaryCiRequest(proof.request);assert(proof.request.enabled,'Disabled request cannot mint ordinary receipt');
  closed(proof.activation,['reviewed_parent','executing','merge_parent','ancestry'],'Ordinary activation proof keys');closed(proof.activation.reviewed_parent,['sha','tree','request_sha256'],'Ordinary parent proof keys');closed(proof.activation.executing,['sha','tree'],'Ordinary executing proof keys');
  if(proof.activation.merge_parent!==null){closed(proof.activation.merge_parent,['sha','tree'],'Ordinary merge proof keys');assert(gitHash(proof.activation.merge_parent.sha)&&proof.activation.merge_parent.sha!==proof.activation.executing.sha&&proof.activation.merge_parent.sha!==proof.activation.reviewed_parent.sha&&proof.activation.merge_parent.tree===proof.activation.executing.tree,'Invalid ordinary merge proof');}for(const key of ['reviewed_parent','executing']){assert(gitHash(proof.activation[key]?.sha)&&gitHash(proof.activation[key]?.tree),'Invalid ordinary Git proof');}
  assert(Array.isArray(proof.activation.ancestry)&&proof.activation.ancestry.length>0&&proof.activation.ancestry.length<=64&&hash(proof.activation.reviewed_parent.request_sha256),'Invalid ordinary ancestry proof');
  const ancestry=new Map();for(const record of proof.activation.ancestry){closed(record,['sha','tree','parents','request_sha256'],'Ordinary ancestry record keys');assert(gitHash(record.sha)&&gitHash(record.tree)&&!ancestry.has(record.sha)&&Array.isArray(record.parents)&&record.parents.length<=2&&record.parents.every(gitHash)&&new Set(record.parents).size===record.parents.length&&(record.request_sha256===null||hash(record.request_sha256)),'Invalid ordinary ancestry record');ancestry.set(record.sha,record);}
  const base=ancestry.get(ORDINARY_CI_IDENTITY.controller_base.sha),parent=ancestry.get(proof.activation.reviewed_parent.sha);assert(base?.tree===ORDINARY_CI_IDENTITY.controller_base.tree&&base.request_sha256===null&&parent?.tree===proof.activation.reviewed_parent.tree&&parent.request_sha256===proof.activation.reviewed_parent.request_sha256,'Ordinary ancestry boundaries changed');
  const visited=new Set(),walking=new Set();function visit(id){assert(!walking.has(id),'Cyclic ordinary proof ancestry');if(visited.has(id))return;const record=ancestry.get(id);assert(record,'Incomplete ordinary proof ancestry');walking.add(id);if(id!==base.sha){assert(record.parents.length>0,'Ordinary proof ancestry escapes base');record.parents.forEach(visit);}walking.delete(id);visited.add(id);}visit(parent.sha);assert(visited.size===ancestry.size,'Unrelated ordinary proof ancestry');same(proof.activation.ancestry,[...ancestry.values()].sort((a,b)=>a.sha.localeCompare(b.sha)),'Unordered ordinary proof ancestry');
  assert(proof.request.activation.reviewed_parent_sha===proof.activation.reviewed_parent.sha&&proof.request.activation.reviewed_parent_tree===proof.activation.reviewed_parent.tree&&proof.request.activation.disabled_request_sha256===proof.activation.reviewed_parent.request_sha256,'Ordinary request/parent proof mismatch');
  closed(proof.trigger,['id','run_attempt','workflow_id','path','head_sha','head_branch','event','created_at','run_started_at','completed_at'],'Ordinary trigger proof keys');assert(positive(proof.trigger.id)&&proof.trigger.run_attempt===1&&proof.trigger.workflow_id===CI_WORKFLOW.id&&proof.trigger.path===CI_WORKFLOW.path&&proof.trigger.head_sha===proof.activation.executing.sha&&proof.trigger.head_branch==='main'&&proof.trigger.event==='push','Invalid ordinary CI proof trigger');
  closed(proof.caller,['run_id','run_attempt','head_sha','workflow_id','path','event','created_at','run_started_at','job_id','job_started_at'],'Ordinary caller proof keys');assert(positive(proof.caller.run_id)&&proof.caller.run_attempt===1&&positive(proof.caller.job_id)&&proof.caller.head_sha===proof.activation.executing.sha&&proof.caller.workflow_id===CI_PUBLISHER.id&&proof.caller.path===CI_PUBLISHER.path&&proof.caller.event==='workflow_run','Invalid ordinary proof caller');
  assert(Array.isArray(proof.checks)&&proof.checks.length===correctionContract.required_ci_jobs.length&&Array.isArray(proof.prior_holds)&&proof.prior_holds.length<=1000,'Incomplete ordinary proof checks');
  assert(new Set(proof.checks.map(c=>c.job_id)).size===proof.checks.length,'Duplicate ordinary CI proof job id');
  for(const name of correctionContract.required_ci_jobs){const found=proof.checks.filter(c=>c.name===name);assert.equal(found.length,1,'Duplicate ordinary CI proof job');const c=found[0];closed(c,['workflow','run_id','run_attempt','job_id','name','head_sha','started_at','completed_at'],'Ordinary CI check fields');assert(c.workflow===CI_WORKFLOW.path&&c.run_id===proof.trigger.id&&c.run_attempt===1&&positive(c.job_id)&&c.head_sha===proof.activation.executing.sha&&ciTime(c.started_at)>=ciTime(proof.trigger.run_started_at)&&ciTime(c.completed_at)>=ciTime(c.started_at)&&ciTime(c.completed_at)<=ciTime(proof.trigger.completed_at),'Invalid ordinary CI check');}
  let priorId=0;for(const hold of proof.prior_holds){closed(hold,['run_id','run_attempt','route_job_id','publish_job_id','marker','trigger'],'Ordinary hold proof keys');assert(positive(hold.run_id)&&hold.run_id>priorId&&hold.run_id<proof.caller.run_id&&hold.run_attempt===1&&positive(hold.route_job_id)&&positive(hold.publish_job_id)&&hold.route_job_id!==hold.publish_job_id&&hold.marker===ciHoldMarker(proof.request_sha256,hold.trigger?.id),'Invalid ordinary hold proof');priorId=hold.run_id;closed(hold.trigger,['id','run_attempt','workflow_id','path','head_sha','head_branch','event','created_at','run_started_at','completed_at'],'Ordinary hold trigger proof keys');assert(positive(hold.trigger.id)&&hold.trigger.run_attempt===1&&positive(hold.trigger.workflow_id)&&gitHash(hold.trigger.head_sha)&&hold.trigger.head_branch==='main'&&ciTime(hold.trigger.created_at)<=ciTime(hold.trigger.run_started_at)&&ciTime(hold.trigger.run_started_at)<=ciTime(hold.trigger.completed_at)&&ciTime(hold.trigger.completed_at)<=ciTime(proof.admitted_at),'Invalid ordinary hold trigger proof');}
  const dates=[proof.trigger.created_at,proof.trigger.run_started_at,proof.trigger.completed_at,proof.caller.created_at,proof.caller.run_started_at,proof.caller.job_started_at,proof.admitted_at];assert(dates.every(iso)&&dates.slice(1).every((d,i)=>ciTime(d)>=ciTime(dates[i])),'Ordinary proof chronology changed');assert(ciTime(proof.caller.created_at)>=ciTime(ORDINARY_CI_IDENTITY.not_before)&&ciTime(proof.admitted_at)<=ciTime(ORDINARY_CI_IDENTITY.admit_before),'Ordinary proof start window changed');assertOrdinaryClock(ciTime(proof.admitted_at),ORDINARY_CI_IDENTITY);assert(Buffer.byteLength(JSON.stringify(proof))<=1024**2,'Ordinary proof exceeds bound');return proof;
}
export async function verifyOrdinaryCiAdmission({root=ordinaryCiControllerRoot(),event,execution=ordinaryCiExecution(),api=ordinaryCiReadApi,now=Date.now(),expected=null}={}){
  ciRejectRuntimeHooks();
  await ciNoConflicts(root);const verified=verifyOrdinaryCiActivation({root,api,now}),payload=ciEvent(event),own=ciCaller(api,execution,verified.activation,now),ci=ciVerifyCi(api,verified.activation.executing.sha,payload,now);
  const all=ciJobs(api,own.id),published=all.filter(j=>j.name==='publish'),routes=all.filter(j=>j.name===CI_ROUTE_JOB);assert(all.length===2&&published.length===1&&routes.length===1&&routes[0].status==='completed'&&routes[0].conclusion==='success','Missing exact ordinary routing/publish jobs');
  const job=published[0];assert(routes[0].head_sha===verified.activation.executing.sha&&ciTime(routes[0].started_at)>=ciTime(own.run_started_at)&&ciTime(routes[0].completed_at)>=ciTime(routes[0].started_at)&&ciTime(routes[0].completed_at)<=ciTime(job.started_at),'Ordinary routing job chronology changed');assert(job.head_sha===verified.activation.executing.sha&&job.status==='in_progress'&&job.conclusion===null&&ciTime(job.started_at)>=ciTime(own.run_started_at)&&ciTime(job.started_at)<=now,'Ordinary publish job is not active');
  const steps=job.steps?.filter(s=>s.name===ORDINARY_CI_ADMISSION_STEP);assert(steps?.length===1,'Ordinary admission step is not unique');const step=steps[0];assert(ciTime(step.started_at)>=ciTime(job.started_at)&&ciTime(step.started_at)<=now,'Ordinary admission step clock changed');
  if(expected)assert(step.status==='completed'&&step.conclusion==='success'&&ciTime(step.completed_at)>=ciTime(step.started_at)&&ciTime(step.completed_at)<=now,'Ordinary admission step did not complete');else assert(step.status==='in_progress'&&step.conclusion===null&&now<=ciTime(ORDINARY_CI_IDENTITY.admit_before),'Ordinary initial admission already finished or expired');
  const proof={schema_version:'ordinary-carry-ci-proof-v1',plan_id:ORDINARY_CI_IDENTITY.amendment_id,identity_sha256:ordinaryCiIdentityDigest(),...verified,...ci,caller:{run_id:own.id,run_attempt:1,head_sha:own.head_sha,workflow_id:own.workflow_id,path:own.path,event:own.event,created_at:own.created_at,run_started_at:own.run_started_at,job_id:job.id,job_started_at:job.started_at},admitted_at:new Date(ciTime(step.started_at)).toISOString(),prior_holds:ciReplay(api,own,verified.activation,verified.request_sha256,now,ci.trigger)};
  validateOrdinaryCiProof(proof);if(expected)same(proof,expected,'Ordinary admission proof changed');assert(ciTime(proof.admitted_at)<=now,'Future ordinary admission');verifiedCiProofs.add(proof);activeCiProofs.set(digest(proof),{proof,verified_at:now});return proof;
}
export async function readVerifiedOrdinaryCiAdmission({root=ordinaryCiControllerRoot(),event,execution=ordinaryCiExecution(),api=ordinaryCiReadApi,now=Date.now()}={}){
  const request=readOrdinaryCiRequest(root);assert(!request||request.value.enabled,'Ordinary request/proof missing or disabled');
  // Legacy callers without this request may not have created their scratch
  // directory yet. Only that absent-request case may have no proof directory;
  // enabled requests and orphaned proof files keep the strict boundary.
  const path=ciProofPath({allowMissing:!request}),raw=path===null?null:ciMaybeRegular(path,1024**2);
  if(!request&&!raw)return null;assert(request?.value.enabled&&raw,'Ordinary request/proof missing or disabled');const proof=validateOrdinaryCiProof(JSON.parse(raw));assert(sha(request.raw)===proof.request_sha256,'Ordinary proof request bytes changed');return verifyOrdinaryCiAdmission({root,event,execution,api,now,expected:proof});
}
export async function ordinaryCiContext(state){
  const event=JSON.parse(regular(process.env.GITHUB_EVENT_PATH,4*1024**2));const proof=await readVerifiedOrdinaryCiAdmission({event});assert(proof,'Missing ordinary CI state');same(state.ordinaryCarryAdmission?.ci_admission,proof,'Ordinary state admission changed');return {controller:{head:proof.activation.executing.sha,tree:proof.activation.executing.tree},caller:{run_id:proof.caller.run_id,run_attempt:1,job_id:proof.caller.job_id,started_at:proof.caller.job_started_at},event:'workflow_run',ui_only:false,now:Date.now(),ci_admission:proof};
}
function ciHistoricalTriggerMatch(actual,recorded){
  same({...actual,completed_at:recorded.completed_at},recorded,'Historical ordinary trigger changed');assert(ciTime(actual.completed_at)>=ciTime(recorded.completed_at),'Historical ordinary trigger completion moved backwards');
}
function verifyOrdinaryCiHistorical(proof,{api=ordinaryCiReadApi,composedAt}={}){
  const now=Date.now(),active=activeCiProofs.get(digest(proof));
  // Only an in-process, fully reauthenticated current composition may precede
  // deployment. Expired records take the permanent historical verifier below.
  if(active&&active.verified_at<=now&&now<=ciTime(ORDINARY_CI_IDENTITY.not_after))return true;
  const activation=verifyOrdinaryCiActivation({api,historical:proof.activation});same(activation.request,proof.request,'Historical ordinary request changed');assert.equal(activation.request_sha256,proof.request_sha256,'Historical ordinary raw request changed');
  const ci=ciVerifyCi(api,proof.activation.executing.sha,proof.trigger,now,{historical:true});same(ci.checks,proof.checks,'Historical ordinary CI jobs changed');ciHistoricalTriggerMatch(ci.trigger,proof.trigger);
  const own=ciExactRun(api,proof.caller.run_id,CI_PUBLISHER,proof.activation.executing.sha,'workflow_run',{historical:true,now});assert(own.status==='completed'&&own.created_at===proof.caller.created_at&&own.run_started_at===proof.caller.run_started_at,'Historical ordinary caller is incomplete');
  const jobs=ciJobs(api,own.id),matches=jobs.filter(j=>j.id===proof.caller.job_id&&j.name==='publish'),routes=jobs.filter(j=>j.name===CI_ROUTE_JOB);assert(jobs.length===2&&routes.length===1&&routes[0].head_sha===proof.caller.head_sha&&routes[0].status==='completed'&&routes[0].conclusion==='success'&&matches.length===1&&matches[0].head_sha===proof.caller.head_sha&&matches[0].started_at===proof.caller.job_started_at&&matches[0].status==='completed','Historical ordinary publish job changed');
  let admittedStep;for(const name of [ORDINARY_CI_ADMISSION_STEP,'Deploy to GitHub Pages']){const steps=matches[0].steps?.filter(s=>s.name===name);assert(steps?.length===1&&steps[0].status==='completed'&&steps[0].conclusion==='success'&&ciTime(steps[0].started_at)>=ciTime(matches[0].started_at)&&ciTime(steps[0].completed_at)>=ciTime(steps[0].started_at)&&ciTime(steps[0].completed_at)<=ciTime(matches[0].completed_at)&&ciTime(matches[0].completed_at)<=ciTime(own.updated_at),'Historical ordinary publication step missing');if(name===ORDINARY_CI_ADMISSION_STEP){admittedStep=steps[0];assert(proof.admitted_at===new Date(ciTime(steps[0].started_at)).toISOString()&&ciTime(proof.admitted_at)<=ciTime(steps[0].completed_at),'Historical ordinary admission clock changed');}else assert(ciTime(steps[0].started_at)>=ciTime(admittedStep.completed_at)&&ciTime(composedAt)>=ciTime(proof.admitted_at)&&ciTime(steps[0].started_at)>=ciTime(composedAt),'Historical deployment predates admission/composition');}
  const inventory=ciInventory(api,`${CI_PREFIX}/actions/workflows/${CI_PUBLISHER.id}/runs?branch=main&head_sha=${proof.activation.executing.sha}&per_page=100`,'workflow_runs',r=>assert(r.workflow_id===CI_PUBLISHER.id&&r.path===CI_PUBLISHER.path&&r.head_sha===proof.activation.executing.sha&&r.head_branch==='main'&&ciSameRepo(r)&&positive(r.run_attempt),'Wrong historical ordinary caller inventory'));
  assert(inventory.some(r=>r.id===own.id),'Historical ordinary caller omitted');const prior=inventory.filter(r=>r.id<own.id).sort((a,b)=>a.id-b.id);same(prior.map(r=>r.id),proof.prior_holds.map(h=>h.run_id),'Historical ordinary prior callers changed');
  for(let i=0;i<prior.length;i++){const actual=ciPriorHold(api,prior[i],proof.activation.executing.sha,proof.request_sha256,now,{historical:true,recordedTrigger:proof.prior_holds[i].trigger,parentCI:proof.trigger}),recorded=proof.prior_holds[i];ciHistoricalTriggerMatch(actual.trigger,recorded.trigger);same({...actual,trigger:recorded.trigger},recorded,'Historical ordinary hold proof changed');}
  return true;
}
function ciRejectRuntimeHooks(){if(process.execArgv.length||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw Error('Ordinary CI rejects runtime hooks');}
async function runOrdinaryCiCommand(){
  ciRejectRuntimeHooks();
  const [command,...extra]=process.argv.slice(2);assert(!extra.length&&['ci-route','ci-prepare-controller','ci-admit'].includes(command),'Unknown ordinary CI command');const event=JSON.parse(regular(process.env.GITHUB_EVENT_PATH,4*1024**2));
  const result=command==='ci-route'?await routeOrdinaryCi({event}):command==='ci-prepare-controller'?prepareOrdinaryCiController():await verifyOrdinaryCiAdmission({event});
  if(command==='ci-admit'){const finished=Date.now();assertOrdinaryClock(finished,ORDINARY_CI_IDENTITY);assert(finished>=ciTime(result.admitted_at)&&finished<=ciTime(ORDINARY_CI_IDENTITY.admit_before),'Ordinary admission finished outside start window');const raw=JSON.stringify(result);assert(Buffer.byteLength(raw)<=1024**2);writeFileSync(ciProofPath(),raw,{flag:'wx',mode:0o600});}
  const output=command==='ci-admit'?{ordinary_ci:true}:result;if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(output).map(([key,value])=>`${key}=${value}\n`).join(''));console.log(JSON.stringify(output));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  // Let the module graph finish before the guarded routes lazily import the
  // receipt readers which import this module. A stalled command fails closed.
  let completed=false;process.once('beforeExit',()=>{if(!completed){console.error('Ordinary CI command did not complete');process.exitCode=1;}});
  runOrdinaryCiCommand().then(()=>{completed=true;},error=>{completed=true;console.error(error.stack||error);process.exitCode=1;});
}
