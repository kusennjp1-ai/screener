import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiniteTransportBudgetController} from './retained-price-finite-transport-controller.mjs';
import {createJobTransportBudget} from './conditional-deployment-jobs-cache.mjs';
import {REQUEST_REPRESENTATION} from './conditional-deployment-jobs-worker.mjs';
import {finiteTransportPolicy,finiteTransportPhase,finiteTransportBudgetPolicy} from './retained-price-finite-transport-policy.mjs';

// Synthetic public metadata only. No transport, token, persisted storage, or
// source/publication authority is exercised. These are the actual controller,
// quota model and closed policy objects; storage persistence is injected.
const NOW=1791572400000,RESET=Math.floor(NOW/1000)+3600;
const clone=value=>JSON.parse(JSON.stringify(value));
const source=finiteTransportPolicy('producer-combine'),publisher=finiteTransportPolicy('publisher');
function context(role='producer-combine'){
  return {repository:'kusennjp1-ai/screener',repository_id:1203919607,run_id:77,run_attempt:1,
    job_id:91,job_name:role==='publisher'?'publish':'combine-and-build',
    job_started_at:new Date(NOW-10000).toISOString(),role,controller_sha:'a'.repeat(40),
    controller_tree:'b'.repeat(40),request_sha256:'c'.repeat(64),event_sha256:'d'.repeat(64),
    schema_version:'conditional-deployment-jobs-cache-context-v1',
    reader_version:'265ede759b1714c882015c696c6fac66975ae03a',representation:REQUEST_REPRESENTATION};
}
const quota=(remaining=5000)=>({limit:5000,used:5000-remaining,remaining,reset_epoch:RESET,resource:'core'});
function memory(ctx){
  let saved=null;const commits=[],loads=[];
  return {context:ctx,commits,loads,
    loadTransportBudget(options){loads.push(clone(options));return clone(saved);},
    commitTransportBudget(value){saved=clone(value);commits.push(clone(value));},
    value(){return clone(saved);}};
}
function fixture(phase=source.phases[0],handle=null){
  const ctx=context(phase.script.includes('source-admission')?'producer-combine':'publisher');
  const clock={wall:NOW,mono:100},scope=Object.fromEntries(['repository','repository_id','run_id','run_attempt','controller_sha'].map(k=>[k,ctx[k]]));
  const c=createFiniteTransportBudgetController({scope,role:ctx.role,candidates:[phase],
    assertBinding(){},now:()=>clock.wall,monotonic:()=>clock.mono});
  const store=handle??memory(ctx);
  function register(deadlineEpochMs=Date.parse(ctx.job_started_at)+100*60*1000-24000){
    const step={name:phase.step,status:'in_progress',conclusion:null,started_at:new Date(clock.wall).toISOString()};
    return c.register({verifiedContext:ctx,verifiedPhase:phase,
      verifiedJob:{id:ctx.job_id,name:ctx.job_name,started_at:ctx.job_started_at,steps:[step]},
      deadlineEpochMs});
  }
  function gh({own=false,remaining=5000,page=null,endpoint=null,observedQuota=false}={}){
    endpoint??=own?'repos/'+ctx.repository+'/actions/runs/'+ctx.run_id:
      'repos/'+ctx.repository+'/actions/runs/78/attempts/1/jobs?per_page=100';
    const receipt=c.beforeGh({endpoint,page},{legacy:page===null});c.enter(receipt);
    c.afterGh(own?{endpoint,status:200,quota:{...quota(remaining),complete:true},
      response_validated:true,retry_after_present:false,error_code:null,command_failed:false,
      started_epoch_ms:clock.wall,ended_epoch_ms:clock.wall}:
      {endpoint,page_validated:true,completed_gh_json:page===null,
        quota:observedQuota?{...quota(remaining),complete:true}:undefined,
        response_validated:false,error_code:null,command_failed:false},receipt);
    return receipt;
  }
  function native(count=32,{observedRemaining=null,kind='admission'}={}){
    const head=kind==='live'?null:ctx.controller_sha;
    const budget=c.nativeBudget(kind),receipt=budget.beforeAcquisition({head,maximumStarts:80,maximumPrimary:160,requiredIds:[ctx.run_id,78]});c.enter(receipt);
    const attempt={page_evidence:Array.from({length:count},(_,i)=>({status:200,page_number:i+1,
      requested_route:'repositories/'+ctx.repository_id+'/actions/runs?per_page=50&page='+(i+1),
      safe_headers:observedRemaining===null?{}:{'x-ratelimit-limit':'5000','x-ratelimit-used':String(5000-observedRemaining),
        'x-ratelimit-remaining':String(observedRemaining),'x-ratelimit-reset':String(RESET)}}))};
    budget.afterAttempt(attempt,receipt);budget.afterAcquisition({status:'complete',head,requiredIds:[ctx.run_id,78],attempts:[attempt]},receipt);
    return receipt;
  }
  function bootstrap(remaining=5000,{live=true,deadlineEpochMs=null}={}){
    for(let i=0;i<8;i++)gh();gh({own:true,remaining});native();
    for(let i=0;i<13;i++)gh();
    assert.equal(c.snapshot().bootstrap_primary,54+(phase.entry_shell_model_primary??0));
    if(deadlineEpochMs===null)register();else register(deadlineEpochMs);
    if(live){gh();gh();native(32,{kind:'live'});}
    return c.snapshot();
  }
  return {c,ctx,clock,phase,handle:store,register,gh,native,bootstrap};
}
function historical(ctx,statuses=[200,200,200],remaining=[5000,5000,5000]){
  const runs=[{id:ctx.run_id,status:'in_progress'},{id:78,status:'completed'},{id:79,status:'completed'}];
  return {runs,result:{status:'complete',jobs:runs.map(r=>({run_id:r.id,pages:[{jobs:[]}]})),
    observations:runs.map((r,i)=>({run_id:r.id,page:1,status:statuses[i],page_validated:true,
      page_revalidated:statuses[i]===304,quota:quota(remaining[i])}))}};
}
function history(f,statuses,remaining){
  const {runs,result}=historical(f.ctx,statuses,remaining),receipt=f.c.beforeHistory();
  f.c.enter(receipt);return f.c.afterHistory(result,runs,receipt);
}
function completeSourcePhase(f){
  f.bootstrap();f.c.openHistory(f.handle,{allowUninitialized:f.phase.ordinal===1});
  let planned=f.phase.history_positions[0].planned_primary_before;
  for(let i=0;i<f.phase.history_positions.length;i++){
    const point=f.phase.history_positions[i];for(let n=planned;n<point.planned_primary_before;n++)f.gh();
    history(f,i===0&&f.phase.ordinal===1?[200,200,200]:[200,304,304]);
    planned=point.planned_primary_before+point.planned_primary;
  }
  for(let n=planned;n<f.phase.planned_primary;n++)f.gh();
  assert.equal(f.c.finish(),true);assert.equal(f.c.snapshot().completed,true);
}
function openedSource(){
  const f=fixture();f.bootstrap();f.c.openHistory(f.handle,{allowUninitialized:true});return f;
}
function openedModel(){
  const ctx=context(),phase=source.phases[0];
  const model=createJobTransportBudget({context:ctx,policy:finiteTransportBudgetPolicy(ctx),
    initialQuota:quota(),quotaBoundary:{route:'repos/'+ctx.repository+'/actions/runs/'+ctx.run_id,
      status:200,backoff:false,request_started_at_epoch_ms:NOW,response_received_at_epoch_ms:NOW,completed_at_epoch_ms:NOW},
    verifiedBootstrapPhase:{id:phase.id,command:phase.command,job_step:phase.step,ordinal:phase.ordinal},
    bootstrapPrimary:88,bootstrapStarts:88,bootstrapSinceSamplePrimary:0,bootstrapPlannedPrimary:88,
    now:()=>NOW,persist(){}});
  model.begin({id:phase.id,command:phase.command,job_step:phase.step,ordinal:phase.ordinal});return model;
}
test('literal source produce binding admits only its B88 prospective4937 scope',()=>{
  const literal={role:'producer-combine',job:'combine-and-build',step:'Build static frontend',
    script:'.github/scripts/retained-price-source-admission.mjs',command:'produce',ordinal:1,
    cli_argv:['produce','--output','fixture-output','--job-start','fixture-clock']};
  assert.equal(finiteTransportPhase(literal),source.phases[0]);
  const f=fixture();const b=f.bootstrap();
  assert.equal(b.bootstrap_primary,88);assert.equal(b.bootstrap_logical_starts,88);
  assert.equal(f.handle.loads.length,0);assert.equal(f.handle.commits.length,0);
  assert.equal(f.c.openHistory(f.handle,{allowUninitialized:true}),true);
  const state=f.c.snapshot().state;assert.equal(state.original_primary_limit,4937);
  assert.equal(state.spent_primary,88);assert.equal(state.pending_phase.id,'produce');
  const r=f.c.beforeHistory();assert.equal(r.maximumPrimary,400);assert.equal(r.maximumStarts,200);
  assert.equal(r.plannedPrimary,192);assert.equal(4937-state.spent_primary,4849);
  f.c.fail();assert.equal(f.c.snapshot().completed,false);
});
test('raw4920 with45 since caller sample rejects B54 cheaply',()=>{
  const f=fixture();f.bootstrap(4920,{live:false});
  assert.equal(f.c.snapshot().bootstrap_primary,54);
  assert.throws(()=>f.c.openHistory(f.handle,{allowUninitialized:true}),/transport-budget-bootstrap-allowance/);
  assert.equal(f.handle.commits.length,0);assert.equal(f.c.snapshot().opened,false);
  assert.equal(f.c.snapshot().failed,true);assert.equal(f.c.snapshot().history_ordinal,0);
});
test('one shared ordinary48 pool permits45 then3 and rejects fourth before entry',()=>{
  const f=fixture(publisher.phases[0]);let entered=0;
  function page(endpoint,page){const r=f.c.beforeGh({endpoint,page});f.c.enter(r);entered++;
    f.c.afterGh({page_validated:true,error_code:null,command_failed:false},r);}
  for(let catalogue=0;catalogue<5;catalogue++)for(let pageNumber=2;pageNumber<=10;pageNumber++)
    page('repos/kusennjp1-ai/screener/actions/runs/'+(80+catalogue)+'/attempts/1/jobs?per_page=100',pageNumber);
  assert.equal(entered,45);assert.equal(f.c.snapshot().bootstrap_ordinary_extra_upper,45);
  f.register();assert.equal(f.c.snapshot().registered,true);
  assert.equal(f.c.snapshot().bootstrap_ordinary_extra_upper,45);
  for(let pageNumber=2;pageNumber<=4;pageNumber++)page('repos/kusennjp1-ai/screener/actions/workflows/ci.yml/runs?per_page=100',pageNumber);
  assert.equal(entered,48);assert.equal(f.c.snapshot().bootstrap_ordinary_extra_upper,48);
  assert.throws(()=>page('repos/kusennjp1-ai/screener/actions/workflows/ci.yml/runs?per_page=100',5),/bootstrap-ordinary-extra-cap/);
  assert.equal(entered,48);assert.equal(f.c.snapshot().bootstrap_primary,48);
  assert.equal(f.handle.commits.length,0);assert.equal(f.c.snapshot().failed,true);
});
test('source phases reopen model and companion shell1 precedes required anchor',()=>{
  const first=fixture();completeSourcePhase(first);
  const second=fixture(source.phases[1],first.handle);second.clock.wall+=1000;completeSourcePhase(second);
  const third=fixture(source.phases[2],first.handle);third.clock.wall+=2000;
  assert.equal(third.c.snapshot().shell_model_primary,1);assert.equal(third.c.snapshot().bootstrap_primary,1);
  third.bootstrap();assert.equal(third.c.snapshot().bootstrap_primary,89);
  // Shell is before the own sample: sample primary10, total89, since79.
  assert.equal(third.c.openHistory(third.handle),true);
  const s=third.c.snapshot().state;assert.equal(s.bootstrap_primary_debit,88+88+89);
  assert.equal(s.current_window.credit,s.original_primary_limit-s.spent_primary);
  assert.equal(s.pending_phase.id,'companion');assert.equal(s.completed_step_model_primary,0);
  assert.equal(source.phases[2].planned_primary,153);third.c.fail();
});
test('monotonic and wall-clock rollback cannot extend the captured deadline',()=>{
  const f=fixture();f.register();const initial=f.c.remainingMs(10000000);
  f.clock.wall-=500;f.clock.mono+=100;
  assert.equal(f.c.remainingMs(10000000),initial-100);
  f.clock.mono-=1;assert.throws(()=>f.c.remainingMs(120000),/invalid-controller-clock/);
  assert.throws(()=>f.c.beforeGh({endpoint:'repos/kusennjp1-ai/screener'}),/invalid-controller-clock/);
  assert.equal(f.c.snapshot().failed,true);
});
test('no registration no open missing anchor or missing history cannot finish',()=>{
  const a=fixture();assert.throws(()=>a.c.finish(),/incomplete-history-sequence/);
  const b=fixture();b.register();assert.throws(()=>b.c.finish(),/incomplete-history-sequence/);
  const c=fixture();c.register();assert.throws(()=>c.c.openHistory(c.handle,{allowUninitialized:true}),/missing-required-quota-evidence/);
  assert.equal(c.handle.loads.length,0);
  const d=openedSource();assert.throws(()=>d.c.finish(),/incomplete-history-sequence/);
  assert.equal(d.handle.value().last_completed_phase,-1);
  assert.equal(d.handle.value().pending_phase.id,'produce');assert.equal(d.c.snapshot().completed,false);
});
test('native pre-entry stop charges no issued work and cannot advance',()=>{
  const f=fixture(),budget=f.c.nativeBudget(),r=budget.beforeAcquisition({head:f.ctx.controller_sha,maximumStarts:80,maximumPrimary:160,requiredIds:[f.ctx.run_id,78]});
  assert.throws(()=>budget.afterAcquisition({status:'failed',head:f.ctx.controller_sha,requiredIds:[f.ctx.run_id,78],attempts:[]},r),/native-operation-not-issued/);
  assert.equal(f.c.snapshot().bootstrap_primary,0);assert.equal(f.c.snapshot().bootstrap_logical_starts,0);
  assert.equal(f.c.snapshot().history_ordinal,0);assert.equal(f.c.snapshot().failed,true);
});
test('unknown first native attempt followed by retry remains terminal',()=>{
  const f=openedSource(),budget=f.c.nativeBudget(),r=budget.beforeAcquisition({head:f.ctx.controller_sha,maximumStarts:80,maximumPrimary:160,requiredIds:[f.ctx.run_id,78]});
  f.c.enter(r);
  const unknown={page_evidence:[{status:null,page_number:1,requested_route:'repositories/1203919607/actions/runs?per_page=50&page=1'}]};
  const retry={page_evidence:[{status:200,page_number:1,requested_route:'repositories/1203919607/actions/runs?per_page=50&page=1'}]};
  budget.afterAttempt(unknown,r);budget.afterAttempt(retry,r);
  assert.throws(()=>budget.afterAcquisition({status:'complete',head:f.ctx.controller_sha,requiredIds:[f.ctx.run_id,78],attempts:[unknown,retry]},r),/unknown-native-issued-work/);
  const s=f.c.snapshot();assert.equal(s.failed,true);assert.equal(s.history_ordinal,0);
  assert.equal(s.state.unknown_issued,80);assert.equal(s.state.spent_primary,88+160);
  assert.equal(s.state.last_completed_phase,-1);
  assert.throws(()=>f.c.beforeHistory(),/terminal-controller/);
});
test('validated three-serial200 history preserves its final1000 sample',()=>{
  const f=openedSource();history(f,[200,200,200],[1200,1100,1000]);
  const s=f.c.snapshot();assert.equal(s.history_ordinal,1);assert.equal(s.state.current_window.credit,1000);
  assert.equal(s.state.current_window.minimum_remaining_header,1000);assert.equal(s.state.known_200,3);
});
test('earlier lower history quota retains later paid debt behind a higher sample',()=>{
  const f=openedSource();history(f,[200,200,200],[800,900,1500]);
  const s=f.c.snapshot().state;assert.equal(s.current_window.minimum_remaining_header,800);
  assert.equal(s.current_window.credit,798);assert.equal(f.c.snapshot().history_ordinal,1);
  assert.throws(()=>f.c.beforeHistory(),/remaining-path-allowance/);
  assert.equal(f.c.snapshot().completed,false);
});
test('serial final304 keeps final1000 while generic batch preserves own debt',()=>{
  for(const [serialQuota,expected]of [[true,1000],[false,998]]){
    const model=openedModel(),r=model.reserve({maximumPrimary:400,maximumStarts:200,plannedPrimary:192});
    model.settle(r,{known200:2,validated304:1,quota:quota(1000),sampleStatus:304,
      sampleOwn200:0,operationComplete:true,serialQuota});
    assert.equal(model.snapshot().current_window.credit,expected);
  }
});
test('controller warm final304 does not double-debit its preceding serial200',()=>{
  const f=openedSource();history(f,[200,200,200],[5000,5000,5000]);
  for(let n=0;n<45;n++)f.gh();
  history(f,[200,304,304],[1500,1400,1000]);
  const s=f.c.snapshot().state;assert.equal(s.current_window.credit,1000);
  assert.equal(s.known_200,4);assert.equal(s.validated_304,2);
});
test('serial settlement retains paid debt from another outstanding reservation',()=>{
  const model=openedModel(),other=model.reserve({maximumPrimary:1,maximumStarts:1,plannedPrimary:1}),
    serial=model.reserve({maximumPrimary:400,maximumStarts:200,plannedPrimary:192});
  model.settle(other,{known200:1,operationComplete:true});
  model.settle(serial,{known200:2,validated304:1,quota:quota(1000),sampleStatus:304,
    sampleOwn200:0,operationComplete:true,serialQuota:true});
  assert.equal(model.snapshot().current_window.credit,999);
});

