import { describe, expect, it } from 'vitest';
import { chartNotes, chartReadout, chartSeries, ema, formatPercent, formatPrice, formatShares, formatVolume, shortAveragesDrawn, weeklyBars, weeklyRangeLabel } from './chartReadout';
import { RS_LEAD_FROM_HIGH_PERCENT } from './briefChartModel';

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
    expect(weeklyRangeLabel(null)).toBe('週足（0週）');
  });
});

describe('the chart footnotes', () => {
  it('say once what — means, what is 独自計算, how much of the 200-day line exists and how far the RS lead is judged', () => {
    const list = bars(280);
    const notes = chartNotes({ bars: list, interval: 'day', period: 130, rsLead: { points: 280, eligible: 28 }, gaps: [{ date: list.at(-1).date }] });
    expect(notes[0]).toBe('—＝必要な本数に足りない値（移動平均・出来高の倍率）');
    expect(notes).toContain('10日線・21日EMAは独自計算です。');
    expect(notes).toContain('200日線は直近81本のみ（日足が足りないため）。');
    expect(notes).toContain(`RS線の●は先行の独自判定です（RS線が直前252日の最高値以上、株価は自身の252日高値から${RS_LEAD_FROM_HIGH_PERCENT}%以上下）。先行判定は直近28日のみです。`);
    expect(notes).toContain('株価チャートの淡い縦帯は窓（前日の高値・安値から前日終値の2%以上離れて始まった日・独自判定）です。');
    expect(notes.every(note => note.endsWith('。') || note.startsWith('—'))).toBe(true);
    // Without the short lines (below 1024px) their note goes; the phone legend's ▼▲ get their meaning here.
    const phone = chartNotes({ bars: list, interval: 'day', period: 130, short: false, sellMarks: true });
    expect(phone).not.toContain('10日線・21日EMAは独自計算です。');
    expect(phone).toContain('▼＝上昇の加速、▲＝崩れ（売りのサイン）。');
    const year = chartNotes({ bars: bars(460), interval: 'day', period: 250 });
    expect(year).toEqual(['—＝必要な本数に足りない値（移動平均・出来高の倍率）']);
    expect(chartNotes({ bars: list, interval: 'day', period: 130, rsLead: { points: 200, eligible: 0 } })).toContain('RS線が200日分で252日に満たないため、RS線の先行（●）は判定していません。');
    expect(chartNotes({ bars: [], interval: 'day', period: 130 })).toEqual([]);
  });
});
