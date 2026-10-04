// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derivePublicPreviewTrace } from './event-feed-preview-public-trace.mjs';
import { createPriceTrace, exportPriceTraces } from './export-price-traces.mjs';
import { auditDailyBars } from '../src/static/qualificationAudit.js';
import { decodeResearchIndex, encodeResearchIndex } from '../src/static/researchTransport.js';
import { prepareResearchBundle } from '../src/static/researchPreprocess.js';

const date = '2026-10-02', generated = '2026-10-02T20:12:34Z', now = Date.parse('2026-10-04T09:00:00Z');
const hash = value => createHash('sha256').update(value).digest('hex');
const makeChart = symbol => {
  const days = [];
  for (let time = Date.parse(date); days.length < 280; time -= 86400000) {
    const day = new Date(time);
    if (![0, 6].includes(day.getUTCDay())) days.unshift(day.toISOString().slice(0, 10));
  }
  const bars = days.map((day, i) => ({ date: day, open: 100 + i / 10, high: 101 + i / 10, low: 99 + i / 10, close: 100 + i / 10, volume: 1000000 }));
  return { symbol, as_of_date: date, bars };
};
function fixture({ count = 3, encoded = true, symbols = ['OTHER', 'DELL', 'NOCHART'] } = {}) {
  const chart = makeChart('DELL');
  const rows = Array.from({ length: count }, (_, i) => {
    const symbol = symbols[i] || `STOCK${i}`;
    const row = { symbol, as_of_date: date, current_price: chart.bars.at(-1).close, market: 'US', currency: 'USD',
      eps_growth_yy: i + 31.1234567890123, sales_growth_yy: null, roe: -0.000000000123,
      financial_observed_at: '2026-09-29T01:02:03Z', financial_source: 'unchanged observation',
      financial_history: { symbol, as_of_date: date, retrieved_at: '2026-10-02T00:00:00Z', annual: [{ end: '2025-12-31', eps: 1.234567890123 }] },
      chart_path: `verified-charts/${symbol}-0123456789abcdef.json` };
    if (symbol !== 'NOCHART' && i < 2) row.technical_audit = auditDailyBars(row, { ...chart, symbol }, date);
    return row;
  });
  let wire = { as_of_date: date, financial_evaluated_at: now - 86400000, financial_semantics: 'unchanged-source-semantics', assessment_version: 'original-version',
    rows, orders: { oneil: rows.map((_, i) => i).reverse() } };
  if (encoded) wire = encodeResearchIndex(wire, wire.orders);
  wire.extra_metadata = { retained: true, nested: ['not projected away', null, false] };
  const resources = new Map();
  for (const row of rows.filter(item => item.technical_audit)) resources.set(row.chart_path, { type: 'application/json', body: Buffer.from(JSON.stringify({ ...chart, symbol: row.symbol, stock_data: { symbol: row.symbol, as_of_date: date, current_price: row.current_price } })) });
  const manifest = { as_of_date: date, generated_at: generated, default_market: 'US', supported_markets: ['US'],
    markets: { US: { as_of_date: date, assets: { research: { path: '', financial_evaluated_at: now - 86400000 } }, pages: { home: { path: 'home-original.json' } } } } };
  const publish = () => {
    const body = Buffer.from(JSON.stringify(wire));
    manifest.research_generation = hash(body);
    manifest.markets.US.assets.research.path = `research-index-${hash(body).slice(0, 16)}.json`;
    resources.set(manifest.markets.US.assets.research.path, { type: 'application/json', body });
    resources.set('manifest.json', { type: 'application/json', body: Buffer.from(JSON.stringify(manifest, null, 2)) });
  };
  publish();
  return { wire, rows, manifest, resources, publish, readResource: vi.fn(async path => resources.get(path)) };
}
const derived = result => {
  const manifest = JSON.parse(result.resources.get('manifest.json').body);
  const wire = JSON.parse(result.resources.get(manifest.markets.US.assets.research.path).body);
  return { manifest, wire, index: decodeResearchIndex(structuredClone(wire)) };
};

beforeEach(() => vi.stubEnv('CI', 'true'));
afterEach(() => vi.unstubAllEnvs());

