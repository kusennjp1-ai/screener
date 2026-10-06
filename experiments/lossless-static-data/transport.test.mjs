import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pack } from './pack.mjs';
import { verify } from './verify.mjs';
import { openTransport } from './decode.mjs';
import { canonicalBytes, generationBytes, MANIFEST_PATH, RECEIPT_PATH } from './format.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const dataPath = 'static-data/markets/us/charts/A.json';
const raw = Buffer.from('{"integer":9007199254740993,"decimal":1.2300,"negativeZero":-0,"nothing":null,"array":[3,2,1],"source_generated_at":"2026-09-28T12:34:56Z","proof_at":"2026-09-29T01:00:00Z"}\n');
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'lossless-test-')); t.after(() => rm(base, { recursive: true, force: true }));
  const source = join(base, 'source'), output = join(base, 'packed');
  const originals = new Map([[dataPath, raw], ['static-data/research-details/A-1234.json', raw], ['static-data/markets/us/scan/chunks/chunk-0001.json', Buffer.from('[1,2,3]\n')], ['static-data/markets/us/charts/index.json', Buffer.from('{"path":"A.json"}\n')], ['index.html', Buffer.from('<!doctype html><p>same UI</p>')], ['qualification-audit.json', raw]]);
  for (const [path, bytes] of originals) { await mkdir(dirname(join(source, path)), { recursive: true }); await writeFile(join(source, path), bytes); }
  const receipt = await pack({ source, output }), manifest = JSON.parse(await readFile(join(output, MANIFEST_PATH)));
  const bytes = new Map();
  for (const entry of manifest.files) bytes.set(entry.assetPath, await readFile(join(output, entry.assetPath)));
  return { base, source, output, receipt, manifest, bytes, originals };
}
function options(f, extra = {}) {
  const manifestBytes = canonicalBytes(f.manifest);
  return { manifestBytes, expectedManifestBytes: manifestBytes.length, expectedManifestSha256: sha(manifestBytes), expectedGeneration: f.manifest.generation, rootUrl: 'https://example.test/screener/', fetchImpl: async url => {
    const path = new URL(url).pathname.slice('/screener/'.length), bytes = f.bytes.get(path);
    return new Response(bytes || null, { status: bytes ? 200 : 404 });
  }, ...extra };
}
function changeManifest(f, mutate) { mutate(f.manifest); f.manifest.generation = sha(generationBytes(f.manifest.files)); }
function entry(f) { return f.manifest.files.find(value => value.path === dataPath); }
function replaceAsset(f, bytes) { const target = entry(f); target.encodedBytes = bytes.length; target.encodedSha256 = sha(bytes); target.assetPath = `_lossless/gzip/${target.encodedSha256}.json.gz`; f.bytes.set(target.assetPath, bytes); }

