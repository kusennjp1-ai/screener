// Synthetic fixtures test fail-closed contracts only; none is release evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {regularInventory,validateAssessmentExecution,verifyReportEvidence,authenticatedReceiptBytes,stageFrozenInventory,LIMITED_ASSESSMENT_WORKFLOW} from './limited-research-assessment.mjs';
import {bootstrap,sha256,inventoryDigest} from './publication-state.mjs';
import {buildLimitedResearchAssessment,LIMITED_RESEARCH_SCOPE} from '../../frontend/tools/limited-research-assessment.mjs';
import {FINANCIAL_DESIGN_CASES,financialDesignScreens} from '../../frontend/tools/financial-design-cases.mjs';
const sha='a'.repeat(40),date='2026-10-02',generation='synthetic-test-only';
function temporary(t){const root=mkdtempSync(join(tmpdir(),'limited-assessment-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function fixture(t,{failures=[],limitations=[]}={}) {
  const reports=temporary(t),screens=[];
  for(const [width,theme] of [[1440,'dark'],[390,'light']])for(const name of financialDesignScreens({width},theme)) {
    const screenshot=`${name}-${width}-${theme}.png`,bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from(`synthetic byte fixture ${screenshot}`)]);
    writeFileSync(join(reports,screenshot),bytes);screens.push({key:`${name}/${width}/${theme}`,screenshot,sha256:sha256(bytes)});
  }
  const report={assessment_mode:LIMITED_RESEARCH_SCOPE,commit:sha,measured_at:'2026-10-04T15:00:00.000Z',data:{as_of_date:date,research_generation:generation},screens,failures,
    performance:[{label:'current',viewport:{width:1440},runs:Array.from({length:3},()=>({candidate_ms:5000,method_switch_ms:600,longest_initial_task_ms:300})),candidate_median_ms:5000,maximum_switch_ms:600,longest_initial_task_ms:300}],
    financial_cases:FINANCIAL_DESIGN_CASES.flatMap(item=>[[1440,'dark'],[390,'light']].map(([width,theme])=>({...item,viewport:{width},theme,
      csv:{fixture:true},selection:{fixture:true},purchase:{fixture:true},financial_rows:[{fixture:true}],financial_evaluated_at:'2026-10-04T15:00:00.000Z',
      as_of_date:date,research_generation:generation,source:{unknown:1,qualified:false,original_category:{category:item.category,status:'unavailable',reason:'Synthetic fixture'}}}))),
  };
  const save=()=>{writeFileSync(join(reports,'report.json'),JSON.stringify(report));writeFileSync(join(reports,'limited-assessment.json'),JSON.stringify(buildLimitedResearchAssessment(report,[])));};save();
  return {reports,report,save,limitations,uiSha:sha,measurementExitCode:failures.length?1:0};
}

test('capture proposes measured timing limitations without approving them or changing the failing Design evidence',t=>{
  const failures=['1440: Q1 candidate median 5000ms > 4200ms','1440: Q1 method switch 600ms > 480ms','1440: P1 exact limits not met (3500ms / 400ms / 200ms)'];
  const f=fixture(t,{failures,limitations:failures}),before=readFileSync(join(f.reports,'report.json'));
  const result=verifyReportEvidence(f);
  assert.deepEqual(result.assessment.original_design_failures,failures);assert.equal(result.assessment.publication_authority,'none');
  assert.deepEqual(readFileSync(join(f.reports,'report.json')),before);
  assert.equal(JSON.parse(result.originalAssessmentBytes).accepted_performance_limitations.length,0);
  assert.ok(JSON.parse(result.originalAssessmentBytes).blocking_failures.length>0);
  assert.deepEqual(JSON.parse(result.assessmentBytes).accepted_performance_limitations,failures);
  assert.throws(()=>verifyReportEvidence({...f,measurementExitCode:0}),/original Design exit/);
  assert.throws(()=>verifyReportEvidence({...f,measurementExitCode:17}),/normal original Design result/);
});

