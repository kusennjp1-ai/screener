import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const read=name=>readFileSync(new URL(`../workflows/${name}`,import.meta.url),'utf8');
function job(text,name){const start=text.indexOf(`  ${name}:\n`);assert(start>=0,`Missing job ${name}`);const end=text.slice(start+1).search(/^  [a-zA-Z][\w-]*:\s*$/m);return end<0?text.slice(start):text.slice(start,start+1+end);}
function step(text,name){const marker=`      - name: ${name}\n`,start=text.indexOf(marker);assert(start>=0,`Missing step ${name}`);const end=text.indexOf('\n      - ',start+marker.length);return end<0?text.slice(start):text.slice(start,end);}
const staticWorkflow=read('static-site.yml'),combine=job(staticWorkflow,'combine-and-build'),release=read('research-ui-release.yml');

// Execute the real routing shell, then evaluate the actual job predicates and
// needs graph. This covers disabled-trigger fallthrough independently of the
// pure admission helper or a parallel hand-written routing implementation.
function actualStaticGraph(t,{eventName,repair='false',schedule='',market='us',pricesOnly='false',selectFailure=false}={}){
  const directory=mkdtempSync(join(tmpdir(),'static-price-graph-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const selected=job(staticWorkflow,'select-markets'),pick=selected.slice(selected.indexOf('      - id: pick\n'));
  const body=pick.slice(pick.indexOf('        run: |\n')+'        run: |\n'.length).split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
  const output=join(directory,'outputs');execFileSync('bash',['-e','-o','pipefail','-c',body],{env:{PATH:process.env.PATH,EVENT_NAME:eventName,PRICE_REPAIR:repair,SCHEDULE:schedule,MARKET_GROUP:market,PRICES_ONLY:pricesOnly,GITHUB_OUTPUT:output},stdio:'pipe'});
  const outputs=Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
  outputs.repair=eventName==='workflow_run'?repair:'';outputs.source_promotion=eventName==='workflow_run'?'':'true';
  const github={event_name:eventName,ref:'refs/heads/main',event:{repository:{default_branch:'main'}}},needs={};
  const format=(pattern,...values)=>pattern.replace(/\{(\d+)\}/g,(_,i)=>values[Number(i)]),contains=(haystack,value)=>haystack.includes(value);
  for(const name of ['select-markets','ensure_daily_price_release','build-market','combine-and-build','promote-daily-source']){
    const block=job(staticWorkflow,name),raw=/^    if: (.+)$/m.exec(block)?.[1];assert(raw,`Missing condition ${name}`);
    const expression=raw.replace(/^\$\{\{\s*/,'').replace(/\s*\}\}$/,'').replace(/\bneeds\.([a-zA-Z][\w-]*)/g,(_match,name)=>`needs["${name}"]`);
    assert(!/[;`{}]/.test(expression.replace(/'[^']*'/g,"''")),`Unexpected predicate syntax ${name}`);
    const dependencyText=/^    needs: (.+)$/m.exec(block)?.[1]||'',dependencies=dependencyText.replace(/[\[\]]/g,'').split(',').map(x=>x.trim()).filter(Boolean);
    const defaultSuccess=dependencies.every(n=>needs[n]?.result==='success'),explicitStatus=/\b(?:cancelled|always|success|failure)\(\)/.test(expression);
    const eligible=(defaultSuccess||explicitStatus)&&Function('github','needs','format','contains','fromJSON','cancelled',`"use strict";return (${expression});`)(github,needs,format,contains,JSON.parse,()=>false);
    needs[name]={result:name==='select-markets'&&selectFailure?'failure':eligible?'success':'skipped',outputs:name==='select-markets'?outputs:{produced_candidate:'true',source_candidate_id:'123',downstream_artifact_id:'456'}};
  }
  return {outputs,jobs:Object.fromEntries(Object.entries(needs).map(([name,item])=>[name,item.result]))};
}

test('disabled CI completion no-ops the entire Static Site acquisition/job graph',t=>{
  // Keep the test independent of the checked-out request's active/disabled
  // state so the later request-only activation's own required CI can pass.
  const disabled={enabled:false,activation:null};
  const graph=actualStaticGraph(t,{eventName:'workflow_run',repair:String(disabled.enabled&&disabled.activation!==null)});
  assert.equal(graph.outputs.mode,'noop');assert.equal(graph.outputs.markets,'[]');
  assert.deepEqual(graph.jobs,{'select-markets':'success',ensure_daily_price_release:'skipped','build-market':'skipped','combine-and-build':'skipped','promote-daily-source':'skipped'});
});
test('genuine finite route reaches only combine; ordinary scheduled/manual graph remains reachable',t=>{
  const finite=actualStaticGraph(t,{eventName:'workflow_run',repair:'true'});assert.equal(finite.outputs.mode,'offline_repair');assert.deepEqual(finite.jobs,{'select-markets':'success',ensure_daily_price_release:'skipped','build-market':'skipped','combine-and-build':'success','promote-daily-source':'skipped'});
  for(const options of [{eventName:'schedule',schedule:'4 16 * * 1-5'},{eventName:'schedule',schedule:'10 16 * * 1-6'},{eventName:'workflow_dispatch',market:'us'},{eventName:'workflow_dispatch',pricesOnly:'true'}]){
    const graph=actualStaticGraph(t,options);for(const name of ['select-markets','ensure_daily_price_release','build-market','combine-and-build'])assert.equal(graph.jobs[name],'success',JSON.stringify(options)+'/'+name);
    assert(['full','prices_only'].includes(graph.outputs.mode));
  }
  assert.equal(actualStaticGraph(t,{eventName:'workflow_run',repair:'true',selectFailure:true}).jobs['combine-and-build'],'skipped');
  assert.equal(actualStaticGraph(t,{eventName:'schedule',schedule:'10 16 * * 1-6',selectFailure:true}).jobs['combine-and-build'],'success','Existing ordinary fallback after an upstream failure remains reachable');
});

test('automatic finite trigger is exact CI completion and retains original non-CI scheduling',()=>{
  assert.match(staticWorkflow,/workflow_run:\n\s+workflows: \[CI\]\n\s+types: \[completed\]\n\s+branches: \[main\]/);
  assert.match(staticWorkflow,/workflow_dispatch:/);assert.match(staticWorkflow,/schedule:/);
  const select=job(staticWorkflow,'select-markets');assert.match(select,/producer-route/);assert.match(select,/repair: \$\{\{ steps\.price-route\.outputs\.repair \}\}/);
  assert.match(select,/if \[ "\$EVENT_NAME" = "workflow_run" \]; then[\s\S]*mode="noop"[\s\S]*if \[ "\$PRICE_REPAIR" = "true" \]/);
  assert.match(combine,/github\.event_name == 'workflow_run' && needs\.select-markets\.result == 'success' && needs\.select-markets\.outputs\.repair == 'true'/);
  assert.match(staticWorkflow,/format\('static-site-oct6-\{0\}', github\.event\.workflow_run\.head_sha\)/);assert.match(staticWorkflow,/cancel-in-progress: false/);
});
test('finite producer cannot reach acquisition, mutable releases, fallback or promotion',()=>{
  for(const name of ['ensure_daily_price_release','build-market'])assert.match(job(staticWorkflow,name),/if:.*github\.event_name != 'workflow_run'/,name);
  for(const name of ['Install backend dependencies','Install frontend dependencies','Download current market artifacts','Download per-market fallback artifacts','Validate market artifacts','Combine static data bundle','Cache public SEC archives and security mappings','Bind downstream close observations after both quality gates','Record the actual downstream producer attempt','Retain downstream source-promotion inputs']){
    assert.match(step(combine,name),/if: needs\.select-markets\.outputs\.repair != 'true'/,name);
  }
  assert.match(job(staticWorkflow,'promote-daily-source'),/needs\.select-markets\.outputs\.mode == 'full'/);
  assert.match(combine,/permissions:\n\s+contents: read\n\s+actions: read/);assert.doesNotMatch(combine,/pages: write|id-token: write/);
});
test('genuine build performs the worker Vite route and verified upload keeps its new identity',()=>{
  const build=step(combine,'Build static frontend'),branch=build.split('if [ "$PRICE_REPAIR" = "true" ]; then')[1]?.split('\n          else')[0];
  assert(branch,'Missing actual finite build branch');assert.match(branch,/retained-price-source-admission\.mjs produce --output "\$RUNNER_TEMP\/retained-price-source" --job-start/);
  assert.doesNotMatch(branch,/export-institutional|sec-financials|yfinance|release upload|repair-price-history/);
  assert.match(build,/id: build-frontend/);assert.match(build,/npm run build/);
  assert.match(step(combine,'Verify finite retained-price repair'),/verify-produced --output/);
  const upload=step(combine,'Upload verified data export');assert.match(upload,/static-site-data-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);assert.match(upload,/steps\.build-frontend\.outputs\.site_dir/);
  const companion=step(combine,'Record exact export attempt and dated evidence');assert.match(companion,/steps\.upload-data-artifact\.outputs\.artifact_id/);assert.match(companion,/actions\/artifacts\/\$PRICE_ARTIFACT_ID/);assert.match(companion,/companion --output .* --artifact-id .* --artifact-digest/);assert.match(companion,/select-release-source\.mjs export-metadata/);
  for(const name of ['Build static frontend','Verify finite retained-price repair','Upload verified data export','Record exact export attempt and dated evidence','Preserve dated export provenance for release selection'])assert.doesNotMatch(step(combine,name),/continue-on-error:\s*true/,name);
});
test('finite producer prepares exact arithmetic packages and publisher reuses its already-pinned venv',()=>{
  const arithmetic=step(combine,'Prepare pinned finite price arithmetic runtime');assert.match(arithmetic,/needs\.select-markets\.outputs\.repair == 'true'/);
  assert.match(arithmetic,/python3\.11 -m venv "\$RUNNER_TEMP\/retained-price-python"/);assert.match(arithmetic,/numpy==1\.26\.3 pandas==2\.2\.0/);
  assert.match(arithmetic,/RETAINED_PRICE_PYTHON=\$RUNNER_TEMP\/retained-price-python\/bin\/python3\.11/);assert.doesNotMatch(arithmetic,/GITHUB_PATH/);
  assert(combine.indexOf('Prepare pinned finite price arithmetic runtime')<combine.indexOf('Build static frontend'));
  const publisher=job(release,'publish'),bind=step(publisher,'Bind existing pinned arithmetic runtime for finite replay');
  assert.match(bind,/RETAINED_PRICE_PYTHON=\$RUNNER_TEMP\/financial-replay-runtime\/bin\/python3\.11/);assert.doesNotMatch(bind,/pip install|venv /);
  assert.match(step(publisher,'Install offline statement projection dependencies'),/needs\.renewal_route\.outputs\.price_source == 'true' \|\|/);
  assert(publisher.indexOf('Bind existing pinned arithmetic runtime')<publisher.indexOf('Restore the exact selected data artifact'));
});
test('publisher holds the exact finite route before renewal and protected publication',()=>{
  const routing=job(release,'renewal_route'),publish=job(release,'publish');
  assert(routing.indexOf('retained-price-ci-admission.mjs publication-route')<routing.indexOf('financial-renewal-ci-routing.mjs route'));
  assert.match(step(routing,'Hold finite retained-price activation'),/if: steps\.price-route\.outputs\.price_wait == 'true'/);
  assert.match(step(routing,'Resolve only the exact admitted renewal route'),/price_wait != 'true' && steps\.price-route\.outputs\.price_source != 'true'/);
  assert.match(publish,/if:.*needs\.renewal_route\.outputs\.price_wait != 'true'/);
  assert.match(publish,/financial-renewal-ci-routing\.mjs admit/);
  assert.match(publish,/timeout-minutes: \$\{\{ needs\.renewal_route\.outputs\.price_source == 'true' && 110 \|\| 360 \}\}/);
  assert.equal((release.match(/^  [a-zA-Z][\w-]*:\s*$/gm)||[]).filter(s=>/^  (renewal_route|publish):/.test(s)).length,2);
});
test('finite browser proof runs on composed approved UI and cannot be skipped before final recheck',()=>{
  const publish=job(release,'publish'),browser=step(publish,'Verify composed finite price browser and CSV surfaces'),install=step(publish,'Install locked Chromium for finite price verification');
  for(const body of [browser,install])assert.match(body,/if: steps\.restore\.outputs\.offline_recovery_verified == 'true'/);
  assert.match(install,/working-directory: release\/frontend/);assert.match(install,/npx --no-install playwright install --with-deps chromium/);
  assert.match(browser,/timeout-minutes: 8/);assert.match(browser,/node \.github\/scripts\/retained-price-source-browser\.mjs\s*$/);assert.doesNotMatch(browser,/continue-on-error|--clock|--root|design-review/);
  assert(publish.indexOf('select-release-source.mjs compose')<publish.indexOf('Verify composed finite price browser'));
  assert(publish.indexOf('Verify composed finite price browser')<publish.indexOf('Recheck live identity, main and final data'));
});
test('always-report uploads use exact small paths and post-deploy reporting cannot invalidate deployment success',()=>{
  const sourceReports=step(combine,'Preserve finite price producer diagnostic reports'),publish=job(release,'publish'),releaseReports=step(publish,'Preserve finite price publication diagnostic reports');
  for(const body of [sourceReports,releaseReports]){
    assert.match(body,/if: always\(\) &&/);assert.match(body,/continue-on-error: true/);assert.match(body,/if-no-files-found: ignore/);assert.match(body,/retention-days: 7/);
    const paths=body.split('          path: |\n')[1].split('          if-no-files-found:')[0].trim().split('\n').map(s=>s.trim());
    assert(paths.length>=7);for(const path of paths){assert(path.endsWith('.json')||path.endsWith('.jsonl')||/\/finite-source-browser\/(NVDA|FUTU|ALH|LPSN|AIHS)\.png$/.test(path));assert(!/[?*]/.test(path));assert(!/\/(?:runtime|scopes|node_modules|dependencies)\//.test(path));assert(!path.endsWith('.zip'));}
  }
  for(const symbol of ['NVDA','FUTU','ALH','LPSN','AIHS'])assert(releaseReports.includes(`/finite-source-browser/${symbol}.png`));
  assert(publish.indexOf('Deploy to GitHub Pages')<publish.indexOf('Preserve finite price publication diagnostic reports'));
});
test('only independently verified restore skips enrichment while ordinary carry and final gates remain',()=>{
  const publish=job(release,'publish'),restore=step(publish,'Restore the exact selected data artifact');assert.match(restore,/id: restore/);assert.match(restore,/select-release-source\.mjs restore/);
  const start=step(publish,'Record first finite publisher step clock');assert.match(start,/needs\.renewal_route\.outputs\.price_source == 'true'/);
  assert.match(start,/date \+%s > "\$RUNNER_TEMP\/retained-price-publisher-job-start"/);
  assert(publish.indexOf('Record first finite publisher step clock')<publish.indexOf('Resolve current main under the publication lock'));
  assert.match(restore,/RETAINED_PRICE_PUBLISHER_JOB_START: \$\{\{ runner.temp \}\}\/retained-price-publisher-job-start/);
  const controller=step(publish,'Prepare immutable controller for finite price publication');
  assert.match(controller,/steps\.plan\.outputs\.publish == 'true' && needs\.renewal_route\.outputs\.price_source == 'true'/);
  assert.match(controller,/prepare-controller --output "\$RUNNER_TEMP\/retained-price-controller"/);
  assert(publish.indexOf('Prepare immutable controller')<publish.indexOf('Checkout the exact verified UI source'));
  for(const name of ['Cache public SEC archives and security mappings','Prepare independently verifiable book evidence','Prepare workbench using verified published evidence']){
    const s=step(publish,name);assert.match(s,/steps\.restore\.outputs\.offline_recovery_verified != 'true'/);assert.doesNotMatch(s,/inputs\.offline_recovery_verified|steps\.plan\.outputs\.offline_recovery_verified/);
  }
  assert.match(step(publish,'Carry the active financial source onto the new price target'),/select-release-source\.mjs prepare-carry/);
  assert.match(step(publish,'Build with daily selection export'),/npm run build/);assert.match(step(publish,'Build with daily selection export'),/check-data-quality\.mjs/);
  assert.match(step(publish,'Preserve approved UI bytes or record verified new UI'),/select-release-source\.mjs compose/);
  assert.equal((publish.match(/select-release-source\.mjs recheck/g)||[]).length,2);
  assert.match(publish,/check-pages-payload/);
});
test('required focused tests execute in the explicit exact-main CI script list',()=>{
  const ci=read('ci.yml');for(const name of ['retained-price-ci-admission.test.mjs','retained-price-source-admission.test.mjs','retained-price-source-driver.test.mjs','retained-price-source-baseline.test.mjs','retained-price-source-browser.test.mjs','retained-price-source-readers.test.mjs','retained-price-source-workflow.test.mjs','test_run_retained_price_source.py'])assert(ci.includes(name),name);
  assert(ci.includes('financial-renewal-ci-admission.test.mjs'));assert(ci.includes('financial-renewal-ci-routing.test.mjs'));
});
