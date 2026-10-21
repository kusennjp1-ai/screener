// Synthetic report and byte fixtures only; no browser/pixel/price pass claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, inventoryDigest, uiInventory, dataInventoryDigest } from '../../.github/scripts/publication-state.mjs';
import { packPublication, previewPublication } from '../../.github/scripts/static-transport-publication.mjs';
import { fonts } from '../src/static/theme/tokens.js';
import { RADAR_HARNESS_VERSION, RADAR_CONTEXT_CLASSES } from './radar-benchmark-context.mjs';
import { RADAR_VISIBILITY_VERSION } from './radar-visibility.mjs';
import { FINANCIAL_DESIGN_CASES } from './financial-design-cases.mjs';
import { sealFinancialCarryDesignReport } from './financial-carry-design-cases.mjs';
import { SCREENING_PRIORITY_POLICY, DESIGN_GROUPS, requiredScreeningCaptures, screeningPriorityBinding, assessScreeningPriority,
  finishScreeningPriority, checkedScreeningPriority, requireWarningReviewImages } from './screening-priority-acceptance.mjs';

const frontend = fileURLToPath(new URL('..', import.meta.url));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: frontend, encoding: 'utf8' }).trim();
const H = 'a'.repeat(64), generation = 'b'.repeat(64);
const write = (path, value) => writeFileSync(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
function reportFixture(scope = 'ordinary') {
  const node = { font_family: fonts.body, box_sizing: 'border-box', width: 200, height: 200 };
  const context = { harness_version: RADAR_HARNESS_VERSION, root_theme: 'dark', shell_theme: 'dark',
    ancestors: RADAR_CONTEXT_CLASSES.map(class_name => ({ class_name })), shell: node, slot: node, canvas: node,
    radar: { ...node, font_feature_settings: 'palt', font_variant_numeric: 'tabular-nums' }, plot: { animation_name: 'none', transform: 'none' } };
  const radar = { first_frame_ms: 64, point_count: 207, final_point_count: 207, context, pixel_alignment: { matches: true }, visibility: {
    version: RADAR_VISIBILITY_VERSION, captured_in_endpoint_task: true, styles_visible: true, effective_opacity: 1, transforms_settled: true,
    expected_points: 207, painted_point_centers: 207, unobscured_point_centers: 207, readback_error: null } };
  const financial = [1440,390].flatMap(width => FINANCIAL_DESIGN_CASES.map(item => ({ ...item, viewport: { width }, theme: width === 1440 ? 'dark' : 'light',
    source: { unknown: 1, qualified: false }, financial_rows: [{ state: 'unknown' }], selection: { unknown: 1 }, purchase: { unknown: 1 }, csv: { source: 'actual browser download' } })));
  return { commit, measured_at: new Date().toISOString(), input_basis: 'same_verified_input', data: { as_of_date: '2026-10-16', research_generation: H },
    failures: ['1440: Q1 method switch 533ms > 480ms', '1440: P1 exact limits not met (3500ms / 400ms / 200ms)',
      ...[1440,390].flatMap(width => [`${width}: D9 first paint opportunity 64.0ms > 50ms`, ...[1,2,3].map(index => `${width}: D9 run ${index}: first frame 64ms (limit 50ms)`)])],
    screens: requiredScreeningCaptures(scope).map((key, index) => ({ key, screenshot: `capture-${index}.png`, sha256: H })),
    financial_cases: financial, ...(scope === 'carry' ? { financial_carry_cases: structuredClone(financial) } : {}),
    chart_cases: Array.from({ length: 12 }, () => ({ expanded_scrolled_geometry: {}, expanded_reopened_geometry: {}, selected_one_month_range: '2026-09/2026-10' })),
    daily_observations: [1440,390].map(width => ({ viewport: { width }, watch_keyboard_added: true, watch_keyboard_removed: true, table_keyboard_scroll: [{},{},{},{}], research_keyboard_destination: { symbol: 'actual-case' } })),
    performance: ['baseline','current'].flatMap(label => [1440,390].map(width => ({ label, viewport: { width }, ...(label === 'current' ? { p1_pass: width !== 1440 } : {}),
      runs: [1,2,3].map(() => ({ candidate_ms: 2500, method_switch_ms: label === 'current' && width === 1440 ? 533 : 200, longest_initial_task_ms: 174 })),
      candidate_median_ms: 2500, maximum_switch_ms: label === 'current' && width === 1440 ? 533 : 200, longest_initial_task_ms: 174 }))),
    radar: [1440,390].map(width => ({ viewport: { width }, runs: structuredClone([radar,radar,radar]) })) };
}
const pureBinding = scope => ({ policy: SCREENING_PRIORITY_POLICY, scope, commit, as_of_date: '2026-10-16', research_generation: H });

test('exact inventory includes all short chart captures and original/carry financial routes', () => {
  assert.equal(requiredScreeningCaptures('ordinary').length, 134); assert.equal(requiredScreeningCaptures('carry').length, 162);
  assert.equal(requiredScreeningCaptures('ordinary').filter(key => key.includes('expanded-short')).length, 12);
});
for (const scope of ['ordinary','carry']) test(`${scope} defers only exact measured timing and leaves strict failure/P1/unknown unchanged`, () => {
  const report = reportFixture(scope), before = JSON.stringify(report), assessment = assessScreeningPriority(report, pureBinding(scope), DESIGN_GROUPS);
  assert.equal(assessment.policy_exit, 0); assert.equal(assessment.strict_result, 'failed'); assert.equal(assessment.performance_acceptance, 'deferred_warning');
  assert.equal(assessment.functional_acceptance, 'passed'); assert.equal(assessment.warnings.length, 10); assert.deepEqual(assessment.original_design_failures, report.failures);
  assert.equal(JSON.stringify(report), before); assert.equal(report.performance[2].p1_pass, false); assert.equal(report.financial_cases[0].source.qualified, false);
});
for (const failure of ['Financial UI/history differ', 'Unknown included in allocation', 'Daily verification below90%', 'Required capture missing', 'Keyboard navigation failed', 'Future unrecognized failure']) test('functional/unknown failure remains blocking: '+failure, () => {
  const report = reportFixture(); report.failures.push(failure); const result = assessScreeningPriority(report, pureBinding('ordinary'), DESIGN_GROUPS); assert.equal(result.policy_exit, 1); assert(result.blocking_failures.includes(failure));
});
for (const [name, change] of [
  ['missing current trial', r => r.performance[2].runs.pop()], ['missing baseline trial', r => r.performance[0].runs.pop()],
  ['missing baseline group', r => r.performance.splice(0,1)], ['extra performance group', r => r.performance.push(structuredClone(r.performance[0]))],
  ['forged aggregate', r => r.performance[2].maximum_switch_ms = 1], ['forged P1 pass', r => r.performance[2].p1_pass = true],
  ['nonfinite time', r => r.performance[2].runs[0].method_switch_ms = NaN], ['missing timing failure', r => r.failures.pop()],
  ['missing D9 trial', r => r.radar[0].runs.pop()], ['D9 missing point', r => r.radar[0].runs[0].point_count = 206],
  ['D9 incomplete pixels', r => r.radar[0].runs[0].visibility.unobscured_point_centers = 206], ['D9 unsettled alignment', r => r.radar[0].runs[0].pixel_alignment.matches = false],
  ['D9 wrong production context', r => r.radar[0].runs[0].context.harness_version = 'other'],
  ['missing short capture', r => r.screens.splice(r.screens.findIndex(s => s.key.includes('expanded-short')),1)],
  ['duplicate capture', r => r.screens.push(r.screens[0])], ['unfinished financial CSV', r => delete r.financial_cases[0].csv],
  ['missing financial case', r => r.financial_cases.pop()], ['chart operations incomplete', r => delete r.chart_cases[0].expanded_reopened_geometry],
  ['Daily keyboard incomplete', r => r.daily_observations[0].table_keyboard_scroll.pop()], ['changed date', r => r.data.as_of_date = '2026-10-19'],
]) test('incomplete or inconsistent result blocks: '+name, () => { const report=reportFixture();change(report);assert.equal(assessScreeningPriority(report,pureBinding('ordinary'),DESIGN_GROUPS).policy_exit,1); });
test('missing route-phase completion and carry guards fail closed', () => {
  assert.equal(assessScreeningPriority(reportFixture(),pureBinding('ordinary'),DESIGN_GROUPS.slice(0,-1)).policy_exit,1);
  const report=reportFixture('carry');delete report.financial_carry_cases;assert.equal(assessScreeningPriority(report,pureBinding('carry'),DESIGN_GROUPS).policy_exit,1);
});
test('empty raw failures cannot hide incomplete measurements', () => {
  const report=reportFixture();report.failures=[];report.performance=[];const result=assessScreeningPriority(report,pureBinding('ordinary'),DESIGN_GROUPS);
  assert.equal(result.policy_exit,1);assert.equal(result.performance_acceptance,'unverified');
});
test('current byte review is required when timing is deferred', () => {
  const report=reportFixture(), review={screens:report.screens.map(s=>({key:s.key,sha256:s.sha256}))};
  requireWarningReviewImages(review,report);delete review.screens[0].sha256;assert.throws(()=>requireWarningReviewImages(review,report),/byte hashes/);
});

async function filesFixture(t, scope='ordinary') {
  const root=mkdtempSync(join(tmpdir(),'screening-acceptance-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const currentRoot=join(root,'frontend/dist'), baselineRoot=join(root,'design-baseline/frontend/dist'), output=join(root,'frontend/test-results/design-review');
  mkdirSync(join(currentRoot,'static-data'),{recursive:true});mkdirSync(output,{recursive:true});
  write(join(currentRoot,'index.html'),'<title>Synthetic acceptance fixture</title>');
  write(join(currentRoot,'static-data/manifest.json'),{as_of_date:'2026-10-16',research_generation:H,...(scope==='carry'?{financial_generation:generation}:{})});
  write(join(currentRoot,'static-data/data-quality.json'),{as_of_date:'2026-10-16',total:100,verified:95,minimum_target:.9});
  mkdirSync(join(currentRoot,'static-data/markets/us/charts'),{recursive:true});
  write(join(currentRoot,'static-data/markets/us/charts/SYNTHETIC.json'),{symbol:'SYNTHETIC',bars:[],unknown:null});
  cpSync(join(frontend,'public/static-transport-capability.json'),join(currentRoot,'static-transport-capability.json'));
  cpSync(currentRoot,baselineRoot,{recursive:true});
  let state={decision:{mode:'design'},sourceSha:commit,controllerSha:commit,source:{artifact:{id:1,digest:'sha256:'+H},runId:2,attempt:1,manifestHash:H}};
  if(scope==='carry') {
    const instant=new Date().toISOString(),identity=`1/1/${H}/${H}`,paths=['state.json','attempt.json','source/artifact.zip','source/artifact.tar','companion/artifact.zip','companion/source.json','predecessor.json','history-responses.json','target-base.json','carry-projection.json','history-reconciliation.json','quality.log','retained-universe.json','assessment.json'];
    state={schema:'design-financial-carry-preview-v1',publication_authority:'none',financial_admission:false,ui_sha:commit,ui_tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:frontend,encoding:'utf8'}).trim(),baseline_sha:'b'.repeat(40),baseline_tree:'c'.repeat(40),
      source_financial_generation:'c'.repeat(64),financial_generation:generation,financial_lineage_sha256:'d'.repeat(64),previous_publication_identity:identity,logical_data_inventory_sha256:dataInventoryDigest(currentRoot),
      timestamps:{prepared_at:instant,verified_at:instant},caller:{repository:'kusennjp1-ai/screener',run_id:123,run_attempt:2,event:'pull_request',head_sha:'d'.repeat(40),checkout_sha:commit,started_at:instant},
      source:{artifact_id:1,run_id:2,run_attempt:1,head_sha:commit,artifact_sha256:H,manifest_sha256:H},live:{identity,receipt_sha256:H,manifest_sha256:H,financial_generation:'c'.repeat(64),root_sha256:H},
      evidence:{files:Object.fromEntries(paths.map(path=>[path,H])),source_input_sha256:H,predecessor_history_sha256:H,baseline_sha256:H,audit_inventory_sha256:H},assessment:{compatibility:H,equality:H,retained_universe:H}};
  }
  write(join(root,'design-input-provenance.json'),state);
  const manifestSha=sha256(readFileSync(join(currentRoot,'static-data/manifest.json'))),uiDigest=inventoryDigest(uiInventory(currentRoot));
  await packPublication({root:currentRoot,frontendRoot:frontend,publication:previewPublication({uiSha:commit,uiDigest,manifestSha256:manifestSha}),
    bindings:{sourceCommit:commit,appCommit:commit,candidateId:sha256(readFileSync(join(root,'design-input-provenance.json'))),financialGeneration:scope==='carry'?generation:null,financialLineageSha256:scope==='carry'?'d'.repeat(64):null}});
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kusennjp1-ai/screener',GITHUB_JOB:'design-acceptance',GITHUB_WORKFLOW_REF:'kusennjp1-ai/screener/.github/workflows/design-acceptance.yml@refs/pull/99/merge',GITHUB_REF:'refs/pull/99/merge',GITHUB_EVENT_NAME:'pull_request',GITHUB_SHA:commit,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2',RUNNER_TEMP:root};
  const report=reportFixture(scope);
  for (const screen of report.screens) { const bytes=Buffer.from('Synthetic image byte fixture '+screen.key);write(join(output,screen.screenshot),bytes);screen.sha256=sha256(bytes); }
  if(scope==='carry') for (const [index,item] of report.financial_carry_cases.entries()) {
    const bytes=Buffer.from('Synthetic actual-download byte fixture '+index),artifact=`carry-${index}.csv`;write(join(output,artifact),bytes);
    item.csv={...item.csv,artifact,sha256:sha256(bytes),bytes:bytes.length};
  }
  write(join(output,'report.json'),report);
  const options={report,output,currentRoot,baselineRoot,inputBasis:'same_verified_input',env};
  const before=screeningPriorityBinding({ ...options,commit });
  if(scope==='carry') await sealFinancialCarryDesignReport({report,output,binding:{...before,ui_sha:commit,
    baseline_ui_digest:inventoryDigest(uiInventory(baselineRoot)),transport_generation:JSON.parse(readFileSync(join(currentRoot,'publication.json'))).transport.root.generation}});
  return {root,state,options,before};
}
test('real packed file fixture binds final report and screenshots to same run/UI/all-input hashes',async t=>{
  const f=await filesFixture(t),original=readFileSync(join(f.options.output,'report.json'));
  const assessment=finishScreeningPriority({...f.options,before:f.before,completedGroups:DESIGN_GROUPS});
  assert.equal(assessment.policy_exit,0);assert.deepEqual(checkedScreeningPriority(f.options),assessment);
  assert.deepEqual(readFileSync(join(f.options.output,'report.json')),original);assert.equal(Object.hasOwn(assessment,'raw_exit'),false);
});
for (const [name, change] of [
  ['different run', f=>f.options.env.GITHUB_RUN_ID='124'], ['different attempt', f=>f.options.env.GITHUB_RUN_ATTEMPT='3'],
  ['changed UI', f=>write(join(f.options.currentRoot,'index.html'),'modified')], ['changed baseline', f=>write(join(f.options.baselineRoot,'index.html'),'modified')],
  ['changed source provenance', f=>write(join(f.root,'design-input-provenance.json'),{...f.state,source:{...f.state.source,runId:9}})],
  ['changed report', f=>write(join(f.options.output,'report.json'),{})], ['changed screenshot', f=>write(join(f.options.output,f.options.report.screens[0].screenshot),'modified')],
  ['missing completion', f=>rmSync(join(f.options.output,'screening-priority-completion.json'))],
  ['changed assessment', f=>write(join(f.options.output,'screening-priority-assessment.json'),{})],
  ['future completion clock', f=>{const p=join(f.options.output,'screening-priority-completion.json'),v=JSON.parse(readFileSync(p));v.completed_at=new Date(Date.now()+60000).toISOString();write(p,v);}],
]) test('completed evidence rejects '+name,async t=>{const f=await filesFixture(t);finishScreeningPriority({...f.options,before:f.before,completedGroups:DESIGN_GROUPS});change(f);assert.throws(()=>checkedScreeningPriority(f.options));});
test('progress report and changed-before-finalization input cannot generate accepted completion',async t=>{
  const f=await filesFixture(t);assert.throws(()=>checkedScreeningPriority(f.options));write(join(f.options.baselineRoot,'index.html'),'modified');
  assert.throws(()=>finishScreeningPriority({...f.options,before:f.before,completedGroups:DESIGN_GROUPS}),/changed during/);
});
test('candidate, repaired-financial comparison, limited and non-CI contexts keep strict semantics',async t=>{
  const f=await filesFixture(t);
  for(const extra of [{env:{...f.options.env,FINANCIAL_CANDIDATE_DIR:'/certified'}},{inputBasis:'same_prices_repaired_financials'},{limited:true},{env:{...f.options.env,GITHUB_ACTIONS:'false'}}]) {
    assert.equal(screeningPriorityBinding({...f.options,commit,...extra}),null);
  }
  const source={...f.state,schema_version:'financial-candidate-preview-v2'};write(join(f.root,'design-input-provenance.json'),source);
  assert.equal(screeningPriorityBinding({...f.options,commit}),null);
});
test('malformed provenance and linked provenance cannot select the warning policy',async t=>{
  const f=await filesFixture(t),path=join(f.root,'design-input-provenance.json');write(path,{...f.state,publication_authority:'none'});
  assert.throws(()=>screeningPriorityBinding({...f.options,commit}),/provenance/);
  rmSync(path);symlinkSync(join(f.options.output,'report.json'),path);assert.throws(()=>screeningPriorityBinding({...f.options,commit}),/linked/);
});

