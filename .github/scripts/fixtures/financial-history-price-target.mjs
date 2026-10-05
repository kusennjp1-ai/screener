import assert from 'node:assert/strict';

// The archive fixture copies a published bundle instead of reacquiring data.
// This header is the destination analysis date (export-financial-history.py),
// not a source observation clock. Retain every nested source/history value and
// let the admitted carry own each current symbol's destination projection.
export function syntheticHistoryPriceTarget(history,previousDate,targetDate) {
  const day=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  assert.ok(day(previousDate)&&day(targetDate)&&targetDate>previousDate,'synthetic history target must advance the price date');
  assert.equal(history?.as_of_date,previousDate,'synthetic history must start at the published price date');
  assert.ok(history.results && typeof history.results==='object' && !Array.isArray(history.results),'synthetic history needs its retained results');
  return {...structuredClone(history),as_of_date:targetDate};
}
