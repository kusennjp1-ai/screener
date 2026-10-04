// Pure tests only: no browser, build, server or CI environment override.
import { describe, expect, it } from 'vitest';
import { captureStaticAsset, replayStaticAsset, pricePaneViewportBottom, sectionLayoutSnapshot, assertDiagnosticCI, parseVisibleRange, inspectPriceBitmap, isPaintedSample, stablePaintPair, summarizePhaseObservations, assertSameSnapshot, summarizeTimeline, validateBuildSource, runDiagnosticCLI } from './chart-viewport-diagnostic.mjs';
const colors = { up: [72, 214, 160], down: [240, 112, 122] };
const expected = { symbol: 'ADI', as_of_date: '2026-10-02', bars: [{ date: '2026-09-30', open: 100, close: 102 }, { date: '2026-10-01', open: 103, close: 101 }, { date: '2026-10-02', open: 101, close: 104 }] };
const pixels = () => new Uint8ClampedArray([...Array.from({ length: 8 }, () => [...colors.up, 255]), ...Array.from({ length: 8 }, () => [...colors.down, 255])].flat());
const sample = (overrides = {}) => ({ symbol: 'ADI', as_of_date: '2026-10-02', range: '2026-09-30 ～ 2026-10-02', visible: true, hit_test: true, at_ms: 100, frame: 1, bitmap: inspectPriceBitmap(pixels(), 4, 4, colors), ...overrides });
const provenance = () => ({ symbol: 'ADI', as_of_date: '2026-10-02', manifest_sha256: 'a'.repeat(64), research_sha256: 'b'.repeat(64), chart_sha256: 'c'.repeat(64) });

describe('CI boundary and source identity', () => {
  it.each([undefined, '', 'false', 'FALSE', '0'])('rejects false CI=%s', CI => expect(() => assertDiagnosticCI({ CI })).toThrow(/GitHub Actions/));
  it('requires explicit CLI inputs before browser work', async () => {
    expect(() => assertDiagnosticCI({ CI: 'true' })).not.toThrow();
    await expect(runDiagnosticCLI({ CI: 'true' })).rejects.toThrow(/CHART_EAGER_BUILD/);
    await expect(runDiagnosticCLI({})).rejects.toThrow(/GitHub Actions/);
  });
  it('requires full revision, tree and correct build role', () => {
    const proof = { revision: 'a'.repeat(40), tree: 'b'.repeat(40), label: 'eager' };
    expect(validateBuildSource(proof, proof.revision, 'eager')).toBe(proof);
    expect(() => validateBuildSource(proof, 'c'.repeat(40), 'eager')).toThrow();
    expect(() => validateBuildSource({ ...proof, tree: '' }, proof.revision, 'eager')).toThrow();
    expect(() => validateBuildSource(proof, proof.revision, 'current')).toThrow();
  });
  it('requires exact complete manifest, research and chart hashes', () => {
    expect(assertSameSnapshot(provenance(), provenance())).toBe(true);
    for (const key of Object.keys(provenance())) {
      expect(() => assertSameSnapshot(provenance(), { ...provenance(), [key]: null })).toThrow(/Missing/);
      expect(() => assertSameSnapshot(provenance(), { ...provenance(), [key]: 'different' })).toThrow(/differ/);
    }
    expect(() => assertSameSnapshot({ ...provenance(), chart_sha256: 'short' }, { ...provenance(), chart_sha256: 'short' })).toThrow(/Invalid/);
  });
});