test('carry same-run completion retains exact seal and downloaded CSV evidence',async t=>{
  const f=await filesFixture(t,'carry');const result=finishScreeningPriority({...f.options,before:f.before,completedGroups:DESIGN_GROUPS});
  assert.equal(result.policy_exit,0);assert.deepEqual(checkedScreeningPriority(f.options),result);
});
for(const [name,change] of [
  ['different run',f=>f.options.env.GITHUB_RUN_ID='124'],['different attempt',f=>f.options.env.GITHUB_RUN_ATTEMPT='3'],
  ['different event',f=>f.options.env.GITHUB_EVENT_NAME='push'],['different tree',f=>{f.state.ui_tree='e'.repeat(40);write(join(f.root,'design-input-provenance.json'),f.state);}],
]) test('carry provenance rejects '+name,async t=>{const f=await filesFixture(t,'carry');change(f);assert.throws(()=>screeningPriorityBinding({...f.options,commit}));});
for(const [name,change] of [
  ['changed CSV',f=>write(join(f.options.output,'carry-0.csv'),'changed')],
  ['changed seal',f=>{const path=join(f.options.output,'financial-carry-evidence.json'),value=JSON.parse(readFileSync(path));value.objective_failures=0;write(path,value);}],
]) test('carry completion rejects '+name,async t=>{const f=await filesFixture(t,'carry');finishScreeningPriority({...f.options,before:f.before,completedGroups:DESIGN_GROUPS});change(f);assert.throws(()=>checkedScreeningPriority(f.options));});

