// @vitest-environment node
// (The browser fixture reads its session calendar with node:fs, which needs Node's URL: StockVcpCard.test.jsx renders under jsdom.)
// Round 3 C4 on the STEP 0 oracles: the Setup Engine pivot's own day and the quiet days, from the fixture's rows and bars.
import { describe, expect, it } from 'vitest';
import { PIVOT_DAY_UNKNOWN, QUIET_DAYS_WINDOW, WEEKLY_PATTERN, pivotDayNote, quietDaysText } from './StockVcpCard';
import { PIVOT_TIMEFRAMES } from './pivotBar';
import { shortDate } from './briefShared';
import { money } from '../positionGeometry';
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
    // The line names the Tuesday (9/22), never the Friday label (9/25), and the pivot's price, with the weekly suffix.
    const line = note(ORACLE.heldBreakout);
    expect(line).toContain(shortDate('2026-09-22', date));
    expect(line).not.toContain(shortDate(row.se_pivot_date, date));
    expect(line).toContain(money(row.se_pivot_price));
    expect(line.endsWith(WEEKLY_PATTERN)).toBe(true);
    // Bars not certified: no bar is named.
    expect(note(ORACLE.heldBreakout, null)).toBe(PIVOT_DAY_UNKNOWN);
  });

  it('ZZNR (nr7_inside_day): the pivot day is the bar dated se_pivot_date (the day before the analysis day), no weekly suffix', () => {
    const { row, bars } = oracle(ORACLE.pivotAfterCrossing);
    expect(row.se_pivot_date).toBe(bars.at(-2).date);
    const line = note(ORACLE.pivotAfterCrossing);
    expect(line).not.toBe(PIVOT_DAY_UNKNOWN);
    expect(line).toContain(shortDate(bars.at(-2).date, date));
    expect(line).toContain(money(row.se_pivot_price));
    expect(line).not.toContain(WEEKLY_PATTERN);
  });

  it('ZZRD (a VCP primary publishes no pivot date): the pivot day is 未確認 and its 2 quiet days are shown', () => {
    const { row } = oracle(ORACLE.ready);
    expect(row.se_pivot_date).toBeUndefined();
    expect(note(ORACLE.ready)).toBe(PIVOT_DAY_UNKNOWN);
    expect(row.se_quiet_days_10d).toBe(2);
    expect(quietDaysText(row, date)).toContain(` ${row.se_quiet_days_10d}/${QUIET_DAYS_WINDOW}`);
  });

  it('the oracles without se_quiet_days_10d show no quiet days', () => {
    const without = ORACLE_ROWS.filter(row => !Object.hasOwn(row, 'se_quiet_days_10d'));
    expect(without.length).toBeGreaterThan(0);
    expect(without.map(row => [row.symbol, quietDaysText(row, date)])).toEqual(without.map(row => [row.symbol, null]));
  });
});
