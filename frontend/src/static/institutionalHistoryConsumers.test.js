import { describe, expect, it } from 'vitest';
import { institutionalGrowth } from './institutionalEvidence';
import { assess, rankCandidates, researchCsv } from './researchEngine';
import { researchListRow, encodeResearchIndex, decodeResearchIndex } from './researchTransport';
import { withAuditFixture } from './testAuditFixture';
import { withFinancialProof } from './testFinancialFixture';
import { nativeAnnualFixture } from '../test/fixtures/nativeAnnual';
import { holderEvidence, holderSymbol, holderAsOf, invalidHolderCases, holderArguments, holderPeriodPair } from '../../tools/fixtures/institutional-history.mjs';

const unknown = { increasing: null, delta: null };
const institutionRule = row => assess(row, 'oneil').rules.find(rule => rule.label.startsWith('I：13F'));
const rowFor = evidence => withAuditFixture({ symbol: holderSymbol, market: 'US', current_price: 100, adv_usd: 5e7, institutional_evidence: evidence, institutional_sponsors_increasing: true }, holderAsOf);

describe('13F rejection survives list transport and real assessment consumers', () => {
  it.each(invalidHolderCases())('$name', entry => {
    const [, symbol, asOf] = holderArguments(entry);
    const row = { ...rowFor(entry.data), symbol, technical_audit: { as_of_date: asOf } };
    const list = researchListRow(row);
    const decoded = decodeResearchIndex(JSON.parse(JSON.stringify(encodeResearchIndex({ as_of_date: asOf, rows: [list] })))).rows[0];
    for (const input of [row, list, decoded]) {
      expect(institutionalGrowth(input.institutional_evidence, input.symbol, asOf)).toMatchObject(unknown);
      expect(institutionRule(input)).toMatchObject({ state: 'unknown', value: null });
    }
  });
  it.each([[110, 'pass'], [100, 'fail'], [90, 'fail']])('retains valid counts through list and wire: %s', (count, state) => {
    const evidence = holderEvidence(); evidence.observations[1].manager_count = count;
    const raw = rowFor(evidence), list = researchListRow(raw);
    const decoded = decodeResearchIndex(JSON.parse(JSON.stringify(encodeResearchIndex({ as_of_date: holderAsOf, rows: [list] })))).rows[0];
    expect(institutionRule(raw).state).toBe(state);
    expect(institutionRule(list)).toEqual(institutionRule(raw));
    expect(institutionRule(decoded)).toEqual(institutionRule(raw));
  });
  it('ranks valid and unknown evidence separately and exports their parsed states and counts', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    const completeRow = (symbol, evidence) => {
      // Existing synthetic financial proofs isolate the I rule; no financial
      // capture, admission or rule implementation is changed by this test.
      const history = nativeAnnualFixture();
      history.symbol = symbol; history.as_of_date = holderAsOf; history.annual_source.symbol = symbol;
      history.retrieved_at = history.annual_source.observed_at = new Date(now - 3600000).toISOString();
      return withFinancialProof(withAuditFixture({
        symbol, market: 'US', current_price: 100, se_pivot_price: 99, adv_usd: 5e7, rs_rating: 95,
        eps_growth_yy: 30, sales_growth_yy: 30, financial_history: history,
        market_above_50dma: true, market_above_200dma: true,
        institutional_evidence: { ...evidence, symbol }, institutional_sponsors_increasing: true,
      }, holderAsOf), now, holderAsOf);
    };
    const missing = holderEvidence(); missing.observations[0] = null;
    const unchanged = holderEvidence(); unchanged.observations[1].manager_count = 100;
    const raw = [completeRow('A_UNKNOWN', missing), completeRow('C_UNCHANGED', unchanged),
      completeRow('Z_VALID', holderEvidence()),
      completeRow('B_NONQUARTER', holderPeriodPair('2026-03-30', '2026-06-29').data)];
    const original = structuredClone(raw), list = raw.map(researchListRow);
    const wire = decodeResearchIndex(JSON.parse(JSON.stringify(encodeResearchIndex({ as_of_date: holderAsOf, rows: list })))).rows;
    const expected = [
      ['Z_VALID', 'pass', 8, 0, 0, 10], ['A_UNKNOWN', 'unknown', 7, 0, 1, null],
      ['B_NONQUARTER', 'unknown', 7, 0, 1, null], ['C_UNCHANGED', 'fail', 7, 1, 0, 0],
    ];
    const label = 'I：13F報告運用会社の保有社数が増加';
    for (const rows of [raw, list, wire]) for (const input of [rows, [...rows].reverse()]) {
      const ranked = rankCandidates(input, 'oneil', { now });
      expect(ranked.map(item => item.row.symbol)).toEqual(expected.map(([symbol]) => symbol));
      expect(rankCandidates(input, 'oneil', { now, qualifiedOnly: true }).map(item => item.row.symbol)).toEqual(['Z_VALID']);
      for (const [index, [, state, passed, failed, unknown, delta]] of expected.entries()) {
        const row = ranked[index].row;
        expect(assess(row, 'oneil', now)).toMatchObject({ passed, failed, unknown, total: 8, qualified: state === 'pass' });
        expect(assess(row, 'oneil', now).rules.find(rule => rule.label === label)).toMatchObject({ state, value: state === 'unknown' ? null : state === 'pass' });
        expect(institutionalGrowth(row.institutional_evidence, row.symbol, holderAsOf).delta).toBe(delta);
      }
      // Parse quoted fields (including escaped quotes), then assert actual
      // exported outcome values. The CSV has no raw 13F delta/count column.
      const [header, ...lines] = researchCsv(ranked, 'oneil', holderAsOf, now).split('\r\n')
        .map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"')));
      const records = lines.map(values => Object.fromEntries(header.map((name, index) => [name, values[index]])));
      expect(records).toHaveLength(expected.length);
      expect(records.map(record => record.symbol)).toEqual(expected.map(([symbol]) => symbol));
      expected.forEach(([symbol, state, passed, failed, unknown], index) => {
        expect(records[index]).toMatchObject({ symbol, as_of_date: holderAsOf, method: 'oneil',
          qualified: String(state === 'pass'), passed: String(passed), total: '8', unknown: String(unknown),
          failed_count: String(failed), unknown_count: String(unknown), method_status: state,
          failed_rules: failed ? label : '', unknown_rules: unknown ? label : '',
          daily_price: '100', annual_eps_rule_state: 'pass' });
      });
    }
    expect(raw).toEqual(original);
  });
});
