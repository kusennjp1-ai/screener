import { expect, it } from 'vitest';
import { breadthSummary, recentBreadth } from './breadthSummary';
it('sorts newest-first payloads before selecting a recent calendar window', () => {
  const rows = [{ date: '2026-09-23' }, { date: '2026-09-20' }, { date: '2026-08-01' }, { date: '2026-07-01' }];
  expect(recentBreadth(rows, '1M', '2026-09-23').map(r => r.date)).toEqual(['2026-09-20', '2026-09-23']);
  expect(recentBreadth(rows, '3M', '2026-09-23')).toHaveLength(4);
  expect(recentBreadth([...rows].reverse(), '1M', '2026-09-23')).toEqual(recentBreadth(rows, '1M', '2026-09-23'));
});
it('does not present missing or negative counts as neutral or bullish', () => {
  const row = { date: '2026-09-23', ratio_10day: 2, stocks_up_4pct: 10, stocks_down_4pct: 5 };
  expect(breadthSummary(row).tone).toBe('positive');
  expect(breadthSummary({ ...row, stocks_down_4pct: null }).tone).toBe('unknown');
  expect(breadthSummary({ ...row, stocks_down_4pct: -1 }).tone).toBe('unknown');
  expect(breadthSummary({ ...row, ratio_10day: 0 }).tone).toBe('caution');
  expect(breadthSummary({ ...row, date: '2020-01-01' }).fresh.state).toBe('old');
});
