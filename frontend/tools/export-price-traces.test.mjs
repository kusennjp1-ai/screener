// @vitest-environment node
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createPriceTrace, exportPriceTraces, verifyPriceTraces } from './export-price-traces.mjs';
import { auditDailyBars } from '../src/static/qualificationAudit.js';
import { priceTraceForRow, validatePriceTraceDescriptor } from '../src/static/priceTrace.js';
import { encodeResearchIndex, decodeResearchIndex } from '../src/static/researchTransport.js';
import { prepareResearchBundle } from '../src/static/researchPreprocess.js';
import { validateResearchParity, validatePublishedSummaries } from './research-quality.mjs';

const date = '2026-10-02', now = Date.parse('2026-10-04T00:00:00Z');
const descriptor = { root: `price-traces/${'a'.repeat(64)}`, as_of_date: date, bars: 63 };
const fixture = (symbol = 'GOOD', flat = false) => {
  const days = [], day = new Date(date);
  while (days.length < 280) {
    if (![0, 6].includes(day.getUTCDay())) days.unshift(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() - 1);
  }
  const bars = days.map((day, i) => ({ date: day, open: flat ? 100 : 100 + i / 10,
    high: flat ? 101 : 101 + i / 10, low: flat ? 99 : 99 + i / 10, close: flat ? 100 : 100 + i / 10, volume: 1000000 }));
  const chart = { symbol, as_of_date: date, bars };
  const row = { symbol, as_of_date: date, market: 'US', currency: 'USD', current_price: bars.at(-1).close, adv_usd: 30000000,
    chart_path: `verified-charts/${encodeURIComponent(symbol)}-0123456789abcdef.json`, price_trace_start: bars.at(-63).date };
  row.technical_audit = auditDailyBars(row, chart, date);
  return { row, chart };
};
const write = async (path, value) => {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
};

