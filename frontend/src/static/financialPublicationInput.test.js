import { describe, expect, it } from 'vitest';
import { captureFinancialPublicationInput } from './financialPublicationInput.js';
import { financialPublicationException } from './financialPublicationException.js';
import { projectFinancialRow, mergeFinancialDetail } from './financialCurrent.js';
import { withFinancialProof } from './testFinancialFixture.js';
import { researchListRow } from './researchTransport.js';

const capturedAt = Date.parse('2026-10-04T12:00:00Z'), now = Date.parse('2026-10-20T14:00:00Z'), date = '2026-10-16';
const json = value => JSON.parse(JSON.stringify(value));
const source = (time = now) => {
  const value = withFinancialProof({ symbol: 'NVDA', market: 'US', as_of_date: date,
    company_name: 'Synthetic NVDA', eps_growth_yy: 30, eps_growth_annual: 30, sales_growth_yy: 40 }, capturedAt, date);
  return { ...value, financial_generation: 'a'.repeat(64), financial_evaluated_at: time,
    financial_knowledge_basis: 'current_observation_at_source_capture', financial_point_in_time: false,
    financial_source_publication_date: null, financial_policy_version: 'financial-correction-native-annual-v1',
    financial_historical: { values: { eps_growth_yy: 999, sales_growth_yy: 999 } } };
};
const seal = value => ({ ...value, financial_publication_input: captureFinancialPublicationInput(value) });
const project = value => json(projectFinancialRow(value, { now, asOfDate: date }));
const exception = value => financialPublicationException(value, { now, date });

describe('first current-input audit for the five publication exclusions', () => {
  it('survives copies without restoring stale current values or trusting historical scalars', () => {
    const raw = seal(source()), initial = json(raw), current = project(raw);
    expect(exception(current)).toMatchObject({ status: 'excluded_unknown', qualified: false, satisfies_fresh_category: false });
    expect(current.eps_growth_yy).toBeNull(); expect(current.sales_growth_yy).toBeNull();
    expect(current.financial_historical.values.eps_growth_yy).toBe(999);
    expect(current.financial_current).toEqual(raw.financial_current);
    expect(raw).toEqual(initial);
    const legacy = { ...current }; delete legacy.financial_publication_input;
    expect(exception(legacy)).toBeNull(); // Missing audit never backfills old values.
  });

  it.each([false, true, '30', '', {}, []])('rejects original malformed current input %j after destructive projection', value => {
    const raw = source(); raw.eps_growth_yy = value; raw.eps_growth_annual = value;
    // Missing/invalid reason 1 does not certify absence for a supplied value.
    raw.financial_current.r = raw.financial_current.r.slice(0, 1) + '1' + raw.financial_current.r.slice(2);
    delete raw.financial_current.p['1'];
    expect(exception(project(seal(raw)))).toBeNull();
  });

  it('distinguishes actual current null ownership from a nonempty predecessor and invalid ordinary proof', () => {
    const raw = source(); raw.eps_growth_yy = null; raw.eps_growth_annual = null;
    expect(exception(project(seal(raw)))).toBeNull(); // r0 + null is contradictory.
    raw.financial_current.r = raw.financial_current.r.slice(0, 1) + '1' + raw.financial_current.r.slice(2);
    delete raw.financial_current.p['1'];
    expect(exception(project(seal(raw)))).toMatchObject({ status: 'excluded_unknown' });
    expect(raw.financial_historical.values.eps_growth_yy).toBe(999);
  });

  it('rejects an original alias conflict rather than reconstructing it from two canonical scalars', () => {
    const raw = source(); raw.eps_growth_annual = 99;
    expect(exception(project(seal(raw)))).toBeNull();
  });

  it.each(['g', '0'])('rejects an invalid comparison-only proof %s even after its normal rejection rewrite', comparison => {
    const raw = source(); raw.financial_current.r = raw.financial_current.r.slice(0, 1) + 'f' + raw.financial_current.r.slice(2);
    raw.financial_current.p['1'][6] = comparison;
    expect(exception(project(seal(raw)))).toBeNull();
  });

  it('never admits a future source-expiry rewrite at the current clock', () => {
    const raw = source(); raw.financial_current = withFinancialProof(raw, now, date).financial_current;
    raw.financial_current.r = raw.financial_current.r.slice(0, 1) + 'f' + raw.financial_current.r.slice(2);
    raw.financial_current.p['1'][6] = 'l';
    const current = project(seal(raw));
    expect(current.financial_current.r[1]).toBe('f');
    expect(exception(current)).toMatchObject({ status: 'excluded_unknown' });
    current.financial_current.r = current.financial_current.r.slice(0, 1) + '7' + current.financial_current.r.slice(2);
    delete current.financial_current.p['1'];
    expect(exception(current)).toBeNull();
  });

  it('rejects mutation of scalar, alias, identity, proof, generation, scope, or audit itself', () => {
    const good = project(seal(source()));
    const changes = [
      row => { row.eps_growth_yy = false; }, row => { row.eps_growth_annual = 99; },
      row => { row.company_name = 'Other issuer'; }, row => { row.symbol = 'FUTU'; },
      row => { row.market = 'HK'; }, row => { row.as_of_date = '2026-10-15'; },
      row => { row.financial_current.p['1'][4] += 1; }, row => { row.financial_current.t += 1; },
      row => { row.financial_generation = 'b'.repeat(64); }, row => { row.financial_evaluated_at -= 1; },
      row => { row.financial_policy_version = 'other'; }, row => { row.financial_point_in_time = true; },
      row => { row.financial_identity = { observed_scope: { symbol: 'FUTU', market: 'US', as_of_date: date } }; },
      row => { row.financial_publication_input.slots.eps_growth_yy.value = false; },
      row => { row.financial_publication_input.extra = true; }, row => { row.financial_publication_input = null; },
    ];
    for (const change of changes) { const changed = json(good); change(changed); expect(exception(changed)).toBeNull(); }
  });

  it('does not use an original valid scalar to certify a missing fresh current scalar', () => {
    const raw = source();
    raw.financial_current = withFinancialProof(raw, now, date).financial_current;
    const current = seal(raw);
    expect(projectFinancialRow(raw, { now, asOfDate: date }).financial_current_state.fields.eps_growth_yy.source_validated).toBe(true);
    current.eps_growth_yy = null; current.eps_growth_annual = null;
    expect(exception(current)).toBeNull();
  });

  it('keeps malformed history disallowed even with a valid expired current audit', () => {
    const current = project(seal(source()));
    current.financial_history = { symbol: 'NVDA', as_of_date: date, status: 'unavailable', basis: 'reported_diluted_eps',
      currency: 'HKD', source: null, retrieved_at: null, annual: [{ end: '2025-12-31', eps: false }], quarterly: [] };
    expect(exception(current)).toBeNull();
  });

  it('gives current summary ownership to the audit and never borrows an older detail audit', () => {
    const detail = project(seal(source())), summary = { ...detail };
    delete summary.financial_publication_input;
    const merged = mergeFinancialDetail(summary, detail, { now, asOfDate: date, generation: summary.financial_generation });
    expect(merged).not.toHaveProperty('financial_publication_input'); expect(exception(merged)).toBeNull();
  });

  it('does not mint or transport this input for another symbol or market', () => {
    for (const scope of [{ symbol: 'OTHER' }, { market: 'HK' }]) {
      const row = { ...source(), ...scope };
      expect(captureFinancialPublicationInput(row)).toBeUndefined();
      expect(researchListRow({ ...row, financial_publication_input: {} })).not.toHaveProperty('financial_publication_input');
    }
  });
});
