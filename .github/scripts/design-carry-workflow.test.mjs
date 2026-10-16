import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const workflow=readFileSync(new URL('../workflows/design-acceptance.yml',import.meta.url),'utf8');
const adapter=readFileSync(new URL('./design-financial-carry.mjs',import.meta.url),'utf8');
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
test('packing step retains read-only token for independent source reauthentication',()=>{assert.match(workflow,/name: Build both production versions[^\n]*\n\s+env:\n\s+GH_TOKEN: \$\{\{ github.token \}\}/);});
test('one ordinary dataset is prepared before both UI copies, including all top-level JSON',()=>{const prepare=workflow.indexOf('design-financial-carry.mjs prepare'),copy=workflow.indexOf('cp -a frontend/public/static-data'),build=workflow.indexOf('for target in baseline current');assert.ok(prepare>0&&copy>prepare&&build>copy);for(const file of ['research-daily.json','portfolio-model.json','qualification-audit.json','ibd-reference.json'])assert.ok(workflow.slice(prepare,build).includes(file));assert.match(workflow.slice(prepare,build),/dataInventoryDigest\(process.argv\[1\]\).*dataInventoryDigest\(process.argv\[2\]\)/);});
test('ordinary build is Vite-only after copy and leaves a real raw baseline',()=>{const build=workflow.slice(workflow.indexOf('for target in baseline current'),workflow.indexOf('Measure all routes'));assert.match(build,/if \[ -n "\$\{FINANCIAL_CANDIDATE_DIR:-\}" \]; then\n\s+# Existing correction comparisons retain their separate baseline.\n\s+\(cd "\$source" && node tools\/export-research.mjs && node tools\/record-candidate-history.mjs\)\n\s+fi/);assert.match(build,/npx vite build/);assert.doesNotMatch(build,/npm run build|ln -s "\$RUNNER_TEMP\/design-\$target-data"/);assert.match(build,/mv "\$RUNNER_TEMP\/design-\$target-data" "\$source\/dist\/static-data"/);});
test('preview cannot enter seal/candidate output, and failure evidence is retained',()=>{assert.equal((workflow.match(/if: success\(\) && steps.financial.outputs.candidate == 'true' && env.DESIGN_CARRY_PREVIEW_PROVENANCE == ''/g)||[]).length,2);assert.match(workflow,/name: Preserve all results even when a budget fails\n\s+if: always\(\)/);assert.match(workflow,/design-carry-evidence\//);assert.match(workflow,/frontend\/test-results\/design-review\//);assert.doesNotMatch(adapter,/writeFinancialReleaseReceipt|selectOrdinaryCarryAdmission|publisherToolingBoundary|design-seal/);});
test('adapter uses unchanged carry/history/quality gates and no provider acquisition',()=>{for(const token of ['checkedExport','verifyArchive','livePublication','restorePublishedFinancialSource','prepareHistoryReconciliation','writeHistoryPayloads','commitHistoryCatalogs','restorePackedHistory','prepareCarryHistory','readCarryTargetBase','loadFinancialGenerationCarry','verifyCarriedBundle','verifyReconciledPerformance','check-data-quality.mjs','assessRetainedUniverse'])assert.ok(adapter.includes(token),token);assert.doesNotMatch(adapter,/export-financial-history\.py|yfinance|requests\.get|FINANCIAL_EVALUATED_AT:process.env/);assert.match(adapter,/evaluatedAt:Date.now\(\)/);});

test('real carry replay uses one fixed memory budget without allowing runtime hooks',()=>{assert.match(workflow,/node --max-old-space-size=4096 \.github\/scripts\/design-financial-carry.mjs prepare/);assert.match(workflow,/node --max-old-space-size=4096 \.github\/scripts\/design-transport.mjs/);assert.match(adapter,/process.execArgv.length===1&&process.execArgv\[0\]==='--max-old-space-size=4096'/);assert.match(adapter,/process.env.NODE_OPTIONS\|\|process.env.NODE_PATH/);});
