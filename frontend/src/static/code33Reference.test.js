import { describe, expect, it } from 'vitest';
import { code33Layered, code33Reference } from './code33Reference';

const ends = ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'];
const history = (eps, revenue, netIncome) => ({ valid: true, quarterly: ends.map((end, i) => ({ end, eps: eps[i], revenue: revenue[i], netIncome: netIncome[i] })) });
const accelerating = () => history([1, 1, 1, 1, 1.1, 1.2, 1.4, 1.8], [100, 100, 100, 100, 110, 130, 160, 200], [10, 10, 10, 10, 11, 14.3, 19.2, 26]);

describe('Yahoo reference Code 33', () => {
  it('passes only when EPS growth, sales growth and margin all rise three times', () => {
    expect(code33Reference(accelerating(), '2026-02-01')).toMatchObject({ state: 'pass', eps: 'pass', sales: 'pass', margin: 'pass' });
    const flatMargin = accelerating(); flatMargin.quarterly[7].netIncome = 18;
    expect(code33Reference(flatMargin, '2026-02-01')).toMatchObject({ state: 'fail', margin: 'fail' });
  });

  it('stays unknown for a missing quarter, a gap, a non-positive base or stale data', () => {
    const missing = accelerating(); missing.quarterly[7].eps = null;
    expect(code33Reference(missing, '2026-02-01').state).toBe('unknown');
    const gap = accelerating(); gap.quarterly.splice(6, 1);
    expect(code33Reference(gap, '2026-02-01').state).toBe('unknown');
    const loss = accelerating(); loss.quarterly[3].eps = -0.2;
    expect(code33Reference(loss, '2026-02-01').eps).toBe('unknown');
    expect(code33Reference(accelerating(), '2026-12-01').state).toBe('unknown');
    expect(code33Reference({ valid: false, quarterly: accelerating().quarterly }, '2026-02-01').state).toBe('unknown');
  });

  it('combines the three conditions with a three-valued AND', () => {
    const failAndUnknown = accelerating(); failAndUnknown.quarterly[7].netIncome = 18; failAndUnknown.quarterly[7].eps = null;
    expect(code33Reference(failAndUnknown, '2026-02-01')).toMatchObject({ state: 'fail', eps: 'unknown', margin: 'fail' });
    const passAndUnknown = accelerating(); passAndUnknown.quarterly[7].eps = null;
    expect(code33Reference(passAndUnknown, '2026-02-01')).toMatchObject({ state: 'unknown', eps: 'unknown', sales: 'pass', margin: 'pass' });
    expect(code33Reference(accelerating(), '2026-02-01').state).toBe('pass');
    // A known SEC failure wins over a Yahoo pass.
    expect(code33Layered({ valid: true, code33: 'fail' }, accelerating(), '2026-02-01').source).toBe('sec');
  });

  it('prefers the dated SEC result and labels the Yahoo fallback', () => {
    expect(code33Layered({ valid: true, code33: 'fail' }, accelerating(), '2026-02-01')).toMatchObject({ state: 'fail', source: 'sec' });
    expect(code33Layered({ valid: true, code33: 'unknown' }, accelerating(), '2026-02-01')).toMatchObject({ state: 'pass', source: 'yahoo', label: '参考：Yahoo四半期値' });
    expect(code33Layered(null, null, '2026-02-01')).toEqual({ state: 'unknown', source: null, label: null });
  });
});
