// CI-only: this file must never be used to retry the denied cloud-shell browser route.
import { requireAdmittedPreview, loadPreviewPin } from './controls.mjs';
requireAdmittedPreview(process.env);
const admittedPin=await loadPreviewPin();
import { loadPreviewBrowserTools } from './browser-tools.mjs';
import { withPreviewViewport } from './viewport-context.mjs';
import { checkHistoryKeyboardScrolling, inspectPreviewGeometry, seriousAccessibilityViolations } from './diagnostics.mjs';
import { captureBaseViewports, captureCandidateViewports } from './viewport-capture.mjs';
import { resolve,extname,sep } from 'node:path';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
const {chromium,AxeBuilder}=loadPreviewBrowserTools();
const output=resolve(process.env.INDICATOR_PREVIEW_OUTPUT||'frontend/test-results/indicator-preview'),site=resolve(output,'site');
await mkdir(resolve(output,'screenshots'),{recursive:true});
const provenance=JSON.parse(await readFile(resolve(output,'input-provenance.json'),'utf8'));
if(provenance.publication_sha256!==admittedPin.publication_sha256 || provenance.candidate_commit!==process.env.GITHUB_SHA)throw Error('Prepared data is not bound to this admitted input and candidate');
const report={source_pin:admittedPin,run_id:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,commit:process.env.GITHUB_SHA,clock:'real browser clock; data evaluation timestamp is explicit source metadata',publication_authority:'none',screens:[],viewport_screens:[],errors:[],failures:[]};
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const path=resolve(site,decodeURIComponent(pathname.slice(1)||'index.html'));if(!path.startsWith(site+sep))throw Error('Invalid path');res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});res.end(await readFile(path));}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch();
 for(const viewport of [{width:1440,height:900},{width:390,height:667},{width:360,height:568}]){
  await withPreviewViewport(browser,viewport,origin,async page=>{
  page.on('pageerror',error=>report.errors.push({viewport,message:error.message}));
  await page.goto(origin);await page.getByRole('heading',{name:'52週新高値・新安値',exact:true}).waitFor();
  const capture=async(name,{table=false,source='real'}={})=>{
   if(table){const summaries=page.locator('.indicator-history-panel summary');if(await summaries.count())await summaries.first().click();}
   let keyboardScrolling=[];
   try{keyboardScrolling=await checkHistoryKeyboardScrolling(page);}catch(error){report.failures.push(`${name}: ${error.message}`);}
   const geometry=await page.evaluate(inspectPreviewGeometry);
   const file=`${viewport.width}x${viewport.height}-${source}-${name}.png`;
   await page.mouse.move(0,0);
   await page.screenshot({path:resolve(output,'screenshots',file),fullPage:true});
   const accessibility=await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa']).analyze();
   report.screens.push({file,viewport,source,geometry,keyboard_scrolling:keyboardScrolling,serious_violations:seriousAccessibilityViolations(accessibility.violations)});
   if(geometry.overflow||geometry.overlays)report.failures.push(`${file}: overflow or error overlay`);
  };
  const captureViewport=async(name,evidence)=>{
   const file=`${viewport.width}x${viewport.height}-real-${name}.png`;
   const geometry=await page.evaluate(inspectPreviewGeometry);
   await page.screenshot({path:resolve(output,'screenshots',file),fullPage:false});
   report.viewport_screens.push({file,viewport,source:'real',geometry,evidence});
   if(geometry.overflow||geometry.overlays)report.failures.push(`${file}: overflow or error overlay`);
  };
  await capture('high-low',{table:true});
  for(const [label,name] of [['Put/Call','put-call-unavailable'],['分配日','distribution-unavailable'],['接近・上抜け','entry-first-observation']]){await page.getByRole('button',{name:label,exact:true}).click();await capture(name,{table:true});}
  await page.getByLabel('ピボット下の接近幅').selectOption('1');await page.getByLabel('履歴の選択手法').selectOption('minervini2');await capture('entry-method-and-approach');
  await page.getByRole('button',{name:'実データ：銘柄履歴',exact:true}).click();
  try{await captureCandidateViewports(page,captureViewport);}catch(error){report.failures.push(`${viewport.width} candidates: ${error.message}`);}
  await page.getByRole('tab',{name:'履歴',exact:true}).click();await page.getByRole('heading',{name:'ベース段階の推移（自動推計）',exact:true}).waitFor();
  await capture('stock-history',{table:true});
  try{await captureBaseViewports(page,captureViewport);}catch(error){report.failures.push(`${viewport.width} base: ${error.message}`);}
  await page.getByRole('button',{name:'合成：境界条件',exact:true}).click();
  for(const [label,name] of [['Put/Call','put-call-gap'],['分配日','distribution-retirement-gap'],['接近・上抜け','entry-rearmed']]){await page.getByRole('button',{name:label,exact:true}).click();await capture(name,{table:true,source:'synthetic'});}
  });
 }
 if(report.errors.length)report.failures.push('Browser runtime errors');
 const serious=report.screens.flatMap(screen=>screen.serious_violations);if(serious.length)report.failures.push('Serious accessibility violations');
} catch(error){report.failures.push(error.message);} finally {
 await writeFile(resolve(output,'browser-report.json'),JSON.stringify(report,null,2));
 await browser?.close();await new Promise(done=>server.close(done));
}
if(report.failures.length)throw Error(report.failures.join('\n'));
console.log(JSON.stringify({screens:report.screens.length,failures:0,output}));
