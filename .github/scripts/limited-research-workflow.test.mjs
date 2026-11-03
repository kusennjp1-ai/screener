import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {LIMITED_ASSESSMENT_WORKFLOW} from './limited-research-assessment.mjs';
import {LIMITED_WORKFLOW} from './limited-research-approval.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const release=read('../workflows/research-ui-release.yml'),design=read('../workflows/design-acceptance.yml');
const step=(text,name)=>{const start=text.indexOf(`      - name: ${name}\n`);assert.ok(start>=0,name);const end=text.indexOf('\n      - ',start+1);return text.slice(start,end<0?undefined:end);};

test('the limited assessment workflow is retired with the old harness, so no limited preview can be assessed',()=>{
  // Its capture ran the retired screens. The approval and assessment helpers stay
  // bound to that one workflow path, so no other workflow can stand in for it.
  assert.equal(LIMITED_ASSESSMENT_WORKFLOW,'.github/workflows/limited-research-assessment.yml');
  assert.equal(LIMITED_WORKFLOW,LIMITED_ASSESSMENT_WORKFLOW);
  assert.equal(existsSync(new URL('../../'+LIMITED_ASSESSMENT_WORKFLOW,import.meta.url)),false);
});

test('full Design never adopts limited-preview authority and every objective failure blocks',()=>{
  assert.doesNotMatch(design,/limited-research|continue-on-error/);
  assert.match(design,/run: node tools\/check-design-review\.mjs/);
  const checker=read('../../frontend/tools/check-design-review.mjs');
  assert.match(checker,/await requireObjectiveEvidence\(actual, output, waiver\)/);
  const contract=read('../../frontend/tools/brief-design-contract.mjs');
  assert.match(contract,/if \(report.failures.length\) throw Error/);
  const harness=read('../../frontend/tools/design-review.mjs');
  assert.match(harness,/if \(report.failures.length\) process.exitCode = 1;/);
  assert.doesNotMatch(harness,/--limited-research-preview/);
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
