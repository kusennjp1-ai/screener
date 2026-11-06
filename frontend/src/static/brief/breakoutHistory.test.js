import { describe, expect, it } from 'vitest';
import { breakoutEvent, candidateView } from './briefCandidate';
import { crossingEvent, CROSSING_LOOKBACK_SESSIONS, lastPivotCrossing, pivotCrossing, pivotCrossings, STALE_BREAKOUT_SESSIONS } from './breakoutHistory';
import { SELL_RULES } from './briefSell';
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
const sessionDay = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
/**
 * `closes` as certified bars ending on DATE (one per calendar day, which is all these tests need), each with
 * `volume(i)` (10,000 by default).
 */
const series = (closes, volume = () => 10000) => {
  const offset = Math.round((Date.parse(DATE) - Date.UTC(2026, 0, 1)) / 86400000) - (closes.length - 1);
  return closes.map((close, i) => ({ date: sessionDay(offset + i), close, volume: volume(i) }));
};

describe('round 1\'s 3-session crossing (pivotCrossing), kept for its callers', () => {
  it('dates a crossing 1 to 3 sessions back from certified bars, and nothing older or broken', () => {
    expect(pivotCrossing(bars([98, 99, 101, 102, 103]), 100)).toEqual({ date: '2026-09-22', sessionsAgo: 2 });
    expect(pivotCrossing(bars([98, 101, 102, 103, 104, 105]), 100)).toBeNull();
    expect(pivotCrossing(bars([98, 99, 101, 99, 102]), 100)).toBeNull();
    expect(pivotCrossing(bars([98, 99, 101, null, 102]), 100)).toBeNull();
    expect(pivotCrossing(null, 100)).toBeNull();
  });
});

// lastPivotCrossing's round-2 contract (its JSDoc; chart's CH7 builds against it): the latest bar, 0 to
// `lookback` (default 60) sessions back, whose close is at or above the pivot after a close under it; a
// crossing on the last bar is returned (sessionsAgo 0), and so is one followed by a close back under the
// pivot (VD2's failed breakout); volumeRatio is the crossing bar's volume over the average of the 50 bars
// before it, null with fewer than 50 or a volume missing.
describe('the last crossing of the current pivot (lastPivotCrossing)', () => {
  it('walks back up to 60 sessions to the latest crossing, with its bar index, and stays with the pivot it is given', () => {
    expect(CROSSING_LOOKBACK_SESSIONS).toBe(60);
    // 40 sessions under 100, then above it for 50: the crossing is 49 sessions back.
    const list = series([...Array(40).fill(95), ...Array(50).fill(103)]);
    expect(lastPivotCrossing(list, 100)).toMatchObject({ index: 40, date: list[40].date, sessionsAgo: 49 });
    // 61 sessions back is outside the default look-back; a longer one reaches it.
    const old = series([...Array(30).fill(95), ...Array(62).fill(103)]);
    expect(lastPivotCrossing(old, 100)).toBeNull();
    expect(lastPivotCrossing(old, 100, { lookback: 70 })).toMatchObject({ index: 30, sessionsAgo: 61 });
    // The current pivot only: the same bars against today's higher pivot cross later (re-detected daily).
    const steps = series([...Array(20).fill(95), ...Array(20).fill(101), ...Array(10).fill(106)]);
    expect(lastPivotCrossing(steps, 100)).toMatchObject({ index: 20, sessionsAgo: 29 });
    expect(lastPivotCrossing(steps, 105)).toMatchObject({ index: 40, sessionsAgo: 9 });
  });

  it('returns a crossing on the analysis day and one followed by a close back under the pivot; the same cents count as at', () => {
    expect(lastPivotCrossing(bars([98, 99, 101]), 100)).toMatchObject({ index: 2, sessionsAgo: 0 });
    expect(lastPivotCrossing(bars([98, 99, 101, 99, 98]), 100)).toMatchObject({ index: 2, date: '2026-09-22', sessionsAgo: 2 });
    expect(lastPivotCrossing(bars([98, 99, 100.004, 101]), 100)).toMatchObject({ index: 2 });
    // 99.996 is 100.00 to the cent: at the pivot, so the crossing is that bar's.
    expect(lastPivotCrossing(bars([98, 99.996, 101]), 100)).toMatchObject({ index: 1, sessionsAgo: 1 });
    expect(lastPivotCrossing(bars([101, 102, 103]), 100)).toBeNull();
  });

  it('gives null with a close missing between the crossing and the last bar, without bars or a pivot', () => {
    expect(lastPivotCrossing(bars([98, 99, 101, null, 102]), 100)).toBeNull();
    // A crossing after the gap is still told.
    expect(lastPivotCrossing(bars([98, null, 98, 101, 102]), 100)).toMatchObject({ index: 3, sessionsAgo: 1 });
    expect(lastPivotCrossing(null, 100)).toBeNull();
    expect(lastPivotCrossing(bars([98, 99, 101, 102, 103]), null)).toBeNull();
    // Options may be omitted or null (a destructuring default would throw on null); a bad look-back is the default.
    expect(lastPivotCrossing(bars([98, 99, 101, 102, 103]), 100, null)).toMatchObject({ index: 2, sessionsAgo: 2 });
    expect(lastPivotCrossing(bars([98, 101, 102, 103, 104, 105]), 100, { lookback: 0 })).toMatchObject({ index: 1, sessionsAgo: 4 });
    expect(lastPivotCrossing(bars([98, 101, 102, 103, 104, 105]), 100, { lookback: 2.5 })).toMatchObject({ index: 1 });
    expect(lastPivotCrossing(bars([98, 101, 102, 103, 104, 105]), 100, { lookback: 2 })).toBeNull();
  });

  it('measures the crossing day\'s volume against the 50 sessions before it, and leaves it null (never 0) on a short or broken window', () => {
    const closes = [...Array(55).fill(95), ...Array(5).fill(103)];
    const heavy = series(closes, i => (i === 55 ? 22000 : 10000));
    expect(lastPivotCrossing(heavy, 100)).toMatchObject({ index: 55, sessionsAgo: 4 });
    expect(lastPivotCrossing(heavy, 100).volumeRatio).toBeCloseTo(2.2, 9);
    // Fewer than 50 bars before the crossing.
    expect(lastPivotCrossing(series([...Array(49).fill(95), 103, 104], () => 10000), 100)).toMatchObject({ index: 49, volumeRatio: null });
    expect(lastPivotCrossing(series([...Array(50).fill(95), 103, 104], () => 10000), 100).volumeRatio).toBe(1);
    // A volume missing (or 0, a gap) on the crossing day or in the window before it.
    for (const at of [55, 30]) for (const gap of [null, 0, undefined]) {
      expect(lastPivotCrossing(series(closes, i => (i === at ? gap : 10000)), 100).volumeRatio).toBeNull();
    }
    // A missing volume after the crossing does not matter.
    expect(lastPivotCrossing(series(closes, i => (i === 58 ? null : 10000)), 100).volumeRatio).toBe(1);
    // Every crossing in the window, the latest first.
    const twice = series([...Array(55).fill(95), 103, 97, 98, 103, 104], i => (i === 55 ? 30000 : 10000));
    expect(pivotCrossings(twice, 100, { lookback: 10 }).map(c => [c.sessionsAgo, Math.round(c.volumeRatio * 100) / 100])).toEqual([[1, 0.96], [4, 3]]);
  });
});

