// Isolated Chromium page + module Worker diagnostic. No app integration or publication.
// Usage: node browser-contract.mjs /absolute/path/to/playwright-core/index.mjs [PACKED_DIRECTORY]
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { canonicalBytes, FORMAT, generationBytes, invariant, MANIFEST_PATH, RECEIPT_PATH, validateManifest } from './format.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = dirname(fileURLToPath(import.meta.url));
const [playwrightPath, packedArgument] = process.argv.slice(2);
invariant(playwrightPath && isAbsolute(playwrightPath) && process.argv.length <= 4, 'Usage: node browser-contract.mjs ABSOLUTE_PLAYWRIGHT_MODULE [PACKED_DIRECTORY]');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const raw = Buffer.from('{"integer":9007199254740993,"decimal":1.2300,"negativeZero":-0,"nothing":null,"array":[3,2,1],"source_generated_at":"2026-09-28T12:34:56Z","proof_at":"2026-09-29T01:00:00Z"}\n');
const compressed = gzipSync(raw, { level: 6 });
const inflationRaw = Buffer.alloc(8 * 1024 * 1024, 65);
const inflationCompressed = gzipSync(inflationRaw, { level: 6 });
invariant(inflationCompressed.length > 1024 && inflationRaw.length / inflationCompressed.length > 100, 'Inflation fixture must span multiple input chunks at a high compression ratio');
const dataPath = 'static-data/markets/us/charts/AA.json';
const assetPath = `_lossless/gzip/${sha(compressed)}.json.gz`;
const files = [
  { path: 'index.html', kind: 'identity', assetPath: 'index.html', encodedBytes: raw.length, encodedSha256: sha(raw), decodedBytes: raw.length, decodedSha256: sha(raw) },
  { path: dataPath, kind: 'gzip', assetPath, encodedBytes: compressed.length, encodedSha256: sha(compressed), decodedBytes: raw.length, decodedSha256: sha(raw) },
];
const generation = sha(generationBytes(files));
const manifest = { format: FORMAT, generation, files };
const manifestBytes = canonicalBytes(manifest);
const memoryRoutes = new Map([
  ['/', { type: 'text/html', bytes: Buffer.from('<!doctype html><title>Local lossless transport contracts</title><p>Local contract fixture</p>') }],
  ['/fixture/index.html', { type: 'application/octet-stream', bytes: raw }],
  [`/fixture/${assetPath}`, { type: 'application/octet-stream', bytes: compressed }],
]);
for (const name of ['format.mjs', 'decode.mjs']) memoryRoutes.set(`/${name}`, { type: 'text/javascript', bytes: await readFile(join(directory, name)) });

// Only the exact files selected below are served. This is not a filesystem server.
const diskRoutes = new Map();
let candidate;
if (packedArgument) {
  const packed = resolve(packedArgument);
  const receipt = JSON.parse(await readFile(join(packed, RECEIPT_PATH), 'utf8'));
  const bytes = await readFile(join(packed, MANIFEST_PATH));
  invariant(bytes.length === receipt.manifestBytes && sha(bytes) === receipt.manifestSha256, 'Candidate local manifest pins do not match');
  const packedManifest = JSON.parse(bytes);
  validateManifest(packedManifest);
  invariant(sha(generationBytes(packedManifest.files)) === receipt.generation && packedManifest.generation === receipt.generation, 'Candidate generation mismatch');
  const selectLargest = (name, predicate) => {
    const entry = packedManifest.files.filter(predicate).sort((a, b) => b.decodedBytes - a.decodedBytes)[0];
    invariant(entry, `Missing candidate ${name}`);
    diskRoutes.set(`/candidate/${entry.assetPath}`, join(packed, entry.assetPath));
    return { name, path: entry.path, encodedBytes: entry.encodedBytes, decodedBytes: entry.decodedBytes, decodedSha256: entry.decodedSha256 };
  };
  candidate = {
    pins: { expectedManifestBytes: receipt.manifestBytes, expectedManifestSha256: receipt.manifestSha256, expectedGeneration: receipt.generation },
    samples: [
      selectLargest('largest scan chunk', entry => entry.kind === 'gzip' && entry.path.startsWith('static-data/markets/us/scan/chunks/')),
      selectLargest('largest US source chart', entry => entry.kind === 'gzip' && entry.path.startsWith('static-data/markets/us/charts/')),
      selectLargest('largest research detail', entry => entry.kind === 'gzip' && entry.path.startsWith('static-data/research-details/')),
      selectLargest('largest identity file', entry => entry.kind === 'identity'),
    ],
  };
  memoryRoutes.set(`/candidate/${MANIFEST_PATH}`, { type: 'application/json', bytes });
}

