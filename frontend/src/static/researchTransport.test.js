import { describe, expect, it } from 'vitest';
import { encodeResearchIndex, decodeResearchIndex, researchListRow, RESEARCH_METHODS } from './researchTransport';
import { prepareResearchBundle } from './researchPreprocess';
import { assess, rankCandidates, researchCsv } from './researchEngine';
import { withAuditFixture } from './testAuditFixture';

const date = '2026-09-29';
const sample = extra => withAuditFixture({ symbol: 'TEST', market: 'US', currency: 'USD', current_price: 102, adv_usd: 25000000,
  rs_rating: 90, eps_rating: 80, composite_rating: 90, ibd_group_rank: 20, eps_growth_yy: 25, sales_growth_yy: 25,
  annual_eps_growth_3y: [25, 25, 25], se_pivot_price: 100, ...extra }, date);
const ordersFor = rows => Object.fromEntries(RESEARCH_METHODS.map(method => [method, rankCandidates(rows, method).map(({row}) => rows.indexOf(row))]));
const encode = rows => encodeResearchIndex({ as_of_date: date, rows }, ordersFor(rows));

describe('lossless compact research transport', () => {
  it('preserves absent, null, false, zero and exact floating point values', () => {
    const rows = [sample({ price_activity: { lowRange: false, range60pct: 0 }, eps_growth_yy: 24.999999999999996 }),
      { symbol: 'UNKNOWN', current_price: null, technical_audit: null, se_setup_ready: false },
      { symbol: 'ABSENT' }];
    const decoded = decodeResearchIndex(JSON.parse(JSON.stringify(encode(rows))));
    expect(decoded.rows).toEqual(rows.map(researchListRow));
    expect(Object.hasOwn(decoded.rows[2], 'technical_audit')).toBe(false);
  });
  it('keeps canonical threshold states, evidence, CSV and ordering unchanged at exact boundaries', () => {
    const rows = Array.from({ length: 36 }, (_, i) => {
      const row = sample({ symbol: `T${i}`, eps_growth_yy: 25 + (i % 3 - 1) * 1e-12, rs_rating: 70 + (i % 3 - 1) * 1e-12 });
      row.technical_audit.values.sma50 = row.current_price + (i % 3 - 1) * 1e-12;
      row.technical_audit.values.aboveLow = 30 + (i % 3 - 1) * 1e-12;
      row.chart_path = `verified-charts/${row.symbol}-0123456789abcdef.json`;
      row.research_detail_path = `research-details/${row.symbol}-fedcba9876543210.json`;
      return row;
    });
    const decoded = prepareResearchBundle([JSON.parse(JSON.stringify(encode(rows)))], date);
    for (const method of RESEARCH_METHODS) {
      expect(decoded.rankings[method].map(({row}) => row.symbol)).toEqual(rankCandidates(rows, method).map(({row}) => row.symbol));
      expect(researchCsv(decoded.rankings[method], method, date)).toBe(researchCsv(rankCandidates(rows, method), method, date));
      rows.forEach((row, i) => expect(assess(decoded.rows[i], method)).toEqual(assess(row, method)));
    }
    expect(decoded.rows[0].chart_path).toBe(rows[0].chart_path);
    expect(decoded.rows[0].research_detail_path).toBe(rows[0].research_detail_path);
  });
  it('retains publication dates needed to reject unpublished institutional information', () => {
    const row = sample({ institutional_evidence: { symbol: 'TEST', status: 'available', unit: '13f_reporting_manager_cik', publication_cutoff: '2026-10-01',
      observations: [{ period: '2026-03-31', manager_count: 100, filing_date_first: '2026-05-01', filing_date_last: '2026-05-15' }, { period: '2026-06-30', manager_count: 110, filing_date_first: '2026-08-01', filing_date_last: '2026-08-15' }],
      source: 'Detail-only source', refresh: { notes: 'Detail only' } } });
    const compact = decodeResearchIndex(encode([row])).rows[0];
    expect(assess(compact, 'oneil')).toEqual(assess(row, 'oneil'));
    expect(assess(compact, 'oneil').rules.find(rule => rule.label.startsWith('I：')).state).toBe('unknown');
    expect(compact.institutional_evidence.source).toBeUndefined();
  });
  it('rejects damaged columns, foreign paths, invalid ranking and mixed dates', () => {
    const packed = encode([sample()]);
    const wrongColumn = structuredClone(packed); wrongColumn.columns[0] = { copy: 100, patch: [] };
    expect(() => decodeResearchIndex(wrongColumn)).toThrow();
    const wrongPath = structuredClone(packed); wrongPath.fields[0] = ['__proto__', 'bad'];
    expect(() => decodeResearchIndex(wrongPath)).toThrow();
    expect(() => prepareResearchBundle([{ ...packed, orders: { ...packed.orders, minervini: [0, 0] } }], date)).toThrow('Invalid published ranking');
    expect(() => prepareResearchBundle([packed], '2026-09-28')).toThrow('Snapshot date mismatch');
  });
  it('recalculates rankings and portfolio input after an explicit verification invalidates a row', () => {
    const row = sample();
    const loaded = prepareResearchBundle([encode([row])], date);
    const updated = { ...loaded.rows[0], method_summary: undefined, technical_audit: { valid: false, as_of_date: date, errors: ['再検証に失敗'] } };
    const next = prepareResearchBundle([{ rows: [updated], as_of_date: date }], date);
    expect(next.rankings.minervini[0].assessment.qualified).toBe(false);
    expect(next.prepared.candidates).toEqual([]);
    expect(next.rankings.minervini[0].row).toBe(next.rows[0]);
  });
});
