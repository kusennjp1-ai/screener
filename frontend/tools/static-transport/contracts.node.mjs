import test from 'node:test';
import assert from 'node:assert/strict';
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { pack } from './pack.mjs';
import { verify } from './verify.mjs';
import { list, sha256 } from './files.mjs';
import { createStaticTransport } from '../../src/static/transport/index.mjs';
import { canonicalBytes, FORMAT, generationBody, isPackedData, PREFIX } from '../../src/static/transport/format.mjs';

const dataPath = 'static-data/markets/us/charts/A.json';
const raw = Buffer.from('{"integer":9007199254740993,"decimal":1.2300,"negativeZero":-0,"nothing":null,"array":[3,2,1],"source_generated_at":"2026-09-28T12:34:56Z","proof_at":"2026-09-29T01:00:00Z"}\n');
const manifest = Buffer.from('{"schema_version":1,"research_generation":"original-generation"}\n');
const bindings = { manifestSha256: sha256(manifest), uiInventorySha256: '2'.repeat(64), financialGeneration: '3'.repeat(64), financialLineageSha256: '4'.repeat(64), sourceCommit: '5'.repeat(40), appCommit: '6'.repeat(40), candidateId: '7'.repeat(64) };
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'static-transport-contract-')); t.after(() => rm(base, { recursive: true, force: true }));
  const source = join(base, 'source'), output = join(base, 'packed');
  const originals = new Map([[dataPath, raw], ['static-data/research-details/A.json', raw], ['static-data/markets/us/scan/chunks/chunk-0001.json', Buffer.from('[1,2,3]\n')], ['static-data/markets/us/charts/index.json', Buffer.from('{"path":"A.json"}\n')], ['static-data/charts/A.json', raw], ['static-data/research-index.json', raw], ['static-data/manifest.json', manifest], ['index.html', Buffer.from('<!doctype html><p>Exact UI</p>')], ['qualification-audit.json', raw], ['static-data/export.csv', Buffer.from('all,original,fields\n9007199254740993,1.2300,-0\n')], ['publication.json', Buffer.from('{"excluded":true}\n')]]);
  for (const [path, bytes] of originals) { await mkdir(dirname(join(source, path)), { recursive: true }); await writeFile(join(source, path), bytes); }
  const receipt = await pack({ source, output, bindings }), routes = new Map();
  for (const path of Object.keys(receipt.physicalInventory)) routes.set(path, new Uint8Array(await readFile(join(output, path))));
  const root = JSON.parse(new TextDecoder().decode(routes.get(receipt.expectedRoot.path)));
  return { base, source, output, receipt, routes, originals, root, expectedRoot: receipt.expectedRoot };
}
function options(f, extra = {}) {
  return { baseURL: 'https://example.test/screener/', expectedRoot: f.expectedRoot, fetchImpl: async url => {
    const path = new URL(url).pathname.slice('/screener/'.length), bytes = f.routes.get(path);
    return new Response(bytes ?? null, { status: bytes ? 200 : 404 });
  }, ...extra };
}
function repinRoot(f, bytes) {
  f.root.generation = sha256(canonicalBytes(generationBody(f.root)));
  bytes ||= canonicalBytes(f.root);
  const digest = sha256(bytes), path = `${PREFIX}root-${digest}.json`;
  f.routes.set(path, bytes); f.expectedRoot = { path, bytes: bytes.length, sha256: digest, generation: f.root.generation, bindings: f.root.bindings };
}
function mutateShard(f, mutate) {
  const id = sha256(Buffer.from(dataPath)).slice(0, 2), position = parseInt(id, 16), descriptor = f.root.shards[position];
  const shard = JSON.parse(new TextDecoder().decode(f.routes.get(descriptor.path)));
  mutate(shard, shard.files.find(entry => entry.path === dataPath));
  const bytes = canonicalBytes(shard), digest = sha256(bytes), path = `${PREFIX}shard-${digest}.json`;
  f.routes.set(path, bytes); f.root.shards[position] = { id, path, bytes: bytes.length, sha256: digest }; repinRoot(f);
}
function replaceAsset(f, bytes, additional = {}) {
  mutateShard(f, (shard, entry) => {
    const digest = sha256(bytes), path = `${PREFIX}gzip/${digest}.bin`;
    f.routes.set(path, bytes); Object.assign(entry, { assetPath: path, encodedBytes: bytes.length, encodedSha256: digest }, additional);
  });
}
async function persistMutatedTree(f) {
  const logical = new Map(), physical = new Map();
  for (const descriptor of f.root.shards) {
    const shard = JSON.parse(new TextDecoder().decode(f.routes.get(descriptor.path)));
    for (const entry of shard.files) {
      logical.set(entry.path, { bytes: entry.decodedBytes, sha256: entry.decodedSha256 });
      physical.set(entry.assetPath, { bytes: entry.encodedBytes, sha256: entry.encodedSha256 });
    }
  }
  for (const [key, family, entries] of [['logicalInventory', 'logical', logical], ['physicalInventory', 'physical', physical]]) {
    const bytes = canonicalBytes({ format: FORMAT, files: Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : 1)) });
    const digest = sha256(bytes), path = `${PREFIX}${family}-${digest}.json`;
    f.routes.set(path, bytes); f.root[key] = { path, bytes: bytes.length, sha256: digest };
  }
  repinRoot(f);
  const paths = [...physical.keys(), ...f.root.shards.map(entry => entry.path), f.root.logicalInventory.path, f.root.physicalInventory.path, f.expectedRoot.path];
  await rm(f.output, { recursive: true });
  for (const path of paths) { await mkdir(dirname(join(f.output, path)), { recursive: true }); await writeFile(join(f.output, path), f.routes.get(path)); }
}

