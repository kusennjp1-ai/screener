import { describe, expect, it, vi } from 'vitest';
import { chartContentKey, chartCrossing, chartNotes, chartReadout, crossingNote, earningsMarker, chartSeries, ema, formatPercent, formatPrice, formatShares, formatVolume, heavyVolumeBars, shortAveragesDrawn, shortAveragesShown, priceInRange, weeklyBars, weeklyRangeLabel } from './chartReadout';
import { RS_LEAD_FROM_HIGH_PERCENT } from './briefChartModel';
import { ADR_SESSIONS, adrPercent } from './positionSizing';
import { lastPivotCrossing, STALE_BREAKOUT_SESSIONS } from './breakoutHistory';

// The crossing helper is verdict's (breakoutHistory.js, VD1/VD2 write its round-2 body): mocked here, so these
// tests pin how the chart reads it whatever body it has (plan §2.2 step-0 amendment).
vi.mock('./breakoutHistory', async importOriginal => ({ ...await importOriginal(), lastPivotCrossing: vi.fn() }));

// Weekdays only, so weekly bars are whole Monday-to-Friday weeks.
const sessions = count => { const out = []; for (let i = 0; out.length < count; i++) { const d = new Date(Date.UTC(2026, 0, 5) + i * 86400000); if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); } return out; };
const bars = (count, close = i => 100 + i * 0.1) => sessions(count).map((date, i) => ({ date, open: close(i) - 0.2, high: close(i) + 1, low: close(i) - 1, close: close(i), volume: 1_000_000 + i * 1000 }));

