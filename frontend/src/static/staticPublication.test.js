// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
const transport = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), lookup: vi.fn() }));
vi.mock('./transport/index.mjs', async importOriginal => ({ ...await importOriginal(), createStaticTransport: transport.create }));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value);
const manifest = (generation = 'logical-one') => ({ research_generation: generation, generated_at: '2026-10-01T00:00:00Z', markets: { US: { as_of_date: '2026-10-01' } } });
function receipt(source, production = false) {
  const descriptor = { schema_version: 'static-json-transport-publication-v1', logical_data_inventory_sha256: 'a'.repeat(64), physical_inventory_sha256: 'b'.repeat(64), ui_sha: 'c'.repeat(40), ui_digest: 'd'.repeat(64),
    root: { path: `static-data/_transport/root-${'e'.repeat(64)}.json`, bytes: 50000, sha256: 'e'.repeat(64), generation: 'f'.repeat(64),
      bindings: { manifestSha256: hash(json(source)), uiInventorySha256: 'd'.repeat(64), financialGeneration: null, financialLineageSha256: null, sourceCommit: '1'.repeat(40), appCommit: 'c'.repeat(40), candidateId: '2'.repeat(64) } } };
  return { schema: production ? 1 : 'static-json-transport-preview-v1', ...(!production && { publication_authority: 'none' }), ui_sha: descriptor.ui_sha, ui_digest: descriptor.ui_digest, data_manifest_sha256: hash(json(source)), transport: descriptor };
}
function serve(files) {
  const fetcher = vi.fn(async url => {
    const path = new URL(url, location.href).pathname.replace(/^\//, '');
    const value = files[path];
    if (typeof value === 'function') return value();
    return value === undefined ? new Response('', { status: 404 }) : new Response(typeof value === 'string' ? value : json(value));
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
let api;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubGlobal('location', { href: 'https://example.test/' }); vi.stubGlobal('crypto', webcrypto);
  transport.create.mockResolvedValue({ readJson: transport.read, lookup: transport.lookup });
  transport.lookup.mockResolvedValue({ decodedBytes: 1024 });
  transport.read.mockResolvedValue({ symbol: 'SAFE', exact: 1 / 7, unknown: null });
  api = await import('./staticPublication');
});
afterEach(() => vi.unstubAllGlobals());
describe('publication-pinned static reads', () => {
  it.each([false, true])('bootstraps a %s production descriptor without fetching the root or shards eagerly', async production => {
    const source = manifest(), metadata = receipt(source, production);
    const fetcher = serve({ 'static-data/manifest.json': source, 'publication.json': metadata });
    const loaded = await api.loadStaticManifest(); expect(loaded).toEqual(source);
    const publication = api.publicationForManifest(loaded);
    expect(publication).toMatchObject({ mode: 'packed', generation: source.research_generation, expectedRoot: metadata.transport.root });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(transport.create).not.toHaveBeenCalled();
    for (const path of ['markets/us/charts/SAFE.json', 'research-details/SAFE-1234567890abcdef.json', 'markets/us/scan/chunks/chunk-1.json']) {
      expect(await api.readStaticPayload(path, { publication })).toEqual({ symbol: 'SAFE', exact: 1 / 7, unknown: null });
      expect(transport.read).toHaveBeenLastCalledWith(`static-data/${path}`, { signal: undefined, expectedDecodedSha256: undefined });
    }
    expect(transport.create).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, { schema: 1 }])('supports legacy raw sites with %j publication metadata', async metadata => {
    const source = manifest();
    const fetcher = serve({ 'static-data/manifest.json': source, ...(metadata && { 'publication.json': { ...metadata, data_manifest_sha256: hash(json(source)) } }), 'static-data/markets/us/charts/SAFE.json': { symbol: 'SAFE', exact: 1 / 7 } });
    const loaded = await api.loadStaticManifest();
    expect(await api.readStaticPayload('markets/us/charts/SAFE.json', { publication: api.publicationForManifest(loaded) })).toEqual({ symbol: 'SAFE', exact: 1 / 7 });
    expect(fetcher).toHaveBeenCalledTimes(3); expect(transport.create).not.toHaveBeenCalled();
  });
  it.each([null, {}, { schema_version: 'unknown' }])('rejects a present malformed descriptor %j without a raw fallback', async descriptor => {
    const source = manifest(); serve({ 'static-data/manifest.json': source, 'publication.json': { ...receipt(source), transport: descriptor } });
    await expect(api.loadStaticManifest()).rejects.toThrow('transport descriptor');
    await expect(api.resolveStaticPublication()).rejects.toThrow('transport descriptor'); expect(transport.create).not.toHaveBeenCalled();
  });
  it.each(['manifest', 'app', 'ui', 'financial', 'logical inventory'])('rejects a mismatched %s binding before exposing the manifest', async field => {
    const source = manifest(), metadata = receipt(source, true);
    if (field === 'manifest') source.generated_at = '2026-10-02T00:00:00Z';
    if (field === 'app') metadata.transport.root.bindings.appCommit = '3'.repeat(40);
    if (field === 'ui') metadata.transport.ui_digest = '3'.repeat(64);
    if (field === 'financial') source.financial_generation = '3'.repeat(64);
    if (field === 'logical inventory') metadata.data_inventory_sha256 = '3'.repeat(64);
    serve({ 'static-data/manifest.json': source, 'publication.json': metadata }); await expect(api.loadStaticManifest()).rejects.toThrow(/mismatch/);
  });
  it('never reuses the preceding current context after a publication refresh fails', async () => {
    const source = manifest(), files = { 'static-data/manifest.json': source, 'publication.json': receipt(source) };
    serve(files); const pinned = api.publicationForManifest(await api.loadStaticManifest()); files['publication.json'] = () => new Response('', { status: 503 });
    await expect(api.loadStaticManifest()).rejects.toThrow('metadata unavailable');
    await expect(api.resolveStaticPublication({ generation: source.research_generation })).rejects.toThrow('metadata unavailable');
    // A failed refresh cannot relabel authenticated bytes already pinned by an
    // old request; existing worker epoch/selection guards decide its relevance.
    expect(await api.resolveStaticPublication({ publication: pinned, generation: source.research_generation })).toBe(pinned);
    await expect(api.readStaticPayload('markets/us/charts/SAFE.json', { publication: pinned })).resolves.toMatchObject({ symbol: 'SAFE' });
  });
  it('pins concurrent old and new reads to their original roots and permits an app-only repack', async () => {
    const source = manifest(), files = { 'static-data/manifest.json': source, 'publication.json': receipt(source) };
    serve(files); const old = api.publicationForManifest(await api.loadStaticManifest());
    const updated = receipt(source); updated.transport.root.sha256 = '4'.repeat(64); updated.transport.root.path = `static-data/_transport/root-${updated.transport.root.sha256}.json`;
    files['publication.json'] = updated; const next = api.publicationForManifest(await api.loadStaticManifest());
    expect(await api.resolveStaticPublication({ publication: old, generation: source.research_generation })).toBe(old);
    expect((await api.resolveStaticPublication()).expectedRoot).toEqual(updated.transport.root);
    await api.readStaticPayload('markets/us/charts/SAFE.json', { publication: old }); await api.readStaticPayload('markets/us/charts/SAFE.json', { publication: next });
    expect(transport.create.mock.calls.map(([input]) => input.expectedRoot.sha256)).toEqual(['e'.repeat(64), '4'.repeat(64)]);
    await expect(api.resolveStaticPublication({ publication: old, generation: 'wrong' })).rejects.toThrow('generation mismatch');
  });
  it('passes reference integrity into the decoder and surfaces failure without requesting the raw member', async () => {
    const source = manifest(), fetcher = serve({ 'static-data/manifest.json': source, 'publication.json': receipt(source) });
    const publication = api.publicationForManifest(await api.loadStaticManifest()); transport.read.mockRejectedValue(Error('Decoded transport hash mismatch'));
    await expect(api.readStaticPayload('research-details/SAFE.json', { publication, sha256: 'a'.repeat(64) })).rejects.toThrow('Decoded transport hash mismatch');
    expect(transport.read).toHaveBeenCalledWith('static-data/research-details/SAFE.json', { signal: undefined, expectedDecodedSha256: 'a'.repeat(64) }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('authenticates raw identity entries through the same registry and preserves reference hash options', async () => {
    const source = manifest(), raw = json({ exact: 0, unknown: null });
    const fetcher = serve({ 'static-data/manifest.json': source, 'publication.json': receipt(source), 'static-data/verified-charts/SAFE.json': raw });
    const publication = api.publicationForManifest(await api.loadStaticManifest());
    transport.read.mockResolvedValue({ exact: 0, unknown: null });
    expect(await api.readStaticPayload('verified-charts/SAFE.json', { publication, sha256: hash(raw) })).toEqual({ exact: 0, unknown: null });
    expect(transport.read).toHaveBeenCalledWith('static-data/verified-charts/SAFE.json', { signal: undefined, expectedDecodedSha256: hash(raw) });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

it('bounds large chart fanout and cancels queued reads before they can load a shard', async () => {
  const source = manifest(); serve({ 'static-data/manifest.json': source, 'publication.json': receipt(source) });
  const publication = api.publicationForManifest(await api.loadStaticManifest());
  const release = []; let active = 0, maximum = 0;
  transport.read.mockImplementation(() => new Promise(resolve => { active++; maximum = Math.max(maximum, active); release.push(() => { active--; resolve({ exact: 0 }); }); }));
  const requests = Array.from({ length: 20 }, (_, index) => api.readStaticPayload(`markets/us/charts/S${index}.json`, { publication }));
  const controller = new AbortController();
  const canceled = api.readStaticPayload('markets/us/charts/CANCELED.json', { publication, signal: controller.signal });
  controller.abort(); await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(transport.read).toHaveBeenCalledTimes(8));
  while (transport.read.mock.calls.length < 20) {
    const count = transport.read.mock.calls.length; release.splice(0).forEach(done => done());
    await vi.waitFor(() => expect(transport.read.mock.calls.length).toBeGreaterThan(count));
  }
  release.splice(0).forEach(done => done()); await Promise.all(requests);
  expect(maximum).toBe(8);
  expect(transport.read.mock.calls.some(([path]) => path.includes('CANCELED'))).toBe(false);
});

it.each([undefined, 'legacy'])('does not downgrade a declared packed generation when publication becomes %s', async replacement => {
  const source = manifest(), files = { 'static-data/manifest.json': source, 'publication.json': receipt(source) };
  serve(files); await api.loadStaticManifest();
  files['publication.json'] = replacement === 'legacy' ? { schema: 1, data_manifest_sha256: hash(json(source)) } : undefined;
  await expect(api.loadStaticManifest()).rejects.toThrow('declared transport descriptor is unavailable');
  await expect(api.resolveStaticPublication()).rejects.toThrow('declared transport descriptor is unavailable');
});

it('keeps an unchanged verified snapshot and context stable across routine manifest refreshes', async () => {
  const source = manifest(); serve({ 'static-data/manifest.json': source, 'publication.json': receipt(source) });
  const first = await api.loadStaticManifest(), second = await api.loadStaticManifest();
  expect(second).toBe(first); expect(api.publicationForManifest(second)).toBe(api.publicationForManifest(first));
  expect(transport.create).not.toHaveBeenCalled();
});

it.each([['publication', undefined], ['publication', '1'], ['manifest', undefined], ['manifest', '1']])('bounds %s bytes with Content-Length %s and cancels oversized streams before parsing', async (kind, contentLength) => {
  const source = manifest(), cancel = vi.fn(), arrayBuffer = vi.fn();
  const files = { 'static-data/manifest.json': source, 'publication.json': receipt(source) };
  const path = kind === 'manifest' ? 'static-data/manifest.json' : 'publication.json';
  files[path] = () => ({ ok: true, status: 200, headers: new Headers(contentLength ? { 'content-length': contentLength } : {}), arrayBuffer,
    body: new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(api.STATIC_METADATA_LIMITS[kind] + 1)); }, cancel }) });
  serve(files);
  await expect(api.loadStaticManifest()).rejects.toThrow('Byte stream exceeds permitted size');
  expect(cancel).toHaveBeenCalledOnce(); expect(arrayBuffer).not.toHaveBeenCalled();
});

it('accepts a bounded publication receipt larger than the manifest cap', async () => {
  const source = manifest(), raw = json(receipt(source));
  serve({ 'static-data/manifest.json': source, 'publication.json': raw + ' '.repeat(api.STATIC_METADATA_LIMITS.manifest) });
  expect(await api.loadStaticManifest()).toEqual(source);
});

it('checks production financial lineage against the root while accepting its matching preview binding', async () => {
  const source = { ...manifest(), financial_generation: '3'.repeat(64) }, metadata = receipt(source, true);
  metadata.transport.root.bindings.financialGeneration = source.financial_generation;
  metadata.transport.root.bindings.financialLineageSha256 = '4'.repeat(64);
  metadata.financial_lineage_sha256 = '5'.repeat(64);
  const files = { 'static-data/manifest.json': source, 'publication.json': metadata }; serve(files);
  await expect(api.loadStaticManifest()).rejects.toThrow('financial lineage mismatch');
  metadata.financial_lineage_sha256 = '4'.repeat(64);
  expect(await api.loadStaticManifest()).toEqual(source);
  files['publication.json'] = { ...metadata, schema: 'static-json-transport-preview-v1', publication_authority: 'none' };
  delete files['publication.json'].financial_lineage_sha256;
  expect(await api.loadStaticManifest()).toEqual(source);
});

it('serializes declared large decodes across roots after authenticated lookup while admitting small reads', async () => {
  const source = manifest(); serve({ 'static-data/manifest.json': source, 'publication.json': receipt(source) });
  const publication = api.publicationForManifest(await api.loadStaticManifest());
  transport.lookup.mockImplementation(async path => ({ decodedBytes: path.includes('SMALL') ? 1024 : 98 * 1024 * 1024 }));
  const release = []; let active = 0, maximum = 0;
  transport.read.mockImplementation(path => path.includes('SMALL') ? Promise.resolve({ small: true }) : new Promise(resolve => {
    active++; maximum = Math.max(maximum, active); release.push(() => { active--; resolve({ large: true }); });
  }));
  const next = { ...publication, expectedRoot: { ...publication.expectedRoot, sha256: '4'.repeat(64), path: `static-data/_transport/root-${'4'.repeat(64)}.json` } };
  const large = Array.from({ length: 6 }, (_, index) => api.readStaticPayload(`markets/us/scan/chunks/LARGE${index}.json`, { publication: index % 2 ? next : publication }));
  const controller = new AbortController();
  const canceled = api.readStaticPayload('markets/us/scan/chunks/CANCELED.json', { publication, signal: controller.signal });
  const small = api.readStaticPayload('markets/us/home-SMALL.json', { publication });
  expect(await small).toEqual({ small: true });
  await vi.waitFor(() => expect(transport.lookup).toHaveBeenCalledTimes(8));
  controller.abort(); await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
  expect(transport.read).toHaveBeenCalledTimes(2);
  for (let index = 0; index < 6; index++) {
    await vi.waitFor(() => expect(release).toHaveLength(1)); release.shift()();
  }
  await Promise.all(large); expect(maximum).toBe(1);
  expect(transport.read.mock.calls.some(([path]) => path.includes('CANCELED'))).toBe(false);
});

it('aborts admitted subscribers promptly while a shared root hangs, releasing slots without later asset reads', async () => {
  const source = manifest(); serve({ 'static-data/manifest.json': source, 'publication.json': receipt(source) });
  const publication = api.publicationForManifest(await api.loadStaticManifest());
  let finishRoot;
  const root = new Promise(resolve => { finishRoot = resolve; });
  const subscribed = vi.spyOn(root, 'then'); transport.create.mockReturnValue(root);
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const reads = controllers.map((controller, index) => api.readStaticPayload(`markets/us/charts/OLD${index}.json`, { publication, signal: controller.signal }));
  const outcomes = Promise.allSettled(reads);
  controllers.forEach(controller => controller.abort());
  expect((await outcomes).every(value => value.status === 'rejected' && value.reason.name === 'AbortError')).toBe(true);
  const subscriptionsBefore = subscribed.mock.calls.length;
  const replacement = api.readStaticPayload('markets/us/charts/REPLACEMENT.json', { publication });
  expect(subscribed.mock.calls.length).toBe(subscriptionsBefore + 1);
  expect(transport.read).not.toHaveBeenCalled();
  finishRoot({ readJson: transport.read, lookup: transport.lookup });
  await expect(replacement).resolves.toMatchObject({ symbol: 'SAFE' });
  expect(transport.read).toHaveBeenCalledExactlyOnceWith('static-data/markets/us/charts/REPLACEMENT.json', { signal: undefined, expectedDecodedSha256: undefined });
});

it('changes legacy cache identity when the full manifest changes outside the unchanged US research generation', async () => {
  const source = manifest(); serve({ 'static-data/manifest.json': source });
  const first = api.publicationForManifest(await api.loadStaticManifest());
  source.markets.JP = { as_of_date: '2026-10-02' };
  const next = api.publicationForManifest(await api.loadStaticManifest());
  expect(first.generation).toBe(next.generation);
  expect(api.publicationQueryIdentity(first)).not.toBe(api.publicationQueryIdentity(next));
  expect(first.mode).toBe('legacy'); expect(next.mode).toBe('legacy');
});

// Optional publication audit metadata is opaque to the unchanged approved UI.
it.each([false,true])('reads %s packed production metadata with retained financial audit references',async packed=>{
  const source=manifest(),metadata=packed?receipt(source,true):{schema:1,data_manifest_sha256:hash(json(source))};
  const digest='9'.repeat(64),path=`static-data/financial-corrections/release-${digest}.json`;
  metadata.financial_release={schema_version:'financial-release-receipt-v1',path,sha256:digest};
  metadata.financial_audit_files={[path]:digest};
  const fetcher=serve({'static-data/manifest.json':source,'publication.json':metadata});
  expect(await api.loadStaticManifest()).toEqual(source);
  expect(fetcher).toHaveBeenCalledTimes(2);expect(transport.create).not.toHaveBeenCalled();
});