test('deterministic pack, complete independent recovery, exact numeric spelling/CSV/UI, and shared codec parity', async t => {
  const f = await fixture(t), second = join(f.base, 'second'), restore = join(f.base, 'restored');
  assert.deepEqual(await pack({ source: f.source, output: second, bindings }), f.receipt);
  assert.equal(f.root.shards.length, 256); assert.ok(f.expectedRoot.bytes <= 65536);
  assert.equal(f.receipt.compressedFiles, 3); assert.equal(f.receipt.uniqueCompressedAssets, 2);
  assert.equal(f.receipt.logicalInventory['publication.json'], undefined);
  assert.equal(f.receipt.physicalInventory[dataPath], undefined);
  const checked = await verify({ packed: f.output, source: f.source, expectedRoot: f.expectedRoot, restore });
  assert.equal(checked.allOriginalBytesEqual, true);
  for (const key of ['logicalInventory', 'physicalInventory', 'logicalBytes', 'physicalBytes', 'compressedFiles']) assert.deepEqual(checked[key], f.receipt[key]);
  const client = await createStaticTransport(options(f)); t.after(() => client.dispose());
  for (const [path, bytes] of f.originals) if (path !== 'publication.json') {
    assert.deepEqual(Buffer.from(await client.readBytes(path)), bytes);
    assert.deepEqual(await readFile(join(restore, path)), bytes);
  }
  const json = await client.readJson(dataPath);
  assert.equal(Object.is(json.negativeZero, -0), true); assert.equal(json.nothing, null); assert.equal(Object.hasOwn(json, 'missing'), false); assert.deepEqual(json.array, [3, 2, 1]);
  assert.equal(isPackedData('static-data/markets/us/charts/index.json'), false);
  assert.equal(isPackedData('static-data/charts/A.json'), false);
  for (const path of Object.keys(f.receipt.physicalInventory)) assert.deepEqual(await readFile(join(second, path)), await readFile(join(f.output, path)));
});

test('bootstrap fetch is small; shard lookup is lazy, deduplicated and LRU bounded', async t => {
  const f = await fixture(t), fetches = [], fetchImpl = options(f).fetchImpl;
  const client = await createStaticTransport(options(f, { limits: { cachedShards: 1 }, fetchImpl: async (...args) => { fetches.push(args[0]); return fetchImpl(...args); } })); t.after(() => client.dispose());
  assert.equal(fetches.length, 1);
  await Promise.all(Array.from({ length: 12 }, () => client.lookup(dataPath)));
  assert.equal(fetches.length, 2);
  const different = [...f.originals.keys()].find(path => path !== 'publication.json' && sha256(Buffer.from(path)).slice(0, 2) !== sha256(Buffer.from(dataPath)).slice(0, 2));
  await client.lookup(different); await client.lookup(dataPath);
  assert.equal(fetches.length, 4);
  assert.ok(fetches.slice(1).every(url => url.includes('/shard-')));
});