describe('chart readout', () => {
  it('shows the latest bar by default, with the change from the previous close and the volume against the previous 50 bars', () => {
    const list = bars(260), model = { bars: list, interval: 'day' };
    const readout = chartReadout(model);
    expect(readout.latest).toBe(true);
    expect(readout.index).toBe(259);
    expect(readout.date).toBe(list.at(-1).date.slice(5).replace('-', '/'));
    expect(readout.close).toBe(list.at(-1).close);
    expect(readout.change).toBeCloseTo((list[259].close / list[258].close - 1) * 100);
    const previous50 = list.slice(209, 259).reduce((sum, b) => sum + b.volume, 0) / 50;
    expect(readout.volumeRatio).toBeCloseTo(list[259].volume / previous50);
    expect(readout.averages.map(a => a.label)).toEqual(['50日', '150日', '200日']);
    expect(readout.averages[0].value).toBeCloseTo(list.slice(-50).reduce((sum, b) => sum + b.close, 0) / 50);
    expect(chartReadout(model, 10).latest).toBe(false);
    expect(chartReadout(model, 999).index).toBe(259);
    // The volume axis's 平均 is the same basis as the ratio: the 50 bars before the latest one.
    expect(chartSeries(model).latestAverage).toBeCloseTo(previous50);
  });

  it('names a weekly bar by its first session and spells out its sessions in the range', () => {
    const list = bars(60), readout = chartReadout({ bars: list, interval: 'week' }, 0);
    const first = weeklyBars(list)[0];
    expect(readout.weekly).toBe(true);
    expect(readout.date).toBe(`${first.start.slice(5).replace('-', '/')}週`);
    expect(readout.range).toBe(`${first.start.slice(5).replace('-', '/')}〜${first.date.slice(5).replace('-', '/')}`);
    expect(readout.averages.map(a => a.label)).toEqual(['10週', '30週', '40週']);
    expect(readout.volumeBasis).toBe('10週');
  });

  it('gives null, never 0, when a window is short and for the first bar of the data', () => {
    const list = bars(60), first = chartReadout({ bars: list, interval: 'day' }, 0);
    expect(first.change).toBeNull();
    expect(first.volumeRatio).toBeNull();
    expect(first.averages.every(a => a.value === null)).toBe(true);
    const latest = chartReadout({ bars: list, interval: 'day' });
    expect(latest.averages.find(a => a.label === '50日').value).not.toBeNull();
    expect(latest.averages.find(a => a.label === '150日').value).toBeNull();
    expect(latest.averages.find(a => a.label === '200日').value).toBeNull();
    const gap = list.map((b, i) => (i === 40 ? { ...b, volume: null } : b));
    expect(chartReadout({ bars: gap, interval: 'day' }).volumeRatio).toBeNull();
  });

  it('judges the pivot ratio and the distance from the 52-week high only on the latest certified bar', () => {
    const list = bars(260), model = { bars: list, interval: 'day' }, close = list.at(-1).close;
    const certified = chartReadout(model, undefined, { certified: true, pivot: 120, auditHigh: 130 });
    expect(certified.pivotRatio).toBeCloseTo((close / 120 - 1) * 100);
    expect(certified.fromHigh).toBeCloseTo((close / 130 - 1) * 100);
    expect(chartReadout(model, undefined, { certified: false, pivot: 120, auditHigh: 130 })).toMatchObject({ pivotRatio: null, fromHigh: null });
    expect(chartReadout(model, 200, { certified: true, pivot: 120, auditHigh: 130 })).toMatchObject({ pivotRatio: null, fromHigh: null });
    expect(chartReadout(model, undefined, { certified: true, pivot: null, auditHigh: undefined })).toMatchObject({ pivotRatio: null, fromHigh: null });
  });

  it('adds the 10-day SMA and the 21-day EMA only on the 3- and 6-month daily charts', () => {
    expect(shortAveragesDrawn('day', 65)).toBe(true);
    expect(shortAveragesDrawn('day', 130)).toBe(true);
    expect(shortAveragesDrawn('day', 250)).toBe(false);
    expect(shortAveragesDrawn('week', 104)).toBe(false);
    const list = bars(80);
    expect(chartSeries({ bars: list, interval: 'day', short: true }).averages.map(a => a.key)).toEqual(['ma10', 'ema21', 'ma50', 'ma150', 'ma200']);
    expect(chartSeries({ bars: list, interval: 'week', short: true }).averages.map(a => a.key)).toEqual(['ma50', 'ma150', 'ma200']);
    const values = ema([1, 2, 3, 4, 5, 6], 3);
    expect(values.slice(0, 2)).toEqual([null, null]);
    expect(values[2]).toBe(2);
    expect(values[3]).toBeCloseTo(4 * 0.5 + 2 * 0.5);
    expect(ema([1, 2, NaN, 4, 5, 6], 3)).toEqual([null, null, null, null, null, 5]);
  });

  it('formats volume as shares with M and K, and prices and percents without inventing values', () => {
    expect(formatShares(2_134_567)).toBe('2.13M株');
    expect(formatShares(850_000)).toBe('850K株');
    expect(formatShares(123_456_789)).toBe('123M株');
    expect(formatShares(1_234_567_890)).toBe('1.23B株');
    expect(formatShares(512)).toBe('512株');
    expect(formatShares(null)).toBe('—');
    // The unit is chosen after rounding: never 1000K or 1000M.
    expect(formatShares(999_600)).toBe('1M株');
    expect(formatShares(999_960_000)).toBe('1B株');
    expect(formatShares(999_400)).toBe('999K株');
    expect(formatShares(999.6)).toBe('1K株');
    expect(formatVolume(995_000)).not.toMatch(/1000K/);
    expect(formatVolume(999_000)).toBe('1M');
    expect(formatVolume(4_210_000)).toBe('4.2M');
    expect(formatVolume(undefined)).toBe('—');
    expect(formatPrice(1234.5)).toBe('1,234.50');
    expect(formatPrice(null)).toBe('—');
    // Compact (below 1024px) drops the decimals from 1,000 up, as the price tags do.
    expect(formatPrice(1331.42, { compact: true })).toBe('1,331');
    expect(formatPrice(999.42, { compact: true })).toBe('999.42');
    expect(formatPercent(2.234)).toBe('+2.2%');
    expect(formatPercent(-0.8)).toBe('−0.8%');
    expect(formatPercent(0)).toBe('±0.0%');
  });
});

describe('the weekly period label', () => {
  it('claims two years only with 104 weeks, otherwise says how many weeks are drawn', () => {
    const short = bars(300), long = bars(560);
    expect(weeklyRangeLabel(short)).toBe(`週足（${weeklyBars(short).length}週）`);
    expect(weeklyBars(long).length).toBeGreaterThanOrEqual(104);
    expect(weeklyRangeLabel(long)).toBe('週足2年');
    // No bars (none delivered, a failed fetch, still loading): the count is unknown, never 0.
    for (const none of [null, undefined, [], [{ date: null }]]) expect(weeklyRangeLabel(none)).toBe('週足（本数 未確認）');
  });
});