test('an incomplete cohort leaves the issued history reservation unknown',()=>{
  const f=openedSource(),r=f.c.beforeHistory();f.c.enter(r);
  const {result,runs}=historical(f.ctx);result.jobs.pop();
  assert.throws(()=>f.c.afterHistory(result,runs,r),/incomplete-history-operation/);
  const s=f.c.snapshot();assert.equal(s.history_ordinal,0);assert.equal(s.failed,true);
  assert.equal(s.state.unknown_issued,200);assert.equal(s.state.spent_primary,88+400);
  assert.equal(f.handle.value().last_completed_phase,-1);
  assert.throws(()=>f.c.finish(),/terminal-controller/);
});

test('final34-page native projection rejects after preserving all actual debits',()=>{
  const f=openedSource();assert.throws(()=>f.native(34),/finite-snapshot-page-cap/);
  const s=f.c.snapshot();assert.equal(s.failed,true);assert.equal(s.history_ordinal,0);
  assert.equal(s.state.known_200,34);assert.equal(s.state.logical_issued,88+34);
  assert.equal(s.state.spent_primary,88+34);assert.equal(s.state.extra_primary_used.native_extra,2);
  assert.equal(s.state.unknown_issued,0);assert.equal(s.completed,false);
  assert.throws(()=>f.c.beforeHistory(),/terminal-controller/);
});
test('live nullhead descriptor retains the same closed requiredId receipt',()=>{
  const f=fixture(),budget=f.c.nativeBudget('live'),r=budget.beforeAcquisition({head:null,requiredIds:[77,78],maximumStarts:80,maximumPrimary:160});
  assert.equal(f.c.currentNativeReceipt(),r);assert.equal(r.maximumPrimary,160);assert.equal(r.maximumStarts,80);
  f.c.enter(r);const a={page_evidence:Array.from({length:32},(_,i)=>({status:200,page_number:i+1,
    requested_route:'repositories/1203919607/actions/runs?per_page=50&page='+(i+1),safe_headers:{}}))};
  budget.afterAttempt(a,r);budget.afterAcquisition({status:'complete',head:null,requiredIds:[77,78],attempts:[a]},r);
  assert.equal(f.c.snapshot().bootstrap_primary,32);assert.equal(f.c.snapshot().bootstrap_logical_starts,32);
  for(const requiredIds of [[],[77,77],[0],[null]]){
    const g=fixture();assert.throws(()=>g.c.nativeBudget('live').beforeAcquisition({head:null,requiredIds,maximumStarts:80,maximumPrimary:160}),/foreign-native-acquisition/);
    assert.equal(g.c.snapshot().bootstrap_primary,0);
  }
});
test('result processing past captured deadline keeps settled facts and stops every kind',()=>{
  for(const kind of ['gh','native','history']){
    const f=fixture();f.bootstrap(5000,{deadlineEpochMs:NOW+10});f.c.openHistory(f.handle,{allowUninitialized:true});
    let crossed=false;const cross=()=>{if(!crossed){crossed=true;f.clock.wall+=11;f.clock.mono+=11;}};
    if(kind==='gh'){
      const r=f.c.beforeGh({endpoint:'repos/kusennjp1-ai/screener/actions/runs/78/attempts/1/jobs?per_page=100',page:1});f.c.enter(r);
      const facts={command_failed:false,completed_gh_json:true,get error_code(){cross();return null;}};
      assert.throws(()=>f.c.afterGh(facts,r),/phase-deadline/);
      assert.equal(f.c.snapshot().state.completed_gh_json,1);
    }else if(kind==='native'){
      const budget=f.c.nativeBudget(),r=budget.beforeAcquisition({head:f.ctx.controller_sha,requiredIds:[77,78],maximumStarts:80,maximumPrimary:160});f.c.enter(r);
      const a={page_evidence:Array.from({length:32},(_,i)=>({status:200,page_number:i+1,
        requested_route:'repositories/1203919607/actions/runs?per_page=50&page='+(i+1),safe_headers:{}}))};
      budget.afterAttempt(a,r);
      const facts={status:'complete',head:f.ctx.controller_sha,requiredIds:[77,78],get attempts(){cross();return [a];}};
      assert.throws(()=>budget.afterAcquisition(facts,r),/phase-deadline/);
      assert.equal(f.c.snapshot().state.known_200,32);
    }else{
      const r=f.c.beforeHistory();f.c.enter(r);const {result,runs}=historical(f.ctx);
      Object.defineProperty(result,'status',{get(){cross();return 'complete';}});
      assert.throws(()=>f.c.afterHistory(result,runs,r),/phase-deadline/);
      assert.equal(f.c.snapshot().state.known_200,3);
    }
    const state=f.c.snapshot();assert.equal(crossed,true);assert.equal(state.failed,true);
    assert.equal(state.completed,false);assert.equal(state.state.unknown_issued,0);
    assert.equal(f.handle.value().last_completed_phase,-1);
    assert.throws(()=>f.c.finish(),/terminal-controller/);
  }
});

