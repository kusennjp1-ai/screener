import { describe, expect, it } from 'vitest';
import { ACTIVITY_ADR_SESSIONS, GAP_MOVE_PERCENT, LOW_ACTIVITY_UNKNOWN_REASON, LOW_ADR_PERCENT, LOW_RANGE_PERCENT, lowActivityReason, PRICE_ACTIVITY_SESSIONS,
  priceActivity, SINCE_GAP_MIN_SESSIONS, SINCE_GAP_RANGE_PERCENT } from './priceActivity.js';
import { ADR_SESSIONS, adrPercent } from './brief/positionSizing.js';
import { entryPlan, rankCandidates } from './researchEngine.js';
import { decodeResearchIndex, encodeResearchIndex, researchListRow } from './researchTransport.js';

// The exporter's inline computation before the move (tools/export-research.mjs at 8849bf9), kept verbatim as the
// reference the module's first two keys must reproduce byte for byte (STEP 0 helper H2 was a pure move; round 3 R2 only
// adds keys after them).
function exporterBefore(valid, bars) {
  const recent60 = valid ? bars.slice(-60) : [];
  const range60 = recent60.length === 60 ? (Math.max(...recent60.map(b=>b.high))/Math.min(...recent60.map(b=>b.low))-1)*100 : null;
  return {range60pct:range60,lowRange:range60 != null && range60 < 5};
}
const firstTwo = activity => JSON.stringify({ range60pct: activity.range60pct, lowRange: activity.lowRange });

const day = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const series = (n, fn) => Array.from({ length: n }, (_, i) => ({ date: day(i), ...fn(i) }));
/** A bar with a close in the middle of its high/low. */
const bar = (close, spread = 0.02) => ({ open: close, high: close * (1 + spread / 2), low: close * (1 - spread / 2), close });
/** `before` sessions moving ±3% a day, then a one-day move of `gap` %, then `after` sessions pinned within `pin` % (ADR `pin`). */
function gapped({ before = 80, gap = 40, after = 25, pin = 0.004 } = {}) {
  const bars = series(before, i => bar(20 * (1 + 0.03 * Math.sin(i)), 0.04));
  const level = bars.at(-1).close * (1 + gap / 100);
  bars.push({ date: day(before), ...bar(level, pin) });
  for (let i = 1; i <= after; i++) bars.push({ date: day(before + i), ...bar(level * (1 + (i % 2 ? pin / 4 : -pin / 4)), pin) });
  return bars;
}

describe('priceActivity: the first two keys are the exporter\'s', () => {
  it('keeps the constants the exporter used', () => {
    expect([PRICE_ACTIVITY_SESSIONS, LOW_RANGE_PERCENT]).toEqual([60, 5]);
  });

  const cases = {
    'a wide 60-session range': series(80, i => ({ high: 20 + i * 0.3, low: 19 + i * 0.3 })),
    'a narrow range (low activity)': series(70, i => ({ high: 50 + (i % 3) * 0.1, low: 49.5 })),
    'exactly 60 bars': series(60, i => ({ high: 10 + i, low: 9 + i })),
    'a range of exactly 5%': series(60, () => ({ high: 105, low: 100 })),
    'fewer than 60 bars': series(59, i => ({ high: 10 + i, low: 9 })),
    'no bars': [],
    'a missing high in the window': series(65, i => ({ high: i === 64 ? undefined : 30, low: 29 })),
  };
  for (const [name, bars] of Object.entries(cases)) {
    it(`gives the exporter's first two keys for ${name}`, () => {
      const activity = priceActivity(bars);
      expect(Object.keys(activity).slice(0, 2)).toEqual(['range60pct', 'lowRange']);
      expect(firstTwo(activity)).toBe(JSON.stringify(exporterBefore(true, bars)));
    });
  }

  it('gives the exporter\'s first two keys for bars the audit refused (null), and no figure', () => {
    expect(firstTwo(priceActivity(null))).toBe(JSON.stringify(exporterBefore(false, [])));
    expect(priceActivity(null)).toEqual({ range60pct: null, lowRange: false, reason: null, adr20pct: null, gap: null });
  });

  it('never calls a missing range low activity', () => {
    expect(priceActivity(series(10, () => ({ high: 1, low: 1 }))).lowRange).toBe(false);
    expect(priceActivity(undefined).lowRange).toBe(false);
  });
});

