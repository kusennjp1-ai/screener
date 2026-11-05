import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
// market-study-archive.yml copies this workflow's study output to a release;
// its contracts run with this file in CI (ci.yml lists test files explicitly).
import './market-study-archive-workflow.test.mjs';
const workflow=readFileSync(new URL('../workflows/design-acceptance.yml',import.meta.url),'utf8');
const adapter=readFileSync(new URL('./design-financial-carry.mjs',import.meta.url),'utf8');
// Step-local structural contracts avoid confusing a neighbouring step's token or
// condition with this step. These exact guards deliberately fail on broadening.
const stepBlocks=workflow.match(/^      - (?:name|uses|run):[^\n]*(?:\n(?!      - )[^\n]*)*/gm)||[];
const step=header=>{const matches=stepBlocks.filter(value=>value.split('\n')[0]===`      - ${header}`);assert.equal(matches.length,1,header);return matches[0];};
const condition=body=>{const matches=[...body.matchAll(/^        if: (.*)$/gm)];assert.ok(matches.length<=1,'duplicate step conditions');return matches[0]?.[1]??null;};
const expectCondition=(header,expected)=>assert.equal(condition(step(header)),expected,header);

test('Design keeps read-only permissions and pins the reviewed receipt-linked baseline',()=>{
  assert.match(workflow,/permissions:\n  contents: read\n  actions: read/);
  const baseline='1e1943e1d5f78a738a05baa69eb9f2e8508e32ac';
  assert.ok(workflow.includes(`default: '${baseline}'`));
  assert.ok(workflow.includes(`BASELINE_REF: \${{ inputs.baseline_ref || '${baseline}' }}`));
  assert.doesNotMatch(workflow,/contents: write|actions: write|id-token: write/);
});
test('baseline fetch requires an exact SHA and fails closed before clone on ambiguity or mismatch',()=>{
  const start=workflow.indexOf('          if [[ ! "$BASELINE_REF" =~ ^[0-9a-f]{40}$ ]]');
  const clone=workflow.indexOf('          git clone --shared');
  assert.ok(start>0&&clone>start);
  const guard=workflow.slice(start,clone).replace(/^          /gm,'');
  assert.ok(guard.includes('git fetch --no-tags -- origin "$BASELINE_REF"'));
  assert.ok(guard.includes(`test "$(git rev-parse --verify 'FETCH_HEAD^{commit}')" = "$BASELINE_REF"`));
  assert.ok(workflow.includes('test "$(git -C "$RUNNER_TEMP/design-baseline" rev-parse HEAD)" = "$BASELINE_REF"'));
  // Shell-only guard tests: fake git emits metadata; no network or clone runs.
  const git='git() { if [ "$1" = fetch ]; then echo FETCH; elif [ "$1" = rev-parse ]; then printf "%s\\n" "$FETCHED_SHA"; else return 97; fi; };\n';
  const sha='1e1943e1d5f78a738a05baa69eb9f2e8508e32ac';
  const run=(ref,fetched=sha)=>execFileSync('bash',['-euo','pipefail','-c',git+guard],{env:{...process.env,BASELINE_REF:ref,FETCHED_SHA:fetched},encoding:'utf8',stdio:'pipe'});
  assert.equal(run(sha).trim(),'FETCH');
  for(const ref of ['main','cd3a6a2','refs/heads/main','--upload-pack=bad','A'.repeat(40),'g'.repeat(40)])assert.throws(()=>run(ref),error=>error.status===1&&!String(error.stdout).includes('FETCH'));
  assert.throws(()=>run(sha,'b'.repeat(40)),error=>error.status===1&&String(error.stdout).includes('FETCH'));
});
test('packing step retains read-only token and reauthenticates every fresh source',()=>{
  const build=step('name: Build the current UI and verify its packed transport');
  assert.equal(condition(build),null);
  assert.match(build,/^        env:\n          GH_TOKEN: \$\{\{ github.token \}\}/m);
});
test('one ordinary dataset is prepared before the comparison copy and the build, including all top-level JSON',()=>{const prepare=workflow.indexOf('design-financial-carry.mjs prepare'),copy=workflow.indexOf('cp -a frontend/public/static-data "$comparison/static-data"'),build=workflow.indexOf('(cd "$source" && npx vite build)');assert.ok(prepare>0&&copy>prepare&&build>copy);for(const file of ['research-daily.json','portfolio-model.json','qualification-audit.json','ibd-reference.json'])assert.ok(workflow.slice(prepare,build).includes(file));assert.match(workflow.slice(prepare,build),/dataInventoryDigest\(process.argv\[1\]\).*dataInventoryDigest\(process.argv\[2\]\)/);assert.ok(workflow.includes('comparison="$RUNNER_TEMP/design-baseline/frontend/dist"'));});
test('the current build is Vite-only after the checked input and keeps the data tree out of the build',()=>{const build=step('name: Build the current UI and verify its packed transport');assert.match(build,/mv "\$source\/public\/static-data" "\$RUNNER_TEMP\/design-current-data"/);assert.match(build,/npx vite build/);assert.doesNotMatch(build,/npm run build|export-research|record-candidate-history/);assert.match(build,/mv "\$RUNNER_TEMP\/design-current-data" "\$source\/dist\/static-data"/);assert.equal((workflow.match(/npx vite build/g)||[]).length,1);});
test('preview cannot enter seal/candidate output, and failure evidence is retained',()=>{
  const guard="(success() && steps.financial.outputs.candidate == 'true' && env.DESIGN_CARRY_PREVIEW_PROVENANCE == '')";
  expectCondition('name: Seal the exact tested financial candidate',guard);
  expectCondition('name: Retain the exact tested financial candidate',guard);
  expectCondition('name: Preserve all results even when a budget fails','(always())');
  assert.match(workflow,/design-carry-evidence\//);assert.match(workflow,/frontend\/test-results\/design-review\//);
  assert.match(step('name: Preserve all results even when a budget fails'),/name: design-acceptance-\$\{\{ github.sha \}\}/);
  assert.doesNotMatch(adapter,/writeFinancialReleaseReceipt|selectOrdinaryCarryAdmission|publisherToolingBoundary|design-seal/);
});
test('adapter uses unchanged carry/history/quality gates and no provider acquisition',()=>{for(const token of ['checkedExport','verifyArchive','livePublication','restorePublishedFinancialSource','prepareHistoryReconciliation','writeHistoryPayloads','commitHistoryCatalogs','restorePackedHistory','prepareCarryHistory','readCarryTargetBase','loadFinancialGenerationCarry','verifyCarriedBundle','verifyReconciledPerformance','check-data-quality.mjs','assessRetainedUniverse'])assert.ok(adapter.includes(token),token);assert.doesNotMatch(adapter,/export-financial-history\.py|yfinance|requests\.get|FINANCIAL_EVALUATED_AT:process.env/);assert.match(adapter,/evaluatedAt:Date.now\(\)/);});

test('real carry replay uses one fixed memory budget without allowing runtime hooks',()=>{assert.match(workflow,/node --max-old-space-size=4096 \.github\/scripts\/design-financial-carry.mjs prepare/);assert.match(workflow,/node --max-old-space-size=4096 \.github\/scripts\/design-transport.mjs/);assert.match(adapter,/process.execArgv.length===1&&process.execArgv\[0\]==='--max-old-space-size=4096'/);assert.match(adapter,/process.env.NODE_OPTIONS\|\|process.env.NODE_PATH/);});


test('Design allows a finite 120-minute job without changing runner or acceptance gates',()=>{
  assert.match(workflow,/runs-on: ubuntu-latest\n(?:\s*#[^\n]*\n)*\s+timeout-minutes: 120\n/);
  assert.equal((workflow.match(/timeout-minutes:/g)||[]).length,1);
  assert.doesNotMatch(workflow,/continue-on-error:/);
  const gate=step('name: Require every capture, no objective failure, and reviewed scores or the owner waiver');
  assert.equal(condition(gate),'(always())');
  assert.match(gate,/^        working-directory: frontend$/m);
  assert.match(gate,/^        run: node tools\/check-design-review\.mjs$/m);
  assert.equal((workflow.match(/run: node tools\/check-design-review\.mjs/g)||[]).length,1);
  assert.match(workflow,/\n    name: Real-data design and performance budgets\n/);
  assert.match(workflow,/\njobs:\n  design-acceptance:\n/);
});
test('UTC stage markers bracket preparation, the build, full transport and browser work',()=>{
  const pairs=[['carry-prepare','node --max-old-space-size=4096 .github/scripts/design-financial-carry.mjs prepare'],['vite-current','(cd "$source" && npx vite build)'],['transport-verify-pack-roundtrip','node --max-old-space-size=4096 .github/scripts/design-transport.mjs'],['browser-measurements','node tools/design-review.mjs']];
  for(const [stage,command]of pairs){
    const start=workflow.indexOf(`echo "Design stage: $(date -u +%FT%TZ) ${stage} start"`),run=workflow.indexOf(command,start),complete=workflow.indexOf(`echo "Design stage: $(date -u +%FT%TZ) ${stage} complete"`);
    assert.ok(start>=0&&run>start&&complete>run,stage);
  }
});
test('browser timing preserves nonzero exit and never logs false completion',()=>{
  const start=workflow.indexOf('      - name: Measure the brief screens'),end=workflow.indexOf('      - name: Require every capture',start);
  assert.ok(start>=0&&end>start);
  const step=workflow.slice(start,end);assert.match(step,/shell: bash\n\s+run: \|\n\s+set -euo pipefail/);
  const script=step.slice(step.indexOf('          set -euo pipefail')).replace(/^          /gm,'');
  // Shell-only fixture: no browser, provider, source authentication or real Node process runs.
  const stub='date() { printf "2026-10-16T05:00:00Z\\n"; }; node() { printf "browser fixture\\n"; return "$BROWSER_STATUS"; };\n';
  const run=status=>execFileSync('bash',['-euo','pipefail','-c',stub+script],{env:{...process.env,BROWSER_STATUS:String(status)},encoding:'utf8',stdio:'pipe'});
  assert.match(run(0),/browser-measurements start[^]*browser fixture[^]*browser-measurements complete/);
  assert.throws(()=>run(17),error=>error.status===17&&/browser-measurements start/.test(String(error.stdout))&&!/browser-measurements complete/.test(String(error.stdout)));
});

test('Design has one isolated pinned offline calendar runtime before candidate preparation',()=>{
  const setup=workflow.indexOf('      - uses: actions/setup-python@v5'),install=workflow.indexOf('Install isolated offline exchange calendar runtime'),prepare=workflow.indexOf('Prepare the certified financial candidate');
  assert.ok(setup>=0&&install>setup&&prepare>install);
  expectCondition('uses: actions/setup-python@v5',null);
  expectCondition('name: Install isolated offline exchange calendar runtime',null);
  expectCondition('name: Prepare the certified financial candidate',null);
  assert.equal((workflow.match(/uses: actions\/setup-python@v5/g)||[]).length,1);
  assert.match(workflow,/session-calendar-runtime\/bin\/python.*pip install -r \.github\/scripts\/session-calendar-requirements\.txt/);
  assert.match(workflow,/SESSION_CALENDAR_PYTHON=\$RUNNER_TEMP\/session-calendar-runtime\/bin\/python/);
  const requirements=readFileSync(new URL('./session-calendar-requirements.txt',import.meta.url),'utf8');
  assert.match(requirements,/pandas-market-calendars==5\.4\.0/);
  assert.match(requirements,/exchange-calendars==4\.11\.2/);
  assert.doesNotMatch(requirements,/yfinance|curl_cffi/);
});
test('calendar derivation runs only after source verification and before baseline hashing, including replay',()=>{
  const helper=adapter.slice(adapter.indexOf('async function prepareBaseline'),adapter.indexOf('async function coverage'));
  assert.ok(helper.indexOf('prepareDesignSessionCalendar(frontend,root,evaluatedAt)')>=0);
  assert.ok(helper.indexOf('prepareDesignSessionCalendar')<helper.indexOf('exporter(frontend,root'));
  const prepare=adapter.slice(adapter.indexOf('export async function prepareDesignCarryPreview'),adapter.indexOf('export async function verifyDesignCarryPreview'));
  assert.ok(prepare.indexOf("'selected source'")<prepare.indexOf('await prepareBaseline'));
  assert.ok(prepare.indexOf('await prepareBaseline')<prepare.indexOf("copyData(root,join(evidence,'baseline'))"));
  const verify=adapter.slice(adapter.indexOf('export async function verifyDesignCarryPreview'));
  assert.match(verify,/prepareBaseline\(\{root:replay,frontend:frontendRoot,evidence,state,evaluatedAt:record\.timestamps\.prepared_at\}\)/);
  assert.ok(verify.indexOf('await prepareBaseline')<verify.indexOf('Design complete nonfinancial baseline changed'));
  assert.match(adapter,/source_input_sha256:dataInventoryDigest\(raw\)/);
  assert.match(adapter,/baseline_sha256:dataInventoryDigest\(join\(evidence,'baseline'\)\)/);
});
test('non-carry Design derives once before shared input copy and never calls the price-provider mode',()=>{
  const calendar=workflow.indexOf('tools/export-book-benchmark.py --calendar-only');
  const carry=workflow.indexOf('design-financial-carry.mjs prepare'),copy=workflow.indexOf('cp -a frontend/public/static-data');
  assert.ok(calendar>carry&&calendar<copy);
  assert.match(workflow.slice(calendar,copy),/--root public\/static-data --evaluated-at/);
  assert.equal((workflow.match(/export-book-benchmark\.py/g)||[]).length,1);
  assert.match(workflow,/env -u GH_TOKEN -u GITHUB_TOKEN \"\$SESSION_CALENDAR_PYTHON\" -I tools\/export-book-benchmark\.py/);
  assert.doesNotMatch(workflow.slice(calendar,copy),/--allow-unavailable/);
});

test('the retired screens leave no prior-capture reuse, baseline UI build, radar benchmark or compact package',()=>{
  for(const retired of ['design-capture-lifecycle','build-radar-benchmark','prepare-compact-design','BASELINE_BUILD','RADAR_BUILD','steps.prior','reviewable-design-capture','limited-research'])assert.ok(!workflow.includes(retired),retired);
  assert.match(step('name: Measure the brief screens, accessibility and CPU 4x'),/^        id: measure$/m);
  assert.match(step('name: Measure the brief screens, accessibility and CPU 4x'),/^          DESIGN_INPUT_PROVENANCE: \$\{\{ runner.temp \}\}\/design-input-provenance.json$/m);
  assert.ok(workflow.indexOf('run: npm ci --no-audit --no-fund')<workflow.indexOf('name: Prepare the certified financial candidate'));
});
test('every stage keeps its exact condition',()=>{
  const request="(hashFiles('.github/financial-release-request.json') != '')";
  const guards=[
    ['run: npx playwright install --with-deps chromium',null],['uses: actions/setup-python@v5',null],
    ['name: Install isolated offline exchange calendar runtime',null],
    ['name: Install certified offline projection dependencies',request],['name: Verify isolated offline native projection runtime',request],
    ['name: Prepare the certified financial candidate',null],['name: Refuse a financial candidate without a brief financial-display contract',"steps.financial.outputs.candidate == 'true'"],
    ['name: Restore checked input and prepare the carry comparison data',null],
    ['name: Diagnostic market-regime study (never a gate)',null],
    ['name: Build the current UI and verify its packed transport',null],['name: Measure the brief screens, accessibility and CPU 4x',null],
    ['name: Require every capture, no objective failure, and reviewed scores or the owner waiver','(always())'],
    ['name: Package UNAPPROVED financial diagnostics after unsuccessful Design',"((failure() || cancelled()) && steps.financial.outcome == 'success' && steps.financial.outputs.candidate == 'true')"],
    ['name: Retain UNAPPROVED financial diagnostics for review only',"((failure() || cancelled()) && steps.financial.outcome == 'success' && steps.financial.outputs.candidate == 'true' && steps.financial_diagnostic.outcome == 'success')"],
    ['name: Seal the exact tested financial candidate',"(success() && steps.financial.outputs.candidate == 'true' && env.DESIGN_CARRY_PREVIEW_PROVENANCE == '')"],
    ['name: Retain the exact tested financial candidate',"(success() && steps.financial.outputs.candidate == 'true' && env.DESIGN_CARRY_PREVIEW_PROVENANCE == '')"],
    ['name: Preserve all results even when a budget fails','(always())'],
  ];
  assert.equal(guards.length,17);
  for(const [header,expected]of guards)expectCondition(header,expected);
  assert.equal(stepBlocks.filter(block=>/^      - name: /.test(block)).length,guards.length-2);
});
test('a financial candidate fails closed before input restore and measurement',()=>{
  const refusal=step('name: Refuse a financial candidate without a brief financial-display contract');
  assert.match(refusal,/exit 1/);
  assert.ok(workflow.indexOf('name: Prepare the certified financial candidate')<workflow.indexOf('name: Refuse a financial candidate'));
  assert.ok(workflow.indexOf('name: Refuse a financial candidate')<workflow.indexOf('name: Restore checked input'));
  assert.doesNotMatch(step('name: Restore checked input and prepare the carry comparison data'),/FINANCIAL_CANDIDATE_DIR|same_prices_repaired_financials/);
  assert.match(step('name: Restore checked input and prepare the carry comparison data'),/echo "DESIGN_INPUT_BASIS=same_verified_input" >> "\$GITHUB_ENV"/);
});
test('the market-regime study is a diagnostic: restored input only, runner-temp output, never a Design failure',async()=>{
  const {mkdtempSync,writeFileSync,rmSync,readFileSync:read,existsSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const header='name: Diagnostic market-regime study (never a gate)',body=step(header);
  assert.equal(condition(body),null);
  const restore=workflow.indexOf('      - name: Restore checked input and prepare the carry comparison data'),study=workflow.indexOf(`      - ${header}`),build=workflow.indexOf('      - name: Build the current UI and verify its packed transport');
  assert.ok(restore>=0&&study>restore&&build>study,'between the restored input and the build that moves it');
  assert.match(body,/^        shell: bash$/m);
  assert.match(body,/^          STUDY_OUT: \$\{\{ runner.temp \}\}\/market-regime-study$/m);
  assert.doesNotMatch(body,/GH_TOKEN: |GITHUB_TOKEN: |secrets\.|continue-on-error|timeout-minutes|working-directory/);
  assert.match(body,/node frontend\/tools\/market-regime-study\.mjs --history frontend\/public\/static-data --yahoo /);
  const targets=[...body.matchAll(/(?:--out|--markdown|--save-indices|>>?)\s+("?[^\s"]+"?)/g)];
  assert.ok(targets.length>=4);
  for(const match of targets)assert.match(match[1],/^"\$(?:STUDY_OUT\/|GITHUB_STEP_SUMMARY")/,match[0]);
  assert.match(body,/^          study \|\| echo '::warning title=Market-regime study unavailable::Diagnostic only; the Design result is unaffected\.'$/m);
  assert.match(step('name: Preserve all results even when a budget fails'),/^            \$\{\{ runner.temp \}\}\/market-regime-study\/$/m);
  // The one preserved Design artifact is the study's only upload (no new failure
  // point before the build); it is kept 90 days so market-study-archive.yml can
  // copy the study to a release.
  assert.match(step('name: Preserve all results even when a budget fails'),/\n          retention-days: 90\n?$/);
  assert.equal((workflow.match(/\$\{\{ runner.temp \}\}\/market-regime-study\//g)||[]).length,1,'only the Design artifact holds the study');
  assert.equal(stepBlocks[stepBlocks.indexOf(body)+1].split('\n')[0],'      - name: Build the current UI and verify its packed transport','no upload between the study and the build');
  // Shell-only fixture with the runner's bash flags: stub node/python executables, no provider request.
  const script=body.slice(body.indexOf('        run: |\n')+'        run: |\n'.length).replace(/^          /gm,'');
  const dir=mkdtempSync(join(tmpdir(),'market-regime-step-'));
  try{
    writeFileSync(join(dir,'node'),'#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$FIXTURE/node-args"\nenv > "$FIXTURE/node-env"\nif [ "$NODE_STATUS" = 0 ]; then printf "# study fixture\\n" > "$STUDY_OUT/results.md"; fi\nexit "$NODE_STATUS"\n',{mode:0o755});
    writeFileSync(join(dir,'python'),'#!/usr/bin/env bash\nenv > "$FIXTURE/python-env"\n[ "$PY_STATUS" = 0 ] || exit "$PY_STATUS"\nprintf "[\\"2026-11-03\\"]" > "${@: -1}"\n',{mode:0o755});
    const run=(node,python)=>{
      const out=join(dir,`out-${node}-${python}`),summary=join(dir,`summary-${node}-${python}`);writeFileSync(summary,'');
      const stdout=execFileSync('bash',['--noprofile','--norc','-eo','pipefail','-c',script],{env:{PATH:`${dir}:${process.env.PATH}`,FIXTURE:dir,STUDY_OUT:out,GITHUB_STEP_SUMMARY:summary,SESSION_CALENDAR_PYTHON:join(dir,'python'),NODE_STATUS:String(node),PY_STATUS:String(python),GH_TOKEN:'job-token-fixture',GITHUB_TOKEN:'job-token-fixture'},encoding:'utf8',stdio:'pipe'});
      return {stdout,summary:read(summary,'utf8'),args:read(join(dir,'node-args'),'utf8').trim().split('\n'),out};
    };
    const ok=run(0,0);
    assert.match(ok.stdout,/# study fixture/);assert.equal(ok.summary,'# study fixture\n');assert.doesNotMatch(ok.stdout,/::warning/);
    assert.deepEqual(ok.args.slice(0,5),['frontend/tools/market-regime-study.mjs','--history','frontend/public/static-data','--yahoo','--calendar']);
    assert.equal(ok.args[5],join(ok.out,'nyse-sessions.json'));assert.ok(existsSync(ok.args[5]));
    for(const file of ['node-env','python-env'])assert.doesNotMatch(read(join(dir,file),'utf8'),/job-token-fixture/,file);
    const failed=run(3,0);
    assert.match(failed.stdout,/::warning title=Market-regime study unavailable::/);assert.equal(failed.summary,'');
    const noCalendar=run(0,1);
    assert.match(noCalendar.stdout,/::warning title=Market-regime study::Independent NYSE calendar unavailable/);
    assert.ok(!noCalendar.args.includes('--calendar'));assert.equal(noCalendar.summary,'# study fixture\n');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
