import { expect, it } from 'vitest';
import { candidatePerformance, measureCandidateReturn, HISTORY_RETENTION_SESSIONS } from './candidatePerformance';

// Explicit sessions spanning the US Labor Day holiday; no weekday-count shortcut.
const sessions = ['2026-09-04', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14'];
const series = closes => ({ verified: true, bars: closes.map((close, index) => ({ date: sessions[index], close })) });
const input = { startDate: sessions[0], asOf: sessions.at(-1), sessions, horizon: 5, stock: series([100, 110, 105, 90, 100, 108]), benchmark: series([100, 101, 102, 103, 104, 105]) };

it('waits for five actual sessions rather than five weekdays or calendar days', () => {
  const before = measureCandidateReturn({ ...input, asOf: sessions[4] });
  expect(before.status).toBe('pending');
  expect(before.observed_sessions).toBe(4);
  expect(before.return_pct).toBeNull();
  const after = measureCandidateReturn(input);
  expect(after.status).toBe('complete');
  expect(after.end_date).toBe('2026-09-14');
  expect(after.observed_sessions).toBe(5);
  expect(after.return_pct).toBeCloseTo(8);
  expect(after.spy_return_pct).toBeCloseTo(5);
});
it.each([5, 20, 60])('uses the exact %i-session endpoint instead of a later price', horizon => {
  const holidays = new Set(['2026-09-07', '2026-11-26']);
  const calendar = Array.from({length:100},(_,i)=>new Date(Date.UTC(2026,8,4+i))).filter(date=>![0,6].includes(date.getUTCDay())).map(date=>date.toISOString().slice(0,10)).filter(date=>!holidays.has(date));
  const stock={verified:true,bars:calendar.map((date,i)=>({date,close:100+i}))};
  const benchmark={verified:true,bars:calendar.map((date,i)=>({date,close:100+i*.5}))};
  const result=measureCandidateReturn({startDate:calendar[0],asOf:calendar[65],sessions:calendar,stock,benchmark,horizon});
  expect(result.status).toBe('complete');expect(result.end_date).toBe(calendar[horizon]);
  expect(result.return_pct).toBeCloseTo(horizon);expect(result.spy_return_pct).toBeCloseTo(horizon*.5);
  expect(result.max_drawdown_pct).toBe(0);expect(result.observed_sessions).toBe(horizon);
});
it('calculates peak-to-trough drawdown over all closes, not just loss from entry', () => {
  expect(measureCandidateReturn(input).max_drawdown_pct).toBeCloseTo((90 / 110 - 1) * 100);
});
it('does not compress missing sessions or turn missing stock and benchmark data into zero', () => {
  const missing = { ...input.stock, bars: input.stock.bars.filter((_, i) => i !== 2) };
  for (const modification of [{ stock: missing }, { stock: null }, { stock: { ...input.stock, verified: false } }, { benchmark: null }]) {
    const result = measureCandidateReturn({ ...input, ...modification });
    expect(result.status).toBe('unavailable');
    expect(result.return_pct).toBeNull();
    expect(result.spy_return_pct).toBeNull();
    expect(result.max_drawdown_pct).toBeNull();
  }
  expect(measureCandidateReturn({ ...input, stock: missing }).observed_sessions).toBe(1);
});
it('uses a consistent adjusted series across a split, and rejects an unverified series', () => {
  const adjusted = series([10, 11, 10.5, 9, 10, 10.8]);
  expect(measureCandidateReturn({ ...input, stock: adjusted }).return_pct).toBeCloseTo(8);
  const unverified = { ...series([100, 110, 105, 90, 10, 10.8]), verified: false };
  expect(measureCandidateReturn({ ...input, stock: unverified }).return_pct).toBeNull();
});
it('keeps first publication membership and excludes unknown, illiquid and future observations', () => {
  const record = (symbol, state = 'pass', liquid = true) => ({ symbol, market: 'US', liquid, methods: { minervini: { state } } });
  const snapshots = [{ as_of: sessions[0], rule_version: 'saved-version', universe_version: 'saved-universe', records: [record('FIRST'), record('UNKNOWN', 'unknown'), record('ILLIQUID', 'pass', false)] },
    { as_of: '2026-12-31', records: [record('FUTURE')] }];
  const result = candidatePerformance({ snapshots, asOf: sessions.at(-1), sessions, stocks: new Map([['FIRST', input.stock], ['NEW_TODAY', input.stock]]), benchmark: input.benchmark });
  expect(result.cohorts).toHaveLength(1);
  expect(result.summary.minervini[5].cohort_count).toBe(1);
  expect(result.summary.minervini[5].n).toBe(1);
  expect(result.summary.minervini[5].median_return_pct).toBeCloseTo(8);
  expect(result.summary.minervini[5].win_rate).toBe(1);
  expect(result.summary.minervini[5].sample_insufficient).toBe(true);
  expect(result.summary.minervini[20].median_return_pct).toBeNull();
  expect(result.summary.minervini[60].median_return_pct).toBeNull();
  expect(HISTORY_RETENTION_SESSIONS).toBeGreaterThanOrEqual(61);
});
it('keeps an empty unsaved history empty rather than reconstructing past candidates', () => {
  const result = candidatePerformance({ snapshots: [], asOf: sessions.at(-1), sessions, stocks: new Map([['NOW', input.stock]]), benchmark: input.benchmark });
  expect(result.cohorts).toEqual([]);
  expect(result.summary.minervini[5].median_return_pct).toBeNull();
  expect(result.summary.minervini[5].win_rate).toBeNull();
  expect(result.summary.minervini[5].n).toBe(0);
});
it('shows a mature median and win rate while retaining unavailable members in the denominator', () => {
  const snapshots = [{ as_of: sessions[0], records: ['UP','DOWN','MISSING'].map(symbol => ({ symbol, market:'US', liquid:true, methods:{minervini:{state:'pass'}} })) }];
  const result = candidatePerformance({ snapshots, asOf:sessions.at(-1), sessions, stocks:new Map([['UP',input.stock],['DOWN',series([100,99,98,97,96,90])]]), benchmark:input.benchmark }).summary.minervini[5];
  expect(result.n).toBe(2); expect(result.cohort_count).toBe(3); expect(result.unavailable).toBe(1);
  expect(result.median_return_pct).toBeCloseTo(-1); expect(result.win_rate).toBe(.5);
});
