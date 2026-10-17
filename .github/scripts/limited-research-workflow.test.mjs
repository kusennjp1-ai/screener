import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const assessment=read('../workflows/limited-research-assessment.yml'),release=read('../workflows/research-ui-release.yml'),design=read('../workflows/design-acceptance.yml'),helper=read('./limited-research-assessment.mjs');
const step=(text,name)=>{const start=text.indexOf(`      - name: ${name}\n`);assert.ok(start>=0,name);const end=text.indexOf('\n      - ',start+1);return text.slice(start,end<0?undefined:end);};

test('limited assessment is separate, manual, exact-main, read-only and never deploys',()=>{
  assert.match(assessment,/on:\n  workflow_dispatch:/);assert.doesNotMatch(assessment,/\n  (?:push|pull_request|workflow_run|schedule):/);
  assert.match(assessment,/permissions:\n  contents: read\n  actions: read/);assert.doesNotMatch(assessment,/contents: write|actions: write|pages:|id-token:|deploy-pages|upload-pages-artifact|environment:/);
  assert.match(assessment,/if: github.ref == 'refs\/heads\/main'/);assert.match(assessment,/test "\$UI_SHA" = "\$GITHUB_SHA"/);assert.match(assessment,/test "\$UI_SHA" = "\$GITHUB_WORKFLOW_SHA"/);
  assert.match(assessment,/ref: \$\{\{ inputs.ui_sha \}\}/);assert.match(assessment,/persist-credentials: false/);
});

test('default full Design workflow remains strict and never adopts limited assessment semantics',()=>{
  assert.doesNotMatch(design,/limited-research|continue-on-error/);
  assert.match(design,/run: node tools\/check-design-review\.mjs/);
  assert.match(read('../../frontend/tools/check-design-review.mjs'),/if \(actual.failures.length\) throw Error/);
  assert.match(read('../../frontend/tools/design-review.mjs'),/if \(report.failures.length\) process.exitCode = 1;/);
});

test('capture builds exact UI against frozen published data with no provider, exporter, carry, or correction path',()=>{
  assert.match(assessment,/VITE_LIMITED_RESEARCH_PREVIEW: v1/);assert.match(assessment,/npx --no-install vite build/);
  assert.doesNotMatch(assessment,/npm run build|export-research|record-candidate-history|sec-financials|yfinance|prepare-carry|financial-release-activation|financial-source-renewal/);
  assert.match(helper,/publishedSource\(live,pages\)/);assert.match(helper,/await materialize\(source,/);assert.doesNotMatch(helper,/chooseExport\(|buildLimitedResearchAssessment\([^)]*,\s*report.failures/);
  assert.match(helper,/const measured=measuredPerformanceFailures\(report\)/);assert.match(helper,/report.failures.filter\(failure=>measured.has\(failure\)\)/);
  assert.match(helper,/original-limited-assessment.json/);assert.doesNotMatch(assessment,/performance_limitations:|LIMITED_PERFORMANCE_LIMITATIONS|limited-performance-limitations=/);
  for(const file of ['research-daily.json','portfolio-model.json','qualification-audit.json','ibd-reference.json'])assert.ok(assessment.includes(file));
  assert.ok(assessment.indexOf('limited-research-assessment.mjs bind')<assessment.indexOf('node tools/design-review.mjs'));
  assert.ok(assessment.indexOf('limited-research-assessment.mjs seal')>assessment.indexOf('node tools/design-review.mjs'));
});

test('original browser exit is retained honestly and only separate seal permits evidence upload',t=>{
  const measure=step(assessment,'Record unchanged objective checks and the original Design exit');assert.match(measure,/set -uo pipefail/);assert.doesNotMatch(measure,/continue-on-error|\|\| true|set \+e/);
  const script=measure.slice(measure.indexOf('          set -uo pipefail')).replace(/^          /gm,'');
  const root=mkdtempSync(join(tmpdir(),'limited-workflow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'limited-research-assessment'));
  const result=execFileSync('bash',['-c',`node() { return "$TEST_STATUS"; }; printf() { :; }; test() { builtin test "$@"; };\n${script}`],{env:{...process.env,RUNNER_TEMP:root,TEST_STATUS:'1'},encoding:'utf8'});
  assert.equal(result,'');
  assert.match(assessment,/if: success\(\) && steps.seal.outcome == 'success'/);
  assert.match(step(assessment,'Preserve original reports and screenshots even if limited assessment fails'),/if: always\(\)/);
  assert.match(helper,/measurementExitCode===\(report.failures\?\.length\?1:0\)/);assert.match(helper,/assessment.blocking_failures.length===0/);
});

test('existing publisher requires explicit intent and keeps the same lock and final publication checks',()=>{
  assert.match(release,/limited_research_preview:\n[^]*?type: string\n\s+default: ''/);
  assert.match(release,/group: research-ui-release\n  cancel-in-progress: false/);
  assert.match(release,/workflows: \[CI, Design Acceptance, Static Site\]/);assert.doesNotMatch(release,/workflows:.*Limited Research Assessment/);
  for(const name of ['Prepare independently verifiable book evidence','Prepare workbench using verified published evidence','Cache public SEC archives and security mappings','Carry the active financial source onto the new price target','Build the exact ordinary carry with reviewed controller tooling','Build with daily selection export'])assert.match(step(release,name),/if:.*steps.plan.outputs.limited_research_preview != 'true'/,name);
  for(const name of ['Checkout the exact verified UI source','Verify research rules and 100 synthetic task profiles','Restore the exact selected data artifact','Preserve approved UI bytes or record verified new UI','Recheck live identity, main and final data before uploading','Reject a superseded release immediately before deployment','Deploy to GitHub Pages'])assert.doesNotMatch(step(release,name),/limited_research_preview != 'true'/,name);
  assert.equal((release.match(/run: node \.github\/scripts\/select-release-source.mjs recheck/g)||[]).length,2);
  assert.match(step(release,'Deploy to GitHub Pages'),/steps.plan.outputs.correction != 'true'/);
});


test('limited publisher reruns unchanged data-quality validation before compose without exporters',()=>{
  const quality=step(release,'Verify frozen captured data quality');
  assert.match(quality,/if: steps.plan.outputs.publish == 'true' && steps.plan.outputs.limited_research_preview == 'true'/);
  assert.match(quality,/working-directory: release\/frontend/);assert.match(quality,/run: node tools\/check-data-quality.mjs/);
  assert.doesNotMatch(quality,/export-research|record-candidate-history|npm run build|yfinance/);
  assert.ok(release.indexOf('name: Verify frozen captured data quality')>release.indexOf('name: Restore the exact selected data artifact'));
  assert.ok(release.indexOf('name: Verify frozen captured data quality')>release.indexOf('name: Verify research rules and 100 synthetic task profiles'));
  assert.ok(release.indexOf('name: Verify frozen captured data quality')<release.indexOf('name: Preserve approved UI bytes or record verified new UI'));
  assert.match(step(release,'Build with daily selection export'),/node tools\/check-data-quality.mjs/);
});