const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const memory = memoryRoutes.get(request.url);
  if (memory) { response.setHeader('Content-Type', memory.type); response.end(memory.bytes); return; }
  const disk = diskRoutes.get(request.url);
  if (disk) {
    response.setHeader('Content-Type', 'application/octet-stream');
    const stream = createReadStream(disk);
    stream.on('error', error => response.destroy(error));
    response.on('close', () => stream.destroy());
    stream.pipe(response);
    return;
  }
  response.statusCode = 404; response.end();
});

// This function has no Node dependencies and is run unchanged in both realms.
async function browserContracts(fixture) {
  const { openTransport } = await import(`${fixture.moduleRoot}decode.mjs`);
  const { canonicalBytes, generationBytes } = await import(`${fixture.moduleRoot}format.mjs`);
  const raw = Uint8Array.from(fixture.raw), encoded = Uint8Array.from(fixture.encoded);
  const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  const options = (extra = {}) => ({ manifestBytes: Uint8Array.from(fixture.manifestBytes), expectedManifestBytes: fixture.manifestBytes.length, expectedManifestSha256: fixture.manifestSha256, expectedGeneration: fixture.manifest.generation, rootUrl: fixture.rootUrl, ...extra });
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  const rejects = async (promise, pattern) => {
    try { await promise; } catch (error) { check(!pattern || pattern.test(error.message), `Unexpected rejection: ${error.message}`); return; }
    throw new Error('Unexpected success');
  };
  const repin = async (manifest, extra = {}) => {
    manifest.generation = await sha(generationBytes(manifest.files));
    const bytes = canonicalBytes(manifest);
    return options({ manifestBytes: bytes, expectedManifestBytes: bytes.length, expectedManifestSha256: await sha(bytes), expectedGeneration: manifest.generation, ...extra });
  };
  const cases = [];
  const run = async (name, callback) => {
    const start = performance.now(); let timer, timedOut = false;
    try {
      const details = await Promise.race([callback(), new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error(`Contract timed out: ${name}`)); }, 5000); })]);
      cases.push({ name, status: 'passed', milliseconds: Math.round(performance.now() - start), ...(details ? { details } : {}) });
    } catch (error) { cases.push({ name, status: 'failed', milliseconds: Math.round(performance.now() - start), error: error.stack || error.message }); }
    finally { clearTimeout(timer); }
    const progress = { realm: typeof document === 'undefined' ? 'worker' : 'page', case: cases.at(-1) };
    if (typeof document === 'undefined') self.postMessage({ progress });
    else console.info(`LOSSLESS_CASE ${JSON.stringify(progress)}`);
    // Preserve completed cases, then stop an uncooperative realm rather than
    // running more tests alongside an operation that could not be interrupted.
    if (timedOut) throw new Error(`Contract timed out: ${name}`);
  };
  await run('native fetch, gzip, identity and JSON shape', async () => {
    const decoder = await openTransport(options());
    for (const path of ['index.html', fixture.path]) check(equal(await decoder.readBytes(path), raw), 'Original bytes changed');
    const value = await decoder.readJson(fixture.path);
    check(Object.is(value.negativeZero, -0) && value.nothing === null && !Object.hasOwn(value, 'missing') && value.array.join(',') === '3,2,1', 'JSON shape changed');
  });
  await run('corrupt compressed SHA', async () => {
    const bytes = encoded.slice(); bytes[12] ^= 1;
    const decoder = await openTransport(options({ fetchImpl: async () => new Response(bytes) }));
    await rejects(decoder.readBytes(fixture.path), /Encoded SHA-256/);
  });
  await run('truncated correctly pinned gzip', async () => {
    const manifest = structuredClone(fixture.manifest), bytes = encoded.slice(0, -6), entry = manifest.files[1];
    entry.encodedBytes = bytes.length; entry.encodedSha256 = await sha(bytes); entry.assetPath = `_lossless/gzip/${entry.encodedSha256}.json.gz`;
    const decoder = await openTransport(await repin(manifest, { fetchImpl: async () => new Response(bytes) }));
    await rejects(decoder.readBytes(fixture.path));
  });
  await run('trailing zero bytes and an empty second gzip member', async () => {
    for (const suffix of [new Uint8Array(8), Uint8Array.from(fixture.emptyGzip)]) {
      const manifest = structuredClone(fixture.manifest), bytes = new Uint8Array(encoded.length + suffix.length), entry = manifest.files[1];
      bytes.set(encoded); bytes.set(suffix, encoded.length);
      entry.encodedBytes = bytes.length; entry.encodedSha256 = await sha(bytes); entry.assetPath = `_lossless/gzip/${entry.encodedSha256}.json.gz`;
      const decoder = await openTransport(await repin(manifest, { fetchImpl: async () => new Response(bytes) }));
      await rejects(decoder.readBytes(fixture.path));
    }
  });
  await run('encoded and decoded size plus decoded SHA', async () => {
    for (const field of ['encodedBytes', 'decodedBytes', 'decodedSha256']) {
      const manifest = structuredClone(fixture.manifest);
      manifest.files[1][field] = field === 'decodedSha256' ? '0'.repeat(64) : manifest.files[1][field] + 1;
      const decoder = await openTransport(await repin(manifest));
      await rejects(decoder.readBytes(fixture.path), /Encoded length|Decoded/);
    }
  });
  await run('native inflation and prefetch caps', async () => {
    const manifest = structuredClone(fixture.manifest); manifest.files[1].decodedBytes = 12;
    const decoder = await openTransport(await repin(manifest));
    await rejects(decoder.readBytes(fixture.path), /exceeds permitted size/);
    let fetched = false;
    const capped = await openTransport(options({ limits: { encodedBytes: 1 }, fetchImpl: async () => { fetched = true; return new Response(); } }));
    await rejects(capped.readBytes(fixture.path), /cap/); check(!fetched, 'Oversize asset was fetched');
  });
  // The wrappers inspect the public stream boundaries only. Observed compressed
  // read-ahead is reported, not assumed absent; native queues and heap are not
  // measured by these checks, and the wrappers may affect stream scheduling.
  const inspectNativeInflation = async ({ abortAfterFirstOutput }) => {
    const bytes = Uint8Array.from(fixture.inflationBomb.encoded), manifest = structuredClone(fixture.manifest), entry = manifest.files[1];
    check(bytes.length > 1024, 'Inflation fixture cannot distinguish whole-asset input from chunked input');
    entry.encodedBytes = bytes.length; entry.encodedSha256 = await sha(bytes); entry.assetPath = `_lossless/gzip/${entry.encodedSha256}.json.gz`;
    const declaredCap = 12;
    entry.decodedBytes = abortAfterFirstOutput ? fixture.inflationBomb.decodedBytes : declaredCap;
    entry.decodedSha256 = fixture.inflationBomb.decodedSha256;
    const abort = new AbortController();
    let inputChunks = 0, inputBytes = 0, maximumInputChunkBytes = 0, firstOutputChunkBytes = null, outputBytes = 0, abortRaised = false;
    class InspectedNativeInflater {
      constructor(format) {
        const input = new TransformStream({ transform(chunk, controller) {
          check(chunk.byteLength <= 1024, `Inflater input chunk exceeds 1 KiB: ${chunk.byteLength}`);
          inputChunks++; inputBytes += chunk.byteLength; maximumInputChunkBytes = Math.max(maximumInputChunkBytes, chunk.byteLength);
          controller.enqueue(chunk);
        } });
        const output = new TransformStream({ transform(chunk, controller) {
          if (firstOutputChunkBytes === null && chunk.byteLength > 0) firstOutputChunkBytes = chunk.byteLength;
          outputBytes += chunk.byteLength;
          if (abortAfterFirstOutput && chunk.byteLength > 0 && !abortRaised) { abortRaised = true; abort.abort(); }
          controller.enqueue(chunk);
        } });
        return { writable: input.writable, readable: input.readable.pipeThrough(new DecompressionStream(format)).pipeThrough(output) };
      }
    }
    const decoder = await openTransport(await repin(manifest, { decompressionStream: InspectedNativeInflater, fetchImpl: async () => new Response(bytes) }));
    await rejects(decoder.readBytes(fixture.path, { signal: abort.signal }), abortAfterFirstOutput ? /abort/i : /exceeds permitted size/);
    // Allow cancellation propagation before recording boundary observations.
    await new Promise(resolve => setTimeout(resolve, 0));
    check(inputChunks > 0 && maximumInputChunkBytes <= 1024, 'No bounded inflater input was observed');
    check(firstOutputChunkBytes > declaredCap, 'The declared cap must be smaller than the first expanded chunk');
    if (abortAfterFirstOutput) check(abortRaised && abort.signal.aborted && outputBytes > 0, 'Abort did not occur after native inflation began');
    return { compressedBytes: bytes.length, actualDecodedBytes: fixture.inflationBomb.decodedBytes, declaredDecodedBytes: entry.decodedBytes, inputChunks, inputBytes, maximumInputChunkBytes, firstOutputChunkBytes, outputBytes, stoppedBeforeAllCompressedInput: inputBytes < bytes.length, nativeQueueAndHeapMeasured: false };
  };
  await run('high-ratio native inflation rejects output above cap with 1 KiB input chunks', () => inspectNativeInflation({ abortAfterFirstOutput: false }));
  await run('abort after native high-ratio inflation starts rejects without exposing bytes', () => inspectNativeInflation({ abortAfterFirstOutput: true }));
  await run('trusted manifest and logical source pins', async () => {
    await rejects(openTransport(options({ expectedManifestSha256: '0'.repeat(64) })), /Manifest SHA/);
    await rejects(openTransport(options({ expectedManifestBytes: 1 })), /byte length/);
    await rejects(openTransport(options({ expectedGeneration: '0'.repeat(64) })), /generation/);
    const decoder = await openTransport(options());
    await rejects(decoder.readBytes(fixture.path, { expectedDecodedSha256: '0'.repeat(64) }), /Logical source SHA/);
    await rejects(decoder.readBytes(fixture.path, { expectedDecodedBytes: 1 }), /Logical source length/);
    await rejects(decoder.readBytes('../escape.json'), /Unknown logical/);
  });
  await run('duplicate keys, duplicate paths and unsafe paths', async () => {
    for (const mutate of [manifest => manifest.files.push(manifest.files[1]), manifest => { manifest.files[0].path = '../escape.json'; }]) {
      const manifest = structuredClone(fixture.manifest); mutate(manifest);
      await rejects(openTransport(await repin(manifest)), /Duplicate|logical path/);
    }
    const text = new TextDecoder().decode(Uint8Array.from(fixture.manifestBytes)).replace('{"format":', '{"format":"bad","format":');
    const bytes = new TextEncoder().encode(text);
    await rejects(openTransport(options({ manifestBytes: bytes, expectedManifestBytes: bytes.length, expectedManifestSha256: await sha(bytes) })), /Noncanonical/);
  });
  await run('unsupported inflater fails explicitly; identity remains readable', async () => {
    for (const decompressionStream of [null, class { constructor() { throw new Error('unsupported'); } }]) {
      const decoder = await openTransport(options({ decompressionStream }));
      await rejects(decoder.readBytes(fixture.path), /Unsupported decoder/);
      check(equal(await decoder.readBytes('index.html'), raw), 'Identity requires inflater');
    }
  });
  await run('blocked-body abort from request, transport and both signals', async () => {
    for (const mode of ['request', 'transport', 'both-request', 'both-transport']) {
      const outer = new AbortController(), inner = new AbortController(); let canceled = false;
      const decoder = await openTransport(options({ signal: mode !== 'request' ? outer.signal : undefined, fetchImpl: async () => new Response(new ReadableStream({ cancel() { canceled = true; } })) }));
      const pending = decoder.readBytes(fixture.path, { signal: mode !== 'transport' ? inner.signal : undefined });
      await new Promise(resolve => setTimeout(resolve, 1));
      (mode.endsWith('transport') ? outer : inner).abort();
      await rejects(pending, /abort/i); check(canceled, `Body was not canceled: ${mode}`);
    }
  });
  await run('stale response cannot expose JSON and cancels body', async () => {
    let generation = fixture.manifest.generation, canceled = false;
    const decoder = await openTransport(options({ getCurrentGeneration: () => generation, fetchImpl: async () => { generation = 'stale'; return new Response(new ReadableStream({ cancel() { canceled = true; } })); } }));
    await rejects(decoder.readJson(fixture.path), /Stale/); check(canceled, 'Stale response was not canceled');
  });
  await run('rejection does not await an uncooperative cancel promise', async () => {
    const decoder = await openTransport(options({ fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(encoded.length + 1)); }, cancel() { return new Promise(() => {}); } })) }));
    let timeout;
    try { await Promise.race([rejects(decoder.readBytes(fixture.path), /exceeds permitted size/), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Cancellation blocked rejection')), 1000); })]); }
    finally { clearTimeout(timeout); }
  });
  await run('HTTP encoding rejection cancels body', async () => {
    let canceled = false;
    const decoder = await openTransport(options({ fetchImpl: async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'Content-Encoding': 'gzip' } }) }));
    await rejects(decoder.readBytes(fixture.path), /HTTP content encoding/); check(canceled, 'Rejected response was not canceled');
  });
  return { userAgent: navigator.userAgent, passed: cases.filter(item => item.status === 'passed').length, failed: cases.filter(item => item.status === 'failed').length, cases };
}

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const diagnostic = { node: process.versions.node, zlib: process.versions.zlib,
  scope: 'Isolated transport contracts in Chromium page and module Worker; actual candidate samples on page only, no application integration or full app gates',
  nativeBufferingScope: 'High-ratio contract observations count public stream-boundary chunks; instrumentation can affect scheduling; not a native-heap bound' };
