import { describe, expect, it } from 'vitest';
import { PIVOT_TIMEFRAMES, pivotBar } from './pivotBar.js';

// Sessions 2026-09-14 (Mon) … 2026-10-02 (Fri); each bar's high is 10 unless a case sets it.
const DATES = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23',
  '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
const bars = (highs = {}) => DATES.map(date => ({ date, open: 9.5, close: 9.8, low: 9.2, high: highs[date] ?? 10, volume: 1e6 }));
const at = date => DATES.indexOf(date);

describe('PIVOT_TIMEFRAMES', () => {
  it('names every pattern the default detectors emit, weekly for the two weekly detectors only', () => {
    expect(PIVOT_TIMEFRAMES).toEqual({ cup_with_handle: 'weekly', three_weeks_tight: 'weekly', high_tight_flag: 'daily',
      first_pullback: 'daily', vcp: 'daily', nr7_inside_day: 'daily' });
    expect(Object.isFrozen(PIVOT_TIMEFRAMES)).toBe(true);
  });
});

describe('pivotBar', () => {
  it('a weekly pattern dated by its Friday label gives the bar in that week whose high is the pivot (Tuesday), not the Friday', () => {
    const row = { se_pattern_primary: 'cup_with_handle', se_pivot_date: '2026-09-25', se_pivot_price: 12.34 };
    expect(pivotBar(bars({ '2026-09-22': 12.34 }), row)).toEqual({ index: at('2026-09-22'), date: '2026-09-22' });
    expect(pivotBar(bars({ '2026-09-22': 12.34 }), { ...row, se_pattern_primary: 'three_weeks_tight' })).toEqual({ index: at('2026-09-22'), date: '2026-09-22' });
  });

  it('a weekly pattern takes the latest matching bar of its week and never one outside it', () => {
    const row = { se_pattern_primary: 'cup_with_handle', se_pivot_date: '2026-09-25', se_pivot_price: 12.34 };
    expect(pivotBar(bars({ '2026-09-21': 12.34, '2026-09-24': 12.34 }), row)).toEqual({ index: at('2026-09-24'), date: '2026-09-24' });
    // The same high the Friday before (2026-09-18) or the Monday after (2026-09-28) is another week.
    expect(pivotBar(bars({ '2026-09-18': 12.34, '2026-09-28': 12.34 }), row)).toBeNull();
  });

  it('a weekly label on a Friday that is no session (Good Friday 2026-04-03) still names its week', () => {
    const days = ['2026-03-27', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-06'];
    const list = days.map(date => ({ date, high: date === '2026-03-31' ? 50.5 : 50, low: 49, open: 49.5, close: 49.8, volume: 1 }));
    expect(pivotBar(list, { se_pattern_primary: 'three_weeks_tight', se_pivot_date: '2026-04-03', se_pivot_price: 50.5 })).toEqual({ index: 2, date: '2026-03-31' });
  });

  it('a daily pattern (nr7_inside_day) gives the bar dated se_pivot_date when its high is the pivot', () => {
    const row = { se_pattern_primary: 'nr7_inside_day', se_pivot_date: '2026-10-01', se_pivot_price: 11.5 };
    expect(pivotBar(bars({ '2026-10-01': 11.5 }), row)).toEqual({ index: at('2026-10-01'), date: '2026-10-01' });
    // Another bar of the week with that high is not the pivot's bar: a daily pattern names its day.
    expect(pivotBar(bars({ '2026-09-30': 11.5 }), row)).toBeNull();
  });

  it('no bar whose high is the pivot gives null (it never guesses)', () => {
    expect(pivotBar(bars(), { se_pattern_primary: 'cup_with_handle', se_pivot_date: '2026-09-25', se_pivot_price: 12.34 })).toBeNull();
    expect(pivotBar(bars({ '2026-10-01': 11.51 }), { se_pattern_primary: 'nr7_inside_day', se_pivot_date: '2026-10-01', se_pivot_price: 11.5 })).toBeNull();
  });

  it('a missing or malformed date, a missing pivot, an unknown or absent pattern, or no bars give null', () => {
    const list = bars({ '2026-10-01': 11.5 }), row = { se_pattern_primary: 'nr7_inside_day', se_pivot_date: '2026-10-01', se_pivot_price: 11.5 };
    for (const change of [{ se_pivot_date: undefined }, { se_pivot_date: null }, { se_pivot_date: '2026-10-1' }, { se_pivot_date: '2026-02-30' },
      { se_pivot_price: null }, { se_pivot_price: 0 }, { se_pivot_price: Number.NaN }, { se_pattern_primary: null }, { se_pattern_primary: 'double_bottom' },
      { se_pattern_primary: 'constructor' }]) {
      expect(pivotBar(list, { ...row, ...change })).toBeNull();
    }
    // The VCP detector publishes no pivot date (vcp_wrapper.py: pivot_date=None).
    expect(pivotBar(list, { se_pattern_primary: 'vcp', se_pivot_date: null, se_pivot_price: 11.5 })).toBeNull();
    expect(pivotBar([], row)).toBeNull();
    expect(pivotBar(null, row)).toBeNull();
    expect(pivotBar(list, null)).toBeNull();
  });

  it('compares the pivot and the high in cents, so float noise in the published pivot still matches', () => {
    const list = bars({ '2026-09-22': 89.88 });
    expect(pivotBar(list, { se_pattern_primary: 'cup_with_handle', se_pivot_date: '2026-09-25', se_pivot_price: 89.88000000000001 })).toEqual({ index: at('2026-09-22'), date: '2026-09-22' });
    expect(pivotBar(list, { se_pattern_primary: 'cup_with_handle', se_pivot_date: '2026-09-25', se_pivot_price: 89.87499 })).toBeNull();
  });

  it('ignores bars after the pivot date', () => {
    const row = { se_pattern_primary: 'nr7_inside_day', se_pivot_date: '2026-09-23', se_pivot_price: 11.5 };
    expect(pivotBar(bars({ '2026-09-23': 11.5, '2026-09-29': 11.5 }), row)).toEqual({ index: at('2026-09-23'), date: '2026-09-23' });
  });
});