describe('bounded public preview trace', () => {
  it('uses exactly the production generator, proof and exact SVG bytes for one preferred canonical chart', async () => {
    const input = fixture();
    const result = await derivePublicPreviewTrace(input);
    const { manifest, wire, index } = derived(result);
    const row = index.rows.find(item => item.symbol === 'DELL');
    const chart = JSON.parse(input.resources.get(row.chart_path).body);
    const trace = createPriceTrace(row, chart, date);
    const root = await mkdtemp(join(tmpdir(), 'public-preview-expected-'));
    try {
      await mkdir(dirname(join(root, row.chart_path)), { recursive: true });
      await writeFile(join(root, row.chart_path), input.resources.get(row.chart_path).body);
      const descriptor = await exportPriceTraces({ root, rows: [row], traces: new Map([[row.symbol, trace]]), date });
      expect(index.price_traces).toEqual(descriptor);
      expect(result.resources.get(`${descriptor.root}/DELL.svg`).body).toEqual(await readFile(join(root, descriptor.root, 'DELL.svg')));
      expect(result.resources.get(`${descriptor.root}/index.json`).body).toEqual(await readFile(join(root, descriptor.root, 'index.json')));
      const proof = JSON.parse(result.resources.get(`${descriptor.root}/index.json`).body);
      expect(proof.entries[0].points).toEqual(chart.bars.slice(-63).map(bar => [bar.date, bar.close]));
      expect(proof.entries).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
    expect(result.symbol).toBe('DELL');
    expect(result.resources.size).toBe(4);
    expect(input.readResource.mock.calls.map(([path]) => path)).toEqual(['manifest.json', input.manifest.markets.US.assets.research.path, row.chart_path]);
    expect(manifest.research_generation).toBe(hash(result.resources.get(manifest.markets.US.assets.research.path).body));
    expect(manifest.markets.US.assets.research.path).toBe(`research-index-${manifest.research_generation.slice(0, 16)}.json`);
    expect(wire.as_of_date).toBe(date);
    expect(result.provenance).toMatchObject({ preview_only: true, source_as_of_date: date, source_generated_at: generated, row_count: 3, chart_resources_read: 1 });
    expect(result.provenance.statement).toContain('not a published new dataset or a newly fresh financial observation');
    for (const [kind, resource] of Object.entries(result.provenance.original)) {
      expect(resource.sha256).toBe(hash(input.resources.get(resource.path).body));
      expect(resource.bytes).toBe(input.resources.get(resource.path).body.length);
      if (kind === 'manifest') expect(resource.sha256).not.toBe(hash(JSON.stringify(input.manifest))); // Exact original whitespace is bound.
    }
    for (const resource of Object.values(result.provenance.derived)) expect(resource.sha256).toBe(hash(result.resources.get(resource.path).body));
  });

  it.each([true, false])('preserves all 5,901 original rows, financial values, metadata, orders and dates (encoded=%s)', async encoded => {
    const input = fixture({ count: 5901, encoded });
    if (encoded) {
      // This field is deliberately excluded by production researchListRow.
      input.wire.fields.push(['financial_source_evidence']);
      input.wire.columns.push({ pool: [{ source: 'untouched', observed_at: generated, raw: [1.234567890123, null, false] }], refs: input.rows.map(() => 0) });
    } else input.wire.rows[1].financial_source_evidence = { source: 'untouched', observed_at: generated, raw: [1.234567890123, null, false] };
    input.publish();
    const before = decodeResearchIndex(structuredClone(input.wire));
    const result = await derivePublicPreviewTrace(input);
    const after = derived(result);
    expect(after.index.rows).toHaveLength(5901);
    delete after.index.rows[1].price_trace_start;
    delete after.index.price_traces;
    expect(after.index).toEqual(before);
    expect(after.wire.extra_metadata).toEqual(input.wire.extra_metadata);
    if (encoded) {
      expect(after.wire.columns.slice(0, -1)).toEqual(input.wire.columns);
      expect(after.wire.fields.slice(0, -1)).toEqual(input.wire.fields);
    }
    after.manifest.research_generation = input.manifest.research_generation;
    after.manifest.markets.US.assets.research.path = input.manifest.markets.US.assets.research.path;
    expect(after.manifest).toEqual(input.manifest);
  });

  it('preserves the raw-financial-evidence unknown behavior and current-use financial judgments', async () => {
    const input = fixture();
    const result = await derivePublicPreviewTrace(input), output = derived(result);
    const original = prepareResearchBundle([input.wire], date, { now, generation: input.manifest.research_generation });
    const preview = prepareResearchBundle([output.wire], date, { now, generation: output.manifest.research_generation });
    for (const method of Object.keys(original.rankings)) expect(preview.rankings[method].map(item => [item.row.symbol, item.assessment]))
      .toEqual(original.rankings[method].map(item => [item.row.symbol, item.assessment]));
    for (const row of preview.rows) {
      expect(row.eps_growth_yy).toBeNull();
      expect(row.financial_current_state).toEqual(original.rows.find(item => item.symbol === row.symbol).financial_current_state);
    }
    expect(preview.rows.filter(row => row.priceTrace.status === 'available').map(row => row.symbol)).toEqual(['DELL']);
  });

  it.each([true, false])('uses an older index-level date without adding or changing serialized row dates (encoded=%s)', async encoded => {
    const input = fixture({ encoded: false });
    for (const row of input.wire.rows) delete row.as_of_date;
    if (encoded) {
      const encodedIndex = encodeResearchIndex(input.wire, input.wire.orders);
      for (const key of Object.keys(input.wire)) delete input.wire[key];
      Object.assign(input.wire, encodedIndex);
    }
    input.publish();
    const result = await derivePublicPreviewTrace(input), output = derived(result);
    expect(output.index.rows.every(row => !Object.hasOwn(row, 'as_of_date'))).toBe(true);
    const preview = prepareResearchBundle([output.wire], date, { now, generation: output.manifest.research_generation });
    expect(preview.rows.filter(row => row.priceTrace.status === 'available').map(row => row.symbol)).toEqual(['DELL']);
    expect(preview.rows[1].priceTrace.asOfDate).toBe(date);
  });

  it('does not replace an explicit conflicting row date with the index date', async () => {
    const input = fixture({ encoded: false, count: 1, symbols: ['DELL'] });
    input.wire.rows[0].as_of_date = '2026-10-01'; input.publish();
    await expect(derivePublicPreviewTrace(input)).rejects.toThrow('no same-date verified canonical chart');
    expect(input.readResource).toHaveBeenCalledTimes(2);
  });

  it('isolates all mutations and cleans temporary production assets', async () => {
    const input = fixture();
    const manifestBefore = structuredClone(input.manifest), wireBefore = structuredClone(input.wire);
    const bytesBefore = new Map([...input.resources].map(([path, resource]) => [path, Buffer.from(resource.body)]));
    const temporaryBefore = (await readdir(tmpdir())).filter(name => name.startsWith('event-feed-public-trace-')).sort();
    const result = await derivePublicPreviewTrace(input);
    expect(input.manifest).toEqual(manifestBefore);
    expect(input.wire).toEqual(wireBefore);
    for (const [path, bytes] of bytesBefore) expect(input.resources.get(path).body).toEqual(bytes);
    result.resources.get('manifest.json').body.fill(0);
    expect(input.resources.get('manifest.json').body).toEqual(bytesBefore.get('manifest.json'));
    expect((await readdir(tmpdir())).filter(name => name.startsWith('event-feed-public-trace-')).sort()).toEqual(temporaryBefore);
  });

  it('selects another verified row only when the preferred row is absent or ineligible before fetching a chart', async () => {
    const input = fixture();
    const result = await derivePublicPreviewTrace({ ...input, preferredSymbol: 'NOCHART' });
    expect(result.symbol).toBe('OTHER');
    expect(input.readResource.mock.calls.at(-1)[0]).toBe(input.rows[0].chart_path);
    expect(input.readResource).toHaveBeenCalledTimes(3);
  });

  it.each(['symbol', 'date', 'final-date', 'close', 'history', 'stock-symbol', 'stock-price', 'stock-date', 'audit-count'])('fails closed on %s mismatch without trying another chart', async mismatch => {
    const input = fixture(), path = input.rows[1].chart_path;
    const chart = JSON.parse(input.resources.get(path).body);
    if (mismatch === 'symbol') chart.symbol = 'OTHER';
    if (mismatch === 'date') chart.as_of_date = '2026-10-01';
    if (mismatch === 'final-date') chart.bars.pop();
    if (mismatch === 'close') chart.bars.at(-1).close += .001;
    if (mismatch === 'history') chart.bars = chart.bars.slice(-62);
    if (mismatch === 'stock-symbol') chart.stock_data.symbol = 'OTHER';
    if (mismatch === 'stock-price') chart.stock_data.current_price += .001;
    if (mismatch === 'stock-date') chart.stock_data.as_of_date = '2026-10-01';
    if (mismatch === 'audit-count') chart.bars.shift();
    input.resources.set(path, { type: 'application/json', body: JSON.stringify(chart) });
    await expect(derivePublicPreviewTrace(input)).rejects.toThrow(/Public preview trace unavailable/);
    expect(input.readResource.mock.calls.map(([resource]) => resource).filter(resource => resource.startsWith('verified-charts/'))).toEqual([path]);
  });

  it.each(['manifest', 'research', 'chart'])('rejects unavailable %s input', async kind => {
    const input = fixture();
    input.resources.delete(kind === 'manifest' ? 'manifest.json' : kind === 'research' ? input.manifest.markets.US.assets.research.path : input.rows[1].chart_path);
    await expect(derivePublicPreviewTrace(input)).rejects.toThrow('missing bytes');
  });

  it('rejects mixed pinned manifest, generation, index date and truncated data', async () => {
    const mixed = fixture();
    mixed.manifest.generated_at = '2026-10-03T20:12:34Z';
    await expect(derivePublicPreviewTrace(mixed)).rejects.toThrow('manifest identity mismatch');
    const generation = fixture();
    generation.manifest.research_generation = 'f'.repeat(64);
    generation.resources.set('manifest.json', { body: JSON.stringify(generation.manifest) });
    await expect(derivePublicPreviewTrace(generation)).rejects.toThrow('research generation mismatch');
    const dated = fixture();
    dated.wire.as_of_date = '2026-10-01'; dated.publish();
    await expect(derivePublicPreviewTrace(dated)).rejects.toThrow('mismatched research snapshot');
    const truncated = fixture();
    truncated.wire.count += 1; truncated.publish();
    await expect(derivePublicPreviewTrace(truncated)).rejects.toThrow('Incomplete research column');
  });

  it.each([true, false])('validates and updates a research reference digest only when present (present=%s)', async present => {
    const input = fixture();
    if (present) input.manifest.markets.US.assets.research.sha256 = input.manifest.research_generation;
    input.publish();
    const before = structuredClone(input.manifest);
    const result = await derivePublicPreviewTrace(input), output = derived(result);
    const reference = output.manifest.markets.US.assets.research;
    expect(Object.hasOwn(reference, 'sha256')).toBe(present);
    if (present) {
      expect(reference.sha256).toBe(hash(result.resources.get(reference.path).body));
      expect(reference.sha256).toBe(output.manifest.research_generation);
      expect(reference.sha256).not.toBe(before.markets.US.assets.research.sha256);
    }
    expect(input.manifest).toEqual(before);
  });

  it('rejects a research reference digest that does not match the original bytes before reading a chart', async () => {
    const input = fixture();
    input.manifest.markets.US.assets.research.sha256 = '0'.repeat(64); input.publish();
    await expect(derivePublicPreviewTrace(input)).rejects.toThrow('research reference hash mismatch');
    expect(input.readResource).toHaveBeenCalledTimes(2);
  });

  it.each(['index', 'reference'])('explicitly rejects %s chunks without fetching them', async kind => {
    const input = fixture();
    (kind === 'index' ? input.wire : input.manifest.markets.US.assets.research).chunks = [{ path: 'chunk.json', count: 5901 }];
    input.publish();
    await expect(derivePublicPreviewTrace(input)).rejects.toThrow('chunked research is unsupported');
    expect(input.readResource.mock.calls.flat()).not.toContain('chunk.json');
  });

  it('rejects already published traces and unsafe canonical paths', async () => {
    const existing = fixture();
    existing.wire.price_traces = { root: `price-traces/${'a'.repeat(64)}`, as_of_date: date, bars: 63 }; existing.publish();
    await expect(derivePublicPreviewTrace(existing)).rejects.toThrow('already published');
    const unsafe = fixture({ encoded: false, count: 1, symbols: ['DELL'] });
    unsafe.wire.rows[0].chart_path = '../verified-charts/DELL-0123456789abcdef.json'; unsafe.publish();
    await expect(derivePublicPreviewTrace(unsafe)).rejects.toThrow('no same-date verified canonical chart');
    expect(unsafe.readResource).toHaveBeenCalledTimes(2);
  });

  it('requires CI and injected pinned resources', async () => {
    vi.stubEnv('CI', '');
    await expect(derivePublicPreviewTrace(fixture())).rejects.toThrow('only in the CI preview');
    vi.stubEnv('CI', 'true');
    await expect(derivePublicPreviewTrace()).rejects.toThrow('missing pinned inputs');
  });
});
