// Closed planning constants. This module performs no reads and grants no authority.
// Counts are logical starts/modelled primary demand, never physical wire counts.
// Source includes the complete future publisher path and the SAME two future
// hold slots once. A later publisher grant is admitted independently from fresh
// headroom; never add both job grants or restore an original allowance.
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const SOURCE='.github/scripts/retained-price-source-admission.mjs';
const SELECTOR='.github/scripts/select-release-source.mjs';
const BROWSER='.github/scripts/retained-price-source-browser.mjs';
export const FINITE_TRANSPORT_CAPACITY=freeze({
  initial_weighted_pages:192,maximum_history_starts:200,history_maximum_primary:400,
  native_maximum_starts:80,native_maximum_primary:160,foreign_active_weighted_pages:2,
  current_active_weighted_pages:1,retained_cushion:128,retained_floor:100,
  shared_future_successful_hold_slots:2,worker_timeout_ms:120000,native_attempt_timeout_ms:30000,
  pager_timeout_ms:120000,command_timeout_ms:30000,job_timeout_minutes:110,
});
export const FINITE_PREPARE_CONTROLLER=freeze({
  job:'publish',step:'Prepare immutable controller for finite price publication',
  script:SOURCE,command:'prepare-controller',completed_step_model_primary:16,
  logical_starts:null,
});
// P,M,S,F,T = planned primary, phase peak, logical start ceiling,
// later primary (excluding own pools and228), later transient margin.
// A phase peak P+397 is combined with T by MAX, not added to it.
// First-history forecast/provable counts are separate from registration.
// Cursor credit still requires completion of the actual verified operations.
// Bootstrap ceilings require one shared ordinary-extra counter BEFORE every
// page start across registration and the entire allocation-free prefix.
// timeout_ms is an enclosing ceiling, not a renewed interval. The controller
// anchors once and clamps to remaining original job/step time; the driver's
// 100min-24s expression is measured from min(file clock, genuine job start).
// Browser outer transport uses the current verified step's 8min remainder;
// its existing 6min work-region timer begins after browser-before proof.
function phase(ordinal,id,command,step,P,M,S,F,T,first,last,registration,bootstrapStarts,bootstrapMaximum,historyForecast,knownPrefix){
  const early=registration===57,source=registration===54,shell=id==='companion'?1:0;
  return {ordinal,id,command,step,registration_bootstrap_maximum_starts:(source?118:early?150:159)+shell,
    registration_bootstrap_maximum_primary:(source?198:early?230:239)+shell,planned_primary:P,maximum_primary:M,maximum_starts:S,
    future_primary:F,future_transient_primary:T,history_first:first,history_last:last,
    bootstrap_planned_primary:registration+shell,entry_shell_model_primary:shell,entry_shell_model_starts:shell,
    bootstrap_maximum_starts:bootstrapStarts,
    bootstrap_maximum_primary:bootstrapMaximum,first_history_planned_primary:historyForecast,
    first_history_known_operation_count:knownPrefix,
    predecessor_model_primary:id==='restore'?16:0,
    predecessor_model_step:id==='restore'?FINITE_PREPARE_CONTROLLER.step:null,
    step_timeout_minutes:id==='browser'?8:null,
    timeout_ms:id==='browser'?480000:100*60*1000-24000,
    work_region_timeout_ms:id==='browser'?360000:null};
}
// Companion includes its one already-modelled finite shell GET; Node starts
// and this unobserved-wire JSON-command model remain distinct in the adapter.
const SOURCE_CURSORS=[[88,325,442,490],[88,136],[89,137]];
const PUBLISHER_CURSORS=[[61,268],[208,256,373,421],[100,148,264,312,428,476],
  [100,148],[100,148],[100,148],[100,148,264,312],[61,79,236,284,400,448],[61,79,236,284,400,448]];