test('missing compressed entry fails closed; unknown noncohort lookup returns undefined', async t => {
  const f = await fixture(t), client = await createStaticTransport(options(f)); t.after(() => client.dispose());
  await assert.rejects(client.lookup('static-data/markets/us/charts/ABSENT.json'), /Missing compressed logical path/);
  assert.equal(await client.lookup('unknown.json'), undefined);
  await assert.rejects(client.readBytes('unknown.json'), /Unknown logical transport path/);
  for (const path of ['../secret.json', '/absolute.json', 'a//b', 'a?b', 'https://evil.test/a', 'a/%2e%2e/b']) await assert.rejects(client.lookup(path), /Invalid logical/);
});

test('root pins, generation, descriptor addresses, binding fields, and base URL are mandatory', async t => {
  const f = await fixture(t);
  for (const change of [value => { value.sha256 = '0'.repeat(64); }, value => { value.bytes = 1; }, value => { value.generation = '0'.repeat(64); }, value => { value.path = 'root.json'; }, value => { value.bindings.appCommit = '0'.repeat(40); }, value => { delete value.bindings.candidateId; }, value => { value.bytes = 65537; }]) {
    const expectedRoot = structuredClone(f.expectedRoot); change(expectedRoot);
    await assert.rejects(createStaticTransport(options(f, { expectedRoot })));
  }
  for (const baseURL of ['https://example.test/screener', 'https://example.test/a/?b=1', 'https://name:pass@example.test/', 'file:///tmp/']) await assert.rejects(createStaticTransport(options(f, { baseURL })), /Invalid transport baseURL/);
});

test('root ownership snapshots caller pins; canonical JSON and exact shard topology required', async t => {
  const f = await fixture(t), expectedRoot = structuredClone(f.expectedRoot);
  const pending = createStaticTransport(options(f, { expectedRoot })); expectedRoot.bindings.appCommit = '0'.repeat(40);
  const client = await pending; t.after(() => client.dispose()); assert.deepEqual(Buffer.from(await client.readBytes(dataPath)), raw);
  const duplicate = new TextEncoder().encode(new TextDecoder().decode(canonicalBytes(f.root)).replace('{"format":', '{"format":"bad","format":'));
  repinRoot(f, duplicate); await assert.rejects(createStaticTransport(options(f)), /Noncanonical or duplicate-key/);
  f.root.shards.pop(); repinRoot(f); await assert.rejects(createStaticTransport(options(f)), /exactly 256 shards/);
});

test('corrupt or absent shard cannot fall back to raw JSON and retries may recover', async t => {
  const f = await fixture(t), descriptor = f.root.shards[parseInt(sha256(Buffer.from(dataPath)).slice(0, 2), 16)], good = f.routes.get(descriptor.path);
  const client = await createStaticTransport(options(f)); t.after(() => client.dispose());
  f.routes.set(descriptor.path, new Uint8Array(good.length)); await assert.rejects(client.readJson(dataPath), /encoded SHA-256/);
  f.routes.delete(descriptor.path); await assert.rejects(client.readJson(dataPath), /HTTP failure: 404/);
  f.routes.set(descriptor.path, good); assert.deepEqual(Buffer.from(await client.readBytes(dataPath)), raw);
});

test('re-pinned malformed shard entries fail schema, placement, ordering, kind and address validation', async t => {
  for (const mutate of [(shard, entry) => shard.files.push({ ...entry }), (shard, entry) => { entry.path = '../escape'; }, (shard, entry) => { entry.path = 'other.json'; }, (shard, entry) => { entry.kind = 'identity'; }, (shard, entry) => { entry.assetPath = `${PREFIX}gzip/wrong.bin`; }, (shard, entry) => { entry.decodedBytes = 129 * 1024 * 1024; }]) {
    const f = await fixture(t); mutateShard(f, mutate);
    const client = await createStaticTransport(options(f)); t.after(() => client.dispose()); await assert.rejects(client.readBytes(dataPath));
  }
});

