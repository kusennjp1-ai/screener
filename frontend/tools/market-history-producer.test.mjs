import { describe, expect, it } from 'vitest';
import { buildInstitutionalMarketSnapshot } from './market-history-producer.mjs';
import { marketIndicatorHistory } from '../src/static/marketIndicatorHistory.js';
import { institutionalSourceFixture } from './fixtures/market-history-source.mjs';

const build = change => { const fixture = institutionalSourceFixture(); change?.(fixture); return buildInstitutionalMarketSnapshot(fixture); };
const inspect = snapshot => marketIndicatorHistory(snapshot.history, { market: snapshot.market, asOfDate: snapshot.as_of_date, now: institutionalSourceFixture().now });
const points = snapshot => inspect(snapshot).series[0]?.points;
const rows = fixture => fixture.seed.securities['000000001'].observations;

describe('offline SEC aggregate → display history (synthetic sources only)', () => {
  it('preserves counts, original reporting periods, cutoff, sources and exact raw acquisition times', () => {
    const fixture = institutionalSourceFixture(), original = structuredClone(fixture);
    const snapshot = buildInstitutionalMarketSnapshot(fixture);
    expect(points(snapshot)).toMatchObject([{ date: '2026-03-31', value: 10 }, { date: '2026-06-30', value: 12 }]);
    expect(inspect(snapshot).series[0]).toMatchObject({ metric: 'institutional_holders', approximate: true, frequency: 'quarterly', delta: 2, historical: true });
    expect(snapshot.history.series[0].population).toContain('集計期限 2026-08-31');
    expect(snapshot.history.series[0].population).toContain('未完了の運用会社・期 2件');
    expect(snapshot.provenance).toMatchObject({ input_files: fixture.inputHashes, sec: { retrieved_at: fixture.seed.retrieved_at, publication_cutoff: '2026-08-31' }, mappings: [{ retrieved_at: fixture.mapping['000000001'].retrieved_at, cusip: '000000001' }] });
    expect(points(snapshot).map(point => point.collected_at)).toEqual(['2026-09-28T14:05:00.123Z', '2026-09-28T14:05:00.123Z']);
    expect(fixture).toEqual(original);
    expect(buildInstitutionalMarketSnapshot({ ...fixture, now: fixture.now + 86400000 })).toEqual(snapshot);
  });
  it('uses the later SEC time when mapping is older and never stamps the analysis or build date', () => {
    const snapshot = build(f => { f.mapping['000000001'].retrieved_at = '2026-08-01T00:00:00Z'; });
    expect(points(snapshot)[0].collected_at).toBe('2026-09-28T13:52:04.064Z');
    expect(snapshot.provenance.mappings[0].retrieved_at).toBe('2026-08-01T00:00:00Z');
  });
  it.each([null, undefined, '', '0', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('keeps non-observed or invalid count %s unknown', value => {
    const snapshot = build(f => { rows(f)[1].manager_count = value; });
    expect(points(snapshot)[1].value).toBeNull();
    expect(inspect(snapshot).series[0].delta).toBeNull();
    expect(snapshot.provenance.reported_observations[0].observations[1]).toMatchObject({ manager_count: null, count_state: 'unknown' });
  });
  it.each([[10, 0], [8, -2]])('keeps measured count %s and delta %s', (value, delta) => {
    const snapshot = build(f => { rows(f)[1].manager_count = value; });
    expect(inspect(snapshot).series[0].delta).toBe(delta);
  });
  it.each([[99, 99], [100, 100], [101, null], [Number.MAX_SAFE_INTEGER, null]])('bounds manager count %s by the saved selected-report total', (value, expected) => {
    const snapshot = build(f => { f.seed.reports_selected = 100; rows(f)[1].manager_count = value; });
    expect(points(snapshot)[1].value).toBe(expected);
    expect(inspect(snapshot).series[0].delta).toBe(expected === null ? null : expected - 10);
    expect(snapshot.provenance.reported_observations[0].observations[1]).toMatchObject({
      manager_count: expected, count_state: expected === null ? 'unknown' : 'reported_aggregate',
    });
    expect(snapshot.provenance.sec.reports_selected).toBe(100);
    expect(points(snapshot)[1]).toMatchObject({ date: '2026-06-30', collected_at: '2026-09-28T14:05:00.123Z' });
  });
  it('keeps an impossible earlier count unknown without manufacturing an increase', () => {
    const snapshot = build(f => { rows(f)[0].manager_count = 101; });
    expect(points(snapshot).map(point => point.value)).toEqual([null, 12]);
    expect(inspect(snapshot).series[0].delta).toBeNull();
    expect(snapshot.provenance.reported_observations[0].observations[0]).toMatchObject({ manager_count: null, count_state: 'unknown' });
  });
  it.each([
    ['absent optional list', 50, undefined, 50],
    ['50 managers from one report', 50, ['accession-a'], null],
    ['at report-list bound', 2, ['accession-a', 'accession-b'], 2],
    ['below report-list bound', 1, ['accession-a', 'accession-b'], 1],
    ['duplicate IDs', 2, ['accession-a', 'accession-a'], null],
    ['empty list', 1, [], null],
    ['null list', 1, null, null],
    ['string list', 1, 'accession-a', null],
    ['blank ID', 1, ['  '], null],
    ['non-string ID', 1, [123], null],
    ['sparse list', 1, Array(1), null],
  ])('validates provided filings: %s', (_label, count, filings, expected) => {
    const snapshot = build(f => {
      rows(f)[1].manager_count = count;
      if (filings !== undefined) rows(f)[1].filings = filings;
    });
    expect(points(snapshot)[1].value).toBe(expected);
    expect(snapshot.provenance.reported_observations[0].observations[1]).toMatchObject({
      manager_count: expected, count_state: expected === null ? 'unknown' : 'reported_aggregate',
    });
    expect(inspect(snapshot).series[0].delta).toBe(expected === null ? null : expected - 10);
  });
  it('requires the global bound even when an optional filing list is long enough', () => {
    const snapshot = build(f => {
      f.seed.reports_selected = 1;
      rows(f)[1].manager_count = 2;
      rows(f)[1].filings = ['accession-a', 'accession-b'];
    });
    expect(points(snapshot)[1].value).toBeNull();
    expect(inspect(snapshot).series[0].delta).toBeNull();
  });
  it('keeps an impossible filing-list size unknown even when the count fits both bounds', () => {
    const snapshot = build(f => {
      f.seed.reports_selected = 1;
      rows(f)[1].manager_count = 1;
      rows(f)[1].filings = ['accession-a', 'accession-b'];
    });
    expect(points(snapshot)[1].value).toBeNull();
    expect(snapshot.provenance.reported_observations[0].observations[1]).toMatchObject({ manager_count: null, count_state: 'unknown' });
  });
  it('keeps a missing quarter absent, without a zero or invented daily observation', () => {
    const snapshot = build(f => { rows(f).pop(); });
    expect(points(snapshot)).toHaveLength(1);
    expect(points(snapshot)[0]).toMatchObject({ date: '2026-03-31', value: 10 });
    expect(inspect(snapshot).series[0].delta).toBeNull();
  });
  it('does not make a retained old quarter current or apply trading freshness to historical display', () => {
    const snapshot = build(f => { f.asOfDate = '2027-02-01'; f.now = Date.parse('2027-02-02T12:00:00Z'); });
    expect(snapshot.history.series[0].observations.at(-1).date).toBe('2026-06-30');
    expect(snapshot.history.series[0].observations.at(-1).collected_at).toBe('2026-09-28T14:05:00.123Z');
  });
  it.each(['2026-02-30T00:00:00Z', '2026-09-28T24:00:00Z', '2026-09-28T12:00:60Z', '2026-09-28', '2026-10-11T12:00:00.000001Z', '2026-10-12T00:00:00Z', ''])('refuses invalid or future SEC acquisition %s', time => {
    expect(() => build(f => { f.seed.retrieved_at = time; })).toThrow(/acquisition/);
  });
  it.each(['2026-02-30T00:00:00Z', '2026-09-28T24:00:00Z', '2026-10-11T12:00:00.000001Z', ''])('leaves invalid mapping acquisition %s unavailable', time => {
    const snapshot = build(f => { f.mapping['000000001'].retrieved_at = time; });
    expect(snapshot.history.series).toEqual([]);
    expect(snapshot.provenance.selection.unavailable).toHaveLength(1);
  });
  it.each([
    ['future analysis', f => { f.asOfDate = '2026-10-12'; }],
    ['cutoff after analysis', f => { f.seed.publication_cutoff = '2026-10-10'; }],
    ['cutoff after acquisition', f => { f.seed.retrieved_at = '2026-08-30T00:00:00Z'; }],
    ['missing source hash', f => { delete f.inputHashes.seed_sha256; }],
    ['unknown coverage', f => { delete f.seed.incomplete_manager_periods; }],
    ['duplicate reporting period', f => { f.seed.periods[1] = f.seed.periods[0]; }],
    ['non-quarter-end', f => { f.seed.periods[1] = '2026-06-29'; }],
    ['missing archives', f => { f.seed.archives = []; }],
    ['duplicate archive name', f => { f.seed.archives.push({ ...f.seed.archives[0], sha256: 'd'.repeat(64) }); }],
    ['no symbols', f => { f.symbols = []; }],
    ['duplicated symbols', f => { f.symbols = ['AAA', 'AAA']; }],
  ])('rejects source-level %s before producing an artifact', (_label, change) => { expect(() => build(change)).toThrow(); });
  it.each([
    ['null observation', f => { rows(f)[0] = null; }],
    ['sparse observation', f => { delete rows(f)[0]; }],
    ['array-shaped observation', f => { rows(f)[0] = Object.assign([], rows(f)[0]); }],
    ['non-quarter end', f => { rows(f)[0].period = '2026-03-30'; }],
    ['duplicate period', f => { rows(f)[1] = { ...rows(f)[0] }; }],
    ['reversed periods', f => { rows(f).reverse(); }],
    ['undeclared quarter', f => { rows(f)[0].period = '2025-12-31'; }],
    ['filing before period', f => { rows(f)[0].filing_date_first = '2026-03-30'; }],
    ['filing after cutoff', f => { rows(f)[1].filing_date_last = '2026-09-01'; }],
    ['reversed filing range', f => { rows(f)[1].filing_date_first = '2026-08-16'; }],
  ])('excludes the whole security for %s', (_label, change) => {
    const snapshot = build(change);
    expect(snapshot.history.series).toEqual([]);
    expect(snapshot.provenance.selection).toMatchObject({ requested_symbols: ['AAA'], admitted_symbols: [], unavailable: [{ symbol: 'AAA' }] });
  });
  it('does not merge share classes or use a failed mapping as an old cached success', () => {
    const ambiguous = build(f => { f.seed.securities['000000002'] = structuredClone(f.seed.securities['000000001']); f.mapping['000000002'] = { ...f.mapping['000000001'] }; });
    expect(ambiguous.history.series).toEqual([]);
    expect(ambiguous.provenance.selection.unavailable[0].reason).toContain('複数CUSIP');
    const failed = build(f => { f.seed.mapping = structuredClone(f.mapping); f.mapping['000000001'].symbol = null; });
    expect(failed.history.series).toEqual([]);
  });
  it('keeps independent securities separate and records unmapped requests instead of aggregating a market count', () => {
    const snapshot = build(f => {
      f.seed.securities['000000002'] = structuredClone(f.seed.securities['000000001']);
      f.seed.securities['000000002'].observations[1].manager_count = 30;
      f.mapping['000000002'] = { ...f.mapping['000000001'], symbol: 'BBB' };
      f.symbols = ['ZZZ', 'BBB', 'AAA'];
    });
    expect(inspect(snapshot).series.map(s => [s.instrument, s.latest.value])).toEqual([['AAA', 12], ['BBB', 30]]);
    expect(snapshot.history.series.every(s => s.scope === 'security' && s.approximate)).toBe(true);
    expect(snapshot.provenance.selection.unavailable).toMatchObject([{ symbol: 'ZZZ' }]);
  });
});
