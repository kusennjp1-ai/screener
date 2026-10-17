import { describe, expect, it } from 'vitest';
import { sourceAnnualMath, sourceSalesMath, sourceAnd, sourceOr } from './oneilSourceMath.js';

describe('source arithmetic only, separate from evidence admission', () => {
  it('distinguishes CAGR plus each-year increase from every-year 25%', () => {
    const result = sourceAnnualMath([1, 1.2, 1.5, 2]);
    expect(result).toMatchObject({ state: 'pass', cagr: { state: 'pass' }, eachYear: { state: 'pass' } });
    expect(result.cagr.value).toBeCloseTo(25.992104989, 8);
    expect(result.eachYear.comparisons.map(value => value.growth)).toEqual([20, 25, 100 / 3]);
    const dip = sourceAnnualMath([1, 2, 1.5, 2.5]);
    expect(dip).toMatchObject({ state: 'fail', cagr: { state: 'pass' }, eachYear: { state: 'fail' } });
    expect(dip.eachYear.comparisons[1]).toMatchObject({ state: 'fail', growth: -25 });
  });
  it.each([
    [1.9531249999999998, 'fail'], [1.953125, 'pass'], [1.9531250000000002, 'pass'],
  ])('compares an endpoint %s to the exact cubic 25%% threshold', (last, expected) => {
    const result = sourceAnnualMath([1, 1.25, 1.5625, last]);
    expect(result.cagr.state).toBe(expected);
    expect(result.state).toBe(expected);
    expect(result.cagr.value.toFixed(2)).toBe('25.00');
  });
  it.each([
    [[6.4e-201, 8e-201, 1e-200, 1.25e-200]], [[0.64, 0.8, 1, 1.25]], [[6.4e199, 8e199, 1e200, 1.25e200]],
  ])('retains the exact boundary for decimal input %j', values => {
    const result = sourceAnnualMath(values);
    // The decimal spellings of these representable scaled inputs define the
    // source values; no epsilon may alter their comparison.
    expect(result.cagr.state).toBe('pass');
  });
  it('does not add a positive growth-rate floor to the acceleration condition', () => {
    const result = sourceSalesMath([70, 80, 90].map(latest => ({ previous: 100, latest })));
    expect(result).toMatchObject({ state: 'pass', latest: { state: 'fail' }, acceleration: { state: 'pass' } });
  });
  it('diagnoses the synthetic 5→10→20 case using three exact comparable pairs', () => {
    const result = sourceSalesMath([105, 110, 120].map(latest => ({ previous: 100, latest })));
    expect(result).toMatchObject({ state: 'pass', latest: { state: 'fail', value: 20 }, acceleration: { state: 'pass' } });
    expect(result.acceleration.comparisons.map(value => value.growth)).toEqual([5, 10, 20]);
  });
  it('keeps exact-equal ratios from becoming false acceleration after binary rounding', () => {
    const result = sourceSalesMath([{ previous: 0.28, latest: 0.35 }, { previous: 0.12, latest: 0.15 }, { previous: 0.4, latest: 0.5 }]);
    expect(result).toMatchObject({ state: 'pass', latest: { state: 'pass', value: 25 }, acceleration: { state: 'fail' } });
  });
  it.each([
    [124.99999999999999, 'fail'], [125, 'pass'], [125.00000000000001, 'pass'],
  ])('uses exact decimals for the raw-pair latest 25%% comparison %s', (latest, expected) => {
    expect(sourceSalesMath([{ previous: 100, latest: 120 }, { previous: 100, latest: 110 }, { previous: 100, latest }]).latest.state).toBe(expected);
  });
  it.each([
    [null, 'missing_annual_eps'], [[1, 2, 3], 'missing_annual_eps'], [[1, 2, null, 4], 'missing_annual_eps'],
    [[1, '2', 3, 4], 'missing_annual_eps'], [[1, true, 3, 4], 'missing_annual_eps'], [[1, Infinity, 3, 4], 'missing_annual_eps'],
    [[0, 1, 2, 4], 'nonpositive_annual_eps'], [[-1, 1, 2, 4], 'nonpositive_annual_eps'], [[1, -1, 2, 4], 'nonpositive_annual_eps'], [[1, 2, 3, 0], 'nonpositive_annual_eps'],
  ])('does not invent annual calculations from %j', (values, reason) => {
    expect(sourceAnnualMath(values)).toMatchObject({ state: 'unknown', reason, cagr: { value: null } });
  });
  it('rejects sparse annual values and does not mutate source arrays', () => {
    const values = [1, 2, 3, 4]; delete values[1];
    expect(sourceAnnualMath(values).state).toBe('unknown');
    const source = Object.freeze([1, 1.2, 1.5, 2]);
    expect(sourceAnnualMath(source).state).toBe('pass');
    expect(source).toEqual([1, 1.2, 1.5, 2]);
  });
  it('uses tri-state OR for partial sales comparisons without substituting zero', () => {
    for (const previous of [0, -1, null, '100', NaN, Infinity]) {
      const result = sourceSalesMath([{ previous, latest: 110 }, { previous: 100, latest: 115 }, { previous: 100, latest: 120 }]);
      expect(result).toMatchObject({ state: 'unknown', latest: { state: 'fail' }, acceleration: { state: 'unknown' } });
    }
    expect(sourceSalesMath([{ previous: 0, latest: 110 }, { previous: 100, latest: 115 }, { previous: 100, latest: 130 }])).toMatchObject({ state: 'pass', latest: { state: 'pass' }, acceleration: { state: 'unknown' } });
    expect(sourceSalesMath([{ previous: 100, latest: 120 }, { previous: 100, latest: 120 }, { previous: 100, latest: 120 }]).state).toBe('fail');
  });
  it('keeps an incomplete or sparse comparison window unknown', () => {
    expect(sourceSalesMath([{ previous: 100, latest: 130 }]).state).toBe('unknown');
    const pairs = [{ previous: 100, latest: 110 }, { previous: 100, latest: 115 }, { previous: 100, latest: 120 }];
    delete pairs[1];
    expect(sourceSalesMath(pairs).state).toBe('unknown');
  });
  for (const first of ['pass', 'fail', 'unknown']) for (const second of ['pass', 'fail', 'unknown']) {
    it(`OR truth table ${first}/${second}`, () => {
      expect(sourceOr([first, second])).toBe(first === 'pass' || second === 'pass' ? 'pass' : first === 'fail' && second === 'fail' ? 'fail' : 'unknown');
    });
  }
  it('does not make an empty logical input pass or fail', () => {
    expect(sourceAnd([])).toBe('unknown'); expect(sourceOr([])).toBe('unknown');
    expect(sourceAnd(['pass', 'unknown'])).toBe('unknown');
    expect(sourceAnd(['fail', 'unknown'])).toBe('fail');
  });
});
