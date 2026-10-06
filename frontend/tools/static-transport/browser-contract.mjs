// Production-module Chromium page/Worker contracts. Importing does not launch a
// browser. The CLI is for authorized CI after its existing Playwright install.
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { pack } from './pack.mjs';
import { sha256 } from './files.mjs';

export const EXPECTED_CASES = 20;
const here = dirname(fileURLToPath(import.meta.url));
export async function buildBrowserFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'production-transport-browser-'));
  try {
    const raw = Buffer.from('{"integer":9007199254740993,"decimal":1.2300,"negativeZero":-0,"nothing":null,"array":[3,2,1],"source_generated_at":"2026-09-28T12:34:56Z","proof_at":"2026-09-29T01:00:00Z"}\n');
    const paths = ['static-data/markets/us/charts/AA.json', 'static-data/research-details/AA.json', 'static-data/markets/us/scan/chunks/chunk-0001.json'];
    const manifest = Buffer.from('{"research_generation":"browser-contract"}\n');
    for (const [path, bytes] of [...paths.map(path => [path, raw]), ['index.html', raw], ['static-data/manifest.json', manifest]]) {
      const file = join(directory, 'source', path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes);
    }
    const bindings = { manifestSha256: sha256(manifest), uiInventorySha256: '2'.repeat(64), financialGeneration: null, financialLineageSha256: null, sourceCommit: '3'.repeat(40), appCommit: '4'.repeat(40), candidateId: '5'.repeat(64) };
    const packed = await pack({ source: join(directory, 'source'), output: join(directory, 'packed'), bindings });
    const routes = [];
    for (const path of Object.keys(packed.physicalInventory)) routes.push([path, Array.from(await readFile(join(directory, 'packed', path)))]);
    const root = JSON.parse(await readFile(join(directory, 'packed', packed.expectedRoot.path), 'utf8'));
    const inflation = Buffer.alloc(8 * 1024 * 1024, 65), inflationGzip = gzipSync(inflation, { level: 6 });
    return { paths, path: paths[0], raw: Array.from(raw), routes, root, expectedRoot: packed.expectedRoot, emptyGzip: Array.from(gzipSync(Buffer.alloc(0), { level: 6 })), inflation: { encoded: Array.from(inflationGzip), decodedBytes: inflation.length, sha256: sha256(inflation) }, expectedCases: EXPECTED_CASES };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

// This exact function runs unchanged in page and module Worker. It can also run
// under Node's web APIs to validate harness logic without launching a browser.
export async function browserContracts(fixture) {
  const { createStaticTransport } = await import(`${fixture.moduleRoot}index.mjs`);
  const { canonicalBytes, generationBody, PREFIX, sha256 } = await import(`${fixture.moduleRoot}format.mjs`);
  const raw = Uint8Array.from(fixture.raw), baseRoutes = new Map(fixture.routes.map(([path, bytes]) => [path, Uint8Array.from(bytes)]));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  const rejects = async (promise, pattern) => {
    try { await promise; } catch (error) { check(!pattern || pattern.test(error.message), `Unexpected rejection: ${error.message}`); return; }
    throw new Error('Unexpected success');
  };
  const fresh = () => ({ root: structuredClone(fixture.root), expectedRoot: structuredClone(fixture.expectedRoot), routes: new Map(baseRoutes) });
  const pathOf = url => new URL(url).pathname.slice(new URL(fixture.baseURL).pathname.length);
  const fetchFor = state => async url => { const bytes = state.routes.get(pathOf(url)); return new Response(bytes ?? null, { status: bytes ? 200 : 404 }); };
  const clients = new Set();
  const open = async (state, extra = {}) => {
    const client = await createStaticTransport({ baseURL: fixture.baseURL, expectedRoot: state.expectedRoot, fetchImpl: fetchFor(state), ...extra }); clients.add(client); return client;
  };
  const repinRoot = async (state, suppliedBytes) => {
    state.root.generation = await sha256(canonicalBytes(generationBody(state.root)));
    const bytes = suppliedBytes || canonicalBytes(state.root), digest = await sha256(bytes), path = `${PREFIX}root-${digest}.json`;
    state.routes.set(path, bytes); state.expectedRoot = { path, bytes: bytes.length, sha256: digest, generation: state.root.generation, bindings: structuredClone(state.root.bindings) };
  };
  const shardId = (await sha256(new TextEncoder().encode(fixture.path))).slice(0, 2);
  const mutateShard = async (state, mutate) => {
    const id = shardId, index = parseInt(id, 16), descriptor = state.root.shards[index];
    const shard = JSON.parse(new TextDecoder().decode(state.routes.get(descriptor.path)));
    await mutate(shard, shard.files.find(entry => entry.path === fixture.path));
    const bytes = canonicalBytes(shard), digest = await sha256(bytes), path = `${PREFIX}shard-${digest}.json`;
    state.routes.set(path, bytes); state.root.shards[index] = { id, path, bytes: bytes.length, sha256: digest }; await repinRoot(state);
  };
  const originalShard = JSON.parse(new TextDecoder().decode(baseRoutes.get(fixture.root.shards[parseInt(shardId, 16)].path)));
  const originalEntry = originalShard.files.find(entry => entry.path === fixture.path), encoded = baseRoutes.get(originalEntry.assetPath);
  const replaceAsset = async (state, bytes, extra = {}) => mutateShard(state, async (shard, entry) => {
    const digest = await sha256(bytes), path = `${PREFIX}gzip/${digest}.bin`;
    state.routes.set(path, bytes); Object.assign(entry, { assetPath: path, encodedBytes: bytes.length, encodedSha256: digest }, extra);
  });
  const cases = [];
  const run = async (name, callback) => {
    const start = performance.now(); let timeout, timedOut = false;
    try {
      const details = await Promise.race([callback(), new Promise((_, reject) => { timeout = setTimeout(() => { timedOut = true; reject(new Error(`Contract timed out: ${name}`)); }, 5000); })]);
      cases.push({ name, status: 'passed', milliseconds: Math.round(performance.now() - start), ...(details ? { details } : {}) });
    } catch (error) { cases.push({ name, status: 'failed', milliseconds: Math.round(performance.now() - start), error: String(error.stack || error.message).slice(0, 2048) }); }
    finally { clearTimeout(timeout); for (const client of clients) client.dispose(); clients.clear(); }
    const progress = { realm: typeof document === 'undefined' ? (typeof self === 'undefined' ? 'node' : 'worker') : 'page', case: cases.at(-1) };
    if (typeof document === 'undefined' && typeof self !== 'undefined') self.postMessage({ progress });
    else if (!fixture.quiet) console.info(`STATIC_TRANSPORT_CASE ${JSON.stringify(progress)}`);
    if (timedOut) throw new Error(`Contract timed out: ${name}`);
  };

  await run('native fetch preserves all three cohorts, identity and JSON shape', async () => {
    const bootstrapStarted = performance.now(), client = await open(fresh(), { fetchImpl: globalThis.fetch });
    const rootBootstrapMilliseconds = Math.round(performance.now() - bootstrapStarted), firstStarted = performance.now();
    check(equal(await client.readBytes(fixture.path), raw), 'Canonical first-read bytes changed');
    const firstLogicalReadMilliseconds = Math.round(performance.now() - firstStarted);
    for (const path of [...fixture.paths.slice(1), 'index.html']) check(equal(await client.readBytes(path), raw), 'Canonical bytes changed');
    const value = await client.readJson(fixture.path);
    check(Object.is(value.negativeZero, -0) && value.nothing === null && !Object.hasOwn(value, 'missing') && value.array.join(',') === '3,2,1', 'JSON shape changed');
    return { rootBytes: fixture.expectedRoot.bytes, rootBootstrapMilliseconds, firstLogicalReadMilliseconds, firstLogicalDecodedBytes: raw.length, timingScope: 'Fresh transport instance and first logical read in this realm; synthetic local HTTP fixture, not a full-app or retained-candidate benchmark' };
  });
  await run('root is small; authenticated shards are lazy, deduplicated and LRU bounded', async () => {
    const state = fresh(), fetcher = fetchFor(state), calls = [];
    const client = await open(state, { limits: { cachedShards: 1 }, fetchImpl: async (...args) => { calls.push(args[0]); return fetcher(...args); } });
    check(calls.length === 1 && state.expectedRoot.bytes <= 65536, 'Bootstrap is not a single bounded root');
    await Promise.all(Array.from({ length: 12 }, () => client.lookup(fixture.path))); check(calls.length === 2, 'Shard lookup was not deduplicated');
    await client.lookup('index.html'); await client.lookup(fixture.path);
    check(calls.length === 4, 'LRU did not evict older shard'); check(calls.slice(1).every(url => url.includes('/shard-')), 'Lookup fetched a full inventory or asset');
  });
  await run('root hash, size, generation, binding and address pins are mandatory', async () => {
    for (const mutate of [pins => { pins.bytes = 1; }, pins => { pins.sha256 = '0'.repeat(64); }, pins => { pins.generation = '0'.repeat(64); }, pins => { pins.bindings.appCommit = '0'.repeat(40); }, pins => { pins.path = '../escape.json'; }, pins => { pins.bytes = 65537; }]) {
      const state = fresh(); mutate(state.expectedRoot); await rejects(open(state));
    }
  });
  await run('corrupt or missing authenticated shard never falls back to raw JSON', async () => {
    const state = fresh(), descriptor = state.root.shards[parseInt(shardId, 16)], client = await open(state), good = state.routes.get(descriptor.path);
    state.routes.set(descriptor.path, new Uint8Array(good.length)); await rejects(client.readJson(fixture.path), /SHA-256/);
    state.routes.delete(descriptor.path); await rejects(client.readJson(fixture.path), /HTTP failure/);
    state.routes.set(descriptor.path, good); check(equal(await client.readBytes(fixture.path), raw), 'A failed shard poisoned retries');
  });
  await run('duplicate keys and duplicate, unsafe or wrongly sharded paths fail closed', async () => {
    for (const mutate of [(shard, entry) => shard.files.push({ ...entry }), (shard, entry) => { entry.path = '../escape'; }, (shard, entry) => { entry.path = 'different.json'; }]) {
      const state = fresh(); await mutateShard(state, mutate); const client = await open(state); await rejects(client.readBytes(fixture.path));
    }
    const state = fresh(), duplicate = new TextEncoder().encode(new TextDecoder().decode(canonicalBytes(state.root)).replace('{"format":', '{"format":"bad","format":'));
    await repinRoot(state, duplicate); await rejects(open(state), /Noncanonical/);
  });
  await run('corrupt, missing and oversized encoded assets are rejected', async () => {
    for (const mode of ['corrupt', 'missing', 'oversized']) {
      const state = fresh(), client = await open(state), entry = await client.lookup(fixture.path);
      if (mode === 'missing') state.routes.delete(entry.assetPath);
      else { const bytes = new Uint8Array(mode === 'oversized' ? encoded.length + 1 : encoded); bytes[12] ^= 1; state.routes.set(entry.assetPath, bytes); }
      await rejects(client.readBytes(fixture.path));
    }
  });
  await run('correctly re-pinned truncated gzip cannot expose bytes', async () => {
    const state = fresh(); await replaceAsset(state, encoded.slice(0, -6)); const client = await open(state); await rejects(client.readBytes(fixture.path));
  });
  await run('trailing junk, empty extra member and full extra member fail', async () => {
    for (const suffix of [new Uint8Array(8), Uint8Array.from(fixture.emptyGzip), encoded]) {
      const state = fresh(), bytes = new Uint8Array(encoded.length + suffix.length); bytes.set(encoded); bytes.set(suffix, encoded.length);
      await replaceAsset(state, bytes); const client = await open(state); await rejects(client.readBytes(fixture.path));
    }
  });
  await run('encoded/decoded lengths, decoded hash and original source pins are enforced', async () => {
    for (const field of ['encodedBytes', 'decodedBytes', 'decodedSha256']) {
      const state = fresh(); await mutateShard(state, (shard, entry) => { entry[field] = field === 'decodedSha256' ? '0'.repeat(64) : entry[field] + 1; });
      const client = await open(state); await rejects(client.readBytes(fixture.path));
    }
    const client = await open(fresh());
    await rejects(client.readBytes(fixture.path, { expectedDecodedSha256: '0'.repeat(64) }), /Logical source SHA/);
    await rejects(client.readBytes(fixture.path, { expectedDecodedBytes: 1 }), /Logical source length/);
  });
  async function inspectInflation(abortAfterOutput) {
    const state = fresh(), bytes = Uint8Array.from(fixture.inflation.encoded), abort = new AbortController();
    const declaredBytes = abortAfterOutput ? fixture.inflation.decodedBytes : 12;
    if (!abortAfterOutput) new DataView(bytes.buffer).setUint32(bytes.length - 4, declaredBytes, true);
    await replaceAsset(state, bytes, { decodedBytes: declaredBytes, decodedSha256: fixture.inflation.sha256 });
    let inputChunks = 0, inputBytes = 0, maximumInputChunkBytes = 0, firstOutputChunkBytes = null, outputBytes = 0;
    class InspectedInflater { constructor(format) {
      const input = new TransformStream({ transform(chunk, controller) { inputChunks++; inputBytes += chunk.length; maximumInputChunkBytes = Math.max(maximumInputChunkBytes, chunk.length); controller.enqueue(chunk); } });
      const output = new TransformStream({ transform(chunk, controller) { firstOutputChunkBytes ??= chunk.length; outputBytes += chunk.length; if (abortAfterOutput) abort.abort(); controller.enqueue(chunk); } });
      return { writable: input.writable, readable: input.readable.pipeThrough(new DecompressionStream(format)).pipeThrough(output) };
    } }
    const client = await open(state, { decompressionStream: InspectedInflater });
    await rejects(client.readBytes(fixture.path, { signal: abort.signal }), abortAfterOutput ? /abort/i : /exceeds permitted size/);
    await new Promise(resolve => setTimeout(resolve, 0));
    check(inputChunks > 0 && maximumInputChunkBytes <= 1024 && firstOutputChunkBytes > 12, 'Native bounded stream boundary was not exercised');
    if (abortAfterOutput) check(abort.signal.aborted && outputBytes > 0, 'Abort happened before native output');
    return { compressedBytes: bytes.length, actualDecodedBytes: fixture.inflation.decodedBytes, declaredDecodedBytes: declaredBytes, inputChunks, inputBytes, maximumInputChunkBytes, firstOutputChunkBytes, outputBytes, stoppedBeforeAllCompressedInput: inputBytes < bytes.length, nativeQueueAndHeapMeasured: false };
  }
  await run('high-ratio native output is capped with at most 1KiB input chunks', () => inspectInflation(false));
  await run('abort after native high-ratio output begins exposes no bytes', () => inspectInflation(true));
  await run('unsupported inflater explicitly fails while identity remains readable', async () => {
    for (const decompressionStream of [null, class { constructor() { throw new Error('unsupported'); } }]) {
      const client = await open(fresh(), { decompressionStream }); await rejects(client.readBytes(fixture.path), /Unsupported transport/);
      check(equal(await client.readBytes('index.html'), raw), 'Identity required an inflater');
    }
  });
  await run('blocked assets abort from request, generation and either combined signal', async () => {
    for (const mode of ['request', 'transport', 'both-request', 'both-transport']) {
      const state = fresh(), fetcher = fetchFor(state), outer = new AbortController(), inner = new AbortController(); let started, canceled = false;
      const seen = new Promise(resolve => { started = resolve; });
      const client = await open(state, { signal: mode !== 'request' ? outer.signal : undefined, fetchImpl: async (...args) => args[0].endsWith('.bin') ? new Response(new ReadableStream({ start() { started(); }, cancel() { canceled = true; } })) : fetcher(...args) });
      const pending = client.readBytes(fixture.path, { signal: mode !== 'transport' ? inner.signal : undefined }); await seen;
      (mode.endsWith('transport') ? outer : inner).abort(); await rejects(pending, /abort/i); check(canceled, `Body not canceled: ${mode}`);
    }
  });
  await run('stale generation and dispose cannot expose an in-flight result', async () => {
    const state = fresh(), fetcher = fetchFor(state); let generation = state.expectedRoot.generation, canceled = false;
    const client = await open(state, { getCurrentGeneration: () => generation, fetchImpl: async (...args) => {
      if (!args[0].endsWith('.bin')) return fetcher(...args);
      generation = 'stale'; return new Response(new ReadableStream({ cancel() { canceled = true; } }));
    } });
    await rejects(client.readJson(fixture.path), /Stale/); check(canceled, 'Stale response body not canceled');
    const otherState = fresh(), otherFetcher = fetchFor(otherState); let started, disposedBody = false;
    const seen = new Promise(resolve => { started = resolve; });
    const other = await open(otherState, { fetchImpl: async (...args) => args[0].endsWith('.bin') ? new Response(new ReadableStream({ start() { started(); }, cancel() { disposedBody = true; } })) : otherFetcher(...args) });
    const pending = other.readJson(fixture.path); await seen; other.dispose(); await rejects(pending, /disposed/i);
    check(disposedBody, 'Dispose did not cancel the in-flight body'); await rejects(other.lookup(fixture.path), /disposed/i);
  });
  await run('one subscriber abort preserves others; last abort releases a pending slot', async () => {
    const state = fresh(), fetcher = fetchFor(state); let started, release, canceled = false;
    let seen = new Promise(resolve => { started = resolve; });
    const client = await open(state, { limits: { pendingShards: 1 }, fetchImpl: async (...args) => {
      if (!args[0].includes('/shard-')) return fetcher(...args);
      return new Response(new ReadableStream({ start(controller) { release = () => { controller.enqueue(state.routes.get(pathOf(args[0]))); controller.close(); }; started(); }, cancel() { canceled = true; } }));
    } });
    const abort = new AbortController(), first = client.lookup(fixture.path, { signal: abort.signal }), second = client.lookup(fixture.path);
    await seen; abort.abort(); await rejects(first, /abort/i); check(!canceled, 'One subscriber canceled shared I/O'); release(); await second;
    seen = new Promise(resolve => { started = resolve; }); const only = new AbortController(), pending = client.lookup('index.html', { signal: only.signal });
    await seen; only.abort(); await rejects(pending, /abort/i); check(canceled, 'Last subscriber did not cancel I/O');
    seen = new Promise(resolve => { started = resolve; }); const replacement = client.lookup('index.html'); await seen; release(); await replacement;
  });
  await run('missing compressed members fail closed and paths cannot escape the site', async () => {
    const client = await open(fresh()); await rejects(client.lookup('static-data/markets/us/charts/ABSENT.json'), /Missing compressed logical path/);
    check(await client.lookup('unknown.json') === undefined, 'Unknown noncohort path did not remain unknown');
    for (const path of ['../escape.json', '/absolute.json', 'a/%2e%2e/b', 'https://elsewhere.test/a']) await rejects(client.lookup(path), /Invalid logical/);
  });
  await run('oversized declarations are rejected before asset fetch and limits cannot increase', async () => {
    const state = fresh(), fetcher = fetchFor(state); let assets = 0;
    const client = await open(state, { limits: { decodedBytes: 1 }, fetchImpl: async (...args) => { if (args[0].endsWith('.bin')) assets++; return fetcher(...args); } });
    await rejects(client.readBytes(fixture.path), /cap exceeded/); check(assets === 0, 'Oversized asset fetched');
    await rejects(open(fresh(), { limits: { rootBytes: 65537 } }), /Invalid transport limit/);
  });
  await run('early rejection does not await an uncooperative cancellation promise', async () => {
    const state = fresh(), fetcher = fetchFor(state); let canceled = false;
    const client = await open(state, { fetchImpl: async (...args) => args[0].endsWith('.bin') ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(encoded.length + 1)); }, cancel() { canceled = true; return new Promise(() => {}); } })) : fetcher(...args) });
    await rejects(client.readBytes(fixture.path), /exceeds permitted size/); check(canceled, 'Oversized body not canceled');
  });
  await run('caller pin mutation and returned byte mutation cannot corrupt cached state', async () => {
    const state = fresh(), promise = open(state); state.expectedRoot.bindings.appCommit = '0'.repeat(40); const client = await promise;
    const first = await client.readBytes(fixture.path); first.fill(0);
    check(equal(await client.readBytes(fixture.path), raw), 'Caller mutated retained bytes'); check(Object.isFrozen(await client.lookup(fixture.path)), 'Cached descriptor is mutable');
  });
  await run('native HTTP gzip/br wrappers preserve pins; mislabeled gzip and mutation fail', async () => {
    const observed = [];
    for (const encoding of ['gzip', 'br']) {
      let responses = 0;
      const client = await open(fresh(), { baseURL: new URL(`../http-${encoding}/`, fixture.baseURL).href, fetchImpl: async (...args) => {
        const response = await globalThis.fetch(...args);
        check(response.headers.get('Content-Encoding') === encoding, 'Native Fetch did not retain the HTTP encoding header');
        responses++; return response;
      } });
      check(equal(await client.readBytes(fixture.path), raw), `HTTP ${encoding} wrapper changed the gzip asset representation`);
      check(equal(await client.readBytes('static-data/manifest.json'), baseRoutes.get('static-data/manifest.json')), `HTTP ${encoding} wrapper changed identity JSON`);
      observed.push({ encoding, verifiedResponses: responses });
    }
    // This route deliberately labels the stored gzip member as the HTTP coding
    // instead of applying a separate outer coding. Fetch expands it too early;
    // the physical asset length/SHA must reject it before transport inflation.
    const mislabeled = await open(fresh(), { baseURL: new URL('../http-mislabeled/', fixture.baseURL).href, fetchImpl: globalThis.fetch });
    await rejects(mislabeled.readBytes(fixture.path), /encoded length|encoded SHA-256|exceeds permitted size/);
    const mutated = await open(fresh(), { baseURL: new URL('../http-mutated/', fixture.baseURL).href, fetchImpl: globalThis.fetch });
    await rejects(mutated.readBytes('static-data/manifest.json'), /encoded SHA-256/);
    return { nativeHTTP: true, observed, mislabeledStoredGzipRejected: true, mutatedIdentityRejected: true };
  });
  check(cases.length === fixture.expectedCases, 'Unexpected browser contract count');
  return { userAgent: globalThis.navigator?.userAgent || 'Node web APIs', passed: cases.filter(item => item.status === 'passed').length, failed: cases.filter(item => item.status === 'failed').length, cases };
}