describe('the chart footnotes', () => {
  it('say once what — means, what is 独自計算, how much of the 200-day line exists and how far the RS lead is judged', () => {
    const list = bars(280);
    const notes = chartNotes({ bars: list, interval: 'day', period: 130, rsLead: { points: 280, eligible: 28 }, gaps: [{ date: list.at(-1).date }] });
    expect(notes[0]).toBe('—＝必要な本数に足りない値（移動平均・出来高の倍率）');
    expect(notes).toContain('10日線・21日EMAは独自計算です。');
    expect(notes).toContain('200日線は直近81本のみ（日足が足りないため）。');
    expect(notes).toContain(`RS線の下の太線は先行の独自判定です（RS線が直前252日の最高値以上、株価は自身の252日高値から${RS_LEAD_FROM_HIGH_PERCENT}%以上下。続いた日はひと続きの線）。先行判定は直近28日のみです。`);
    expect(notes).toContain('株価チャートの淡い縦帯は窓（前日の高値・安値から前日終値の2%以上離れて始まった日・独自判定）です。');
    expect(notes.every(note => note.endsWith('。') || note.startsWith('—'))).toBe(true);
    // Without the short lines (below 1024px) their note goes; the phone legend's ▼▲ get their meaning here.
    const phone = chartNotes({ bars: list, interval: 'day', period: 130, short: false, sellMarks: true });
    expect(phone).not.toContain('10日線・21日EMAは独自計算です。');
    expect(phone).toContain('▼＝上昇の加速、▲＝崩れ（売りのサイン）。');
    const year = chartNotes({ bars: bars(460), interval: 'day', period: 250 });
    expect(year).toEqual(['—＝必要な本数に足りない値（移動平均・出来高の倍率）']);
    expect(chartNotes({ bars: list, interval: 'day', period: 130, rsLead: { points: 200, eligible: 0 } })).toContain('RS線が200日分で252日に満たないため、RS線の先行（下の太線）は判定していません。');
    // ADR and the 50-day distance are 独自計算 (daily charts); below 1024px every mark the legend may fold is explained once.
    expect(chartNotes({ bars: list, interval: 'day', period: 130, adr: true })).toContain(`ADR（直近${ADR_SESSIONS}日の高値÷安値−1の平均）・50日線からの乖離は独自計算です。`);
    expect(chartNotes({ bars: list, interval: 'week', period: 104, adr: true }).join('')).not.toContain('ADR');
    // Every key a folded legend item names (the short lines, the pivot and stop lines, ■, the contraction lines,
    // the 「安値」 tag with its price, the earnings flag), and the crossing's colour at every width.
    const crossing = { date: list.at(-2).date, sessionsAgo: 1, volumeRatio: null, tone: 'neutral', reason: 'volume_unknown' };
    const flag = earningsMarker({ date: '2026-10-06', days: -1, soon: false });
    const marks = chartNotes({ bars: list, interval: 'day', period: 65, crossing, marks: { short: true, pivot: true, stop: true, heavyDown: true, legs: true, structuralLow: 109.47, earnings: flag } });
    expect(marks).toContain('チャートの印：灰色の矢印＝終値がピボットを上抜けた日（その日の出来高倍率は未確認。検証済みの日足）、10＝10日線、21＝21日EMA（3か月のみ）、緑の破線＝ピボット、赤の点線＝損切り、●＝大商い、■＝下落日の大商い（どちらも1.4×以上・独自判定）、点線＝収縮の安値を結んだ線、枠＝値幅の収縮、「安値」＝最後の収縮の安値 109.47、E 10/6＝決算 10/6 経過。');
    expect(chartNotes({ bars: list, interval: 'day', period: 130, marks: { stop: true } })).toContain('チャートの印：赤の点線＝損切り。');
    expect(chartNotes({ bars: list, interval: 'day', period: 130, marks: { heavyDown: false, legs: false, structuralLow: null } }).join('')).not.toContain('チャートの印');
    // At 1024px and wider (no marks) the crossing's colour is still explained.
    expect(chartNotes({ bars: list, interval: 'day', period: 130, crossing: { ...crossing, tone: 'zone', reason: null } })).toContain('チャートの印：緑の矢印＝終値がピボットを上抜けた日（出来高1.4×以上、直近の終値もピボット以上。検証済みの日足）。');
    expect(chartNotes({ bars: [], interval: 'day', period: 130 })).toEqual([]);
  });
});

