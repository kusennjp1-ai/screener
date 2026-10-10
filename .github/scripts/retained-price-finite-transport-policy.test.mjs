import test from 'node:test';
import assert from 'node:assert/strict';
import {FINITE_TRANSPORT_CAPACITY as cap,FINITE_PREPARE_CONTROLLER as prepare,
  finiteTransportPolicy,finiteTransportPhase,finiteTransportHistoryCursor,
  finiteHistoryGrowthAllowance,finiteTransportBudgetPolicy} from './retained-price-finite-transport-policy.mjs';
const src=finiteTransportPolicy('producer-combine'),pub=finiteTransportPolicy('publisher');
const sum=p=>Object.values(p.extra_primary).reduce((a,b)=>a+b,0);
const argv=q=>q.script.endsWith('source-browser.mjs')?[]:q.script.endsWith('select-release-source.mjs')?[q.cli_command]:
  [q.cli_command,...(q.id==='produce'?['--output','fixture-output','--job-start','fixture-clock']:
  q.id==='verify-produced'?['--output','fixture-output']:['--output','fixture-output','--artifact-id','23','--artifact-digest','fixture-digest'])];
const bind=(p,q)=>({role:p.role,job:p.job,step:q.step,script:q.script,command:q.command,ordinal:q.ordinal,cli_argv:argv(q)});
const need=(p,q,c=0)=>q.planned_primary-c+q.future_primary+sum(p)+p.retained_reserve+Math.max(q.maximum_primary-q.planned_primary,q.future_transient_primary);
const hold=(p,q,h)=>h.maximum_primary+(q.planned_primary-h.planned_primary_before-h.planned_primary)
  +q.future_primary+sum(p)+p.retained_reserve+Math.max(0,Math.max(q.maximum_primary-q.planned_primary,
  q.future_transient_primary,h.maximum_primary-h.planned_primary)-(h.maximum_primary-h.planned_primary));
