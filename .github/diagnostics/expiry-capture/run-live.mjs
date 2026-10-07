// Read-only direct-publication probe; execute only in approved cloud CI.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {installExpiryObserver,financialCaptureState,captureCurrentFinancialViewport} from './capture-current-financial.mjs';
const frontend=resolve(process.env.SCREENER_FRONTEND),out=resolve(process.env.LIVE_OUTPUT),base=process.env.VERIFIED_LIVE_BASE_URL;
assert.ok(base&&new URL(base).protocol==='https:'&&base.endsWith('/'),'Verified HTTPS live base URL required');
const MANIFEST='ab65c8bb05f33cadd1eec71c858ed67a6ba7578ed9772c7d9ccbf24873161dd0',RECEIPT='0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a',UI='1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',PRICE='2026-10-02',BOUNDARY=Date.parse('2026-10-07T05:14:55.486Z');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async path=>{const response=await fetch(new URL(path,base),{cache:'no-store',redirect:'error'});assert.ok(response.ok,`${path}: HTTP ${response.status}`);const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length<5*1024*1024,`${path}: metadata/UI response too large`);return bytes;};
const pin=async()=>{assert.ok(Date.now()>BOUNDARY,'Real observation clock must be after the recorded expiry');const bytes=await read('publication.json');assert.equal(sha(bytes),RECEIPT,'Live receipt changed: stop, do not adopt a replacement');const receipt=JSON.parse(bytes);assert.equal(receipt.ui_sha,UI);assert.equal(String(receipt.run_id),'37456692717');assert.equal(String(receipt.run_attempt),'1');assert.equal(receipt.data_manifest_sha256,MANIFEST);assert.equal(sha(await read('static-data/manifest.json')),MANIFEST,'Live manifest changed');assert.equal(receipt.price_observations?.['["US","chart","AVT"]'],PRICE,'Pinned AVT price date');return {observed_at:new Date().toISOString(),sha256:sha(bytes),receipt,bytes};};
const load=path=>import(pathToFileURL(join(frontend,path)));
const [{createDesignAssetObserver},{decodeResearchIndex},{mergeFinancialDetail},{buildFinancialEvidencePresentation,financialEvidencePresentation},{assess,researchCsv},{financialCaseSource,parseFinancialCsv},{financialViewportGeometry,checkFinancialViewportGeometry,scrollFinancialViewport}]=await Promise.all([load('tools/design-static-assets.mjs'),load('src/static/researchTransport.js'),load('src/static/financialCurrent.js'),load('src/static/financialEvidencePresentation.js'),load('src/static/researchEngine.js'),load('tools/financial-design-cases.mjs'),load('tools/financial-viewport-geometry.mjs')]);
const report={schema:'live-avt-expiry-recovery-v1',publication_authority:false,source:'actual live publication #99; no UI/data build',clock:'unmodified real clock',expected_receipt_sha256:RECEIPT,expected_manifest_sha256:MANIFEST,expected_ui_sha:UI,price_date:PRICE,recorded_expiry:new Date(BOUNDARY).toISOString(),base,viewports:[],errors:[]};
await mkdir(out,{recursive:true});let browser,assets;
try{
 const before=await pin();await writeFile(join(out,'publication-before.json'),before.bytes);report.before={observed_at:before.observed_at,sha256:before.sha256};
 assets=await createDesignAssetObserver({baseURL:base});const manifest=assets.manifest,entry=manifest.markets?.US||manifest,generation=manifest.research_generation||manifest.generated_at;assert.equal(entry.as_of_date,PRICE);
 const data=decodeResearchIndex(await assets.readJson(entry.assets.research.path)),summary=data.rows.find(row=>row.symbol==='AVT');assert.ok(summary?.research_detail_path);
 browser=await chromium.launch({headless:true});
 for(const viewport of [{width:390,height:844,theme:'light'},{width:1440,height:900,theme:'dark'}]){
  const record={viewport,checks:[],screens:[],errors:[]};report.viewports.push(record);const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},colorScheme:viewport.theme,serviceWorkers:'block'});const page=await context.newPage();
  const checks=(ok,message)=>{record.checks.push({ok:Boolean(ok),message});assert.ok(ok,message);};
  const pending=[],resourceEvidence=[],resourceErrors=[];
  context.on('response',response=>{const url=response.url();if(!url.startsWith(base))return;const path=new URL(url).pathname.slice(new URL(base).pathname.length)||'index.html',expected=before.receipt.ui_files?.[path];if(!expected)return;pending.push(response.body().then(bytes=>{const actual=sha(bytes);resourceEvidence.push({path,expected,actual});assert.equal(actual,expected,`Live browser UI byte mismatch: ${path}`);}).catch(error=>resourceErrors.push(error.message)));});
  await context.route('**/*',route=>{const url=route.request().url(),request=route.request();return url.startsWith(base)&&request.method()==='GET'||url.startsWith('blob:')||url.startsWith('data:')?route.continue():route.abort('blockedbyclient');});
  await page.addInitScript(installExpiryObserver,{clockAnchor:null,holdPrepareCompletion:false});
  try{
   const identity={symbol:'AVT',date:PRICE,generation};
   const bootstrapManifest=page.waitForResponse(r=>r.url()===new URL('static-data/manifest.json',base).href&&r.ok());const bootstrapPublication=page.waitForResponse(r=>r.url()===new URL('publication.json',base).href&&r.ok());
   await page.goto(`${base}#/?method=oneil&symbol=AVT`);await assets.assertBrowserBootstrap(await bootstrapManifest,await bootstrapPublication);
   await page.getByRole('heading',{name:'AVT',exact:true}).waitFor({timeout:90000});
   const detailResult=await assets.observeJson(page,summary.research_detail_path,()=>page.getByRole('tab',{name:'財務・機関',exact:true}).click());const detail=detailResult.value;record.detail_transport=detailResult.observation;
   checks(detail.symbol==='AVT'&&detail.as_of_date===PRICE,'Live detail identity/date');checks(detail.financial_current?.t===summary.financial_current?.t,'Live detail/research source generation');
   if(await page.locator('.leader-shell').getAttribute('data-theme')!==viewport.theme)await page.getByRole('button',{name:viewport.theme==='light'?'ライトモードに切り替え':'ダークモードに切り替え',exact:true}).click();
   const panel=page.getByRole('region',{name:'財務の判定根拠',exact:true});await panel.waitFor();
   const validateCurrent=async state=>{
    checks(state.now>BOUNDARY,'Actual live financial clock is past the recorded expiry');
    const selected=mergeFinancialDetail(summary,detail,{now:state.evaluated_at,asOfDate:PRICE,generation,detailGeneration:generation,expectedDetailPath:summary.research_detail_path,detailPath:summary.research_detail_path});
    record.source=financialCaseSource(selected,{symbol:'AVT',category:'annual-declines-with-missing-year'},PRICE,state.evaluated_at);
    const evidence=buildFinancialEvidencePresentation(selected,{method:'oneil',date:PRICE,generation,now:state.evaluated_at}),expected=financialEvidencePresentation({evidence,history:selected.financial_history,symbol:'AVT',date:PRICE,generation,method:'oneil',now:state.evaluated_at});
    for(const row of expected.rows){const actual=await panel.locator(`#financial-evidence-${row.id}`).evaluate(node=>({state:node.dataset.state,actual:node.querySelector('.financial-evidence-value strong')?.textContent,condition:node.querySelector('.financial-evidence-value span')?.textContent,metadata:Object.fromEntries([...node.querySelectorAll('dl > div')].map(div=>[div.querySelector('dt').textContent,div.querySelector('dd').textContent]))}));checks(actual.state===row.state&&actual.actual===row.actual&&actual.condition===row.condition,`${row.id}: actual live source/state/criteria`);for(const [k,v] of Object.entries({対象期:row.period,提供元:row.source,取得:row.observedAt,指標:row.metric,基準:row.basis,単位:row.unit}))checks(actual.metadata[k]===v,`${row.id}: ${k}`);}
    const assessment=assess(selected,'oneil',state.evaluated_at);checks(assessment.passed===7&&assessment.total===8&&assessment.failed===1&&assessment.unknown===0,'Actual current AVT 7/8, one annual FAIL, zero unknown');record.assessment=assessment;
   };
   const annual='#financial-evidence-annual_eps_growth_3y';const targets={evidence:['#financial-evidence-eps_growth_yy'],annual:['.financial-evidence-heading h4','.financial-evidence-status','.financial-evidence-value strong','.financial-evidence-value span','.financial-evidence-metadata > div:nth-child(1)','.financial-evidence-metadata > div:nth-child(2)','.financial-evidence-metadata > div:nth-child(3)'].map(s=>`${annual} ${s}`)};
   for(const [name,selectors] of Object.entries(targets)){const captureReport={name};record.screens.push(captureReport);await captureCurrentFinancialViewport({page,identity,selectors,geometry:financialViewportGeometry,checkGeometry:(g,c)=>checkFinancialViewportGeometry(g,c,`live/AVT/${viewport.width}/${name}`,viewport),scroll:scrollFinancialViewport,validateCurrent,report:captureReport,timeoutMs:90000,capture:async attempt=>{const path=`LIVE-AVT-${name}-${viewport.width}x${viewport.height}-${viewport.theme}-attempt-${attempt}.png`;await page.screenshot({path:join(out,path)});return path;}});}
   record.current=await page.evaluate(financialCaptureState,identity);
   await page.getByRole('tab',{name:'判定根拠',exact:true}).click();record.selection=await page.locator('#detail-panel-evidence h3').textContent();checks(record.selection==='選定 7/8 · 未達 1 · 未確認 0','Actual live selected method heading is 7/8 annual FAIL');
   if(viewport.width===390)await page.locator('.mobile-header-back:visible, .mobile-back:visible').first().click();await page.getByRole('button',{name:'候補を絞り込む',exact:true}).click();const filters=page.getByRole('dialog',{name:'候補を絞り込む',exact:true});
   const [download]=await Promise.all([page.waitForEvent('download'),filters.getByRole('button',{name:'全検索結果をCSV保存 ↓',exact:true}).click()]);const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const csv=Buffer.concat(chunks).toString('utf8');await writeFile(join(out,`LIVE-AVT-${viewport.width}-actual.csv`),csv);const actual=parseFinancialCsv(csv).rows.find(r=>r.symbol==='AVT'),expected=parseFinancialCsv(researchCsv([{row:summary}],'oneil',PRICE,Date.parse(actual.financial_evaluated_at))).rows[0];checks(JSON.stringify(actual)===JSON.stringify(expected),'Actual live CSV agrees with canonical source');checks(actual.annual_eps_rule_state==='fail'&&actual.passed==='7'&&actual.total==='8','Actual live CSV annual FAIL / 7 of 8');record.csv=actual;
   await Promise.all(pending);checks(resourceErrors.length===0,`Live UI resource integrity: ${resourceErrors.join('; ')||'verified'}`);record.ui_resources=resourceEvidence;checks(resourceEvidence.some(r=>r.path==='index.html'),'Actual live document bytes matched receipt');
   const after=await pin();checks(after.sha256===before.sha256,'Publication unchanged after this viewport');record.receipt_after={observed_at:after.observed_at,sha256:after.sha256};record.status='passed';
  }catch(error){record.status='failed';record.errors.push(error.stack);process.exitCode=1;await page.screenshot({path:join(out,`LIVE-AVT-${viewport.width}-interrupted.png`)}).catch(()=>{});}
  finally{record.observation=await page.evaluate(()=>{const d=window.__expiryDiagnostic;return d?{clock:d.clock,workers:d.workers,events:d.events}:null;}).catch(()=>null);await Promise.allSettled(pending);await context.close();}
 }
 const after=await pin();await writeFile(join(out,'publication-after.json'),after.bytes);report.after={observed_at:after.observed_at,sha256:after.sha256};report.status=report.viewports.every(r=>r.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.errors.push(error.stack);process.exitCode=1;}
finally{assets?.dispose();await browser?.close();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