test('paired bootstrap minimum retains prior own pager and native paid-start debt',()=>{
  for(const kind of ['own','pager','native']){
    const f=fixture();
    if(kind==='pager'){f.gh({page:1,remaining:4900,observedQuota:true});for(let i=0;i<7;i++)f.gh();}
    else for(let i=0;i<8;i++)f.gh();
    f.gh({own:true,remaining:kind==='own'?4900:5000});
    f.native(32,{observedRemaining:kind==='native'?4900:null});
    for(let i=0;i<12;i++)f.gh();
    f.gh({own:true,remaining:5000,endpoint:'repos/kusennjp1-ai/screener/actions/runs/77/attempts/1'});
    f.register();f.gh();f.gh();f.native(32,{kind:'live'});
    assert.equal(f.c.snapshot().bootstrap_primary,88);
    // A raw4900 minimum minus only34 after the high final own sample would
    // admit4866 against4849. The paired earlier paid debt must reject it.
    assert.equal(4900-34,4866);assert.ok(4866>=4937-88);
    assert.throws(()=>f.c.openHistory(f.handle,{allowUninitialized:true}),/transport-budget-bootstrap-allowance/);
    assert.equal(f.c.snapshot().failed,true);assert.equal(f.c.snapshot().opened,false);
    assert.equal(f.handle.commits.length,0);assert.equal(f.c.snapshot().history_ordinal,0);
  }
});