describe('priceActivity: low activity since a gap and by ADR20 (round 3 R2)', () => {
  it('names its 独自設定 constants', () => {
    expect([ACTIVITY_ADR_SESSIONS, LOW_ADR_PERCENT, GAP_MOVE_PERCENT, SINCE_GAP_RANGE_PERCENT, SINCE_GAP_MIN_SESSIONS]).toEqual([20, 0.5, 10, 3, 15]);
    // The ADR window is the plan's (positionSizing ADR_SESSIONS).
    expect(ACTIVITY_ADR_SESSIONS).toBe(ADR_SESSIONS);
  });

  it('flags a gap inside the window that pins, with its figures', () => {
    const bars = gapped({ gap: 40, after: 25, pin: 0.004 });
    const activity = priceActivity(bars);
    expect(activity.range60pct).toBeGreaterThan(LOW_RANGE_PERCENT);
    expect(activity).toMatchObject({ lowRange: true, reason: 'since_gap', gap: { date: bars.at(-26).date, sessions: 25 } });
    expect(activity.gap.pct).toBeCloseTo(40, 6);
    expect(activity.gap.rangePct).toBeLessThan(SINCE_GAP_RANGE_PERCENT);
    expect(activity.adr20pct).toBeCloseTo(adrPercent(bars), 12);
    expect(Object.keys(activity)).toEqual(['range60pct', 'lowRange', 'reason', 'adr20pct', 'gap']);
  });

  it('reads a fall as a gap too, signed', () => {
    const activity = priceActivity(gapped({ gap: -30, after: 20 }));
    expect(activity).toMatchObject({ lowRange: true, reason: 'since_gap' });
    expect(activity.gap.pct).toBeCloseTo(-30, 6);
  });

  it('does not read a gap older than 60 sessions', () => {
    // The pin lasts 70 sessions, so the gap's bar is outside the last 60 one-day moves; the pin's ADR is above the ADR rule.
    const activity = priceActivity(gapped({ gap: 40, after: 70, pin: 0.012 }));
    expect(activity.reason).not.toBe('since_gap');
    expect(activity.gap).toBeNull();
  });

  it('needs SINCE_GAP_MIN_SESSIONS sessions after the gap', () => {
    const short = priceActivity(gapped({ gap: 40, after: SINCE_GAP_MIN_SESSIONS - 1, pin: 0.012 }));
    expect(short).toMatchObject({ lowRange: false, reason: null, gap: null, adr20pct: null });
    expect(priceActivity(gapped({ gap: 40, after: SINCE_GAP_MIN_SESSIONS, pin: 0.012 }))).toMatchObject({ lowRange: true, reason: 'since_gap' });
  });

  it('needs a move of GAP_MOVE_PERCENT or more, and a range after it under SINCE_GAP_RANGE_PERCENT', () => {
    expect(priceActivity(gapped({ gap: GAP_MOVE_PERCENT * 0.9, after: 25, pin: 0.012 })).lowRange).toBe(false);
    // Drifting after the gap: each session 0.5% higher, so the range since the gap passes 3%.
    const drift = gapped({ gap: 40, after: 25, pin: 0.012 }).map((b, i, all) => (i > all.length - 26 ? { ...b, high: b.high * (1 + 0.005 * (i - all.length + 26)), low: b.low * (1 + 0.005 * (i - all.length + 26)), close: b.close * (1 + 0.005 * (i - all.length + 26)) } : b));
    expect(priceActivity(drift).lowRange).toBe(false);
  });

  it('flags ADR20 under LOW_ADR_PERCENT alone (no gap, a range of 5% or more)', () => {
    // A slow 0.3%-a-day climb with 0.3% daily ranges: the 60-session range is about 19%, the largest move 0.3%.
    const bars = series(80, i => bar(10 * 1.003 ** i, 0.003));
    const activity = priceActivity(bars);
    expect(activity.range60pct).toBeGreaterThan(LOW_RANGE_PERCENT);
    expect(activity).toMatchObject({ lowRange: true, reason: 'adr', gap: null });
    expect(activity.adr20pct).toBeLessThan(LOW_ADR_PERCENT);
    expect(priceActivity(series(80, i => bar(10 * 1.003 ** i, 0.02)))).toMatchObject({ lowRange: false, reason: null });
  });

  it('computes ADR20 with the plan\'s formula (adrPercent)', () => {
    const bars = series(90, i => ({ date: day(i), high: 30 + (i % 7) * 0.01 + 0.04, low: 30 + (i % 7) * 0.01, close: 30.02 + (i % 7) * 0.01 }));
    const activity = priceActivity(bars);
    expect(activity.reason).toBe('range60');
    expect(activity.adr20pct).toBe(adrPercent(bars));
  });

  it('keeps reason range60 (and its first two keys) for a row flagged by the 60-session range, whatever else holds', () => {
    const bars = series(70, i => ({ high: 50 + (i % 3) * 0.1, low: 49.5, close: 49.8 }));
    const activity = priceActivity(bars);
    expect(firstTwo(activity)).toBe(JSON.stringify(exporterBefore(true, bars)));
    expect(activity.reason).toBe('range60');
  });

  it('gives no figure and lowRange false with fewer than 60 bars', () => {
    expect(priceActivity(gapped({ before: 20, gap: 40, after: 30 }).slice(-59))).toEqual({ range60pct: null, lowRange: false, reason: null, adr20pct: null, gap: null });
  });

  it('reads no gap with exactly 60 bars (the first bar\'s move has no previous close)', () => {
    const activity = priceActivity(gapped({ before: 30, gap: 40, after: 29 }).slice(-60));
    expect(activity.range60pct).not.toBeNull();
    expect(activity.gap).toBeNull();
    expect(activity.reason).not.toBe('since_gap');
  });

  it('never flags from a missing or non-positive high, low or close', () => {
    const pinned = gapped({ gap: 40, after: 25, pin: 0.004 });
    // A missing close inside the moves: the since-gap rule is unknown; the ADR rule still reads its own (valid) bars.
    const noClose = pinned.map((b, i) => (i === pinned.length - 40 ? { ...b, close: undefined } : b));
    expect(priceActivity(noClose)).toMatchObject({ reason: 'adr', gap: null });
    // A missing low in the last 20 bars: ADR20 is unknown and the range since the gap is unknown, so nothing flags.
    const noLow = pinned.map((b, i) => (i === pinned.length - 3 ? { ...b, low: undefined } : b));
    expect(priceActivity(noLow)).toMatchObject({ lowRange: false, reason: null, adr20pct: null, gap: null });
    // A zero or negative low never makes a narrow 60-session range (the exporter's first key is kept as it computed it).
    const negative = series(70, () => ({ high: 10, low: -1, close: 5 }));
    expect(priceActivity(negative)).toMatchObject({ lowRange: false, reason: null });
    expect(priceActivity(series(70, () => ({ high: 10, low: 0, close: 5 })))).toMatchObject({ lowRange: false, reason: null });
  });

  it('reads flat bars (one price for 60 sessions) as range60, with ADR20 0 (a known 0, not a missing one)', () => {
    const activity = priceActivity(series(70, () => ({ high: 12, low: 12, close: 12 })));
    expect(activity).toMatchObject({ range60pct: 0, lowRange: true, reason: 'range60', adr20pct: 0, gap: null });
  });

  it('reads a gap on the last bar as no pin (no session after it)', () => {
    const bars = gapped({ gap: 40, after: 0, pin: 0.012 });
    expect(priceActivity(bars)).toMatchObject({ lowRange: false, reason: null, gap: null });
  });

  it('publishes the figures for a low-activity row only', () => {
    const wide = priceActivity(series(80, i => bar(10 * 1.01 ** i, 0.03)));
    expect(wide).toEqual({ range60pct: wide.range60pct, lowRange: false, reason: null, adr20pct: null, gap: null });
  });
});

