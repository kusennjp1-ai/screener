import { expect, it } from 'vitest';
import { performanceBenchmarkInputs } from './export-candidate-performance.mjs';
import { measureCandidateReturn } from '../src/static/candidatePerformance.js';

it('never substitutes observed SPY price dates for the actual NYSE session calendar', () => {
  const dates = ['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-28','2026-09-29'];
  const bars = dates.map((date,index)=>({date,close:100+index}));
  const prices = {as_of_date:dates.at(-1),calendar:'NYSE',adjustment:'split-adjusted-close-no-dividend',series:{SPY:bars.filter(bar=>bar.date!=='2026-09-23')}};
  const input = performanceBenchmarkInputs(prices,dates.at(-1));
  expect(input.sessions).toEqual([]);
  expect(measureCandidateReturn({startDate:dates[0],asOf:dates.at(-1),stock:{verified:true,bars},horizon:5,...input}).status).toBe('unavailable');
  const supplied = performanceBenchmarkInputs({...prices,sessions:dates},dates.at(-1));
  const result = measureCandidateReturn({startDate:dates[0],asOf:dates.at(-1),stock:{verified:true,bars},horizon:5,...supplied});
  expect(result.status).toBe('unavailable');
  expect(result.reason).toContain('SPYに欠損');
  expect(result.return_pct).toBeNull();
});