// All tests use built-in Node APIs and bounded fixtures; no frontend/provider/build invocation.
test('deterministic packing; full Node recovery and browser-contract parity preserve original byte spelling', async t => {
  const f = await fixture(t), second = join(f.base, 'second');
  assert.deepEqual(await pack({ source: f.source, output: second }), f.receipt);
  for (const path of [...new Set(f.manifest.files.map(item => item.assetPath)), MANIFEST_PATH, RECEIPT_PATH]) assert.deepEqual(await readFile(join(second, path)), await readFile(join(f.output, path)));
  assert.equal(f.receipt.uniqueCompressedAssets, 2); assert.equal(f.receipt.dataFiles, 3);
  const result = await verify({ source: f.source, packed: f.output, restore: join(f.base, 'restored') });
  assert.equal(result.allOriginalBytesEqual, true);
  const decoder = await openTransport(options(f));
  for (const [path, bytes] of f.originals) { assert.deepEqual(Buffer.from(await decoder.readBytes(path)), bytes); assert.deepEqual(await readFile(join(f.base, 'restored', path)), bytes); }
  const value = await decoder.readJson(dataPath);
  assert.equal(Object.is(value.negativeZero, -0), true); assert.equal(value.nothing, null); assert.equal(Object.hasOwn(value, 'missing'), false); assert.deepEqual(value.array, [3, 2, 1]);
});
test('corrupt gzip fails before decoded data is exposed; no raw fallback', async t => {
  const f = await fixture(t), target = entry(f), damaged = Buffer.from(f.bytes.get(target.assetPath)); damaged[12] ^= 1; f.bytes.set(target.assetPath, damaged);
  let fetches = 0; const original = options(f).fetchImpl;
  const decoder = await openTransport(options(f, { fetchImpl: async (...args) => { fetches++; return original(...args); } }));
  await assert.rejects(decoder.readBytes(dataPath), /Encoded SHA-256/); assert.equal(fetches, 1);
});
test('truncated gzip fails even when compressed pins describe truncated bytes', async t => {
  const f = await fixture(t); changeManifest(f, () => replaceAsset(f, f.bytes.get(entry(f).assetPath).subarray(0, -6)));
  const decoder = await openTransport(options(f)); await assert.rejects(decoder.readBytes(dataPath));
});
test('wrong compressed size and decoded size/hash fail closed', async t => {
  for (const [field, value, error] of [['encodedBytes', raw.length * 20, /Encoded length/], ['decodedBytes', raw.length + 1, /Decoded length/], ['decodedSha256', '0'.repeat(64), /Decoded SHA-256/]]) {
    const f = await fixture(t); changeManifest(f, () => { const asset = entry(f).assetPath; for (const item of f.manifest.files) if (item.assetPath === asset) item[field] = value; });
    const decoder = await openTransport(options(f)); await assert.rejects(decoder.readBytes(dataPath), error);
  }
});
test('wrong manifest pins, byte lengths, generation and source proof fail closed', async t => {
  const f = await fixture(t);
  await assert.rejects(openTransport(options(f, { expectedManifestSha256: '0'.repeat(64) })), /Manifest SHA/);
  await assert.rejects(openTransport(options(f, { expectedManifestBytes: 1 })), /Manifest byte length/);
  await assert.rejects(openTransport(options(f, { expectedGeneration: '0'.repeat(64) })), /generation/);
  const decoder = await openTransport(options(f));
  await assert.rejects(decoder.readBytes(dataPath, { expectedDecodedSha256: '0'.repeat(64) }), /Logical source SHA/);
  await assert.rejects(decoder.readBytes(dataPath, { expectedDecodedBytes: 1 }), /Logical source length/);
  await assert.rejects(decoder.readBytes('../secret.json'), /Unknown logical/);
  await assert.rejects(decoder.readBytes('unknown.json'), /Unknown logical/);
});
test('duplicate/conflicting map, noncanonical duplicate JSON keys, escaped paths and address mismatch fail', async t => {
  for (const mutation of [m => m.files.push({ ...m.files[0] }), m => { m.files[0].path = '../escape.json'; }, m => { m.files[0].assetPath = 'https://evil.test/a'; }, m => { entry({ manifest: m }).assetPath = '_lossless/gzip/wrong.json.gz'; }]) {
    const f = await fixture(t); changeManifest(f, () => mutation(f.manifest)); await assert.rejects(openTransport(options(f)));
  }
  const f = await fixture(t), normal = canonicalBytes(f.manifest), duplicate = Buffer.from(new TextDecoder().decode(normal).replace('{"format":', '{"format":"bad","format":'));
  await assert.rejects(openTransport(options(f, { manifestBytes: duplicate, expectedManifestBytes: duplicate.length, expectedManifestSha256: sha(duplicate) })), /Noncanonical or duplicate/);
});
test('oversized inflation fails during streaming and declared oversize fails before fetching', async t => {
  const f = await fixture(t); changeManifest(f, () => { replaceAsset(f, gzipSync(Buffer.alloc(1024 * 1024, 65))); entry(f).decodedBytes = 12; });
  const decoder = await openTransport(options(f)); await assert.rejects(decoder.readBytes(dataPath), /exceeds permitted size/);
  let fetched = false;
  const capped = await openTransport(options(f, { limits: { encodedBytes: 1 }, fetchImpl: async () => { fetched = true; return new Response(); } }));
  await assert.rejects(capped.readBytes(dataPath), /cap/); assert.equal(fetched, false);
});
test('missing asset, HTTP-transformed bytes, unsupported decoder, and invalid root fail explicitly', async t => {
  const f = await fixture(t);
  const unsupported = await openTransport(options(f, { decompressionStream: null })); await assert.rejects(unsupported.readBytes(dataPath), /Unsupported decoder/);
  assert.deepEqual(Buffer.from(await unsupported.readBytes('qualification-audit.json')), raw);
  const transformed = await openTransport(options(f, { fetchImpl: async () => new Response(raw, { headers: { 'Content-Encoding': 'gzip' } }) })); await assert.rejects(transformed.readBytes(dataPath), /HTTP content encoding/);
  f.bytes.delete(entry(f).assetPath); const decoder = await openTransport(options(f)); await assert.rejects(decoder.readBytes(dataPath), /HTTP failure: 404/);
  await assert.rejects(openTransport(options(f, { rootUrl: 'https://example.test/screener' })), /Invalid transport root/);
});
test('abort interrupts blocked body stream; stale generation cannot complete or expose JSON', async t => {
  const f = await fixture(t), controller = new AbortController(); let canceled = false, signalSeen;
  const decoder = await openTransport(options(f, { fetchImpl: async (url, opts) => { signalSeen = opts.signal; return new Response(new ReadableStream({ cancel() { canceled = true; } })); } }));
  const pending = decoder.readBytes(dataPath, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(); await assert.rejects(pending, /abort/i); assert.equal(canceled, true); assert.equal(signalSeen, controller.signal);
  let generation = f.manifest.generation;
  const original = options(f).fetchImpl;
  const stale = await openTransport(options(f, { getCurrentGeneration: () => generation, fetchImpl: async (...args) => { const result = await original(...args); generation = '0'.repeat(64); return result; } }));
  await assert.rejects(stale.readJson(dataPath), /Stale transport generation/);
});
test('interrupted pack publishes no output and preserves source; reuse and nested paths rejected', async t => {
  const f = await fixture(t), controller = new AbortController(), output = join(f.base, 'interrupted'); controller.abort();
  await assert.rejects(pack({ source: f.source, output, signal: controller.signal }), /abort/i);
  await assert.rejects(access(output)); assert.deepEqual(await readFile(join(f.source, dataPath)), raw);
  assert.deepEqual((await readdir(f.base)).filter(path => path.startsWith('.lossless-stage-')), []);
  await assert.rejects(pack({ source: f.source, output: f.output }), /already exists/);
  await assert.rejects(pack({ source: f.source, output: join(f.source, 'nested') }), /separate/);
  await assert.rejects(pack({ source: f.source, output: join(f.base, 'overbudget'), maxSiteBytes: 1 }), /byte budget/);
});
test('independent checker rejects extra/missing source, extra/missing packed paths and corruption', async t => {
  for (const mutation of [async f => writeFile(join(f.source, 'unexpected.json'), '{}'), async f => rm(join(f.source, dataPath)), async f => writeFile(join(f.output, 'unexpected.json'), '{}'), async f => rm(join(f.output, entry(f).assetPath)), async f => { const path = join(f.output, entry(f).assetPath), bytes = await readFile(path); bytes[12] ^= 1; await writeFile(path, bytes); }]) {
    const f = await fixture(t); await mutation(f); await assert.rejects(verify({ source: f.source, packed: f.output }));
  }
});
test('receipt accounts for manifest and receipt overhead and UI bytes remain exact', async t => {
  const f = await fixture(t); let total = 0; async function walk(path) { for (const name of await readdir(path)) { const p = join(path, name), stat = await lstat(p); if (stat.isDirectory()) await walk(p); else total += stat.size; } } await walk(f.output);
  assert.equal(total, f.receipt.outputBytes); assert.deepEqual(await readFile(join(f.output, 'index.html')), f.originals.get('index.html'));
  assert.equal(JSON.parse(await readFile(join(f.output, RECEIPT_PATH))).outputBytes, total);
});

test('early rejection cancels response bodies; hanging cancel cannot hang rejection', async t => {
  const f = await fixture(t); let generation = f.manifest.generation, canceled = false;
  const stale = await openTransport(options(f, { getCurrentGeneration: () => generation, fetchImpl: async () => { generation = '0'.repeat(64); return new Response(new ReadableStream({ cancel() { canceled = true; } })); } }));
  await assert.rejects(stale.readBytes(dataPath), /Stale transport/); assert.equal(canceled, true);
  const oversized = await openTransport(options(f, { fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10000)); }, cancel() { return new Promise(() => {}); } })) }));
  await assert.rejects(Promise.race([oversized.readBytes(dataPath), new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('cancellation hung')), 1000); timer.unref(); })]), /exceeds permitted size/);
});
test('active pack abort removes staged output and failed restore publishes nothing', async t => {
  const f = await fixture(t), controller = new AbortController(), output = join(f.base, 'active-abort');
  await writeFile(join(f.source, dataPath), Buffer.alloc(16 * 1024 * 1024, 65));
  const timer = setTimeout(() => controller.abort(), 10);
  await assert.rejects(pack({ source: f.source, output, signal: controller.signal }), /abort/i); clearTimeout(timer);
  await assert.rejects(access(output)); assert.deepEqual((await readdir(f.base)).filter(path => path.startsWith('.lossless-stage-')), []);
  const restore = join(f.base, 'failed-restore');
  await assert.rejects(verify({ source: f.source, packed: f.output, restore }));
  await assert.rejects(access(restore)); assert.deepEqual((await readdir(f.base)).filter(path => path.startsWith('.lossless-restore-')), []);
});

