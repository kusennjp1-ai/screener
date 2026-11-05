// The stock chart's numbers, shared by the drawing (priceChart.js) and the readout row above it: the
// bars on the chart's interval, every moving average it draws and the volume average, then one bar's
// values as the readout shows them. Pure; a value whose window is short is null (shown as —), never 0.
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
  const series = { weekly, unit, all, averages, volumeLength, vavg: average.map((_, i) => (i ? average[i - 1] : null)), latestAverage: average.at(-1) ?? null };
  cache.set(model, series);
  return series;
}

const grouped = (value, digits) => value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** A price with 2 decimals (thousands grouped), or — when unknown. */
export const formatPrice = value => (finite(value) ? grouped(value, 2) : '—');
/** A signed percent, e.g. +2.2% / −0.8% / ±0.0%, or — when unknown. */
export const formatPercent = (value, digits = 1) => (finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(digits)}%` : '—');
const scaled = (value, significant) => {
  for (const [size, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (Math.abs(value) >= size) return `${Number((value / size).toPrecision(significant))}${suffix}`;
  return String(Math.round(value));
};
/** Volume as shares with 3 significant figures, e.g. 2.13M株 / 850K株; — when unknown. */
export const formatShares = value => (finite(value) && value >= 0 ? `${scaled(value, 3)}株` : '—');
/** A volume axis label with 2 significant figures, e.g. 4.2M; — when unknown. */
export const formatVolume = value => (finite(value) && value >= 0 ? scaled(value, 2) : '—');

/**
 * One bar of the chart as the readout shows it. `index` is into chartSeries(model).all (the latest
 * bar when it is not a valid index). The change is against the previous bar's close (null for the
 * first bar of the data); the volume ratio against the average of the previous 50 bars (10 weeks on the
 * weekly chart; null when that window is short). The pivot ratio and the distance from the 52-week
 * high (`auditHigh`, the published audit's value) judge the stock, so they exist only for the latest
 * bar and only when the bars are certified for the analysis date.
 */
export function chartReadout(model, index, { certified = false, pivot = null, auditHigh = null } = {}) {
  const series = chartSeries(model);
  if (!series?.all.length) return null;
  const { all, weekly } = series, last = all.length - 1;
  const i = Number.isInteger(index) && index >= 0 && index <= last ? index : last;
  const bar = all[i], previous = i > 0 ? all[i - 1] : null, latest = i === last, judge = latest && certified === true && finite(bar.close);
  const average = series.vavg[i];
  const short = date => date.slice(5).replace('-', '/');
  return {
    index: i, latest, weekly,
    date: weekly ? `${short(bar.start)}〜${short(bar.date)}` : short(bar.date), isoDate: bar.date,
    open: finite(bar.open) ? bar.open : null, high: finite(bar.high) ? bar.high : null, low: finite(bar.low) ? bar.low : null, close: finite(bar.close) ? bar.close : null,
    change: previous && finite(previous.close) && previous.close > 0 && finite(bar.close) ? (bar.close / previous.close - 1) * 100 : null,
    volume: finite(bar.volume) ? bar.volume : null, volumeText: formatShares(bar.volume),
    volumeRatio: finite(average) && average > 0 && finite(bar.volume) ? bar.volume / average : null, volumeBasis: `${series.volumeLength}${series.unit}`,
    averages: series.averages.map(a => ({ key: a.key, label: a.label, short: a.short, value: finite(a.values[i]) ? a.values[i] : null })),
    pivotRatio: judge && finite(pivot) && pivot > 0 ? (bar.close / pivot - 1) * 100 : null,
    fromHigh: judge && finite(auditHigh) && auditHigh > 0 ? (bar.close / auditHigh - 1) * 100 : null,
  };
}

/** The weekly period's button: 「週足2年」 only when two years of weeks exist, otherwise the honest count. */
export function weeklyRangeLabel(bars) {
  const count = weeklyBars(bars).length;
  return count >= 104 ? '週足2年' : `週足（${count}週）`;
}

/**
 * The chart's footnotes for the screen's 注記 (in place on the card at 1024px and wider). Each one is
 * stated once and only when it applies; every N is counted from the data.
 * @param {object} p { bars, interval, period, rsLead (rsLeadMarks of the certified bars, or null), gaps (shown gap days) }
 */
export function chartNotes({ bars, interval, period, rsLead = null, gaps = [] }) {
  if (!bars?.length) return [];
  const series = chartSeries({ bars, interval, short: shortAveragesDrawn(interval, period) });
  const n = Math.min(period, series.all.length), from = series.all.length - n;
  const notes = ['—＝必要な本数に足りない値（移動平均・出来高の倍率）'];
  if (series.averages.some(a => a.short)) notes.push('10日線・21日EMAは独自計算です。');
  const partial = series.averages.filter(a => !a.short).map(a => ({ a, count: a.values.slice(from).filter(v => v !== null).length })).filter(({ count }) => count < n);
  if (partial.length) notes.push(`${partial.map(({ a, count }) => (count ? `${a.label}線は直近${count}本のみ` : `${a.label}線は描けません`)).join('・')}（${series.weekly ? '週足' : '日足'}が足りないため）`);
  if (rsLead?.points > 1) notes.push(rsLead.eligible > 0
    ? `RS線の●は先行の独自判定です（RS線が直前252本の最高値以上、株価は自身の252本高値から2%以上下）。先行判定は直近${rsLead.eligible}本のみ`
    : `RS線が${rsLead.points}本で252本に満たないため、RS線の先行（●）は判定していません。`);
  if (gaps.length) notes.push('価格欄の淡い縦帯は窓（前日の高値・安値から前日終値の2%以上離れて始まった日・独自判定）です。');
  return notes;
}
