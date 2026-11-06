// The stock chart's numbers, shared by the drawing (priceChart.js) and the readout row above it: the
// bars on the chart's interval, every moving average it draws and the volume average, then one bar's
// values as the readout shows them. Pure; a value whose window is short is null (shown as —), never 0.
import { RS_LEAD_FROM_HIGH_PERCENT } from './briefChartModel';
import { BREAKOUT_VOLUME_RATIO, ratioShown } from './briefCandidate';
import { ADR_SESSIONS, adrState } from './positionSizing';
import { lastPivotCrossing } from './breakoutHistory';

const DAY = 86400000;
const finite = Number.isFinite;

/**
 * Weekly bars from daily bars (Monday-based weeks). Each week keeps its first and last session
 * dates; a week with any non-finite OHLCV value is dropped rather than averaged over a gap, and a
 * first week that does not start on a Monday is dropped as partial.
 */
export function weeklyBars(daily) {
  const weeks = [];
  for (const bar of daily || []) {
    const stamp = Date.parse(`${bar?.date}T00:00:00Z`);
    if (!Number.isFinite(stamp)) continue;
    const monday = new Date(stamp - ((new Date(stamp).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
    const week = weeks.at(-1);
    if (!week || week.key !== monday) weeks.push({ key: monday, start: bar.date, date: bar.date, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, ok: [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) });
    else {
      Object.assign(week, { date: bar.date, high: Math.max(week.high, bar.high), low: Math.min(week.low, bar.low), close: bar.close, volume: week.volume + bar.volume });
      week.ok = week.ok && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite);
    }
  }
  // The first week is usually cut by the start of the data: keep it only when it starts on a Monday.
  if (weeks.length && new Date(`${weeks[0].start}T00:00:00Z`).getUTCDay() !== 1) weeks.shift();
  return weeks.filter(week => week.ok).map(({ start, date, open, high, low, close, volume }) => ({ start, date, open, high, low, close, volume }));
}

/** Simple moving average; a window containing any non-finite value has none, and later windows recover. */
export function sma(values, length) {
  const out = new Array(values.length).fill(null); let sum = 0, bad = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) sum += v; else bad++;
    if (i >= length) { const old = values[i - length]; if (Number.isFinite(old)) sum -= old; else bad--; }
    if (i >= length - 1 && bad === 0) out[i] = sum / length;
  }
  return out;
}

/** Exponential moving average seeded with the SMA of its first `length` values; a non-finite value restarts it. */
export function ema(values, length) {
  const out = new Array(values.length).fill(null), k = 2 / (length + 1);
  let run = 0, sum = 0, previous = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) { run = 0; sum = 0; previous = null; continue; }
    run++;
    if (previous === null) { sum += v; if (run === length) previous = sum / length; else continue; }
    else previous = v * k + previous * (1 - k);
    out[i] = previous;
  }
  return out;
}

/**
 * The chart's periods: [bars shown, interval, label]. The weekly view uses 10/30/40-week averages; its
 * label is the honest week count (weeklyRangeLabel), 「週足2年」 only with two years of weeks.
 */
export const CHART_RANGES = Object.freeze({ '3m': [65, 'day', '3か月'], '6m': [130, 'day', '6か月'], '1y': [250, 'day', '1年'], '2yw': [104, 'week', '週足'] });

/** The short averages (a 10-day SMA and a 21-day EMA) are drawn on the 3- and 6-month daily charts only. */
export const shortAveragesDrawn = (interval, period) => interval !== 'week' && period <= 130;
/**
 * Where the short averages are drawn on screen: on the 3- and 6-month daily charts at 1024px and wider,
 * and on the 3-month chart only below that (about 4px per bar on a phone).
 */
export const shortAveragesShown = (interval, period, wide = false) => shortAveragesDrawn(interval, period) && (wide || period <= 65);

const cache = new WeakMap();
/**
 * Everything the chart draws from one model: `all` (daily or weekly bars), each moving average
 * ({ key, label, length, short, values }, aligned with `all`; the key is the line's class), and the
 * volume average of the bars before each bar (`vavg`, excluding the bar itself).
 */