test('one retained228 and one transient produce closed immutable grants',()=>{
  assert.equal(src.original_primary,4937);assert.equal(pub.original_primary,3969);
  assert.deepEqual(src.extra_primary,{native_extra:12,ordinary_extra:16,terminal_miss:16});
  assert.deepEqual(pub.extra_primary,{native_extra:50,ordinary_extra:48,terminal_miss:16});
  assert.deepEqual(src.phases.map(q=>need(src,q)),[4937,4431,4279]);
  assert.deepEqual(pub.phases.map(q=>need(pub,q)),[3969,3622,3198,2706,2542,2378,2201,1873,1380]);
  assert.equal(cap.retained_cushion+cap.retained_floor,228);
});
test('source54/since45 and lazy88/since79 require raw4928 without credit restoration',()=>{
  const q=src.phases[0],h=q.history_positions[0];
  assert.equal(need(src,q,54),4883);assert.equal(4937-54,4883);assert.equal(4928-45,4883);
  assert.ok(4927-45<need(src,q,54));assert.equal(4937-53,4884);
  assert.equal(need(src,q,54),4883);
  assert.equal(h.planned_primary_before,88);assert.equal(hold(src,q,h),4849);
  assert.equal(4937-88,4849);assert.equal(4928-79,4849);assert.ok(4927-79<hold(src,q,h));
});
test('bootstrap covers all prehistory scopes and keeps registration separate',()=>{
  for(const q of src.phases){const shell=q.id==='companion'?1:0;assert.equal(q.bootstrap_maximum_primary,360+shell);assert.equal(q.bootstrap_maximum_starts,200+shell);
    assert.equal(q.registration_bootstrap_maximum_primary,198+shell);assert.equal(q.registration_bootstrap_maximum_starts,118+shell);}
  for(const i of [0,7,8]){const q=pub.phases[i];assert.equal(q.bootstrap_maximum_primary,237);
    assert.equal(q.bootstrap_maximum_starts,157);assert.equal(q.registration_bootstrap_maximum_primary,230);}
  assert.equal(pub.phases[1].bootstrap_maximum_primary,768);assert.equal(pub.phases[1].bootstrap_maximum_starts,448);
  for(const q of pub.phases.slice(2,7)){assert.equal(q.bootstrap_maximum_primary,404);assert.equal(q.bootstrap_maximum_starts,244);}
  assert.equal(2*160+24+16,360);assert.equal(2*80+24+16,200);
});
test('early publisher61 cannot obtain the two forecast-only cursor units',()=>{
  for(const i of [0,7,8]){const q=pub.phases[i],h=q.history_positions[0];
    assert.equal(q.first_history_known_operation_count,61);assert.equal(q.first_history_planned_primary,63);
    assert.equal(h.planned_primary_before,61);assert.equal(h.conservative_table_primary_before,63);}
  assert.equal(57+2+2,61);assert.equal(hold(pub,pub.phases[0],pub.phases[0].history_positions[0]),3908);
  assert.equal(3969-61,3908);
});
test('closed mapper rejects neighboring job step command ordinal and script paths',()=>{
  for(const p of [src,pub])for(const q of p.phases){const b=bind(p,q);assert.equal(finiteTransportPhase(b),q);
    for(const x of [{role:'unknown'},{job:'renewal_route'},{step:q.step+' '},{script:'./'+q.script},
      {command:'design'},{ordinal:0},{ordinal:99}])assert.equal(finiteTransportPhase({...b,...x}),null);}
  assert.equal(finiteTransportPolicy('__proto__'),null);assert.equal(finiteTransportPhase(),null);
  assert.equal(pub.phases[6].command,'browser');assert.equal(pub.phases[6].cli_command,null);
  assert.equal(finiteTransportPhase({...bind(pub,pub.phases[6]),cli_argv:['browser']}),null);
  assert.equal(finiteTransportPhase({...bind(src,src.phases[0]),cli_argv:['produce','--output','x','--output','y']}),null);
  assert.equal(finiteTransportPhase({...bind(pub,pub.phases[7]),ordinal:9}),null);
});
test('prepare16 is distinct from actual starts and belongs only to restore predecessor',()=>{
  assert.equal(pub.phases.length,9);assert.ok(!pub.phases.some(q=>q.id==='prepare-controller'));
  assert.equal(prepare.completed_step_model_primary,16);assert.equal(prepare.logical_starts,null);
  const q=pub.phases[1],n=pub.phases[0].next_bootstrap;
  assert.equal(q.predecessor_model_primary,16);assert.equal(q.predecessor_model_step,prepare.step);
  assert.deepEqual(n,{phase_index:1,phase_id:'restore',command:'restore',job_step:q.step,ordinal:2,
    maximum_primary:768,maximum_starts:448,maximum_step_model_primary:16});
  for(const q of [...src.phases,...pub.phases])if(q.id!=='restore')assert.equal(q.predecessor_model_primary,0);
  assert.equal(pub.phases.at(-1).next_bootstrap,null);
});
test('strict v3 projection has exact keys and external is a subset',()=>{
  for(const p of [src,pub]){const a=finiteTransportBudgetPolicy({role:p.role,controller_sha:'a'.repeat(40),controller_tree:'b'.repeat(40)});
    assert.deepEqual(Object.keys(a).sort(),['schema_version','controller_sha','controller_tree','role','original_primary_limit','retained_reserve','phases','extra_primary'].sort());
    assert.equal(a.schema_version,'conditional-job-budget-policy-v3');assert.equal(a.original_primary_limit,p.original_primary);
    for(let i=0;i<a.phases.length;i++){const q=a.phases[i],later=a.phases.slice(i+1).reduce((n,z)=>n+z.planned_primary+z.predecessor_model_primary,0);
      assert.deepEqual(Object.keys(q).sort(),['id','command','job_step','ordinal','maximum_primary','maximum_starts','future_primary','future_transient_primary','planned_primary','external_future_primary','bootstrap_maximum_primary','bootstrap_maximum_starts','predecessor_model_primary','predecessor_model_step'].sort());
      assert.equal(q.future_primary,q.external_future_primary+later);assert.ok(q.bootstrap_maximum_primary<=q.maximum_primary);
      assert.ok(Object.isFrozen(q));}
    assert.ok(Object.isFrozen(a));}
  for(const role of ['unknown',null])assert.throws(()=>finiteTransportBudgetPolicy({role,controller_sha:'a'.repeat(40),controller_tree:'b'.repeat(40)}));
  assert.throws(()=>finiteTransportBudgetPolicy({role:'publisher',controller_sha:'A'.repeat(40),controller_tree:'b'.repeat(40)}));
});
test('all42 history positions preserve same-phase tails and complete logical ceilings',()=>{
  const positions=[];
  for(const p of [src,pub])for(const q of p.phases){
    for(let j=0;j<q.history_positions.length;j++){const h=finiteTransportHistoryCursor(bind(p,q),j+1);
      assert.equal(h,q.history_positions[j]);assert.ok(h.remaining_phase_primary>=0);
      assert.equal(h.maximum_primary,400);assert.equal(h.maximum_starts,200);positions.push(h.history_position);}
    assert.equal(finiteTransportHistoryCursor(bind(p,q),0),null);
    assert.equal(finiteTransportHistoryCursor(bind(p,q),q.history_positions.length+1),null);}
  assert.deepEqual(positions,Array.from({length:42},(_,i)=>i+1));
  assert.deepEqual(src.phases.map(q=>q.maximum_starts),[1409,706,707]);
  assert.deepEqual(pub.phases.map(q=>q.maximum_starts),[680,1644,2154,750,750,763,1452,2107,2107]);
});
test('membership growth does not mint another paid pool or remove active rows',()=>{
  assert.equal(cap.initial_weighted_pages,192);assert.equal(finiteHistoryGrowthAllowance(192),8);
  assert.equal(finiteHistoryGrowthAllowance(171),29);assert.equal(src.extra_primary.terminal_miss,16);
  assert.equal(pub.extra_primary.terminal_miss,16);assert.equal(Object.hasOwn(src.extra_primary,'growth'),false);
  for(const v of [0,-1,193,1.5,'192',null])assert.throws(()=>finiteHistoryGrowthAllowance(v));
  assert.equal(cap.current_active_weighted_pages,1);assert.equal(cap.foreign_active_weighted_pages,2);
});
test('last suffix keeps the shared future holds and floor and no later history hold',()=>{
  const q=pub.phases.at(-1);assert.equal(q.future_primary,124+2*(10+2));
  assert.equal(q.future_transient_primary,0);assert.equal(q.future_primary+pub.retained_reserve,376);
  assert.equal(cap.shared_future_successful_hold_slots,2);assert.equal(cap.job_timeout_minutes,110);
  assert.equal(pub.phases[6].step_timeout_minutes,8);assert.ok(Object.isFrozen(src.extra_primary));
  assert.throws(()=>{src.original_primary=5000;});assert.equal(src.original_primary,4937);
});