test('asset integrity and expected canonical-source pins reject before exposing data', async t => {
  const f = await fixture(t), client = await createStaticTransport(options(f)); t.after(() => client.dispose());
  const entry = await client.lookup(dataPath), good = f.routes.get(entry.assetPath), bad = new Uint8Array(good); bad[12] ^= 1;
  f.routes.set(entry.assetPath, bad); await assert.rejects(client.readJson(dataPath), /encoded SHA-256/);
  f.routes.set(entry.assetPath, good);
  await assert.rejects(client.readJson(dataPath, { expectedDecodedSha256: '0'.repeat(64) }), /Logical source SHA/);
  await assert.rejects(client.readJson(dataPath, { expectedDecodedBytes: 1 }), /Logical source length/);
  assert.deepEqual(Buffer.from(await client.readBytes(dataPath, { expectedDecodedBytes: raw.length, expectedDecodedSha256: sha256(raw) })), raw);
});

test('truncated gzip, trailing junk, extra members, bad CRC and wrong output pins all fail closed', async t => {
  for (const mutate of [bytes => bytes.subarray(0, -6), bytes => Buffer.concat([bytes, Buffer.from([0])]), bytes => Buffer.concat([bytes, gzipSync(Buffer.alloc(0))]), bytes => Buffer.concat([bytes, gzipSync(raw)]), bytes => { const copy = Buffer.from(bytes); copy[copy.length - 8] ^= 1; return copy; }]) {
    const f = await fixture(t); replaceAsset(f, mutate(gzipSync(raw, { level: 6 })));
    const client = await createStaticTransport(options(f)); t.after(() => client.dispose()); await assert.rejects(client.readBytes(dataPath));
  }
  for (const update of [{ decodedBytes: raw.length + 1 }, { decodedSha256: '0'.repeat(64) }]) {
    const f = await fixture(t); mutateShard(f, (shard, entry) => Object.assign(entry, update));
    const client = await createStaticTransport(options(f)); t.after(() => client.dispose()); await assert.rejects(client.readBytes(dataPath));
  }
});

test('decoded streaming bound and 1KiB native inflater input chunks', async t => {
  const f = await fixture(t), encoded = gzipSync(Buffer.alloc(8 * 1024 * 1024, 65), { level: 6 });
  // A dishonest trailer also passes the cheap precheck, so native output still
  // must be bounded before the eventual invalid CRC/ISIZE is processed.
  encoded.writeUInt32LE(12, encoded.length - 4); replaceAsset(f, encoded, { decodedBytes: 12 });
  let maximum = 0, chunks = 0;
  class InspectedInflater { constructor(format) {
    const inspector = new TransformStream({ transform(chunk, controller) { maximum = Math.max(maximum, chunk.length); chunks++; controller.enqueue(chunk); } });
    return { writable: inspector.writable, readable: inspector.readable.pipeThrough(new DecompressionStream(format)) };
  } }
  const client = await createStaticTransport(options(f, { decompressionStream: InspectedInflater })); t.after(() => client.dispose());
  await assert.rejects(client.readBytes(dataPath)); assert.ok(chunks > 0); assert.ok(maximum <= 1024);
});

test('unsupported gzip implementation fails explicitly and identity files remain readable', async t => {
  const f = await fixture(t), client = await createStaticTransport(options(f, { decompressionStream: null })); t.after(() => client.dispose());
  await assert.rejects(client.readBytes(dataPath), /Unsupported transport/);
  assert.deepEqual(Buffer.from(await client.readBytes('qualification-audit.json')), raw);
});