test('native kind and completed receipt identity stay bound after command entry',()=>{
  const a=fixture();
  assert.throws(()=>a.c.nativeBudget('live').beforeAcquisition({head:a.ctx.controller_sha,requiredIds:[77,78],maximumStarts:80,maximumPrimary:160}),/foreign-native-acquisition/);
  assert.throws(()=>a.c.nativeBudget('admission').beforeAcquisition({head:null,requiredIds:[77,78],maximumStarts:80,maximumPrimary:160}),/foreign-native-acquisition/);
  const f=openedSource(),budget=f.c.nativeBudget('live'),r=budget.beforeAcquisition({head:null,requiredIds:[77,78],maximumStarts:80,maximumPrimary:160});
  assert.equal(r.acquisitionKind,'live');assert.equal(r.head,null);assert.deepEqual(r.requiredIds,[77,78]);
  f.c.enter(r);const attempt={page_evidence:[{status:200,page_number:1,
    requested_route:'repositories/1203919607/actions/runs?per_page=50&page=1',safe_headers:{}}]};
  budget.afterAttempt(attempt,r);
  assert.throws(()=>budget.afterAcquisition({status:'complete',head:null,requiredIds:[77,79],attempts:[attempt]},r),/native-receipt-binding-disagreement/);
  const state=f.c.snapshot();assert.equal(state.failed,true);assert.equal(state.history_ordinal,0);
  assert.equal(state.state.unknown_issued,80);assert.equal(state.state.spent_primary,88+160);
});