describe('lowActivityReason (the one producer of the low-activity reason)', () => {
  it('writes today\'s words for range60 and for an older publication without a reason', () => {
    expect(lowActivityReason({ range60pct: 2.1, lowRange: true, reason: 'range60', adr20pct: 0.3, gap: null }, '2026-11-12')).toBe('60日値幅5%未満');
    expect(lowActivityReason({ range60pct: 2.1, lowRange: true }, '2026-11-12')).toBe('60日値幅5%未満');
  });

  it('writes the gap\'s date and move, the sessions after it and the constant for since_gap', () => {
    const activity = { range60pct: 49, lowRange: true, reason: 'since_gap', adr20pct: 0.15, gap: { date: '2026-08-27', pct: 44.4, sessions: 25, rangePct: 0.8 } };
    expect(lowActivityReason(activity, '2026-10-01')).toBe('8/27の窓開け（+44%）後25営業日の値幅3%未満');
    expect(lowActivityReason({ ...activity, gap: { ...activity.gap, pct: -30.4 } }, '2026-10-01')).toBe('8/27の窓開け（−30%）後25営業日の値幅3%未満');
    expect(lowActivityReason(activity, '2027-01-05')).toBe('2026/8/27の窓開け（+44%）後25営業日の値幅3%未満');
  });

  it('writes the ADR rule from its constant', () => {
    expect(lowActivityReason({ range60pct: 19, lowRange: true, reason: 'adr', adr20pct: 0.39, gap: null })).toBe('20日平均値幅（ADR）0.5%未満');
  });

  it('never names another rule for a reason it does not know, or a since-gap row without a readable gap', () => {
    expect(lowActivityReason({ range60pct: 19, lowRange: true, reason: 'later_rule' })).toBe(LOW_ACTIVITY_UNKNOWN_REASON);
    expect(lowActivityReason({ range60pct: 19, lowRange: true, reason: 'since_gap', gap: null })).toBe(LOW_ACTIVITY_UNKNOWN_REASON);
  });

  it('is null for a row that is not low activity, or without price_activity (never 0, never low)', () => {
    expect(lowActivityReason({ range60pct: 19, lowRange: false, reason: null })).toBeNull();
    expect(lowActivityReason(undefined)).toBeNull();
    expect(lowActivityReason({ range60pct: null })).toBeNull();
  });
});

