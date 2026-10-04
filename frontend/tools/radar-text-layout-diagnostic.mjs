// Artifact-only experiment. Never imported by the app or a publication gate.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve, extname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { EXPERIMENT_VERSION, VARIANTS, trialPlan, tracePlan, measurementEvidence, summarizeTrials, traceCosts } from './radar-text-layout-contract.mjs';
import { stoppedTraceArtifact } from './radar-trace-stop.mjs';
import { fontResourceEvidence } from './radar-font-resources.mjs';

if (!process.env.CI) throw Error('This bounded browser experiment runs only in CI.');
const root = resolve('test-results/radar-build'), output = resolve('test-results/radar-text-layout');
await mkdir(output, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sourcePaths = ['src/static/components/SetupRadar.jsx', 'src/static/radarMarks.js', 'src/static/positionGeometry.js',
  'src/static/researchEngine.js', 'src/static/research.css', 'src/static/workbench.css', 'src/static/theme/foundation.css',
  'src/static/theme/motion.css', 'src/static/theme/tokens.js', 'src/static/components/researchOverview.css', 'src/index.css',
  'tools/radar-benchmark.jsx', 'tools/radar-benchmark-context.mjs', 'tools/radar-benchmark-context.css', 'tools/radar-visibility.mjs',
  'tools/fixtures/radar-207-2026-09-29.json', 'tools/radar-text-layout-contract.mjs', 'tools/radar-text-layout-diagnostic.mjs', 'tools/radar-trace-stop.mjs', 'tools/radar-font-resources.mjs'];
const manifest = { experiment_version: EXPERIMENT_VERSION, commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']),
  source_sha256: {}, built_sha256: {}, variants: Object.fromEntries(Object.entries(VARIANTS).map(([key, css]) => [key, { css, sha256: sha(css) }])) };
for (const path of sourcePaths) manifest.source_sha256[path] = sha(await readFile(path));
for (const file of await readdir(root)) { manifest.built_sha256[file] = sha(await readFile(resolve(root, file))); await copyFile(resolve(root, file), resolve(output, file)); }
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
const report = { ...manifest, production_adoption_allowed: false, production_acceptance: 'not_evaluated',
  method: '24 uninstrumented fresh-browser cold first mounts; three alternating pairs for each viewport/theme. Eight additional fresh-browser CPU/timeline traces are separate observations. No retries, warmup, preload, missing-font fallback win, or financial preparation.',
  screenshot_method: 'Same-task bitmap/CSS witness is the exact endpoint evidence. immediate-after-endpoint PNG has before/after clocks and may be later. A trace endpoint-frame image is emitted only when its timestamp lies after initial paint and no later than the endpoint. Settled-font PNG is separate.',
  planned_trials: trialPlan(), planned_traces: tracePlan(), samples: [], conclusions: [] };
const saveReport = async () => { report.conclusions = summarizeTrials(report.samples); await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`), check = relative(root, file);
    if (check.startsWith('..') || isAbsolute(check)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const allowedHosts = new Set(['127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com']);

async function sampleCase(spec, ordinal) {
  const id = `${String(ordinal).padStart(2, '0')}-${spec.width}-${spec.theme}-${spec.variant}-${spec.instrumented ? 'trace' : `pair${spec.pair}`}`;
  const sample = { ...spec, id, source_commit: manifest.commit, source_tree: manifest.tree, variant_css_sha256: manifest.variants[spec.variant].sha256,
    resources: [], unexpected_requests: [], complete_fonts: false, labels_axes_match: null };
  report.samples.push(sample);
  let browser, session, tracing = false, profiling = false;
  const traceEvents = [], requests = new Map();
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const requestUrl = route.request().url();
      if (allowedHosts.has(new URL(requestUrl).hostname)) return route.continue();
      sample.unexpected_requests.push(requestUrl); return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    session = await context.newCDPSession(page);
    await session.send('Network.enable');
    session.on('Network.requestWillBeSent', event => {
      requests.set(event.requestId, { url: event.request.url, type: event.type });
      sample.resources.push({ event: 'request', id: event.requestId, type: event.type, url: event.request.url, timestamp: event.timestamp });
    });
    session.on('Network.responseReceived', event => sample.resources.push({ event: 'response', id: event.requestId, type: event.type,
      url: event.response.url, status: event.response.status, mime_type: event.response.mimeType, from_disk_cache: event.response.fromDiskCache, timestamp: event.timestamp }));
    session.on('Network.loadingFinished', event => sample.resources.push({ event: 'finished', id: event.requestId, ...requests.get(event.requestId), encoded_bytes: event.encodedDataLength, timestamp: event.timestamp }));
    session.on('Network.loadingFailed', event => sample.resources.push({ event: 'failed', id: event.requestId, ...requests.get(event.requestId), type: event.type, error: event.errorText, timestamp: event.timestamp }));
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => typeof window.measureRadar === 'function', null, { timeout: 10000 });
    // Both arms get one style insertion. No glyphs, React tree or geometry exist.
    await page.addStyleTag({ content: VARIANTS[spec.variant] });
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    if (spec.instrumented) {
      await session.send('Profiler.enable'); await session.send('Profiler.start'); profiling = true;
      const available = new Set((await session.send('Tracing.getCategories')).categories);
      sample.trace_categories = ['devtools.timeline', 'v8.execute', 'disabled-by-default-v8.compile', 'blink.user_timing', 'disabled-by-default-devtools.screenshot'].filter(category => available.has(category));
      session.on('Tracing.dataCollected', event => traceEvents.push(...event.value));
      await session.send('Tracing.start', { categories: sample.trace_categories.join(','), transferMode: 'ReportEvents' }); tracing = true;
    }
    sample.measurement = await page.evaluate(theme => window.measureRadar({ theme, diagnosticRetain: true }), spec.theme);
    sample.evidence = measurementEvidence(sample.measurement, spec.variant);
    const screenshot = async label => {
      const before = await page.evaluate(() => window.inspectRadarDiagnostic());
      // CDP capture does not use Playwright's implicit screenshot font wait.
      const result = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      const after = await page.evaluate(() => window.inspectRadarDiagnostic());
      const file = `${id}-${label}.png`; await writeFile(resolve(output, file), Buffer.from(result.data, 'base64'));
      return { file, before, after, exact_endpoint: false, endpoint_ms: sample.measurement.diagnostic_clock.endpoint_ms };
    };
    sample.immediate_after_endpoint = await screenshot('immediate-after-endpoint');
    sample.font_settlement = await page.evaluate(async () => {
      let timer; const loaded = await Promise.race([document.fonts.ready.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 15000); })]);
      clearTimeout(timer);
      if (loaded) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { completed: loaded, now_ms: performance.now(), status: document.fonts.status };
    });
    sample.settled_fonts = await screenshot('settled-fonts');
    await session.send('DOM.enable'); await session.send('CSS.enable');
    const { root: dom } = await session.send('DOM.getDocument'); sample.platform_fonts = {};
    for (const selector of ['.setup-radar header strong', '.radar-zone-label', '.radar-x', '.setup-radar footer span']) {
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: dom.nodeId, selector });
      sample.platform_fonts[selector] = nodeId ? (await session.send('CSS.getPlatformFontsForNode', { nodeId })).fonts : [];
    }
    const faces = sample.settled_fonts.after.font_faces;
    const loadedFamily = name => faces.some(face => face.status === 'loaded' && face.family.replace(/["']/g, '').includes(name));
    sample.font_resource_evidence = fontResourceEvidence(sample.resources);
    const fontFailures = sample.font_resource_evidence.font_failures;
    const renderedFamily = (selector, name) => sample.platform_fonts[selector].some(font => font.isCustomFont && font.glyphCount > 0 && `${font.familyName} ${font.postScriptName}`.replace(/[^a-z]/gi, '').toLowerCase().includes(name));
    sample.complete_fonts = sample.font_settlement.completed && sample.font_settlement.status === 'loaded' && loadedFamily('Zen Kaku Gothic New') && loadedFamily('Geist Mono') &&
      renderedFamily('.setup-radar header strong', 'zenkakugothicnew') && renderedFamily('.radar-x', 'geistmono') &&
      !fontFailures.length && !sample.font_resource_evidence.unresolved_resources.length &&
      !faces.some(face => face.status === 'error') && !sample.unexpected_requests.length;
    sample.font_failures = fontFailures;
    sample.font_resource_hashes = [];
    for (const resource of sample.font_resource_evidence.hash_resources) {
      try {
        const body = await session.send('Network.getResponseBody', { requestId: resource.id });
        const bytes = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8');
        sample.font_resource_hashes.push({ url: resource.url, type: resource.type, sha256: sha(bytes), decoded_bytes: bytes.length });
      } catch (error) { sample.font_resource_hashes.push({ url: resource.url, error: String(error) }); sample.complete_fonts = false; }
    }
  } catch (error) { sample.error = error.stack || String(error); }
  finally {
    if (tracing) {
      try {
        const artifact = await stoppedTraceArtifact(session, traceEvents);
        sample.trace_stop = artifact.trace_stop; sample.trace_file_partial = artifact.partial;
        if (!artifact.trace_stop.ok) sample.trace_error = artifact.trace_stop.error;
        const file = `${id}.trace.json`; await writeFile(resolve(output, file), JSON.stringify(artifact)); sample.trace_file = file;
        sample.trace_costs = traceCosts(artifact.traceEvents);
        const frames = artifact.traceEvents.filter(event => event.name === 'FireAnimationFrame');
        const paint = artifact.traceEvents.find(event => event.name === 'Paint' && event.ts >= frames[0]?.ts && event.ts <= frames[1]?.ts);
        const frame = artifact.traceEvents.filter(event => event.name === 'Screenshot' && event.args?.snapshot && event.ts >= paint?.ts && event.ts <= frames[1]?.ts).at(-1);
        if (frame) {
          const bytes = Buffer.from(frame.args.snapshot, 'base64'), extension = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : 'jpg';
          const file = `${id}-endpoint-trace-frame.${extension}`; await writeFile(resolve(output, file), bytes);
          sample.endpoint_trace_frame = { file, trace_timestamp_us: frame.ts, measured_endpoint_callback_us: frames[1].ts, first_paint_us: paint.ts, later_image_substituted: false };
        } else sample.endpoint_trace_frame = { unavailable: true, reason: 'No trace screenshot after first Paint and no later than endpoint; later screenshots are never substituted.' };
      } catch (error) { sample.trace_error = String(error); }
    }
    if (profiling && sample.trace_stop?.ok === false) sample.profile_error = 'Skipped another protocol wait after the trace stop failed; partial trace and sample are retained.';
    else if (profiling) { try { const { profile } = await session.send('Profiler.stop'); const file = `${id}.cpuprofile`; await writeFile(resolve(output, file), JSON.stringify(profile)); sample.cpu_profile_file = file; } catch (error) { sample.profile_error = String(error); } }
    // Persist a failed trace sample before any subsequent browser cleanup.
    await saveReport();
    await browser?.close();
  }
  await saveReport();
}

try {
  await saveReport();
  let ordinal = 0;
  for (const spec of [...trialPlan(), ...tracePlan()]) await sampleCase(spec, ++ordinal);
  for (const sample of report.samples) {
    const control = report.samples.find(other => other.width === sample.width && other.theme === sample.theme && other.pair === sample.pair && other.instrumented === sample.instrumented && other.variant === 'control');
    sample.labels_axes_match = Boolean(control?.settled_fonts && sample.settled_fonts &&
      JSON.stringify(control.settled_fonts.after.labels) === JSON.stringify(sample.settled_fonts.after.labels) &&
      JSON.stringify(control.settled_fonts.after.axes) === JSON.stringify(sample.settled_fonts.after.axes));
  }
  await saveReport();
  const incomplete = report.samples.filter(sample => sample.error || sample.trace_error || sample.profile_error || !sample.complete_fonts || !sample.labels_axes_match || sample.evidence?.unexpected_failures.length);
  report.execution_complete = report.samples.length === 32 && incomplete.length === 0;
  report.incomplete_sample_ids = incomplete.map(sample => sample.id); await saveReport();
  console.log(JSON.stringify({ experiment_version: EXPERIMENT_VERSION, samples: report.samples.length, execution_complete: report.execution_complete, conclusions: report.conclusions }, null, 2));
  if (!report.execution_complete) process.exitCode = 1;
} finally { await new Promise(resolve => server.close(resolve)); }
