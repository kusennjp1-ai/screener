// Execute only in the owner-approved CI route. No local browser launch authorized.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
import {installExpiryObserver,financialCaptureState,captureCurrentFinancialViewport} from './capture-current-financial.mjs';
const frontend=resolve(process.env.SCREENER_FRONTEND),dist=resolve(process.env.DIAGNOSTIC_DIST),out=resolve(process.env.DIAGNOSTIC_OUTPUT);
const load=path=>import(pathToFileURL(join(frontend,path)));
const [{createDesignAssetObserver},{decodeResearchIndex},{mergeFinancialDetail},{buildFinancialEvidencePresentation,financialEvidencePresentation},{assess,researchCsv},{financialCaseSource,parseFinancialCsv},{financialViewportGeometry,checkFinancialViewportGeometry,scrollFinancialViewport}]=await Promise.all([load('tools/design-static-assets.mjs'),load('src/static/researchTransport.js'),load('src/static/financialCurrent.js'),load('src/static/financialEvidencePresentation.js'),load('src/static/researchEngine.js'),load('tools/financial-design-cases.mjs'),load('tools/financial-viewport-geometry.mjs')]);
const synthetic=process.env.DIAGNOSTIC_MODE==='synthetic';
assert.ok(synthetic||process.env.DIAGNOSTIC_MODE==='published','Explicit diagnostic mode required');
const provenance=synthetic?JSON.parse(await readFile(join(out,'fixture-provenance.json'))):null;
const report={schema:'expiry-capture-diagnostic-v1',publication_authority:false,mode:synthetic?'synthetic-three-row-overlapping-expiry-regression':'unchanged-published-data-current-clock',viewport:{width:390,height:844},screens:[],checks:[],errors:[],browser_executed_at:new Date().toISOString()};
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/screener\/?/,'');assert.ok(!path.split('/').includes('..'));const file=join(dist,path||'index.html'),bytes=await readFile(file);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/screener/`,browser=await chromium.launch({headless:true});
let context,page,assets;
const check=(ok,message)=>{report.checks.push({ok:Boolean(ok),message});assert.ok(ok,message);};
try{
 context=await browser.newContext({viewport:report.viewport,colorScheme:'light',serviceWorkers:'block'});page=await context.newPage();
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===new URL(base).origin||['blob:','data:'].includes(u.protocol)?route.continue():route.abort('blockedbyclient');});
 await page.addInitScript(installExpiryObserver,{clockAnchor:synthetic?provenance.clock_anchor:null,holdPrepareCompletion:synthetic});
 assets=await createDesignAssetObserver({baseURL:base});
 const manifest=assets.manifest,entry=manifest.markets?.US||manifest,date=entry.as_of_date,generation=manifest.research_generation||manifest.generated_at;
 const data=decodeResearchIndex(await assets.readJson(entry.assets.research.path)),summary=data.rows.find(row=>row.symbol==='AVT');
 assert.ok(summary?.research_detail_path,'Selected AVT detail path required');
 const identity={symbol:'AVT',date,generation};
 await page.goto(`${base}#/?method=oneil&symbol=AVT`);
 await page.getByRole('heading',{name:'AVT',exact:true}).waitFor({timeout:60000});
 const {value:detail,observation}=await assets.observeJson(page,summary.research_detail_path,()=>page.getByRole('tab',{name:'財務・機関',exact:true}).click());
 report.detail_transport=observation;
 check(detail.symbol==='AVT'&&detail.as_of_date===date,'Detail symbol/date match');
 check(detail.financial_current?.t===summary.financial_current?.t,'Detail and research financial source generation match');
 if(await page.locator('.leader-shell').getAttribute('data-theme')!=='light')await page.getByRole('button',{name:'ライトモードに切り替え',exact:true}).click();
 const panel=page.getByRole('region',{name:'財務の判定根拠',exact:true});await panel.waitFor();
 const annual='#financial-evidence-annual_eps_growth_3y',selectors=['.financial-evidence-heading h4','.financial-evidence-status','.financial-evidence-value strong','.financial-evidence-value span','.financial-evidence-metadata > div:nth-child(1)','.financial-evidence-metadata > div:nth-child(2)','.financial-evidence-metadata > div:nth-child(3)'].map(s=>`${annual} ${s}`);
 const validateCurrent=async state=>{
  const selected=mergeFinancialDetail(summary,detail,{now:state.evaluated_at,asOfDate:date,generation,detailGeneration:generation,expectedDetailPath:summary.research_detail_path,detailPath:summary.research_detail_path});
  const source=financialCaseSource(selected,{symbol:'AVT',category:'annual-declines-with-missing-year'},date,state.evaluated_at);
  const evidence=buildFinancialEvidencePresentation(selected,{method:'oneil',date,generation,now:state.evaluated_at});
  const expected=financialEvidencePresentation({evidence,history:selected.financial_history,symbol:'AVT',date,generation,method:'oneil',now:state.evaluated_at});
  for(const row of expected.rows){const actual=await panel.locator(`#financial-evidence-${row.id}`).evaluate(node=>({state:node.dataset.state,actual:node.querySelector('.financial-evidence-value strong')?.textContent,condition:node.querySelector('.financial-evidence-value span')?.textContent,metadata:Object.fromEntries([...node.querySelectorAll('dl > div')].map(div=>[div.querySelector('dt').textContent,div.querySelector('dd').textContent]))}));check(actual.state===row.state&&actual.actual===row.actual&&actual.condition===row.condition,`${row.id}: current criteria/value/state`);for(const [k,v] of Object.entries({対象期:row.period,提供元:row.source,取得:row.observedAt,指標:row.metric,基準:row.basis,単位:row.unit}))check(actual.metadata[k]===v,`${row.id}: ${k}`);}
  report.last_source=source;report.last_assessment=assess(selected,'oneil',state.evaluated_at);if(synthetic)check(report.last_assessment.passed===7&&report.last_assessment.total===8&&report.last_assessment.failed===1&&report.last_assessment.unknown===0,'Synthetic AVT-like fixture retains exactly 7/8 with annual FAIL');
 };
 await page.waitForFunction(`args=>(${financialCaptureState.toString()})(args).ready`,identity,{timeout:60000});
 await scrollFinancialViewport(page,selectors);report.before=await page.evaluate(financialCaptureState,identity);await validateCurrent(report.before);
 await page.screenshot({path:join(out,'AVT-before-boundary.png')});report.screens.push('AVT-before-boundary.png');
 if(synthetic){
  check(report.before.now<=provenance.unselected_inclusive_deadline,'UI became ready before the genuine synthetic source expiry');
  await page.waitForFunction(()=>window.__expiryDiagnostic.held.length===1,{},{timeout:90000});
  report.pending=await page.evaluate(financialCaptureState,identity);
  check(report.pending.loading&&!report.pending.ready,'Whole-bundle decisions withheld during gated genuine reprojected completion');
  check(await page.locator(annual).count()===0,'Expired bundle financial evidence unavailable until completion');
  await page.screenshot({path:join(out,'AVT-expiry-loading.png')});report.screens.push('AVT-expiry-loading.png');
  await page.waitForFunction(boundary=>Date.now()>=boundary,provenance.second_unselected_first_invalid,{timeout:10000});
  await page.evaluate(()=>window.__expiryDiagnostic.release());
  await page.waitForFunction(()=>window.__expiryDiagnostic.workers.filter(w=>w.request?.operation==='prepare').length===2&&window.__expiryDiagnostic.held.length===1,{},{timeout:60000});
  report.second_pending=await page.evaluate(financialCaptureState,identity);
  check(!report.second_pending.ready&&await page.locator(annual).count()===0,'Already-expired epoch 2 cannot restore AVT; latest epoch 3 required');
  await page.screenshot({path:join(out,'AVT-overlapping-expiry-loading.png')});report.screens.push('AVT-overlapping-expiry-loading.png');
  await page.evaluate(()=>window.__expiryDiagnostic.release());
 }
 await captureCurrentFinancialViewport({page,identity,selectors,geometry:financialViewportGeometry,checkGeometry:(g,c)=>checkFinancialViewportGeometry(g,c,'AVT/current',report.viewport),scroll:scrollFinancialViewport,validateCurrent,report,capture:async index=>{const path=`AVT-after-boundary-attempt-${index}.png`;await page.screenshot({path:join(out,path)});report.screens.push(path);return path;}});
 report.after=await page.evaluate(financialCaptureState,identity);report.natural_scroll_shift=(await page.evaluate(()=>window.__expiryDiagnostic.events.filter(e=>e.kind==='loading-end').at(-1)?.scroll_y))-report.before.scroll_y;
 check(report.after.symbol==='AVT'&&report.after.tab==='true','Selected AVT and financial tab survive the expiry');
 check(report.before.fingerprint===report.after.fingerprint,'Selected financial source/criteria text preserved across the unrelated expiry');
 await page.getByRole('tab',{name:'判定根拠',exact:true}).click();
 const selection=await page.locator('#detail-panel-evidence h3').textContent();report.selection=selection;
 check(selection===`選定 ${report.last_assessment.passed}/${report.last_assessment.total} · 未達 ${report.last_assessment.failed} · 未確認 ${report.last_assessment.unknown}`,'Selection heading matches current canonical assessment');
 await page.locator('.mobile-header-back:visible, .mobile-back:visible').first().click();await page.getByRole('button',{name:'候補を絞り込む',exact:true}).click();
 const filters=page.getByRole('dialog',{name:'候補を絞り込む',exact:true});const [download]=await Promise.all([page.waitForEvent('download'),filters.getByRole('button',{name:'全検索結果をCSV保存 ↓',exact:true}).click()]);
 const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const csv=Buffer.concat(chunks).toString('utf8');await writeFile(join(out,'actual-selection.csv'),csv);
 const actual=parseFinancialCsv(csv).rows.find(row=>row.symbol==='AVT'),expected=parseFinancialCsv(researchCsv([{row:summary}],'oneil',date,Date.parse(actual.financial_evaluated_at))).rows[0];check(JSON.stringify(actual)===JSON.stringify(expected),'Actual downloaded AVT CSV matches same-source current canonical export');report.csv=actual;
 report.status='passed';
}catch(error){report.status='failed';report.errors.push(error.stack);if(page)await page.screenshot({path:join(out,'interrupted.png')}).catch(()=>{});process.exitCode=1;}
finally{if(page){report.observation=await page.evaluate(()=>{const d=window.__expiryDiagnostic;return d?{clock:d.clock,workers:d.workers,events:d.events}:null;}).catch(()=>null);if(report.observation){const events=report.observation.events;report.worker_durations=report.observation.workers.map(w=>({id:w.id,operation:w.request?.operation,evaluation:w.request?.evaluation,compute_and_packets_ms:w.completed&&w.request?w.completed.monotonic_ms-w.request.monotonic_ms:null,deliberate_hold_ms:w.delivered&&w.completed?w.delivered.monotonic_ms-w.completed.monotonic_ms:null,delivery_to_loading_end_ms:w.delivered?(events.find(e=>e.kind==='loading-end'&&e.monotonic_ms>=w.delivered.monotonic_ms)?.monotonic_ms??NaN)-w.delivered.monotonic_ms:null}));report.loading_intervals=events.filter(e=>e.kind==='loading-start').map(start=>{const end=events.find(e=>e.kind==='loading-end'&&e.monotonic_ms>=start.monotonic_ms);return {start,end,duration_ms:end?end.monotonic_ms-start.monotonic_ms:null};});}}
 assets?.dispose();await context?.close();await browser.close();await new Promise(done=>server.close(done));await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