async function persistMutation(f) {
  f.manifest.generation = sha(generationBytes(f.manifest.files));
  const bytes = canonicalBytes(f.manifest), r = f.receipt;
  await writeFile(join(f.output, MANIFEST_PATH), bytes);
  await rm(join(f.output, '_lossless/gzip'), { recursive: true }); await mkdir(join(f.output, '_lossless/gzip'));
  const assets = new Map(f.manifest.files.filter(item => item.kind === 'gzip').map(item => [item.assetPath, item.encodedBytes]));
  for (const path of assets.keys()) await writeFile(join(f.output, path), f.bytes.get(path));
  Object.assign(r, { generation: f.manifest.generation, manifestBytes: bytes.length, manifestSha256: sha(bytes), uniqueCompressedAssets: assets.size, compressedAssetBytes: [...assets.values()].reduce((sum, size) => sum + size, 0), physicalFiles: assets.size + r.identityFiles + 2 });
  for (;;) { const size = r.compressedAssetBytes + r.identityBytes + bytes.length + canonicalBytes(r).length; if (size === r.outputBytes) break; r.outputBytes = size; }
  await writeFile(join(f.output, RECEIPT_PATH), canonicalBytes(r));
}
test('Node and browser contracts both reject trailing gzip junk and extra members', async t => {
  for (const suffix of [Buffer.from([0]), gzipSync(Buffer.alloc(0)), gzipSync(raw)]) {
    const f = await fixture(t), originalPath = entry(f).assetPath, damaged = Buffer.concat([f.bytes.get(originalPath), suffix]);
    changeManifest(f, () => {
      const matching = f.manifest.files.filter(item => item.assetPath === originalPath);
      replaceAsset(f, damaged);
      for (const item of matching) Object.assign(item, { encodedBytes: entry(f).encodedBytes, encodedSha256: entry(f).encodedSha256, assetPath: entry(f).assetPath });
    });
    await persistMutation(f);
    const decoder = await openTransport(options(f)); await assert.rejects(decoder.readBytes(dataPath));
    await assert.rejects(verify({ source: f.source, packed: f.output }), /Trailing bytes|multiple gzip|inflation/);
  }
});
test('inflater input is chunked and abort interrupts inflation', async t => {
  const f = await fixture(t), originalPath = entry(f).assetPath;
  const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 65));
  changeManifest(f, () => replaceAsset(f, bomb));
  let maximum = 0, chunks = 0;
  class InspectedInflater { constructor(format) {
    const inspector = new TransformStream({ transform(chunk, controller) { maximum = Math.max(maximum, chunk.length); chunks++; controller.enqueue(chunk); } });
    return { writable: inspector.writable, readable: inspector.readable.pipeThrough(new DecompressionStream(format)) };
  } }
  const decoder = await openTransport(options(f, { decompressionStream: InspectedInflater }));
  await assert.rejects(decoder.readBytes(dataPath), /exceeds permitted size/);
  assert.ok(maximum <= 1024); assert.ok(chunks > 0);
  const controller = new AbortController();
  class AbortingInflater { constructor(format) {
    const inspector = new TransformStream({ transform(chunk, target) { controller.abort(); target.enqueue(chunk); } });
    return { writable: inspector.writable, readable: inspector.readable.pipeThrough(new DecompressionStream(format)) };
  } }
  const interrupted = await openTransport(options(f, { decompressionStream: AbortingInflater }));
  await assert.rejects(interrupted.readBytes(dataPath, { signal: controller.signal }), /abort/i);
  assert.ok(f.bytes.has(originalPath));
});
test('verifier rejects modified completed inputs and falsified receipt subtotals', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 1000; i++) await writeFile(join(f.source, `${String(i).padStart(4, '0')}.txt`), 'same');
  const packed = join(f.base, 'many'); await pack({ source: f.source, output: packed });
  await assert.rejects(verify({ source: f.source, packed, onProgress: () => { writeFileSync(join(f.source, '0000.txt'), 'DIFF'); } }), /Input changed/);
  f.receipt.dataFiles = -9; await writeFile(join(f.output, RECEIPT_PATH), canonicalBytes(f.receipt));
  await assert.rejects(verify({ source: f.source, packed: f.output }), /Invalid receipt value/);
});

test('manifest ownership also copies Node Buffer inputs before asynchronous checks', async t => {
  const f = await fixture(t), manifestBytes = Buffer.from(canonicalBytes(f.manifest));
  const pending = openTransport(options(f, { manifestBytes })); manifestBytes.fill(0);
  const decoder = await pending; assert.deepEqual(Buffer.from(await decoder.readBytes(dataPath)), raw);
});
