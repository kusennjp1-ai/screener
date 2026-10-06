// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDesignAssetObserver } from './design-static-assets.mjs';
import { pack } from './static-transport/pack.mjs';
import { sha256 } from './static-transport/files.mjs';
import { previewPublication, transportDescriptor } from '../../.github/scripts/static-transport-publication.mjs';

const baseURL = 'https://design.test/screener/';
const symbols = ['NVDA', 'FUTU', 'AAOI', 'ALH', 'AVT'];
const detailPath = symbol => `research-details/${symbol}-0123456789abcdef.json`;
const manifest = { as_of_date: '2026-10-02', research_generation: 'test-generation', assets: { research: { path: 'research-index.json' } } };
const manifestBytes = Buffer.from(JSON.stringify(manifest));
const raw = symbol => Buffer.from(`{"symbol":"${symbol}","as_of_date":"2026-10-02","eps":1.2300,"zero":-0,"absent":null,"annual":[8.26,5.43,2.75,null]}\n`);
let directory, routes, publication, receipt;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'design-assets-test-'));
  const source = join(directory, 'source'), output = join(directory, 'packed');
  const originals = new Map([
    ['static-data/manifest.json', manifestBytes],
    ['static-data/research-index.json', Buffer.from(JSON.stringify({ rows: symbols.map(symbol => ({ symbol, research_detail_path: detailPath(symbol) })) }))],
    ...symbols.map(symbol => [`static-data/${detailPath(symbol)}`, raw(symbol)]),
  ]);
  for (const [path, bytes] of originals) {
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), bytes);
  }
  const uiSha = 'a'.repeat(40), uiDigest = 'b'.repeat(64);
  receipt = await pack({ source, output, bindings: { manifestSha256: sha256(manifestBytes), uiInventorySha256: uiDigest,
    financialGeneration: null, financialLineageSha256: null, sourceCommit: uiSha, appCommit: uiSha, candidateId: 'c'.repeat(64) } });
  routes = new Map(await Promise.all(Object.keys(receipt.physicalInventory).map(async path => [path, await readFile(join(output, path))])));
  publication = previewPublication({ uiSha, uiDigest, manifestSha256: sha256(manifestBytes) });
  publication.transport = transportDescriptor(receipt, { uiSha, uiDigest });
  routes.set('publication.json', Buffer.from(JSON.stringify(publication)));
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

function source(files = routes) {
  const calls = [];
  return { calls, baseURL, fetchImpl: async url => {
    const path = new URL(url).pathname.slice('/screener/'.length);
    calls.push(path);
    const bytes = files.get(path);
    return new Response(bytes || null, { status: bytes ? 200 : 404 });
  } };
}
const browserResponse = (path, bytes, status = 200) => ({
  url: () => new URL(path, baseURL).href, ok: () => status >= 200 && status < 300, status: () => status, body: async () => bytes,
});
function browserAction(response) {
  let predicate, settle;
  const page = { waitForResponse: match => { predicate = match; return new Promise(resolve => { settle = resolve; }); } };
  const action = async () => {
    expect(predicate, 'response listener must be installed before clicking').toBeTypeOf('function');
    expect(predicate(response), 'harness must wait for the physical response that the browser actually emits').toBe(true);
    settle(response);
  };
  return { page, action };
}
async function entryFor(symbol) {
  const logical = `static-data/${detailPath(symbol)}`;
  const root = JSON.parse(routes.get(receipt.expectedRoot.path));
  const shard = root.shards[parseInt(sha256(Buffer.from(logical)).slice(0, 2), 16)];
  return JSON.parse(routes.get(shard.path)).files.find(entry => entry.path === logical);
}

