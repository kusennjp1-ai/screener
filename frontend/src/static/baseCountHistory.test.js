import { describe, it, expect } from 'vitest';
import { countConfirmedBases, detectConfirmedBases, baseCountHistory } from './baseCountHistory';
const days = count => { const result = []; for (let time = Date.parse('2025-01-02'); result.length < count; time += 86400000) { const d = new Date(time); if (![0, 6].includes(d.getUTCDay())) result.push(d.toISOString().slice(0, 10)); } return result; };
const dates = days(200);
function base(id, start, end, pivot, low) { return { id, start: dates[start], end: dates[end], confirmedAt: dates[end], pivot, low, boundaryVerified: true }; }
describe('confirmed base sequence estimate', () => {
  it('separates stage advancement from base-on-base and resets only on a lower low', () => {
    const bases = [base('a', 0, 25, 100, 80), base('b', 26, 51, 119, 90), base('c', 52, 77, 142.8, 100), base('d', 78, 103, 150, 99)];
    const result = countConfirmedBases({ symbol: 'A', asOf: dates[110], bases });
    expect(result.series.map(row => row.count)).toEqual([1, 1, 2, 1]);
    expect(result.series[1].baseOnBase).toBe(true); expect(result.series[2].priorBaseId).toBe('b');
    expect(result.latest.resetReason).toBe('undercut_prior_base_low'); expect(result.originKnown).toBe(true);
  });
  it('rejects overlap and leaves future confirmations out of earlier observations', () => {
    const bases = [base('a', 0, 25, 100, 80), base('b', 20, 50, 130, 90)];
    expect(countConfirmedBases({ symbol: 'A', asOf: dates[70], bases }).count).toBeNull();
    expect(countConfirmedBases({ symbol: 'A', asOf: dates[30], bases }).series).toHaveLength(1);
    expect(countConfirmedBases({ symbol: 'A', asOf: dates[30], bases: [{ ...bases[0], confirmedAt: null }] }).count).toBeNull();
  });
  it('automatically derives a usable stage from a prefix-confirmed non-overlapping base', () => {
    const prices = [...Array.from({ length: 21 }, (_, i) => 80 + i), ...Array.from({ length: 25 }, (_, i) => i < 12 ? 99 - i : 87 + (i - 12) * .75)];
    const bars = prices.map((close, i) => ({ date: dates[i], open: close, high: close + 1, low: close - 1, close, volume: 1000 }));
    const chart = { symbol: 'A', bars }, asOf = bars.at(-1).date;
    const result = baseCountHistory(chart, 'A', asOf, dates.slice(0, bars.length));
    expect(result.count).toBe(1); expect(result.series[0].confirmedAt).toBe(asOf);
    expect(result.originKnown).toBe(false);
    const earlier = detectConfirmedBases(chart, dates[40], dates);
    chart.bars.push({ date: dates[46], open: 110, high: 111, low: 109, close: 110, volume: 1000 });
    expect(detectConfirmedBases(chart, dates[40], dates)).toEqual(earlier);
  });
  it('does not bridge a missing known session or silently count a stage label', () => {
    expect(baseCountHistory({ symbol: 'A', bars: [], stage: 2, vcp_contractions: 3 }, 'A', dates[30]).count).toBeNull();
    const chart = { symbol: 'A', bars: [{ date: dates[0], open: 100, high: 101, low: 99, close: 100, volume: 10 }, { date: dates[2], open: 101, high: 102, low: 100, close: 101, volume: 10 }] };
    expect(detectConfirmedBases(chart, dates[2], dates).usableThrough).toBe(dates[0]);
  });
});

it('keeps old or malformed summary counts out of every current surface', async () => {
  const { currentBaseCount, BASE_COUNT_VERSION } = await import('./baseCountHistory');
  const row = {as_of_date:dates[50],base_count_summary:{version:BASE_COUNT_VERSION,as_of_date:dates[50],complete:true,count:2}};
  expect(currentBaseCount(row)).toBe(2);
  expect(currentBaseCount(row,dates[51])).toBeNull();
  expect(currentBaseCount({...row,base_count_summary:{...row.base_count_summary,version:'old'}})).toBeNull();
  expect(currentBaseCount({...row,base_count_summary:{...row.base_count_summary,count:2.5}})).toBeNull();
});