test('nonperformance, fabricated timing, changed assessment and missing case cannot seal',t=>{
  const f=fixture(t,{failures:['home/1440/dark: axe 1 rule violations'],limitations:['home/1440/dark: axe 1 rule violations']});
  assert.throws(()=>verifyReportEvidence(f),/non-waivable/);
  const g=fixture(t,{failures:['1440: Q1 candidate median 5999ms > 4200ms']});
  assert.throws(()=>verifyReportEvidence(g),/non-waivable/);
  const h=fixture(t);writeFileSync(join(h.reports,'limited-assessment.json'),'{}');assert.throws(()=>verifyReportEvidence(h),/does not derive/);
  const i=fixture(t);i.report.financial_cases.pop();i.save();assert.throws(()=>verifyReportEvidence(i),/non-waivable/);
});

test('screenshot bytes are mandatory, hashed, unique, nonlinked PNG members',t=>{
  for(const mode of ['changed','missing','link','wrong-type','duplicate','escape']) {
    const f=fixture(t),screen=f.report.screens[0],path=join(f.reports,screen.screenshot);
    if(mode==='changed')writeFileSync(path,'changed');
    if(mode==='missing')rmSync(path);
    if(mode==='link'){const bytes=readFileSync(path);rmSync(path);writeFileSync(join(f.reports,'target.png'),bytes);symlinkSync('target.png',path);}
    if(mode==='wrong-type'){writeFileSync(path,'not png, synthetic fixture');screen.sha256=sha256(readFileSync(path));f.save();}
    if(mode==='duplicate'){f.report.screens[1].screenshot=screen.screenshot;f.save();}
    if(mode==='escape'){screen.screenshot='../escape.png';f.save();}
    assert.throws(()=>verifyReportEvidence(f),undefined,mode);
  }
});

test('capture inventory rejects links and size overflow and hashes real file bytes',t=>{
  const root=temporary(t);mkdirSync(join(root,'evidence'));writeFileSync(join(root,'evidence/file.json'),'original');
  assert.deepEqual(regularInventory(root),{'evidence/file.json':sha256('original')});
  assert.throws(()=>regularInventory(root,{maximumBytes:1}),/bounded bytes/);
  symlinkSync('file.json',join(root,'evidence/link.json'));assert.throws(()=>regularInventory(root),/links and special/);
});

function gitFixture(t) {
  const root=temporary(t),path='.github/limited-research-preview/timings.json';mkdirSync(join(root,'.github/limited-research-preview'),{recursive:true});writeFileSync(join(root,path),'["measured exact failure"]\n');
  execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','synthetic contract fixture'],{cwd:root});
  return {root,path,sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()};
}


test('assessment execution rejects nonmanual, nonmain, stale head, swapped workflow and superseded attempts',t=>{
  const f=gitFixture(t),env={CI:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:bootstrap.repository,GITHUB_REF:'refs/heads/main',GITHUB_SHA:f.sha,GITHUB_WORKFLOW_SHA:f.sha,GITHUB_WORKFLOW_REF:`${bootstrap.repository}/${LIMITED_ASSESSMENT_WORKFLOW}@refs/heads/main`,GITHUB_RUN_ID:'100',GITHUB_RUN_ATTEMPT:'1'};
  const run={id:100,run_attempt:1,path:LIMITED_ASSESSMENT_WORKFLOW,head_sha:f.sha,head_branch:'main',event:'workflow_dispatch',status:'in_progress',conclusion:null,repository:{full_name:bootstrap.repository},head_repository:{full_name:bootstrap.repository}};
  const response={head:f.sha,run};
  const api=endpoint=>endpoint.endsWith('/git/ref/heads/main')?{object:{sha:response.head}}:endpoint.includes('/actions/runs/')?response.run:{full_name:bootstrap.repository,default_branch:'main'};
  assert.deepEqual(validateAssessmentExecution({root:f.root,env,api}),{revision:f.sha,id:100,attempt:1});
  for(const change of [{GITHUB_EVENT_NAME:'push'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_SHA:sha},{GITHUB_WORKFLOW_SHA:sha},{GITHUB_RUN_ATTEMPT:'0'},{GITHUB_WORKFLOW_REF:'other'}])assert.throws(()=>validateAssessmentExecution({root:f.root,env:{...env,...change},api}),/exact main/);
  response.head=sha;assert.throws(()=>validateAssessmentExecution({root:f.root,env,api}),/no longer current main/);response.head=f.sha;
  for(const change of [{run_attempt:2},{path:'.github/workflows/design-acceptance.yml'},{status:'completed',conclusion:'success'},{head_repository:{full_name:'attacker/fork'}}]){response.run={...run,...change};assert.throws(()=>validateAssessmentExecution({root:f.root,env,api}),/exact active assessment attempt/);}
});