describe('the conclusion\'s event (crossingEvent)', () => {
  const after = () => verdict(audited('C', { price: 103, change: 1, volume: 2 }));
  // Above the pivot (100) the day before, 103 on DATE: the crossing is `ago` sessions back.
  const crossedAgo = (ago, total = 70) => series([...Array(total - ago - 1).fill(95), ...Array(ago).fill(102), 103]);

  it('is breakoutEvent\'s own event for every kind but an after event', () => {
    for (const row of [audited('A', { price: 101, change: 2, volume: 1.6 }), audited('B', { price: 101, change: -1, volume: 1.6 }), audited('D', { price: 100, change: 2, volume: 1.6 }), audited('T', { price: 101, change: 2, volume: 1.2 })]) {
      const v = verdict(row);
      expect(crossingEvent(v)).toEqual(breakoutEvent(v));
      expect(crossingEvent(v, bars([98, 99, 101, 102, 103]))).toEqual(breakoutEvent(v));
    }
    const stale = audited('F', { price: 101 });
    stale.technical_audit.as_of_date = '2026-10-01';
    expect(crossingEvent(verdict(stale), bars([98, 99, 101, 102, 103]))).toBeNull();
  });

  it('dates an after event within the stale window from certified bars: green, with the crossing', () => {
    expect(breakoutEvent(after()).kind).toBe('after');
    for (const ago of [1, 2, STALE_BREAKOUT_SESSIONS]) {
      const list = crossedAgo(ago), event = crossingEvent(after(), list);
      const day = `${Number(list.at(-1 - ago).date.slice(5, 7))}/${Number(list.at(-1 - ago).date.slice(8))}`;
      expect(event).toMatchObject({ kind: 'after', tone: 'zone', title: `買いゾーン内（${day}に上抜け・${ago}営業日前）`, crossed: { sessionsAgo: ago } });
    }
  });

  it('turns wait after the stale window (10 sessions, 独自判定): 上抜けから N営業日・伸びずに停滞', () => {
    expect(SELL_RULES.staleBreakoutSessions).toBe(STALE_BREAKOUT_SESSIONS);
    expect(STALE_BREAKOUT_SESSIONS).toBe(10);
    const event = crossingEvent(after(), crossedAgo(11));
    expect(event).toMatchObject({ kind: 'stale', tone: 'wait', title: '上抜けから11営業日・伸びずに停滞（新規は次のピボット待ち）', crossed: { sessionsAgo: 11 } });
    expect(event.note).toBe(`${event.crossed.date.slice(5).replace(/^0/, '').replace(/-0?/, '/')}に上抜け・停滞の判定は10営業日超（独自判定）。`);
    expect(crossingEvent(after(), crossedAgo(25)).title).toBe('上抜けから25営業日・伸びずに停滞（新規は次のピボット待ち）');
    // A caller's window (the owner's setting) moves the switch.
    expect(crossingEvent(after(), crossedAgo(11), { staleSessions: 15 }).kind).toBe('after');
  });

  it('never dates without certified bars of the analysis day or a crossing within 60 sessions: 上抜け日 未確認, in tone wait', () => {
    const undated = { kind: 'undated', tone: 'wait', title: '買いゾーン内（上抜け日 未確認）', crossed: null };
    expect(crossingEvent(after())).toMatchObject(undated);
    expect(crossingEvent(after(), crossedAgo(61, 90))).toMatchObject(undated);
    // Bars that end on another day are not the analysis day's.
    expect(crossingEvent(after(), crossedAgo(3).slice(0, -1))).toMatchObject(undated);
    // A crossing on the analysis day contradicts an after event (the close before it was above): undated.
    expect(crossingEvent(after(), series([...Array(60).fill(95), 103]))).toMatchObject(undated);
    expect(crossingEvent(after()).note).toBe('上抜けの日を検証済みの日足で確認できないため、買いの裏付けはありません。');
  });
});
