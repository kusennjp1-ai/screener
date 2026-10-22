// Synthetic regression cases. The current CI's derived AVT bytes are not retained locally.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { projectFinancialRow } from '../src/static/financialCurrent.js';
import { FINANCIAL_PUBLICATION_EXCEPTION } from '../src/static/financialPublicationException.js';
import { assess, rankCandidates, researchCsv } from '../src/static/researchEngine.js';
import { encodeResearchIndex, decodeResearchIndex, researchListRow, RESEARCH_METHODS } from '../src/static/researchTransport.js';
import { buildPortfolioPlan } from '../src/static/portfolioPlan.js';
import { withAuditFixture } from '../src/static/testAuditFixture.js';
import { withFinancialProof } from '../src/static/testFinancialFixture.js';
import { validateResearchParity } from './research-quality.mjs';

const date = '2026-10-02', now = Date.parse('2026-10-04T15:00:00Z');
const symbols = FINANCIAL_PUBLICATION_EXCEPTION.symbols;
const json = value => JSON.parse(JSON.stringify(value));
const source = symbol => withFinancialProof(withAuditFixture({ symbol, market: 'US', currency: 'USD',
  current_price: 101, se_pivot_price: 100, rs_rating: 95, composite_rating: 95, eps_rating: 90,
  ibd_group_rank: 10, eps_growth_yy: 30, sales_growth_yy: 40, adv_usd: 50000000,
  market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true }, date), now, date);
const history = symbol => ({ symbol, as_of_date: date, status: 'available', basis: 'reported_diluted_eps',
  currency: 'USD', source: 'Synthetic parity regression source', retrieved_at: '2026-10-04T11:00:00Z',
  annual: [1, 2, 4, 8].map((eps, index) => ({ end: `${2022 + index}-12-31`, eps, revenue: eps * 100 })),
  quarterly: [{ end: '2026-03-31', eps: 2 }, { end: '2026-06-30', eps: 3 }] });
const canonical = input => json(projectFinancialRow(input, { now, asOfDate: date }));
function compare(details, clock = now) {
  const wire = json(encodeResearchIndex({ as_of_date: date, rows: details }));
  const rows = decodeResearchIndex(wire).rows;
  // Keep the production comparator intact, including CSV, worker rankings and allocation.
  expect(() => validateResearchParity(wire, details, clock)).not.toThrow();
  for (const [index, row] of rows.entries()) for (const method of RESEARCH_METHODS) {
    expect(assess(row, method, clock)).toEqual(assess(details[index], method, clock));
    expect(researchCsv([{ row }], method, date, clock)).toBe(researchCsv([{ row: details[index] }], method, date, clock));
  }
  return rows;
}

describe('five-symbol financial decisions through canonical detail and compact list', () => {
  it.each(['missing', 'expired', 'incomplete'])('keeps %s evidence unknown, labeled and excluded on both paths', kind => {
    const details = symbols.map(symbol => {
      const input = source(symbol);
      if (kind !== 'missing') {
        input.financial_history = history(symbol);
        if (kind === 'expired') input.financial_history.retrieved_at = '2026-09-30T11:00:00Z';
        else input.financial_history.annual.at(-1).eps = null;
      }
      return canonical(input);
    });
    const before = json(details), rows = compare(details);
    for (const row of [...details, ...rows]) for (const method of RESEARCH_METHODS) {
      expect(assess(row, method, now)).toMatchObject({ qualified: false,
        financial_exclusion: { symbol: row.symbol, label: '財務未確認・判定対象外', status: 'excluded_unknown', satisfies_fresh_category: false } });
    }
    for (const inputs of [details, rows]) {
      for (const method of RESEARCH_METHODS) expect(rankCandidates(inputs, method, { qualifiedOnly: true, now })).toEqual([]);
      const plan = buildPortfolioPlan(inputs, date, 100000, now);
      expect(plan.positions).toEqual([]); expect(plan.dailyPositions).toEqual([]);
      expect(plan.readiness.every(item => !item.ready)).toBe(true);
    }
    expect(details).toEqual(before);
  });

  it.each([12.87, 0, false, 'invalid'])('retains rejected original scalar %j after projection instead of granting an exception', value => {
    const details = symbols.map(symbol => {
      const input = source(symbol);
      input.eps_growth_yy = value; input.sales_growth_yy = value;
      const reasons = input.financial_current.r.split('');
      for (const index of [1, 3]) { reasons[index] = '1'; delete input.financial_current.p[index]; }
      input.financial_current.r = reasons.join('');
      return canonical(input);
    });
    for (const detail of details) {
      expect(detail.eps_growth_yy).toBeNull();
      expect(detail.financial_historical.values.eps_growth_yy).toBe(value);
      expect(assess(detail, 'minervini', now)).not.toHaveProperty('financial_exclusion');
    }
    const rows = compare(details);
    for (const row of rows) expect(assess(row, 'minervini', now)).not.toHaveProperty('financial_exclusion');
  });

  it.each(['nonempty unavailable', 'bad quarter date', 'bad quarter EPS', 'future quarter'])('retains the %s contradiction and refuses the exception on both paths', kind => {
    const details = symbols.map(symbol => {
      const input = source(symbol), data = history(symbol);
      data.retrieved_at = '2026-09-30T11:00:00Z';
      if (kind === 'nonempty unavailable') { data.status = 'unavailable'; data.annual = []; }
      if (kind === 'bad quarter date') data.quarterly[0].end = '2026-02-31';
      if (kind === 'bad quarter EPS') data.quarterly[0].eps = 'invalid';
      if (kind === 'future quarter') data.quarterly.at(-1).end = '2026-10-05';
      input.financial_history = data;
      return canonical(input);
    });
    for (const detail of details) expect(assess(detail, 'minervini', now)).not.toHaveProperty('financial_exclusion');
    compare(details);
  });

  it('keeps genuine fresh qualification and the inclusive 72-hour expiry unchanged', () => {
    const details = symbols.map(symbol => canonical({ ...source(symbol), financial_history: {
      ...history(symbol), retrieved_at: new Date(now - 72 * 3600000).toISOString() } }));
    const rows = compare(details);
    for (const row of [...details, ...rows]) {
      expect(assess(row, 'minervini', now)).toMatchObject({ qualified: true, passed: 9, total: 9 });
      expect(assess(row, 'minervini', now)).not.toHaveProperty('financial_exclusion');
      expect(assess(row, 'minervini', now + 1)).toMatchObject({ qualified: false,
        financial_exclusion: { reason: 'unavailable_or_expired_annual_history' } });
    }
    compare(details, now + 1);
    expect(details.every(row => row.financial_history.retrieved_at === new Date(now - 72 * 3600000).toISOString())).toBe(true);
  });

  it('keeps the pre-existing compact shape and decisions outside the exact five US identities', () => {
    const details = ['AAPL', 'OTHER', 'nvda', 'NVDA '].map(symbol => canonical({ ...source(symbol), financial_history: history(symbol) }));
    details.push(canonical({ ...source('NVDA'), market: 'HK', financial_history: history('NVDA') }));
    compare(details);
    for (const detail of details) {
      const row = researchListRow(detail);
      expect(row).not.toHaveProperty('financial_historical');
      if (row.financial_history) {
        expect(row.financial_history).not.toHaveProperty('quarterly');
        expect(row.financial_history.annual.every(point => !Object.hasOwn(point, 'revenue'))).toBe(true);
      }
      for (const method of RESEARCH_METHODS) expect(assess(row, method, now)).not.toHaveProperty('financial_exclusion');
    }
  });
});