try {
  browser = await chromium.launch({ headless: true });
  diagnostic.chromium = browser.version();
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('console', message => { const value = message.text(); if (value.startsWith('LOSSLESS_CASE ') || value.startsWith('LOSSLESS_SAMPLE ')) console.error(value); });
  await page.goto(`${origin}/`);
  const fixture = { moduleRoot: `${origin}/`, rootUrl: `${origin}/fixture/`, raw: Array.from(raw), encoded: Array.from(compressed), emptyGzip: Array.from(gzipSync(Buffer.alloc(0))), inflationBomb: { encoded: Array.from(inflationCompressed), decodedBytes: inflationRaw.length, decodedSha256: sha(inflationRaw) }, path: dataPath, manifest, manifestBytes: Array.from(manifestBytes), manifestSha256: sha(manifestBytes) };
  const pageResult = await page.evaluate(browserContracts, fixture);
  diagnostic.page = pageResult;
  const workerResult = await page.evaluate(async ({ fixture, source }) => {
    const code = `const contracts = (${source}); self.onmessage = async ({data}) => { try { self.postMessage({result: await contracts(data)}); } catch(error) { self.postMessage({error: error.stack || error.message}); } };`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' }); let timeout;
    try {
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Module Worker contracts timed out')), 30000);
        worker.onmessage = ({ data }) => {
          if (data.progress) { console.info(`LOSSLESS_CASE ${JSON.stringify(data.progress)}`); return; }
          return data.error ? reject(new Error(data.error)) : resolve(data.result);
        };
        worker.onerror = event => reject(new Error(event.message));
        worker.postMessage(fixture);
      });
    } finally { clearTimeout(timeout); worker.terminate(); URL.revokeObjectURL(url); }
  }, { fixture, source: browserContracts.toString() });
  diagnostic.worker = workerResult;
  let candidateResult;
  if (candidate) {
    candidateResult = await page.evaluate(async ({ origin, candidate }) => {
      const { openTransport } = await import(`${origin}/decode.mjs`);
      const heap = () => performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize, jsHeapSizeLimit: performance.memory.jsHeapSizeLimit } : null;
      const beforeManifestHeap = heap(), fetchStarted = performance.now();
      const bytes = new Uint8Array(await (await fetch(`${origin}/candidate/_lossless/manifest.json`)).arrayBuffer());
      const manifestFetchMilliseconds = Math.round(performance.now() - fetchStarted), afterManifestFetchHeap = heap();
      const started = performance.now();
      const transport = await openTransport({ ...candidate.pins, manifestBytes: bytes, rootUrl: `${origin}/candidate/` });
      const manifestMilliseconds = Math.round(performance.now() - started), afterManifestValidationHeap = heap(), samples = [];
      for (const sample of candidate.samples) {
        const before = performance.now(), beforeHeap = heap();
        try {
          const decoded = await transport.readBytes(sample.path, { expectedDecodedBytes: sample.decodedBytes, expectedDecodedSha256: sample.decodedSha256 });
          if (decoded.length !== sample.decodedBytes) throw new Error(`Candidate sample length changed: ${sample.path}`);
          samples.push({ ...sample, status: 'passed', milliseconds: Math.round(performance.now() - before), beforeHeap, afterHeap: heap(), allPinnedBytesVerified: true });
        } catch (error) { samples.push({ ...sample, status: 'failed', milliseconds: Math.round(performance.now() - before), beforeHeap, afterHeap: heap(), error: error.stack || error.message }); }
        console.info(`LOSSLESS_SAMPLE ${JSON.stringify(samples.at(-1))}`);
      }
      return { manifestBytes: bytes.length, manifestFetchMilliseconds, manifestMilliseconds, beforeManifestHeap, afterManifestFetchHeap, afterManifestValidationHeap, memoryScope: 'performance.memory snapshots of Chromium page JS heap only; implementation-dependent/possibly quantized, not peak, native allocations or total browser memory; no forced GC; sequential samples may retain prior allocations', samples };
    }, { origin, candidate });
  }
  if (candidateResult) diagnostic.candidate = candidateResult;
  if (pageResult.cases.length !== 15 || workerResult.cases.length !== 15 || pageResult.failed || workerResult.failed || (candidate && candidateResult?.samples.length !== 4) || candidateResult?.samples.some(item => item.status === 'failed')) process.exitCode = 1;
} catch (error) {
  diagnostic.fatal = error.stack || error.message; process.exitCode = 1;
} finally {
  console.log(JSON.stringify(diagnostic, null, 2));
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