describe('financial Design logical asset observations', () => {
  it.each(symbols)('observes %s through its pinned gzip response when its raw JSON is absent', async symbol => {
    const options = source(), assets = await createDesignAssetObserver(options);
    try {
      const logical = `static-data/${detailPath(symbol)}`, entry = await entryFor(symbol);
      expect(routes.has(logical)).toBe(false);
      expect(entry.assetPath).toMatch(/^static-data\/_transport\/gzip\/[a-f0-9]{64}\.bin$/);
      const response = browserResponse(entry.assetPath, routes.get(entry.assetPath));
      // Reproduces the old harness defect without waiting 30 seconds: the raw
      // URL predicate cannot match this successful production-shaped response.
      expect(response.url() === new URL(logical, baseURL).href).toBe(false);
      const { page, action } = browserAction(response);
      const result = await assets.observeJson(page, detailPath(symbol), action);
      expect(result.value).toEqual(JSON.parse(raw(symbol)));
      expect(Object.is(result.value.zero, -0)).toBe(true);
      expect(result.observation).toEqual({ logical_path: logical, physical_path: entry.assetPath, kind: 'gzip',
        decoded_bytes: raw(symbol).length, decoded_sha256: sha256(raw(symbol)), transport_generation: receipt.expectedRoot.generation,
        source: 'actual browser response' });
      // The harness inspects browser bytes; it must not replace a broken UI
      // response with its own successful network fetch of the detail.
      expect(options.calls).not.toContain(logical);
      expect(options.calls).not.toContain(entry.assetPath);
    } finally { assets.dispose(); }
  });

  it('keeps identity research and manifest paths and requires the same browser bootstrap', async () => {
    const assets = await createDesignAssetObserver(source());
    try {
      expect(assets.manifest).toEqual(manifest);
      expect((await assets.readJson(manifest.assets.research.path)).rows.map(row => row.symbol)).toEqual(symbols);
      await expect(assets.assertBrowserBootstrap(browserResponse('static-data/manifest.json', manifestBytes),
        browserResponse('publication.json', routes.get('publication.json')))).resolves.toBeUndefined();
      await expect(assets.assertBrowserBootstrap(browserResponse('static-data/manifest.json', Buffer.from('{}')),
        browserResponse('publication.json', routes.get('publication.json')))).rejects.toThrow('different manifest');
      await expect(assets.assertBrowserBootstrap(browserResponse('static-data/manifest.json', manifestBytes),
        browserResponse('publication.json', Buffer.from('{}')))).rejects.toThrow('different publication/transport');
    } finally { assets.dispose(); }
  });

  it('supports legacy uncompressed candidates without inventing a transport root', async () => {
    const files = new Map([['static-data/manifest.json', manifestBytes], [`static-data/${detailPath('NVDA')}`, raw('NVDA')]]);
    const assets = await createDesignAssetObserver(source(files));
    try {
      expect(assets.packed).toBe(false);
      const { page, action } = browserAction(browserResponse(`static-data/${detailPath('NVDA')}`, raw('NVDA')));
      const result = await assets.observeJson(page, detailPath('NVDA'), action);
      expect(result.value.symbol).toBe('NVDA');
      expect(result.observation.kind).toBe('legacy');
    } finally { assets.dispose(); }
  });

  it('rejects damaged actual browser bytes even when an independent source fetch would succeed', async () => {
    const assets = await createDesignAssetObserver(source()), entry = await entryFor('FUTU');
    try {
      const corrupted = Buffer.from(routes.get(entry.assetPath)); corrupted[15] ^= 1;
      for (const [bytes, message] of [[corrupted, 'encoded SHA-256'], [corrupted.subarray(0, -1), 'encoded length']]) {
        const { page, action } = browserAction(browserResponse(entry.assetPath, bytes));
        await expect(assets.observeJson(page, detailPath('FUTU'), action)).rejects.toThrow(message);
      }
    } finally { assets.dispose(); }
  });

  it('reports an actual HTTP failure immediately instead of waiting for a successful response', async () => {
    const assets = await createDesignAssetObserver(source()), entry = await entryFor('ALH');
    try {
      const { page, action } = browserAction(browserResponse(entry.assetPath, Buffer.from('Not found'), 404));
      await expect(assets.observeJson(page, detailPath('ALH'), action)).rejects.toThrow('browser HTTP 404');
    } finally { assets.dispose(); }
  });

  it('fails closed for a damaged root, shard, missing logical entry, or mismatched publication', async () => {
    const brokenRoot = new Map(routes); brokenRoot.set(receipt.expectedRoot.path, Buffer.from('{}'));
    await expect(createDesignAssetObserver(source(brokenRoot))).rejects.toThrow();
    const badPublication = new Map(routes), changed = structuredClone(publication);
    changed.data_manifest_sha256 = '0'.repeat(64);
    badPublication.set('publication.json', Buffer.from(JSON.stringify(changed)));
    await expect(createDesignAssetObserver(source(badPublication))).rejects.toThrow('manifest integrity');
    const brokenShard = new Map(routes), root = JSON.parse(routes.get(receipt.expectedRoot.path));
    const shard = root.shards[parseInt(sha256(Buffer.from(`static-data/${detailPath('NVDA')}`)).slice(0, 2), 16)];
    brokenShard.set(shard.path, Buffer.from('{}'));
    const extraRaw = new Map(routes); extraRaw.set(`static-data/${detailPath('MISSING')}`, raw('MISSING'));
    for (const [files, path, message] of [[brokenShard, detailPath('NVDA'), 'encoded length'], [extraRaw, detailPath('MISSING'), 'Missing compressed logical path']]) {
      const options = source(files), assets = await createDesignAssetObserver(options);
      try {
        await expect(assets.observeJson({}, path, () => { throw Error('must not click with invalid source metadata'); })).rejects.toThrow(message);
        expect(options.calls).not.toContain(`static-data/${path}`);
      } finally { assets.dispose(); }
    }
  });
});