function decorate(rows,cursors){
  return rows.map((p,i)=>{
    const points=cursors[i].map((known,j)=>{
      const planned=p.history_first+j===1||p.history_first+j===9?192:3;
      return {history_ordinal:j+1,history_position:p.history_first+j,
        planned_primary_before:known,conservative_table_primary_before:known+(p.script===SOURCE?0:2),
        planned_primary:planned,maximum_primary:400,maximum_starts:200,
        remaining_phase_primary:p.planned_primary-known-planned};
    });
    const next=rows[i+1];
    const next_bootstrap=next?{phase_index:i+1,phase_id:next.id,command:next.command,
      job_step:next.step,ordinal:next.ordinal,maximum_primary:next.bootstrap_maximum_primary,
      maximum_starts:next.bootstrap_maximum_starts,maximum_step_model_primary:next.predecessor_model_primary}:null;
    return {...p,next_bootstrap,history_positions:points};
  });
}
const sourcePhases=[
  phase(1,'produce','produce','Build static frontend',506,903,1409,3762,397,1,4,54,200,360,88,88),
  phase(2,'verify-produced','verify-produced','Verify finite retained-price repair',152,549,706,3610,397,5,6,54,200,360,88,88),
  phase(3,'companion','companion','Record exact export attempt and dated evidence',153,550,707,3457,397,7,8,54,201,361,89,89),
].map(p=>({...p,job_step:p.step,cli_command:p.command,script:SOURCE}));
const publisherPhases=[
  phase(1,'plan','plan','Verify live provenance, UI gates and non-regressing data',331,728,680,2899,397,9,10,57,157,237,63,61),
  phase(2,'restore','restore','Restore the exact selected data artifact',424,821,1644,2459,397,11,14,57,448,768,210,208),
  phase(3,'prepare-carry','prepare-carry','Carry the active financial source onto the new price target',492,889,2154,1967,397,15,20,66,244,404,102,100),
  phase(4,'publisher-build-before','publisher-build-before','Verify publisher tooling before finite build',164,561,750,1803,397,21,22,66,244,404,102,100),
  phase(5,'publisher-build-after','publisher-build-after','Verify publisher tooling after finite build',164,561,750,1639,397,23,24,66,244,404,102,100),
  phase(6,'compose','compose','Preserve approved UI bytes or record verified new UI',177,574,763,1462,397,25,26,66,244,404,102,100),
  phase(7,'browser','browser','Verify composed finite price browser and CSV surfaces',328,725,1452,1134,397,27,30,66,244,404,102,100),
  phase(8,'recheck-before-upload','recheck','Recheck live identity, main and final data before uploading',493,890,2107,641,397,31,36,57,157,237,63,61),
  phase(9,'recheck-before-deployment','recheck','Reject a superseded release immediately before deployment',493,890,2107,148,0,37,42,57,157,237,63,61),
].map(p=>({...p,job_step:p.step,cli_command:p.id==='browser'?null:p.command,script:p.id==='browser'?BROWSER:SELECTOR}));
export const FINITE_TRANSPORT_POLICIES=freeze({
  'producer-combine':{schema_version:'conditional-job-budget-policy-v3',role:'producer-combine',
    job:'combine-and-build',workflow:'.github/workflows/static-site.yml',original_primary:4937,
    retained_reserve:228,extra_primary:{native_extra:12,ordinary_extra:16,terminal_miss:16},phases:decorate(sourcePhases,SOURCE_CURSORS)},
  publisher:{schema_version:'conditional-job-budget-policy-v3',role:'publisher',
    job:'publish',workflow:'.github/workflows/research-ui-release.yml',original_primary:3969,
    retained_reserve:228,extra_primary:{native_extra:50,ordinary_extra:48,terminal_miss:16},phases:decorate(publisherPhases,PUBLISHER_CURSORS)},
});
export function finiteTransportPolicy(role){
  return typeof role==='string'&&Object.hasOwn(FINITE_TRANSPORT_POLICIES,role)?FINITE_TRANSPORT_POLICIES[role]:null;
}
export function finiteTransportPhase({role,job,step,script,command,ordinal,cli_argv}={}){
  const policy=finiteTransportPolicy(role);
  if(!policy||job!==policy.job||!Number.isSafeInteger(ordinal)||ordinal<1)return null;
  const p=policy.phases[ordinal-1];
  if(!p||p.ordinal!==ordinal||p.step!==step||p.script!==script||p.command!==command
    ||!Array.isArray(cli_argv)||cli_argv.some(v=>typeof v!=='string'||!v))return null;
  if(p.script===BROWSER)return cli_argv.length===0?p:null;
  if(p.script===SELECTOR)return cli_argv.length===1&&cli_argv[0]===p.cli_command?p:null;
  const flags=p.id==='produce'?['--output','--job-start']:p.id==='verify-produced'?['--output']:['--output','--artifact-id','--artifact-digest'];
  if(cli_argv[0]!==p.cli_command||cli_argv.length!==1+flags.length*2)return null;
  const seen=new Set();
  for(let i=1;i<cli_argv.length;i+=2){if(!flags.includes(cli_argv[i])||seen.has(cli_argv[i]))return null;seen.add(cli_argv[i]);}
  return seen.size===flags.length?p:null;
}
export function finiteHistoryGrowthAllowance(initialWeightedPages){
  if(!Number.isSafeInteger(initialWeightedPages)||initialWeightedPages<1||initialWeightedPages>192)throw Error('invalid-finite-history-weight');
  // Membership capacity does not fund another paid pool. New terminal200s,
  // changed representations, non-ETag and evicted existing pages share16/job.
  return 200-initialWeightedPages;
}

// Match an actual finite CLI/job/step first. History ordinals are local to that
// invocation. These constants cannot authorize a call or advance a live cursor.
export function finiteTransportHistoryCursor(binding,historyOrdinal){
  const p=finiteTransportPhase(binding);
  if(!p||!Number.isSafeInteger(historyOrdinal)||historyOrdinal<1)return null;
  return p.history_positions[historyOrdinal-1]??null;
}

const SCALAR_PHASE_KEYS=['id','command','job_step','ordinal','maximum_primary','maximum_starts','future_primary',
  'future_transient_primary','planned_primary','external_future_primary','bootstrap_maximum_primary',
  'bootstrap_maximum_starts','predecessor_model_primary','predecessor_model_step'];
export function finiteTransportBudgetPolicy({controller_sha,controller_tree,role}={}){
  const p=finiteTransportPolicy(role);
  if(!p||typeof controller_sha!=='string'||!/^[a-f0-9]{40}$/.test(controller_sha)
    ||typeof controller_tree!=='string'||!/^[a-f0-9]{40}$/.test(controller_tree))throw Error('invalid-finite-budget-context');
  const external=role==='producer-combine'?3457:148;
  return freeze({schema_version:'conditional-job-budget-policy-v3',controller_sha,controller_tree,role,
    original_primary_limit:p.original_primary,retained_reserve:p.retained_reserve,extra_primary:{...p.extra_primary},
    phases:p.phases.map(phase=>Object.fromEntries(SCALAR_PHASE_KEYS.map(key=>[key,key==='external_future_primary'?external:phase[key]])))});
}