export async function startFixtureServer(fixture) {
  const routes = new Map(fixture.routes.map(([path, bytes]) => [`/fixture/${path}`, { bytes: Uint8Array.from(bytes), type: 'application/octet-stream' }]));
  for (const [path, values] of fixture.routes) {
    const bytes = Uint8Array.from(values), type = 'application/octet-stream';
    routes.set(`/http-gzip/${path}`, { bytes: gzipSync(bytes), type, encoding: 'gzip' });
    routes.set(`/http-br/${path}`, { bytes: brotliCompressSync(bytes), type, encoding: 'br' });
    routes.set(`/http-mislabeled/${path}`, { bytes, type, ...(path.endsWith('.bin') ? { encoding: 'gzip' } : {}) });
    if (path === 'static-data/manifest.json') {
      const mutated = new Uint8Array(bytes); mutated[1] ^= 1;
      routes.set(`/http-mutated/${path}`, { bytes: gzipSync(mutated), type, encoding: 'gzip' });
    } else routes.set(`/http-mutated/${path}`, { bytes, type });
  }
  routes.set('/', { bytes: Buffer.from('<!doctype html><title>Static transport contracts</title>'), type: 'text/html' });
  for (const name of ['index.mjs', 'format.mjs', 'codec.mjs']) routes.set(`/modules/${name}`, { bytes: await readFile(join(here, '../../src/static/transport', name)), type: 'text/javascript' });
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); const item = routes.get(request.url);
    if (!item) { response.statusCode = 404; response.end(); return; }
    response.setHeader('Content-Type', item.type);
    if (item.encoding) response.setHeader('Content-Encoding', item.encoding);
    response.end(item.bytes);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--report')) throw new Error('Usage: node browser-contract.mjs [--report REPORT_JSON]');
  const reportPath = resolve(args[1] || 'static-transport-browser-report.json');
  const report = { schema: 'static-transport-browser-contract-v1', scope: 'Synthetic production-codec contracts in Chromium page and module Worker; no full application, retained-candidate assets, deployment, native heap or peak-memory claim', sourceCommit: process.env.GITHUB_SHA || null, workflowRunId: process.env.GITHUB_RUN_ID || null, workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null, node: process.versions.node, expectedCasesPerRealm: EXPECTED_CASES, started: new Date().toISOString(), progress: { page: [], worker: [] } };
  await mkdir(dirname(reportPath), { recursive: true });
  let server, browser, pendingWrite = Promise.resolve(), reportWriteError;
  const deadline = async (promise, milliseconds, label) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })]); }
    finally { clearTimeout(timer); }
  };
  const checkpoint = () => {
    if (reportWriteError) return pendingWrite;
    const bytes = `${JSON.stringify(report, null, 2)}\n`;
    pendingWrite = pendingWrite.then(() => writeFile(reportPath, bytes)).catch(error => { reportWriteError = error; });
    return pendingWrite;
  };
  const progress = value => { report.progress[value.realm].push(value.case); void checkpoint(); };
  try {
    await checkpoint(); if (reportWriteError) throw reportWriteError;
    const fixture = await buildBrowserFixture(); server = await startFixtureServer(fixture);
    fixture.moduleRoot = `${server.origin}/modules/`; fixture.baseURL = `${server.origin}/fixture/`;
    const { chromium } = await import('@playwright/test'); browser = await chromium.launch({ headless: true }); report.chromium = browser.version();
    const context = await browser.newContext();
    await context.route('**/*', route => route.request().url().startsWith(`${server.origin}/`) ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('console', message => { if (message.text().startsWith('STATIC_TRANSPORT_CASE ')) progress(JSON.parse(message.text().slice('STATIC_TRANSPORT_CASE '.length))); });
    await page.goto(`${server.origin}/`); const pageStarted = performance.now();
    report.page = await deadline(page.evaluate(browserContracts, fixture), 120000, 'Page contracts'); report.page.realmMilliseconds = Math.round(performance.now() - pageStarted); await checkpoint();
    const workerStarted = performance.now();
    report.worker = await deadline(page.evaluate(async ({ fixture, source }) => {
      const code = `const contracts = (${source}); self.onmessage = async ({data}) => { try { self.postMessage({result: await contracts(data)}); } catch(error) { self.postMessage({error: error.stack || error.message}); } };`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), worker = new Worker(url, { type: 'module' }); let timer;
      try {
        return await new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Module Worker contracts timed out')), 120000);
          worker.onmessage = ({ data }) => { if (data.progress) console.info(`STATIC_TRANSPORT_CASE ${JSON.stringify(data.progress)}`); else if (data.error) reject(new Error(data.error)); else resolve(data.result); };
          worker.onerror = event => reject(new Error(event.message)); worker.postMessage(fixture);
        });
      } finally { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); }
    }, { fixture, source: browserContracts.toString() }), 125000, 'Worker contracts');
    report.worker.realmMilliseconds = Math.round(performance.now() - workerStarted);
    if (report.page.failed || report.worker.failed || report.page.passed !== EXPECTED_CASES || report.worker.passed !== EXPECTED_CASES) process.exitCode = 1;
  } catch (error) { report.fatal = String(error.stack || error.message).slice(0, 2048); process.exitCode = 1; }
  finally {
    for (const [label, cleanup] of [['Browser cleanup', () => browser?.close()], ['Server cleanup', () => server?.close()]]) {
      try { await deadline(Promise.resolve().then(cleanup), 15000, label); }
      catch (error) { (report.cleanupErrors ||= []).push(String(error.stack || error.message).slice(0, 2048)); process.exitCode = 1; }
    }
    report.finished = new Date().toISOString(); await checkpoint();
    if (reportWriteError) { report.fatal = `Report write failed: ${reportWriteError.message}`; process.exitCode = 1; }
    console.log(JSON.stringify({ reportPath, pagePassed: report.page?.passed, workerPassed: report.worker?.passed, fatal: report.fatal, cleanupErrors: report.cleanupErrors }));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