function runReview(f, {candidate=false, omitHash=false, lowScore=false, absentReview=false}={}) {
  // Emulate only Git ancestry for the CLI fixture. No review, real pixels,
  // authenticated CI or public source acceptance is produced by this test.
  const bin=join(f.root,'bin');mkdirSync(bin);
  const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:frontend,encoding:'utf8'}).trim();
  const git=join(bin,'git');write(git,`#!/usr/bin/env python3\nimport sys\na=sys.argv[1:]\nif a[:1]==['-C']: a=a[2:]\nif a==['rev-parse','--show-toplevel']: print(${JSON.stringify(f.root)})\nelif a==['rev-parse','HEAD']: print(${JSON.stringify(commit)})\nelif a==['rev-parse','HEAD^{tree}']: print(${JSON.stringify(tree)})\n`);chmodSync(git,0o755);
  const directory=join(f.root,'docs/design-review');mkdirSync(directory,{recursive:true});
  if(!absentReview)write(join(directory,'2026-10-21.json'),{observed_commit:commit,reviewer:'synthetic-fixture',evidence_run:'synthetic-fixture',screens:f.options.report.screens.map((screen,index)=>({key:screen.key,screenshot:screen.screenshot,
    ...(!omitHash||index?{sha256:screen.sha256}:{}),scores:Object.fromEntries(['design','usability','originality','content'].map(key=>[key,{value:lowScore?7:8,reason:'synthetic test only'}]))}))});
  const env={...process.env,...f.options.env,PATH:bin+':'+process.env.PATH,DESIGN_INPUT_BASIS:'same_verified_input'};
  delete env.FINANCIAL_CANDIDATE_DIR;if(candidate)env.FINANCIAL_CANDIDATE_DIR='/certified-fixture';
  return spawnSync(process.execPath,[join(frontend,'tools/check-design-review.mjs')],{cwd:join(f.root,'frontend'),env,encoding:'utf8'});
}
test('actual review CLI accepts deferred policy only with complete evidence and reviewed image hashes',async t=>{
  const f=await filesFixture(t);finishScreeningPriority({...f.options,before:f.before,completedGroups:DESIGN_GROUPS});
  const result=runReview(f);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/strict_result=failed; performance=deferred_warning; functional=passed/);assert.match(result.stderr,/Deferred measured timing/);
});
for(const [name,options] of [['candidate',{candidate:true}],['missing current image hash',{omitHash:true}],['low score',{lowScore:true}],['missing current UI review',{absentReview:true}]]) test('actual review CLI rejects '+name,async t=>{
  const f=await filesFixture(t);finishScreeningPriority({...f.options,before:f.before,completedGroups:DESIGN_GROUPS});const result=runReview(f,options);assert.notEqual(result.status,0,result.stdout);
});
test('actual review CLI also requires completion when original failures are empty',async t=>{
  const f=await filesFixture(t);f.options.report.failures=[];write(join(f.options.output,'report.json'),f.options.report);
  const result=runReview(f);assert.notEqual(result.status,0);assert.match(result.stderr,/screening-priority-completion/);
});