describe('immutable response MIME and visible pane clipping', () => {
  it.each(['image/svg+xml; charset=utf-8', 'application/json'])('preserves actual %s on capture/replay', contentType => {
    const body = Buffer.from(contentType.startsWith('image/') ? '<svg></svg>' : '{"bars":[]}');
    const asset = captureStaticAsset(body, { 'Content-Type': contentType });
    expect(replayStaticAsset(asset)).toEqual({ status: 200, body, headers: { 'content-type': contentType } });
    expect(asset.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('does not invent a JSON MIME type when the source omitted content-type', () => {
    expect(replayStaticAsset(captureStaticAsset(Buffer.from('bytes'), {})).headers).toEqual({});
  });
  it('excludes candle pixels covered by fixed mobile navigation', () => {
    const pane = { top: 0, bottom: 4, left: 0, right: 4 };
    const nav = { top: 2, bottom: 4, left: 0, right: 4, width: 4, height: 2, position: 'fixed', display: 'block', visibility: 'visible', opacity: 1 };
    const bottom = pricePaneViewportBottom(4, pane, nav);
    expect(bottom).toBe(2);
    const bitmap = new Uint8ClampedArray(4 * 4 * 4);
    // Every colored pixel is in the two rows hidden underneath navigation.
    for (let offset = 4 * 2 * 4; offset < bitmap.length; offset += 4) bitmap.set([...colors.up, 255], offset);
    expect(inspectPriceBitmap(bitmap, 4, 4, colors).up_pixels).toBe(8);
    expect(inspectPriceBitmap(bitmap.slice(0, 4 * bottom * 4), 4, bottom, colors).up_pixels).toBe(0);
    for (const override of [{ display: 'none' }, { visibility: 'hidden' }, { hidden: true }, { opacity: 0 }, { width: 0, height: 0 }, { position: 'static' }]) expect(pricePaneViewportBottom(4, pane, { ...nav, ...override })).toBe(4);
    expect(pricePaneViewportBottom(4, pane, null)).toBe(4);
  });
});

describe('actual candle bitmap evidence', () => {
  it('counts only exact opaque palette colors and hashes every pixel', () => {
    expect(inspectPriceBitmap(pixels(), 4, 4, colors)).toMatchObject({ up_pixels: 8, down_pixels: 8, candle_columns: 4 });
    const changed = pixels(); changed[0]--;
    expect(inspectPriceBitmap(changed, 4, 4, colors).fingerprint).not.toBe(sample().bitmap.fingerprint);
    changed[3] = 254;
    expect(inspectPriceBitmap(changed, 4, 4, colors).up_pixels).toBe(7);
  });
  it('rejects invalid dimensions and an empty canvas', () => {
    expect(inspectPriceBitmap([], 0, 0, colors)).toBeNull();
    expect(inspectPriceBitmap(pixels(), 4, 3, colors)).toBeNull();
    expect(isPaintedSample(sample({ bitmap: inspectPriceBitmap(new Uint8ClampedArray(64), 4, 4, colors) }), expected)).toBe(false);
    expect(isPaintedSample(sample({ bitmap: null }), expected)).toBe(false);
  });
  it('requires visible unobscured pixels, correct identity, and populated valid range', () => {
    expect(isPaintedSample(sample(), expected)).toBe(true);
    for (const overrides of [{ visible: false }, { hit_test: false }, { symbol: 'MSM' }, { as_of_date: '2026-10-01' }, { range: '' }, { range: '2026-10-01 ～ 2026-10-03' }, { error: 'tainted canvas' }]) expect(isPaintedSample(sample(overrides), expected)).toBe(false);
  });
  it('requires every expected candle direction but permits an all-up window', () => {
    const bitmap = { ...sample().bitmap, down_pixels: 0 };
    expect(isPaintedSample(sample({ bitmap }), expected)).toBe(false);
    expect(isPaintedSample(sample({ bitmap, range: '2026-10-02 ～ 2026-10-02' }), expected)).toBe(true);
  });
  it('requires changed range and raster for interaction, exact range for warm return', () => {
    expect(isPaintedSample(sample(), { ...expected, previous_range: sample().range })).toBe(false);
    expect(isPaintedSample(sample(), { ...expected, previous_fingerprint: sample().bitmap.fingerprint })).toBe(false);
    expect(isPaintedSample(sample(), { ...expected, exact_range: '2026-10-01 ～ 2026-10-02' })).toBe(false);
  });
  it('requires identical validated raster/range on adjacent advancing frames', () => {
    const first = sample(), next = sample({ frame: 2, at_ms: 116 });
    expect(stablePaintPair(first, next, expected)).toBe(true);
    expect(stablePaintPair(null, next, expected)).toBe(false);
    for (const overrides of [{ frame: 3 }, { at_ms: 100 }, { range: '2026-10-01 ～ 2026-10-02' }, { bitmap: { ...next.bitmap, fingerprint: 'changed' } }]) expect(stablePaintPair(first, { ...next, ...overrides }, expected)).toBe(false);
  });
  it('rejects rolled-over or reversed dates', () => {
    expect(parseVisibleRange('2026-10-01 ～ 2026-10-02')).toEqual({ from: '2026-10-01', to: '2026-10-02' });
    for (const text of ['', '2026-02-30 ～ 2026-03-01', '2026-10-02 ～ 2026-10-01', 'Loading']) expect(parseVisibleRange(text)).toBeNull();
  });
});

describe('honest performance observations', () => {
  it('distinguishes viewport scrolling from document reflow in section bounds', () => {
    const before = sectionLayoutSnapshot({ top: 900, bottom: 1450, width: 600, height: 550 }, 100, 2400);
    const after = sectionLayoutSnapshot({ top: 100, bottom: 650, width: 600, height: 550 }, 900, 2400);
    expect(before).toEqual({ scroll_y: 100, document_height: 2400, section: { top: 900, bottom: 1450, width: 600, height: 550, document_top: 1000 } });
    expect(after.section.document_top).toBe(before.section.document_top);
    const expanded = sectionLayoutSnapshot({ top: 100, bottom: 710, width: 600, height: 610 }, 900, 2460);
    expect(expanded.section.height - after.section.height).toBe(60);
    expect(expanded.document_height - after.document_height).toBe(60);
  });
  it('keeps missing section geometry distinct from a zero-sized measured section', () => {
    expect(sectionLayoutSnapshot(null, 0, 900)).toEqual({ section: null, scroll_y: 0, document_height: 900 });
    expect(sectionLayoutSnapshot({ top: 0, bottom: 0, width: 0, height: 0 }, 0, 900).section).not.toBeNull();
  });
  it('includes overlapping tasks and distinguishes input-related shifts', () => {
    const metrics = summarizePhaseObservations({ supported: { longtask: true, 'layout-shift': true }, tasks: [{ start: 80, duration: 60 }, { start: 180, duration: 80 }, { start: 300, duration: 60 }], shifts: [{ start: 125, value: .2, had_recent_input: true }, { start: 150, value: .1, had_recent_input: false }] }, 100, 200);
    expect(metrics).toMatchObject({ complete: true, longest_longtask_ms: 80, overlapping_longtask_ms: 60, layout_shift_without_recent_input: .1 });
    expect(metrics.layout_shift_sum).toBeCloseTo(.3);
  });
  it('does not turn missing events/observers or truncated data into success', () => {
    expect(summarizePhaseObservations({ tasks: [], shifts: [] }, null, 200)).toBeNull();
    expect(summarizePhaseObservations({ tasks: [], shifts: [], supported: {} }, 100, 200)).toMatchObject({ complete: false, longtasks: null, layout_shifts: null });
    expect(summarizePhaseObservations({ tasks: [], shifts: [], supported: { longtask: true, 'layout-shift': true }, truncated: true }, 100, 200).complete).toBe(false);
  });
  it('unions nested timeline JS intervals per thread, without summing overlapping categories', () => {
    const events = [{ ph: 'M', pid: 1, tid: 2, name: 'thread_name', args: { name: 'CrRendererMain' } }, { ph: 'X', pid: 1, tid: 2, name: 'FunctionCall', ts: 0, dur: 10000 }, { ph: 'X', pid: 1, tid: 2, name: 'EvaluateScript', ts: 2000, dur: 3000 }, { ph: 'X', pid: 1, tid: 2, name: 'Layout', ts: 5000, dur: 2000 }, { ph: 'X', pid: 1, tid: 3, name: 'Paint', ts: 0, dur: 4000 }];
    const summary = summarizeTimeline(events);
    expect(summary.complete).toBe(true);
    expect(summary.threads[0]).toMatchObject({ name: 'CrRendererMain', categories: { JavaScript: { events: 2, union_ms: 10 }, Layout: { events: 1, union_ms: 2 }, Paint: null } });
    expect(summary.threads[1].categories.Paint.union_ms).toBe(4);
  });
  it('flags missing and truncated traces', () => {
    expect(summarizeTimeline([]).complete).toBe(false);
    expect(summarizeTimeline([{ ph: 'X', pid: 1, tid: 1, name: 'Unrelated', ts: 0, dur: 1000 }]).complete).toBe(false);
    expect(summarizeTimeline([{ ph: 'B', name: 'Layout', ts: 100 }]).complete).toBe(false);
    expect(summarizeTimeline([{ ph: 'X', pid: 1, tid: 1, name: 'Paint', ts: 0, dur: 1000 }], { truncated: true }).complete).toBe(false);
  });
});