test('one shard subscriber abort does not cancel others; last subscriber abort cancels blocked I/O', async t => {
  const f = await fixture(t), real = options(f).fetchImpl;
  let fetched, release, canceled = false;
  const started = new Promise(resolve => { fetched = resolve; });
  const client = await createStaticTransport(options(f, { fetchImpl: async (url, opts) => {
    if (!url.includes('/shard-')) return real(url, opts);
    const bytes = f.routes.get(new URL(url).pathname.slice('/screener/'.length));
    return new Response(new ReadableStream({ start(controller) { release = () => { controller.enqueue(bytes); controller.close(); }; fetched(); }, cancel() { canceled = true; } }));
  } })); t.after(() => client.dispose());
  const controller = new AbortController();
  const first = client.lookup(dataPath, { signal: controller.signal }), second = client.lookup(dataPath);
  await started; controller.abort(); await assert.rejects(first, /abort/i); assert.equal(canceled, false); release(); assert.ok(await second);
  let secondStarted;
  const blocked = new Promise(resolve => { secondStarted = resolve; });
  const other = await createStaticTransport(options(f, { fetchImpl: async (url, opts) => url.includes('/shard-') ? new Response(new ReadableStream({ start() { secondStarted(); }, cancel() { canceled = true; } })) : real(url, opts) })); t.after(() => other.dispose());
  const last = new AbortController(), pending = other.lookup(dataPath, { signal: last.signal }); await blocked; last.abort();
  await assert.rejects(pending, /abort/i); assert.equal(canceled, true);
});

test('abort, dispose and generation replacement prevent blocked asset completion', async t => {
  const f = await fixture(t), real = options(f).fetchImpl; let generation = f.expectedRoot.generation;
  const client = await createStaticTransport(options(f, { getCurrentGeneration: () => generation }));
  generation = '0'.repeat(64); await assert.rejects(client.readJson(dataPath), /Stale transport generation/); client.dispose();
  let started, canceled = false; const seen = new Promise(resolve => { started = resolve; });
  const other = await createStaticTransport(options(f, { fetchImpl: async (url, opts) => url.endsWith('.bin') ? new Response(new ReadableStream({ start() { started(); }, cancel() { canceled = true; } })) : real(url, opts) }));
  const pending = other.readJson(dataPath); await seen; other.dispose(); await assert.rejects(pending, /disposed/i); assert.equal(canceled, true);
  await assert.rejects(other.lookup(dataPath), /disposed/i);
});

test('response byte cap and early failure cancel bodies without awaiting hanging cancellation', async t => {
  const f = await fixture(t), real = options(f).fetchImpl; let canceled = false;
  const client = await createStaticTransport(options(f, { fetchImpl: async (url, opts) => url.endsWith('.bin') ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100000)); }, cancel() { canceled = true; return new Promise(() => {}); } })) : real(url, opts) })); t.after(() => client.dispose());
  await assert.rejects(client.readBytes(dataPath), /exceeds permitted size/); assert.equal(canceled, true);
});

test('complete physical closure rejects missing, extra and corrupt files, source mismatch, and forged inventories', async t => {
  const f = await fixture(t);
  for (const mutation of [async output => writeFile(join(output, 'extra.json'), '{}'), async output => rm(join(output, f.expectedRoot.path)), async output => writeFile(join(output, 'index.html'), 'bad')]) {
    const output = join(f.base, `broken-${Math.random()}`); await cp(f.output, output, { recursive: true }); await mutation(output);
    await assert.rejects(verify({ packed: output, source: f.source, expectedRoot: f.expectedRoot }));
  }
  await writeFile(join(f.source, dataPath), Buffer.alloc(raw.length, 65));
  const restore = join(f.base, 'failed-restore');
  await assert.rejects(verify({ packed: f.output, source: f.source, expectedRoot: f.expectedRoot, restore }), /Recovered byte mismatch/);
  await assert.rejects(access(restore));
  assert.deepEqual((await readdir(f.base)).filter(path => path.startsWith('.static-transport-restore-')), []);
});

test('untrusted packing paths, existing output, invalid binding, overbudget and abort publish nothing', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(pack({ source: f.source, output: join(f.base, 'aborted'), bindings, signal: controller.signal }), /abort/i);
  await assert.rejects(pack({ source: f.source, output: f.output, bindings }), /already exists/);
  await assert.rejects(pack({ source: f.source, output: join(f.source, 'nested'), bindings }), /separate/);
  await assert.rejects(pack({ source: f.source, output: join(f.base, 'overbudget'), bindings, maxSiteBytes: 1 }), /byte budget/);
  await assert.rejects(pack({ source: f.source, output: join(f.base, 'wrong-binding'), bindings: { ...bindings, manifestSha256: '0'.repeat(64) } }), /Manifest binding/);
  await symlink(join(f.source, 'index.html'), join(f.source, 'symlink.html'));
  await assert.rejects(pack({ source: f.source, output: join(f.base, 'symlink-output'), bindings }), /symlink/);
  assert.deepEqual((await readdir(f.base)).filter(path => path.startsWith('.static-transport-pack-')), []);
  assert.deepEqual(await readFile(join(f.source, dataPath)), raw);
});

