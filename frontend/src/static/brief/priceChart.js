// Imperative SVG renderer for the brief's large daily chart. Three stacked layers
// share one coordinate system: back (grid, gaps, buy zone, contraction boxes), mid
// (moving averages, candles, RS line, volume — painted once and revealed with
// compositor-only transforms) and front (levels and their labels, tags, last price,
// marks, axes, scrub). Every text is 12px and the viewBox width is the display width.
import { BREAKOUT_VOLUME_RATIO, ratioShown } from './briefCandidate';
import { chartSeries, earningsMarker, formatVolume, heavyVolumeBars, priceScale, weeklyBars } from './chartReadout';

export { weeklyBars };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeBack = t => { const c = 1.45; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const finite = Number.isFinite;
const fmt = (value, digits = 2) => (finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—');
const signed = (value, digits = 1) => (finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(digits)}%` : '—');
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const FS = 12, TAG_H = 20, TAG_GAP = 20;
/** Below this chart width (a phone or a narrow tablet, under about 520px of screen) the chart uses its compact forms. */
export const NARROW_CHART_WIDTH = 480;
/** The RS panel's caption: its meaning (株価÷S&P 500, neither RS推計 nor IBD RS) is in the always-visible legend. */
export const RS_CAPTION = 'RS線';
const mono = 'font-family="var(--font-mono)"';
const text = (x, y, body, cls, extra = '') => `<text x="${x}" y="${y}" class="${cls}" font-size="${FS}" ${extra}>${body}</text>`;
// Estimated width of a 12px label: CJK glyphs are 1em, mono digits 0.6em, other Latin about 0.56em.
const width = (value, isMono = false) => [...String(value)].reduce((sum, c) => sum + (c.charCodeAt(0) > 0x2e80 ? FS : isMono ? FS * 0.6 : FS * 0.56), 0);
let sequence = 0;

export function tween(ms, step, { delay = 0, easing = easeOut, signal } = {}) {
  return new Promise(resolve => {
    if (reduced() || ms <= 0 || typeof requestAnimationFrame !== 'function') { step(1); resolve(); return; }
    step(0);
    const start = performance.now() + delay;
    const frame = now => {
      if (signal?.aborted) { resolve(); return; }
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      step(easing(t));
      if (t < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

function niceStep(lo, hi, count) {
  const raw = (hi - lo) / count;
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * power) return m * power;
  return 10 * power;
}
const tagText = value => (value >= 1000 ? fmt(value, 0) : fmt(value, 2));
const tagWidth = value => Math.round(width(tagText(value), true) + 10);

/** Consecutive bar indices as runs [first, last] (the RS line's lead days are drawn as one underline per run). */
export function indexRuns(indices) {
  const sorted = [...new Set(indices)].filter(Number.isInteger).sort((a, b) => a - b), runs = [];
  for (const i of sorted) { const run = runs.at(-1); if (run && i === run[1] + 1) run[1] = i; else runs.push([i, i]); }
  return runs;
}

/**
 * Spread labels so their centres are at least `gap` apart inside [top, bottom], keeping their order;
 * none is dropped. Items are { y } and gain `at` (the drawn centre).
 */
export function spread(items, gap, top, bottom) {
  const list = [...items].sort((a, b) => a.y - b.y);
  list.forEach((item, i) => { item.at = Math.max(Math.min(Math.max(item.y, top), bottom), i ? list[i - 1].at + gap : -Infinity); });
  for (let i = list.length - 1; i >= 0; i--) if (list[i].at > (i === list.length - 1 ? bottom : list[i + 1].at - gap)) list[i].at = i === list.length - 1 ? bottom : list[i + 1].at - gap;
  return list;
}

/**
 * Keep labels right-first: walking from the newest (right-most) label, keep one when its centre is at
 * least `gap` left of the last kept one. The right-most label is always kept.
 */
export function keepRightFirst(items, gap) {
  const kept = [];
  for (const item of [...items].sort((a, b) => b.x - a.x)) if (!kept.length || kept.at(-1).x - item.x >= gap) kept.push(item);
  return kept.reverse();
}

/**
 * Month-start ticks for the date axis (mid-month ticks are added when there are too few): about 3–4 on
 * a phone and 6–12 on a desktop. The first tick and every tick where the year changes carry YYYY/MM.
 */
export function dateTicks(bars, plotWidth, { dense = false } = {}) {
  const most = Math.max(3, Math.min(12, Math.floor(plotWidth / 72))), least = plotWidth >= 600 ? 6 : 3;
  const month = bar => (bar.start || bar.date).slice(0, 7);
  const starts = bars.map((bar, i) => ({ i, bar })).filter(({ i, bar }) => i > 0 && month(bar) !== month(bars[i - 1])).map(({ i, bar }) => ({ i, month: month(bar), mid: false }));
  let ticks = starts;
  // `dense`: every month start and mid-month tick, for a caller that places them itself.
  if (ticks.length < least || dense) {
    const mids = bars.map((bar, i) => ({ i, bar })).filter(({ i, bar }) => i > 0 && bar.date.slice(8) >= '16' && bars[i - 1].date.slice(8) < '16' && month(bar) === month(bars[i - 1])).map(({ i, bar }) => ({ i, month: month(bar), mid: true, day: bar.date.slice(8) }));
    ticks = [...starts, ...mids].sort((a, b) => a.i - b.i);
  }
  const step = dense ? 1 : Math.max(1, Math.ceil(ticks.length / most));
  ticks = ticks.filter((_, k) => (ticks.length - 1 - k) % step === 0);
  return ticks.map((tick, k) => {
    const year = tick.month.slice(0, 4), m = Number(tick.month.slice(5));
    const withYear = k === 0 || year !== ticks[k - 1].month.slice(0, 4);
    return { ...tick, label: tick.mid ? `${m}/${tick.day}` : withYear ? `${year}/${tick.month.slice(5)}` : `${m}月` };
  });
}

/**
 * @param {HTMLElement} el container (position: relative)
 * @param {object} model { symbol, bars:[{date,open,high,low,close,volume}], interval, short, rsLine:[{time,value}], rsReason,
 *   rsNewHigh, rsLead:{dates,threshold}|null, legs:[{startDate,endDate,high,low,depthPct}], legsValid, dryUpLeg, pivot, upper,
 *   stop, entry, r2, r3, structuralLow, auditHigh, gaps:[{date,direction}], earnings (earningsCall: {date,days,soon})|null,
 *   crossing:{date,volumeRatio}|null (the pivot crossing on certified bars), sellMarks }
 * @param {object} options { period, animate, fast, signal, onScrub(index into the interval's bars | null), selected }
 */
export function renderPriceChart(el, model, { period = 130, animate = true, fast = false, signal, onScrub, selected = null } = {}) {
  const k = fast ? 0.5 : 1;
  const W = Math.max(240, Math.round(el.clientWidth)), H = Math.max(240, Math.round(el.clientHeight));
  // Weekly mode: 10/30/40-week averages stand in for the 50/150/200-day lines (same colours).
  const series = chartSeries(model) || { all: [], averages: [], vavg: [], weekly: false, unit: '日', volumeLength: 50 };
  const { all, weekly, unit, volumeLength } = series;
  const n = Math.min(period, all.length), from = all.length - n, bars = all.slice(from);
  if (!n) { el.innerHTML = '<p class="brief-chart-empty">日足データが不足しています。</p>'; return null; }
  const averages = series.averages.map(a => ({ ...a, shown: a.values.slice(from) }));
  const vavg = series.vavg.slice(from);
  const right = 66, pw = W - right - 2, padT = 8, axisB = 18, volH = Math.round(H * 0.15), rsH = Math.max(40, Math.round(H * 0.12)), gap = 8;
  const ph = H - padT - axisB - volH - rsH - gap * 2, rsTop = padT + ph + gap, volTop = rsTop + rsH + gap, plotBottom = padT + ph;
  const hasPivot = finite(model.pivot);
  const { lo, hi, tlo, thi } = priceScale(bars, model);
  const L = Math.log;
  const inRange = v => finite(v) && v >= Math.exp(tlo) && v <= Math.exp(thi);
  const bw = pw / n, x = i => (i + 0.5) * bw, y = v => padT + (thi - L(v)) * ph / (thi - tlo);
  const uid = `brief-chart-${++sequence}`;
  const B = [], M = [], F = [];
  const firstOnOrAfter = day => { const i = bars.findIndex(b => b.date >= day); return i < 0 ? null : i; };
  const lastOnOrBefore = day => { for (let i = n - 1; i >= 0; i--) if ((bars[i].start || bars[i].date) <= day) return i; return null; };
  const markIndex = new Map(bars.map((b, i) => [b.date, i]));
  const barOf = day => { if (!weekly) return markIndex.get(day); const i = bars.findIndex(b => b.start <= day && day <= b.date); return i < 0 ? undefined : i; };
  const last = bars[n - 1], lastX = x(n - 1), lastY = y(last.close);
  const narrow = W < NARROW_CHART_WIDTH;
  // On a narrow chart the last contraction's low is a tag (「安値」, its price in the legend), not a long label.
  const lowTag = narrow && inRange(model.structuralLow);

  // Price tags on the right axis (pivot, stop, the current price, and the last contraction's low on a narrow
  // chart); closer than 20px they stack with leaders.
  const tagDefs = [
    hasPivot ? { key: 'pivot', value: model.pivot, cls: 'bc-pivottag' } : null,
    finite(model.stop) ? { key: 'stop', value: model.stop, cls: 'bc-stoptag' } : null,
    lowTag ? { key: 'low', value: model.structuralLow, cls: 'bc-lowtag', text: '安値' } : null,
    finite(last.close) ? { key: 'last', value: last.close, cls: 'bc-lasttag' } : null,
  ].filter(Boolean);
  const layoutTags = () => spread(tagDefs.map(def => ({ ...def, y: y(def.value) })), TAG_GAP, padT + TAG_H / 2, plotBottom - TAG_H / 2);
  const tags = layoutTags();

  // Back layer
  const step = niceStep(lo, hi, 4), digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  B.push(`<defs><clipPath id="${uid}"><rect x="0" y="0" width="${pw}" height="${plotBottom}"/></clipPath></defs><g class="bc-grid">`);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const yy = y(v); B.push(`<line x1="0" x2="${pw}" y1="${yy}" y2="${yy}" class="bc-gridline"/>`);
    if (tags.every(t => Math.abs(t.at - yy) > 14)) B.push(text(pw + 7, yy + 4, fmt(v, digits), 'bc-axis', mono));
  }
  B.push(`<line x1="0" x2="${pw}" y1="${rsTop - gap / 2}" y2="${rsTop - gap / 2}" class="bc-gridline"/><line x1="0" x2="${pw}" y1="${volTop - gap / 2}" y2="${volTop - gap / 2}" class="bc-gridline"/></g>`);
  // Opening gaps (certified daily bars only): a pale band behind the bar.
  const gaps = weekly ? [] : (model.gaps || []).map(g => ({ ...g, i: markIndex.get(g.date) })).filter(g => g.i !== undefined);
  if (gaps.length) B.push(`<g class="bc-gaps" clip-path="url(#${uid})">${gaps.map(g => `<rect x="${(x(g.i) - Math.max(bw, 3) / 2).toFixed(1)}" y="${padT}" width="${Math.max(bw, 3).toFixed(1)}" height="${ph}" class="bc-gap bc-gap-${g.direction}" data-date="${g.date}"/>`).join('')}</g>`);
  // A contraction that began before the visible period is drawn from the period's first bar.
  const legs = (model.legs || []).map((leg, index) => ({ ...leg, index, a: firstOnOrAfter(leg.startDate), b: lastOnOrBefore(leg.endDate) })).filter(leg => Number.isInteger(leg.a) && Number.isInteger(leg.b) && leg.b >= leg.a);
  let zone = null;
  if (hasPivot && finite(model.upper)) {
    // The zone runs from the base's first contraction (otherwise the last 20 bars) to the right edge.
    const startBar = model.legs?.[0] ? firstOnOrAfter(model.legs[0].startDate) ?? 0 : Math.max(0, n - 20);
    const zx = Math.max(0, x(startBar) - bw / 2), top = y(model.upper), height = Math.max(2, y(model.pivot) - top);
    zone = { x: zx, top, height };
    B.push(`<g class="bc-zone" clip-path="url(#${uid})"><rect x="${zx.toFixed(1)}" y="${top}" width="${(pw - zx).toFixed(1)}" height="${height}" class="bc-zonefill"/></g>`);
  }
  B.push(`<g class="bc-legs" clip-path="url(#${uid})">`);
  for (const leg of legs) {
    const x0 = Math.max(0, x(leg.a) - bw / 2), x1 = x(leg.b) + bw / 2, top = y(leg.high), height = Math.max(1, y(leg.low) - top);
    B.push(`<g class="bc-leg" data-leg="${leg.index}"><rect x="${x0}" y="${top}" width="${Math.max(1, x1 - x0)}" height="${height}" data-h="${height}" class="bc-legbox" rx="4"/></g>`);
  }
  if (legs.length > 1) {
    const points = legs.map(leg => { let at = leg.a, low = Infinity; for (let i = leg.a; i <= leg.b; i++) if (bars[i].low < low) { low = bars[i].low; at = i; } return `${x(at).toFixed(1)},${y(low).toFixed(1)}`; });
    B.push(`<polyline points="${points.join(' ')}" class="bc-lows" fill="none"/>`);
  }
  B.push('</g>');

  // Mid layer
  M.push(`<defs><clipPath id="${uid}-m"><rect x="0" y="0" width="${pw}" height="${plotBottom}"/></clipPath></defs><g clip-path="url(#${uid}-m)">`);
  for (const average of [...averages].reverse()) {
    const d = average.shown.map((v, i) => (v == null ? '' : `${average.shown[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
    if (d) M.push(`<path d="${d}" class="bc-ma bc-${average.key}${average.short ? ' bc-mashort' : ''}" fill="none"/>`);
  }
  const cw = Math.max(1, bw * 0.64);
  bars.forEach((b, i) => {
    const cls = b.close >= b.open ? 'bc-up' : 'bc-down', xx = x(i).toFixed(1), top = y(Math.max(b.open, b.close)), height = Math.max(1, Math.abs(y(b.open) - y(b.close)));
    M.push(`<line x1="${xx}" x2="${xx}" y1="${y(b.high).toFixed(1)}" y2="${y(b.low).toFixed(1)}" class="${cls}"/><rect x="${(x(i) - cw / 2).toFixed(1)}" width="${cw.toFixed(1)}" y="${top.toFixed(1)}" height="${height.toFixed(1)}" class="${cls}"/>`);
  });
  M.push('</g>');
  const rsByDate = new Map((model.rsLine || []).map(p => [p.time || p.date, p.value]));
  const rs = bars.map(b => rsByDate.get(b.date)).map(v => (finite(v) ? v : null));
  // The line takes the panel's full height (its caption 「RS線」 sits in the corner the line leaves free).
  const rsKnown = rs.filter(finite), rsLineTop = rsTop + 3, rsLineBottom = rsTop + rsH - 4;
  let rsLast = null, ry = null;
  if (rsKnown.length > 1) {
    const rlo = Math.min(...rsKnown), rhi = Math.max(...rsKnown);
    ry = v => rsLineTop + (rhi - v) * (rsLineBottom - rsLineTop) / (rhi - rlo || 1);
    const threshold = model.rsLead?.threshold;
    if (finite(threshold) && threshold >= rlo && threshold <= rhi) M.push(`<line x1="0" x2="${pw}" y1="${ry(threshold).toFixed(1)}" y2="${ry(threshold).toFixed(1)}" class="bc-rsmax"/>`);
    M.push(`<path d="${rs.map((v, i) => (v == null ? '' : `${rs[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${ry(v).toFixed(1)}`)).join('')}" class="bc-rs" fill="none"/>`);
    // Lead days: one 2px underline per run of consecutive bars, along the panel's bottom edge.
    for (const [a, b] of indexRuns((model.rsLead?.dates || []).map(barOf).filter(i => i !== undefined && rs[i] != null))) {
      const x0 = Math.max(0, x(a) - bw / 2), x1 = Math.min(pw, Math.max(x(b) + bw / 2, x0 + 3));
      M.push(`<line x1="${x0.toFixed(1)}" x2="${x1.toFixed(1)}" y1="${rsTop + rsH - 1}" y2="${rsTop + rsH - 1}" class="bc-rslead" data-from="${bars[a].date}" data-to="${bars[b].date}"/>`);
    }
    if (rs.at(-1) != null) rsLast = ry(rs.at(-1));
  }
  // Volume: up, down or neutral against the previous close (the first bar of the data has none); a bar at
  // BREAKOUT_VOLUME_RATIO× its prior average or more is drawn strong with a dot on top.
  const vmax = Math.max(...bars.map(b => (finite(b.volume) ? b.volume : 0)), 1), vw = Math.max(1, bw * 0.7);
  const dry = model.dryUpLeg ? { a: firstOnOrAfter(model.dryUpLeg.startDate), b: lastOnOrBefore(model.dryUpLeg.endDate) } : null;
  const vy = v => volTop + volH - v / vmax * (volH - 5);
  const heavyBars = heavyVolumeBars(model, period), heavyDays = new Set(heavyBars.map(h => h.date));
  bars.forEach((b, i) => {
    const previous = i ? bars[i - 1].close : all[from - 1]?.close;
    const direction = !finite(previous) || !finite(b.close) ? 'flat' : b.close > previous ? 'up' : b.close < previous ? 'down' : b.close >= b.open ? 'up' : 'down';
    const heavy = heavyDays.has(b.date);
    const top = finite(b.volume) ? vy(b.volume) : volTop + volH;
    M.push(`<rect x="${(x(i) - vw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${vw.toFixed(1)}" height="${(volTop + volH - top).toFixed(1)}" class="bc-vol bc-vol-${direction}${heavy ? ` bc-volhi${direction === 'down' ? ' bc-volhi-down' : ''}` : ''}" data-date="${b.date}"/>`);
    if (heavy) M.push(`<circle cx="${x(i).toFixed(1)}" cy="${(top - 3).toFixed(1)}" r="1.8" class="bc-voldot${direction === 'down' ? ' bc-voldot-down' : ''}"/>`);
  });
  M.push(`<path d="${vavg.map((v, i) => (v == null ? '' : `${vavg[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${vy(v).toFixed(1)}`)).join('')}" class="bc-vavg" fill="none"/>`);

  // Front layer
  // Panel captions. The RS line's caption 「RS線」 takes the left corner (top or bottom) the line leaves free; what
  // it is (株価÷S&P 500, neither RS推計 nor IBD RS) is in the legend, always visible under the chart.
  if (rsKnown.length > 1) {
    const w = width(RS_CAPTION) + 4, under = rs.map((v, i) => (v != null && x(i) <= 4 + w ? ry(v) : null)).filter(finite);
    const topBand = under.filter(yy => yy < rsTop + 15).length, bottomBand = under.filter(yy => yy > rsTop + rsH - 15).length;
    F.push(text(4, bottomBand < topBand ? rsTop + rsH - 3 : rsTop + 12, RS_CAPTION, 'bc-caption bc-rscaption'));
  } else F.push(text(4, rsTop + 12, `RS線 未配信${model.rsReason ? `（${esc(model.rsReason)}）` : ''}`, 'bc-caption bc-rscaption'));
  const heavyLabel = `<tspan class="bc-volkey">●</tspan>${BREAKOUT_VOLUME_RATIO.toFixed(1)}×以上（独自判定）`;
  // A narrow chart keys the heavy down bars (■ 下落日) in this caption, beside the bars (the legend keeps two lines).
  const heavyDownDrawn = heavyBars.some(h => h.direction === 'down');
  const volumeCaption = narrow && heavyDownDrawn ? `出来高・${heavyLabel}・<tspan class="bc-volkeydown">■</tspan>下落日`
    : pw >= 230 ? `出来高・${volumeLength}${unit}平均・${heavyLabel}` : `出来高・${heavyLabel}`;
  F.push(text(4, volTop + 12, volumeCaption, 'bc-caption bc-volcaption'));
  const volumeCaptionRight = 4 + width(volumeCaption.replace(/<[^>]+>/g, ''));
  // The volume axis: the period's maximum and the latest average (— when its window is short).
  const averageNow = series.latestAverage;
  F.push(text(pw + 6, volTop + 11, formatVolume(vmax), 'bc-axis bc-volmax', mono));
  F.push(text(pw + 6, Math.min(volTop + volH, Math.max(volTop + 27, (finite(averageNow) && averageNow <= vmax ? vy(averageNow) : volTop + volH) + 4)), `平均 ${formatVolume(averageNow)}`, 'bc-axis bc-volavg'));
  if (dry && Number.isInteger(dry.a) && Number.isInteger(dry.b) && dry.b - dry.a > 3) {
    const xa = Math.max(0, x(dry.a) - bw / 2), xb = x(dry.b) + bw / 2;
    // Its name sits inside the volume panel, above the (low) dry-up bars: beside the caption when there is
    // room, otherwise on the line under it; left out when the panel is too short for a second line.
    const note = '出来高の枯渇', w = width(note), centre = (xa + xb) / 2 - w / 2;
    const beside = Math.min(Math.max(centre, volumeCaptionRight + 8), pw - 4 - w), under = Math.min(Math.max(centre, 4), pw - 4 - w);
    const label = beside >= volumeCaptionRight + 8 ? text(beside.toFixed(1), volTop + 12, note, 'bc-notetext', 'font-weight="700"')
      : volH >= 40 ? text(under.toFixed(1), volTop + 26, note, 'bc-notetext', 'font-weight="700"') : '';
    F.push(`<g class="bc-note"><path d="M${xa},${volTop - 1}v-4H${xb}v4" class="bc-bracket" fill="none"/><line x1="${xa}" x2="${xb}" y1="${volTop + volH + 1.5}" y2="${volTop + volH + 1.5}" class="bc-dryline"/>${label}</g>`);
  }
  // Levels: dotted plan lines (entry, 2R, 3R) and the structural low only inside the y-range; the 52-week high
  // (certified bars only, from the published audit). The y-axis is never widened for them.
  const levelLabels = [];
  // A level's line is drawn only with its name (an unnamed dotted line would read as another level): its slot
  // keeps the line's place in the layer and stays empty when the label finds no spot.
  const levelLine = (markup, label) => { levelLabels.push({ ...label, slot: F.length, line: markup }); F.push(''); };
  const planLine = (value, cls, label) => {
    if (!inRange(value)) return;
    levelLine(`<line x1="0" x2="${pw}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="bc-planline ${cls}"/>`, { y: y(value), body: label, cls: `bc-levelnote ${cls}-text` });
  };
  const entryDistinct = finite(model.entry) && (!hasPivot || Math.abs(model.entry / model.pivot - 1) > 0.001);
  if (entryDistinct) planLine(model.entry, 'bc-entry', `買値 ${fmt(model.entry)}`);
  planLine(model.r2, 'bc-r2', `2R ${fmt(model.r2)}`);
  planLine(model.r3, 'bc-r3', `3R ${fmt(model.r3)}`);
  if (inRange(model.structuralLow)) {
    const ys = y(model.structuralLow), line = `<line x1="${(pw * 0.6).toFixed(1)}" x2="${pw}" y1="${ys.toFixed(1)}" y2="${ys.toFixed(1)}" class="bc-planline bc-structural"/>`;
    // A narrow chart names it with its 「安値」 tag (the price is in the legend); a wide one with a label.
    levelLine(line, lowTag ? { named: true } : { y: ys, x: pw * 0.6, below: true, body: `最後の収縮の安値 ${fmt(model.structuralLow)}`, cls: 'bc-levelnote bc-structural-text' });
  }
  if (inRange(model.auditHigh)) {
    const yh = y(model.auditHigh), distance = finite(last.close) ? (last.close / model.auditHigh - 1) * 100 : null;
    // The readout gives the distance on a phone: the label keeps the short form there.
    levelLine(`<line x1="0" x2="${pw}" y1="${yh.toFixed(1)}" y2="${yh.toFixed(1)}" class="bc-high52"/>`, { y: yh, body: narrow ? `52週高 ${fmt(model.auditHigh)}` : `52週高値 ${fmt(model.auditHigh)}${finite(distance) ? `（${signed(distance)}）` : ''}`, cls: 'bc-levelnote bc-high52-text' });
  }
  if (hasPivot) F.push(`<line x1="0" x2="${pw}" y1="${y(model.pivot)}" y2="${y(model.pivot)}" class="bc-pivot"/>`);
  const stopLabel = value => `損切り${finite(model.entry) && model.entry > 0 && finite(value) ? ` ${signed((value / model.entry - 1) * 100)}` : ''}`;
  // In-plot labels: each takes the first of its positions that overlaps no box already taken (labels, the
  // right-axis tags, the last-price dot) and no candle; a label with no free position is left out, never
  // drawn over another. Notices first, then the contractions' labels right-first, the averages' names, the
  // crossing's ratio, the zone, the pivot and the stop, the other levels.
  const boxes = [];
  const take = (x0, x1, y0, y1) => boxes.push({ x0, x1, y0, y1 });
  const clampX = (x0, w) => Math.min(Math.max(4, x0), pw - w - 4);
  // A 12px label's box is 14px tall (CJK glyphs reach below the baseline); the averages' digit names use 13px.
  const fits = (x0, x1, yc, half = 7) => yc - 6 >= padT && yc + 6 <= plotBottom && !boxes.some(b => x0 < b.x1 + 3 && x1 > b.x0 - 3 && yc - half < b.y1 && yc + half > b.y0);
  // A label box over a candle (its whole high–low range, the body's width plus 1px).
  const overCandle = (x0, x1, yc) => bars.some((b, i) => x(i) + cw / 2 + 1 > x0 && x(i) - cw / 2 - 1 < x1 && y(b.high) < yc + 7 && y(b.low) > yc - 7);
  const free = (x0, w, yc, half = 7) => fits(x0, x0 + w, yc, half) && !overCandle(x0, x0 + w, yc);
  const claim = (x0, w, candidates, required = false) => {
    for (const yc of candidates) if (fits(x0, x0 + w, yc)) { take(x0, x0 + w, yc - 7, yc + 7); return yc; }
    if (!required) return null;
    take(x0, x0 + w, candidates[0] - 7, candidates[0] + 7);
    return candidates[0];
  };
  // A label's first free spot among [x, yc] pairs (fits() and overCandle()), or null.
  const spot = (w, spots) => spots.find(([lx, yc]) => free(lx, w, yc)) ?? null;
  const lines = [model.pivot, model.upper, model.stop, model.auditHigh].filter(inRange).map(y);
  // The right-axis tags, the last price's dot, the sell marks and the crossing's arrow are taken before any label.
  for (const tag of tags) take(pw + 2, pw + 2 + (tag.text ? Math.round(width(tag.text) + 10) : tagWidth(tag.value)), tag.at - TAG_H / 2, tag.at + TAG_H / 2);
  if (finite(lastY)) take(lastX - 5, lastX + 5, lastY - 5, lastY + 5);
  const sells = (model.sellMarks || []).map(mark => ({ mark, i: barOf(mark.date) })).filter(({ i }) => i !== undefined).map(({ mark, i }) => {
    const mx = x(i), top = Math.max(padT + 2, y(bars[i].high) - 14), bottom = Math.min(plotBottom - 2, y(bars[i].low) + 14);
    if (mark.kind === 'weakness') take(mx - 5, mx + 5, bottom - 8, bottom); else take(mx - 5, mx + 5, top, top + 8);
    return { mark, i, mx, top, bottom };
  });
  // The pivot crossing (certified daily bars only, the conclusion's own helper): a hollow upward arrow under the
  // crossing bar (its week on the weekly chart), never the filled ▲ of the 崩れ sell sign. It is green only for a
  // crossing chartCrossing confirms (1.4× or more, the latest close still at or above the pivot), grey otherwise.
  const crossingBar = model.crossing?.date ? barOf(model.crossing.date) : undefined;
  let arrow = null;
  if (crossingBar !== undefined && finite(bars[crossingBar]?.low)) {
    // Under a 崩れ mark on the same bar, the arrow goes below it.
    const under = sells.some(sell => sell.i === crossingBar && sell.mark.kind === 'weakness');
    const mx = x(crossingBar), top = Math.min(plotBottom - 11, y(bars[crossingBar].low) + (under ? 16 : 4));
    take(mx - 5.5, mx + 5.5, top - 1, top + 11);
    arrow = { mx, top, zone: model.crossing.tone === 'zone' };
  }
  let noticeBox = null;
  const notices = [];
  if (weekly && all.length < 104) notices.push(`週足は直近${all.length}週分（${(all[0].start || all[0].date).slice(0, 7).replace('-', '/')}〜）。`, '2年分はありません');
  if (!hasPivot) notices.push('ピボット 未確認');
  if (model.legsValid === false) notices.push('収縮は未確認');
  if (notices.length) {
    // The notices take the plot corner with the fewest candles and level lines under them (top-left first).
    const w = Math.max(...notices.map(notice => width(notice))), h = notices.length * 16;
    const corners = [[4, padT + 9], [4, plotBottom - h + 7], [Math.max(4, pw - 34 - w), plotBottom - h + 7], [Math.max(4, pw - 34 - w), padT + 9]];
    const score = ([x0, top]) => bars.reduce((sum, b, i) => sum + (x(i) >= x0 && x(i) <= x0 + w && y(b.high) <= top + h && y(b.low) >= top - 8 ? 1 : 0), 0) + lines.filter(ly => ly >= top - 10 && ly <= top + h).length * 4;
    const [nx, ny] = corners.reduce((best, corner) => (score(corner) < score(best) ? corner : best));
    noticeBox = { x0: nx, x1: nx + w, y0: ny - 8, y1: ny - 8 + h };
    notices.forEach((notice, i) => { const yc = claim(nx, width(notice), [ny + i * 16], true); F.push(text(nx.toFixed(1), (yc + 4).toFixed(1), notice, 'bc-notice')); });
  }
  // Contractions, newest first: the last one always shows its T number and its depth (one combined
  // 「T2 −7%」 above a box too narrow for the depth under it); older ones keep their T number, then their depth,
  // while there is room, so the oldest depths are the first left out.
  const legLabels = legs.map(leg => { const x0 = Math.max(0, x(leg.a) - bw / 2), x1 = x(leg.b) + bw / 2; return { leg, x: (x0 + x1) / 2, x0, x1 }; });
  const lastLeg = legs.at(-1)?.index;
  const tCentres = [], depthCentres = [];
  const depthText = leg => `−${Math.round(leg.depthPct)}%`;
  for (const { leg, x: cx, x0, x1 } of [...legLabels].reverse()) {
    const isLast = leg.index === lastLeg, top = y(leg.high), low = y(leg.low), depth = depthText(leg), dw = width(depth, true);
    const wide = x1 - x0 > Math.max(22, dw + 4);
    if (isLast && !wide) {
      const body = `T${leg.index + 1} ${depth}`, w = width(body), lx = clampX(cx - w / 2, w);
      const yc = claim(lx, w, [top - 9, top - 23, top + 10, top + 24, low + 11, low + 25], true);
      tCentres.push(cx);
      F.push(`<g class="bc-tlabel" data-leg="${leg.index}">${text((lx + w / 2).toFixed(1), (yc + 4).toFixed(1), body, 'bc-ttext bc-tdepth', `text-anchor="middle" font-weight="700" data-depth="${leg.depthPct}"`)}</g>`);
      continue;
    }
    const body = `T${leg.index + 1}`, w = width(body);
    if (isLast || tCentres.every(c => Math.abs(c - cx) >= 18)) {
      const yc = claim(cx - w / 2, w, isLast ? [top - 9, top + 10, top + 24, top - 23] : [top - 9, top + 10, top + 24], isLast);
      if (yc !== null) { tCentres.push(cx); F.push(`<g class="bc-tlabel" data-leg="${leg.index}">${text(cx.toFixed(1), (yc + 4).toFixed(1), body, 'bc-ttext', 'text-anchor="middle" font-weight="700"')}</g>`); }
    }
    if (wide && (isLast || depthCentres.every(c => Math.abs(c - cx) >= 36))) {
      const yc = claim(cx - dw / 2, dw, isLast ? [low + 11, low - 9, low + 25, low - 23] : [low + 11, low - 9], isLast);
      if (yc !== null) { depthCentres.push(cx); F.push(text(cx.toFixed(1), (yc + 4).toFixed(1), depth, 'bc-legtext', `text-anchor="middle" font-weight="700" ${mono} data-depth="${leg.depthPct}" data-i="${leg.index}"`)); }
    }
  }
  // Moving-average names at their right ends, spread vertically so none overlaps and never over the newest
  // candles: one whose place is taken moves to the nearest free height (a 1px leader behind the candles
  // joins it to its line's end) and is left out when there is none within 72px.
  const ends = averages.map(a => ({ a, v: a.shown.at(-1) })).filter(({ v }) => finite(v) && inRange(v)).map(({ a, v }) => ({ key: a.key, y: y(v), body: String(a.length) }));
  for (const label of spread(ends, 13, padT + 6, plotBottom - 6)) {
    const w = width(label.body, true), x0 = pw - 3 - w;
    let at = null;
    for (let d = 0; d <= 72 && at === null; d += 2) {
      for (const yc of d ? [label.at - d, label.at + d] : [label.at]) if (free(x0, w, yc, 6.5)) { at = yc; break; }
    }
    if (at === null) continue;
    take(x0, pw - 3, at - 6.5, at + 6.5);
    if (Math.abs(at - label.y) > 3) B.push(`<line x1="${pw - 1.5}" x2="${pw - 1.5}" y1="${label.y.toFixed(1)}" y2="${(at + (label.y > at ? 6 : -6)).toFixed(1)}" class="bc-maleader bc-maleader-${label.key}"/>`);
    F.push(text((pw - 3).toFixed(1), (at + 4).toFixed(1), label.body, `bc-malabel bc-malabel-${label.key}`, `text-anchor="end" font-weight="700" ${mono}`));
  }
  // The crossing's arrow, and 「上抜け 1.80×」 beside it when the helper gives the ratio and there is room, right first.
  let breakout = null;
  if (arrow) {
    const { mx, top } = arrow;
    breakout = { date: bars[crossingBar].date };
    let label = '';
    if (finite(model.crossing.volumeRatio)) {
      const body = `上抜け ${ratioShown(model.crossing.volumeRatio)}`, w = width(body), yc = top + 5;
      const at = spot(w, [[mx + 8, yc], [mx - 8 - w, yc], [mx - w / 2, yc + 15], [mx + 8, yc + 15], [mx - 8 - w, yc + 15], [mx - w / 2, yc + 29]].filter(([lx]) => lx >= 4 && lx + w <= pw - 4));
      if (at) { take(at[0], at[0] + w, at[1] - 7, at[1] + 7); label = text(at[0].toFixed(1), (at[1] + 4).toFixed(1), body, 'bc-breakouttext', 'font-weight="700"'); breakout.label = body; }
    }
    F.push(`<g class="bc-breakout${arrow.zone ? ' is-zone' : ''}" data-date="${bars[crossingBar].date}" data-tone="${arrow.zone ? 'zone' : 'neutral'}"><path d="M${mx.toFixed(1)},${top.toFixed(1)}l4.5,5h-2.75v5h-3.5v-5h-2.75z" class="bc-breakoutmark"/>${label}</g>`);
  }
  // The zone's name: the first candle-free spot along its top edge (from its left end, past the first T label,
  // its centre), then above it or along its bottom; over candles only when no candle-free spot is left.
  if (zone && zone.height > 14) {
    const body = `買いゾーン${finite(model.upper) ? ` 〜${fmt(model.upper)}` : ''}`, w = width(body);
    const xs = [...new Set([zone.x + 6, zone.x + 6 + width('T1') + 8, zone.x + (pw - zone.x) / 2 - w / 2, pw - 34 - w].map(lx => Math.round(clampX(Math.max(lx, zone.x + 2), w))))];
    const ys = [zone.top + Math.min(zone.height - 4, 14) - 4, zone.top - 9, zone.top + zone.height - 10];
    const spots = ys.flatMap(yc => xs.map(lx => [lx, yc]));
    const at = spot(w, spots) ?? spots.find(([lx, yc]) => fits(lx, lx + w, yc)) ?? null;
    if (at) { take(at[0], at[0] + w, at[1] - 7, at[1] + 7); F.push(`<g class="bc-zonelabel">${text(at[0].toFixed(1), (at[1] + 4).toFixed(1), body, 'bc-zonetext', 'font-weight="700"')}</g>`); }
  }
  // The pivot's and the stop's names next to their lines (their prices are the tags); left out when every spot is taken.
  // Over candles (with its halo) when no candle-free spot is left, never over another label or a tag.
  const nameSpot = (value, body, offsets) => {
    const w = width(body), spots = offsets.map(dy => [4, y(value) + dy]);
    const at = spot(w, spots) ?? spots.find(([lx, yc]) => fits(lx, lx + w, yc)) ?? null;
    if (at) take(4, 4 + w, at[1] - 7, at[1] + 7);
    return at;
  };
  if (hasPivot) { const at = nameSpot(model.pivot, 'ピボット', [11, -9, 25, -23]); if (at) F.push(text(4, (at[1] + 4).toFixed(1), 'ピボット', 'bc-levelnote bc-pivot-text')); }
  const stopText = finite(model.stop) ? { body: stopLabel(model.stop), at: nameSpot(model.stop, stopLabel(model.stop), [-9, 11, -23, 25]) } : null;
  // A level's label sits just above or below its line, at the left, before the averages' names or along the
  // line (clamped into the plot), and tries the other side of its line; over candles (with its halo) when no
  // candle-free spot is left, never over another label or a tag. With no spot at all the label and its line are
  // both left out. The 52-week high (it judges the stock) takes its spot first, then the plan's levels.
  levelLabels.sort((a, b) => Number(b.cls?.includes('bc-high52') ?? false) - Number(a.cls?.includes('bc-high52') ?? false));
  for (const label of levelLabels) {
    if (label.named) { F[label.slot] = label.line; continue; }
    const w = width(label.body), offsets = label.below ? [11, -9] : [-9, 11];
    const xs = [...new Set((label.x !== undefined ? [label.x, pw * 0.3, 4, pw * 0.45] : [4, pw - 34 - w, pw * 0.3, pw * 0.55, pw * 0.15]).map(lx => Math.round(clampX(lx, w))))];
    const spots = offsets.flatMap(dy => xs.map(lx => [lx, label.y + dy]));
    const at = spot(w, spots) ?? spots.find(([lx, yc]) => fits(lx, lx + w, yc)) ?? null;
    if (!at) continue;
    F[label.slot] = label.line;
    take(at[0], at[0] + w, at[1] - 7, at[1] + 7);
    F.push(text(at[0].toFixed(1), (at[1] + 4).toFixed(1), label.body, label.cls));
  }
  if (stopText) F.push(`<g class="bc-stopgroup"><line x1="0" x2="${pw}" y1="${y(model.stop)}" y2="${y(model.stop)}" class="bc-stop"/>${text(4, ((stopText.at?.[1] ?? y(model.stop) - 9) + 4).toFixed(1), stopText.body, 'bc-levelnote bc-stop-text', stopText.at ? '' : 'visibility="hidden"')}</g>`);
  // Tags.
  const tagMarkup = tag => {
    const w = tag.text ? Math.round(width(tag.text) + 10) : tagWidth(tag.value), leader = Math.abs(tag.at - tag.y) > 0.5;
    const body = tag.text ? text(pw + 7, (tag.at + 4).toFixed(1), tag.text, 'bc-tagtext bc-lowtagtext', 'font-weight="700"') : text(pw + 7, (tag.at + 4).toFixed(1), esc(tagText(tag.value)), tag.key === 'last' ? 'bc-tagtext bc-lasttagtext' : 'bc-tagtext', `font-weight="700" ${mono}`);
    return `<g class="bc-tag ${tag.cls}" data-tag="${tag.key}"><line x1="${pw - 4}" y1="${tag.y.toFixed(1)}" x2="${pw + 2}" y2="${tag.at.toFixed(1)}" class="bc-leader"${leader ? '' : ' visibility="hidden"'}/><rect x="${pw + 2}" y="${(tag.at - TAG_H / 2).toFixed(1)}" width="${w}" height="${TAG_H}" rx="4" class="${tag.cls}-fill"/>${body}</g>`;
  };
  F.push(`<g class="bc-tags">${tags.map(tagMarkup).join('')}</g>`);
  F.push(`<g class="bc-last"><circle cx="${lastX}" cy="${lastY}" r="9" class="bc-pulse"/><circle cx="${lastX}" cy="${lastY}" r="3.6" class="bc-lastdot"/></g>`);
  for (const { mark, mx, top, bottom } of sells) {
    F.push(mark.kind === 'weakness'
      ? `<path d="M${mx - 5},${bottom}h10l-5,-8z" class="bc-sell bc-sell-weak"/>`
      : `<path d="M${mx - 5},${top}h10l-5,8z" class="bc-sell bc-sell-strong"/>`);
  }
  // The RS line's new high: a dot on its last point and the tag 「RS新高値」 in the axis column beside it.
  const rsColumn = [];
  if (model.rsNewHigh && rsLast != null) {
    const body = 'RS新高値', w = Math.round(width(body) + 10), at = Math.min(Math.max(rsLast, rsTop + TAG_H / 2), rsTop + rsH - TAG_H / 2);
    rsColumn.push([at - TAG_H / 2, at + TAG_H / 2]);
    F.push(`<g class="bc-rshigh"><circle cx="${lastX}" cy="${rsLast.toFixed(1)}" r="3" class="bc-rsdot"/><line x1="${(lastX + 3).toFixed(1)}" y1="${rsLast.toFixed(1)}" x2="${pw + 2}" y2="${at.toFixed(1)}" class="bc-leader bc-rsleader"/><rect x="${pw + 2}" y="${(at - TAG_H / 2).toFixed(1)}" width="${w}" height="${TAG_H}" rx="4" class="bc-rstag-fill"/>${text(pw + 7, (at + 4).toFixed(1), body, 'bc-rstext', 'font-weight="700"')}</g>`);
  }
  // The date axis: month ticks with the year where it starts or changes, and the next earnings date: outside the
  // axis's right edge on a wide chart, as a compact flag 「E 10/10」 in the RS panel's axis column on a narrow one.
  const earnings = earningsMarker(model.earnings);
  const axisLimit = earnings && !narrow ? W - width(earnings.text) - 10 : W;
  // Labels left to right, each 8px clear of the one before; when fewer than 3 fit, every month start and
  // mid-month tick is tried instead (a phone keeps 3 dates or more on 3か月, 6か月 and 週足).
  const placeTicks = list => {
    let previousRight = -Infinity;
    return list.map(tick => {
      const tx = x(tick.i), w = width(tick.label, true), left = Math.min(Math.max(0, tx - w / 2), pw - w);
      const shown = !(left < previousRight + 8 || left + w > axisLimit);
      if (shown) previousRight = left + w;
      return { ...tick, tx, left, shown };
    });
  };
  let ticks = placeTicks(dateTicks(bars, pw));
  if (ticks.filter(t => t.shown).length < 3) {
    const dense = placeTicks(dateTicks(bars, pw, { dense: true }));
    if (dense.filter(t => t.shown).length > ticks.filter(t => t.shown).length) ticks = dense.filter(t => t.shown);
  }
  for (const tick of ticks) {
    F.push(`<line x1="${tick.tx.toFixed(1)}" x2="${tick.tx.toFixed(1)}" y1="${volTop + volH}" y2="${volTop + volH + 4}" class="bc-tick"/>`);
    if (tick.shown) F.push(text(tick.left.toFixed(1), H - 4, tick.label, `bc-axis bc-date${tick.label.includes('/') && !tick.mid ? ' bc-date-year' : ''}`, mono));
  }
  if (earnings && !narrow) F.push(text(W - 2, H - 4, earnings.text, `bc-earnings${earnings.warn ? ' bc-earnings-soon' : ''}`, 'text-anchor="end" font-weight="700"'));
  if (earnings && narrow) {
    const w = Math.round(width(earnings.short, true) + 8), fh = 18;
    let top = rsTop + rsH - fh;
    if (rsColumn.some(([a, b]) => top < b && top + fh > a)) top = rsTop;
    // A passed report's flag is dimmed with a dashed border (its 注記 key reads 「E 10/6＝決算 10/6 経過」).
    F.push(`<g class="bc-earnflag${earnings.warn ? ' bc-earnings-soon' : ''}${earnings.past ? ' is-past' : ''}" data-full="${esc(earnings.text)}"><title>${esc(earnings.text)}</title><rect x="${pw + 2}" y="${top}" width="${w}" height="${fh}" rx="4" class="bc-earnflag-fill"/>${text(pw + 6, top + 13, esc(earnings.short), 'bc-earnings', `font-weight="700" ${mono}`)}</g>`);
  }
  F.push(`<g class="bc-scrub" opacity="0"><line class="bc-cross" y1="${padT}" y2="${volTop + volH}"/><circle r="4" class="bc-crossdot"/></g><g class="bc-hover" opacity="0"><line class="bc-crossh" x1="0" x2="${pw}"/><rect x="${pw + 2}" width="${right - 4}" height="${TAG_H}" rx="4" class="bc-ylabel-fill"/>${text(pw + 7, 0, '', 'bc-ylabel', `font-weight="700" ${mono}`)}</g><rect class="bc-hit" x="0" y="0" width="${pw}" height="${volTop + volH}" fill="transparent"/>`);

  const box = `viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false"`;
  const depths = (model.legs || []).map(leg => `${Math.round(leg.depthPct)}%`).join('→');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${model.symbol} の${unit}足チャート（${bars[0].date}〜${bars[n - 1].date}）。終値 ${fmt(bars[n - 1].close)}${hasPivot ? `、ピボット ${fmt(model.pivot)}` : '、ピボット 未確認'}${finite(model.stop) ? `、損切りの目安 ${fmt(model.stop)}` : ''}${depths ? `、値幅の収縮 ${depths}` : model.legsValid === false ? '、収縮は未確認' : ''}${(model.sellMarks || []).some(m => barOf(m.date) !== undefined) ? `、売りのサインの日 ${(model.sellMarks || []).filter(m => barOf(m.date) !== undefined).map(m => m.date).join('・')}` : ''}${breakout ? `、ピボットを上抜けた日 ${breakout.date}${breakout.label ? `（${breakout.label}）` : ''}` : ''}${rsKnown.length > 1 ? `。RS線（株価÷S&P 500。RS推計やIBD RSとは別）を表示${model.rsNewHigh && rsLast != null ? '、RS新高値' : ''}` : `。RS線 未配信${model.rsReason ? `（${model.rsReason}）` : ''}`}${earnings ? `。${earnings.text}` : ''}。`);
  el.innerHTML = `<svg class="bc-layer" ${box}>${B.join('')}</svg><div class="bc-reveal"><svg class="bc-layer" ${box}>${M.join('')}</svg></div><svg class="bc-layer" ${box}>${F.join('')}</svg>`;
  const [back, reveal, front] = el.children, mid = reveal.firstChild;

  // Scrubbing: a touch or a drag (or the mouse) selects the bar under the pointer; the readout above the chart
  // shows it and keeps it after release. The mouse also gets a horizontal crosshair with its price on the axis.
  const scrub = front.querySelector('.bc-scrub'), cross = scrub.querySelector('line'), dot = scrub.querySelector('circle');
  const hover = front.querySelector('.bc-hover'), crossh = hover.querySelector('line'), ylabelFill = hover.querySelector('rect'), ylabel = hover.querySelector('text');
  let current = Number.isInteger(selected) && selected >= from && selected < all.length - 1 ? selected - from : null;
  const place = i => {
    if (i === null || i === n - 1) { scrub.setAttribute('opacity', '0'); return; }
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(bars[i].close)); scrub.setAttribute('opacity', '1');
  };
  place(current);
  const indexAt = event => { const rect = front.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.floor((event.clientX - rect.left) * W / rect.width / bw))); };
  const choose = i => { if (i === current) return; current = i; place(i); onScrub?.(i === n - 1 ? null : from + i); };
  const pointerY = event => { const rect = front.getBoundingClientRect(); return (event.clientY - rect.top) * H / rect.height; };
  const showHover = event => {
    const py = pointerY(event);
    if (py < padT || py > plotBottom) { hover.setAttribute('opacity', '0'); return; }
    const value = Math.exp(thi - (py - padT) * (thi - tlo) / ph);
    crossh.setAttribute('y1', py); crossh.setAttribute('y2', py); ylabelFill.setAttribute('y', py - TAG_H / 2); ylabel.setAttribute('y', py + 4); ylabel.textContent = tagText(value);
    hover.setAttribute('opacity', '1');
  };
  const hit = front.querySelector('.bc-hit');
  let before = null;
  hit.addEventListener('pointerdown', event => { before = current; choose(indexAt(event)); if (event.pointerType === 'mouse') showHover(event); });
  hit.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') { choose(indexAt(event)); showHover(event); } else if (event.buttons) choose(indexAt(event)); });
  hit.addEventListener('pointerleave', () => hover.setAttribute('opacity', '0'));
  // The page took the touch over to scroll: the bar touched on the way is not a choice.
  hit.addEventListener('pointercancel', () => { if (before !== current) { current = before; place(before); onScrub?.(before === null || before === n - 1 ? null : from + before); } });

  let stopController = null;
  const moveStop = (value, smooth = true) => {
    const group = front.querySelector('.bc-stopgroup'), tagGroup = front.querySelector('[data-tag="stop"]');
    if (!group || !tagGroup || !finite(value)) return;
    stopController?.abort(); stopController = new AbortController();
    const line = group.querySelector('line'), label = group.querySelector('text');
    const def = tagDefs.find(d => d.key === 'stop'); def.value = Math.max(lo * 0.5, value);
    const placed = layoutTags();
    const targets = placed.map(tag => ({ tag, group: front.querySelector(`[data-tag="${tag.key}"]`) })).filter(t => t.group);
    const starts = targets.map(({ group }) => Number(group.querySelector('rect').getAttribute('y')) + TAG_H / 2);
    const fromLine = Number(line.getAttribute('y1')), toLine = y(def.value);
    label.textContent = stopLabel(value);
    const stopTag = targets.find(t => t.tag.key === 'stop');
    stopTag.group.querySelector('text').textContent = tagText(value); stopTag.group.querySelector('rect').setAttribute('width', tagWidth(value));
    const set = p => {
      const yy = fromLine + (toLine - fromLine) * p;
      line.setAttribute('y1', yy); line.setAttribute('y2', yy); label.setAttribute('y', yy - 5);
      targets.forEach(({ tag, group }, i) => {
        const at = starts[i] + (tag.at - starts[i]) * p, leader = group.querySelector('line');
        group.querySelector('rect').setAttribute('y', at - TAG_H / 2); group.querySelector('text').setAttribute('y', at + 4);
        leader.setAttribute('y1', tag.y); leader.setAttribute('y2', at);
        if (Math.abs(tag.at - tag.y) > 0.5) leader.removeAttribute('visibility'); else leader.setAttribute('visibility', 'hidden');
      });
    };
    if (!smooth) { set(1); return; }
    tween(420, set, { easing: easeBack, signal: stopController.signal });
  };
  // A contraction chosen in the VCP card is emphasised here (null clears it).
  const highlightLeg = index => {
    for (const node of front.querySelectorAll('.bc-tlabel, .bc-legtext')) node.classList.toggle('is-dim', index !== null && index !== undefined && Number(node.dataset.leg ?? node.dataset.i) !== index);
    for (const node of back.querySelectorAll('.bc-leg')) {
      const on = index !== null && index !== undefined && Number(node.dataset.leg) === index;
      node.classList.toggle('is-on', on); node.classList.toggle('is-dim', index !== null && index !== undefined && !on);
    }
    return back.querySelector(`.bc-leg[data-leg="${index}"]`) !== null;
  };
  const select = index => { const i = Number.isInteger(index) && index >= from && index < all.length ? index - from : null; current = i === n - 1 ? null : i; place(current); };
  // The plot corner for a w×h control (「最新足」): the fewest candles, level lines and labels under it, never
  // over the notices or the selected bar. Returns its top-left in CSS pixels (the viewBox is the display size).
  const freeCorner = (w, h) => {
    const spots = [[4, padT + 4], [pw - 4 - w, padT + 4], [4, plotBottom - 4 - h], [pw - 4 - w, plotBottom - 4 - h]];
    const score = ([x0, y0]) => {
      const x1 = x0 + w, y1 = y0 + h, across = (a0, a1, b0, b1) => a1 > b0 && a0 < b1;
      let total = bars.reduce((sum, b, i) => sum + (across(x(i) - bw / 2, x(i) + bw / 2, x0, x1) && across(y(b.high), y(b.low), y0, y1) ? 1 : 0), 0);
      total += lines.filter(ly => ly >= y0 && ly <= y1).length * 4 + boxes.filter(b => across(b.x0, b.x1, x0, x1) && across(b.y0, b.y1, y0, y1)).length * 8;
      if (noticeBox && across(noticeBox.x0, noticeBox.x1, x0, x1) && across(noticeBox.y0, noticeBox.y1, y0, y1)) total += 500;
      if (current !== null && across(x(current) - 6, x(current) + 6, x0, x1)) total += 1000;
      return total;
    };
    const [bx, by] = spots.reduce((best, spot) => (score(spot) < score(best) ? spot : best));
    return { x: Math.round(Math.max(0, bx)), y: Math.round(by) };
  };
  const controller = { moveStop, highlightLeg, select, freeCorner };
  if (!animate || reduced()) { front.querySelectorAll('.bc-pulse').forEach(e => { e.style.opacity = 0; }); return controller; }

  // Intro: grid → zone → candles swept in → contractions drop one by one → rising lows → pivot draws → tags → last price pulse.
  const all$ = (root, selector) => [...root.querySelectorAll(selector)];
  const fade = (els, ms, delay, dy = 0) => Promise.all(els.map(e => tween(ms, t => { e.style.opacity = t; if (dy) e.style.transform = `translateY(${(1 - t) * dy}px)`; }, { delay, signal })));
  const sweep = 900 * k, sweepAt = 120 * k, curve = 'cubic-bezier(.65,0,.35,1)';
  fade(all$(back, '.bc-grid'), 300 * k, 0);
  fade(all$(back, '.bc-zone, .bc-gaps'), 420 * k, 160 * k);
  fade(all$(front, '.bc-zonelabel'), 420 * k, 160 * k);
  if (typeof reveal.animate === 'function') {
    reveal.animate([{ transform: `translateX(${-W}px)` }, { transform: 'translateX(0)' }], { duration: sweep, delay: sweepAt, easing: curve, fill: 'backwards' });
    mid.animate([{ transform: `translateX(${W}px)` }, { transform: 'translateX(0)' }], { duration: sweep, delay: sweepAt, easing: curve, fill: 'backwards' });
  }
  const legGroups = all$(back, '.bc-leg'), legTexts = all$(front, '.bc-legtext'), tTexts = all$(front, '.bc-tlabel');
  const legStart = sweepAt + sweep * 0.55, legGap = 190 * k;
  legGroups.forEach((group, i) => {
    const rect = group.querySelector('rect'), height = Number(rect.dataset.h), leg = Number(group.dataset.leg), depth = legTexts.find(e => Number(e.dataset.i) === leg), label = tTexts.find(e => Number(e.dataset.leg) === leg);
    tween(420 * k, p => { group.style.opacity = Math.min(1, p * 2); rect.setAttribute('height', Math.max(1, height * p)); if (label) label.style.opacity = p; if (depth) { depth.style.opacity = p; depth.textContent = `−${Math.round(Number(depth.dataset.depth) * p)}%`; } }, { delay: legStart + i * legGap, signal });
    // A combined 「T2 −7%」 keeps its text; it fades in with its box.
  });
  fade(all$(back, '.bc-lows'), 420 * k, legStart + legGroups.length * legGap + 120 * k);
  const pivot = front.querySelector('.bc-pivot'), after = sweepAt + sweep + 80 * k;
  if (pivot) {
    pivot.setAttribute('pathLength', 1); pivot.setAttribute('stroke-dasharray', '1 1');
    tween(520 * k, t => pivot.setAttribute('stroke-dashoffset', 1 - t), { delay: after, signal }).then(() => { ['pathLength', 'stroke-dasharray', 'stroke-dashoffset'].forEach(a => pivot.removeAttribute(a)); });
  }
  all$(front, '.bc-tag').forEach((group, i) => tween(380 * k, t => { group.style.opacity = Math.min(1, t); group.style.transform = `translateX(${(1 - t) * 14}px)`; }, { delay: after + 200 * k + i * 90 * k, easing: easeBack, signal }));
  fade(all$(front, '.bc-stop, .bc-planline, .bc-high52, .bc-levelnote, .bc-malabel'), 360 * k, after + 160 * k);
  fade(all$(front, '.bc-note'), 380 * k, legStart + legGroups.length * legGap + 200 * k, 4);
  fade(all$(front, '.bc-rshigh, .bc-earnflag'), 380 * k, after + 420 * k);
  fade(all$(front, '.bc-breakout'), 300 * k, after + 480 * k);
  fade(all$(front, '.bc-sell'), 300 * k, after + 480 * k);
  fade(all$(front, '.bc-last'), 300 * k, after + 340 * k).then(() => front.classList.add('bc-pulsing'));
  return controller;
}

export const _test = { niceStep, width };
