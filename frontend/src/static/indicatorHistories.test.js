import { describe, it, expect } from 'vitest';
import { highLowHistory } from './indicatorHistory';
import { putCallHistory, PUT_CALL_VERSION } from './putCallHistory';
import { distributionHistory } from './distributionHistory';
import { institutionalHolderHistory } from './institutionalHistory';
import { institutionalGrowth } from './institutionalEvidence';
const days = (count = 80) => { const result = []; for (let time = Date.parse('2026-01-02'); result.length < count; time += 86400000) { const day = new Date(time); if (![0, 6].includes(day.getUTCDay())) result.push(day.toISOString().slice(0, 10)); } return result; };
const calendar = days();
function distribution() { return { price_symbol: '^GSPC', volume_universe: 'NYSE', source: { name: 'fixture', price_url: 'https://example.test/index', volume_url: 'https://example.test/volume' }, calendar_source: 'fixture-exchange-sessions', sessions: calendar, observations: calendar.map(date => ({ date, close: 100, volume: 1000 })) }; }
describe('honest shared indicator contracts', () => {
  it('keeps the existing prior-251 high/low convention and partial coverage', () => {
    const result = highLowHistory({ version: 'book-market-v1', as_of_date: calendar[0], series: [{ date: calendar[0], newHighs: 3, newLows: 0, coverage: 10, expectedUniverseSize: 50 }] }, calendar[0]);
    expect(result.method).toContain('251'); expect(result.latest).toMatchObject({ high: 3, low: 0, coverage: 10, expected: 50 });
    expect(highLowHistory(result, calendar[1]).series).toEqual([]);
  });
  it('requires licensed volume data with explicit product and venue scope', () => {
    const input = { version: PUT_CALL_VERSION, metric: 'volume', license: { redistribution: 'permitted' }, source: { name: 'Licensed feed', url: 'https://example.test' }, scope: { label: 'US listed total options', venues: ['ALL_US_OPTIONS'], products: ['equity', 'index'] }, observations: [{ date: calendar[0], put_contracts: 60, call_contracts: 100 }, { date: calendar[1], put_contracts: 0, call_contracts: 0 }] };
    expect(putCallHistory(input, calendar[1]).series.map(row => row.value)).toEqual([.6, null]);
    expect(putCallHistory({ ...input, metric: 'open_interest' }, calendar[1]).status).toBe('unavailable');
    expect(putCallHistory({ ...input, license: {} }, calendar[1]).status).toBe('unavailable');
    expect(putCallHistory(null, calendar[1]).series).toEqual([]);
    expect(putCallHistory({ ...input, observations: [...input.observations, input.observations[0]] }, calendar[1]).series[0].value).toBeNull();
  });
});
describe('ordinary index distribution estimates', () => {
  it('uses the inclusive -0.2% boundary, strictly higher volume, and ages off after 25 actual sessions', () => {
    const input = distribution(); input.observations[30] = { date: calendar[30], close: 99.8, volume: 1100 };
    const result = distributionHistory(input, 'sp500', calendar.at(-1));
    expect(result.series[24].value).toBeNull(); expect(result.series[25].value).toBe(0);
    expect(result.series[30]).toMatchObject({ distribution: true, value: 1 });
    expect(result.series[54].value).toBe(1); expect(result.series[55].value).toBe(0);
    expect(result.events[0]).toMatchObject({ retiredAt: calendar[55], retiredBy: '25_sessions' });
    input.observations[30].volume = 1000;
    expect(distributionHistory(input, 'sp500', calendar.at(-1)).series[30].distribution).toBe(false);
  });
  it('retires only on a later closing 5% rise and never revives', () => {
    const input = distribution(); input.observations[30] = { date: calendar[30], close: 99, high: 120, volume: 1100 };
    input.observations[31].close = 103.95;
    const result = distributionHistory(input, 'sp500', calendar[40]);
    expect(result.series[30].value).toBe(1); expect(result.series[31].value).toBe(0); expect(result.series[40].value).toBe(0);
    expect(result.events[0].retiredBy).toBe('close_up_5pct');
  });
  it('makes gaps and zero volumes unknown, rejects ETFs and preserves future independence', () => {
    const input = distribution(); input.observations[31].volume = 0;
    const result = distributionHistory(input, 'sp500', calendar[40]);
    expect(result.series[31].value).toBeNull(); expect(result.series[32].distribution).toBeNull();
    input.observations[60].close = 1;
    expect(distributionHistory(input, 'sp500', calendar[40])).toEqual(result);
    input.observations = input.observations.filter(row => row.date !== calendar[31]);
    expect(distributionHistory(input, 'sp500', calendar[40]).series[31].value).toBeNull();
    expect(distributionHistory({ ...input, price_symbol: 'SPY' }, 'sp500', calendar[40]).status).toBe('unavailable');
    expect(distributionHistory(input, 'nasdaq', calendar[40]).status).toBe('unavailable');
  });
  it('requires a full warmup even when the first price jumps', () => {
    const input = distribution(); input.observations[1].close = 110;
    expect(distributionHistory(input, 'sp500', calendar[10]).series.every(row => row.value === null)).toBe(true);
  });
});
describe('quarterly holder history', () => {
  const observations = [
    { period: '2026-03-31', manager_count: 100, filing_date_first: '2026-04-10', filing_date_last: '2026-05-15' },
    { period: '2026-06-30', manager_count: 110, filing_date_first: '2026-07-10', filing_date_last: '2026-08-15' },
  ];
  const data = { symbol: 'AMD', status: 'available', cusip: '007903107', unit: '13f_reporting_manager_cik', publication_cutoff: '2026-08-31', observations };
  it('plots two actual quarters and does not change the latest-two qualification rule', () => {
    const result = institutionalHolderHistory(data, 'AMD', '2026-09-25');
    expect(result.series).toHaveLength(2); expect(result.latest.delta).toBe(10);
    expect(institutionalGrowth(data, 'AMD', '2026-09-25').increasing).toBe(true);
    expect(institutionalGrowth({ ...data, history: [...observations, ...observations] }, 'AMD', '2026-09-25')).toEqual(institutionalGrowth(data, 'AMD', '2026-09-25'));
  });
  it('keeps missing periods/zero unknown and rejects future filing cutoff or another symbol', () => {
    expect(institutionalHolderHistory(data, 'OTHER', '2026-09-25').series).toEqual([]);
    expect(institutionalHolderHistory(data, 'AMD', '2026-08-01').series).toEqual([]);
    const result = institutionalHolderHistory({ ...data, observations: [observations[0], { ...observations[1], manager_count: 0 }] }, 'AMD', '2026-09-25');
    expect(result.latest.value).toBeNull(); expect(result.latest.delta).toBeNull();
  });
});
export { days };

