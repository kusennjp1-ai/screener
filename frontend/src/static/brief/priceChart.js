// Imperative SVG renderer for the brief's large daily chart. Three stacked layers
// share one coordinate system: back (grid, buy zone, contraction boxes), mid
// (moving averages, candles, RS line, volume — painted once and revealed with
// compositor-only transforms) and front (pivot/stop, tags, last price, scrub).
const DAY = 86400000;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeBack = t => { const c = 1.45; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const fmt = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
const signed = (value, digits = 1) => Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(digits)}%` : '—';
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mono = 'font-family="var(--font-mono)"';
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

// A window containing any non-finite value has no average; later windows recover.
function sma(values, length) {
  const out = new Array(values.length).fill(null); let sum = 0, bad = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) sum += v; else bad++;
    if (i >= length) { const old = values[i - length]; if (Number.isFinite(old)) sum -= old; else bad--; }
    if (i >= length - 1 && bad === 0) out[i] = sum / length;
  }
  return out;
}
function niceStep(lo, hi, count) {
  const raw = (hi - lo) / count;
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * power) return m * power;
  return 10 * power;
}
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
const tagText = value => value >= 1000 ? fmt(value, 0) : fmt(value, 2);

/**
 * @param {HTMLElement} el container (position: relative)
 * @param {object} model { symbol, bars:[{date,open,high,low,close,volume}], rsLine:[{time,value}], legs:[{startDate,endDate,high,low,depthPct}],
 *   pivot, upper, stop, rsNewHigh, dryUpLeg }
 * @param {object} options { period, animate, fast, signal, onScrub }
 */
export function renderPriceChart(el, model, { period = 130, animate = true, fast = false, signal } = {}) {
  const k = fast ? 0.5 : 1;
  const W = Math.max(240, Math.round(el.clientWidth)), H = Math.max(240, Math.round(el.clientHeight));
  // Weekly mode: 10/30/40-week averages stand in for the 50/150/200-day lines (same colours).
  const weekly = model.interval === 'week', unit = weekly ? '週' : '日';
  const all = weekly ? weeklyBars(model.bars) : model.bars || [];
  const n = Math.min(period, all.length), from = all.length - n, bars = all.slice(from);
  if (!n) { el.innerHTML = '<p class="brief-chart-empty">日足データが不足しています。</p>'; return null; }
  const closes = all.map(b => b.close), volumes = all.map(b => b.volume);
  const [maShort, maMiddle, maLong] = weekly ? [10, 30, 40] : [50, 150, 200], volumeLength = weekly ? 10 : 50;
  const ma = { 50: sma(closes, maShort).slice(from), 150: sma(closes, maMiddle).slice(from), 200: sma(closes, maLong).slice(from) };
  const volumeAverage = sma(volumes, volumeLength), vavg = volumeAverage.map((_, i) => (i ? volumeAverage[i - 1] : null)).slice(from); // prior sessions, excluding the bar itself
  const right = 62, pw = W - right - 2, padT = 10, axisB = 18, volH = Math.round(H * 0.15), rsH = Math.round(H * 0.11), gap = 8;
  const ph = H - padT - axisB - volH - rsH - gap * 2, rsTop = padT + ph + gap, volTop = rsTop + rsH + gap;
  const levels = [model.pivot, model.upper, model.stop].filter(Number.isFinite);
  const values = bars.flatMap(b => [b.high, b.low]).concat(levels);
  let lo = Math.min(...values), hi = Math.max(...values);
  if (!(hi > lo)) { lo *= 0.99; hi *= 1.01; } // a flat range still gets a scale
  const L = Math.log;
  const tlo = L(lo) - (L(hi) - L(lo)) * 0.05, thi = L(hi) + (L(hi) - L(lo)) * 0.05;
  const bw = pw / n, x = i => (i + 0.5) * bw, y = v => padT + (thi - L(v)) * ph / (thi - tlo);
  const uid = `brief-chart-${++sequence}`;
  const B = [], M = [], F = [];

  // Back layer
  const step = niceStep(lo, hi, 4), digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const tagYs = [model.pivot, model.stop].filter(Number.isFinite).map(y);
  B.push(`<defs><clipPath id="${uid}"><rect x="0" y="0" width="${pw}" height="${padT + ph}"/></clipPath></defs><g class="bc-grid">`);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const yy = y(v); B.push(`<line x1="0" x2="${pw}" y1="${yy}" y2="${yy}" class="bc-gridline"/>`);
    if (tagYs.every(t => Math.abs(t - yy) > 14)) B.push(`<text x="${pw + 7}" y="${yy + 4}" class="bc-axis" font-size="11" ${mono}>${fmt(v, digits)}</text>`);
  }
  B.push(`<line x1="0" x2="${pw}" y1="${rsTop - gap / 2}" y2="${rsTop - gap / 2}" class="bc-gridline"/><line x1="0" x2="${pw}" y1="${volTop - gap / 2}" y2="${volTop - gap / 2}" class="bc-gridline"/></g>`);
  if (Number.isFinite(model.pivot) && Number.isFinite(model.upper)) {
    const top = y(model.upper), height = Math.max(2, y(model.pivot) - top);
    B.push(`<g class="bc-zone" clip-path="url(#${uid})"><rect x="0" y="${top}" width="${pw}" height="${height}" class="bc-zonefill"/>${height > 14 ? `<text x="6" y="${top + Math.min(height - 4, 14)}" class="bc-zonetext" font-size="11" font-weight="700">買いゾーン</text>` : ''}</g>`);
  }
  // A contraction that began before the visible period is drawn from the period's first bar.
  const firstOnOrAfter = day => { const i = bars.findIndex(b => b.date >= day); return i < 0 ? null : i; };
  const lastOnOrBefore = day => { for (let i = n - 1; i >= 0; i--) if ((bars[i].start || bars[i].date) <= day) return i; return null; };
  const legs = (model.legs || []).map(leg => ({ ...leg, a: firstOnOrAfter(leg.startDate), b: lastOnOrBefore(leg.endDate) })).filter(leg => Number.isInteger(leg.a) && Number.isInteger(leg.b) && leg.b >= leg.a);
  B.push(`<g class="bc-legs" clip-path="url(#${uid})">`);
  for (const leg of legs) {
    const x0 = Math.max(0, x(leg.a) - bw / 2), x1 = x(leg.b) + bw / 2, top = y(leg.high), height = Math.max(1, y(leg.low) - top);
    B.push(`<g class="bc-leg"><rect x="${x0}" y="${top}" width="${Math.max(1, x1 - x0)}" height="${height}" data-h="${height}" class="bc-legbox" rx="4"/></g>`);
  }
  if (legs.length > 1) {
    const points = legs.map(leg => { let at = leg.a, low = Infinity; for (let i = leg.a; i <= leg.b; i++) if (bars[i].low < low) { low = bars[i].low; at = i; } return `${x(at).toFixed(1)},${y(low).toFixed(1)}`; });
    B.push(`<polyline points="${points.join(' ')}" class="bc-lows" fill="none" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${animate && !reduced() ? 1 : 0}"/>`);
  }
  B.push('</g>');

  // Mid layer
  M.push(`<defs><clipPath id="${uid}-m"><rect x="0" y="0" width="${pw}" height="${padT + ph}"/></clipPath></defs><g clip-path="url(#${uid}-m)">`);
  for (const length of [200, 150, 50]) {
    const d = ma[length].map((v, i) => v == null ? '' : `${ma[length][i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    if (d) M.push(`<path d="${d}" class="bc-ma bc-ma${length}" fill="none"/>`);
  }
  const cw = Math.max(1, bw * 0.64);
  bars.forEach((b, i) => {
    const cls = b.close >= b.open ? 'bc-up' : 'bc-down', xx = x(i).toFixed(1), top = y(Math.max(b.open, b.close)), height = Math.max(1, Math.abs(y(b.open) - y(b.close)));
    M.push(`<line x1="${xx}" x2="${xx}" y1="${y(b.high).toFixed(1)}" y2="${y(b.low).toFixed(1)}" class="${cls}"/><rect x="${(x(i) - cw / 2).toFixed(1)}" width="${cw.toFixed(1)}" y="${top.toFixed(1)}" height="${height.toFixed(1)}" class="${cls}"/>`);
  });
  M.push('</g>');
  const rsByDate = new Map((model.rsLine || []).map(p => [p.time || p.date, p.value]));
  const rs = bars.map(b => rsByDate.get(b.date)).map(v => (Number.isFinite(v) ? v : null));
  const rsKnown = rs.filter(Number.isFinite);
  let rsLast = null;
  if (rsKnown.length > 1) {
    const rlo = Math.min(...rsKnown), rhi = Math.max(...rsKnown), ry = v => rsTop + 4 + (rhi - v) * (rsH - 8) / (rhi - rlo || 1);
    M.push(`<path d="${rs.map((v, i) => v == null ? '' : `${rs[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${ry(v).toFixed(1)}`).join('')}" class="bc-rs" fill="none"/>`);
    if (rs.at(-1) != null) rsLast = ry(rs.at(-1));
  }
  const vmax = Math.max(...bars.map(b => b.volume), 1), vw = Math.max(1, bw * 0.7), dry = model.dryUpLeg ? { a: firstOnOrAfter(model.dryUpLeg.startDate), b: lastOnOrBefore(model.dryUpLeg.endDate) } : null;
  bars.forEach((b, i) => {
    const h = b.volume / vmax * (volH - 2), heavy = vavg[i] && b.volume >= vavg[i] * 1.4 && i >= n - (weekly ? 2 : 5), dried = dry && i >= dry.a && i <= dry.b;
    // Heavy volume on a lower close is distribution, not a breakout: draw it in the warning colour.
    const down = heavy && b.close < (i ? bars[i - 1].close : all[from - 1]?.close ?? b.open);
    M.push(`<rect x="${(x(i) - vw / 2).toFixed(1)}" y="${(volTop + volH - h).toFixed(1)}" width="${vw.toFixed(1)}" height="${h.toFixed(1)}" class="${down ? 'bc-volhi bc-volhi-down' : heavy ? 'bc-volhi' : dried ? 'bc-voldry' : 'bc-vol'}"/>`);
  });
  M.push(`<path d="${vavg.map((v, i) => v == null ? '' : `${vavg[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${(volTop + volH - v / vmax * (volH - 2)).toFixed(1)}`).join('')}" class="bc-vavg" fill="none"/>`);

  // Front layer
  // A depth label is skipped when it would collide with the previous one (narrow legs, weekly view).
  let lastLabel = -Infinity;
  for (const [i, leg] of legs.entries()) {
    const x0 = Math.max(0, x(leg.a) - bw / 2), x1 = x(leg.b) + bw / 2, yl = y(leg.low), cx = (x0 + x1) / 2;
    if (x1 - x0 > 22 && cx - lastLabel >= 34) { lastLabel = cx; F.push(`<text x="${(x0 + x1) / 2}" y="${yl + 14 > padT + ph - 2 ? yl - 5 : yl + 14}" text-anchor="middle" class="bc-legtext" font-size="11" font-weight="700" ${mono} data-depth="${leg.depthPct}" data-i="${i}">−${Math.round(leg.depthPct)}%</text>`); }
  }
  F.push(`<text x="4" y="${rsTop + 12}" class="bc-caption" font-size="11">RS線（株価÷S&amp;P 500）</text><text x="4" y="${volTop + 12}" class="bc-caption" font-size="11">出来高・${volumeLength}${unit}平均</text>`);
  if (dry && Number.isInteger(dry.a) && Number.isInteger(dry.b) && dry.b - dry.a > 3) {
    const xa = Math.max(0, x(dry.a) - bw / 2), xb = x(dry.b) + bw / 2;
    F.push(`<g class="bc-note"><path d="M${xa},${volTop - 1}v-4H${xb}v4" class="bc-bracket" fill="none"/><text x="${(xa + xb) / 2}" y="${volTop - 8}" text-anchor="middle" class="bc-notetext" font-size="11" font-weight="700">出来高の枯渇</text></g>`);
  }
  const tag = (value, cls) => { const yy = y(value), text = tagText(value); return `<g class="bc-tag ${cls}"><rect x="${pw + 2}" y="${yy - 10}" width="${text.length * 7 + 10}" height="20" rx="4" class="${cls}-fill"/><text x="${pw + 7}" y="${yy + 4}" class="bc-tagtext" font-size="11" font-weight="700" ${mono}>${esc(text)}</text></g>`; };
  if (Number.isFinite(model.pivot)) F.push(`<line x1="0" x2="${pw}" y1="${y(model.pivot)}" y2="${y(model.pivot)}" class="bc-pivot"/>`);
  if (Number.isFinite(model.stop)) F.push(`<g class="bc-stopgroup"><line x1="0" x2="${pw}" y1="${y(model.stop)}" y2="${y(model.stop)}" class="bc-stop"/>${tag(model.stop, 'bc-stoptag')}</g>`);
  if (Number.isFinite(model.pivot)) F.push(tag(model.pivot, 'bc-pivottag'));
  const lastX = x(n - 1), lastY = y(bars[n - 1].close);
  F.push(`<g class="bc-last"><circle cx="${lastX}" cy="${lastY}" r="9" class="bc-pulse"/><circle cx="${lastX}" cy="${lastY}" r="3.6" class="bc-lastdot"/></g>`);
  const markIndex = new Map(bars.map((b, i) => [b.date, i]));
  const barOf = day => { if (!weekly) return markIndex.get(day); const i = bars.findIndex(b => b.start <= day && day <= b.date); return i < 0 ? undefined : i; };
  for (const mark of model.sellMarks || []) {
    const i = barOf(mark.date); if (i === undefined) continue;
    const mx = x(i), top = Math.max(padT + 2, y(bars[i].high) - 14), bottom = Math.min(padT + ph - 2, y(bars[i].low) + 14);
    F.push(mark.kind === 'weakness'
      ? `<path d="M${mx - 5},${bottom}h10l-5,-8z" class="bc-sell bc-sell-weak"/>`
      : `<path d="M${mx - 5},${top}h10l-5,8z" class="bc-sell bc-sell-strong"/>`);
  }
  if (model.rsNewHigh && rsLast != null) F.push(`<g class="bc-rshigh"><circle cx="${lastX}" cy="${rsLast}" r="4" class="bc-rsdot"/><text x="${lastX - 8}" y="${rsLast + 4}" text-anchor="end" class="bc-rstext" font-size="11" font-weight="700">新高値</text></g>`);
  [0, Math.round(n / 2), n - 1].forEach((i, j) => F.push(`<text x="${x(i)}" y="${H - 4}" text-anchor="${['start', 'middle', 'end'][j]}" class="bc-axis" font-size="11" ${mono}>${bars[i].date.slice(5).replace('-', '/')}</text>`));
  F.push(`<g class="bc-scrub" opacity="0"><line class="bc-cross" y1="${padT}" y2="${volTop + volH}"/><circle r="4" class="bc-crossdot"/></g><rect class="bc-hit" x="0" y="0" width="${pw}" height="${volTop + volH}" fill="transparent"/>`);

  const box = `viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false"`;
  const depths = (model.legs || []).map(leg => `${Math.round(leg.depthPct)}%`).join('→');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${model.symbol} の${unit}足チャート（${bars[0].date}〜${bars[n - 1].date}）。終値 ${fmt(bars[n - 1].close)}${Number.isFinite(model.pivot) ? `、ピボット ${fmt(model.pivot)}` : ''}${Number.isFinite(model.stop) ? `、損切りの目安 ${fmt(model.stop)}` : ''}${depths ? `、値幅の収縮 ${depths}` : ''}${(model.sellMarks || []).some(m => barOf(m.date) !== undefined) ? `、売りのサインの日 ${(model.sellMarks || []).filter(m => barOf(m.date) !== undefined).map(m => m.date).join('・')}` : ''}。`);
  el.innerHTML = `<svg class="bc-layer" ${box}>${B.join('')}</svg><div class="bc-reveal"><svg class="bc-layer" ${box}>${M.join('')}</svg></div><svg class="bc-layer" ${box}>${F.join('')}</svg><div class="bc-tip" hidden></div>`;
  const [back, reveal, front] = el.children, mid = reveal.firstChild;

  // Scrubbing: hover or drag shows the session under the pointer.
  const tip = el.querySelector('.bc-tip'), scrub = front.querySelector('.bc-scrub'), cross = scrub.querySelector('line'), dot = scrub.querySelector('circle');
  let hideTimer;
  const show = event => {
    const rect = front.getBoundingClientRect(), px = (event.clientX - rect.left) * W / rect.width;
    const i = Math.max(0, Math.min(n - 1, Math.floor(px / bw))), b = bars[i], prev = bars[i - 1] || b;
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(b.close)); scrub.setAttribute('opacity', '1');
    const change = (b.close / prev.close - 1) * 100, ratio = vavg[i] ? b.volume / vavg[i] : null;
    tip.innerHTML = `<b>${weekly ? `${b.start}〜${b.date.slice(5)}` : b.date}</b><span>終値 <em>${fmt(b.close)}</em> <i class="${change >= 0 ? 'up' : 'down'}">${signed(change)}</i></span><span>高 ${fmt(b.high)}・安 ${fmt(b.low)}</span><span>出来高 ${ratio == null ? '—' : `${ratio.toFixed(2)}×`}（${volumeLength}${unit}平均比）</span>`;
    tip.hidden = false;
    const left = x(i) / W * rect.width;
    tip.style.transform = `translateX(${Math.round(left > rect.width / 2 ? left - tip.offsetWidth - 14 : left + 14)}px)`;
    clearTimeout(hideTimer);
  };
  const hide = (delay = 0) => { clearTimeout(hideTimer); hideTimer = setTimeout(() => { scrub.setAttribute('opacity', '0'); tip.hidden = true; }, delay); };
  const hit = front.querySelector('.bc-hit');
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointermove', event => { if (event.pointerType === 'mouse' || event.buttons) show(event); });
  hit.addEventListener('pointerleave', () => hide(0));
  hit.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') hide(1600); });

  let stopController = null;
  const moveStop = (value, smooth = true) => {
    const group = front.querySelector('.bc-stopgroup'); if (!group || !Number.isFinite(value)) return;
    stopController?.abort(); stopController = new AbortController();
    const line = group.querySelector('line'), rect = group.querySelector('rect'), text = group.querySelector('text');
    const from = Number(line.getAttribute('y1')), to = y(Math.max(lo * 0.5, value));
    const set = yy => { line.setAttribute('y1', yy); line.setAttribute('y2', yy); rect.setAttribute('y', yy - 10); text.setAttribute('y', yy + 4); };
    text.textContent = tagText(value); rect.setAttribute('width', tagText(value).length * 7 + 10);
    if (!smooth) { set(to); return; }
    tween(420, p => set(from + (to - from) * p), { easing: easeBack, signal: stopController.signal });
  };
  const controller = { moveStop };
  if (!animate || reduced()) { front.querySelectorAll('.bc-pulse').forEach(e => { e.style.opacity = 0; }); return controller; }

  // Intro: grid → zone → candles swept in → contractions drop one by one → rising lows → pivot draws → tags → last price pulse.
  const all$ = (root, selector) => [...root.querySelectorAll(selector)];
  const fade = (els, ms, delay, dy = 0) => Promise.all(els.map(e => tween(ms, t => { e.style.opacity = t; if (dy) e.style.transform = `translateY(${(1 - t) * dy}px)`; }, { delay, signal })));
  const sweep = 900 * k, sweepAt = 120 * k, curve = 'cubic-bezier(.65,0,.35,1)';
  fade(all$(back, '.bc-grid'), 300 * k, 0);
  fade(all$(back, '.bc-zone'), 420 * k, 160 * k);
  if (typeof reveal.animate === 'function') {
    reveal.animate([{ transform: `translateX(${-W}px)` }, { transform: 'translateX(0)' }], { duration: sweep, delay: sweepAt, easing: curve, fill: 'backwards' });
    mid.animate([{ transform: `translateX(${W}px)` }, { transform: 'translateX(0)' }], { duration: sweep, delay: sweepAt, easing: curve, fill: 'backwards' });
  }
  const legGroups = all$(back, '.bc-leg'), legTexts = all$(front, '.bc-legtext');
  const legStart = sweepAt + sweep * 0.55, legGap = 190 * k;
  legGroups.forEach((group, i) => {
    const rect = group.querySelector('rect'), height = Number(rect.dataset.h), text = legTexts.find(e => Number(e.dataset.i) === i);
    tween(420 * k, p => { group.style.opacity = Math.min(1, p * 2); rect.setAttribute('height', Math.max(1, height * p)); if (text) { text.style.opacity = p; text.textContent = `−${Math.round(Number(text.dataset.depth) * p)}%`; } }, { delay: legStart + i * legGap, signal });
  });
  const lows = back.querySelector('.bc-lows');
  if (lows) tween(520 * k, t => lows.setAttribute('stroke-dashoffset', 1 - t), { delay: legStart + legGroups.length * legGap + 120 * k, signal });
  const pivot = front.querySelector('.bc-pivot'), after = sweepAt + sweep + 80 * k;
  if (pivot) {
    pivot.setAttribute('pathLength', 1); pivot.setAttribute('stroke-dasharray', '1 1');
    tween(520 * k, t => pivot.setAttribute('stroke-dashoffset', 1 - t), { delay: after, signal }).then(() => { ['pathLength', 'stroke-dasharray', 'stroke-dashoffset'].forEach(a => pivot.removeAttribute(a)); });
  }
  all$(front, '.bc-tag').forEach((group, i) => tween(380 * k, t => { group.style.opacity = Math.min(1, t); group.style.transform = `translateX(${(1 - t) * 14}px)`; }, { delay: after + 200 * k + i * 90 * k, easing: easeBack, signal }));
  fade(all$(front, '.bc-stop'), 360 * k, after + 160 * k);
  fade(all$(front, '.bc-note'), 380 * k, legStart + legGroups.length * legGap + 200 * k, 4);
  fade(all$(front, '.bc-rshigh'), 380 * k, after + 420 * k);
  fade(all$(front, '.bc-sell'), 300 * k, after + 480 * k);
  fade(all$(front, '.bc-last'), 300 * k, after + 340 * k).then(() => front.classList.add('bc-pulsing'));
  return controller;
}

export const _test = { sma, niceStep, DAY };
