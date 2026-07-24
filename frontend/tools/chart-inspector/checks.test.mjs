import { describe, it, expect } from 'vitest';
import { checkRow, round2 } from './checks.mjs';

const good = {
  symbol: 'GOOD', pivot: 132.5, stop: 124.1, t2: 149.3, t3: 157.7,
  riskPct: 6.3, footerStop: 124.1,
};

describe('checkRow', () => {
  it('passes an internally-consistent plan', () => {
    expect(checkRow(good)).toEqual([]);
  });

  it('catches a drifted 2R target', () => {
    const v = checkRow({ ...good, t2: 155.0 });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/2R 155 != pivot\+2R 149\.3/);
  });

  it('catches a drifted 3R target', () => {
    expect(checkRow({ ...good, t3: 160 })[0]).toMatch(/3R/);
  });

  it('catches a ladder stop that disagrees with the footer stop', () => {
    expect(checkRow({ ...good, footerStop: 120.0 })[0]).toMatch(/stop ladder 124\.1 != footer stop 120/);
  });

  it('catches a risk% that does not match (pivot-stop)/pivot', () => {
    // true risk is (132.5-124.1)/132.5 = 6.34%; claim 9% -> violation
    expect(checkRow({ ...good, riskPct: 9.0 })[0]).toMatch(/risk 9% !=/);
  });

  it('catches a non-positive risk (stop at/above pivot)', () => {
    expect(checkRow({ symbol: 'X', pivot: 100, stop: 105, t2: null, t3: null })
      .some((s) => /non-positive risk/.test(s))).toBe(true);
  });

  it('skips WAIT / no-signal rows that carry no plan', () => {
    expect(checkRow({ symbol: 'WAIT', pivot: null, stop: null })).toEqual([]);
  });

  it('round2 rounds to two decimals', () => {
    expect(round2(149.30000001)).toBe(149.3);
  });
});
