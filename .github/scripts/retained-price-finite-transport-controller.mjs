// Private finite transport accounting. This module grants no source or publication authority.
// The source graph supplies fresh registration, complete validated observations,
// and a cache handle owned by the existing invocation. Wire requests stay unknown.
import {createJobTransportBudget} from './conditional-deployment-jobs-cache.mjs';
import {finiteTransportPolicy,finiteTransportBudgetPolicy,FINITE_TRANSPORT_CAPACITY as L} from './retained-price-finite-transport-policy.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const canonical=v=>JSON.stringify(v,(_k,x)=>object(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const copy=v=>JSON.parse(JSON.stringify(v));
const extras=()=>({native_extra:0,ordinary_extra:0,terminal_miss:0});
const sum=v=>v.native_extra+v.ordinary_extra+v.terminal_miss;
const fault=reason=>Object.assign(Error('Finite transport budget rejected: '+reason),{transportBudgetReason:reason});
const check=(v,reason)=>{if(!v)throw fault(reason);};
function completeQuota(q,resource=q?.resource){
  check(object(q),'missing-route-quota');
  const value={limit:q.limit,used:q.used,remaining:q.remaining,reset_epoch:q.reset_epoch??q.reset,resource};
  check(integer(value.limit)&&value.limit>0&&integer(value.used)&&integer(value.remaining)&&
    value.used+value.remaining===value.limit&&integer(value.reset_epoch)&&value.reset_epoch>0,'invalid-route-quota');
  return value;
}
function nativeQuota(page){
  const h=page?.safe_headers;
  if(!object(h))return null;
  const names=['limit','used','remaining','reset'],v={};
  for(const k of names){const raw=h['x-ratelimit-'+k];if(typeof raw!=='string'||!/^\d{1,15}$/.test(raw))return null;v[k]=Number(raw);}
  try{return completeQuota(v,null);}catch{return null;}
}
export function createFiniteTransportBudgetController({scope,role,candidates,assertBinding,now=Date.now,monotonic=()=>performance.now()}){
  const plan=finiteTransportPolicy(role);
  check(plan&&Array.isArray(candidates)&&candidates.length>0&&candidates.every(p=>plan.phases.includes(p))&&
    typeof assertBinding==='function'&&typeof now==='function'&&typeof monotonic==='function','invalid-controller');
  const bootMaximum=Math.max(...candidates.map(p=>p.bootstrap_maximum_primary));
  const bootStarts=Math.max(...candidates.map(p=>p.bootstrap_maximum_starts));
  const poolMaximum=plan.extra_primary.ordinary_extra;
  let phase=null,context=null,job=null,deadline=null,monotonicDeadline=null,model=null,cache=null,failed=false,completed=false;
  let lastMonotonic=-1;
  const sampleMonotonic=()=>{const value=monotonic();check(Number.isFinite(value)&&value>=lastMonotonic&&value>=0,'invalid-controller-clock');lastMonotonic=value;return value;};
  let historyOrdinal=0,plannedCursor=0,issuedUpper=0,startsUpper=0,ordinaryExtraUpper=0;
  const shellValues=new Set(candidates.map(p=>p.entry_shell_model_primary??0));
  check(shellValues.size===1,'ambiguous-shell-prefix');
  const shellPrimary=[...shellValues][0];check(shellPrimary===0||shellPrimary===1&&candidates.every(p=>p.id==='companion'),'unreviewed-shell-prefix');
  let bootstrapPrimary=shellPrimary,bootstrapStarts=shellPrimary;
  issuedUpper=shellPrimary;startsUpper=shellPrimary;
  const bootstrapExtra=extras(),receipts=new Map(),observations=[],lowerNative=[];
  let anchor=null,nextId=1;
  const assertAlive=()=>{
    check(!failed&&!completed,'terminal-controller');check(assertBinding()!==false,'private-invocation-binding-changed');
    check(integer(now()),'invalid-controller-clock');const mono=sampleMonotonic();
    if(deadline!==null)check(now()<deadline&&mono<monotonicDeadline,'phase-deadline');
  };
  const remaining=ceiling=>{
    assertAlive();const n=deadline===null?ceiling:Math.floor(Math.min(deadline-now(),monotonicDeadline-sampleMonotonic()));
    check(integer(n)&&n>0,'phase-deadline');return Math.min(ceiling,n);
  };
  const stop=error=>{failed=true;const live=[...receipts.values()][0];
    if(model)try{model.fail(live?.nativeEntered?live.modelId:null);}catch{}
    else if(live?.nativeEntered){bootstrapPrimary+=live.maximumPrimary;bootstrapStarts+=live.maximumStarts;}
    throw error;};
  function before(kind,{maximumPrimary,maximumStarts,plannedPrimary=1,extraClass=null,page=null,route=null}={}){
    try{
      assertAlive();check(receipts.size===0,'unsettled-owned-operation');
      check(integer(maximumPrimary)&&integer(maximumStarts)&&maximumStarts>0&&maximumPrimary>=maximumStarts&&
        integer(plannedPrimary)&&plannedPrimary<=maximumPrimary,'invalid-operation');
      if(model===null){
        if(extraClass==='ordinary_extra'){
          check(ordinaryExtraUpper+maximumPrimary<=poolMaximum,'bootstrap-ordinary-extra-cap');
          ordinaryExtraUpper+=maximumPrimary;
        }
        check(issuedUpper+maximumPrimary<=bootMaximum&&startsUpper+maximumStarts<=bootStarts,'bootstrap-transport-cap');
        issuedUpper+=maximumPrimary;startsUpper+=maximumStarts;
      }else if(extraClass==='ordinary_extra'){
        const saved=model.snapshot();check(saved.extra_primary_used.ordinary_extra+maximumPrimary<=saved.extra_primary_limits.ordinary_extra,
          'ordinary-extra-cap');
      }
      const r={id:nextId++,kind,route,page,maximumPrimary,maximumStarts,plannedPrimary,extraClass,
        nativeEntered:false,attempts:[],startedEpoch:now(),spentBefore:bootstrapPrimary,
        modelId:model?.reserve({maximumPrimary,maximumStarts,plannedPrimary})??null};
      receipts.set(r.id,r);return r;
    }catch(error){return stop(error);}
  }
  function owned(r,kind){check(receipts.get(r?.id)===r&&r.kind===kind,'foreign-operation-receipt');return r;}
  function entered(r){assertAlive();check(receipts.get(r?.id)===r,'foreign-operation-receipt');r.nativeEntered=true;}
  function remove(r){receipts.delete(r.id);}
  function settle(r,{known200=0,completedGhJson=0,validated304=0,extraPrimary=extras(),quota=null,sampleStatus=null,serialQuota=false}){
    const charged=known200+completedGhJson;
    if(model===null){
      bootstrapPrimary+=charged;bootstrapStarts+=known200+completedGhJson+validated304;
      for(const key of Object.keys(bootstrapExtra))bootstrapExtra[key]+=extraPrimary[key];
      check(bootstrapPrimary<=bootMaximum&&bootstrapStarts<=bootStarts&&
        Object.keys(bootstrapExtra).every(key=>bootstrapExtra[key]<=plan.extra_primary[key]),'bootstrap-extra-cap');
    }else{
      model.settle(r.modelId,{known200,completedGhJson,validated304,extraPrimary,quota,sampleStatus,
        sampleOwn200:sampleStatus===200?1:0,operationComplete:true,serialQuota});
      plannedCursor+=r.plannedPrimary;
    }
    remove(r);
  }
  function noEntry(r){
    check(!r.nativeEntered,'issued-operation-without-result');
    if(model!==null)model.settle(r.modelId,{operationComplete:false});
    remove(r);
  }
  function recordOwn(facts,r){
    const q=completeQuota(facts.quota);
    check(facts.quota.resource==='core'&&facts.status===200&&facts.response_validated===true&&facts.retry_after_present===false,
      'unusable-required-caller-boundary');
    const prefix='repos/'+scope.repository+'/actions/runs/'+scope.run_id;
    const route=facts.endpoint.replace('https://api.github.com/','');
    check([prefix,prefix+'/attempts/'+scope.run_attempt].includes(route),'foreign-required-caller-boundary');
    const boundary={route,status:200,backoff:false,request_started_at_epoch_ms:facts.started_epoch_ms,
      response_received_at_epoch_ms:facts.ended_epoch_ms,completed_at_epoch_ms:facts.ended_epoch_ms};
    check(integer(boundary.request_started_at_epoch_ms)&&integer(boundary.completed_at_epoch_ms)&&
      boundary.completed_at_epoch_ms>=boundary.request_started_at_epoch_ms,'invalid-required-caller-clock');
    observations.push({q,boundary,primaryAfter:bootstrapPrimary});
    // Calls are synchronous and every owned acquisition has joined before
    // the required caller request begins. Regional equality is not claimed.
    anchor={q,boundary,primaryAfter:bootstrapPrimary};
  }
  function finishGh(facts,r){
    try{
      owned(r,'gh');assertAlive();
      if(!r.nativeEntered){noEntry(r);check(false,'gh-operation-not-issued');}
      check(facts.error_code===null&&facts.command_failed===false&&
        (facts.response_validated===true||facts.page_validated===true||facts.completed_gh_json===true),'failed-gh-operation');
      const ext=extras();if(r.extraClass==='ordinary_extra')ext.ordinary_extra=1;
      const included=facts.completed_gh_json!==true;
      const q=included&&facts.quota?.complete===true&&facts.quota.resource==='core'?completeQuota(facts.quota):null;
      settle(r,{known200:included?1:0,completedGhJson:included?0:1,extraPrimary:ext,
        quota:model!==null?q:null,sampleStatus:model!==null&&q?200:null});
      if(model===null&&q)observations.push({q,primaryAfter:bootstrapPrimary,debt:0});
      if(facts.response_validated===true)recordOwn(facts,r);
      assertAlive();
    }catch(error){return stop(error);}
  }
  function finishNative(facts,r){
    try{
      owned(r,'native');assertAlive();
      check(facts.head===r.head&&canonical(facts.requiredIds)===canonical(r.requiredIds)&&
        canonical(facts.attempts)===canonical(r.attempts),'native-receipt-binding-disagreement');
      if(!r.nativeEntered){noEntry(r);check(false,'native-operation-not-issued');}
      check(facts.status==='complete'&&Array.isArray(facts.attempts)&&facts.attempts.length>0&&facts.attempts.length<=2,
        'failed-native-acquisition');
      const evidence=[];
      for(const a of facts.attempts){
        check(Array.isArray(a.page_evidence)&&a.page_evidence.length>0&&a.page_evidence.length<=40,'unknown-native-attempt');
        for(const p of a.page_evidence){
          check(p.status===200&&integer(p.page_number)&&p.page_number>0&&p.page_number<=40&&
            p.requested_route==='repositories/'+scope.repository_id+'/actions/runs?per_page=50&page='+p.page_number,
            'unknown-native-issued-work');
          evidence.push(p);
        }
      }
      check(evidence.length<=80,'native-start-cap');
      const ext=extras();ext.native_extra=Math.max(0,evidence.length-32);
      settle(r,{known200:evidence.length,extraPrimary:ext});
      check(facts.attempts.at(-1).page_evidence.length<=33,'finite-snapshot-page-cap');
      let started=0;
      for(const a of facts.attempts){
        for(let index=0;index<a.page_evidence.length;index++){
          const p=a.page_evidence[index];
          const laterStarts=evidence.length-(++started);
          const earlierOverlap=Math.min(2,Math.max(0,index-1));
          const debt=laterStarts+earlierOverlap;
          const q=nativeQuota(p);if(!q)continue;
          if(model!==null)model.lowerUnclassifiedQuota(q,{otherSettledDebt:debt});
          else lowerNative.push({q,primaryAfter:bootstrapPrimary,debt});
        }
      }
      assertAlive();
    }catch(error){return stop(error);}
  }
  return Object.freeze({
    register({verifiedContext,verifiedPhase,verifiedJob,deadlineEpochMs}){
      try{
        assertAlive();check(plan.phases.includes(verifiedPhase)&&candidates.includes(verifiedPhase)&&
          verifiedContext?.role===role&&verifiedContext.run_id===scope.run_id&&verifiedContext.run_attempt===scope.run_attempt&&
          verifiedContext.controller_sha===scope.controller_sha&&integer(deadlineEpochMs)&&deadlineEpochMs>now(),
          'unverified-controller-registration');
        if(context!==null)check(canonical(context)===canonical(verifiedContext)&&phase===verifiedPhase&&deadline===deadlineEpochMs,
          'changed-controller-registration');
        else{check((verifiedPhase.entry_shell_model_primary??0)===shellPrimary,'changed-shell-prefix');
          context=copy(verifiedContext);phase=verifiedPhase;job=copy(verifiedJob);deadline=deadlineEpochMs;
          monotonicDeadline=sampleMonotonic()+deadlineEpochMs-now();
          check(bootstrapPrimary<=bootMaximum&&bootstrapStarts<=bootStarts,'bootstrap-transport-cap');}
        return true;
      }catch(error){return stop(error);}
    },
    remainingMs:remaining,
    beforeGh(facts,{legacy=false}={}){
      const page=legacy?null:facts.page??null,extraClass=page!==null&&page>1?'ordinary_extra':null;
      return before('gh',{maximumPrimary:1,maximumStarts:1,plannedPrimary:extraClass?0:1,extraClass,page,route:facts.endpoint});
    },
    enter:entered,
    afterGh:finishGh,
    nativeBudget(kind='admission'){
      check(kind==='admission'||kind==='live','invalid-native-acquisition-kind');
      return Object.freeze({
        beforeAcquisition:facts=>{
          check(facts.head===(kind==='admission'?scope.controller_sha:null)&&facts.maximumStarts===80&&facts.maximumPrimary===160&&
            Array.isArray(facts.requiredIds)&&facts.requiredIds.length>0&&facts.requiredIds.every(id=>Number.isSafeInteger(id)&&id>0)&&
            new Set(facts.requiredIds).size===facts.requiredIds.length,'foreign-native-acquisition');
          const receipt=before('native',{maximumPrimary:160,maximumStarts:80,plannedPrimary:32});
          receipt.head=facts.head;receipt.requiredIds=copy(facts.requiredIds);receipt.acquisitionKind=kind;return receipt;
        },
        afterAttempt:(facts,r)=>{owned(r,'native');r.attempts.push(copy(facts));},
        afterAcquisition:finishNative,
      });
    },
    currentNativeReceipt(){
      const r=[...receipts.values()].find(r=>r.kind==='native');check(r,'missing-native-acquisition');return r;
    },
    openHistory(handle,{allowUninitialized=false,predecessorModel=null}={}){
      try{
        assertAlive();check(context!==null&&phase!==null&&receipts.size===0&&model===null,'unverified-history-open');
        check(handle?.context&&canonical(handle.context)===canonical(context)&&anchor,'missing-required-quota-evidence');
        const saved=handle.loadTransportBudget({allowUninitialized}),q=anchor.q;
        let rawMinimum=q.remaining,availableBefore=q.remaining;
        for(const obs of [...observations,...lowerNative])if(obs.primaryAfter<=anchor.primaryAfter&&
          obs.q.limit===q.limit&&obs.q.reset_epoch===q.reset_epoch){
          rawMinimum=Math.min(rawMinimum,obs.q.remaining);
          availableBefore=Math.min(availableBefore,Math.max(0,obs.q.remaining-(obs.debt??0)-(anchor.primaryAfter-obs.primaryAfter)));
        }
        const since=bootstrapPrimary-anchor.primaryAfter;
        check(integer(since)&&since>=0,'invalid-bootstrap-receipt-order');
        const point=phase.history_positions[0];check(point,'missing-first-history-cursor');
        const forecast=point.planned_primary_before;
        const policy=finiteTransportBudgetPolicy(context);
        model=createJobTransportBudget({context,policy,saved,initialQuota:q,quotaBoundary:anchor.boundary,
          verifiedBootstrapPhase:{id:phase.id,command:phase.command,job_step:phase.job_step,ordinal:phase.ordinal},
          bootstrapPrimary,bootstrapStarts,bootstrapPlannedPrimary:forecast,bootstrapSinceSamplePrimary:since,
          bootstrapMinimumObservation:{raw_minimum_remaining:rawMinimum,available_before_since_sample:availableBefore},bootstrapExtraPrimary:bootstrapExtra,
          completedStepModelPrimary:phase.predecessor_model_primary,verifiedPredecessorModel:predecessorModel,
          now,persist:value=>handle.commitTransportBudget(value)});
        for(const obs of [...observations,...lowerNative])if(obs.primaryAfter>anchor.primaryAfter){
          const debt=(obs.debt??0)+bootstrapPrimary-obs.primaryAfter;
          if(obs.q.resource===null)model.lowerUnclassifiedQuota(obs.q,{otherSettledDebt:debt});
          else model.observe(obs.q,{otherSettledDebt:debt});
        }
        model.begin({id:phase.id,command:phase.command,job_step:phase.job_step,ordinal:phase.ordinal});
        plannedCursor=forecast;cache=handle;
        return true;
      }catch(error){return stop(error);}
    },
    beforeHistory(){
      try{
        assertAlive();check(model!==null,'history-before-budget-open');
        const point=phase.history_positions[historyOrdinal];check(point,'unexpected-history-position');
        const gap=point.planned_primary_before-plannedCursor;check(integer(gap),'history-cursor-disagreement');
        const r=before('history',{maximumPrimary:400,maximumStarts:200,plannedPrimary:gap+point.planned_primary});
        r.cold=point.planned_primary===192;return r;
      }catch(error){return stop(error);}
    },
    afterHistory(result,runs,r){
      try{
        owned(r,'history');assertAlive();check(result.status==='complete'&&Array.isArray(result.jobs)&&Array.isArray(result.observations)&&
          result.jobs.length===runs.length&&result.observations.length<=200,'incomplete-history-operation');
        const rows=new Map(runs.map(row=>[row.id,row])),weights=new Map();let weight=0,foreignActive=0,ownWeight=0;
        for(const entry of result.jobs){
          const row=rows.get(entry.run_id);check(row&&Array.isArray(entry.pages)&&entry.pages.length>0,'foreign-history-weight');
          weights.set(row.id,entry.pages.length);weight+=entry.pages.length;
          if(row.id===scope.run_id)ownWeight+=entry.pages.length;
          else if(row.status!=='completed')foreignActive+=entry.pages.length;
        }
        check(weight===result.observations.length&&weight<=200&&ownWeight<=1&&foreignActive<=2,'history-capacity');
        if(model.snapshot().history_initial_weight===null)check(weight>0&&weight<=192,'initial-history-weight-cap');
        const ext=extras();let known200=0,validated304=0;
        for(const obs of result.observations){
          const row=rows.get(obs.run_id);check(row&&obs.page_validated===true,'unvalidated-history-observation');
          if(obs.status===200){known200++;if(!r.cold&&row.status==='completed'&&row.id!==scope.run_id)ext.terminal_miss++;}
          else{check(obs.status===304&&obs.page_revalidated===true,'unvalidated-history-revalidation');validated304++;}
        }
        const last=result.observations.at(-1),q=last?completeQuota(last.quota):null;
        check(q?.resource==='core','missing-history-quota-resource');
        settle(r,{known200,validated304,extraPrimary:ext,quota:q,sampleStatus:last?.status??null,serialQuota:true});
        // The worker starts requests serially. A later high regional sample
        // cannot erase a lower earlier sample or the paid starts after it.
        let paidAfter=0;
        for(let i=result.observations.length-1;i>=0;i--){
          const obs=result.observations[i],observed=completeQuota(obs.quota),current=model.snapshot().current_window;
          check(observed.resource==='core','missing-history-quota-resource');
          if(observed.limit===current.limit&&observed.reset_epoch===current.reset_epoch)
            model.observe(observed,{otherSettledDebt:paidAfter});
          if(obs.status===200)paidAfter++;
        }
        model.recordHistoryWeight(weight);historyOrdinal++;assertAlive();
        return {weighted_pages:weight,foreign_active_weighted_pages:foreignActive,own_weighted_pages:ownWeight,
          terminal_extra_200:ext.terminal_miss,initial_weighted_pages:model.snapshot().history_initial_weight};
      }catch(error){return stop(error);}
    },
    finish(){
      try{
        assertAlive();check(receipts.size===0,'unsettled-owned-operation');
        check(context!==null&&model!==null&&historyOrdinal===phase.history_positions.length,'incomplete-history-sequence');model.finish();
        completed=true;return true;
      }catch(error){return stop(error);}
    },
    fail(){const live=[...receipts.values()][0];failed=true;try{model?.fail(live?.nativeEntered?live.modelId:null);}catch{}},
    snapshot(){return {registered:context!==null,opened:model!==null,completed,failed,
      bootstrap_primary:bootstrapPrimary,bootstrap_logical_starts:bootstrapStarts,shell_model_primary:shellPrimary,
      bootstrap_ordinary_extra_upper:ordinaryExtraUpper,history_ordinal:historyOrdinal,
      state:model?model.snapshot():null};},
  });
}