// Rule 18 (UI before data): every reader keys on price_activity.lowRange only (researchEngine's state and sort,
// entryReadiness, portfolioPlan), so a row carrying the new keys reads exactly as the same row with the first two keys only,
// and the research index (price_activity is a list field) carries the object through the frozen transport unchanged.
describe('the new price_activity keys reach no reader that refuses them (rule 18)', () => {
  const NOW = Date.parse('2026-10-02T12:00:00Z');
  const base = (symbol, price, extra = {}) => ({ symbol, market: 'US', currency: 'USD', current_price: price, se_pivot_price: 100, rs_rating: 90, ...extra });
  const shapes = {
    PIN: { range60pct: 49.0, lowRange: true, reason: 'since_gap', adr20pct: 0.15, gap: { date: '2026-08-27', pct: 44.4, sessions: 25, rangePct: 0.8 } },
    ADR: { range60pct: 19.2, lowRange: true, reason: 'adr', adr20pct: 0.39, gap: null },
    OLD: { range60pct: 2.1, lowRange: true },
    WIDE: { range60pct: 30.5, lowRange: false, reason: null, adr20pct: null, gap: null },
  };
  const rows = Object.entries(shapes).map(([symbol, activity], i) => base(symbol, 101 + i, { price_activity: activity }));
  const firstTwoOnly = rows.map(row => ({ ...row, price_activity: { range60pct: row.price_activity.range60pct, lowRange: row.price_activity.lowRange } }));

  it('gives the same state as the row with the first two keys only', () => {
    rows.forEach((row, i) => expect(entryPlan(row, null, 'minervini')).toEqual(entryPlan(firstTwoOnly[i], null, 'minervini')));
    expect(rows.map(row => entryPlan(row, null, 'minervini').state)).toEqual(['低変動・監視のみ', '低変動・監視のみ', '低変動・監視のみ', '買いゾーン内']);
  });

  it('sorts the same (low-activity rows last, as before)', () => {
    const order = list => rankCandidates(list, 'minervini', { now: NOW }).map(item => item.row.symbol);
    expect(order(rows)).toEqual(order(firstTwoOnly));
    expect(order(rows)[0]).toBe('WIDE');
  });

  it('encodes and decodes the object as it went in (keys, order and nulls)', () => {
    const decoded = decodeResearchIndex(encodeResearchIndex({ as_of_date: '2026-10-02', rows }));
    expect(decoded.rows).toEqual(rows.map(researchListRow));
    decoded.rows.forEach((row, i) => expect(JSON.stringify(row.price_activity)).toBe(JSON.stringify(rows[i].price_activity)));
  });
});
