import { describe, expect, it } from 'vitest';
import { entryPlan, entryPosition } from './researchEngine';
import { canonicalPivot } from './researchPresentation';
import { entrySourceContext } from './bookSourceContext';
import fixture from '../../tools/fixtures/radar-207-2026-09-29.json';

// Frozen pre-split entryPlan contract. The position-only path must not acquire
// different boundary, quote, stale-pivot or exclusion semantics over time.
function originalPlan(row, quote, method = 'minervini') {
  const price = Number.isFinite(quote?.price) && quote.price > 0 ? quote.price : row.current_price;
  const pivotInfo = canonicalPivot(row), pivot = pivotInfo.price, zone = method === 'minervini2' ? 3 : 5;
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(pivot) || pivot <= 0) return { state:pivotInfo.reason.includes('25%') ? '有効な買い水準なし' : '未判定', price, pivot:null, distance:null, pivotSource:pivotInfo.reason, sourceContext:entrySourceContext(method,zone,null) };
  const distance = (price / pivot - 1) * 100;
  return { price, pivot, distance, zone, upper:pivot * (1 + zone / 100), pivotSource:pivotInfo.reason, sourceContext:entrySourceContext(method,zone,distance),
    state:row.corporate_action?.cash_acquisition ? '現金買収合意・購入対象外' : row.price_activity?.lowRange ? '低変動・監視のみ' : distance < 0 ? 'ピボット待ち' : distance <= zone + 1e-9 ? '買いゾーン内' : '買いゾーン超過', stopExample:price * .93 };
}
function expectEquivalent(row, quote, method) {
  const expected = originalPlan(row, quote, method);
  expect(entryPlan(row, quote, method)).toEqual(expected);
  const position = { ...expected };
  delete position.sourceContext; delete position.upper; delete position.stopExample;
  expect(entryPosition(row, quote, method)).toEqual(position);
}
describe('shared entry position', () => {
  it('preserves the full plan and position fields for every real Radar row and method', () => {
    expect.hasAssertions();
    for (const { row } of fixture.ranked) for (const method of ['minervini','minervini2','oneil','ibd']) expectEquivalent(row, null, method);
  });
  it('preserves exact zone boundaries, quote fallback, pivot validation and exclusion precedence', () => {
    expect.hasAssertions();
    for (const method of ['minervini','minervini2','oneil','ibd']) {
      for (const price of [null,undefined,NaN,Infinity,-Infinity,'100',-1,0,74.99,75,99,100,102,103,103.0000000001,103.0000001,105,105.0000000001,105.0000001,125,125.01]) {
        for (const quote of [null,{price:102},{price:106},{price:NaN},{price:'102'},{price:0},{price:-1},{price:Infinity}]) {
          for (const excluded of [{},{corporate_action:{cash_acquisition:true}},{price_activity:{lowRange:true}},{corporate_action:{cash_acquisition:true},price_activity:{lowRange:true}}]) expectEquivalent({current_price:price,se_pivot_price:100,...excluded},quote,method);
        }
      }
      for (const pivot of [null,undefined,NaN,Infinity,-Infinity,'100',0,-1,75,100,125]) {
        for (const status of [{},{setup_recalculation:{status:'calculated'}},{setup_recalculation:{status:'unavailable'}},{price_quality:{status:'replaced'}}]) expectEquivalent({current_price:100,se_pivot_price:pivot,vcp_pivot:98,...status},null,method);
      }
    }
  });
  it('does not add plan-only fields to position consumers or reuse mutable plan state', () => {
    const row = {current_price:104,se_pivot_price:100};
    const position = entryPosition(row), plan = entryPlan(row);
    expect(position).not.toHaveProperty('sourceContext');
    expect(position).not.toHaveProperty('upper');
    expect(position).not.toHaveProperty('stopExample');
    expect(plan.sourceContext).toMatchObject({warning:true,state:'beyond'});
    plan.distance = -1;
    expect(position.distance).toBeCloseTo(4);
    expect(entryPosition(row)).toEqual(position);
  });
});