test('independent retired workflow literals bind every publisher process entrypoint',()=>{
  // Literal commands/steps from research-ui-release.yml blob89a36a39;
  // source-admission43d63b99 and driverff8179 route only prepare-controller
  // and the three producer commands. Nested imports are not CLI entrypoints.
  const rows=[
    [1,'plan','Verify live provenance, UI gates and non-regressing data','.github/scripts/select-release-source.mjs',['plan']],
    [2,'restore','Restore the exact selected data artifact','.github/scripts/select-release-source.mjs',['restore']],
    [3,'prepare-carry','Carry the active financial source onto the new price target','.github/scripts/select-release-source.mjs',['prepare-carry']],
    [4,'publisher-build-before','Verify publisher tooling before finite build','.github/scripts/select-release-source.mjs',['publisher-build-before']],
    [5,'publisher-build-after','Verify publisher tooling after finite build','.github/scripts/select-release-source.mjs',['publisher-build-after']],
    [6,'compose','Preserve approved UI bytes or record verified new UI','.github/scripts/select-release-source.mjs',['compose']],
    [7,'browser','Verify composed finite price browser and CSV surfaces','.github/scripts/retained-price-source-browser.mjs',[]],
    [8,'recheck','Recheck live identity, main and final data before uploading','.github/scripts/select-release-source.mjs',['recheck']],
    [9,'recheck','Reject a superseded release immediately before deployment','.github/scripts/select-release-source.mjs',['recheck']],
  ];
  for(const [ordinal,command,step,script,cli_argv]of rows){
    const b={role:'publisher',job:'publish',ordinal,command,step,script,cli_argv};
    assert.equal(finiteTransportPhase(b)?.ordinal,ordinal);
    assert.equal(finiteTransportPhase({...b,script:'.github/scripts/retained-price-source-admission.mjs'}),null);
  }
  const prepareArgv=['prepare-controller','--output','fixture-controller'];
  assert.equal(finiteTransportPhase({role:'publisher',job:'publish',ordinal:2,command:'prepare-controller',
    step:'Prepare immutable controller for finite price publication',
    script:'.github/scripts/retained-price-source-admission.mjs',cli_argv:prepareArgv}),null);
});
test('deadline metadata preserves existing work ceilings outside strict scalar projection',()=>{
  // ff8179 acquire: min(original clock, job.started_at)+100min, remaining-24000.
  // 385ca browser:6min timer starts after browser-before; outer step remains8min.
  for(const q of src.phases)assert.equal(q.timeout_ms,5976000);
  for(const q of pub.phases)assert.equal(q.timeout_ms,q.id==='browser'?480000:5976000);
  assert.equal(pub.phases[6].timeout_ms,8*60*1000);assert.equal(pub.phases[6].work_region_timeout_ms,360000);
  for(const q of [...src.phases,...pub.phases])if(q.id!=='browser')assert.equal(q.work_region_timeout_ms,null);
  for(const role of ['producer-combine','publisher']){
    const p=finiteTransportBudgetPolicy({role,controller_sha:'a'.repeat(40),controller_tree:'b'.repeat(40)});
    for(const q of p.phases){assert.equal(Object.hasOwn(q,'timeout_ms'),false);assert.equal(Object.hasOwn(q,'work_region_timeout_ms'),false);}
  }
});