test('physical totals include all metadata and separate publication does not enter the hash cycle', async t => {
  const f = await fixture(t); let bytes = 0;
  for (const path of await list(f.output)) bytes += (await lstat(join(f.output, path))).size;
  assert.equal(bytes, f.receipt.physicalBytes);
  await writeFile(join(f.output, 'publication.json'), '{"schema":"static-json-transport-preview-v1","publication_authority":"none"}\n');
  const result = await verify({ packed: f.output, expectedRoot: f.expectedRoot });
  assert.equal(result.physicalBytes, bytes); assert.equal(result.physicalInventory['publication.json'], undefined);
  const restore = join(f.base, 'no-source-restore'); await verify({ packed: f.output, expectedRoot: f.expectedRoot, restore });
  await assert.rejects(access(join(restore, 'publication.json')));
  assert.deepEqual(await readFile(join(restore, dataPath)), raw);
});

test('independent Node verifier rejects honestly re-pinned trailing gzip bytes and extra members', async t => {
  for (const suffix of [Buffer.from([0]), gzipSync(Buffer.alloc(0), { level: 6 }), gzipSync(raw, { level: 6 })]) {
    const f = await fixture(t); replaceAsset(f, Buffer.concat([gzipSync(raw, { level: 6 }), suffix])); await persistMutatedTree(f);
    await assert.rejects(verify({ packed: f.output, expectedRoot: f.expectedRoot, source: f.source }), /Trailing bytes or multiple gzip members/);
  }
});

test('independent Node verifier rejects re-pinned truncated gzip, bad CRC and bad ISIZE', async t => {
  for (const [mutation, expected] of [[bytes => bytes.subarray(0, -6), /unexpected end|invalid/i], [bytes => { bytes[bytes.length - 8] ^= 1; return bytes; }, /Gzip CRC32 or size mismatch/], [bytes => { bytes.writeUInt32LE(raw.length + 1, bytes.length - 4); return bytes; }, /Gzip CRC32 or size mismatch/]]) {
    const f = await fixture(t); replaceAsset(f, mutation(gzipSync(raw, { level: 6 }))); await persistMutatedTree(f);
    await assert.rejects(verify({ packed: f.output, expectedRoot: f.expectedRoot, source: f.source }), expected);
  }
});

test('inventory membership is checked independently of otherwise valid byte pins', async t => {
  const f = await fixture(t), inventory = JSON.parse(new TextDecoder().decode(f.routes.get(f.root.logicalInventory.path)));
  delete inventory.files[dataPath];
  const bytes = canonicalBytes(inventory), digest = sha256(bytes), path = `${PREFIX}logical-${digest}.json`;
  await rm(join(f.output, f.root.logicalInventory.path)); await writeFile(join(f.output, path), bytes);
  f.root.logicalInventory = { path, bytes: bytes.length, sha256: digest };
  await rm(join(f.output, f.expectedRoot.path)); repinRoot(f); await writeFile(join(f.output, f.expectedRoot.path), f.routes.get(f.expectedRoot.path));
  await assert.rejects(verify({ packed: f.output, expectedRoot: f.expectedRoot }), /Logical inventory does not match shards/);
});

test('in-flight shard count is bounded and canceled slots are reusable', async t => {
  const f = await fixture(t), real = options(f).fetchImpl;
  let started; const seen = new Promise(resolve => { started = resolve; });
  const client = await createStaticTransport(options(f, { limits: { pendingShards: 1 }, fetchImpl: async (url, opts) => url.includes('/shard-') ? new Response(new ReadableStream({ start() { started(); }, cancel() {} })) : real(url, opts) })); t.after(() => client.dispose());
  const controller = new AbortController(), pending = client.lookup(dataPath, { signal: controller.signal }); await seen;
  const different = [...f.originals.keys()].find(path => sha256(Buffer.from(path)).slice(0, 2) !== sha256(Buffer.from(dataPath)).slice(0, 2));
  await assert.rejects(client.lookup(different), /Too many pending transport shards/);
  controller.abort(); await assert.rejects(pending, /abort/i);
  const restarted = new Promise(resolve => { started = resolve; });
  const replacementController = new AbortController(), replacement = client.lookup(different, { signal: replacementController.signal });
  await restarted; replacementController.abort(); await assert.rejects(replacement, /abort/i);
});

