import { describe, it, expect } from 'vitest';
import { entrySnapshot, entryHistory, entryPivotIdentity, summarizeEntrySnapshot, ENTRY_HISTORY_VERSION, ENTRY_METHODS, ENTRY_UNIVERSE } from './entryHistory';
import { entryPosition } from './researchEngine';
import fixture from '../../tools/fixtures/radar-207-2026-09-29.json';
const first = '2026-09-28', second = '2026-09-29';
const record = (price, extra = {}) => ({ symbol: 'AAA', market: 'US', price, pivot: 100, distance: price - 100, pivotIdentity: 'confirmed-pattern-a', sourceBasis: 'same-adjusted-provider', priceHistoryBasis: { latest: 'history-b', prior: 'history-a' }, methods: Object.fromEntries(ENTRY_METHODS.map(method => [method, { zone: method === 'minervini2' ? 3 : 5, qualified: true, ready: false }])), ...extra });
const snapshot = (date, records, previousSession = first) => ({ version: ENTRY_HISTORY_VERSION, as_of: date, previous_session: previousSession, universe_version: ENTRY_UNIVERSE, rule_version: 'same-policy', records });
const prior = () => snapshot(first, [record(99, { priceHistoryBasis: { latest: 'history-a', prior: 'history-before' } })]);
describe('canonical entry observations', () => {
  it('separates current approach/zone, price crossing, qualified and daily-ready subsets', () => {
    const current = snapshot(second, [record(102)]), result = summarizeEntrySnapshot(current, prior());
    expect(result).toMatchObject({ approach: 0, breakoutRange: 1, qualifiedBreakoutRange: 1, readyBreakoutRange: 0, newCrossings: 1, qualifiedCrossings: 1, readyCrossings: 0, crossingCoverage: 1 });
    const unavailableMethod = record(102); unavailableMethod.methods.minervini.qualified = null;
    expect(summarizeEntrySnapshot(snapshot(second, [unavailableMethod]), prior())).toMatchObject({ breakoutRange: 1, qualifiedBreakoutRange: 0, newCrossings: 1, qualifiedCrossings: 0, qualificationUnknown: 1 });
  });
  it('counts crossing above the buying range as a price event, never as a ready entry', () => {
    expect(summarizeEntrySnapshot(snapshot(second, [record(108)]), prior())).toMatchObject({ breakoutRange: 0, newCrossings: 1, readyCrossings: 0 });
  });
  it.each([
    ['missing previous', null, {}], ['same-date generation', snapshot(second, [record(99)]), {}],
    ['missed exchange session', { ...prior(), as_of: '2026-09-25' }, {}],
    ['changed policy', { ...prior(), rule_version: 'different' }, {}],
    ['changed pivot identity', prior(), { pivotIdentity: 'new-base' }], ['changed pivot value', prior(), { pivot: 101 }],
    ['changed source', prior(), { sourceBasis: 'new-source' }], ['revised historical prices', prior(), { priceHistoryBasis: { prior: 'revised-history', latest: 'history-b' } }],
    ['missing history identity', prior(), { priceHistoryBasis: null }],
  ])('keeps %s unknown instead of inventing zero events', (_name, previous, overrides) => {
    expect(summarizeEntrySnapshot(snapshot(second, [record(102, overrides)]), previous).newCrossings).toBeNull();
  });
  it('rearms only after a below-pivot recorded close, with no repeat while staying above', () => {
    const previous = snapshot(first, [record(101, { priceHistoryBasis: { latest: 'history-a' } })]);
    expect(summarizeEntrySnapshot(snapshot(second, [record(102)]), previous).newCrossings).toBe(0);
    expect(summarizeEntrySnapshot(snapshot(second, [record(102)]), prior()).newCrossings).toBe(1);
  });
  it('applies configurable BELOW-pivot approach independently of method ABOVE-pivot range', () => {
    const current = snapshot(second, [record(97), record(104, { symbol: 'BBB' })]);
    expect(summarizeEntrySnapshot(current, null, 'minervini', 3)).toMatchObject({ approach: 1, breakoutRange: 1 });
    expect(summarizeEntrySnapshot(current, null, 'minervini2', 1)).toMatchObject({ approach: 0, breakoutRange: 0 });
  });
  it('requires production pivot date and stable security identity', () => {
    const row = { symbol: 'A', cusip: '123456789', setup_recalculation: { status: 'calculated', as_of_date: second }, setup_engine: { pivot_date: first, pattern_primary: 'flat_base', pivot_type: 'base_high' } };
    expect(entryPivotIdentity(row, second)).not.toBeNull();
    expect(entryPivotIdentity({ ...row, cusip: null }, second)).toBeNull();
    expect(entryPivotIdentity({ ...row, setup_engine: { ...row.setup_engine, pivot_date: '2026-09-30' } }, second)).toBeNull();
  });
  it('reuses canonical price/pivot semantics for all real Radar fixture rows', () => {
    const asOf = fixture.as_of_date;
    const rows = fixture.ranked.map(({row}) => ({...row,technical_audit:{version:'ohlcv-v1',symbol:row.symbol,as_of_date:asOf,valid:true,errors:[],values:{close:row.current_price}}}));
    const current = entrySnapshot(rows, { asOf, previousSession: first, generatedAt: `${asOf}T22:00:00Z`, ruleVersion: 'test-policy', market: { state: 'unknown', cap: 0 } });
    for (const record of current.records) {
      const row = rows.find(item => item.symbol === record.symbol), position = entryPosition(row);
      expect(record.pivot).toBe(position.pivot); expect(record.distance).toBe(position.distance);
    }
  });
  it('never treats legacy selection snapshots as entry history', () => {
    expect(entryHistory([{ schema_version: 1, as_of: first, records: [] }], second).series).toEqual([]);
    expect(() => entryHistory([prior(), prior()], second)).toThrow('Duplicate');
  });
});

it('does not inherit a different security identity from holder evidence', () => {
 const row={symbol:'A',cusip:'123456789',setup_recalculation:{status:'calculated',as_of_date:second},setup_engine:{pivot_date:first,pattern_primary:'flat_base',pivot_type:'base_high'}};
 expect(entryPivotIdentity({...row,institutional_evidence:{symbol:'OTHER',cusip:'123456789'}},second)).toBeNull();
 expect(entryPivotIdentity({...row,institutional_evidence:{symbol:'A',cusip:'987654321'}},second)).toBeNull();
});

it('keeps known aggregate failures distinct from unresolved-only evidence', () => {
 const asOf='2026-09-29';
 const row={symbol:'AAA',market:'US',current_price:101,se_pivot_price:100,technical_audit:{version:'ohlcv-v1',symbol:'AAA',as_of_date:asOf,valid:true,errors:[],values:{close:101,sma150:200}}};
 const meta={asOf,generatedAt:asOf+'T22:00:00Z',ruleVersion:'test',market:{state:'unknown',cap:0}};
 const result=entrySnapshot([row],meta),summary=summarizeEntrySnapshot(result,null);
 expect(result.records[0].methods.minervini).toMatchObject({qualified:false,ready:false});
 expect(summary).toMatchObject({qualificationUnknown:0,readinessUnknown:0,qualifiedBreakoutRange:0,readyBreakoutRange:0});
 delete row.technical_audit.values.sma150;
 expect(entrySnapshot([row],meta).records[0].methods.minervini.qualified).toBeNull();
 const quarantined={...row,symbol:'BITU',company_name:'An unrelated corporation',technical_audit:{...row.technical_audit,symbol:'BITU'}};
 expect(entrySnapshot([quarantined],meta).records[0].methods.minervini.qualified).toBeNull();
});
