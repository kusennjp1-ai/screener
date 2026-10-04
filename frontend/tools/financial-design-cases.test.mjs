// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FINANCIAL_DESIGN_CASES, financialDesignScreens, financialCaseSource, parseFinancialCsv } from './financial-design-cases.mjs';
import { withFinancialProof } from '../src/static/testFinancialFixture.js';
import { nativeAnnualFixture } from '../src/test/fixtures/nativeAnnual.js';

// Synthetic contract tests only. The browser harness has no fixture input or
// fallback and reads the candidate build's published immutable static assets.
const now = Date.parse('2026-10-04T15:00:00Z'), date = '2026-10-02';
const item = symbol => FINANCIAL_DESIGN_CASES.find(value => value.symbol === symbol);
const row = (symbol, values = [1, 2, 4, 8]) => withFinancialProof({ symbol, market: 'US', as_of_date: date,
  eps_growth_yy: 30, sales_growth_yy: 30,
  financial_history: { symbol, as_of_date: date, status: 'available', basis: 'reported_diluted_eps', currency: 'USD',
    source: 'Synthetic test provider', retrieved_at: '2026-10-04T11:00:00.000Z',
    annual: values.map((eps, index) => ({ end: `${2022 + index}-12-31`, eps })), quarterly: [] },
}, now, date);
const native = () => {
  const value = row('FUTU');
  value.financial_history = nativeAnnualFixture('HKD');
  value.financial_history.symbol = value.financial_history.annual_source.symbol = 'FUTU';
  return value;
};
const nonpositive = () => {
  const value = row('AAOI', [-2, -1, -4, -0.5]);
  value.eps_growth_yy = null;
  value.financial_current.r = '2f202222b222bbbb';
  value.financial_current.p[1] = [-75, '1', 'Diluted EPS', ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'], now - 3600000, now + 6 * 86400000, 'w', 'r'];
  return value;
};

describe('bounded financial Design capture contract', () => {
  it('requires exactly 16 purpose captures across desktop dark and mobile light', () => {
    const captures = [1440, 390].flatMap(width => ['dark', 'light'].flatMap(theme => financialDesignScreens({ width }, theme).map(screen => `${screen}/${width}/${theme}`)));
    expect(captures).toHaveLength(16);
    expect(new Set(captures).size).toBe(16);
    expect(captures.every(key => key.endsWith('/1440/dark') || key.endsWith('/390/light'))).toBe(true);
    expect(financialDesignScreens({ width: 800 }, 'dark')).toEqual([]);
    for (const symbol of ['NVDA', 'FUTU', 'AAOI', 'ALH']) expect(captures.filter(key => key.includes(`financial-${symbol}-evidence/`))).toHaveLength(2);
    for (const view of ['history', 'selection', 'purchase']) expect(captures.some(key => key.includes(`-${view}/`))).toBe(true);
  });

  it('keeps new captures in the ordinary screenshot and subjective-review accounting', () => {
    const harness = readFileSync(new URL('./design-review.mjs', import.meta.url), 'utf8');
    const checker = readFileSync(new URL('./check-design-review.mjs', import.meta.url), 'utf8');
    expect(harness).toContain('await verifyFinancialCases({ page, viewport, theme, capture, check, report, currentUrl: current.url });');
    expect(harness).toContain('...financialDesignScreens(viewport, theme)');
    expect(harness).toContain('report.screens.push({ key, screenshot,');
    expect(harness).toContain("metrics_scope: 'original-viewport'");
    expect(checker).toContain('actual.screens.some(screen => !reviewedKeys.has(screen.key))');
  });
});

describe('named financial source categories fail closed', () => {
  it('accepts source-backed ordinary USD and rejects unavailable sales or wrong identity', () => {
    expect(financialCaseSource(row('NVDA'), item('NVDA'), date, now)).toMatchObject({ currency: 'USD', numeric_annual_periods: 4, annual_complete: true });
    const missingSales = row('NVDA'); delete missingSales.sales_growth_yy;
    expect(() => financialCaseSource(missingSales, item('NVDA'), date, now)).toThrow('ordinary current USD');
    expect(() => financialCaseSource(row('OTHER'), item('NVDA'), date, now)).toThrow('identity/date mismatch');
  });

  it('requires the explicit native currency receipt and a current complete annual series', () => {
    expect(financialCaseSource(native(), item('FUTU'), date, now)).toMatchObject({ currency: 'HKD', annual_complete: true });
    for (const mutate of [value => { delete value.financial_history.annual_source.receipt_sha256; },
      value => { value.financial_history.currency = 'USD'; },
      value => { value.financial_history.annual[0].eps = null; }]) {
      const value = native(); mutate(value);
      expect(() => financialCaseSource(value, item('FUTU'), date, now)).toThrow();
    }
    expect(() => financialCaseSource(native(), item('FUTU'), date, now + 4 * 86400000)).toThrow('unavailable or expired');
  });

  it('requires certified nonpositive comparison evidence and keeps ordinary growth withheld', () => {
    expect(financialCaseSource(nonpositive(), item('AAOI'), date, now).quarterly_eps).toMatchObject({ reason: 'nonpositive_comparison_base', value: null, reference_value: -75 });
    expect(() => financialCaseSource(row('AAOI', [-2, -1, -4, -0.5]), item('AAOI'), date, now)).toThrow('nonpositive quarterly and annual');
    const forged = nonpositive(); delete forged.financial_current;
    expect(() => financialCaseSource(forged, item('AAOI'), date, now)).toThrow('nonpositive quarterly and annual');
    const ordinaryAnnual = nonpositive(); ordinaryAnnual.financial_history.annual = row('AAOI').financial_history.annual;
    expect(() => financialCaseSource(ordinaryAnnual, item('AAOI'), date, now)).toThrow('nonpositive quarterly and annual');
  });

  it('distinguishes real short numeric history from no data, full history or expired sources', () => {
    expect(financialCaseSource(row('ALH', [null, null, null, 0.56]), item('ALH'), date, now)).toMatchObject({ numeric_annual_periods: 1, annual_complete: null, annual_growth: null });
    for (const values of [[null, null, null, null], [1, 2, 4, 8]]) expect(() => financialCaseSource(row('ALH', values), item('ALH'), date, now)).toThrow('insufficient numeric annual');
    const oldPeriod = row('ALH', [0.56]);
    expect(() => financialCaseSource(oldPeriod, item('ALH'), date, now)).toThrow('insufficient numeric annual');
    expect(() => financialCaseSource(row('ALH', [null, null, null, 0.56]), item('ALH'), date, now + 4 * 86400000)).toThrow('unavailable or expired');
  });
});

describe('downloaded CSV evidence', () => {
  it('preserves the browser BOM, quoted labels, native units, empty values and multiline reasons', () => {
    const parsed = parseFinancialCsv('\uFEFF"symbol","annual_eps_reporting_currency","annual_eps_rule_evidence","unknown"\r\n"FUTU","HKD","source, \"\"reported\"\"\n取得 2026-10-04",""\r\n');
    expect(parsed.headers[0]).toBe('symbol');
    expect(parsed.rows).toEqual([{ symbol: 'FUTU', annual_eps_reporting_currency: 'HKD', annual_eps_rule_evidence: 'source, "reported"\n取得 2026-10-04', unknown: '' }]);
  });
  it('rejects incomplete downloads and ambiguous column layouts', () => {
    for (const text of ['"symbol"\r\n"FUTU', '"symbol","symbol"\r\n"FUTU","FUTU"', '"symbol","value"\r\n"FUTU"']) expect(() => parseFinancialCsv(text)).toThrow();
  });
});
