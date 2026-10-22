import { describe, expect, it } from 'vitest';
import { entryChecks, researchCsv } from './researchEngine.js';
import { canonicalPivot } from './researchPresentation.js';

const reason = 'SPY benchmark unavailable; benchmark-dependent setup and RS remain unknown';
const date = '2026-10-16';
const now = Date.parse('2026-10-17T07:00:00Z');
const unavailable = ready => ({
  symbol: 'OWNED', current_price: 101, se_pivot_price: null, vcp_pivot: null,
  se_setup_ready: ready,
  setup_recalculation: { status: 'unavailable', as_of_date: date, reason },
});
const csvRecord = row => {
  const lines = researchCsv([{ row }], 'minervini', date, now).split('\r\n');
  const cells = line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"'));
  return Object.fromEntries(cells(lines[0]).map((header, index) => [header, cells(lines[1])[index]]));
};

describe('unavailable detector readiness', () => {
  it.each([false, true, null, undefined])('prioritizes unavailable over a retained readiness flag %j', ready => {
    const row = unavailable(ready), before = structuredClone(row);
    expect(entryChecks(row)[2]).toMatchObject({ value: null, state: 'unknown', evidence: reason });
    expect(row).toEqual(before);
  });

  it('keeps the producer’s missing-benchmark reason in the screen explanation and CSV', () => {
    // clear_setup deliberately retains false as a safety flag; unavailable is
    // the authoritative statement that the detector could not measure readiness.
    const row = unavailable(false);
    expect(canonicalPivot(row)).toMatchObject({ price: null, reason: expect.stringContaining(reason) });
    expect(csvRecord(row)).toMatchObject({ setup_readiness_state: 'unknown', setup_readiness_reason: reason });
  });

  it.each([[true, 'pass'], [false, 'fail'], [null, 'unknown']])('preserves measured or missing readiness %j as %s', (ready, state) => {
    for (const calculation of [undefined, { status: 'calculated', reason: 'Production detector report available' }]) {
      const row = { symbol: 'MEASURED', se_setup_ready: ready, setup_recalculation: calculation };
      expect(entryChecks(row)[2]).toMatchObject({ value: ready, state });
      expect(csvRecord(row)).toMatchObject({ setup_readiness_state: state });
    }
  });

  it('escapes retained reason text using the existing literal CSV contract', () => {
    const row = unavailable(false);
    row.setup_recalculation.reason = '=HYPERLINK("invalid")';
    expect(csvRecord(row).setup_readiness_reason).toBe('\'=HYPERLINK("invalid")');
  });

  it.each([undefined, null, '', '   ', {}, 0])('keeps unavailable unknown when its reason is malformed: %j', missing => {
    const row = unavailable(false);
    row.setup_recalculation.reason = missing;
    expect(entryChecks(row)[2]).toMatchObject({ value: null, state: 'unknown', evidence: 'セットアップ再計算不可・理由未取得' });
    expect(csvRecord(row)).toMatchObject({ setup_readiness_state: 'unknown', setup_readiness_reason: 'セットアップ再計算不可・理由未取得' });
  });
});