function actualDecreasingPrefix(f,{firstAttemptPages=0}={}){
  let remaining=4950,starts=0;
  const gh=own=>{remaining--;starts++;f.gh({own,remaining});};
  function acquisition(kind,counts){
    const head=kind==='live'?null:f.ctx.controller_sha,budget=f.c.nativeBudget(kind);
    const r=budget.beforeAcquisition({head,requiredIds:[77,78],maximumStarts:80,maximumPrimary:160});f.c.enter(r);
    const attempts=[];
    for(const count of counts){
      const a={page_evidence:Array.from({length:count},(_,i)=>{remaining--;starts++;return {
        status:200,page_number:i+1,requested_route:'repositories/1203919607/actions/runs?per_page=50&page='+(i+1),
        safe_headers:{'x-ratelimit-limit':'5000','x-ratelimit-used':String(5000-remaining),
          'x-ratelimit-remaining':String(remaining),'x-ratelimit-reset':String(RESET)}};})};
      budget.afterAttempt(a,r);attempts.push(a);
    }
    budget.afterAcquisition({status:'complete',head,requiredIds:[77,78],attempts},r);
  }
  for(let i=0;i<8;i++)gh(false);gh(true);
  acquisition('admission',firstAttemptPages?[firstAttemptPages,32]:[32]);
  for(let i=0;i<13;i++)gh(false);f.register();gh(false);gh(false);acquisition('live',[32]);
  return {remaining,starts};
}
test('normal B88 monotonic native headers retain funded source headroom with fifty outside calls',()=>{
  const f=fixture(),actual=actualDecreasingPrefix(f);
  assert.deepEqual(actual,{remaining:4862,starts:88});
  assert.equal(f.c.snapshot().bootstrap_primary,88);
  assert.equal(f.c.openHistory(f.handle,{allowUninitialized:true}),true);
  const state=f.c.snapshot().state;
  assert.equal(state.spent_primary,88);assert.equal(state.original_primary_limit-state.spent_primary,4849);
  assert.equal(state.current_window.credit,4860);assert.equal(Math.min(state.current_window.credit,state.original_primary_limit-state.spent_primary),4849);f.c.fail();
});
test('native retry attempt debt includes later starts once and never recharges a completed prior attempt',()=>{
  const f=fixture(),actual=actualDecreasingPrefix(f,{firstAttemptPages:3});
  assert.deepEqual(actual,{remaining:4859,starts:91});
  assert.equal(f.c.snapshot().bootstrap_primary,91);
  assert.equal(f.c.openHistory(f.handle,{allowUninitialized:true}),true);
  const state=f.c.snapshot().state;assert.equal(state.spent_primary,91);
  assert.equal(state.original_primary_limit-state.spent_primary,4846);
  assert.equal(state.current_window.credit,4857);assert.equal(Math.min(state.current_window.credit,state.original_primary_limit-state.spent_primary),4846);f.c.fail();
});
