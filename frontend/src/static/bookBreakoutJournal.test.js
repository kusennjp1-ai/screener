import { expect, it } from 'vitest';
import { readBreakoutReviews, BREAKOUT_PREFIX } from './bookBreakoutJournal';
const review = { symbol:'AAA', asOfDate:'2026-09-21', breakoutDate:'2026-09-10', reviewDate:'2026-09-22', reviewedAtISO:'2026-09-22T12:00:00Z', source:'Declared chart', setupConfirmed:true };
const storage = entries => ({ length: entries.length, key: i => entries[i][0], getItem: k => entries.find(e => e[0] === k)[1] });
it('orders confirmed dated reviews across symbols and keeps the last review of a duplicate', () => {
  const second = {...review,symbol:'BBB',breakoutDate:'2026-09-05'};
  const latest = {...review,asOfDate:'2026-09-23',reviewDate:'2026-09-24',reviewedAtISO:'2026-09-24T12:00:00Z'};
  const entries = [review,second,latest].map(r => [`${BREAKOUT_PREFIX}${r.symbol}:${r.asOfDate}`,JSON.stringify(r)]);
  const result = readBreakoutReviews(storage(entries));
  expect(result.records.map(r=>r.symbol)).toEqual(['BBB','AAA']);
  expect(result.records[1].reviewDate).toBe('2026-09-24');
  expect(result.invalid).toBe(0);
});
it('does not include proxy events, broken records or an unconfirmed setup', () => {
  const entries = [['unrelated','secret'],[`${BREAKOUT_PREFIX}AAA:2026-09-21`,JSON.stringify({...review,setupConfirmed:false})],[`${BREAKOUT_PREFIX}BAD:2026-09-21`,'{']];
  expect(readBreakoutReviews(storage(entries))).toEqual({records:[],invalid:2});
});
