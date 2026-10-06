// Supplemental evidence only: never substitutes for exact-candidate budgets.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const checksum=value=>createHash('sha256').update(value).digest('hex');
export function productionShapedBootstrap(preview,predecessor) {
  if(preview?.schema!=='static-json-transport-preview-v1'||preview.publication_authority!=='none'||!preview.transport
    ||predecessor?.schema!==1||!predecessor.known_price_dates||!predecessor.verification_universe)throw Error('Missing production-shaped bootstrap inputs');
  const result=structuredClone(predecessor);
  // Retain real public ledger/universe fields to exercise their parsing cost.
  // Remove all authority and old financial release references. This object
  // exists only in a Playwright route, never in the candidate or hosted tree.
  for(const key of ['approval','financial_release','financial_correction','financial_generation','financial_lineage_sha256','data_inventory_sha256'])delete result[key];
  result.schema=1;
  result.publication_authority='none';
  result.diagnostic_only='synthetic metadata envelope; retained public ledger; no publication authority';
  result.ui_sha=preview.ui_sha;result.ui_digest=preview.ui_digest;
  result.data_manifest_sha256=preview.data_manifest_sha256;
  result.transport=structuredClone(preview.transport);
  result.data_inventory_sha256=preview.transport.logical_data_inventory_sha256;
  if(preview.transport.root.bindings.financialGeneration!==null){
    result.financial_generation=preview.transport.root.bindings.financialGeneration;
    result.financial_lineage_sha256=preview.transport.root.bindings.financialLineageSha256;
  }
  return result;
}

export async function recordProductionBootstrapDiagnostic({browser,url,currentRoot,viewports,readySelector,onProgress=async()=>{}}) {
  let preview;
  try{preview=JSON.parse(await readFile(resolve(currentRoot,'publication.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')return {status:'not_applicable',reason:'No unpublished transport bootstrap'};throw error;}
  if(preview.schema!=='static-json-transport-preview-v1')return {status:'not_applicable',reason:'Exact candidate already uses a different bootstrap'};
  let previous,sourceReceiptHash,sourceReceiptBytes=null;
  if(process.env.FINANCIAL_CANDIDATE_DIR){
    previous=await readFile(resolve(process.env.FINANCIAL_CANDIDATE_DIR,'predecessor/publication.json'));
    sourceReceiptHash=checksum(previous);sourceReceiptBytes=previous.length;
  }
  else{
    const state=JSON.parse(await readFile(resolve(process.env.RUNNER_TEMP||'/tmp','verified-publication/state.json'),'utf8'));
    if(!state.live?.receipt||!/^[a-f0-9]{64}$/.test(state.live.receiptHash||''))throw Error('Retained public receipt identity is missing');
    sourceReceiptHash=state.live.receiptHash;
    previous=Buffer.from(JSON.stringify(state.live.receipt));
  }
  const predecessor=JSON.parse(previous),body=JSON.stringify(productionShapedBootstrap(preview,predecessor));
  const report={status:'running',scope:'Supplemental synthetic production-shaped metadata; exact candidate assets/data unchanged. No release authority or replacement of primary budget trials.',
    method:'Three fresh browser/HTTP contexts per viewport, CPU 4x, actual app ready rows plus two animation frames. Public ledger fields retained; approval omitted.',
    predecessor_receipt_sha256:sourceReceiptHash,predecessor_receipt_bytes:sourceReceiptBytes,
    diagnostic_input_receipt_sha256:checksum(previous),diagnostic_input_receipt_bytes:previous.length,
    preview_bootstrap_bytes:Buffer.byteLength(JSON.stringify(preview)),synthetic_bootstrap_bytes:Buffer.byteLength(body),synthetic_bootstrap_sha256:checksum(body),runs:[]};
  await onProgress(report);
  const target=new URL('publication.json',url);
  for(const viewport of viewports)for(let trial=1;trial<=3;trial++){
    const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage();
    let intercepted=0;const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try{
      await page.route(value=>value.origin===target.origin&&value.pathname===target.pathname,async route=>{intercepted++;await route.fulfill({status:200,contentType:'application/json',headers:{'Cache-Control':'no-store'},body});});
      await page.addInitScript(()=>{window.__bootstrapTasks=[];new PerformanceObserver(list=>window.__bootstrapTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({entryTypes:['longtask']});});
      const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      const start=Date.now();await page.goto(url);await page.locator(readySelector).first().waitFor({state:'visible',timeout:60000});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const ready_ms=Date.now()-start,longest_task_ms=await page.evaluate(()=>Math.max(0,...window.__bootstrapTasks));
      if(intercepted<1||errors.length)throw Error(`Production-shaped bootstrap was not consumed cleanly: ${intercepted}; ${errors.join('; ')}`);
      report.runs.push({viewport,trial,ready_ms,longest_task_ms,intercepted,exceeds_original_ready_budget:ready_ms>3500,exceeds_original_task_budget:longest_task_ms>200});
      await onProgress(report);
      console.log(`Supplemental production-shaped metadata ${viewport.width}/${trial}: ready ${ready_ms}ms; long task ${longest_task_ms}ms; ${Buffer.byteLength(body)} metadata bytes.`);
    }finally{await context.close();}
  }
  report.status='measured';await onProgress(report);
  return report;
}
