// @vitest-environment node
// (The browser fixture reads its session calendar with node:fs, which needs Node's URL: StockVcpCard.test.jsx renders under jsdom.)
// Round 3 C4 on the STEP 0 oracles: the Setup Engine pivot's own day and the quiet days, from the fixture's rows and bars.
import { describe, expect, it } from 'vitest';
import { PIVOT_DAY_UNKNOWN, WEEKLY_PATTERN, pivotDayNote, quietDaysText } from './StockVcpCard';
import { PIVOT_TIMEFRAMES } from './pivotBar';
import { ORACLE, ORACLE_CHARTS, ORACLE_ROWS, date } from '../../../tests/static/brief-fixture.js';

const oracle = symbol => ({ row: ORACLE_ROWS.find(row => row.symbol === symbol), bars: ORACLE_CHARTS[`${symbol}.json`].bars });
/** The line on the stock screen, where the screen's pivot is the row's Setup Engine pivot (canonicalPivot keeps it: within 25%). */
const note = (symbol, judged = oracle(symbol).bars) => { const { row } = oracle(symbol); return pivotDayNote({ view: { pivot: row.se_pivot_price }, row, judged, date }); };

describe('the VCP card on the oracles', () => {
  it('ZZHB (cup_with_handle): the Tuesday bar whose high is the pivot, not the Friday label, with 「（週足の型）」', () => {
    const { row, bars } = oracle(ORACLE.heldBreakout);
    expect(PIVOT_TIMEFRAMES[row.se_pattern_primary]).toBe('weekly');
    expect(row.se_pivot_date).toBe('2026-09-25');
    expect(bars.find(bar => bar.date === '2026-09-22').high).toBe(row.se_pivot_price);
    expect(note(ORACLE.heldBreakout)).toBe(`ピボット $48.50＝9/22の高値（SE）${WEEKLY_PATTERN}`);
    // Bars not certified: no bar is named.
    expect(note(ORACLE.heldBreakout, null)).toBe(PIVOT_DAY_UNKNOWN);
  });

  it('ZZNR (nr7_inside_day): the pivot day is the bar dated se_pivot_date (the day before the analysis day), no weekly suffix', () => {
    const { row, bars } = oracle(ORACLE.pivotAfterCrossing);
    expect(row.se_pivot_date).toBe(bars.at(-2).date);
    expect(note(ORACLE.pivotAfterCrossing)).toBe('ピボット $62.40＝10/1の高値（SE）');
  });

  it('ZZRD (a VCP primary publishes no pivot date): 「ピボットの日 未確認」 and 「静かな日 2/10日（SE）」', () => {
    const { row } = oracle(ORACLE.ready);
    expect(row.se_pivot_date).toBeUndefined();
    expect(note(ORACLE.ready)).toBe(PIVOT_DAY_UNKNOWN);
    expect(quietDaysText(row, date)).toBe('静かな日 2/10日（SE）');
  });

  it('the oracles without se_quiet_days_10d show no quiet days', () => {
    const without = ORACLE_ROWS.filter(row => !Object.hasOwn(row, 'se_quiet_days_10d'));
    expect(without.length).toBeGreaterThan(0);
    expect(without.map(row => [row.symbol, quietDaysText(row, date)])).toEqual(without.map(row => [row.symbol, null]));
  });
});
