import { describe, expect, it } from 'vitest';
import { BREAKOUT_VOLUME_RATIO, breakoutEvent, candidateView, LIST_FILTERS, ratioShown, rowEvent, TOUCH_HELD_NOTE, UNDATED_EVENT } from './briefCandidate';
import { chartCrossing } from './chartReadout';
import { breakoutBar, crossingEvent, CROSSING_LOOKBACK_SESSIONS, lastPivotCrossing, pivotCrossings, STALE_BREAKOUT_SESSIONS } from './breakoutHistory';
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
  const md = iso => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`;
  /**
   * Above the pivot (100) the day before, 103 on DATE: the crossing is `ago` sessions back, on `ratio` times the
   * 50 sessions before it (1.6× by default: a breakout on the volume), each close since at `held` (102).
   */
  const crossedAgo = (ago, { total = 70, ratio = 1.6, held = 102 } = {}) => {
    const at = total - ago - 1;
    return series([...Array(at).fill(95), ...Array(ago).fill(held), 103], i => (i === at ? (ratio === null ? null : 10000 * ratio) : 10000));
  };

  it('is breakoutEvent\'s own event for every kind but the ones the rows cannot date (after, undated, touchHeld)', () => {
    for (const row of [audited('A', { price: 101, change: 2, volume: 1.6 }), audited('B', { price: 101, change: -1, volume: 1.6 }), audited('D', { price: 100, change: 2, volume: 1.6 }), audited('T', { price: 101, change: 2, volume: 1.2 })]) {
      const v = verdict(row);
      expect(crossingEvent(v)).toEqual(breakoutEvent(v));
      expect(crossingEvent(v, bars([98, 99, 101, 102, 103]))).toEqual(breakoutEvent(v));
    }
    const stale = audited('F', { price: 101 });
    stale.technical_audit.as_of_date = '2026-10-01';
    expect(crossingEvent(verdict(stale), bars([98, 99, 101, 102, 103]))).toBeNull();
  });

  it('dates an after event within the stale window from certified bars: green only on the crossing day\'s volume (1.4× or more)', () => {
    expect(breakoutEvent(after()).kind).toBe('after');
    for (const ago of [1, 2, STALE_BREAKOUT_SESSIONS]) for (const ratio of [1.6, BREAKOUT_VOLUME_RATIO]) {
      const list = crossedAgo(ago, { ratio }), event = crossingEvent(after(), list);
      expect(event).toMatchObject({ kind: 'after', tone: 'zone', title: `${md(list.at(-1 - ago).date)}に上抜け・${ago}営業日前`, crossed: { sessionsAgo: ago } });
    }
  });

  it('waits when the crossing day traded under 1.4× or its volume is unknown, as on the crossing day itself', () => {
    const light = crossedAgo(2, { ratio: 0.8 }), day = md(light.at(-3).date);
    expect(crossingEvent(after(), light)).toMatchObject({ kind: 'afterLight', tone: 'wait', title: `${day}に上抜け・出来高不足`,
      note: `上抜けの日の出来高${ratioShown(0.8)}は基準の${BREAKOUT_VOLUME_RATIO}×に届きません。`, crossed: { sessionsAgo: 2 } });
    expect(crossingEvent(after(), crossedAgo(2, { ratio: 1.39 })).kind).toBe('afterLight');
    expect(crossingEvent(after(), crossedAgo(2, { ratio: null }))).toMatchObject({ kind: 'afterUnconfirmed', tone: 'wait', title: `${day}に上抜け・出来高 未確認`,
      note: '上抜けの日の出来高を確認できないため、上抜けの裏付けはありません。', crossed: { volumeRatio: null } });
    // Fewer than 50 sessions before the crossing: its volume cannot be compared, so unconfirmed, never green.
    expect(crossingEvent(after(), crossedAgo(2, { total: 40 })).kind).toBe('afterUnconfirmed');
    // A heavy crossing, a dip under the pivot, then a light re-cross: the clock is the re-cross's, and it waits.
    const recross = series([...Array(55).fill(95), 103, 97, 102, 102, 103], i => (i === 55 ? 30000 : 10000));
    expect(crossingEvent(after(), recross)).toMatchObject({ kind: 'afterLight', crossed: { sessionsAgo: 2 } });
  });

  it('turns wait after the stale window (10 sessions, 独自判定): a stall, or a pullback to the pivot after a run above the zone', () => {
    expect(SELL_RULES.staleBreakoutSessions).toBe(STALE_BREAKOUT_SESSIONS);
    expect(STALE_BREAKOUT_SESSIONS).toBe(10);
    const list = crossedAgo(11), event = crossingEvent(after(), list);
    expect(event).toMatchObject({ kind: 'stale', tone: 'wait', title: '上抜けから11営業日・停滞（次のピボット待ち）', crossed: { sessionsAgo: 11 } });
    expect(event.note).toBe(`新規の買いは見送り。${md(list.at(-12).date)}に上抜け、10営業日を超えて伸びないため停滞（独自判定）。`);
    expect(crossingEvent(after(), crossedAgo(25)).title).toBe('上抜けから25営業日・停滞（次のピボット待ち）');
    // Light volume does not matter once the window has passed.
    expect(crossingEvent(after(), crossedAgo(11, { ratio: 0.8 })).kind).toBe('stale');
    // A close since the crossing above the zone's top (+5%: 105 here) and back: a pullback to the pivot, not a stall.
    const run = crossedAgo(15, { held: 102 });
    run[run.length - 6].close = 115;
    const pulled = crossingEvent(after(), run);
    expect(pulled).toMatchObject({ kind: 'stale', tone: 'wait', title: '上抜けから15営業日・押し戻し（次のピボット待ち）' });
    expect(pulled.note).toBe(`新規の買いは見送り。${md(run.at(-16).date)}に上抜け、ピボット比 +15.0%まで伸びた後に買いゾーンへ戻りました（10営業日超・独自判定）。`);
    // The run's height and the rule with its label are the parts a phone line never splits.
    expect(pulled.units).toEqual(['ピボット比 +15.0%', '（10営業日超・独自判定）']);
    expect(event.units).toEqual([]);
    // A caller's window (the owner's setting) moves the switch.
    expect(crossingEvent(after(), crossedAgo(11), { staleSessions: 15 }).kind).toBe('after');
  });

  it('calls a stock above its pivot for more than 60 sessions stale (60営業日超), never undated', () => {
    const long = series([...Array(10).fill(95), ...Array(69).fill(102), 103]);
    const event = crossingEvent(after(), long);
    expect(event).toMatchObject({ kind: 'stale', tone: 'wait', title: '上抜けから60営業日超・停滞（次のピボット待ち）', crossed: null });
    expect(event.note).toBe('新規の買いは見送り。60営業日を超えてピボットの上にあり、伸びないため停滞（独自判定）。');
    long[30].close = 112;
    expect(crossingEvent(after(), long).title).toBe('上抜けから60営業日超・押し戻し（次のピボット待ち）');
    // Every close above, but fewer bars than the window: it cannot be told how long, so undated.
    expect(crossingEvent(after(), series([...Array(40).fill(102), 103])).kind).toBe('undated');
  });

  it('dates a breakout after a touch at the pivot\'s cents from the first close above it, on that close\'s volume (breakoutBar)', () => {
    // 60 sessions under 100, a touch at exactly 100.00 on 2.2× (not a breakout), then 101 on the day after.
    const touched = ratio => series([...Array(60).fill(95), 100, 101, 102, 102, 103], i => (i === 60 ? 22000 : i === 61 ? Math.round(10240 * ratio) : 10000));
    const light = touched(1);
    expect(breakoutBar(light, 100, lastPivotCrossing(light, 100))).toMatchObject({ index: 61, date: light[61].date, sessionsAgo: 3 });
    // The touch's 2.2× never makes it green: the breakout day itself traded about 1.0×.
    expect(crossingEvent(after(), light)).toMatchObject({ kind: 'afterLight', tone: 'wait', title: `${md(light[61].date)}に上抜け・出来高不足`, crossed: { index: 61, sessionsAgo: 3 } });
    // On the volume, the breakout is dated from that first close above, green.
    const heavy = touched(2);
    expect(crossingEvent(after(), heavy)).toMatchObject({ kind: 'after', tone: 'zone', title: `${md(heavy[61].date)}に上抜け・3営業日前`, crossed: { index: 61 } });
    // A crossing that closed above the pivot is its own breakout.
    const plain = crossedAgo(2), crossing = lastPivotCrossing(plain, 100);
    expect(breakoutBar(plain, 100, crossing)).toBe(crossing);
    // A touch the day before and the first close above on the analysis day: the rows cannot tell it from a rise after an
    // earlier breakout (undated), the bars can: that day's breakout, said as breakoutEvent says one after a close under
    // the pivot (`touched`), on the day's verified volume.
    const today = series([...Array(60).fill(95), 100, 103], i => (i === 61 ? 20480 : 10000));
    const touchedBefore = verdict(audited('TB', { price: 103, change: 3, volume: 2.048 }));
    expect(breakoutEvent(touchedBefore)).toEqual(UNDATED_EVENT);
    expect(crossingEvent(touchedBefore, today)).toEqual(breakoutEvent(touchedBefore, { touched: true }));
    expect(crossingEvent(touchedBefore, today)).toMatchObject({ kind: 'breakout', tone: 'zone', title: `${md(today[61].date)}に上抜け・出来高${ratioShown(2.048)}` });
    // An after event (the close before above the pivot's cents) whose bars date a breakout on the analysis day contradicts them: undated.
    expect(crossingEvent(after(), today)).toMatchObject({ kind: 'undated', tone: 'wait', crossed: null });
  });

  it('reads a close above the pivot after one at its cents from the bars: the rows say 未確認, the conclusion and the chart date it', () => {
    // A pivot of 108.57, the close before it at that cent and the analysis day's 110.74 on 2×: the previous close the rows
    // rebuild from the close and the change sits a float's width either side of the pivot.
    const pivot = 108.57, change = (110.74 / pivot - 1) * 100;
    const base = { setup_recalculation: { status: 'calculated', as_of_date: DATE }, se_pattern_confidence: 60 };
    const v = verdict(audited('ZT', { price: 110.74, pivot, change, volume: 2, ...base }));
    expect(Math.round(v.prevClose * 100)).toBe(10857);
    // The rows: a touch from below and a pullback onto the pivot after an earlier breakout read the same from the day's two
    // closes, so neither is the day's breakout there: no ↗, no green, 未確認 for the 上抜け filter (never a miss).
    expect(breakoutEvent(v)).toEqual(UNDATED_EVENT);
    expect(rowEvent(v)).toEqual({ kind: 'undated', glyph: '●', text: '上抜け日 未確認', tone: 'wait' });
    expect([LIST_FILTERS.breakout.test(v), LIST_FILTERS.breakout.unknown(v)]).toEqual([false, true]);
    // (1) A touch from below (the closes before the touch under the pivot): the analysis day's breakout in the conclusion
    // (green on the day's 2×) and on the chart (its arrow on the last bar, green).
    const touch = series([...Array(60).fill(105), pivot, 110.74], i => (i === 61 ? 20000 : 10000));
    expect(crossingEvent(v, touch)).toEqual(breakoutEvent(v, { touched: true }));
    expect(crossingEvent(v, touch)).toMatchObject({ kind: 'breakout', tone: 'zone', title: `10/2に上抜け・出来高${ratioShown(2)}` });
    expect(chartCrossing(touch, pivot)).toMatchObject({ date: DATE, sessionsAgo: 0, tone: 'zone' });
    // (2) A breakout `ago` sessions back on `ratio`, closes above the pivot since, a pullback onto its cent the day before,
    // then the analysis day's close above it on 2×: the stock was already above the pivot, so the conclusion dates the
    // earlier breakout on that bar's volume, as the chart's arrow does, and never says the analysis day broke out.
    const pullback = (ago, ratio = 2) => series([...Array(68 - ago).fill(105), ...Array(ago - 1).fill(111), pivot, 110.74],
      i => (i === 68 - ago ? 10000 * ratio : i === 69 ? 20000 : 10000));
    for (const [ago, ratio, kind, tone] of [[2, 2, 'after', 'zone'], [5, 2, 'after', 'zone'], [5, 1, 'afterLight', 'wait'], [12, 2, 'stale', 'wait']]) {
      const list = pullback(ago, ratio), event = crossingEvent(v, list), chart = chartCrossing(list, pivot);
      expect({ ago, ratio, ...event }).toMatchObject({ ago, ratio, kind, tone, crossed: { sessionsAgo: ago } });
      expect([chart.date, chart.sessionsAgo, chart.tone]).toEqual([event.crossed.date, ago, tone === 'zone' ? 'zone' : 'neutral']);
      expect(event.title).not.toContain('10/2');
      if (kind !== 'stale') expect(event.title.startsWith(md(list[68 - ago].date))).toBe(true);
    }
    expect(crossingEvent(v, pullback(12)).title).toBe('上抜けから12営業日・停滞（次のピボット待ち）');
    // Without certified bars of the day: undated, never green.
    expect(crossingEvent(v)).toMatchObject({ ...UNDATED_EVENT, crossed: null });
    // Whichever side of the cent the rebuilt close falls, the event is the same (it hung on that noise before).
    for (const prevClose of [99.999, 100, 100.0000001, 100.004]) {
      expect(breakoutEvent({ ...v, pivot: 100, close: 101, prevClose, change: 1, volumeRatio: 2 }).kind).toBe('undated');
      expect(breakoutEvent({ ...v, pivot: 100, close: 101, prevClose, change: 1, volumeRatio: 2 }, { touched: true }).kind).toBe('breakout');
    }
    // A close before above the pivot's cents is an after event; under them it is the day's breakout, bars or not.
    expect(breakoutEvent({ ...v, pivot: 100, close: 101, prevClose: 100.006, change: 1, volumeRatio: 2 }).kind).toBe('after');
    expect(breakoutEvent({ ...v, pivot: 100, close: 101, prevClose: 99.99, change: 1, volumeRatio: 2 }).kind).toBe('breakout');
  });

  it('words two closes at the pivot\'s cents by the bars: ピボット到達 after a touch from below, the earlier breakout after a pullback', () => {
    // Two closes at the pivot's cents: the rows' touchHeld (never 'after', never green), told apart by the conclusion.
    const resting = verdict(audited('R', { price: 100, change: 0, volume: 1 }));
    expect(breakoutEvent(resting)).toMatchObject({ kind: 'touchHeld', tone: 'wait', title: 'ピボットと同値のまま' });
    expect(rowEvent(resting)).toEqual({ kind: 'touchHeld', glyph: '●', text: 'ピボットと同値のまま', tone: 'wait' });
    const list = series([...Array(60).fill(95), 100, 100, 100], i => (i === 60 ? 22000 : 10000));
    expect(breakoutBar(list, 100, lastPivotCrossing(list, 100))).toBeNull();
    expect(crossingEvent(resting, list)).toMatchObject({ kind: 'afterTouch', tone: 'wait', title: 'ピボット到達から2営業日', crossed: null });
    // The touch's own day is green (rows' touch); after it the note dates the touch and says that green was that day's only.
    expect(crossingEvent(resting, list).note).toBe(`${md(list[60].date)}にピボットに届いた後、${TOUCH_HELD_NOTE}`);
    expect(TOUCH_HELD_NOTE).toContain('緑はピボット到達の当日のみ・独自判定');
    // Without bars that date the touch, the rows' words, never green, and no claim the bars did not show.
    const undated = crossingEvent(resting);
    expect(undated).toMatchObject({ kind: 'touchHeld', tone: 'wait', title: 'ピボットと同値のまま', crossed: null });
    expect(undated.note).toBe('ピボットに届いた日を検証済みの日足で確認できないため、買いの裏付けはありません。');
    expect(chartCrossing(list, 100)).toBeNull();
    // A breakout, closes above the pivot, then two closes back on its cents: the stock was above the pivot, so the earlier
    // breakout is dated from its bar (green on its volume within the stale window, as the chart's arrow), never
    // 「ピボット到達」 and never a note that no close went above the pivot.
    for (const [ago, kind, tone] of [[4, 'after', 'zone'], [13, 'stale', 'wait']]) {
      const back = series([...Array(66 - ago).fill(95), ...Array(ago - 1).fill(103), 100, 100], i => (i === 66 - ago ? 20000 : 10000));
      const event = crossingEvent(resting, back), chart = chartCrossing(back, 100);
      expect({ ago, ...event }).toMatchObject({ ago, kind, tone, crossed: { sessionsAgo: ago } });
      expect([chart.date, chart.tone]).toEqual([event.crossed.date, tone === 'zone' ? 'zone' : 'neutral']);
      expect(`${event.title}${event.note ?? ''}`).not.toMatch(/ピボット到達|上回っていない|同値のまま/);
    }
    // A touch that fell back under the pivot has no breakout either.
    const fell = series([...Array(60).fill(95), 100, 99, 98]);
    expect(breakoutBar(fell, 100, lastPivotCrossing(fell, 100))).toBeNull();
  });

  it('never dates without certified bars of the analysis day or with a close missing: 上抜け日 未確認, in tone wait', () => {
    const undated = { kind: 'undated', tone: 'wait', title: '買いゾーン内（上抜け日 未確認）', crossed: null };
    expect(crossingEvent(after())).toMatchObject(undated);
    // Bars that end on another day are not the analysis day's.
    expect(crossingEvent(after(), crossedAgo(3).slice(0, -1))).toMatchObject(undated);
    // A close missing since the crossing: it cannot be told.
    const gap = crossedAgo(3);
    gap[gap.length - 2].close = null;
    expect(crossingEvent(after(), gap)).toMatchObject(undated);
    // A crossing on the analysis day contradicts an after event (the close before it was above): undated.
    expect(crossingEvent(after(), series([...Array(60).fill(95), 103]))).toMatchObject(undated);
    expect(crossingEvent(after()).note).toBe('上抜けの日を検証済みの日足で確認できないため、買いの裏付けはありません。');
  });
});
