// Focused CI diagnostic. The three acceptance measurements always precede a
// separately created cold browser context with CPU/timeline instrumentation.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, relative, isAbsolute } from 'node:path';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { RADAR_HARNESS_VERSION, radarMeasurementFailures } from './radar-benchmark-context.mjs';
import { designReviewProvenance } from './design-performance.mjs';
if (!process.env.CI) throw Error('Run this browser harness in GitHub Actions, not on the desktop host.');
const provenance = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), ...designReviewProvenance(process.env) };
const root=resolve(process.env.RADAR_BUILD || 'test-results/radar-build'), output=resolve(process.env.RADAR_DIAGNOSTIC_OUTPUT || 'test-results/radar-diagnostic');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
 try {
  const file=resolve(root,`.${new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname}`);
  const path=relative(root,file);if(path.startsWith('..')||isAbsolute(path)){res.writeHead(403).end();return;}
  const body=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.map':'application/json'})[extname(file)]||'application/octet-stream');res.end(body);
 } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`,browser=await chromium.launch();
const report=[];
try {
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
  const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage();
  await page.goto(url);await page.waitForFunction(()=>typeof window.measureRadar==='function');
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const runs=[];for(let index=0;index<3;index++)runs.push(await page.evaluate(()=>window.measureRadar()));
  await context.close();
  const diagnostic=await browser.newContext({viewport,serviceWorkers:'block'}),sample=await diagnostic.newPage();
  await sample.goto(url);await sample.waitForFunction(()=>typeof window.measureRadar==='function');
  const session=await diagnostic.newCDPSession(sample);await session.send('Emulation.setCPUThrottlingRate',{rate:4});
  await session.send('Profiler.enable');await session.send('Profiler.start');
  const events=[];session.on('Tracing.dataCollected',data=>events.push(...data.value));
  await session.send('Tracing.start',{categories:'devtools.timeline,v8.execute,disabled-by-default-v8.compile,blink.user_timing',transferMode:'ReportEvents'});
  const instrumented=await sample.evaluate(()=>window.measureRadar());
  const done=new Promise(resolve=>session.once('Tracing.tracingComplete',resolve));await session.send('Tracing.end');await done;
  const {profile}=await session.send('Profiler.stop');
  await writeFile(resolve(output,`radar-${viewport.width}.cpuprofile`),JSON.stringify(profile));
  await writeFile(resolve(output,`radar-${viewport.width}.trace.json`),JSON.stringify({traceEvents:events}));
  await diagnostic.close();
  // A separate non-proportional DPR2 viewport confirms ResizeObserver sizing
  // reaches the real physical resolution before the timed next-frame boundary.
  // It is additional evidence, never a replacement for any cold acceptance run.
  const alignmentContext=await browser.newContext({viewport,deviceScaleFactor:2,serviceWorkers:'block'}),alignmentPage=await alignmentContext.newPage();
  await alignmentPage.goto(url);await alignmentPage.waitForFunction(()=>typeof window.measureRadar==='function');
  const alignmentSession=await alignmentContext.newCDPSession(alignmentPage);await alignmentSession.send('Emulation.setCPUThrottlingRate',{rate:4});
  const alignment=await alignmentPage.evaluate(()=>window.measureRadar({width:innerWidth<=700?358:828}));
  await alignmentContext.close();
  const failures = runs.flatMap((run,index)=>radarMeasurementFailures(run).map(failure=>`run ${index+1}: ${failure}`));
  if(runs.length!==3)failures.push('requires all 3 runs including the cold first mount');
  // Extra DPR2 stress has alignment/context checks; it never replaces a cold
  // acceptance run or changes the existing 50ms gate on the three main runs.
  const alignmentFailures=radarMeasurementFailures(alignment,{timing:false}).map(failure=>`DPR2 context/alignment: ${failure}`);
  report.push({...provenance,viewport,cpu_rate:4,harness_version:RADAR_HARNESS_VERSION,comparison:'current-only; production CSS context v2 differs from historical bare-div v1',runs,instrumented,alignment,failures:[...failures,...alignmentFailures],pass:!failures.length&&!alignmentFailures.length});
 }
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
 await writeFile(resolve(output,'benchmark.js.map'),await readFile(resolve(root,'benchmark.js.map')));
 await writeFile(resolve(output,'benchmark.js'),await readFile(resolve(root,'benchmark.js')));
 console.log(JSON.stringify(report,null,2));if(report.some(item=>!item.pass))process.exitCode=1;
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