describe('verified daily-close trace source', () => {
  it('uses only the trailing 63 exact closes and safely renders a flat series', () => {
    const { row, chart } = fixture('FLAT', true);
    const trace = createPriceTrace(row, chart, date);
    expect(trace.points).toEqual(chart.bars.slice(-63).map(bar => [bar.date, bar.close]));
    expect(trace.svg).toContain('viewBox="0 0 360 64"');
    expect(trace.svg).toContain('M4.00,32.00');
    expect(trace.svg).toContain('L356.00,32.00');
    expect(trace.svg).not.toMatch(/NaN|Infinity|script|href|FLAT/);
  });
  it.each(['symbol', 'date', 'final-date', 'nonfinite', 'nonpositive', 'invalid-ohlc', 'duplicate', 'reversed', 'weekend', 'short', 'missing', 'price-close', 'audit-identity', 'audit-date', 'audit-close', 'audit-count', 'injected-symbol'])('rejects %s mismatches or invalid history', kind => {
    const { row, chart } = fixture();
    if (kind === 'symbol') chart.symbol = 'OTHER';
    if (kind === 'date') chart.as_of_date = '2026-10-01';
    if (kind === 'final-date') chart.bars.pop();
    if (kind === 'nonfinite') chart.bars[250].close = Infinity;
    if (kind === 'nonpositive') chart.bars[250].close = 0;
    if (kind === 'invalid-ohlc') chart.bars[250].high = 1;
    if (kind === 'duplicate') chart.bars[250].date = chart.bars[249].date;
    if (kind === 'reversed') chart.bars.reverse();
    if (kind === 'weekend') chart.bars[250].date = '2026-09-26';
    if (kind === 'short') chart.bars = chart.bars.slice(-62);
    if (kind === 'price-close') row.current_price += .01; // The audit's ordinary tolerance does not certify an exact trace close.
    if (kind === 'audit-identity') row.technical_audit.symbol = 'OTHER';
    if (kind === 'audit-date') row.technical_audit.as_of_date = '2026-10-01';
    if (kind === 'audit-close') row.technical_audit.values.close += .01;
    if (kind === 'audit-count') row.technical_audit.bars += 1;
    if (kind === 'injected-symbol') row.symbol = '<script>alert(1)</script>';
    expect(createPriceTrace(row, kind === 'missing' ? null : chart, date)).toBeNull();
  });
  it('preserves observed calendar gaps without fabricating a missing close', () => {
    const { row, chart } = fixture();
    const removed = chart.bars.splice(-20, 1)[0];
    row.technical_audit = auditDailyBars(row, chart, date);
    const trace = createPriceTrace(row, chart, date);
    expect(trace.points).toHaveLength(63);
    expect(trace.points.some(([day]) => day === removed.date)).toBe(false);
    const coordinates = [...trace.svg.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(match => Number(match[1]));
    const elapsed = Date.parse(trace.points.at(-1)[0]) - Date.parse(trace.points[0][0]);
    trace.points.forEach(([day], index) => expect(coordinates[index]).toBeCloseTo(4 + (Date.parse(day) - Date.parse(trace.points[0][0])) / elapsed * 352, 2));
  });
});

describe('compact trace metadata and runtime', () => {
  it.each([null, {}, { ...descriptor, root: 'https://other.test/x' }, { ...descriptor, root: '../price-traces/a' },
    { ...descriptor, root: `${descriptor.root}/..` }, { ...descriptor, root: `price-traces/${'a'.repeat(64)}?x=1` },
    { ...descriptor, as_of_date: '2026-10-01' }, { ...descriptor, bars: 62 }, { ...descriptor, path: 'extra' }])('rejects a malformed or foreign descriptor %j', value => {
    expect(() => validatePriceTraceDescriptor(value, date)).toThrow('Invalid price trace descriptor');
    expect(() => encodeResearchIndex({ as_of_date: date, rows: [], price_traces: value })).toThrow();
    expect(() => decodeResearchIndex({ as_of_date: date, rows: [], price_traces: value })).toThrow();
  });
  it('round-trips the single descriptor and derives immutable paths without serializing runtime objects', () => {
    const { row } = fixture();
    const wire = encodeResearchIndex({ as_of_date: date, price_traces: descriptor, rows: [row] });
    const decoded = decodeResearchIndex(JSON.parse(JSON.stringify(wire)));
    expect(decoded.price_traces).toEqual(descriptor);
    const bundle = prepareResearchBundle([wire], date, { now });
    expect(bundle.rows[0].priceTrace).toEqual({ status: 'available', asOfDate: date, startDate: row.price_trace_start,
      endDate: date, bars: 63, caption: `終値 · 直近63日足 · ${row.price_trace_start}〜${date}`, src: `${descriptor.root}/GOOD.svg` });
    expect(encodeResearchIndex({ ...decoded, rows: bundle.rows }).fields).not.toContainEqual(['priceTrace', 'src']);
    expect(() => prepareResearchBundle([wire, { as_of_date: date, rows: [], price_traces: { ...descriptor, root: `price-traces/${'b'.repeat(64)}` } }], date, { now })).toThrow('Mixed price trace generations');
  });
  it('fails closed for old bundles, missing history, stale audits, forged runtime paths and foreign charts', () => {
    const { row } = fixture();
    expect(prepareResearchBundle([{ as_of_date: date, rows: [{ ...row, priceTrace: { status: 'available', src: 'https://evil.test' } }] }], date, { now }).rows[0].priceTrace).toMatchObject({ status: 'unavailable', reason: 'not_published' });
    expect(priceTraceForRow({ ...row, price_trace_start: undefined }, descriptor, date).status).toBe('unavailable');
    expect(priceTraceForRow({ ...row, chart_path: 'https://other.test/GOOD-0123456789abcdef.json' }, descriptor, date).status).toBe('unavailable');
    expect(priceTraceForRow({ ...row, as_of_date: '2026-10-01' }, descriptor, date).status).toBe('unavailable');
    expect(priceTraceForRow({ ...row, technical_audit: { ...row.technical_audit, valid: false } }, descriptor, date).status).toBe('unavailable');
  });
  it('preserves dated source freshness independently of the financial evaluation clock', () => {
    const { row } = fixture();
    const input = { as_of_date: date, price_traces: descriptor, rows: [row] };
    const first = prepareResearchBundle([input], date, { now });
    const later = prepareResearchBundle([input], date, { now: now + 86400000 * 14 });
    expect(later.rows[0].priceTrace).toEqual(first.rows[0].priceTrace);
    expect(later.rows[0].priceTrace.asOfDate).toBe(date);
    expect(later.evaluated_at).not.toBe(first.evaluated_at);
  });
  it('adds less than 2 KB gzip for a 5,901-row publication without per-row asset hashes', () => {
    const rows = Array.from({ length: 5901 }, (_, i) => ({ symbol: `T${i}`, as_of_date: date, current_price: 10 + i / 7 }));
    const baseline = JSON.stringify(encodeResearchIndex({ as_of_date: date, rows }));
    const traced = JSON.stringify(encodeResearchIndex({ as_of_date: date, price_traces: descriptor,
      rows: rows.map((row, i) => ({ ...row, ...(i % 7 ? { price_trace_start: '2026-07-08' } : {}) })) }));
    expect(gzipSync(traced).length - gzipSync(baseline).length).toBeLessThan(2048);
    expect(traced.split(descriptor.root)).toHaveLength(2);
  });
});

it('binds exact data, canonical identity, complete assets and bytes to an immutable set hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'price-trace-proof-'));
  try {
    const { row, chart } = fixture();
    await write(join(root, row.chart_path), chart);
    const publish = () => exportPriceTraces({ root, rows: [row], traces: new Map([[row.symbol, createPriceTrace(row, chart, date)]]), date });
    const first = await publish();
    expect(await publish()).toEqual(first);
    expect(await verifyPriceTraces({ root, rows: [row], descriptor: first, date })).toEqual({ available: 1, legacy: false });
    expect(await verifyPriceTraces({ root, rows: [row], date })).toEqual({ available: 0, legacy: true });
    await write(join(root, row.chart_path), { ...chart, stock_data: { symbol: row.symbol, current_price: row.current_price + 1 } });
    await expect(verifyPriceTraces({ root, rows: [row], descriptor: first, date })).rejects.toThrow('canonical price mismatch');
    chart.bars.at(-20).close += 1e-9;
    await write(join(root, row.chart_path), chart);
    await expect(verifyPriceTraces({ root, rows: [row], descriptor: first, date })).rejects.toThrow('source mismatch');
    const second = await publish();
    expect(second.root).not.toBe(first.root); // Subpixel data differences are still bound.
    const path = join(root, priceTraceForRow(row, second, date).src);
    await write(path, '<svg/>');
    await expect(verifyPriceTraces({ root, rows: [row], descriptor: second, date })).rejects.toThrow('asset mismatch');
    await rm(path);
    await expect(verifyPriceTraces({ root, rows: [row], descriptor: second, date })).rejects.toThrow();
    await write(join(root, second.root, 'index.json'), '{}');
    await expect(verifyPriceTraces({ root, rows: [row], descriptor: second, date })).rejects.toThrow('set hash mismatch');
    await expect(exportPriceTraces({ root, rows: [row], traces: new Map(), date })).rejects.toThrow('Missing price trace source');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('actual research exporter publishes only validated traces without changing source time, rules, ranks, CSV or portfolio', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'price-trace-export-'));
  const frontend = join(directory, 'frontend'), root = join(frontend, 'public/static-data');
  try {
    const valid = fixture(), flat = fixture('FLAT', true), bad = fixture('BAD'), tolerance = fixture('TOLERANCE'), absent = fixture('ABSENT');
    bad.chart.bars[250].high = 1;
    tolerance.row.current_price += .01;
    const fixtures = [valid, flat, bad, tolerance, absent], rows = fixtures.map(item => item.row);
    const generated = '2026-10-02T20:04:05Z';
    const entry = { as_of_date: date, market: 'US', pages: { scan: { path: 'scan.json' } }, assets: { charts: { path: 'charts-index.json' } } };
    await write(join(root, 'manifest.json'), { generated_at: generated, markets: { US: entry } });
    await write(join(root, 'scan.json'), { as_of_date: date, initial_rows: rows, preview_rows: rows, chunks: [] });
    await write(join(root, 'charts-index.json'), { symbols: fixtures.filter(item => item !== absent).map(item => ({ symbol: item.row.symbol, path: `source/${item.row.symbol}.json` })) });
    for (const item of fixtures.filter(item => item !== absent)) await write(join(root, `source/${item.row.symbol}.json`), item.chart);
    await mkdir(join(directory, 'data/ibd_reference/ibd50'), { recursive: true });
    execFileSync(process.execPath, [fileURLToPath(new URL('./export-research.mjs', import.meta.url))], { cwd: frontend, env: { ...process.env, FINANCIAL_EVALUATED_AT: new Date(now).toISOString() }, encoding: 'utf8' });
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    expect(manifest.generated_at).toBe(generated);
    const wire = JSON.parse(await readFile(join(root, manifest.markets.US.assets.research.path), 'utf8'));
    const decoded = decodeResearchIndex(wire), bundle = prepareResearchBundle([wire], date, { now });
    expect(await verifyPriceTraces({ root, rows: decoded.rows, descriptor: decoded.price_traces, date })).toEqual({ available: 2, legacy: false });
    expect(bundle.rows.filter(row => row.priceTrace.status === 'available').map(row => row.symbol)).toEqual(['GOOD', 'FLAT']);
    expect(bundle.rows.filter(row => row.priceTrace.status === 'unavailable').map(row => row.symbol)).toEqual(['BAD', 'TOLERANCE', 'ABSENT']);
    const details = await Promise.all(decoded.rows.map(async row => JSON.parse(await readFile(join(root, row.research_detail_path), 'utf8'))));
    expect(() => validatePublishedSummaries(decoded.rows, now)).not.toThrow();
    expect(() => validateResearchParity(wire, details, now)).not.toThrow();
    const withoutTraces = structuredClone(wire); delete withoutTraces.price_traces;
    const baseline = prepareResearchBundle([withoutTraces], date, { now });
    for (const method of Object.keys(bundle.rankings)) expect(bundle.rankings[method].map(({ row, assessment }) => [row.symbol, assessment])).toEqual(baseline.rankings[method].map(({ row, assessment }) => [row.symbol, assessment]));
    expect(bundle.prepared.candidates.map(row => row.symbol)).toEqual(baseline.prepared.candidates.map(row => row.symbol));
    const trace = bundle.rows[0].priceTrace;
    expect(trace.endDate).toBe(date);
    expect(trace.startDate).toBe(valid.chart.bars.at(-63).date);
    expect(await readFile(join(root, trace.src), 'utf8')).toBe(createPriceTrace(details[0], valid.chart, date).svg);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