test('raw authenticated predecessor JSON bytes are preserved rather than reformatted',()=>{
  const raw=Buffer.from('{ "schema": 1, "synthetic":true }\n'),live={receiptBytes:raw,receiptHash:sha256(raw)};
  assert.equal(authenticatedReceiptBytes(live),raw);
  assert.throws(()=>authenticatedReceiptBytes({...live,receiptBytes:JSON.stringify(JSON.parse(raw))}),/raw authenticated/);
  assert.throws(()=>authenticatedReceiptBytes({receipt:{schema:1},receiptHash:sha256(raw)}),/raw authenticated/);
});

test('stale or future measurement clocks and symlinked reports are never sealed',t=>{
  const f=fixture(t);
  assert.throws(()=>verifyReportEvidence({...f,notBefore:'2026-10-05T00:00:00Z'}),/measurement clock/);
  assert.throws(()=>verifyReportEvidence({...f,notBefore:'2026-10-01T00:00:00Z',now:Date.parse('2026-10-02T00:00:00Z')}),/measurement clock/);
  const path=join(f.reports,'report.json'),bytes=readFileSync(path);rmSync(path);writeFileSync(join(f.reports,'actual.json'),bytes);symlinkSync('actual.json',path);
  assert.throws(()=>verifyReportEvidence(f),/bounded regular/);
});


test('bundle keeps exact frozen inventory without duplicating original logical data bytes',t=>{
  const root=temporary(t),bundle=join(root,'bundle'),frozen=join(bundle,'frozen'),destination=join(root,'frozen-original');
  mkdirSync(join(frozen,'static-data'),{recursive:true});writeFileSync(join(frozen,'static-data/manifest.json'),'synthetic manifest');writeFileSync(join(frozen,'research-daily.json'),'synthetic rows');
  const files=regularInventory(frozen),expectedDigest=inventoryDigest(files);
  assert.deepEqual(stageFrozenInventory({bundle,destination,expectedDigest}),files);
  assert.deepEqual(regularInventory(destination),files);
  assert.deepEqual(JSON.parse(readFileSync(join(bundle,'evidence/frozen-inventory.json'))),files);
  assert.deepEqual(Object.keys(regularInventory(bundle)),['evidence/frozen-inventory.json']);
});

test('frozen inventory retirement rejects altered data, unexpected UI members, and occupied scratch',t=>{
  for(const mode of ['altered','extra-ui','occupied']){
    const root=temporary(t),bundle=join(root,'bundle'),frozen=join(bundle,'frozen'),destination=join(root,'frozen-original');mkdirSync(frozen,{recursive:true});writeFileSync(join(frozen,'research-daily.json'),'original');
    const expectedDigest=inventoryDigest(regularInventory(frozen));
    if(mode==='altered')writeFileSync(join(frozen,'research-daily.json'),'changed');
    if(mode==='extra-ui')writeFileSync(join(frozen,'index.html'),'unexpected');
    if(mode==='occupied')mkdirSync(destination);
    assert.throws(()=>stageFrozenInventory({bundle,destination,expectedDigest}),/frozen/);
    assert.ok(readFileSync(join(frozen,'research-daily.json')).length>0);
  }
});