export function chartSeries(model) {
  if (!model?.bars) return null;
  if (cache.has(model)) return cache.get(model);
  const weekly = model.interval === 'week', unit = weekly ? '週' : '日';
  const all = weekly ? weeklyBars(model.bars) : model.bars;
  const closes = all.map(b => b?.close), volumes = all.map(b => b?.volume);
  const averages = (weekly ? [[10, 'ma50'], [30, 'ma150'], [40, 'ma200']] : [[50, 'ma50'], [150, 'ma150'], [200, 'ma200']])
    .map(([length, key]) => ({ key, length, label: `${length}${unit}`, short: false, values: sma(closes, length) }));
  if (!weekly && model.short) averages.unshift({ key: 'ma10', length: 10, label: '10日', short: true, values: sma(closes, 10) }, { key: 'ema21', length: 21, label: '21日', short: true, ema: true, values: ema(closes, 21) });
  const volumeLength = weekly ? 10 : 50, average = sma(volumes, volumeLength);
  const vavg = average.map((_, i) => (i ? average[i - 1] : null));
  // The volume axis's 平均 is the drawn line's last point: the average of the bars before the latest one.
  const series = { weekly, unit, all, averages, volumeLength, vavg, latestAverage: vavg.at(-1) ?? null };
  cache.set(model, series);
  return series;
}

/**
 * The price panel's log scale for the shown bars: their highs and lows with the pivot, the zone's top and
 * the stop (never the other levels), padded 5% each side. `lo`/`hi` are the data range, `tlo`/`thi` the
 * padded log bounds.
 */
export function priceScale(bars, model) {
  const levels = [model.pivot, model.upper, model.stop].filter(finite);
  const values = bars.flatMap(b => [b.high, b.low]).filter(finite).concat(levels);
  let lo = Math.min(...values), hi = Math.max(...values);
  if (!(hi > lo)) { lo *= 0.99; hi *= 1.01; } // a flat range still gets a scale
  const L = Math.log;
  return { lo, hi, tlo: L(lo) - (L(hi) - L(lo)) * 0.05, thi: L(hi) + (L(hi) - L(lo)) * 0.05 };
}

/** Whether the price panel's y-range for this model and period holds `value` (a level drawn only inside it). */
export function priceInRange(model, period, value) {
  const series = chartSeries(model);
  if (!finite(value) || !series?.all.length) return false;
  const n = Math.min(period, series.all.length), { tlo, thi } = priceScale(series.all.slice(-n), model);
  return value >= Math.exp(tlo) && value <= Math.exp(thi);
}

/** What identifies a chart's intro: the symbol, the interval, the period and the bars (a new one animates). */
export const chartIdentityKey = (model, period) => (model ? `${model.symbol}|${model.interval || 'day'}|${period}|${model.bars?.length}|${model.bars?.at(-1)?.date}` : null);
/**
 * What the drawing shows: the identity plus every level and overlay, the earnings call (date, days, tone) and
 * today's New York date, so the date axis's 「あと7日」 redraws when the day changes. Levels and overlays can
 * arrive after the bars (detail merge); they redraw without replaying the intro.
 */
export const chartContentKey = (model, period) => (model ? `${chartIdentityKey(model, period)}|${model.pivot}|${model.upper}|${model.entry}|${model.r2}|${model.r3}|${model.structuralLow}|${model.auditHigh}|${model.rsNewHigh}|${model.rsLine?.length}|${model.rsReason}|${model.rsLead?.dates?.length}|${model.legs?.length}|${model.legsValid}|${model.dryUpLeg?.startDate}|${(model.gaps || []).length}|${model.short}|${model.earnings?.date}|${model.earnings?.days}|${model.earnings?.soon}|${model.today}|${model.crossing?.date}|${model.crossing?.volumeRatio}|${model.crossing?.tone}|${(model.sellMarks || []).map(m => m.date).join(',')}` : null);

/** The earnings marker's window: a date this many calendar days away or nearer (or passed by as many) is drawn. */
export const EARNINGS_MARKER_DAYS = 28;
const shortDay = day => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;
/**
 * The date axis's earnings marker from the screen's one earnings call (earningsCall of the row: the days
 * from today's New York date, so the chart, the chips and the plan count the same days), or null outside
 * EARNINGS_MARKER_DAYS. Upcoming 「決算 10/10 あと7日」, on the day 「決算 10/10 当日」, after it 「決算 10/10 経過」
 * (never 「あと」). `soon` (the call's EARNINGS_WARN_DAYS) gives the warning tone, only until the day itself;
 * `past` is a passed report (the phone's flag is dimmed with a dashed border); `short` is the phone's compact
 * flag 「E 10/10」 (its full text is in the chart's accessible name and in the screen's 注記).
 */