describe('the readout in round 2', () => {
  it('reads ADR as adrPercent on the latest certified daily bar, — on bars not certified, and nothing on a past bar or the weekly chart', () => {
    const list = bars(260), model = { bars: list, interval: 'day' };
    const certified = chartReadout(model, undefined, { certified: true });
    expect(certified.adr).toBe(adrPercent(list));
    expect(certified.adr).toBeGreaterThan(0);
    expect(certified.adrSessions).toBe(ADR_SESSIONS);
    expect(chartReadout(model, undefined, { certified: false })).toMatchObject({ adr: null, adrReason: '日足が分析日で未検証' });
    expect(chartReadout(model, 100, { certified: true }).adr).toBeUndefined();
    expect(chartReadout({ bars: list, interval: 'week' }, undefined, { certified: true }).adr).toBeUndefined();
    // Too few bars for ADR: null with its reason, never 0.
    expect(chartReadout({ bars: list.slice(0, 10), interval: 'day' }, undefined, { certified: true })).toMatchObject({ adr: null, adrReason: `日足${ADR_SESSIONS}本未満` });
  });

  it('reads the distance from the 50-day line on the latest certified daily bar only, with U+2212 below it', () => {
    const falling = bars(260, i => 200 - i * 0.2), model = { bars: falling, interval: 'day' };
    const readout = chartReadout(model, undefined, { certified: true });
    const ma50 = falling.slice(-50).reduce((sum, b) => sum + b.close, 0) / 50;
    expect(readout.fromSma50).toBeCloseTo((falling.at(-1).close / ma50 - 1) * 100);
    expect(readout.fromSma50).toBeLessThan(0);
    expect(formatPercent(readout.fromSma50)).toMatch(/^−\d+\.\d%$/);
    expect(formatPercent(readout.fromSma50)).not.toContain('-');
    expect(chartReadout(model, undefined, { certified: false }).fromSma50).toBeNull();
    expect(chartReadout(model, 10, { certified: true }).fromSma50).toBeUndefined();
    expect(chartReadout({ bars: falling.slice(0, 40), interval: 'day' }, undefined, { certified: true }).fromSma50).toBeNull();
  });

  it('flags bars not certified for the analysis date as unverified, keeping the prices and averages', () => {
    const list = bars(260), model = { bars: list, interval: 'day' };
    const unverified = chartReadout(model, undefined, { certified: false, pivot: 120, auditHigh: 130 });
    expect(unverified.unverified).toBe(true);
    expect(unverified.close).toBe(list.at(-1).close);
    expect(unverified.change).not.toBeNull();
    expect(unverified.volumeRatio).not.toBeNull();
    expect(unverified.averages.find(a => a.key === 'ma50').value).not.toBeNull();
    expect(unverified).toMatchObject({ pivotRatio: null, fromHigh: null });
    expect(chartReadout(model, undefined, { certified: true }).unverified).toBe(false);
  });

  it('draws the 10/21-day lines on 3か月 only below 1024px, and on 3か月 and 6か月 at 1024px and wider', () => {
    expect([65, 130, 250].map(period => shortAveragesShown('day', period, false))).toEqual([true, false, false]);
    expect([65, 130, 250].map(period => shortAveragesShown('day', period, true))).toEqual([true, true, false]);
    expect(shortAveragesShown('week', 104, true)).toBe(false);
    expect(shortAveragesShown('week', 104, false)).toBe(false);
  });

  it('lists the heavy-volume bars of the shown period with their direction (the volume panel and the legend share it)', () => {
    const list = bars(120).map((b, i, all) => (i === 110 ? { ...b, close: all[i - 1].close - 3, volume: 9_000_000 } : i === 100 ? { ...b, volume: 9_000_000 } : b));
    expect(heavyVolumeBars({ bars: list, interval: 'day' }, 65)).toEqual([{ date: list[100].date, direction: 'up' }, { date: list[110].date, direction: 'down' }]);
    expect(heavyVolumeBars({ bars: list, interval: 'day' }, 15)).toEqual([{ date: list[110].date, direction: 'down' }]);
    expect(heavyVolumeBars({ bars: [], interval: 'day' }, 65)).toEqual([]);
  });
});