it('preserves dedicated holder history through the existing detail merge without changing current qualification evidence', async () => {
 const {mergeFinancialDetail}=await import('./financialCurrent');
 const symbol='AMD',asOf='2026-09-25',cutoff='2026-08-31';
 const evidence={symbol,status:'available',unit:'13f_reporting_manager_cik',publication_cutoff:cutoff,observations:[{period:'2026-03-31',manager_count:100,filing_date_first:'2026-04-10',filing_date_last:'2026-05-15'},{period:'2026-06-30',manager_count:110,filing_date_first:'2026-07-10',filing_date_last:'2026-08-15'}]};
 const history=institutionalHolderHistory({...evidence,history:[{period:'2025-12-31',manager_count:90,filing_date_first:'2026-01-10',filing_date_last:'2026-02-15'},...evidence.observations]},symbol,asOf);
 const summary={symbol,market:'US',as_of_date:asOf,institutional_evidence:evidence};
 const merged=mergeFinancialDetail(summary,{...summary,institutional_holder_history:history},{asOfDate:asOf,generation:'one',detailGeneration:'one'});
 expect(merged.institutional_holder_history.series).toHaveLength(3);
 expect(merged.institutional_evidence).toEqual(evidence);
 expect(institutionalGrowth(merged.institutional_evidence,symbol,asOf).delta).toBe(10);
 expect(mergeFinancialDetail(summary,{...summary,institutional_holder_history:history},{asOfDate:asOf,generation:'two',detailGeneration:'one'}).institutional_holder_history).toBeUndefined();
});
