import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyScopedReplay,verifyMutationInventory,verifyFullRowMutation,verifyUnknownRow,verifyCurrentRows,retainedPatchSource,verifyRetainedChart,requireRenewedFinancialBinding,inventory,binding,contract} from './oct6-retained-price-rehearsal.mjs';
import {checkedExport} from './select-release-source.mjs';

const target='2026-10-06';
const unknown=()=>({symbol:'OLD',as_of_date:target,current_price:null,price_change_1d:null,adv_usd:null,volume:null,rs_rating:null,se_pivot_price:null,vcp_pivot:null,se_setup_ready:false,vcp_ready_for_breakout:false,technical_audit:{valid:false}});
const scoped=()=>({archive:{path:'/old/archive.zip',bytes:12,sha256:'a'.repeat(64)},fullSiteVerified:false,request:['static-data/a.json'],files:{'static-data/a.json':{decodedBytes:1,decodedSha256:'b'.repeat(64)}}});

test('fresh extraction can relocate originals, but cannot alter any content or scope evidence',()=>{
  const old=scoped(),fresh=structuredClone(old);fresh.archive.path='/new/immutable.zip';assert(verifyScopedReplay(fresh,old));
  for(const mutate of [v=>v.files['static-data/a.json'].decodedSha256='c'.repeat(64),v=>v.archive.bytes++,v=>v.request.push('static-data/extra.json'),v=>v.fullSiteVerified=true]){
    const changed=structuredClone(fresh);mutate(changed);assert.throws(()=>verifyScopedReplay(changed,old));
  }
});
test('complete mutation inventory rejects extra, lost, replayed, and missing graph edits',()=>{
  const old={a:binding(Buffer.from('a')),b:binding(Buffer.from('b'))},after={a:binding(Buffer.from('A')),b:old.b,c:binding(Buffer.from('c'))};
  const receipt={mutations:[{path:'a',before_sha256:old.a.sha256,after_sha256:after.a.sha256,bytes:1},{path:'c',before_sha256:null,after_sha256:after.c.sha256,bytes:1}]};
  assert(verifyMutationInventory(old,after,receipt));
  for(const value of [{...after,b:binding(Buffer.from('B'))},{a:after.a,c:after.c},{...after,x:old.b},{...after,a:old.a}])assert.throws(()=>verifyMutationInventory(old,value,receipt));
  assert.throws(()=>verifyMutationInventory(old,after,{mutations:[...receipt.mutations,{path:'missing',before_sha256:null,after_sha256:'a',bytes:0}]}));
});
test('every full source row preserves financial fields including presence and clocks',()=>{
  const before=[{symbol:'A',sha256:'a',financial_sha256:'f1'},{symbol:'B',sha256:'b',financial_sha256:'f2'}];
  const after=[{...before[0],sha256:'A'},before[1]];
  assert.deepEqual(verifyFullRowMutation(before,after,new Set(['A'])),{rows:2,changed:1,unchanged:1,financial_projections:'equal'});
  for(const changed of [[{...after[0],financial_sha256:'changed'},after[1]],[after[0],{...after[1],sha256:'changed'}],[after[0],after[0]],[after[0]],[before[0],before[1]]])assert.throws(()=>verifyFullRowMutation(before,changed,new Set(['A'])));
});
test('unknown current price, technicals, and readiness are independently enforced',()=>{
  verifyUnknownRow(unknown(),target);
  for(const [key,value] of [['current_price',15],['adv_usd',30000000],['rs_rating',99],['vcp_pivot',15],['se_setup_ready',true],['vcp_ready_for_breakout',true],['technical_audit',{valid:true}],['as_of_date','2026-10-05']]){
    assert.throws(()=>verifyUnknownRow({...unknown(),[key]:value},target));
  }
  const compact=unknown();delete compact.volume;
  verifyUnknownRow(compact,target,{compact:true});
  assert.throws(()=>verifyUnknownRow(compact,target));
  assert.throws(()=>verifyUnknownRow({...compact,volume:1000},target,{compact:true}));
});
test('full-universe finite prices need actual target observations, even outside retained cohort',()=>{
  const fresh={symbol:'NEW',current_price:20},old=unknown(),observations={'["US","chart","NEW"]':target};
  assert(verifyCurrentRows([fresh,old],observations,new Set(['OLD']),target));
  for(const map of [{},{'["US","chart","NEW"]':'2026-10-05'}])assert.throws(()=>verifyCurrentRows([fresh,old],map,new Set(['OLD']),target));
  assert.throws(()=>verifyCurrentRows([fresh],observations,new Set(['OLD']),target));
  assert.throws(()=>verifyCurrentRows([fresh,fresh,old],observations,new Set(['OLD']),target));
});
test('retained chart check binds literal bars, original capture and original observation date',()=>{
  const original={bars:[{date:'2026-10-02',close:10}],as_of_date:'2026-10-02',generated_at:'2026-10-03T00:00:00Z'};
  const patch={symbol:'OLD',snapshot:{schema_version:'retained-price-snapshot-v1',publication_authority:false,actual_observation_date:'2026-10-02',prior_chart:original}};
  const chart={...original,as_of_date:target,stock_data:unknown(),retained_price_history:{observation_date:'2026-10-02',original_as_of_date:'2026-10-02'}};
  verifyRetainedChart(chart,patch,target);
  for(const mutate of [v=>v.bars[0].close=11,v=>v.bars[0].date=target,v=>v.generated_at='2026-10-07T00:00:00Z',v=>v.retained_price_history.observation_date=target,v=>v.stock_data.current_price=10]){
    const changed=structuredClone(chart);mutate(changed);assert.throws(()=>verifyRetainedChart(changed,patch,target));
  }
});
test('candidate stale-history family requires both exact observation fields and its original candidate chart',()=>{
  const original={bars:[{date:'2026-09-04',close:10}],as_of_date:target,generated_at:'2026-10-07T00:00:00Z'};
  const patch={symbol:'OLD',history_origin:'candidate_current_quarantine',observation_date:'2026-09-04',snapshot:{schema_version:'retained-price-residual-snapshot-v1',publication_authority:false,actual_observation_date:'2026-09-04',original_candidate_chart:original}};
  const chart={...original,stock_data:unknown(),retained_price_history:{observation_date:'2026-09-04',original_as_of_date:target}};
  verifyRetainedChart(chart,patch,target);
  for(const mutate of [p=>delete p.observation_date,p=>delete p.snapshot.actual_observation_date,p=>p.observation_date='2026-09-03',p=>p.snapshot.actual_observation_date='2026-09-03',p=>p.snapshot.prior_chart=original,p=>p.history_origin='invented',p=>delete p.history_origin,p=>p.snapshot.schema_version='retained-price-snapshot-v1',p=>delete p.snapshot.original_candidate_chart]){
    const changed=structuredClone(patch);mutate(changed);assert.throws(()=>verifyRetainedChart(chart,changed,target));
  }
  assert.throws(()=>verifyRetainedChart({...chart,retained_price_history:{...chart.retained_price_history,observation_date:'2026-09-03'}},patch,target),/observation date changed/);
});
test('prior-history family rejects absent, invalid or conflicting date fields and crossed source shapes',()=>{
  const patch={symbol:'OLD',snapshot:{schema_version:'retained-price-snapshot-v1',publication_authority:false,actual_observation_date:'2026-09-04',prior_chart:{}}};
  assert.equal(retainedPatchSource(patch,target).observed,'2026-09-04');
  for(const mutate of [p=>delete p.snapshot.actual_observation_date,p=>p.snapshot.actual_observation_date=null,p=>p.snapshot.actual_observation_date='2026-02-30',p=>p.snapshot.actual_observation_date=target,p=>p.snapshot.actual_observation_date='2026-12-01',p=>p.observation_date='2026-09-04',p=>p.observation_date='2026-09-03',p=>p.snapshot.original_candidate_chart={},p=>p.history_origin=undefined,p=>p.snapshot.schema_version='retained-price-residual-snapshot-v1',p=>p.snapshot.publication_authority=true,p=>delete p.snapshot.prior_chart]){
    const changed=structuredClone(patch);mutate(changed);assert.throws(()=>retainedPatchSource(changed,target));
  }
});
test('checkpoint inventory rejects linked files or directories',()=>{
  const root=mkdtempSync(join(tmpdir(),'oct6-inventory-'));
  try {mkdirSync(join(root,'site'));writeFileSync(join(root,'site/a.json'),'{}');assert.equal(Object.keys(inventory(join(root,'site'))).length,1);
    symlinkSync(join(root,'site/a.json'),join(root,'site/link.json'));assert.throws(()=>inventory(join(root,'site')),/Linked/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('historical and synthetic financial predecessors never enable future carry',()=>{
  assert.equal(contract.future_financial_binding,null);
  for(const value of [null,{run_id:37456692717,verified:true},{renewed:true,synthetic:true},{identity:'new',verified:true}])assert.throws(()=>requireRenewedFinancialBinding(value),/actual renewed public predecessor/);
});
test('unchanged ordinary source admission rejects diagnostic artifacts and renamed diagnostic origins',()=>{
  const id=80000000000,repo='kusennjp1-ai/screener';
  const forbidden=()=>{throw Error('Diagnostic namespace must not reach ordinary source retrieval');};
  for(const name of [`oct6-retained-price-reports-${id}-1`,`oct6-retained-price-precarry-${id}-1`]){
    assert.equal(checkedExport({name,workflow_run:{id}},[],repo,forbidden,forbidden),null);
  }
  const run={id,run_attempt:1,repository:{full_name:repo},head_repository:{full_name:repo},head_branch:'preview/oct6-retained-price-rehearsal',path:'.github/workflows/oct6-retained-price-rehearsal.yml',event:'push',status:'completed',conclusion:'success',offline_recovery_verified:true};
  assert.equal(checkedExport({name:`static-site-data-${id}-1`,workflow_run:{id}},[],repo,()=>run,forbidden),null);
});
test('all stage-two proof claims remain false and workflow is diagnostic-only',()=>{
  const workflow=readFileSync(new URL('../workflows/oct6-retained-price-rehearsal.yml',import.meta.url),'utf8');
  assert.match(workflow,/contents: read/);assert.match(workflow,/actions: read/);assert.match(workflow,/persist-credentials: false/);
  for(const denied of ['workflow_dispatch:','pages: write','id-token: write','deploy-pages','FINANCIAL_GENERATION_CARRY_PROJECTION','SEC_USER_AGENT','secrets.'])assert(!workflow.includes(denied),denied);
  assert.match(workflow,/unshare --net/);assert.match(workflow,/oct6-retained-price-precarry-/);
});