describe('the pivot crossing the chart marks', () => {
  const list = bars(120), pivot = list.at(-3).close;
  it('reads lastPivotCrossing on certified bars only, never a touch at the pivot\'s cents, with its ratio or null', () => {
    lastPivotCrossing.mockReturnValue({ index: 117, date: list[117].date, sessionsAgo: 2, volumeRatio: 1.83 });
    expect(chartCrossing(list, pivot - 0.5)).toEqual({ date: list[117].date, sessionsAgo: 2, volumeRatio: 1.83, tone: 'zone', reason: null });
    // No crossing floor (crossingFloor, round 3 seam H1b): the unbounded path, as before the seam.
    expect(lastPivotCrossing).toHaveBeenLastCalledWith(list, pivot - 0.5, { from: null });
    // Bars not certified (null), or no pivot: no crossing, and the helper is not asked.
    lastPivotCrossing.mockClear();
    expect(chartCrossing(null, pivot)).toBeNull();
    expect(chartCrossing(list, null)).toBeNull();
    expect(lastPivotCrossing).not.toHaveBeenCalled();
    // A close at the pivot's cents is a touch (「ピボット到達」), not a breakout: not marked, even a fraction above, when
    // every close since stays at or falls under the pivot.
    const touchOnly = (level, close) => list.map((bar, i) => (i === 117 ? { ...bar, close } : i > 117 ? { ...bar, close: level - 1 } : bar));
    expect(chartCrossing(touchOnly(list[117].close, list[117].close), list[117].close)).toBeNull();
    expect(chartCrossing(touchOnly(100, 100.004), 100)).toBeNull();
    expect(chartCrossing(touchOnly(110.74, 110.744), 110.74)).toBeNull();
    // A touch followed by a close above the pivot: the mark goes on that close (breakoutBar), with its own ratio.
    const touchThenAbove = list.map((bar, i) => (i === 117 ? { ...bar, close: 100 } : i > 117 ? { ...bar, close: 101 } : bar));
    expect(chartCrossing(touchThenAbove, 100)).toMatchObject({ date: list[118].date, sessionsAgo: 1 });
    // A crossing on the analysis day (sessionsAgo 0) and one followed by a close back under are marked.
    lastPivotCrossing.mockReturnValue({ index: 119, date: list[119].date, sessionsAgo: 0, volumeRatio: null });
    expect(chartCrossing(list, list[119].close - 1)).toEqual({ date: list[119].date, sessionsAgo: 0, volumeRatio: null, tone: 'neutral', reason: 'volume_unknown' });
    lastPivotCrossing.mockReturnValue({ index: 110, date: list[110].date, sessionsAgo: 9, volumeRatio: 0 });
    expect(chartCrossing(list, list[110].close - 0.01)).toMatchObject({ date: list[110].date, sessionsAgo: 9, volumeRatio: null });
    lastPivotCrossing.mockReturnValue(null);
    expect(chartCrossing(list, pivot)).toBeNull();
  });

  it('turns the arrow grey once the breakout is older than the stale window (STALE_BREAKOUT_SESSIONS, the conclusion\'s 停滞), and says so in the 注記', () => {
    const at = { index: 117, date: list[117].date, volumeRatio: 1.62 };
    lastPivotCrossing.mockReturnValue({ ...at, sessionsAgo: STALE_BREAKOUT_SESSIONS });
    expect(chartCrossing(list, pivot - 0.5)).toMatchObject({ tone: 'zone', reason: null });
    lastPivotCrossing.mockReturnValue({ ...at, sessionsAgo: STALE_BREAKOUT_SESSIONS + 1 });
    const stale = chartCrossing(list, pivot - 0.5);
    expect(stale).toMatchObject({ tone: 'neutral', reason: 'stale', volumeRatio: 1.62 });
    expect(crossingNote(stale)).toBe(`灰色の矢印＝終値がピボットを上抜けた日（上抜けから${STALE_BREAKOUT_SESSIONS}営業日を超えた・独自判定。検証済みの日足）`);
  });

  it('is green only on a 1.4× crossing whose latest certified close is still at or above the pivot, grey otherwise', () => {
    const at = { index: 117, date: list[117].date, sessionsAgo: 2 };
    // Unknown ratio (today's helper body never gives one): grey.
    lastPivotCrossing.mockReturnValue({ ...at, volumeRatio: null });
    expect(chartCrossing(list, pivot - 0.5)).toMatchObject({ tone: 'neutral', reason: 'volume_unknown' });
    // 1.62× with the close still above the pivot: green.
    lastPivotCrossing.mockReturnValue({ ...at, volumeRatio: 1.62 });
    expect(chartCrossing(list, pivot - 0.5)).toMatchObject({ tone: 'zone', reason: null, volumeRatio: 1.62 });
    // Under 1.4×: grey, with the ratio.
    lastPivotCrossing.mockReturnValue({ ...at, volumeRatio: 1.2 });
    expect(chartCrossing(list, pivot - 0.5)).toMatchObject({ tone: 'neutral', reason: 'volume_below', volumeRatio: 1.2 });
    // The close back under the pivot (a failed breakout): grey, whatever the ratio.
    lastPivotCrossing.mockReturnValue({ ...at, volumeRatio: 1.62 });
    const back = list.map((bar, i) => (i === 119 ? { ...bar, close: pivot - 0.6 } : bar));
    expect(chartCrossing(back, pivot - 0.5)).toMatchObject({ tone: 'neutral', reason: 'below_pivot' });
    // The latest close at the pivot's cents is still at the pivot: green.
    const level = list.map((bar, i) => (i === 119 ? { ...bar, close: pivot - 0.5 + 0.004 } : bar));
    expect(chartCrossing(level, pivot - 0.5)).toMatchObject({ tone: 'zone' });
    // A missing latest close: grey, never green.
    const missing = list.map((bar, i) => (i === 119 ? { ...bar, close: null } : bar));
    expect(chartCrossing(missing, pivot - 0.5)).toMatchObject({ tone: 'neutral', reason: 'close_unknown' });
    // The 注記 says why a mark is grey.
    expect(crossingNote({ tone: 'neutral', reason: 'volume_below', volumeRatio: 1.2 })).toBe('灰色の矢印＝終値がピボットを上抜けた日（その日の出来高は1.20×で1.4×未満。検証済みの日足）');
    expect(crossingNote({ tone: 'neutral', reason: 'below_pivot', volumeRatio: 1.62 })).toBe('灰色の矢印＝終値がピボットを上抜けた日（その後の終値がピボットを割り込んだ。検証済みの日足）');
    expect(crossingNote(null)).toBeNull();
  });
});

describe('the chart helpers the card and the screen share', () => {
  it('keeps the earnings marker\'s days, 当日 and 経過, with past for a passed report', () => {
    expect(earningsMarker({ date: '2026-10-10', days: 7, soon: true })).toEqual({ text: '決算 10/10 あと7日', short: 'E 10/10', warn: true, past: false });
    expect(earningsMarker({ date: '2026-10-10', days: 0, soon: true })).toMatchObject({ text: '決算 10/10 当日', warn: true, past: false });
    expect(earningsMarker({ date: '2026-10-06', days: -1, soon: true })).toMatchObject({ text: '決算 10/6 経過', warn: false, past: true });
  });
  it('tells whether a level is inside the price panel, and keys the drawing by the crossing\'s tone', () => {
    const model = { symbol: 'X', bars: bars(130), interval: 'day', pivot: 112 };
    expect(priceInRange(model, 65, 111)).toBe(true);
    expect(priceInRange(model, 65, 50)).toBe(false);
    expect(priceInRange(model, 65, null)).toBe(false);
    expect(chartContentKey({ ...model, crossing: { date: 'd', tone: 'zone' } }, 65)).not.toBe(chartContentKey({ ...model, crossing: { date: 'd', tone: 'neutral' } }, 65));
  });
});