export function earningsMarker(call) {
  if (!call || !finite(call.days) || typeof call.date !== 'string' || Math.abs(call.days) > EARNINGS_MARKER_DAYS) return null;
  const day = shortDay(call.date);
  return { text: `決算 ${day} ${call.days > 0 ? `あと${call.days}日` : call.days === 0 ? '当日' : '経過'}`, short: `E ${day}`, warn: call.soon === true && call.days >= 0, past: call.days < 0 };
}

const grouped = (value, digits) => value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
/**
 * A price with 2 decimals (thousands grouped), or — when unknown. `compact` (a phone or tablet) drops
 * the decimals from 1,000 up, as the chart's price tags do.
 */
export const formatPrice = (value, { compact = false } = {}) => (finite(value) ? grouped(value, compact && Math.abs(value) >= 1000 ? 0 : 2) : '—');
/** A signed percent, e.g. +2.2% / −0.8% / ±0.0%, or — when unknown. */
export const formatPercent = (value, digits = 1) => (finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(digits)}%` : '—');
// The unit is chosen after rounding, so 999,600 reads 1M, never 1000K.
const scaled = (value, significant) => {
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K'], [1, '']];
  for (let k = units.length - 1; k >= 0; k--) {
    const [size, suffix] = units[k], rounded = size === 1 ? Math.round(value) : Number((value / size).toPrecision(significant));
    if (Math.abs(rounded) < 1000 || k === 0) return `${rounded}${suffix}`;
  }
  return String(Math.round(value));
};
/** Volume as shares with 3 significant figures, e.g. 2.13M株 / 850K株; — when unknown. */
export const formatShares = value => (finite(value) && value >= 0 ? `${scaled(value, 3)}株` : '—');
/** A volume axis label with 2 significant figures, e.g. 4.2M; — when unknown. */
export const formatVolume = value => (finite(value) && value >= 0 ? scaled(value, 2) : '—');

/**
 * The heavy-volume bars of the visible period, as the volume panel draws them: volume at
 * BREAKOUT_VOLUME_RATIO× the average of the bars before it or more, each with its direction against
 * the previous close ('up', 'down', or 'flat' for the first bar of the data). One source for the
 * drawing and for the legend's 「■下落日の大商い」 (shown only when such a bar is drawn).
 */
export function heavyVolumeBars(model, period) {
  const series = chartSeries(model);
  if (!series?.all.length) return [];
  const { all, vavg } = series, n = Math.min(period ?? all.length, all.length), from = all.length - n, out = [];
  for (let i = from; i < all.length; i++) {
    const bar = all[i], previous = all[i - 1]?.close;
    const direction = !finite(previous) || !finite(bar.close) ? 'flat' : bar.close > previous ? 'up' : bar.close < previous ? 'down' : bar.close >= bar.open ? 'up' : 'down';
    if (finite(vavg[i]) && vavg[i] > 0 && finite(bar.volume) && bar.volume >= vavg[i] * BREAKOUT_VOLUME_RATIO) out.push({ date: bar.date, direction });
  }
  return out;
}

/**
 * One bar of the chart as the readout shows it. `index` is into chartSeries(model).all (the latest
 * bar when it is not a valid index). The change is against the previous bar's close (null for the
 * first bar of the data); the volume ratio against the average of the previous 50 bars (10 weeks on the
 * weekly chart; null when that window is short). The pivot ratio and the distance from the 52-week
 * high (`auditHigh`, the published audit's value) judge the stock, so they exist only for the latest
 * bar and only when the bars are certified for the analysis date. So do ADR (`adrPercent` over the
 * certified daily bars, the plan's own function) and the distance from the 50-day line, on the daily
 * chart's latest bar: `adr` and `fromSma50` are null (shown as —) on bars not certified, and absent
 * (undefined) on a past bar or the weekly chart, where they do not apply. `unverified` is true when the
 * bars are not certified: the readout names them 未検証の足 and qualifies the change and volume ratio.
 */
export function chartReadout(model, index, { certified = false, pivot = null, auditHigh = null } = {}) {
  const series = chartSeries(model);
  if (!series?.all.length) return null;
  const { all, weekly } = series, last = all.length - 1;
  const i = Number.isInteger(index) && index >= 0 && index <= last ? index : last;
  const bar = all[i], previous = i > 0 ? all[i - 1] : null, latest = i === last, judge = latest && certified === true && finite(bar.close);
  const average = series.vavg[i];
  const short = date => date.slice(5).replace('-', '/');
  const daily = latest && !weekly;
  const ma50 = series.averages.find(a => a.key === 'ma50')?.values[i];
  const adr = daily ? (certified === true ? adrState(model.bars) : { value: null, reason: '日足が分析日で未検証' }) : null;
  return {
    index: i, latest, weekly, unverified: certified !== true,
    adr: adr ? adr.value : undefined, adrReason: adr?.reason ?? null, adrSessions: ADR_SESSIONS,
    fromSma50: daily ? (judge && finite(ma50) && ma50 > 0 ? (bar.close / ma50 - 1) * 100 : null) : undefined,
    // On screen a week is named by its first session (09/28週); `range` spells out its sessions.
    date: weekly ? `${short(bar.start)}週` : short(bar.date), range: weekly ? `${short(bar.start)}〜${short(bar.date)}` : short(bar.date), isoDate: bar.date,
    open: finite(bar.open) ? bar.open : null, high: finite(bar.high) ? bar.high : null, low: finite(bar.low) ? bar.low : null, close: finite(bar.close) ? bar.close : null,
    change: previous && finite(previous.close) && previous.close > 0 && finite(bar.close) ? (bar.close / previous.close - 1) * 100 : null,
    volume: finite(bar.volume) ? bar.volume : null, volumeText: formatShares(bar.volume),
    volumeRatio: finite(average) && average > 0 && finite(bar.volume) ? bar.volume / average : null, volumeBasis: `${series.volumeLength}${series.unit}`,
    averages: series.averages.map(a => ({ key: a.key, label: a.label, short: a.short, value: finite(a.values[i]) ? a.values[i] : null })),
    pivotRatio: judge && finite(pivot) && pivot > 0 ? (bar.close / pivot - 1) * 100 : null,
    fromHigh: judge && finite(auditHigh) && auditHigh > 0 ? (bar.close / auditHigh - 1) * 100 : null,
  };
}

/**
 * The weekly period's button: 「週足2年」 only when two years of weeks exist, otherwise the honest count. Without
 * bars (a chart not delivered, failed or still loading) the count is unknown, never 0: 「週足（本数 未確認）」.
 */
export function weeklyRangeLabel(bars) {
  const count = weeklyBars(bars).length;
  return !count ? '週足（本数 未確認）' : count >= 104 ? '週足2年' : `週足（${count}週）`;
}

/** Why a drawn crossing is grey, not green (chartCrossing's `reason`), for the 注記. */
const CROSSING_REASONS = {
  volume_unknown: 'その日の出来高倍率は未確認',
  volume_below: ratio => `その日の出来高は${ratio}で${BREAKOUT_VOLUME_RATIO}×未満`,
  below_pivot: 'その後の終値がピボットを割り込んだ',
  close_unknown: '直近の終値が未確認',
};
/** The 注記's key for the drawn crossing mark (chartCrossing's tone and reason), or null. */
export function crossingNote(crossing) {
  if (!crossing) return null;
  if (crossing.tone === 'zone') return `緑の矢印＝終値がピボットを上抜けた日（出来高${BREAKOUT_VOLUME_RATIO}×以上、直近の終値もピボット以上。検証済みの日足）`;
  const reason = CROSSING_REASONS[crossing.reason] ?? CROSSING_REASONS.volume_unknown;
  return `灰色の矢印＝終値がピボットを上抜けた日（${typeof reason === 'function' ? reason(ratioShown(crossing.volumeRatio)) : reason}。検証済みの日足）`;
}

/**
 * The chart's footnotes for the screen's 注記 (in place on the card at 1024px and wider). Each one is
 * stated once and only when it applies; every N is counted from the data.
 * @param {object} p { bars, interval, period, short (the 10/21-day lines are drawn), rsLead (rsLeadMarks of
 *   the certified bars, or null), gaps (shown gap days), sellMarks (the phone legend names ▼▲ without their
 *   meaning), adr (the readout shows ADR and the distance from the 50-day line), crossing (chartCrossing of
 *   the drawn crossing mark, at every width: what its colour means), marks (below 1024px, the marks drawn
 *   whose legend item may be folded to keep the legend on two lines: { heavyDown, legs, structuralLow (its
 *   price), short, pivot, stop, earnings (earningsMarker of the drawn flag) }) }
 */
export function chartNotes({ bars, interval, period, short = shortAveragesDrawn(interval, period), rsLead = null, gaps = [], sellMarks = false, adr = false, crossing = null, marks = null }) {
  if (!bars?.length) return [];
  const series = chartSeries({ bars, interval, short });
  const n = Math.min(period, series.all.length), from = series.all.length - n;
  const notes = ['—＝必要な本数に足りない値（移動平均・出来高の倍率）'];
  if (series.averages.some(a => a.short)) notes.push('10日線・21日EMAは独自計算です。');
  const partial = series.averages.filter(a => !a.short).map(a => ({ a, count: a.values.slice(from).filter(v => v !== null).length })).filter(({ count }) => count < n);
  if (partial.length) notes.push(`${partial.map(({ a, count }) => (count ? `${a.label}線は直近${count}本のみ` : `${a.label}線は描けません`)).join('・')}（${series.weekly ? '週足' : '日足'}が足りないため）。`);
  // The lead is judged on daily bars, also under the weekly chart.
  if (rsLead?.points > 1) notes.push(rsLead.eligible > 0
    ? `RS線の下の太線は先行の独自判定です（RS線が直前252日の最高値以上、株価は自身の252日高値から${RS_LEAD_FROM_HIGH_PERCENT}%以上下。続いた日はひと続きの線）。先行判定は直近${rsLead.eligible}日のみです。`
    : `RS線が${rsLead.points}日分で252日に満たないため、RS線の先行（下の太線）は判定していません。`);
  if (adr && !series.weekly) notes.push(`ADR（直近${ADR_SESSIONS}日の高値÷安値−1の平均）・50日線からの乖離は独自計算です。`);
  if (gaps.length) notes.push('株価チャートの淡い縦帯は窓（前日の高値・安値から前日終値の2%以上離れて始まった日・独自判定）です。');
  if (sellMarks) notes.push('▼＝上昇の加速、▲＝崩れ（売りのサイン）。');
  // Below 1024px the legend keeps two lines: every mark it may fold is explained here once.
  const keys = [
    crossingNote(crossing),
    marks?.short ? '10＝10日線、21＝21日EMA（3か月のみ）' : null,
    marks?.pivot && marks?.stop ? '緑の破線＝ピボット、赤の点線＝損切り' : marks?.pivot ? '緑の破線＝ピボット' : marks?.stop ? '赤の点線＝損切り' : null,
    marks?.heavyDown ? `■＝下落日の大商い（${BREAKOUT_VOLUME_RATIO}×以上・独自判定）` : null,
    marks?.legs ? '点線＝収縮の安値を結んだ線、枠＝値幅の収縮' : null,
    finite(marks?.structuralLow) ? `「安値」＝最後の収縮の安値 ${formatPrice(marks.structuralLow)}` : null,
    marks?.earnings ? `${marks.earnings.short}＝${marks.earnings.text}` : null,
  ].filter(Boolean);
  if (keys.length) notes.push(`チャートの印：${keys.join('、')}。`);
  return notes;
}

/** A price in whole cents: the app's rule for 「ピボット到達」 (the same cents as the pivot is a touch, not a breakout). */
const cents = value => Math.round(value * 100);
/**
 * The pivot crossing the chart marks: lastPivotCrossing (the conclusion's own helper) on bars certified for
 * the analysis date only, or null. A crossing on the analysis day counts; a close at the pivot's cents is a
 * touch, not a breakout, so it is not marked (briefCandidate's cents rule). A crossing followed by a close
 * back under the pivot is still marked (it is where the failed breakout began; the conclusion names the
 * failure). `volumeRatio` is the helper's (null when it supplies none, never 0). `tone` is 'zone' (green)
 * only when that ratio is BREAKOUT_VOLUME_RATIO× or more and the latest certified close is still at or above
 * the pivot (cents); otherwise 'neutral', with the `reason` the 注記 states.
 */
export function chartCrossing(judged, pivot) {
  if (!Array.isArray(judged) || !finite(pivot) || pivot <= 0) return null;
  const crossing = lastPivotCrossing(judged, pivot);
  const bar = crossing && Number.isInteger(crossing.index) ? judged[crossing.index] : null;
  if (!bar || !finite(bar.close) || !(cents(bar.close) > cents(pivot))) return null;
  const volumeRatio = finite(crossing.volumeRatio) && crossing.volumeRatio > 0 ? crossing.volumeRatio : null;
  const close = judged.at(-1)?.close;
  const reason = !finite(close) ? 'close_unknown' : cents(close) < cents(pivot) ? 'below_pivot' : volumeRatio === null ? 'volume_unknown' : volumeRatio < BREAKOUT_VOLUME_RATIO ? 'volume_below' : null;
  return { date: bar.date, sessionsAgo: crossing.sessionsAgo, volumeRatio, tone: reason ? 'neutral' : 'zone', reason };
}
