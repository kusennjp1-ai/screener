// Imperative SVG renderer for the brief's large daily chart. Three stacked layers
// share one coordinate system: back (grid, gaps, buy zone, contraction boxes), mid
// (moving averages, candles, RS line, volume — painted once and revealed with
// compositor-only transforms) and front (levels and their labels, tags, last price,
// marks, axes, scrub). Every text is 12px and the viewBox width is the display width.
import { BREAKOUT_VOLUME_RATIO, ratioShown } from './briefCandidate';
import { chartSeries, earningsMarker, formatVolume, heavyVolumeBars, priceScale, weeklyBars } from './chartReadout';
import { labelPlacer, placedAttrs, segmentCrosses, spots } from './chartLabels';

export { weeklyBars };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeBack = t => { const c = 1.45; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const finite = Number.isFinite;
const fmt = (value, digits = 2) => (finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—');
const signed = (value, digits = 1) => (finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(digits)}%` : '—');
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// VOL_HEAD: the volume panel's caption band (its tallest bar, and the dot over a heavy one, start under it, so the
// caption never sits on a bar).
// NAME_TAG_H: the tag of a level named at the right axis (no spot by its line): its name over its price.
const FS = 12, TAG_H = 20, TAG_GAP = 20, VOL_HEAD = 20, NAME_TAG_H = 32;
/**
 * Where an average's name may go: its right end up to MA_SHIFT left of its place 7px from the axis and its centre within
 * MA_NEAR of its line's end first, then up to MA_SHIFT_FAR left and within MA_FAR (with a leader). The test that checks
 * a forced name searches the nearer window. The zone's short name (「買いゾーン」, with no spot for its price) covers
 * FEW_CANDLES candles at most.
 */
export const MA_SHIFT = 32, MA_SHIFT_FAR = 64, MA_NEAR = 24, MA_FAR = 72, FEW_CANDLES = 3;
/** Each average's last MA_TAIL px of line are taken for every label but the averages' names (a depth there reads as the line's end). */
export const MA_TAIL = 20;
/**
 * A moved average's leader runs along its name's row more than LEADER_OFF_LEVEL from a level line (closer, the two read
 * as one line); a name that would otherwise be left out, more than LEADER_OFF_LEVEL_MIN.
 */
export const LEADER_OFF_LEVEL = 4.5, LEADER_OFF_LEVEL_MIN = 3;
/** How much higher than just above the band the zone's name may go (its glyphs end 27px over the band's edge at most). */
export const ZONE_ABOVE = 24;
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
// A tag's width and height: a price, a name (「安値」), or a level's name over its price.
const tagSize = tag => (tag.h ? [Math.round(Math.max(width(tag.text), width(tagText(tag.value), true)) + 10), tag.h] : [tag.text ? Math.round(width(tag.text) + 10) : tagWidth(tag.value), TAG_H]);

/** Consecutive bar indices as runs [first, last] (the RS line's lead days are drawn as one underline per run). */
export function indexRuns(indices) {
  const sorted = [...new Set(indices)].filter(Number.isInteger).sort((a, b) => a - b), runs = [];
  for (const i of sorted) { const run = runs.at(-1); if (run && i === run[1] + 1) run[1] = i; else runs.push([i, i]); }
  return runs;
}

/**
 * Spread labels so their centres are at least `gap` apart inside [top, bottom], keeping their order;
 * none is dropped. Items are { y } and gain `at` (the drawn centre). An item `h` tall (not `gap`) keeps half its
 * height from its neighbours' halves and from the ends of [top − gap/2, bottom + gap/2].
 */
export function spread(items, gap, top, bottom) {
  const list = [...items].sort((a, b) => a.y - b.y), half = item => (item.h ?? gap) / 2, apart = i => half(list[i - 1]) + half(list[i]);
  const lo = item => top - gap / 2 + half(item), hi = item => bottom + gap / 2 - half(item);
  list.forEach((item, i) => { item.at = Math.max(Math.min(Math.max(item.y, lo(item)), hi(item)), i ? list[i - 1].at + apart(i) : -Infinity); });
  for (let i = list.length - 1; i >= 0; i--) { const most = i === list.length - 1 ? hi(list[i]) : list[i + 1].at - apart(i + 1); if (list[i].at > most) list[i].at = most; }
  return list;
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
 * @param {object} options { period, animate, fast, signal, onScrub(index into the interval's bars | null), selected, carry
 *   (the levels whose names go to the right axis: set by the renderer itself when it lays the chart out again) }
 * @returns the controller (null without bars); its `legend` lists the legend items the card keeps shown ([key, text])
 */
export function renderPriceChart(el, model, options = {}) {
  const { period = 130, animate = true, fast = false, signal, onScrub, selected = null, carry = [] } = options;
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
  // Where a level line (or the zone's edge) takes the mask that cuts it under a label it runs through (see cut()).
  const CUT = ' data-cut';
  const B = [], M = [], F = [];
  const firstOnOrAfter = day => { const i = bars.findIndex(b => b.date >= day); return i < 0 ? null : i; };
  const lastOnOrBefore = day => { for (let i = n - 1; i >= 0; i--) if ((bars[i].start || bars[i].date) <= day) return i; return null; };
  const markIndex = new Map(bars.map((b, i) => [b.date, i]));
  const barOf = day => { if (!weekly) return markIndex.get(day); const i = bars.findIndex(b => b.start <= day && day <= b.date); return i < 0 ? undefined : i; };
  const last = bars[n - 1], lastX = x(n - 1), lastY = y(last.close);
  const narrow = W < NARROW_CHART_WIDTH;
  const entryDistinct = finite(model.entry) && (!hasPivot || Math.abs(model.entry / model.pivot - 1) > 0.001);
  // A label's centre stays in the plot (its top may use the padding above it).
  const inPlot = yc => yc >= padT && yc + 6 <= plotBottom;
  // The wide chart names the last contraction's low beside its line (its rows 11px under it and 9px over it, then 8px
  // and 7px) or on it, from where the line starts. Whether any such spot is clear of the candles (each 2px wider either
  // side) with no other level's line (nor the zone's top edge) through it, before any other label takes one: with none,
  // the name would sit on another level's line or over the newest candles.
  const lowNameFits = () => {
    const ys = y(model.structuralLow), w = width(`最後の収縮の安値 ${fmt(model.structuralLow)}`), reach = Math.max(1, bw * 0.64) / 2 + 2;
    const others = [model.pivot, model.stop, model.auditHigh, entryDistinct ? model.entry : null, model.r2, model.r3, hasPivot ? model.upper : null].filter(inRange).map(y).filter(ly => Math.abs(ly - ys) > 1.5);
    for (let x0 = Math.max(4, pw * 0.6); x0 <= pw - w - 4; x0 += 2) for (const dy of [11, -9, 8, -7, 0]) {
      const yc = ys + dy;
      if (!inPlot(yc) || others.some(ly => Math.abs(ly - yc) <= 5.5)) continue;
      let free = true;
      for (let i = Math.max(0, Math.floor(x0 / bw) - 1); free && i <= Math.min(n - 1, Math.ceil((x0 + w) / bw) + 1); i++) {
        const bar = bars[i];
        if (finite(bar.high) && finite(bar.low) && x(i) + reach > x0 && x(i) - reach < x0 + w && y(bar.high) < yc + 7 && y(bar.low) > yc - 7) free = false;
      }
      if (free) return true;
    }
    return false;
  };
  // A narrow chart names the last contraction's low with a tag (「安値」, its price in the legend), not a long label; a
  // wide one too when its name has no clear spot by its line (lowNameFits, or the placer found none): the legend gives
  // the price at every width.
  const lowTag = inRange(model.structuralLow) && (narrow || carry.includes('low') || !lowNameFits());
  // The other levels whose names found no spot by their lines (a second layout, `carry`): a tag at the right axis with
  // the level's name over its price (NAME_TAG_H).
  const NAME_TAGS = { high52: ['52週高', model.auditHigh], entry: ['買値', model.entry], r2: ['2R', model.r2], r3: ['3R', model.r3] };
  const nameTags = carry.filter(key => NAME_TAGS[key]).map(key => ({ key, value: NAME_TAGS[key][1], cls: 'bc-nametag', text: NAME_TAGS[key][0], h: NAME_TAG_H }));

  // Price tags on the right axis (pivot, stop, the current price, the last contraction's low on a narrow chart, and a
  // level named there); closer than 20px they stack with leaders.
  const tagDefs = [
    hasPivot ? { key: 'pivot', value: model.pivot, cls: 'bc-pivottag' } : null,
    finite(model.stop) ? { key: 'stop', value: model.stop, cls: 'bc-stoptag' } : null,
    lowTag ? { key: 'low', value: model.structuralLow, cls: 'bc-lowtag', text: '安値' } : null,
    ...nameTags,
    finite(last.close) ? { key: 'last', value: last.close, cls: 'bc-lasttag' } : null,
  ].filter(Boolean);
  const layoutTags = () => spread(tagDefs.map(def => ({ ...def, y: y(def.value) })), TAG_GAP, padT + TAG_H / 2, plotBottom - TAG_H / 2);
  const tags = layoutTags();

  // Back layer
  const step = niceStep(lo, hi, 4), digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  // The axis values drawn beside the plot: a label in the plot keeps a phrase's gap from them too (「T2 −5% 120」).
  const axisTexts = [];
  B.push(`<defs><clipPath id="${uid}"><rect x="0" y="0" width="${pw}" height="${plotBottom}"/></clipPath></defs><g class="bc-grid">`);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const yy = y(v); B.push(`<line x1="0" x2="${pw}" y1="${yy}" y2="${yy}" class="bc-gridline"/>`);
    // A grid value's text (12px around yy) clear of every tag (20px around its centre, a name over a price 32px).
    if (tags.every(t => Math.abs(t.at - yy) >= tagSize(t)[1] / 2 + 6)) { B.push(text(pw + 7, yy + 4, fmt(v, digits), 'bc-axis', mono)); axisTexts.push([pw + 7, pw + 7 + width(fmt(v, digits), true), yy - 7, yy + 7]); }
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
    // Its edge is drawn apart from the fill, so the cut under a label it runs through reaches it as it does the levels.
    const rect = `x="${zx.toFixed(1)}" y="${top}" width="${(pw - zx).toFixed(1)}" height="${height}"`;
    B.push(`<g class="bc-zone" clip-path="url(#${uid})"><rect ${rect} class="bc-zonefill"/><rect ${rect} class="bc-zoneedge" fill="none"${CUT}/></g>`);
  }
  B.push(`<g class="bc-legs" clip-path="url(#${uid})">`);
  for (const leg of legs) {
    const x0 = Math.max(0, x(leg.a) - bw / 2), x1 = x(leg.b) + bw / 2, top = y(leg.high), height = Math.max(1, y(leg.low) - top);
    B.push(`<g class="bc-leg" data-leg="${leg.index}"${finite(leg.depthPct) ? ` data-depth="${leg.depthPct}"` : ''}><rect x="${x0}" y="${top}" width="${Math.max(1, x1 - x0)}" height="${height}" data-h="${height}" class="bc-legbox" rx="4"/></g>`);
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
    if (d) M.push(`<path d="${d}" class="bc-ma bc-${average.key}${average.short ? ' bc-mashort' : ''}" fill="none"${CUT}/>`);
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
  const leadBoxes = [];
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
      leadBoxes.push({ x0, x1, y0: rsTop + rsH - 2, y1: rsTop + rsH });
    }
    if (rs.at(-1) != null) rsLast = ry(rs.at(-1));
  }
  // Volume: up, down or neutral against the previous close (the first bar of the data has none); a bar at
  // BREAKOUT_VOLUME_RATIO× its prior average or more is drawn strong with a dot on top.
  const vmax = Math.max(...bars.map(b => (finite(b.volume) ? b.volume : 0)), 1), vw = Math.max(1, bw * 0.7);
  const dry = model.dryUpLeg ? { a: firstOnOrAfter(model.dryUpLeg.startDate), b: lastOnOrBefore(model.dryUpLeg.endDate) } : null;
  const vy = v => volTop + volH - v / vmax * (volH - VOL_HEAD);
  // Each bar's top (its dot's on a heavy bar; null for a bar not drawn), an obstacle for the panel's labels.
  const volTops = bars.map(() => null);
  const heavyBars = heavyVolumeBars(model, period), heavyDays = new Set(heavyBars.map(h => h.date));
  bars.forEach((b, i) => {
    const previous = i ? bars[i - 1].close : all[from - 1]?.close;
    const direction = !finite(previous) || !finite(b.close) ? 'flat' : b.close > previous ? 'up' : b.close < previous ? 'down' : b.close >= b.open ? 'up' : 'down';
    const heavy = heavyDays.has(b.date);
    const top = finite(b.volume) ? vy(b.volume) : volTop + volH;
    if (finite(b.volume) && b.volume > 0) volTops[i] = heavy ? top - 5 : top;
    M.push(`<rect x="${(x(i) - vw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${vw.toFixed(1)}" height="${(volTop + volH - top).toFixed(1)}" class="bc-vol bc-vol-${direction}${heavy ? ` bc-volhi${direction === 'down' ? ' bc-volhi-down' : ''}` : ''}" data-date="${b.date}"/>`);
    if (heavy) M.push(`<circle cx="${x(i).toFixed(1)}" cy="${(top - 3).toFixed(1)}" r="1.8" class="bc-voldot${direction === 'down' ? ' bc-voldot-down' : ''}"/>`);
  });
  M.push(`<path d="${vavg.map((v, i) => (v == null ? '' : `${vavg[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${vy(v).toFixed(1)}`)).join('')}" class="bc-vavg" fill="none"/>`);

  // Front layer
  // Panel captions. The RS line's caption 「RS線」 takes the left corner (top or bottom) the line leaves free; what
  // it is (株価÷S&P 500, neither RS推計 nor IBD RS) is in the legend, always visible under the chart.
  const rsCaption = (() => {
    if (!(rsKnown.length > 1)) return { body: `RS線 未配信${model.rsReason ? `（${esc(model.rsReason)}）` : ''}`, base: rsTop + 12 };
    const w = width(RS_CAPTION) + 4, under = rs.map((v, i) => (v != null && x(i) <= 4 + w ? ry(v) : null)).filter(finite);
    const topBand = under.filter(yy => yy < rsTop + 15).length, bottomBand = under.filter(yy => yy > rsTop + rsH - 15).length;
    return { body: RS_CAPTION, base: bottomBand < topBand ? rsTop + rsH - 3 : rsTop + 12 };
  })();
  F.push(text(4, rsCaption.base, rsCaption.body, 'bc-caption bc-rscaption'));

  // Labels: one free-box search (chartLabels.js). In priority order (the right-axis tags and the marks are fixed and
  // taken first; then the 52-week high, the pivot and the stop, the plan's other levels, the zone, the contractions'
  // T numbers and depths, newest first, the averages' names, the crossing's ratio and the notices; in the volume panel
  // its caption, then 出来高の枯渇), each takes its first spot that overlaps no box taken and no candle (volume bar),
  // preferring one no line crosses (an average or a level). Only when no candle-free spot is left does it go over the
  // fewest candles, with its halo (data-forced="1", data-search lists the spots it tried); never over a label, a tag or a mark.
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const barsUnder = box => [Math.max(0, Math.floor(box.x0 / bw) - 1), Math.min(n - 1, Math.ceil(box.x1 / bw) + 1)];
  // A candle's box is its whole high–low range across its body's width, 2px wider each side (a bar's 1px): a label's
  // glyphs may reach 1px past its estimated width.
  // Each candle's top and bottom (null without a high or a low), worked out once for the thousands of spots tried.
  const candleTop = bars.map(bar => (finite(bar.high) && finite(bar.low) ? y(bar.high) : null)), candleBottom = bars.map(bar => (finite(bar.low) ? y(bar.low) : null));
  const solid = box => {
    const [a, b] = barsUnder(box);
    let count = 0;
    for (let i = a; i <= b; i++) {
      if (candleTop[i] !== null && overlaps(box, { x0: x(i) - cw / 2 - 2, x1: x(i) + cw / 2 + 2, y0: candleTop[i], y1: candleBottom[i] })) count++;
      if (volTops[i] !== null && overlaps(box, { x0: x(i) - vw / 2 - 1, x1: x(i) + vw / 2 + 1, y0: volTops[i], y1: volTop + volH })) count++;
      // In the RS panel, the RS line and its lead underlines.
      if (ry && box.y1 > rsTop && box.y0 < rsTop + rsH && i < b && rs[i] != null && rs[i + 1] != null && segmentCrosses([x(i), ry(rs[i])], [x(i + 1), ry(rs[i + 1])], box)) count++;
    }
    return count + (box.y1 > rsTop + rsH - 2 && box.y0 < rsTop + rsH ? leadBoxes.filter(lead => overlaps(box, lead)).length : 0);
  };
  const levelYs = [model.pivot, model.stop, model.auditHigh, entryDistinct ? model.entry : null, model.r2, model.r3].filter(inRange).map(v => ({ x0: 0, y: y(v) }));
  if (inRange(model.structuralLow)) levelYs.push({ x0: pw * 0.6, y: y(model.structuralLow) });
  // The averages across a box, and all the lines across it: the level lines and the averages (each counted once).
  const averagesAcross = box => {
    if (box.y0 >= plotBottom) return 0;
    const [a, b] = barsUnder(box);
    return averages.filter(({ shown }) => {
      for (let i = a; i < b; i++) if (shown[i] != null && shown[i + 1] != null && segmentCrosses([x(i), y(shown[i])], [x(i + 1), y(shown[i + 1])], box)) return true;
      return false;
    }).length;
  };
  const soft = box => (box.y0 >= plotBottom ? 0 : levelYs.filter(level => box.x1 > level.x0 && level.y > box.y0 && level.y < box.y1).length + averagesAcross(box));
  // A level line (or the zone's top edge) through a label's glyphs (5.5px or less from its centre) reads as struck through;
  // one that starts within 2px right of its box too (the glyphs may reach past the estimated width).
  const struckBy = zone ? [...levelYs, { x0: zone.x, y: zone.top }] : levelYs;
  const strikeWithin = (box, d) => { const yc = (box.y0 + box.y1) / 2; return struckBy.some(level => box.x1 + 2 > level.x0 && Math.abs(level.y - yc) <= d); };
  const strike = box => strikeWithin(box, 5.5);
  const placer = labelPlacer({ solid, soft, strike });
  // A level line still through a label's glyphs (no clear spot near its place) is cut under them (the level lines' mask:
  // its hole spans 6px above and below the label's centre, every line that close), so the label never reads as struck
  // through; an average across a label is cut under it too (its own mask: a line through 「109.67」 reads as 109:67).
  // The stop's name moves with its line (moveStop), and its cuts go then.
  const cuts = [], veils = [];
  const cut = (at, key = '') => { if (strikeWithin(at.box, 6)) cuts.push({ ...at.box, key }); if (averagesAcross(at.box)) veils.push({ ...at.box, key }); return ''; };
  const take = (x0, x1, y0, y1, label = false) => placer.take({ x0, x1, y0, y1, label });
  const clampX = (x0, w) => Math.min(Math.max(4, x0), pw - w - 4);
  // Centres every `step` px (2 by default) from `from` to `to`.
  const lineOf = (from, to, step = 2) => { const out = []; for (let v = from; v <= to; v += step) out.push(v); return out; };
  // Texts drawn before the labels are placed (the captions, the axes' values) keep a phrase's gap from them as labels do.
  take(4, 4 + width(rsCaption.body.replace(/&[a-z]+;/g, '_')), rsCaption.base - 11, rsCaption.base + 3, true);
  for (const box of axisTexts) take(...box, true);

  const ratio = BREAKOUT_VOLUME_RATIO.toFixed(1), dotKey = '<tspan class="bc-volkey">●</tspan>', downKey = '<tspan class="bc-volkeydown">■</tspan>';
  // A narrow chart keys the heavy down bars (■ 下落日) in this caption, beside the bars (the legend keeps two lines). The
  // caption is the longest of its forms that fits the plot's width; the shortest leaves 「以上（独自判定）」 to the 注記
  // (chartNotes keys ● and ■ with it).
  const heavyDownDrawn = heavyBars.some(h => h.direction === 'down');
  const captionWidth = caption => width(caption.replace(/<[^>]+>/g, ''));
  const captions = narrow && heavyDownDrawn ? [`出来高・${dotKey}${ratio}×以上（独自判定）・${downKey}下落日`, `出来高・${dotKey}${ratio}×・${downKey}下落日`]
    : [`出来高・${volumeLength}${unit}平均・${dotKey}${ratio}×以上（独自判定）`, `出来高・${dotKey}${ratio}×以上（独自判定）`];
  const volumeCaption = captions.find(caption => captionWidth(caption) <= pw - 8) ?? captions.at(-1);
  // The caption has the panel's top band to itself: the tallest bar starts under it (VOL_HEAD).
  F.push(text(4, volTop + 12, volumeCaption, 'bc-caption bc-volcaption'));
  take(4, 4 + captionWidth(volumeCaption), volTop + 1, volTop + 15, true);
  // The volume axis: the period's maximum beside the tallest bar's top, and the latest average (— when its window is short).
  const averageNow = series.latestAverage;
  const averageBase = Math.min(volTop + volH, Math.max(volTop + VOL_HEAD + 18, (finite(averageNow) && averageNow <= vmax ? vy(averageNow) : volTop + volH) + 4));
  F.push(text(pw + 6, volTop + VOL_HEAD + 4, formatVolume(vmax), 'bc-axis bc-volmax', mono));
  F.push(text(pw + 6, averageBase, `平均 ${formatVolume(averageNow)}`, 'bc-axis bc-volavg'));
  take(pw + 6, pw + 6 + width(formatVolume(vmax), true), volTop + VOL_HEAD - 3, volTop + VOL_HEAD + 11, true);
  take(pw + 6, pw + 6 + width(`平均 ${formatVolume(averageNow)}`), averageBase - 11, averageBase + 3, true);
  if (dry && Number.isInteger(dry.a) && Number.isInteger(dry.b) && dry.b - dry.a > 3) {
    const xa = Math.max(0, x(dry.a) - bw / 2), xb = x(dry.b) + bw / 2;
    // Its name sits over the dry-up bars: in the caption's band beside the caption when there is room, else the nearest
    // spot in the panel clear of the bars, else just above the bracket (the RS panel's foot, clear of the RS line).
    const note = '出来高の枯渇', w = width(note), ax = clampX((xa + xb) / 2 - w / 2, w), above = volTop - 13;
    const s = spots({ x0: clampX(xa - w + 8, w), x1: clampX(xb - 8, w), ys: [...lineOf(volTop + 8, volTop + volH - 7), ...(above - 7 >= rsTop ? [above] : [])], cost: (lx, yc) => Math.abs(lx - ax) + (yc === above ? 40 : 2 * Math.abs(yc - volTop - 8)) });
    const at = placer.place(w, s, { slack: 0 });
    const label = at ? text(at.x.toFixed(1), (at.yc + 4).toFixed(1), note, 'bc-notetext', `font-weight="700" ${placedAttrs(at, s.search)}`) : '';
    F.push(`<g class="bc-note"><path d="M${xa},${volTop - 1}v-4H${xb}v4" class="bc-bracket" fill="none"/><line x1="${xa}" x2="${xb}" y1="${volTop + volH + 1.5}" y2="${volTop + volH + 1.5}" class="bc-dryline"/>${label}</g>`);
  }
  // Levels: dotted plan lines (entry, 2R, 3R) and the structural low only inside the y-range; the 52-week high
  // (certified bars only, from the published audit). The y-axis is never widened for them.
  const levelLabels = [];
  // A level's line is drawn with its name: beside the line, or (no spot there: `carry`) on its tag at the right axis.
  // Its slot keeps the line's place in the layer; `key` names the level.
  const levelLine = (markup, label) => { levelLabels.push({ ...label, slot: F.length, line: markup }); F.push(''); };
  const planLine = (value, cls, key, label) => {
    if (!inRange(value)) return;
    levelLine(`<line x1="0" x2="${pw}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="bc-planline ${cls}"${CUT}/>`, carry.includes(key) ? { named: true } : { key, y: y(value), body: label, cls: `bc-levelnote ${cls}-text` });
  };
  if (entryDistinct) planLine(model.entry, 'bc-entry', 'entry', `買値 ${fmt(model.entry)}`);
  planLine(model.r2, 'bc-r2', 'r2', `2R ${fmt(model.r2)}`);
  planLine(model.r3, 'bc-r3', 'r3', `3R ${fmt(model.r3)}`);
  if (inRange(model.structuralLow)) {
    const ys = y(model.structuralLow), line = `<line x1="${(pw * 0.6).toFixed(1)}" x2="${pw}" y1="${ys.toFixed(1)}" y2="${ys.toFixed(1)}" class="bc-planline bc-structural"${CUT}/>`;
    // A narrow chart names it with its 「安値」 tag (the price is in the legend); a wide one with a label.
    levelLine(line, lowTag ? { named: true } : { key: 'low', y: ys, x: pw * 0.6, below: true, body: `最後の収縮の安値 ${fmt(model.structuralLow)}`, cls: 'bc-levelnote bc-structural-text' });
  }
  let high = null;
  if (inRange(model.auditHigh)) {
    const yh = y(model.auditHigh), distance = finite(last.close) ? (last.close / model.auditHigh - 1) * 100 : null;
    // The readout gives the distance on a phone: the label keeps the short form there.
    levelLine(`<line x1="0" x2="${pw}" y1="${yh.toFixed(1)}" y2="${yh.toFixed(1)}" class="bc-high52"${CUT}/>`, carry.includes('high52') ? { named: true } : { key: 'high52', y: yh, body: narrow ? `52週高 ${fmt(model.auditHigh)}` : `52週高値 ${fmt(model.auditHigh)}${finite(distance) ? `（${signed(distance)}）` : ''}`, cls: 'bc-levelnote bc-high52-text' });
    high = levelLabels.at(-1);
  }
  if (hasPivot) F.push(`<line x1="0" x2="${pw}" y1="${y(model.pivot)}" y2="${y(model.pivot)}" class="bc-pivot"${CUT}/>`);
  const stopLabel = value => `損切り${finite(model.entry) && model.entry > 0 && finite(value) ? ` ${signed((value / model.entry - 1) * 100)}` : ''}`;
  const lines = [model.pivot, model.upper, model.stop, model.auditHigh].filter(inRange).map(y);
  // The right-axis tags (and the leaders of those moved off their prices), the last price's dot, the sell marks and
  // the crossing's arrow are taken before any label.
  for (const tag of tags) {
    const [w, h] = tagSize(tag);
    take(pw + 2, pw + 2 + w, tag.at - h / 2, tag.at + h / 2);
    if (Math.abs(tag.at - tag.y) > 0.5) take(pw - 4, pw + 2, Math.min(tag.y, tag.at) - 1, Math.max(tag.y, tag.at) + 1);
  }
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
  // Each average's last stretch (MA_TAIL px, segment by segment as drawn) is taken for every label but the averages'
  // names: a depth or a level's name there reads as where the line ends, and pushes the line's own name away.
  for (const { shown: values } of averages) {
    if (!inRange(values[n - 1])) continue;
    for (let i = n - 1; i > 0 && lastX - x(i) < MA_TAIL; i--) {
      const [a, b] = [values[i - 1], values[i]];
      if (finite(a) && finite(b)) placer.take({ x0: x(i - 1), x1: x(i), y0: Math.min(y(a), y(b)) - 1, y1: Math.max(y(a), y(b)) + 1, tail: true });
    }
  }

  // Every label is drawn once all are placed (a later label may move an earlier one out of its way): `show` keeps the
  // label's place in its layer and `draw(at, search)` writes it there (at is null when it found no spot).
  const shown = [];
  const show = (label, draw, layer = F) => { shown.push({ label, draw, layer, slot: layer.length }); layer.push(''); return label; };
  // A level's name sits just above or below its line at the first free spot along the whole line, from the left (the
  // wide chart's structural low only along its own line, from where it starts: left of it the name would sit under
  // nothing, or under another level), one no line crosses, else the one the fewest lines cross; never where another
  // level line runs through it (`apart`: it would read as that line's name and price). Its rows by tier (LEVEL_ROWS),
  // each tried only when the tiers before have no candle-free spot: beside its line, its glyphs 3px (above) or 5px
  // (below) off it; closer in, 1–2px off it; on its line (the line cut under it: how this chart shows a label on its
  // line); and last any of those with another level's line as near as its own or between them (the name would read as
  // that line's: 「52週高」 over a pivot just above its own line goes under its line instead). With none candle-free it
  // goes over the fewest candles there, with its halo; with no spot at all its line stays and its name goes to its tag
  // (the chart is laid out again: see `carry`).
  // The 52-week high (it judges the stock) goes first, then the pivot and the stop, then the plan's levels.
  const levelSpots = (yLine, w, dys, from, cost = null) => spots({ x0: from === undefined ? 4 : Math.max(4, Math.min(from, pw - w - 4)), x1: pw - w - 4, ys: dys.map(dy => yLine + dy), inside: inPlot, cost });
  const LEVEL_ROWS = { tight: { above: -7, below: 8 }, tier: 61 };
  const LEVEL = { hard: 60, fewest: true, apart: true };
  // `reach`: how near its centre another line strikes it (the stop's name, which is never left out, at last allows a
  // line at its glyphs' edge, 4.5px or more from its centre, before one through them).
  const levelName = (yLine, w, dys, { from, kin = null, reach = 5.5 } = {}) => {
    // The other levels' lines (not its own, nor one within 1.5px of it: the two read as one line) across a label at lx.
    const others = lx => struckBy.filter(level => Math.abs(level.y - yLine) > 1.5 && lx + w + 2 > level.x0);
    const strike = box => { const yc = (box.y0 + box.y1) / 2; return others(box.x0).some(level => Math.abs(level.y - yc) <= reach); };
    const rows = [...dys, ...dys.map(dy => (dy < 0 ? LEVEL_ROWS.tight.above : LEVEL_ROWS.tight.below)), 0];
    const cost = (lx, yc) => {
      const dy = yc - yLine, tier = dy === 0 ? 2 : dys.some(d => Math.abs(d - dy) < 1e-6) ? 0 : 1;
      return (tier + (others(lx).some(level => Math.abs(level.y - yc) <= Math.abs(dy) || (level.y - yc) * (level.y - yLine) < 0) ? 3 : 0)) * LEVEL_ROWS.tier;
    };
    return placer.put(w, levelSpots(yLine, w, rows, from, cost), { ...LEVEL, kin, slack: 0, strike });
  };
  const placeLevel = level => {
    if (level.named) { F[level.slot] = level.line; return; }
    const w = width(level.body);
    level.label = show(levelName(level.y, w, level.below ? [11, -9] : [-9, 11], { from: level.x }), (at, search) => {
      if (!at) return '';
      F[level.slot] = level.line;
      return cut(at) + text(at.x.toFixed(1), (at.yc + 4).toFixed(1), level.body, level.cls, placedAttrs(at, search));
    });
  };
  if (high) placeLevel(high);
  // The pivot's and the stop's names next to their lines (their prices are the tags). The pivot's name and the zone's
  // (both green) never sit side by side on one row (KIN_GAP.plan).
  let pivotName = null, stopName = null;
  if (hasPivot) {
    const w = width('ピボット');
    pivotName = show(levelName(y(model.pivot), w, [11, -9], { kin: 'plan' }), (at, search) => (at ? cut(at) + text(at.x.toFixed(1), (at.yc + 4).toFixed(1), 'ピボット', 'bc-levelnote bc-pivot-text', placedAttrs(at, search)) : ''));
  }
  if (finite(model.stop)) {
    const body = stopLabel(model.stop), w = width(body);
    // The plan moves the stop (moveStop): the label keeps its node. Its name is never left out: with every spot beside
    // and on its line taken, it goes a row further (its red and its name still tie it to the one red dotted line), then
    // where another line only passes its glyphs' edge, and only with none there either beside its line under another
    // level's, cut there.
    let label = levelName(y(model.stop), w, [-9, 11]);
    if (!label.at) label = placer.put(w, levelSpots(y(model.stop), w, [-21, 23]), LEVEL);
    if (!label.at) label = levelName(y(model.stop), w, [-9, 11], { reach: 4.5 });
    if (!label.at) label = placer.put(w, levelSpots(y(model.stop), w, [-9, 11]), { ...LEVEL, apart: false });
    stopName = show(label, (at, search) => `<g class="bc-stopgroup"><line x1="0" x2="${pw}" y1="${y(model.stop)}" y2="${y(model.stop)}" class="bc-stop"${CUT}/>${at ? cut(at, 'stop') : ''}${text(at ? at.x.toFixed(1) : 4, ((at?.yc ?? y(model.stop) - 9) + 4).toFixed(1), body, 'bc-levelnote bc-stop-text', at ? placedAttrs(at, search) : 'visibility="hidden"')}</g>`);
  }
  for (const level of levelLabels) if (level !== high) placeLevel(level);
  // The zone's name: inside the band along its top first, then its lower rows, then just above it and up to ZONE_ABOVE
  // higher; each row from the band's left end rightwards, then leftwards (still over the band by 20px or more where
  // the band is short). 「買いゾーン 〜116.28」 keeps its upper price wherever a spot is free in those rows: candle-free
  // first, else over the fewest candles with its halo. Only with every such spot taken does it try 「買いゾーン」, over
  // FEW_CANDLES candles at most, else the green band goes unnamed. A level line through it is avoided, or cut under it.
  if (zone && zone.height > 14) {
    const zoneSpots = w => {
      const from = clampX(zone.x + 2, w), rows = [...lineOf(zone.top + 8, zone.top + zone.height - 8), ...lineOf(zone.top - 9 - ZONE_ABOVE, zone.top - 9).reverse()];
      return spots({ x0: clampX(zone.x + 20 - w, w), x1: pw - w - 4, ys: rows, inside: inPlot, cost: (lx, yc) => rows.indexOf(yc) * 10000 + (lx >= from ? lx - from : 2000 + from - lx), near: { cost: 9999, x: [-Infinity, Infinity], y: [rows[0], rows[0]] } });
    };
    let body = `買いゾーン${finite(model.upper) ? ` 〜${fmt(model.upper)}` : ''}`, w = width(body);
    let label = placer.put(w, zoneSpots(w), { kin: 'plan', hard: 60 });
    if (!label.at) {
      body = '買いゾーン'; w = width(body);
      label = placer.put(w, zoneSpots(w), { kin: 'plan', hard: 60 });
      if (label.at?.forced && solid(label.at.box) > FEW_CANDLES) placer.drop(label);
    }
    show(label, (at, search) => (at ? `<g class="bc-zonelabel">${cut(at)}${text(at.x.toFixed(1), (at.yc + 4).toFixed(1), body, 'bc-zonetext', `font-weight="700" ${placedAttrs(at, search)}`)}</g>` : ''));
  }
  // Contractions, newest first: every one shows its T number and its depth. The T number goes above its box and the
  // depth under it; one combined 「T2 −7%」 above it when the box is too narrow for the depth under it or the pair finds
  // no candle-free spots. Each takes the nearest spot around its box (inside it or beside it, accepting 24px more to
  // keep clear of the lines, and 60px more to keep a level line out of its glyphs); a depth is never left out (over
  // candles with its halo, or elsewhere in the plot when even its box's surroundings are taken).
  const legLabels = legs.map(leg => { const x0 = Math.max(0, x(leg.a) - bw / 2), x1 = x(leg.b) + bw / 2; return { leg, x: (x0 + x1) / 2, x0, x1 }; });
  const around = (w, ax, ay, { x0, x1, top, low }) => spots({ x0: clampX(x0 - w - 4, w), x1: clampX(x1 + 4, w), ys: lineOf(top - 30, low + 30), inside: inPlot, cost: (lx, yc) => Math.abs(lx - ax) + 2 * Math.abs(yc - ay), near: { cost: 64, x: [ax - 64, ax + 64], y: [ay - 32, ay + 32] } });
  const tLabel = (leg, body, depth) => (at, search) => (at ? `<g class="bc-tlabel" data-leg="${leg.index}">${cut(at)}${text((at.x + width(body) / 2).toFixed(1), (at.yc + 4).toFixed(1), body, `bc-ttext${depth ? ' bc-tdepth' : ''}`, `text-anchor="middle" font-weight="700"${depth ? ` data-depth="${leg.depthPct}"` : ''} ${placedAttrs(at, search)}`)}</g>` : '');
  for (const { leg, x: cx, x0, x1 } of [...legLabels].reverse()) {
    const area = { x0, x1, top: y(leg.high), low: y(leg.low) };
    if (!finite(area.top) || !finite(area.low)) continue;
    const tBody = `T${leg.index + 1}`, tw = width(tBody), depth = finite(leg.depthPct) ? `−${Math.round(leg.depthPct)}%` : null, dw = depth ? width(depth, true) : 0;
    if (depth && x1 - x0 > Math.max(22, dw + 4)) {
      const t = placer.put(tw, around(tw, cx - tw / 2, area.top - 9, area), { forced: false, repair: true, slack: 24, hard: 60, kin: 'tn' });
      const d = t.at ? placer.put(dw, around(dw, cx - dw / 2, area.low + 11, area), { forced: false, repair: true, slack: 24, hard: 60, kin: 'leg' }) : null;
      if (d?.at) {
        show(t, tLabel(leg, tBody, false));
        show(d, (at, search) => (at ? cut(at) + text((at.x + dw / 2).toFixed(1), (at.yc + 4).toFixed(1), depth, 'bc-legtext', `text-anchor="middle" font-weight="700" ${mono} data-depth="${leg.depthPct}" data-i="${leg.index}" ${placedAttrs(at, search)}`) : ''));
        continue;
      }
      placer.drop(t);
    }
    const body = depth ? `${tBody} ${depth}` : tBody, w = width(body);
    let label = placer.put(w, around(w, cx - w / 2, area.top - 9, area), { slack: 24, hard: 60, kin: 'tn' });
    // The whole plot on a coarse grid (8px across, 4px down): only when even the box's surroundings are taken.
    if (!label.at && depth) label = placer.put(w, spots({ x0: 4, x1: pw - w - 4, ys: lineOf(padT + 6, plotBottom - 6, 4), step: 8, cost: (lx, yc) => Math.abs(lx - cx + w / 2) + 2 * Math.abs(yc - area.top + 9) }), { hard: 60, kin: 'tn' });
    show(label, tLabel(leg, body, depth));
  }
  // The averages' names at their lines' right ends, ending 7px left of the axis (clear of the tags and their leaders):
  // the nearest candle-free spot within MA_NEAR of the end's height and up to MA_SHIFT further left, then within MA_FAR
  // and up to MA_SHIFT_FAR left; a 1px leader behind the candles joins a moved name to its line's end, unless its own
  // line runs into the name's right end. Over the candles (each counted as 6px further) only when that whole window has
  // no candle-free spot; left out only when every spot in it is taken. A level line through a name is cut under it. The
  // leader is the name's own: its segments are reserved with the name (no later label sits on them), and a spot whose
  // leader would run through a label, another leader or a mark, or along a level line, is not taken, so a leader never
  // joins two names into one phrase (「150—10」) nor reads as part of a level. Two lines ending within 3px of each other
  // end at one point: their names may hang off one leader the same way, stacked in the order of the ends (sharedLeader).
  const ends = averages.map(a => ({ a, v: a.shown.at(-1) })).filter(({ v }) => finite(v) && inRange(v)).map(({ a, v }) => ({ key: a.key, y: y(v), body: String(a.length), shown: a.shown }));
  // Where an average's line runs at xx (straight between its points, as drawn), or null where it has no value there.
  const lineAt = (shownValues, xx) => {
    const i = Math.floor(xx / bw - 0.5), a = shownValues[i], b = shownValues[i + 1];
    return finite(a) && finite(b) ? y(a) + (y(b) - y(a)) * (xx / bw - 0.5 - i) : null;
  };
  // Every line's end is held in the gutter first: no other line's leader runs past it (it would read as joined to it).
  for (const end of ends) placer.take({ x0: pw - 2.5, x1: pw - 0.5, y0: end.y - 1.5, y1: end.y + 1.5, leader: 'end', key: end.key });
  const placeName = (end, offLevel = LEADER_OFF_LEVEL) => {
    const w = width(end.body, true), lx = pw - 7 - w, lo = Math.floor(Math.min(end.at, end.y) - MA_FAR), hi = Math.ceil(Math.max(end.at, end.y) + MA_FAR);
    const cost = (x0, yc) => { const d = Math.abs(yc - end.at); return (d > MA_NEAR ? 1000 : 0) + d + lx - x0; };
    const near = { cost: MA_NEAR + MA_SHIFT, x: [lx - MA_SHIFT, lx], y: [end.at - MA_NEAR, end.at + MA_NEAR] };
    // Beside the line's end: straight down or up to the name; a name moved left: on to its right end. None at the end
    // itself (within 3px of its height), nor for a moved name its own line runs into (within 3px, 3px right of it).
    const leaderOf = (x0, yc) => {
      const shifted = x0 < lx - 1;
      if (shifted ? Math.abs((lineAt(end.shown, x0 + w + 3) ?? Infinity) - yc) <= 3 : Math.abs(yc - end.y) <= 3) return null;
      return { tip: shifted ? yc : yc + (end.y > yc ? 6 : -6), shifted, to: x0 + w + 2 };
    };
    // Its segments as boxes: the vertical part 2px wide in the axis gutter, the horizontal part 4px tall; null (no such
    // spot) when the horizontal part would run along a level line or the zone's edge (within `offLevel`).
    const leader = (x0, yc) => {
      const path = leaderOf(x0, yc);
      if (!path) return [];
      if (path.shifted && struckBy.some(level => level.x0 < pw - 1.5 && Math.abs(level.y - yc) <= offLevel)) return null;
      const segments = [{ x0: pw - 2.5, x1: pw - 0.5, y0: Math.min(end.y, path.tip) - 1, y1: Math.max(end.y, path.tip) + 1, leader: 'v', key: end.key, from: end.y, up: path.tip < end.y, tip: path.tip }];
      if (path.shifted) segments.push({ x0: path.to, x1: pw - 1.5, y0: yc - 2, y1: yc + 2, leader: 'h', key: end.key, from: end.y, up: path.tip < end.y, tip: path.tip });
      return segments;
    };
    // Every 1px across and down (a name fits between two candles a coarser grid steps over), up to MA_SHIFT_FAR left.
    const label = placer.put(w, spots({ x0: lx - MA_SHIFT_FAR, x1: lx, ys: lineOf(lo, hi, 1), step: 1, inside: inPlot, cost, near }), { half: 6.5, slack: 0, perCandle: 6, leader, kin: 'ma' });
    return { end, w, label, leaderOf };
  };
  // In the order of their ends (top first). When a name finds no spot at all, or only over candles, the names go again
  // from the same state (the other labels back where they were): with those names first, then (in either order) letting
  // a leader run nearer a level line (LEADER_OFF_LEVEL_MIN); the first try that leaves none out and none over candles is
  // kept, else the one that leaves the fewest out (or as many, the fewest over candles; the earliest of equals).
  const order = spread(ends, 13, padT + 6, plotBottom - 6);
  const score = list => list.filter(name => !name.label.at).length * 1000 + list.filter(name => name.label.at?.forced).length;
  const beforeNames = placer.snapshot();
  let names = order.map(end => placeName(end));
  if (score(names) > 0) {
    const missing = names.filter(name => !name.label.at || name.label.at.forced).map(name => name.end), first = [...missing, ...order.filter(end => !missing.includes(end))];
    let best = { list: order, offLevel: LEADER_OFF_LEVEL, score: score(names) }, last = best;
    for (const [list, offLevel] of [[first, LEADER_OFF_LEVEL], [order, LEADER_OFF_LEVEL_MIN], [first, LEADER_OFF_LEVEL_MIN]]) {
      placer.restore(beforeNames);
      names = list.map(end => placeName(end, offLevel));
      last = { list, offLevel, score: score(names) };
      if (last.score < best.score) best = last;
      if (last.score === 0) break;
    }
    if (last !== best) { placer.restore(beforeNames); names = best.list.map(end => placeName(end, best.offLevel)); }
  }
  for (const { end, w, label, leaderOf } of names) {
    show(label, at => {
      const path = at && leaderOf(at.x, at.yc);
      return path ? `<path d="M${pw - 1.5},${end.y.toFixed(1)}V${path.tip.toFixed(1)}${path.shifted ? `H${path.to.toFixed(1)}` : ''}" class="bc-maleader bc-maleader-${end.key}" fill="none"/>` : '';
    }, B);
    show(label, (at, search) => (at ? cut(at) + text((at.x + w).toFixed(1), (at.yc + 4).toFixed(1), end.body, `bc-malabel bc-malabel-${end.key}`, `text-anchor="end" font-weight="700" ${mono} ${placedAttrs(at, search)}`) : ''));
  }
  // The crossing's arrow, and 「上抜け 1.80×」 beside it when the helper gives the ratio and a candle-free spot is left:
  // right of it first, then left, under it, and then the nearest spot within 24px across and 44px down; a level line
  // through it is avoided, or cut under it, and when an average crosses every near spot, the one the fewest cross
  // wins (a line through 「0.51×」 reads as 0:51). The summary names the ratio either way.
  let breakout = null;
  if (arrow) {
    const { mx, top } = arrow, date = bars[crossingBar].date;
    breakout = { date };
    let label = { at: null, spots: { search: '' } }, body = '';
    if (finite(model.crossing.volumeRatio)) {
      body = `上抜け ${ratioShown(model.crossing.volumeRatio)}`;
      breakout.label = body;
      const w = width(body), yc = top + 5, fits = ([lx, c]) => lx >= 4 && lx + w <= pw - 4 && inPlot(c);
      const first = [[mx + 8, yc], [mx - 8 - w, yc], [mx - w / 2, yc + 15], [mx + 8, yc + 15], [mx - 8 - w, yc + 15], [mx - w / 2, yc + 29]].filter(fits).map(([lx, c], i) => [lx, c, i - 6]);
      const near = spots({ x0: Math.max(4, mx - 8 - w - 24), x1: Math.min(pw - w - 4, mx + 8 + 24), ys: lineOf(yc - 14, yc + 44), inside: inPlot, first, cost: (lx, c) => Math.abs(lx + w / 2 - mx) + 2 * Math.abs(c - yc) });
      label = placer.put(w, near, { forced: false, repair: true, slack: 24, hard: 60, fewest: true });
    }
    show(label, (at, search) => `<g class="bc-breakout${arrow.zone ? ' is-zone' : ''}" data-date="${date}" data-tone="${arrow.zone ? 'zone' : 'neutral'}"><path d="M${mx.toFixed(1)},${top.toFixed(1)}l4.5,5h-2.75v5h-3.5v-5h-2.75z" class="bc-breakoutmark"/>${at ? cut(at) + text(at.x.toFixed(1), (at.yc + 4).toFixed(1), body, 'bc-breakouttext', `font-weight="700" ${placedAttrs(at, search)}`) : ''}</g>`);
  }
  // The notices (one block, a line each): a plot corner first (top-left, bottom-left, bottom-right, top-right), else the
  // free spot nearest one on a coarse grid (8px across, 4px down), clear of the lines within 64px more; over the fewest
  // candles when none is free.
  let noticeLabel = null;
  const notices = [];
  if (weekly && all.length < 104) notices.push(`週足は直近${all.length}週分（${(all[0].start || all[0].date).slice(0, 7).replace('-', '/')}〜）。`, '2年分はありません');
  if (!hasPivot) notices.push('ピボット 未確認');
  if (model.legsValid === false) notices.push('収縮は未確認');
  if (notices.length) {
    // A line wider than the plot breaks before its parenthesis (「週足は直近58週分」「（2025/08〜）。」 at 320px).
    const lines = notices.flatMap(notice => (width(notice) > pw - 8 && notice.indexOf('（') > 0 ? [notice.slice(0, notice.indexOf('（')), notice.slice(notice.indexOf('（'))] : [notice]));
    notices.splice(0, notices.length, ...lines);
    const w = Math.min(Math.max(...notices.map(notice => width(notice))), pw - 8), half = notices.length * 8 - 1;
    const right = clampX(pw - 34 - w, w), yTop = padT + 2 + half, yBottom = plotBottom - 2 - half;
    const corners = [[4, yTop], [4, yBottom], [right, yBottom], [right, yTop]];
    const grid = spots({ x0: 4, x1: pw - w - 4, ys: lineOf(yTop, yBottom, 4), step: 8, first: corners.filter(([cx]) => cx >= 4).map(([cx, cy]) => [cx, cy, -1]), cost: (lx, yc) => { let near = Infinity; for (const [cx, cy] of corners) near = Math.min(near, Math.abs(lx - cx) + Math.abs(yc - cy)); return near; } });
    const label = placer.put(w, grid, { half, slack: 64 });
    // They are always drawn: with every spot taken, at the top-left corner.
    label.at ??= { x: 4, yc: yTop, box: { x0: 4, x1: 4 + w, y0: yTop - half, y1: yTop + half }, forced: true };
    noticeLabel = label;
    // A level line through a line of them is cut under it.
    notices.forEach((notice, i) => show(label, (at, search) => {
      const centre = at.yc - half + 7 + i * 16;
      return cut({ box: { x0: at.x, x1: at.x + width(notice), y0: centre - 7, y1: centre + 7 } }) + text(at.x.toFixed(1), (centre + 4).toFixed(1), notice, 'bc-notice', placedAttrs(at, search));
    }));
  }
  placer.settle();
  // A level whose name found no spot by its line keeps its line: the chart is laid out again with its name and price on
  // a tag at the right axis (the last contraction's low: 「安値」, its price in the legend), taken before any label.
  const unplaced = levelLabels.filter(level => level.label && !level.label.at).map(level => level.key);
  if (unplaced.length) return renderPriceChart(el, model, { ...options, carry: [...carry, ...unplaced] });
  for (const { label, draw, layer, slot } of shown) layer[slot] = draw(label.at, label.spots.search);
  // The legend items the card keeps shown (never folded to the 注記): the wide chart's 「安値」 tag's price, and the pivot's or
  // the stop's name with no spot by its line (their prices are their tags).
  const legend = [
    ...(carry.includes('low') ? [['low', `最後の収縮の安値 ${fmt(model.structuralLow)}`]] : []),
    ...(pivotName && !pivotName.at ? [['pivot', 'ピボット']] : []),
    ...(stopName && !stopName.at ? [['stop', stopLabel(model.stop)]] : []),
  ];
  // The mask, in the front layer for the levels and in the back one for the zone's edge (and the averages' own). A
  // level's hole within 8px of the plot's edge reaches it: a stub of dotted line beside a label reads as a minus sign
  // (「-52週高」).
  const hole = (c, edges) => { const x0 = edges && c.x0 - 1 < 8 ? 0 : c.x0 - 1, x1 = edges && c.x1 + 1 > pw - 8 ? pw : c.x1 + 1; return `<rect x="${x0.toFixed(1)}" y="${((c.y0 + c.y1) / 2 - 6).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="12" fill="#000"${c.key ? ` data-for="${c.key}"` : ''}/>`; };
  const cutMask = (id, list = cuts) => `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${list.map(c => hole(c, list === cuts)).join('')}</mask></defs>`;
  if (cuts.length) { F.push(cutMask(`${uid}-cut`)); B.push(cutMask(`${uid}-cutb`)); }
  const noticeBox = noticeLabel?.at.box ?? null;
  // Tags.
  const tagMarkup = tag => {
    const [w, h] = tagSize(tag), leader = Math.abs(tag.at - tag.y) > 0.5;
    const price = (dy, cls) => text(pw + 7, (tag.at + dy).toFixed(1), esc(tagText(tag.value)), cls, `font-weight="700" ${mono}`);
    const body = tag.h ? text(pw + 7, (tag.at - 3).toFixed(1), tag.text, `bc-tagtext bc-nametagtext bc-${tag.key}-text`, 'font-weight="700"') + price(11, 'bc-tagtext bc-nametagtext')
      : tag.text ? text(pw + 7, (tag.at + 4).toFixed(1), tag.text, 'bc-tagtext bc-lowtagtext', 'font-weight="700"') : price(4, tag.key === 'last' ? 'bc-tagtext bc-lasttagtext' : 'bc-tagtext');
    return `<g class="bc-tag ${tag.cls}" data-tag="${tag.key}"><line x1="${pw - 4}" y1="${tag.y.toFixed(1)}" x2="${pw + 2}" y2="${tag.at.toFixed(1)}" class="bc-leader"${leader ? '' : ' visibility="hidden"'}/><rect x="${pw + 2}" y="${(tag.at - h / 2).toFixed(1)}" width="${w}" height="${h}" rx="4" class="${tag.cls}-fill"/>${body}</g>`;
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
  el.innerHTML = `<svg class="bc-layer" ${box}>${B.join('').replaceAll(CUT, cuts.length ? ` mask="url(#${uid}-cutb)"` : '')}</svg><div class="bc-reveal"><svg class="bc-layer" ${box}>${M.join('').replaceAll(CUT, veils.length ? ` mask="url(#${uid}-veil)"` : '')}${veils.length ? cutMask(`${uid}-veil`, veils) : ''}</svg></div><svg class="bc-layer" ${box}>${F.join('').replaceAll(CUT, cuts.length ? ` mask="url(#${uid}-cut)"` : '')}</svg>`;
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
    // The stop's name leaves its place: the cut under it goes too.
    el.querySelectorAll('mask rect[data-for="stop"]').forEach(node => node.remove());
    const def = tagDefs.find(d => d.key === 'stop'); def.value = Math.max(lo * 0.5, value);
    const placed = layoutTags();
    const targets = placed.map(tag => ({ tag, group: front.querySelector(`[data-tag="${tag.key}"]`) })).filter(t => t.group);
    const starts = targets.map(({ tag, group }) => Number(group.querySelector('rect').getAttribute('y')) + tagSize(tag)[1] / 2);
    const fromLine = Number(line.getAttribute('y1')), toLine = y(def.value);
    label.textContent = stopLabel(value);
    const stopTag = targets.find(t => t.tag.key === 'stop');
    stopTag.group.querySelector('text').textContent = tagText(value); stopTag.group.querySelector('rect').setAttribute('width', tagWidth(value));
    const set = p => {
      const yy = fromLine + (toLine - fromLine) * p;
      line.setAttribute('y1', yy); line.setAttribute('y2', yy); label.setAttribute('y', yy - 5);
      targets.forEach(({ tag, group }, i) => {
        const at = starts[i] + (tag.at - starts[i]) * p, leader = group.querySelector('line');
        group.querySelector('rect').setAttribute('y', at - tagSize(tag)[1] / 2);
        group.querySelectorAll('text').forEach((node, k) => node.setAttribute('y', at + (tag.h ? (k ? 11 : -3) : 4)));
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
      total += lines.filter(ly => ly >= y0 && ly <= y1).length * 4 + placer.boxes.filter(b => !b.tail && across(b.x0, b.x1, x0, x1) && across(b.y0, b.y1, y0, y1)).length * 8;
      if (noticeBox && across(noticeBox.x0, noticeBox.x1, x0, x1) && across(noticeBox.y0, noticeBox.y1, y0, y1)) total += 500;
      if (current !== null && across(x(current) - 6, x(current) + 6, x0, x1)) total += 1000;
      return total;
    };
    const [bx, by] = spots.reduce((best, spot) => (score(spot) < score(best) ? spot : best));
    return { x: Math.round(Math.max(0, bx)), y: Math.round(by) };
  };
  const controller = { moveStop, highlightLeg, select, freeCorner, legend };
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
