import { describe, expect, it } from 'vitest';
import { breakoutEvent, candidateView } from './briefCandidate';
import { crossingEvent, lastPivotCrossing, pivotCrossing } from './breakoutHistory';
import { withAuditFixture } from '../testAuditFixture';

const DATE = '2026-10-02';
/** A research row whose daily bars the publisher verified for DATE (the synthetic audit), with its own day change and volume. */
const audited = (symbol, { price = 100, pivot = 100, change = 2, volume = 1.6, rs = 90, ...extra } = {}) => {
  const row = withAuditFixture({ symbol, market: 'US', currency: 'USD', company_name: symbol, current_price: price, se_pivot_price: pivot, rs_rating: rs, ...extra }, DATE);
  Object.assign(row.technical_audit.values, { change, volumeRatio: volume });
  return row;
};
const verdict = (row, assessment = { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 }) => candidateView({ row, assessment }, DATE);
const bars = closes => closes.map((close, i) => ({ date: `2026-09-${String(20 + i).padStart(2, '0')}`, close }));

describe('the analysis day as an event (verified change and volume only)', () => {
  it('dates a crossing 1 to 3 sessions back from certified bars, and nothing older or broken', () => {
    const bars = closes => closes.map((close, i) => ({ date: `2026-09-${String(20 + i).padStart(2, '0')}`, close }));
    expect(pivotCrossing(bars([98, 99, 101, 102, 103]), 100)).toEqual({ date: '2026-09-22', sessionsAgo: 2 });
    expect(pivotCrossing(bars([98, 101, 102, 103, 104, 105]), 100)).toBeNull();
    expect(pivotCrossing(bars([98, 99, 101, 99, 102]), 100)).toBeNull();
    expect(pivotCrossing(bars([98, 99, 101, null, 102]), 100)).toBeNull();
    expect(pivotCrossing(null, 100)).toBeNull();
    const v = verdict(audited('H', { price: 103, change: 1 }));
    expect(crossingEvent(v, bars([98, 99, 101, 102, 103])).title).toBe('買いゾーン内（9/22に上抜け・2営業日前）');
  });
});

// The round-2 seams (plan §2.2) as step 0 leaves them; verdict's VD1 extends them.
// lastPivotCrossing's round-2 target (its JSDoc; VD1 and VD2 write it): the latest bar, 0 to `lookback`
// (default 60) sessions back, whose close is at or above the pivot after a close under it; a crossing on
// the last bar is returned (sessionsAgo 0), and so is one followed by a close back under the pivot (VD2's
// failed breakout); volumeRatio is the crossing bar's volume over the average of the 50 bars before it,
// null with fewer than 50 or a volume missing. The expectations below that differ under that body (the
// last-bar, back-under and 3-session cases) are verdict's to rewrite; the 1-to-3-sessions-back case with
// every close since above the pivot holds under both.
describe('the crossing seams at step 0', () => {
  it('lastPivotCrossing is the 3-session crossing with its bar index, and no volume ratio (null, never 0)', () => {
    const withVolume = closes => bars(closes).map(bar => ({ ...bar, volume: 1000 }));
    expect(lastPivotCrossing(bars([98, 99, 101, 102, 103]), 100)).toEqual({ index: 2, date: '2026-09-22', sessionsAgo: 2, volumeRatio: null });
    expect(lastPivotCrossing(withVolume([98, 99, 101, 102, 103]), 100)).toEqual({ index: 2, date: '2026-09-22', sessionsAgo: 2, volumeRatio: null });
    // The look-back is 3 sessions by default; a longer one reaches further, still with its index.
    expect(lastPivotCrossing(bars([98, 101, 102, 103, 104, 105]), 100)).toBeNull();
    expect(lastPivotCrossing(bars([98, 101, 102, 103, 104, 105]), 100, { lookback: 4 })).toEqual({ index: 1, date: '2026-09-21', sessionsAgo: 4, volumeRatio: null });
    // Nothing on the last bar itself (that is the day's own event), after a close back under, or with a close missing.
    expect(lastPivotCrossing(bars([98, 99, 101]), 100)).toBeNull();
    expect(lastPivotCrossing(bars([98, 99, 101, 99, 102]), 100)).toBeNull();
    expect(lastPivotCrossing(bars([98, 99, 101, null, 102]), 100)).toBeNull();
    expect(lastPivotCrossing(null, 100)).toBeNull();
    expect(lastPivotCrossing(bars([98, 99, 101, 102, 103]), null)).toBeNull();
    // Options may be omitted or null (a destructuring default would throw on null); a bad look-back is the default.
    expect(lastPivotCrossing(bars([98, 99, 101, 102, 103]), 100, null)).toEqual({ index: 2, date: '2026-09-22', sessionsAgo: 2, volumeRatio: null });
    expect(lastPivotCrossing(bars([98, 101, 102, 103, 104, 105]), 100, { lookback: 0 })).toBeNull();
    expect(lastPivotCrossing(bars([98, 101, 102, 103, 104, 105]), 100, { lookback: 2.5 })).toBeNull();
  });

  it('crossingEvent is the round-1 conclusion event: breakoutEvent(view), with an after event dated from the bars', () => {
    // Every other event is breakoutEvent's own, whatever the bars.
    for (const row of [audited('A', { price: 101, change: 2, volume: 1.6 }), audited('B', { price: 101, change: -1, volume: 1.6 }), audited('D', { price: 100, change: 2, volume: 1.6 }), audited('T', { price: 101, change: 2, volume: 1.2 })]) {
      const v = verdict(row);
      expect(crossingEvent(v)).toEqual(breakoutEvent(v));
      expect(crossingEvent(v, bars([98, 99, 101, 102, 103]))).toEqual(breakoutEvent(v));
    }
    const stale = audited('F', { price: 101 });
    stale.technical_audit.as_of_date = '2026-10-01';
    expect(crossingEvent(verdict(stale), bars([98, 99, 101, 102, 103]))).toBeNull();
    // Already above the pivot the day before: undated without bars or without a crossing in them, dated with one.
    const after = verdict(audited('C', { price: 102, change: 1, volume: 2 }));
    expect(breakoutEvent(after).kind).toBe('after');
    expect(crossingEvent(after)).toEqual({ ...breakoutEvent(after), crossed: null });
    expect(crossingEvent(after, bars([98, 101, 102, 103, 104, 105]))).toEqual({ ...breakoutEvent(after), crossed: null });
    expect(crossingEvent(after, bars([98, 99, 101, 102, 103]))).toMatchObject({ kind: 'after', tone: 'zone', crossed: { date: '2026-09-22', sessionsAgo: 2 } });
  });
});