test('reduced caps cannot increase defaults; oversized declarations fail before asset I/O', async t => {
  const f = await fixture(t), real = options(f).fetchImpl; let assetFetches = 0;
  for (const limits of [{ rootBytes: 65537 }, { unknown: 1 }, { cachedShards: 0 }, { decodedBytes: Infinity }]) await assert.rejects(createStaticTransport(options(f, { limits })), /Invalid transport limit/);
  const client = await createStaticTransport(options(f, { limits: { decodedBytes: 1 }, fetchImpl: async (...args) => { if (args[0].endsWith('.bin')) assetFetches++; return real(...args); } })); t.after(() => client.dispose());
  await assert.rejects(client.readBytes(dataPath), /decodedBytes cap exceeded/); assert.equal(assetFetches, 0);
});

test('returned bytes cannot mutate cached descriptors or later reads', async t => {
  const f = await fixture(t), client = await createStaticTransport(options(f)); t.after(() => client.dispose());
  const entry = await client.lookup(dataPath); assert.ok(Object.isFrozen(entry)); assert.throws(() => { entry.decodedSha256 = '0'.repeat(64); });
  const bytes = await client.readBytes(dataPath); bytes.fill(0);
  assert.deepEqual(Buffer.from(await client.readBytes(dataPath)), raw);
});

test('active pack abort and nonexistent restore target requirement preserve original inputs', async t => {
  const f = await fixture(t), controller = new AbortController(), output = join(f.base, 'active-abort');
  await writeFile(join(f.source, dataPath), Buffer.alloc(16 * 1024 * 1024, 65));
  const timer = setTimeout(() => controller.abort(), 10);
  await assert.rejects(pack({ source: f.source, output, bindings, signal: controller.signal }), /abort/i); clearTimeout(timer);
  await assert.rejects(access(output)); assert.deepEqual((await readdir(f.base)).filter(path => path.startsWith('.static-transport-pack-')), []);
  await assert.rejects(verify({ packed: f.output, expectedRoot: f.expectedRoot, restore: f.output }), /separate/);
  const existing = join(f.base, 'existing'); await mkdir(existing);
  await assert.rejects(verify({ packed: f.output, expectedRoot: f.expectedRoot, restore: existing }), /already exists/);
});

test('aliased destination parents are rejected before creating anything inside source or packed trees', async t => {
  const f = await fixture(t), sourceAlias = join(f.base, 'source-alias'), packedAlias = join(f.base, 'packed-alias');
  await symlink(f.source, sourceAlias); await symlink(f.output, packedAlias);
  await assert.rejects(pack({ source: f.source, output: join(sourceAlias, 'new-parent', 'result'), bindings }), /overlapping trees/);
  await assert.rejects(access(join(f.source, 'new-parent')));
  await assert.rejects(verify({ packed: f.output, source: f.source, expectedRoot: f.expectedRoot, restore: join(packedAlias, 'new-parent', 'result') }), /overlapping tree/);
  await assert.rejects(access(join(f.output, 'new-parent')));
  await assert.rejects(verify({ packed: f.output, source: f.source, expectedRoot: f.expectedRoot, restore: join(sourceAlias, 'new-parent', 'result') }), /overlapping tree/);
  await assert.rejects(access(join(f.source, 'new-parent')));
});

test('numeric root filenames retain canonical JSON integer-key order and exact logical closure', async t => {
  const f = await fixture(t), output = join(f.base, 'numeric-names');
  await writeFile(join(f.source, '2'), 'two'); await writeFile(join(f.source, '10'), 'ten');
  const result = await pack({ source: f.source, output, bindings });
  const checked = await verify({ packed: output, source: f.source, expectedRoot: result.expectedRoot });
  assert.equal(checked.allOriginalBytesEqual, true); assert.equal(checked.logicalInventory['2'].bytes, 3); assert.equal(checked.logicalInventory['10'].bytes, 3);
});
