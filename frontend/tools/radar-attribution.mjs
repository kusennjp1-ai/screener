// One bounded diagnostic matrix. No acceptance workload, timing or limit changes.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const root = resolve('test-results/radar-attribution-build');
const output = resolve(process.env.RADAR_ATTRIBUTION_OUTPUT || 'test-results/radar-attribution');
const modes = ['empty-root', 'prepared-frame', 'full-radar'];
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  diagnostic_only: true,
  question: 'How much cold cost remains with an empty React commit and with the exact prepared DOM frame, relative to the complete production Radar?',
  method: 'CPU4, three fresh browser contexts per mode/viewport in rotated order. Profiling uses a separate fourth fresh context. Prepared-frame deliberately excludes data/markup preparation and canvas lifecycle; full-radar includes them. createRoot precedes timing in all modes, matching the acceptance harness. Differences are attribution clues, not additive component costs or acceptance results.',
  stopping_condition: 'Inspect this one matrix. Propose a production change only when the full-radar excess and its trace identify removable work. Otherwise retain the failing acceptance result and report that no safe measured optimization was established; do not repeat unchanged runs for a pass.',
  viewports: [], failures: [],
};
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const path = relative(root, file);
    if (path.startsWith('..') || isAbsolute(path)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' })[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
let browser;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function traceCosts(events) {
  const start = events.find(event => event.name === 'radar-attribution:start')?.ts;
  const end = events.find(event => event.name === 'radar-attribution:frame-end')?.ts;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw Error('Missing attribution timing marks');
  const duration = name => events.filter(event => event.ph === 'X' && event.name === name).reduce((sum, event) => sum + Math.max(0, Math.min(event.ts + event.dur, end) - Math.max(event.ts, start)), 0) / 1000;
  return { interval_ms: (end - start) / 1000, compile_ms: duration('V8.CompileCode'), layout_ms: duration('Layout'), style_ms: duration('UpdateLayoutTree'), paint_ms: duration('Paint'), note: 'Do not add nested V8 compile/parse events or CPU samples to these durations.' };
}
async function measure(viewport, mode, profile = false) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof window.measureRadarAttribution === 'function');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const events = [];
    if (profile) {
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
      cdp.on('Tracing.dataCollected', data => events.push(...data.value));
      await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,disabled-by-default-v8.compile,blink.user_timing', transferMode: 'ReportEvents' });
    }
    const result = await page.evaluate(mode => window.measureRadarAttribution(mode), mode);
    if (profile) {
      const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.end'); await done;
      const { profile: cpu } = await cdp.send('Profiler.stop');
      const prefix = `${mode}-${viewport.width}`;
      await writeFile(resolve(output, `${prefix}.cpuprofile`), JSON.stringify(cpu));
      await writeFile(resolve(output, `${prefix}.trace.json`), JSON.stringify({ traceEvents: events }));
      result.trace_costs = traceCosts(events);
      await page.screenshot({ path: resolve(output, `${prefix}.png`) });
    }
    if (mode === 'full-radar' && (result.point_count !== 207 || result.final_point_count !== 207 || !result.pixel_alignment?.matches)) throw Error('Full Radar did not finish all 207 points at actual pixel size');
    if (mode !== 'full-radar' && (result.point_count !== null || result.final_point_count !== null)) throw Error('A control unexpectedly painted stock points');
    return result;
  } finally { await context.close(); }
}
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const cases = Object.fromEntries(modes.map(mode => [mode, { runs: [], instrumented: null }]));
    const order = [];
    for (let repetition = 0; repetition < 3; repetition++) for (let step = 0; step < modes.length; step++) {
      const mode = modes[(repetition + step) % modes.length];
      order.push(mode);
      cases[mode].runs.push(await measure(viewport, mode));
    }
    for (const mode of modes) cases[mode].instrumented = await measure(viewport, mode, true);
    for (const mode of modes) {
      cases[mode].median_render_layout_ms = median(cases[mode].runs.map(run => run.render_layout_ms));
      cases[mode].median_first_frame_ms = median(cases[mode].runs.map(run => run.first_frame_ms));
    }
    const fullFrame = JSON.stringify(cases['full-radar'].runs[0].frame);
    const matchingFrames = ['prepared-frame', 'full-radar'].every(mode => [...cases[mode].runs, cases[mode].instrumented].every(run => JSON.stringify(run.frame) === fullFrame));
    if (!matchingFrames) report.failures.push(`${viewport.width}: frame control differs in labels or layout; do not interpret its timing difference`);
    report.viewports.push({ viewport, cpu_rate: 4, order, matching_frames: matchingFrames, cases });
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  for (const name of ['benchmark.js', 'benchmark.js.map']) await writeFile(resolve(output, name), await readFile(resolve(root, name)));
} catch (error) {
  report.failures.push(error.stack || error.message);
} finally {
  if (browser) await browser.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ diagnostic_only: true, failures: report.failures, viewports: report.viewports.map(({ viewport, matching_frames, cases }) => ({ viewport, matching_frames, cases: Object.fromEntries(Object.entries(cases).map(([mode, value]) => [mode, { render_layout_ms: value.runs.map(run => run.render_layout_ms), first_frame_ms: value.runs.map(run => run.first_frame_ms), trace_costs: value.instrumented.trace_costs }])) })) }, null, 2));
if (report.failures.length) process.exitCode = 1;