test('companion finite shell GET is one model unit before the exact Node command',()=>{
  // Literal8d static-site.yml1045-1058; finite branch executes the GET once.
  const block=[
    '      - name: Record exact export attempt and dated evidence',
    '        env:',
    '          GH_TOKEN: ${{ github.token }}',
    '          PRICE_REPAIR: ${{ needs.select-markets.outputs.repair }}',
    '          PRICE_ARTIFACT_ID: ${{ steps.upload-data-artifact.outputs.artifact_id }}',
    '        run: |',
    '          if [ "$PRICE_REPAIR" = "true" ]; then',
    '            [[ "$PRICE_ARTIFACT_ID" =~ ^[1-9][0-9]*$ ]]',
    '            artifact_digest=$(gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$PRICE_ARTIFACT_ID" --jq .digest)',
    '            [[ "$artifact_digest" =~ ^sha256:[a-f0-9]{64}$ ]]',
    '            node .github/scripts/retained-price-source-admission.mjs companion --output "$RUNNER_TEMP/retained-price-source" --artifact-id "$PRICE_ARTIFACT_ID" --artifact-digest "$artifact_digest"',
    '          else',
    '            node .github/scripts/select-release-source.mjs export-metadata',
    '          fi',
  ].join('\n');
  assert.equal((block.match(/\$\(gh api /g)||[]).length,1);
  const read=block.indexOf('artifact_digest=$(gh api '),cli=block.indexOf('node .github/scripts/retained-price-source-admission.mjs companion ');
  assert.ok(read>block.indexOf('if [ "$PRICE_REPAIR" = "true" ]; then'));assert.ok(read<cli);
  assert.ok(cli<block.indexOf('          else'));
  const q=src.phases[2];assert.equal(q.planned_primary,153);assert.equal(src.original_primary,4937);
  assert.equal(q.entry_shell_model_primary,1);assert.equal(q.entry_shell_model_starts,1);
  assert.equal(q.bootstrap_planned_primary,55);assert.equal(q.registration_bootstrap_maximum_primary,199);
  assert.equal(q.registration_bootstrap_maximum_starts,119);assert.equal(q.bootstrap_maximum_primary,361);
  assert.equal(q.bootstrap_maximum_starts,201);
  assert.deepEqual(q.history_positions.map(h=>h.planned_primary_before),[89,137]);
  for(const p of [src,pub])for(const z of p.phases)if(z!==q){assert.equal(z.entry_shell_model_primary,0);assert.equal(z.entry_shell_model_starts,0);}
  const next=src.phases[1].next_bootstrap;assert.equal(next.maximum_primary,361);assert.equal(next.maximum_starts,201);
});
