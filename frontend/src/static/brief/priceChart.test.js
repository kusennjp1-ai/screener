import { describe, expect, it, vi } from 'vitest';
import { _test, dateTicks, indexRuns, MA_SHIFT, MA_TAIL, NARROW_CHART_WIDTH, renderPriceChart, RS_CAPTION, spread, weeklyBars, ZONE_ABOVE } from './priceChart';
import { FIGURE_GAP, FIGURE_STACK, PHRASE_GAP, segmentCrosses, sharedLeader } from './chartLabels';
import { chartContentKey, earningsMarker, EARNINGS_MARKER_DAYS } from './chartReadout';
import { EARNINGS_WARN_DAYS, earningsCall } from './briefCandidate';

function container(width = 600, height = 420) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  document.body.appendChild(el);
  return el;
}
const day = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const bars = Array.from({ length: 300 }, (_, i) => { const c = 50 + i * 0.2 + Math.sin(i / 6); return { date: day(i), open: c - 0.3, high: c + 1, low: c - 1, close: c, volume: 1000 + (i % 7) * 100 }; });
const model = {
  symbol: 'TEST', bars, rsLine: bars.map((b, i) => ({ time: b.date, value: 100 + i * 0.1 })), pivot: 108, upper: 113.4, stop: 100.4, entry: 108, rsNewHigh: true,
  legs: [{ startDate: day(220), endDate: day(245), high: 108, low: 95, depthPct: 12 }, { startDate: day(250), endDate: day(275), high: 108, low: 102, depthPct: 5.6 }], legsValid: true,
};
const texts = (el, selector) => [...el.querySelectorAll(selector)].map(node => node.textContent);
/**
 * The drawn label boxes as the renderer lays them out (jsdom has no layout): each label's text width at 12px
 * (the renderer's estimate), 12px around its centre (baseline − 4); every tag's rect and the last price's dot.
 */
function chartBoxes(el, selector = '.bc-levelnote, .bc-malabel, .bc-ttext, .bc-legtext, .bc-zonetext, .bc-notice, .bc-breakouttext, .bc-rscaption') {
  const labels = [...el.querySelectorAll(selector)]
    .filter(node => node.getAttribute('visibility') !== 'hidden').map(node => {
      const w = _test.width(node.textContent, (node.getAttribute('font-family') || '').includes('mono')), x = Number(node.getAttribute('x')), anchor = node.getAttribute('text-anchor');
      const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x, centre = Number(node.getAttribute('y')) - 4;
      return { name: node.textContent, ma: node.classList.contains('bc-malabel'), x0, x1: x0 + w, y0: centre - 6, y1: centre + 6 };
    });
  const rects = [...el.querySelectorAll('.bc-tag rect, .bc-rshigh rect, .bc-earnflag rect')].map(node => ({ name: node.closest('[data-tag]')?.dataset.tag || node.getAttribute('class'), x0: Number(node.getAttribute('x')), x1: Number(node.getAttribute('x')) + Number(node.getAttribute('width')), y0: Number(node.getAttribute('y')), y1: Number(node.getAttribute('y')) + Number(node.getAttribute('height')) }));
  const dot = el.querySelector('.bc-lastdot'), cx = Number(dot.getAttribute('cx')), cy = Number(dot.getAttribute('cy'));
  return { labels, solid: [...rects, { name: 'last dot', x0: cx - 3.6, x1: cx + 3.6, y0: cy - 3.6, y1: cy + 3.6 }] };
}
const collisions = el => {
  const { labels, solid } = chartBoxes(el), hit = (a, b) => a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.y0 < b.y1 - 0.5 && a.y1 > b.y0 + 0.5, out = [];
  labels.forEach((a, i) => { for (const b of [...labels.slice(i + 1), ...solid]) if (hit(a, b)) out.push(`${a.name} × ${b.name}`); });
  return out;
};
const tagCentre = (el, key) => Number(el.querySelector(`[data-tag="${key}"] rect`).getAttribute('y')) + 10;
/** Each average's leader as its vertical and horizontal parts (boxes 1px wide), with the key of the name it joins. */
const leaderSegments = el => [...el.querySelectorAll('path.bc-maleader')].flatMap(path => {
  const key = [...path.classList].find(cls => cls.startsWith('bc-maleader-')).slice('bc-maleader-'.length), out = [];
  let x = 0, y = 0, start = 0;
  for (const [, cmd, value] of path.getAttribute('d').matchAll(/([MVH])([^MVH]+)/g)) {
    if (cmd === 'M') { [x, y] = value.split(',').map(Number); start = y; continue; }
    const v = Number(value);
    if (cmd === 'V') { out.push({ key, v: true, from: y, tip: v, up: v < y, x0: x - 0.5, x1: x + 0.5, y0: Math.min(y, v), y1: Math.max(y, v) }); y = v; }
    else { out.push({ key, h: true, from: start, tip: y, up: y < start, x0: Math.min(x, v), x1: Math.max(x, v), y0: y - 0.5, y1: y + 0.5 }); x = v; }
  }
  return out;
});
/**
 * Averages' names away from their lines with no leader: a name without one sits at its line's end (unmoved, within 3px
 * of its height) or on its own line (the line runs into its right end, within 3px).
 */
const detached = (el, pw) => [...el.querySelectorAll('.bc-malabel')].flatMap(node => {
  const key = [...node.classList].find(cls => cls.startsWith('bc-malabel-')).slice('bc-malabel-'.length);
  if (el.querySelector(`path.bc-maleader-${key}`)) return [];
  const points = el.querySelector(`path.bc-ma.bc-${key}`).getAttribute('d').split(/[ML]/).filter(Boolean).map(pair => pair.split(',').map(Number));
  const right = Number(node.getAttribute('x')), yc = Number(node.getAttribute('y')) - 4, end = points.at(-1);
  const i = points.findIndex((p, k) => points[k + 1] && p[0] <= right + 3 && points[k + 1][0] >= right + 3), [p, q] = [points[i], points[i + 1]];
  const along = i >= 0 ? p[1] + (q[1] - p[1]) * (right + 3 - p[0]) / (q[0] - p[0]) : null;
  return (right >= pw - 8.1 && Math.abs(yc - end[1]) <= 3.2) || (along !== null && Math.abs(along - yc) <= 3.2) ? [] : [`${node.textContent} at ${right - pw}px, ${(yc - end[1]).toFixed(1)}px off`];
});
/**
 * Two averages' leaders that meet: one runs along or across the other, except two vertical parts leaving one point (ends
 * within 3px) apart, or the same way as one shared leader with their names in the order of the ends (sharedLeader), a
 * nearer name's horizontal part branching off it.
 */
const leadersMeet = el => {
  const segments = leaderSegments(el), hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  return segments.flatMap((a, i) => segments.slice(i + 1).filter(b => b.key !== a.key && hit(a, b) && !(Math.abs(a.from - b.from) <= 3 && ((a.v && b.v && a.up !== b.up) || ((a.v || b.v) && sharedLeader(a, b))))).map(b => `${a.key} × ${b.key}`));
};
/** Level names centred within 5.5px of another level's line or the zone's top edge (they would read as its name); a line within 1.5px of its own reads as the same line. */
const OWN_LINE = { 'bc-pivot-text': 'bc-pivot', 'bc-stop-text': 'bc-stop', 'bc-high52-text': 'bc-high52', 'bc-entry-text': 'bc-entry', 'bc-r2-text': 'bc-r2', 'bc-r3-text': 'bc-r3', 'bc-structural-text': 'bc-structural' };
const onOtherLevel = el => {
  const lines = [...el.querySelectorAll('line.bc-planline, line.bc-high52, line.bc-pivot, line.bc-stop')].map(line => ({ cls: [...line.classList].find(cls => Object.values(OWN_LINE).includes(cls)), x0: Number(line.getAttribute('x1')), x1: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y1')) }));
  const edge = el.querySelector('rect.bc-zoneedge');
  if (edge) lines.push({ cls: 'zone', x0: Number(edge.getAttribute('x')), x1: Number(edge.getAttribute('x')) + Number(edge.getAttribute('width')), y: Number(edge.getAttribute('y')) });
  return [...el.querySelectorAll('.bc-levelnote')].filter(node => node.getAttribute('visibility') !== 'hidden').flatMap(node => {
    const own = OWN_LINE[[...node.classList].find(cls => OWN_LINE[cls])], x0 = Number(node.getAttribute('x')), x1 = x0 + _test.width(node.textContent), yc = Number(node.getAttribute('y')) - 4;
    const ownY = lines.find(line => line.cls === own)?.y;
    return lines.filter(line => line.cls !== own && !(Math.abs(line.y - ownY) <= 1.5) && line.x1 > x0 && line.x0 < x1 && Math.abs(line.y - yc) <= 5.5).map(line => `${node.textContent} on ${line.cls} (${(line.y - yc).toFixed(1)}px)`);
  });
};
/** Labels a leader runs through (any label but the name it joins). */
const leaderThrough = el => {
  const names = new Map([...el.querySelectorAll('.bc-malabel')].map(node => [node.textContent, [...node.classList].find(cls => cls.startsWith('bc-malabel-')).slice('bc-malabel-'.length)]));
  const hit = (a, b) => a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.y0 < b.y1 - 0.5 && a.y1 > b.y0 + 0.5;
  return chartBoxes(el).labels.flatMap(label => leaderSegments(el).filter(s => s.key !== names.get(label.name) && hit(s, label)).map(s => `${s.key} leader × ${label.name}`));
};

describe('brief price chart', () => {
  it('draws the period, buy zone, contraction boxes, pivot, stop and current-price tags with a summary label', () => {
    const el = container();
    renderPriceChart(el, model, { period: 130, animate: false });
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toMatch(/TEST の日足チャート.*ピボット 108\.00.*損切りの目安 100\.40.*値幅の収縮 12%→6%/);
    expect(el.querySelectorAll('.bc-legbox')).toHaveLength(2);
    expect(el.querySelectorAll('rect.bc-up, rect.bc-down').length).toBe(130);
    expect(el.querySelectorAll('.bc-up, .bc-down').length).toBe(130 * 2);
    expect(el.querySelector('.bc-zonefill')).not.toBeNull();
    const last = bars.at(-1).close.toFixed(2);
    expect(texts(el, '.bc-tagtext').sort()).toEqual([last, '108.00', '100.40'].sort());
    expect(el.querySelector('[data-tag="last"] .bc-tagtext').textContent).toBe(last);
    // The RS line's new high is a tag in the axis column.
    expect(el.querySelector('.bc-rstext')?.textContent).toBe('RS新高値');
    expect(Number(el.querySelector('.bc-rshigh rect').getAttribute('x'))).toBeGreaterThanOrEqual(600 - 66 - 2);
    // The readout above the chart replaced the tooltip.
    expect(el.querySelector('.bc-tip')).toBeNull();
    expect(texts(el, '.bc-levelnote')).toEqual(expect.arrayContaining(['ピボット', '損切り −7.0%']));
    expect(collisions(el)).toEqual([]);
    expect(texts(el, '.bc-zonetext')).toEqual(['買いゾーン 〜113.40']);
  });

  it('moves the stop line, its tag and its label when the plan changes and clips a contraction that began before the period', () => {
    const el = container();
    const chart = renderPriceChart(el, model, { period: 40, animate: false });
    expect(el.querySelectorAll('.bc-legbox')).toHaveLength(1);
    expect(Number(el.querySelector('.bc-legbox').getAttribute('x'))).toBe(0);
    expect(renderPriceChart(container(), model, { period: 20, animate: false }) && document.body.lastChild.querySelectorAll('.bc-legbox')).toHaveLength(0);
    const before = Number(el.querySelector('.bc-stop').getAttribute('y1'));
    chart.moveStop(104, false);
    expect(el.querySelector('[data-tag="stop"] .bc-tagtext').textContent).toBe('104.00');
    expect(el.querySelector('.bc-stop-text').textContent).toBe('損切り −3.7%');
    expect(Number(el.querySelector('.bc-stop').getAttribute('y1'))).toBeLessThan(before);
  });

  it('stacks price tags closer than 20px with leader lines and drops none', () => {
    const close = bars.at(-1).close, el = container();
    renderPriceChart(el, { ...model, pivot: close * 1.002, upper: close * 1.05, stop: close * 0.998 }, { period: 130, animate: false });
    const centres = ['pivot', 'last', 'stop'].map(key => tagCentre(el, key)).sort((a, b) => a - b);
    expect(centres).toHaveLength(3);
    for (let i = 1; i < centres.length; i++) expect(centres[i] - centres[i - 1]).toBeGreaterThanOrEqual(20);
    expect([...el.querySelectorAll('.bc-leader')].some(line => !line.hasAttribute('visibility'))).toBe(true);
    const items = spread([{ y: 50 }, { y: 52 }, { y: 54 }, { y: 400 }], 20, 10, 410);
    expect(items.map(item => item.at)).toEqual([50, 70, 90, 400]);
    expect(spread([{ y: 405 }, { y: 406 }], 20, 10, 410).map(item => item.at)).toEqual([390, 410]);
  });

  /** Each contraction's depth as drawn (under its box, or in a combined 「T2 −7%」), by its index. */
  const drawnDepths = el => Object.fromEntries([...el.querySelectorAll('.bc-leg')].map(node => {
    const k = node.dataset.leg, label = el.querySelector(`.bc-legtext[data-i="${k}"]`) || el.querySelector(`.bc-tlabel[data-leg="${k}"] .bc-tdepth`);
    return [k, label?.textContent ?? null];
  }));

  it('shows every contraction\'s T number and depth, combined above a box too narrow for the depth under it', () => {
    const narrow = Array.from({ length: 6 }, (_, k) => ({ startDate: day(276 + k * 3), endDate: day(277 + k * 3), high: 112, low: 110, depthPct: 6 - k * 0.5 }));
    const el = container();
    renderPriceChart(el, { ...model, legs: narrow }, { period: 130, animate: false });
    const labels = [...el.querySelectorAll('.bc-tlabel')].map(node => node.textContent);
    expect(labels).toHaveLength(6);
    for (const [k, leg] of narrow.entries()) expect(labels).toContain(`T${k + 1} −${Math.round(leg.depthPct)}%`);
    expect(collisions(el)).toEqual([]);
  });

  it('keeps every depth with 4 contractions at 390 on 6か月 and 1年 (none is dropped), each with its T number', () => {
    const four = [[150, 175, 108, 85, 21], [190, 215, 108, 95, 12], [230, 250, 108, 101, 6.5], [262, 290, 108, 104.5, 3.2]]
      .map(([a, b, high, low, depthPct]) => ({ startDate: day(a), endDate: day(b), high, low, depthPct }));
    for (const period of [130, 250]) {
      const el = container(332, 340);
      renderPriceChart(el, { ...model, legs: four }, { period, animate: false });
      expect({ period, depths: drawnDepths(el) }).toEqual({ period, depths: { 0: expect.stringMatching(/(^|T1 )−21%$/), 1: expect.stringMatching(/(^|T2 )−12%$/), 2: expect.stringMatching(/(^|T3 )−7%$/), 3: expect.stringMatching(/(^|T4 )−3%$/) } });
      expect([...el.querySelectorAll('.bc-tlabel')].map(node => Number(node.dataset.leg)).sort()).toEqual([0, 1, 2, 3]);
      expect(collisions(el)).toEqual([]);
    }
  });

  it('draws the plan lines and the 52-week high only inside the y-range, never widening it', () => {
    const inside = container(), outside = container();
    renderPriceChart(inside, { ...model, r2: 111, r3: 112, entry: 109, auditHigh: 112.5 }, { period: 130, animate: false });
    renderPriceChart(outside, { ...model, r2: 160, r3: 190, auditHigh: 300 }, { period: 130, animate: false });
    // Every level line is drawn with its name (never an unnamed dotted line): the 52-week high takes its spot first;
    // a plan level with no free spot here (3R, crowded under the zone's top) is left out with its line.
    const drawn = cls => inside.querySelectorAll(`line.${cls}`).length, named = cls => inside.querySelectorAll(`.${cls}-text`).length;
    for (const cls of ['bc-r2', 'bc-r3', 'bc-entry', 'bc-high52']) expect({ cls, lines: drawn(cls) }).toEqual({ cls, lines: named(cls) });
    expect(texts(inside, '.bc-high52-text')).toEqual([expect.stringMatching(/^52週高値 112\.50（[−+±]\d+\.\d%）$/)]);
    expect(texts(inside, '.bc-levelnote')).toEqual(expect.arrayContaining(['2R 111.00', '買値 109.00']));
    expect(drawn('bc-r2') + drawn('bc-r3') + drawn('bc-entry') + drawn('bc-high52')).toBeGreaterThanOrEqual(3);
    expect(collisions(inside)).toEqual([]);
    expect(outside.querySelectorAll('.bc-r2, .bc-r3, .bc-high52')).toHaveLength(0);
    expect(texts(outside, '.bc-axis:not(.bc-date):not(.bc-volmax):not(.bc-volavg)')).toEqual(texts(inside, '.bc-axis:not(.bc-date):not(.bc-volmax):not(.bc-volavg)'));
  });

  it('without a pivot draws no zone and no pivot line and says so; unmeasured contractions are said too', () => {
    const el = container();
    renderPriceChart(el, { ...model, pivot: null, upper: null, legs: [], legsValid: false }, { period: 130, animate: false });
    expect(el.querySelector('.bc-zonefill')).toBeNull();
    expect(el.querySelector('.bc-pivot')).toBeNull();
    expect(texts(el, '.bc-notice')).toEqual(['ピボット 未確認', '収縮は未確認']);
    expect(el.getAttribute('aria-label')).toContain('ピボット 未確認');
  });

  it('keeps averages after a missing value and draws a flat range without hanging', () => {
    const gappy = bars.map((b, i) => (i === 20 ? { ...b, volume: undefined } : b));
    const el = container();
    renderPriceChart(el, { ...model, bars: gappy }, { period: 130, animate: false });
    expect(el.querySelector('.bc-ma50').getAttribute('d')).not.toContain('NaN');
    expect(el.querySelector('.bc-vavg').getAttribute('d')).not.toContain('NaN');
    const flat = bars.map(b => ({ ...b, open: 10, high: 10, low: 10, close: 10 }));
    const plain = container();
    renderPriceChart(plain, { ...model, bars: flat, pivot: null, upper: null, stop: null, legs: [] }, { period: 60, animate: false });
    expect(plain.querySelectorAll('.bc-up, .bc-down').length).toBe(120);
  });

  it('marks sell-signal days inside the period and names them in the label', () => {
    const el = container();
    const inside = bars.at(-3).date, outside = bars[0].date;
    renderPriceChart(el, { ...model, sellMarks: [{ date: outside, kind: 'strength' }, { date: inside, kind: 'weakness' }] }, { period: 60, animate: false });
    expect(el.querySelectorAll('.bc-sell')).toHaveLength(1);
    expect(el.querySelector('.bc-sell-weak')).not.toBeNull();
    expect(el.getAttribute('aria-label')).toContain(`売りのサインの日 ${inside}`);
  });

  it('classes every volume bar up, down or neutral and draws heavy bars across the whole range', () => {
    const all = container();
    renderPriceChart(all, model, { period: 300, animate: false });
    const volume = [...all.querySelectorAll('rect.bc-vol')];
    expect(volume).toHaveLength(300);
    expect(volume.every(bar => ['bc-vol-up', 'bc-vol-down', 'bc-vol-flat'].some(cls => bar.classList.contains(cls)))).toBe(true);
    // Only the first bar of the data has no previous close.
    expect(volume.filter(bar => bar.classList.contains('bc-vol-flat')).map(bar => bar.dataset.date)).toEqual([bars[0].date]);
    // The first bar of a shorter range is classed against the bar before it.
    const shorter = container();
    renderPriceChart(shorter, model, { period: 60, animate: false });
    expect(shorter.querySelectorAll('.bc-vol-flat')).toHaveLength(0);
    const early = bars.map((b, i) => (i === bars.length - 40 ? { ...b, volume: 5000 } : b));
    const el = container();
    renderPriceChart(el, { ...model, bars: early }, { period: 60, animate: false });
    expect([...el.querySelectorAll('.bc-volhi')].map(bar => bar.dataset.date)).toEqual([bars.at(-40).date]);
    expect(el.querySelectorAll('.bc-voldot')).toHaveLength(1);
  });

  it('draws heavy volume on a lower close in the warning colour', () => {
    const heavyDown = bars.map((b, i) => (i === bars.length - 1 ? { ...b, close: bars[i - 1].close - 2, volume: 5000 } : b));
    const el = container();
    renderPriceChart(el, { ...model, bars: heavyDown }, { period: 60, animate: false });
    expect(el.querySelectorAll('.bc-volhi-down')).toHaveLength(1);
    const up = container();
    renderPriceChart(up, { ...model, bars: bars.map((b, i) => (i === bars.length - 1 ? { ...b, volume: 5000 } : b)) }, { period: 60, animate: false });
    expect(up.querySelectorAll('.bc-volhi-down')).toHaveLength(0);
    expect(up.querySelectorAll('.bc-volhi')).toHaveLength(1);
  });

  it('shows the volume axis maximum and the latest average, or 平均 — when the window is short', () => {
    const el = container();
    renderPriceChart(el, model, { period: 130, animate: false });
    expect(texts(el, '.bc-volmax')).toEqual(['1.6K']);
    expect(texts(el, '.bc-volavg')[0]).toMatch(/^平均 1\.\dK$/);
    const short = container();
    renderPriceChart(short, { ...model, bars: bars.slice(0, 30) }, { period: 130, animate: false });
    expect(texts(short, '.bc-volavg')).toEqual(['平均 —']);
    expect(texts(el, '.bc-volcaption')[0]).toContain('1.4×以上（独自判定）');
  });

  it('builds Monday-based weeks, draws a weekly chart with week averages and says when two years are not there', async () => {
    const days = ['2026-09-21', '2026-09-22', '2026-09-25', '2026-09-28', '2026-10-02'].map((date, i) => ({ date, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i, volume: 100 }));
    const weeks = weeklyBars(days);
    expect(weeks).toEqual([
      { start: '2026-09-21', date: '2026-09-25', open: 10, high: 14, low: 9, close: 13, volume: 300 },
      { start: '2026-09-28', date: '2026-10-02', open: 13, high: 16, low: 12, close: 15, volume: 200 },
    ]);
    expect(weeklyBars([...days.slice(0, 2), { ...days[2], volume: null }])).toEqual([]);
    expect(weeklyBars(days.slice(1)).map(w => w.start)).toEqual(['2026-09-28']);
    const el = container();
    renderPriceChart(el, { ...model, interval: 'week' }, { period: 104, animate: false });
    const count = weeklyBars(bars).length;
    expect(el.getAttribute('aria-label')).toContain('週足チャート');
    expect(el.querySelectorAll('.bc-up, .bc-down').length).toBe(count * 2);
    expect(el.textContent).toContain('出来高・10週平均');
    // The month is written as on the date axis (YYYY/MM).
    expect(texts(el, '.bc-notice').slice(0, 2)).toEqual([`週足は直近${count}週分（${weeklyBars(bars)[0].start.slice(0, 7).replace('-', '/')}〜）。`, '2年分はありません']);
  });

  it('ticks month starts and writes the year at the left edge and where it changes', () => {
    const span = Array.from({ length: 200 }, (_, i) => ({ date: day(i + 250) }));
    const phone = dateTicks(span, 262), desk = dateTicks(span, 860);
    expect(phone.length).toBeGreaterThanOrEqual(3);
    expect(phone.length).toBeLessThanOrEqual(4);
    expect(desk.length).toBeGreaterThanOrEqual(6);
    expect(desk.length).toBeLessThanOrEqual(12);
    expect(desk[0].label).toMatch(/^\d{4}\/\d{2}$/);
    expect(desk.find(tick => tick.month === '2027-01').label).toBe('2027/01');
    expect(desk.filter(tick => !tick.mid && tick.month !== '2027-01').slice(1).every(tick => /^\d+月$/.test(tick.label))).toBe(true);
    // A short span gets mid-month ticks on a desktop.
    expect(dateTicks(span.slice(-65), 860).some(tick => tick.mid)).toBe(true);
    const el = container(1000, 470);
    renderPriceChart(el, { ...model, bars: span.map((b, i) => ({ ...bars[i], date: b.date })) }, { period: 250, animate: false });
    expect(texts(el, '.bc-date-year')).toContain('2027/01');
  });

  it('underlines the RS lead days as merged runs, draws the 252-point maximum only in range and names a missing RS line with its reason', () => {
    const el = container();
    const dates = [...bars.slice(-3).map(b => b.date), bars.at(-10).date, bars.at(-30).date, bars.at(-31).date];
    renderPriceChart(el, { ...model, rsLead: { dates: [...dates, '1999-01-01'], threshold: 120 } }, { period: 130, animate: false });
    // One 2px underline per run of consecutive lead days: the last 3, the 10th from last, the 30th and 31st.
    const runs = [...el.querySelectorAll('.bc-rslead')].map(node => [node.dataset.from, node.dataset.to]);
    expect(runs).toEqual([[bars.at(-31).date, bars.at(-30).date], [bars.at(-10).date, bars.at(-10).date], [bars.at(-3).date, bars.at(-1).date]]);
    for (const node of el.querySelectorAll('.bc-rslead')) expect(Number(node.getAttribute('x2')) - Number(node.getAttribute('x1'))).toBeGreaterThanOrEqual(3);
    expect(indexRuns([5, 3, 4, 9, 4, 11, 10])).toEqual([[3, 5], [9, 11]]);
    expect(el.querySelector('.bc-rsmax')).not.toBeNull();
    // The panel's caption is 「RS線」; the legend says what it is. The accessible name keeps the three apart.
    expect(el.querySelector('.bc-rscaption').textContent).toBe(RS_CAPTION);
    expect(el.getAttribute('aria-label')).toContain('RS線（株価÷S&P 500。RS推計やIBD RSとは別）を表示');
    const narrow = container(280, 340);
    renderPriceChart(narrow, model, { period: 130, animate: false });
    expect(narrow.querySelector('.bc-rscaption').textContent).toBe('RS線');
    const high = container();
    renderPriceChart(high, { ...model, rsLead: { dates: [], threshold: 999 } }, { period: 130, animate: false });
    expect(high.querySelector('.bc-rsmax')).toBeNull();
    const empty = container();
    renderPriceChart(empty, { ...model, rsLine: [{ time: bars.at(-1).date, value: 1 }], rsReason: '最終日足が分析日と不一致', rsNewHigh: false }, { period: 130, animate: false });
    expect(empty.querySelector('.bc-rscaption').textContent).toBe('RS線 未配信（最終日足が分析日と不一致）');
    expect(empty.getAttribute('aria-label')).toContain('RS線 未配信（最終日足が分析日と不一致）');
    const noReason = container();
    renderPriceChart(noReason, { ...model, rsLine: [] }, { period: 130, animate: false });
    expect(noReason.querySelector('.bc-rscaption').textContent).toBe('RS線 未配信');
  });

  it('writes the earnings call on the date axis within 28 days: あと, 当日, 経過, with the tone of the call', () => {
    // The chart reads the screen's earnings call (days from today's New York date), never the row's own count.
    const asOf = '2026-10-02', view = date => ({ asOf, earnings: { date, days: Math.round((Date.parse(date) - Date.parse(asOf)) / 86400000) } });
    const at = day => Date.parse(`${day}T16:00:00Z`);
    const upcoming = earningsCall(view('2026-10-10'), at('2026-10-03')), onDay = earningsCall(view('2026-10-10'), at('2026-10-10')), after = earningsCall(view('2026-10-10'), at('2026-10-12'));
    expect([upcoming.days, onDay.days, after.days]).toEqual([7, 0, -2]);
    const cases = [[upcoming, '決算 10/10 あと7日', true], [onDay, '決算 10/10 当日', true], [after, '決算 10/10 経過', false],
      [{ date: '2026-11-12', days: 20, soon: false }, '決算 11/12 あと20日', false]];
    for (const [call, text, warn] of cases) {
      expect(earningsMarker(call)).toMatchObject({ text, warn });
      expect(call.soon === true && call.days >= 0).toBe(warn);
      const el = container();
      renderPriceChart(el, { ...model, earnings: call }, { period: 130, animate: false });
      expect(texts(el, '.bc-earnings')).toEqual([text]);
      expect(el.querySelectorAll('.bc-earnings-soon')).toHaveLength(warn ? 1 : 0);
      expect(el.getAttribute('aria-label')).toContain(`。${text}。`);
    }
    // 経過 never says あと; the tone comes from the call's soon (EARNINGS_WARN_DAYS), not a separate 10-day test.
    expect(earningsMarker(after).text).not.toContain('あと');
    expect(earningsMarker({ date: '2026-10-15', days: EARNINGS_WARN_DAYS + 3, soon: true })).toMatchObject({ warn: true });
    expect(earningsMarker({ date: '2026-10-08', days: 6, soon: false })).toMatchObject({ warn: false });
    // Outside the window, or without a call: nothing.
    expect(earningsMarker({ date: '2026-12-12', days: EARNINGS_MARKER_DAYS + 1, soon: false })).toBeNull();
    expect(earningsMarker(null)).toBeNull();
    const none = container(), far = container();
    renderPriceChart(none, { ...model, earnings: null }, { period: 130, animate: false });
    renderPriceChart(far, { ...model, earnings: { date: '2026-12-12', days: 40, soon: false } }, { period: 130, animate: false });
    expect(none.querySelector('.bc-earnings')).toBeNull();
    expect(far.querySelector('.bc-earnings')).toBeNull();
    const near = container();
    renderPriceChart(near, { ...model, earnings: { date: '2026-11-12', days: 20, soon: false } }, { period: 130, animate: false });
    const gaps = container();
    renderPriceChart(gaps, { ...model, gaps: [{ date: bars.at(-5).date, direction: 'up' }, { date: bars[0].date, direction: 'down' }] }, { period: 130, animate: false });
    expect([...gaps.querySelectorAll('.bc-gap')].map(node => node.dataset.date)).toEqual([bars.at(-5).date]);
    expect(near.querySelector('.bc-gap')).toBeNull();
  });

  it('keeps every SVG text at 12px or more and the viewBox as wide as the chart', () => {
    for (const [width, interval] of [[320, 'day'], [600, 'week'], [1000, 'day']]) {
      const el = container(width, 340);
      renderPriceChart(el, { ...model, interval, earnings: { date: '2026-11-12', days: 8 }, gaps: [{ date: bars.at(-5).date, direction: 'up' }], auditHigh: 110, r2: 111 }, { period: 130, animate: false });
      const sizes = [...el.querySelectorAll('[font-size]')].map(node => Number(node.getAttribute('font-size')));
      expect(sizes.length).toBeGreaterThan(10);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
      for (const svg of el.querySelectorAll('svg')) expect(svg.getAttribute('viewBox')).toBe(`0 0 ${width} 340`);
    }
  });

  it('reports the bar a touch selects, keeps it, restores it when the page scrolls instead and emphasises a contraction', () => {
    const el = container(), onScrub = vi.fn();
    const chart = renderPriceChart(el, model, { period: 130, animate: false, onScrub });
    const front = el.children[2];
    front.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 420 });
    const hit = el.querySelector('.bc-hit');
    hit.dispatchEvent(new MouseEvent('pointerdown', { clientX: 1, bubbles: true }));
    expect(onScrub).toHaveBeenLastCalledWith(170);
    expect(el.querySelector('.bc-scrub').getAttribute('opacity')).toBe('1');
    hit.dispatchEvent(new MouseEvent('pointerup', { clientX: 1, bubbles: true }));
    expect(el.querySelector('.bc-scrub').getAttribute('opacity')).toBe('1');
    hit.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, bubbles: true }));
    hit.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    expect(onScrub).toHaveBeenLastCalledWith(170);
    hit.dispatchEvent(new MouseEvent('pointerdown', { clientX: 599, bubbles: true }));
    expect(onScrub).toHaveBeenLastCalledWith(null);
    expect(el.querySelector('.bc-scrub').getAttribute('opacity')).toBe('0');
    chart.select(200);
    expect(el.querySelector('.bc-scrub').getAttribute('opacity')).toBe('1');
    chart.select(null);
    expect(el.querySelector('.bc-scrub').getAttribute('opacity')).toBe('0');
    expect(chart.highlightLeg(1)).toBe(true);
    expect(el.querySelector('.bc-leg[data-leg="1"]').classList.contains('is-on')).toBe(true);
    expect(el.querySelector('.bc-leg[data-leg="0"]').classList.contains('is-dim')).toBe(true);
    chart.highlightLeg(null);
    expect(el.querySelectorAll('.bc-leg.is-on, .bc-leg.is-dim')).toHaveLength(0);
  });

  it('says so instead of drawing when there are no bars', () => {
    const el = container();
    expect(renderPriceChart(el, { ...model, bars: [] }, { animate: false })).toBeNull();
    expect(el.textContent).toContain('日足データが不足しています');
  });

  it('keeps the names of the averages off the newest candles, joined to their lines by a leader when moved', () => {
    // A tight, flat finish: every average ends inside the last candles' range.
    const flat = bars.map((b, i) => (i > 200 ? { ...b, open: 90, high: 91.5, low: 88.5, close: 90 } : b));
    for (const width of [390, 1000]) {
      const el = container(width, 340);
      renderPriceChart(el, { ...model, bars: flat, pivot: 92, upper: 96.6, stop: 85, legs: [] }, { period: 130, animate: false });
      const bodies = [...el.querySelectorAll('rect.bc-up, rect.bc-down')].slice(-5).map(r => ({ x0: Number(r.getAttribute('x')), x1: Number(r.getAttribute('x')) + Number(r.getAttribute('width')), y0: Number(r.getAttribute('y')), y1: Number(r.getAttribute('y')) + Number(r.getAttribute('height')) }));
      const labels = [...el.querySelectorAll('.bc-malabel')];
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        const right = Number(label.getAttribute('x')), base = Number(label.getAttribute('y')), w = label.textContent.length * 7.2;
        const covered = bodies.filter(body => right > body.x0 && right - w < body.x1 && base + 2 > body.y0 && base - 10 < body.y1);
        expect({ label: label.textContent, width, covered }).toEqual({ label: label.textContent, width, covered: [] });
      }
      expect(el.querySelectorAll('.bc-maleader').length).toBeGreaterThan(0);
    }
  });

  it('writes 出来高の枯渇 beside the caption when there is room, else clear of the caption and the bars', () => {
    const el = container(600, 420);
    renderPriceChart(el, { ...model, dryUpLeg: model.legs[1] }, { period: 130, animate: false });
    const note = el.querySelector('.bc-notetext'), caption = el.querySelector('.bc-volcaption');
    expect(note.textContent).toBe('出来高の枯渇');
    expect(Number(note.getAttribute('y'))).toBe(Number(caption.getAttribute('y')));
    expect(Number(note.getAttribute('x'))).toBeGreaterThan(4 + 12 * 14);
    expect(caption.querySelector('.bc-volkey').textContent).toBe('●');
    // A phone has no room beside the caption: the name takes a spot clear of the caption and of every bar.
    for (const period of [130, 250]) {
      const phone = container(390, 340);
      renderPriceChart(phone, { ...model, dryUpLeg: model.legs[1] }, { period, animate: false });
      const under = phone.querySelector('.bc-notetext'), x0 = Number(under.getAttribute('x')), yc = Number(under.getAttribute('y')) - 4;
      expect(Math.abs(yc - (Number(phone.querySelector('.bc-volcaption').getAttribute('y')) - 4))).toBeGreaterThanOrEqual(14);
      const over = [...phone.querySelectorAll('rect.bc-vol')].filter(bar => { const bx = Number(bar.getAttribute('x')), by = Number(bar.getAttribute('y')); return bx < x0 + 72 && bx + Number(bar.getAttribute('width')) > x0 && by < yc + 6 && by + Number(bar.getAttribute('height')) > yc - 6; });
      expect({ period, over: over.length, forced: under.dataset.forced }).toEqual({ period, over: 0, forced: undefined });
    }
  });

  it('names the 52-week high at the first candle-free spot from the left along its line, the pivot\'s name moving out of its way', () => {
    // A rising chart: the 52-week high runs far above the period's first candles, with the pivot just under it.
    for (const [width, interval, period] of [[332, 'day', 130], [332, 'week', 104], [1000, 'day', 130]]) {
      const el = container(width, 340);
      renderPriceChart(el, { ...model, interval, auditHigh: 110.5, pivot: 109.2, upper: 114.7 }, { period, animate: false });
      const high = el.querySelector('.bc-high52-text'), line = Number(el.querySelector('line.bc-high52').getAttribute('y1'));
      const what = `${width} ${interval}`;
      expect({ what, x: Number(high.getAttribute('x')), forced: high.dataset.forced }).toEqual({ what, x: 4, forced: undefined });
      expect([9, 11]).toContain(Math.round(Math.abs(Number(high.getAttribute('y')) - 4 - line)));
      expect(el.querySelector('.bc-pivot-text')).not.toBeNull();
      expect({ what, collisions: collisions(el) }).toEqual({ what, collisions: [] });
    }
  });

  it('ends the averages\' names 7px left of the axis (or up to MA_SHIFT further left), clear of the tags and their leaders', () => {
    const el = container(332, 340);
    renderPriceChart(el, busy(1), { period: 130, animate: false });
    const pw = 332 - 68, names = [...el.querySelectorAll('.bc-malabel')];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(Number(name.getAttribute('x'))).toBeLessThanOrEqual(pw - 7);
      expect(Number(name.getAttribute('x'))).toBeGreaterThanOrEqual(pw - 7 - MA_SHIFT - 1);
    }
    expect(collisions(el)).toEqual([]);
  });

  it('moves an average\'s name left or further up or down (with its leader) before putting it over the newest candles', () => {
    // A flat finish the averages end in, and the last four bars spanning far above and below it: no candle-free
    // height is left at the name's usual place, but there is one a few bars to the left.
    const flat = bars.map((b, i) => (i > 200 ? { ...b, open: 90, high: 91.5, low: 88.5, close: 90 } : b));
    const tall = flat.map((b, i) => (i >= bars.length - 4 ? { ...b, high: 112, low: 70 } : b));
    for (const width of [390, 1000]) {
      const el = container(width, 340);
      renderPriceChart(el, { ...model, bars: tall, pivot: 92, upper: 96.6, stop: 85, legs: [] }, { period: 130, animate: false });
      const pw = width - 68, names = [...el.querySelectorAll('.bc-malabel')];
      const lines = [...el.querySelectorAll('path.bc-ma')].filter(path => !path.classList.contains('bc-mashort'));
      expect({ width, names: names.length }).toEqual({ width, names: lines.length });
      // A candle's box as the renderer keeps names off it: its body's width and 2px more each side, its whole range.
      const bodies = [...el.querySelectorAll('rect.bc-up, rect.bc-down')];
      const candles = [...el.querySelectorAll('line.bc-up, line.bc-down')].map((line, i) => ({ x: Number(line.getAttribute('x1')), reach: Number(bodies[i].getAttribute('width')) / 2 + 2, y0: Number(line.getAttribute('y1')), y1: Number(line.getAttribute('y2')) }));
      for (const name of names) {
        const right = Number(name.getAttribute('x')), yc = Number(name.getAttribute('y')) - 4, w = _test.width(name.textContent, true);
        const under = candles.filter(c => c.x + c.reach > right - w + 0.05 && c.x - c.reach < right - 0.05 && c.y0 < yc + 6.5 && c.y1 > yc - 6.5);
        expect({ width, name: name.textContent, forced: name.dataset.forced, under: under.length }).toEqual({ width, name: name.textContent, forced: undefined, under: 0 });
        expect(right).toBeGreaterThanOrEqual(pw - 7 - MA_SHIFT - 1);
      }
      // A name moved left and off its line's height is joined to the line's end by an elbow leader.
      expect([...el.querySelectorAll('.bc-maleader')].some(leader => /H/.test(leader.getAttribute('d')))).toBe(true);
      expect(collisions(el)).toEqual([]);
    }
  });

  it('marks a label it had to put over candles (data-forced, with the spots it tried) and no other', () => {
    // Every bar spans the whole range: no candle-free spot is left in the plot.
    const wall = bars.map(b => ({ ...b, open: 90, close: 91, high: 125, low: 60 }));
    const el = container(332, 340);
    renderPriceChart(el, { ...model, bars: wall, pivot: 100, upper: 110, stop: 93, legs: [] }, { period: 130, animate: false });
    const wide = container(1000, 420);
    renderPriceChart(wide, { ...model, bars: wall, pivot: 100, upper: 110, stop: 93, legs: [] }, { period: 130, animate: false });
    const forced = [...el.querySelectorAll('[data-forced="1"]'), ...wide.querySelectorAll('[data-forced="1"]')];
    expect(forced.map(node => node.textContent)).toEqual(expect.arrayContaining(['ピボット', '買いゾーン 〜110.00', '50']));
    // A narrow chart keeps the zone's upper price too: 「買いゾーン 〜110.00」 over the fewest of the wall's candles.
    expect(el.querySelector('.bc-zonetext').textContent).toBe('買いゾーン 〜110.00');
    expect(el.querySelector('.bc-zonetext').dataset.forced).toBe('1');
    for (const node of forced) {
      expect(node.dataset.search).toMatch(/^\d+\.\d \d+\.\d \d+\|\d+\.\d( \d+\.\d)*$/);
      expect(node.dataset.box.split(' ').map(Number).every(Number.isFinite)).toBe(true);
    }
    const free = container(332, 340);
    renderPriceChart(free, model, { period: 130, animate: false });
    expect(free.querySelector('.bc-zonetext').dataset.forced).toBeUndefined();
    expect(free.querySelector('.bc-zonetext').dataset.search).toBeUndefined();
  });

  it('keeps the volume caption on its own band: the tallest bar and a heavy bar\'s dot start under it', () => {
    const heavy = bars.map((b, i) => (i === bars.length - 4 ? { ...b, volume: 5000 } : b));
    for (const width of [332, 1000]) {
      const el = container(width, 340);
      renderPriceChart(el, { ...model, bars: heavy }, { period: 130, animate: false });
      // The caption's glyphs end 2px under its baseline.
      const bottom = Number(el.querySelector('.bc-volcaption').getAttribute('y')) + 2;
      const tops = [...el.querySelectorAll('rect.bc-vol')].map(bar => Number(bar.getAttribute('y'))), dots = [...el.querySelectorAll('.bc-voldot')].map(dot => Number(dot.getAttribute('cy')) - 1.8);
      expect(dots.length).toBeGreaterThan(0);
      expect(Math.min(...tops, ...dots)).toBeGreaterThan(bottom);
    }
  });

  it('offers the plot corner with the fewest candles for 最新足, never over the selected bar or the notices', () => {
    // A rising chart under a buy zone at its top: the bottom-right corner is empty.
    const el = container(390, 340);
    const chart = renderPriceChart(el, model, { period: 130, animate: false });
    const corner = chart.freeCorner(72, 44);
    expect(corner.x).toBe(390 - 68 - 4 - 72);
    const bodies = [...el.querySelectorAll('rect.bc-up, rect.bc-down')].map(r => ({ x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')), h: Number(r.getAttribute('height')) }));
    expect(bodies.filter(b => b.x > corner.x && b.x < corner.x + 72 && b.y < corner.y + 44 && b.y + b.h > corner.y)).toEqual([]);
    // With a bar selected under that corner, another corner is chosen.
    chart.select(bars.length - 5);
    expect(chart.freeCorner(72, 44)).not.toEqual(corner);
    // The notices take a corner first: 最新足 does not cover them.
    const missing = container(390, 340);
    const other = renderPriceChart(missing, { ...model, pivot: null, upper: null }, { period: 130, animate: false });
    const notice = missing.querySelector('.bc-notice'), spot = other.freeCorner(72, 44);
    expect(Math.abs(spot.x - Number(notice.getAttribute('x'))) > 72 || Math.abs(spot.y - Number(notice.getAttribute('y'))) > 44).toBe(true);
  });

  // Round 2 (CH2–CH7): a phone-width chart (332px wide at 390) with every level, 4–5 digit prices and every mark.
  const scaledBy = k => bars.map(b => ({ ...b, open: b.open * k, high: b.high * k, low: b.low * k, close: b.close * k }));
  const busy = k => ({
    ...model, bars: scaledBy(k), rsLine: model.rsLine, pivot: 108 * k, upper: 113.4 * k, stop: 100.4 * k, entry: 108 * k, r2: 111 * k, r3: 112 * k,
    structuralLow: 104.5 * k, auditHigh: 110 * k, rsNewHigh: true, earnings: { date: '2026-11-12', days: 8, soon: true },
    legs: [[150, 175, 108, 85, 21], [190, 215, 108, 95, 12], [230, 250, 108, 101, 6.5], [262, 290, 108, 104.5, 3.2]].map(([a, b, high, low, depthPct]) => ({ startDate: day(a), endDate: day(b), high: high * k, low: low * k, depthPct })),
    crossing: { date: bars.at(-12).date, volumeRatio: 1.83 },
  });

  it('at 390 with 4–5 digit prices, no label overlaps another label, a tag or the last price', () => {
    for (const k of [1, 50, 100]) for (const [period, interval] of [[65, 'day'], [130, 'day'], [250, 'day'], [104, 'week']]) {
      const el = container(332, 340);
      renderPriceChart(el, { ...busy(k), interval }, { period, animate: false });
      expect({ k, period, interval, collisions: collisions(el) }).toEqual({ k, period, interval, collisions: [] });
      // Every label stays inside the plot, left of the tag column.
      for (const label of chartBoxes(el).labels.filter(box => box.name !== RS_CAPTION)) expect({ name: label.name, inside: label.x1 <= 332 - 68 }).toEqual({ name: label.name, inside: true });
    }
  });

  it('below 520px the last contraction low is a 「安値」 tag and the 52-week high takes its short form; wider, both are labels', () => {
    const phone = container(332, 340), desk = container(1000, 470);
    expect(332).toBeLessThan(NARROW_CHART_WIDTH);
    renderPriceChart(phone, busy(1), { period: 130, animate: false });
    renderPriceChart(desk, busy(1), { period: 130, animate: false });
    expect(phone.querySelector('[data-tag="low"] .bc-tagtext').textContent).toBe('安値');
    expect(phone.querySelector('.bc-structural-text')).toBeNull();
    expect(phone.querySelector('.bc-structural')).not.toBeNull();
    for (const node of phone.querySelectorAll('.bc-high52-text')) expect(node.textContent).toBe('52週高 110.00');
    expect(desk.querySelector('[data-tag="low"]')).toBeNull();
    for (const node of desk.querySelectorAll('.bc-high52-text')) expect(node.textContent).toMatch(/^52週高値 110\.00（[−+±]\d+\.\d%）$/);
    expect(collisions(phone)).toEqual([]);
    expect(collisions(desk)).toEqual([]);
  });

  it('keeps 3 date labels or more at 390 on 3か月, 6か月 and 週足 with an earnings flag in the RS panel axis column', () => {
    for (const [period, interval] of [[65, 'day'], [130, 'day'], [104, 'week']]) {
      const el = container(332, 340);
      renderPriceChart(el, { ...busy(1), interval }, { period, animate: false });
      expect({ interval, period, enough: el.querySelectorAll('.bc-date').length >= 3 }).toEqual({ interval, period, enough: true });
      const flag = el.querySelector('.bc-earnflag');
      expect(flag.querySelector('.bc-earnings').textContent).toBe('E 11/12');
      expect(flag.dataset.full).toBe('決算 11/12 あと8日');
      expect(flag.querySelector('title').textContent).toBe('決算 11/12 あと8日');
      expect(flag.classList.contains('bc-earnings-soon')).toBe(true);
      // The flag sits in the axis column, clear of the RS新高値 tag.
      const rect = flag.querySelector('rect'), tag = el.querySelector('.bc-rshigh rect');
      expect(Number(rect.getAttribute('x'))).toBeGreaterThanOrEqual(332 - 66);
      const [f0, f1, t0, t1] = [Number(rect.getAttribute('y')), Number(rect.getAttribute('y')) + 18, Number(tag.getAttribute('y')), Number(tag.getAttribute('y')) + 20];
      expect(f0 >= t1 || f1 <= t0).toBe(true);
      expect(el.getAttribute('aria-label')).toContain('決算 11/12 あと8日');
    }
  });

  it('marks the pivot crossing it is given under its bar (its week on the weekly chart), with 「上抜け 1.83×」 only when the ratio is known', () => {
    const el = container(1000, 470);
    renderPriceChart(el, busy(1), { period: 130, animate: false });
    const mark = el.querySelector('.bc-breakout');
    expect(mark.dataset.date).toBe(bars.at(-12).date);
    expect(mark.querySelector('.bc-breakoutmark')).not.toBeNull();
    expect(mark.querySelector('.bc-breakouttext').textContent).toBe('上抜け 1.83×');
    expect(el.getAttribute('aria-label')).toContain(`ピボットを上抜けた日 ${bars.at(-12).date}（上抜け 1.83×）`);
    // No ratio (null, never 0): the mark without a label.
    const bare = container(1000, 470);
    renderPriceChart(bare, { ...busy(1), crossing: { date: bars.at(-12).date, volumeRatio: null } }, { period: 130, animate: false });
    expect(bare.querySelector('.bc-breakout')).not.toBeNull();
    expect(bare.querySelector('.bc-breakouttext')).toBeNull();
    // Weekly: on the crossing's week.
    const weekly = container(1000, 470);
    renderPriceChart(weekly, { ...busy(1), interval: 'week' }, { period: 104, animate: false });
    const week = weeklyBars(bars).find(w => w.start <= bars.at(-12).date && bars.at(-12).date <= w.date);
    expect(weekly.querySelector('.bc-breakout').dataset.date).toBe(week.date);
    // No crossing, or one before the shown period: nothing.
    for (const crossing of [null, { date: bars[0].date, volumeRatio: 2 }]) {
      const none = container(1000, 470);
      renderPriceChart(none, { ...busy(1), crossing }, { period: 130, animate: false });
      expect(none.querySelector('.bc-breakout')).toBeNull();
      expect(none.getAttribute('aria-label')).not.toContain('上抜け');
    }
  });

  it('draws the crossing as a hollow arrow, never the filled ▲ of the 崩れ sell sign, green only when confirmed', () => {
    // A crossing and a breakdown on one chart: two shapes, not two colours of one shape.
    const both = container(1000, 470);
    renderPriceChart(both, { ...busy(1), crossing: { date: bars.at(-12).date, volumeRatio: 1.83, tone: 'zone' }, sellMarks: [{ date: bars.at(-5).date, kind: 'weakness' }] }, { period: 130, animate: false });
    const arrow = both.querySelector('.bc-breakoutmark'), sell = both.querySelector('.bc-sell-weak');
    expect(arrow).not.toBeNull();
    expect(sell).not.toBeNull();
    const shape = d => d.replace(/^M[\d.-]+,[\d.-]+/, '');
    expect(shape(arrow.getAttribute('d'))).not.toBe(shape(sell.getAttribute('d')));
    expect(shape(arrow.getAttribute('d'))).toBe('l4.5,5h-2.75v5h-3.5v-5h-2.75z');
    expect(shape(sell.getAttribute('d'))).toBe('h10l-5,-8z');
    // The arrow is drawn hollow (its class), the sell sign filled (bc-sell): different classes, different fills.
    expect(arrow.getAttribute('class')).toBe('bc-breakoutmark');
    expect(sell.getAttribute('class')).toContain('bc-sell');
    expect(both.querySelector('.bc-breakout').classList.contains('is-zone')).toBe(true);
    expect(both.querySelector('.bc-breakout').dataset.tone).toBe('zone');
    // Unconfirmed (no tone, or neutral): grey.
    for (const tone of [undefined, 'neutral']) {
      const grey = container(1000, 470);
      renderPriceChart(grey, { ...busy(1), crossing: { date: bars.at(-12).date, volumeRatio: null, tone } }, { period: 130, animate: false });
      expect(grey.querySelector('.bc-breakout').classList.contains('is-zone')).toBe(false);
      expect(grey.querySelector('.bc-breakout').dataset.tone).toBe('neutral');
    }
    // On the same bar as a 崩れ mark, the arrow goes below it.
    const same = container(1000, 470);
    renderPriceChart(same, { ...busy(1), crossing: { date: bars.at(-12).date, volumeRatio: null }, sellMarks: [{ date: bars.at(-12).date, kind: 'weakness' }] }, { period: 130, animate: false });
    const tip = Number(same.querySelector('.bc-breakoutmark').getAttribute('d').match(/^M[\d.-]+,([\d.-]+)/)[1]);
    const base = Number(same.querySelector('.bc-sell-weak').getAttribute('d').match(/^M[\d.-]+,([\d.-]+)/)[1]);
    expect(tip).toBeGreaterThanOrEqual(base);
  });

  it('dims a passed report\'s flag on a narrow chart, so it never reads as a coming date', () => {
    const coming = container(332, 340), passed = container(332, 340);
    renderPriceChart(coming, { ...model, earnings: { date: '2026-11-12', days: 8, soon: false } }, { period: 130, animate: false });
    renderPriceChart(passed, { ...model, earnings: { date: '2026-11-02', days: -2, soon: true } }, { period: 130, animate: false });
    expect(coming.querySelector('.bc-earnflag').classList.contains('is-past')).toBe(false);
    expect(passed.querySelector('.bc-earnflag').classList.contains('is-past')).toBe(true);
    expect(passed.querySelector('.bc-earnflag').classList.contains('bc-earnings-soon')).toBe(false);
    expect(passed.querySelector('.bc-earnflag').dataset.full).toBe('決算 11/2 経過');
  });

  it('puts the zone\'s name on a candle-free spot along its top when one exists', () => {
    const el = container(1000, 470);
    renderPriceChart(el, busy(1), { period: 130, animate: false });
    const label = el.querySelector('.bc-zonetext');
    expect(label).not.toBeNull();
    const lx = Number(label.getAttribute('x')), yc = Number(label.getAttribute('y')) - 4, w = _test.width(label.textContent);
    const candles = [...el.querySelectorAll('line.bc-up, line.bc-down')].map(line => ({ x: Number(line.getAttribute('x1')), y0: Number(line.getAttribute('y1')), y1: Number(line.getAttribute('y2')) }));
    expect(candles.filter(c => c.x > lx - 2 && c.x < lx + w + 2 && c.y0 < yc + 7 && c.y1 > yc - 7)).toEqual([]);
  });

  it('on a narrow chart, names the zone with its upper price wherever a spot is free near the band: candle-free first, else over the fewest candles', () => {
    const pw = 332 - 68;
    // Candles fill the band and the row just above it, but not the rows higher up: 「買いゾーン 〜113.40」 takes one of
    // those, its glyphs ending within ZONE_ABOVE + 3 of the band's top edge.
    const reaching = bars.map((b, i) => (i > 170 ? { ...b, open: 108.5, close: 112.5, high: 114.5, low: 108.2 } : b));
    const near = container(332, 340);
    renderPriceChart(near, { ...model, bars: reaching, legs: [] }, { period: 130, animate: false });
    const full = near.querySelector('.bc-zonetext'), edge = Number(near.querySelector('.bc-zoneedge').getAttribute('y'));
    expect(full.textContent).toBe('買いゾーン 〜113.40');
    expect(full.dataset.forced).toBeUndefined();
    const above = edge - (Number(full.getAttribute('y')) - 4);
    expect(above).toBeGreaterThan(9.5);
    expect(above).toBeLessThanOrEqual(9 + ZONE_ABOVE + 0.5);
    // Candles fill the band and every row up to ZONE_ABOVE above it (but over the last bars, `gap`): no candle-free spot
    // is left for 「買いゾーン 〜113.40」, so it goes over the fewest candles with its halo, its price still shown (the
    // short 「買いゾーン」 only when no spot is free for the full name at all).
    const crowded = bars.map((b, i) => (i > 170 ? { ...b, open: 108.5, close: 112.5, high: 122, low: 108.2 } : b));
    for (const gap of [40, 0]) {
      const holed = crowded.map((b, i) => (i >= bars.length - gap ? { ...b, open: 102, close: 103, high: 103.5, low: 101.5 } : b));
      const el = container(332, 340);
      renderPriceChart(el, { ...model, bars: holed, legs: [] }, { period: 130, animate: false });
      const label = el.querySelector('.bc-zonetext');
      expect({ gap, name: label.textContent, forced: label.dataset.forced }).toEqual({ gap, name: '買いゾーン 〜113.40', forced: '1' });
      const lx = Number(label.getAttribute('x')), w = _test.width(label.textContent);
      expect(lx).toBeGreaterThanOrEqual(4);
      expect(lx + w).toBeLessThanOrEqual(pw);
    }
  });

  it('never puts two labels on one row closer than a phrase\'s gap, two figures closer than FIGURE_GAP, nor the pivot\'s name and the zone\'s closer than three glyphs', () => {
    // 6px and 9px still read as one phrase at 12px text (「ピボット T2」, 「52週高 110.00 3R 112.00」); 14px does not.
    expect(PHRASE_GAP).toBeGreaterThanOrEqual(14);
    for (const [width, period] of [[290, 130], [332, 130], [332, 250], [1000, 130], [1000, 65]]) for (const k of [1, 50]) {
      const el = container(width, 340);
      renderPriceChart(el, busy(k), { period, animate: false });
      const { labels } = chartBoxes(el), row = (a, b) => a.y0 < b.y1 && a.y1 > b.y0, gap = (a, b) => Math.max(a.x0 - b.x1, b.x0 - a.x1);
      const pivot = labels.find(l => l.name === 'ピボット'), zone = labels.find(l => l.name.startsWith('買いゾーン'));
      if (pivot && zone && row(pivot, zone)) expect({ width, period, k, apart: gap(pivot, zone) > 24 }).toEqual({ width, period, k, apart: true });
      const close = labels.flatMap((a, i) => labels.slice(i + 1).filter(b => row(a, b) && gap(a, b) < PHRASE_GAP).map(b => `${a.name} ${b.name} ${gap(a, b).toFixed(1)}`));
      expect({ width, period, k, close }).toEqual({ width, period, k, close: [] });
      // An average's name beside a depth, a T number or another name: two bold figures keep FIGURE_GAP (「150 −4%」).
      const figures = chartBoxes(el, '.bc-malabel, .bc-ttext, .bc-legtext').labels;
      const figure = figures.flatMap((a, i) => figures.slice(i + 1).filter(b => (a.ma || b.ma) && row(a, b) && gap(a, b) < FIGURE_GAP).map(b => `${a.name} ${b.name} ${gap(a, b).toFixed(1)}`));
      expect({ width, period, k, figure }).toEqual({ width, period, k, figure: [] });
      // One above the other, a name and a depth keep FIGURE_STACK (「150／−8%／200」 reads as a column of names).
      const column = figures.flatMap((a, i) => figures.slice(i + 1).filter(b => a.ma !== b.ma && /^−\d+%$/.test(a.ma ? b.name : a.name) && a.x0 < b.x1 && a.x1 > b.x0 && !row(a, b) && Math.max(a.y0 - b.y1, b.y0 - a.y1) < FIGURE_STACK).map(b => `${a.name} ${b.name}`));
      expect({ width, period, k, column }).toEqual({ width, period, k, column: [] });
    }
  });

  it('joins a moved average\'s name to its line by a leader that runs through no other label and meets no other leader', () => {
    // Flat finishes the averages all end in: their names crowd the right edge and move left and up or down.
    const flat = bars.map((b, i) => (i > 200 ? { ...b, open: 90, high: 91.5, low: 88.5, close: 90 } : b));
    const tall = flat.map((b, i) => (i >= bars.length - 4 ? { ...b, high: 112, low: 70 } : b));
    let elbows = 0;
    for (const series of [flat, tall]) for (const width of [290, 332, 390, 1000]) for (const period of [65, 130, 250]) {
      const el = container(width, 340);
      renderPriceChart(el, { ...model, bars: series, pivot: 92, upper: 96.6, stop: 85, legs: [] }, { period, animate: false });
      expect({ width, period, through: leaderThrough(el) }).toEqual({ width, period, through: [] });
      expect({ width, period, meet: leadersMeet(el) }).toEqual({ width, period, meet: [] });
      expect({ width, period, detached: detached(el, width - 68) }).toEqual({ width, period, detached: [] });
      elbows += [...el.querySelectorAll('.bc-maleader')].filter(path => /H/.test(path.getAttribute('d'))).length;
    }
    expect(elbows).toBeGreaterThan(0);
    // The busy charts too, where names share their rows with depths and levels.
    for (const [width, period] of [[290, 130], [332, 130], [332, 250], [1000, 130], [1000, 65]]) for (const k of [1, 50]) {
      const el = container(width, 340);
      renderPriceChart(el, busy(k), { period, animate: false });
      expect({ width, period, k, through: leaderThrough(el) }).toEqual({ width, period, k, through: [] });
      expect({ width, period, k, detached: detached(el, width - 68) }).toEqual({ width, period, k, detached: [] });
    }
  });

  it('hangs the names of two lines ending at one point off one leader, in the order of their ends, rather than over candles', () => {
    // Flat since bar 141: the 50- and 150-day lines end at the same price; the last 8 bars reach far above it, so both
    // names go down the gutter, one leader from the shared end, each in its line's colour.
    const flat = bars.map((b, i) => (i > 140 ? { ...b, open: 90, high: 91.5, low: 88.5, close: 90 } : b));
    const capped = flat.map((b, i) => (i >= bars.length - 8 ? { ...b, high: 112, low: 89.6 } : b));
    for (const width of [332, 390, 1000]) for (const period of [65, 130]) {
      const el = container(width, 340);
      renderPriceChart(el, { ...model, bars: capped, pivot: 92, upper: 96.6, stop: 85, legs: [] }, { period, animate: false });
      const name = key => el.querySelector(`.bc-malabel-${key}`), end = key => el.querySelector(`path.bc-ma.bc-${key}`).getAttribute('d').split(/[ML]/).filter(Boolean).at(-1).split(',').map(Number)[1];
      expect(Math.abs(end('ma50') - end('ma150'))).toBeLessThanOrEqual(1);
      for (const key of ['ma50', 'ma150']) expect({ width, period, key, forced: name(key).dataset.forced }).toEqual({ width, period, key, forced: undefined });
      const parts = leaderSegments(el).filter(part => part.v && (part.key === 'ma50' || part.key === 'ma150'));
      if (parts.length === 2 && parts[0].up === parts[1].up) expect(sharedLeader(parts[0], parts[1])).toBe(true);
      expect({ width, period, meet: leadersMeet(el), through: leaderThrough(el) }).toEqual({ width, period, meet: [], through: [] });
    }
    // The rule: the same way from one point, the names in the order of the ends; either order for ends within 1px.
    expect(sharedLeader({ from: 100, tip: 120, up: false }, { from: 102, tip: 134, up: false })).toBe(true);
    expect(sharedLeader({ from: 100, tip: 134, up: false }, { from: 102, tip: 120, up: false })).toBe(false);
    expect(sharedLeader({ from: 100, tip: 134, up: false }, { from: 100.5, tip: 120, up: false })).toBe(true);
    expect(sharedLeader({ from: 100, tip: 80, up: true }, { from: 102, tip: 120, up: false })).toBe(false);
  });

  it('never names a level on another level\'s line: the structural low with the stop 11px under it sits over its line, on it, or is a 「安値」 tag', () => {
    // The price `dy` px from the structural low's line, on the chart's log scale (that line and the pivot's give it).
    const probe = container(1000, 340);
    renderPriceChart(probe, busy(1), { period: 130, animate: false });
    const ys = Number(probe.querySelector('line.bc-structural').getAttribute('y1')), yp = Number(probe.querySelector('line.bc-pivot').getAttribute('y1'));
    const at = dy => Math.exp(Math.log(104.5) + (Math.log(108) - Math.log(104.5)) * dy / (yp - ys));
    // A calm finish (the newest candles well over its line), the stop 11px under it (its lower row struck): the name goes
    // over its line. With a 52-week high 9px over it too, every row beside it is struck: the name sits on its own line,
    // cut under it (as a label sits on its line here). With the rising finish's candles there too (no candle-free spot
    // by its line), it is the narrow chart's 「安値」 tag (its price in the legend), never a name over them.
    const calm = bars.map((b, i) => (i > 200 ? { ...b, open: 109.5, close: 110, high: 110.5, low: 109 } : b));
    for (const [extra, form] of [[{ stop: at(11), bars: calm }, 'over'], [{ stop: at(11), auditHigh: at(-9), bars: calm }, 'on'], [{ stop: at(11), auditHigh: at(-9) }, 'tag'], [{ stop: at(11) }, 'tag']]) {
      const el = container(1000, 340);
      renderPriceChart(el, { ...busy(1), ...extra }, { period: 130, animate: false });
      const line = el.querySelector('line.bc-structural'), y0 = Number(line.getAttribute('y1')), stop = Number(el.querySelector('line.bc-stop').getAttribute('y1'));
      expect(Math.abs(stop - (y0 + 11))).toBeLessThan(1);
      expect({ form, other: onOtherLevel(el) }).toEqual({ form, other: [] });
      const label = el.querySelector('.bc-structural-text');
      if (form === 'tag') {
        expect(label).toBeNull();
        expect(el.querySelector('[data-tag="low"] .bc-tagtext').textContent).toBe('安値');
        continue;
      }
      const yc = Number(label.getAttribute('y')) - 4;
      expect({ form, forced: label.dataset.forced }).toEqual({ form, forced: undefined });
      expect(Number(label.getAttribute('x'))).toBeGreaterThanOrEqual(Number(line.getAttribute('x1')) - 0.05);
      if (form === 'on') {
        expect(Math.abs(yc - y0)).toBeLessThan(0.5);
        const [x0, x1] = label.dataset.box.split(' ').map(Number), mask = el.querySelector(line.getAttribute('mask').replace(/^url\((.*)\)$/, '$1'));
        expect([...mask.querySelectorAll('rect[fill="#000"]')].some(r => Number(r.getAttribute('x')) <= x0 && Number(r.getAttribute('x')) + Number(r.getAttribute('width')) >= x1 && Number(r.getAttribute('y')) <= y0 && Number(r.getAttribute('y')) + Number(r.getAttribute('height')) >= y0)).toBe(true);
      } else expect(Math.round(y0 - yc)).toBe(9);
    }
    // Nor on the busy charts, at any width.
    for (const [width, period] of [[332, 130], [332, 250], [1000, 65], [1000, 130], [1000, 250]]) for (const k of [1, 50]) {
      const el = container(width, 340);
      renderPriceChart(el, busy(k), { period, animate: false });
      expect({ width, period, k, other: onOtherLevel(el) }).toEqual({ width, period, k, other: [] });
    }
  });

  it('keeps every label but the averages\' names off each average\'s last MA_TAIL px (a depth there reads as the line\'s end)', () => {
    let tails = 0;
    for (const [width, period] of [[290, 130], [332, 130], [332, 250], [390, 130], [1000, 130], [1000, 65]]) for (const k of [1, 50]) {
      const el = container(width, 340);
      renderPriceChart(el, busy(k), { period, animate: false });
      const boxes = [...el.querySelectorAll('[data-box]:not(.bc-malabel)')].map(node => [node.textContent, ...node.dataset.box.split(' ').map(Number)]);
      for (const path of el.querySelectorAll('path.bc-ma')) {
        const points = path.getAttribute('d').split('M').filter(Boolean).at(-1).split('L').map(pair => pair.split(',').map(Number)), last = points.at(-1)[0];
        const tail = points.slice(0, -1).map((p, i) => [p, points[i + 1]]).filter(([, q]) => last - q[0] < MA_TAIL);
        tails += tail.length;
        const on = boxes.filter(([, x0, x1, y0, y1]) => tail.some(([p, q]) => segmentCrosses(p, q, { x0, x1, y0, y1 }))).map(([name]) => name);
        expect({ width, period, k, line: path.getAttribute('class'), on }).toEqual({ width, period, k, line: path.getAttribute('class'), on: [] });
      }
    }
    expect(tails).toBeGreaterThan(0);
  });

  it('keeps a level line out of a contraction label\'s glyphs when a spot clear of it is near', () => {
    // The 52-week high runs exactly where the last contraction's T number would sit (9px above its box).
    const legs = [{ startDate: day(262), endDate: day(290), high: 108, low: 104.5, depthPct: 3.2 }];
    for (const width of [332, 1000]) {
      const probe = container(width, 340);
      renderPriceChart(probe, { ...model, legs }, { period: 130, animate: false });
      const box = probe.querySelector('.bc-legbox'), top = Number(box.getAttribute('y'));
      // The price 9px above the box's top, on the chart's own log scale (the box's top and the stop line give it).
      const line = Number(probe.querySelector('.bc-stopgroup line').getAttribute('y1'));
      const auditHigh = Math.exp(Math.log(108) + (Math.log(model.stop) - Math.log(108)) * -9 / (line - top));
      const el = container(width, 340);
      renderPriceChart(el, { ...model, legs, auditHigh }, { period: 130, animate: false });
      const high = Number(el.querySelector('line.bc-high52').getAttribute('y1'));
      expect(Math.abs(high - (top - 9))).toBeLessThan(1.5);
      for (const node of el.querySelectorAll('.bc-ttext, .bc-legtext')) {
        const yc = Number(node.getAttribute('y')) - 4;
        expect({ width, text: node.textContent, clear: Math.abs(high - yc) > 5 }).toEqual({ width, text: node.textContent, clear: true });
      }
    }
  });

  it('cuts a level line under a label it still runs through (no clear spot near its place), the stop\'s cut going when the stop moves', () => {
    // Every bar spans the whole range: the T label goes over candles where it belongs, on the 52-week high's line.
    const wall = bars.map(b => ({ ...b, open: 90, close: 91, high: 125, low: 60 }));
    const legs = [{ startDate: day(262), endDate: day(290), high: 108, low: 95, depthPct: 12 }];
    const wallModel = { ...model, bars: wall, pivot: 100, upper: 110, stop: 93, legs };
    const probe = container(332, 340);
    renderPriceChart(probe, wallModel, { period: 130, animate: false });
    const top = Number(probe.querySelector('.bc-legbox').getAttribute('y')), line = Number(probe.querySelector('.bc-stopgroup line').getAttribute('y1'));
    const auditHigh = Math.exp(Math.log(108) + (Math.log(93) - Math.log(108)) * -9 / (line - top));
    const el = container(332, 340);
    renderPriceChart(el, { ...wallModel, auditHigh }, { period: 130, animate: false });
    // The T label struck by a level line (the 52-week high's, or another the names pushed it onto) is cut under it.
    const struck = [...el.querySelectorAll('line.bc-high52, line.bc-planline, line.bc-pivot')].flatMap(level => [...el.querySelectorAll('.bc-ttext, .bc-legtext')].filter(node => Math.abs(Number(node.getAttribute('y')) - 4 - Number(level.getAttribute('y1'))) <= 5.5).map(node => [level, node]));
    expect(struck.length).toBeGreaterThan(0);
    for (const [level, node] of struck) {
      const hy = Number(level.getAttribute('y1')), mask = el.querySelector(level.getAttribute('mask').replace(/^url\((.*)\)$/, '$1'));
      const holes = [...mask.querySelectorAll('rect[fill="#000"]')].map(r => ({ x0: Number(r.getAttribute('x')), x1: Number(r.getAttribute('x')) + Number(r.getAttribute('width')), y0: Number(r.getAttribute('y')), y1: Number(r.getAttribute('y')) + Number(r.getAttribute('height')) }));
      const [x0, x1] = node.dataset.box.split(' ').map(Number);
      expect(holes.some(h => h.x0 <= x0 && h.x1 >= x1 && h.y0 <= hy && h.y1 >= hy)).toBe(true);
    }
    // The stop's name struck on both sides of its line (2R above, 3R below): cut too, and the cut goes when the plan
    // moves the stop.
    const at = dy => Math.exp(Math.log(108) + (Math.log(93) - Math.log(108)) * (line + dy - top) / (line - top));
    const moved = container(332, 340);
    const chart = renderPriceChart(moved, { ...wallModel, pivot: 106, r2: at(-9), r3: at(11) }, { period: 130, animate: false });
    expect(Math.abs(Number(moved.querySelector('line.bc-r2').getAttribute('y1')) - (line - 9))).toBeLessThan(1.5);
    // One cut per level mask (the front one for the levels, the back one for the zone's edge), and the averages' one
    // when an average runs under the name too.
    expect(moved.querySelectorAll('mask[id$="-cut"] rect[data-for="stop"], mask[id$="-cutb"] rect[data-for="stop"]')).toHaveLength(2);
    chart.moveStop(90, false);
    expect(moved.querySelectorAll('mask rect[data-for="stop"]')).toHaveLength(0);
    // A chart with no struck label masks no level line, and an average only under a label it runs through.
    const clear = container(1000, 420);
    renderPriceChart(clear, model, { period: 130, animate: false });
    expect(clear.querySelector('line[mask], rect[mask]')).toBeNull();
    expect(clear.innerHTML).not.toContain('data-cut');
  });

  it('cuts an average under a label it runs through (a line through 「109.67」 reads as 109:67), and only there', () => {
    // The points of each average as drawn, and the boxes of the labels it crosses.
    const crossing = el => [...el.querySelectorAll('path.bc-ma')].map(path => {
      const points = path.getAttribute('d').split(/[ML]/).filter(Boolean).map(pair => pair.split(',').map(Number));
      const boxes = [...el.querySelectorAll('[data-box]')].map(node => node.dataset.box.split(' ').map(Number)).filter(([x0, x1, y0, y1]) => points.some((p, i) => {
        const q = points[i + 1];
        return q && segmentCrosses(p, q, { x0, x1, y0: (y0 + y1) / 2 - 6, y1: (y0 + y1) / 2 + 6 });
      }));
      return { path, boxes };
    });
    let veiled = 0;
    for (const [width, period] of [[332, 130], [332, 250], [1000, 130], [1000, 65]]) for (const k of [1, 50]) {
      const el = container(width, 340);
      renderPriceChart(el, busy(k), { period, animate: false });
      for (const { path, boxes } of crossing(el)) {
        if (!boxes.length) continue;
        const mask = el.querySelector(path.getAttribute('mask')?.replace(/^url\((.*)\)$/, '$1') || 'none');
        const holes = [...(mask?.querySelectorAll('rect[fill="#000"]') || [])].map(r => ['x', 'width', 'y', 'height'].map(a => Number(r.getAttribute(a))));
        for (const [x0, x1, y0, y1] of boxes) {
          const yc = (y0 + y1) / 2, covered = holes.some(([hx, hw, hy, hh]) => hx <= x0 && hx + hw >= x1 && hy <= yc - 6 && hy + hh >= yc + 6);
          expect({ width, period, k, line: path.getAttribute('class'), box: [x0, x1], covered }).toEqual({ width, period, k, line: path.getAttribute('class'), box: [x0, x1], covered: true });
          veiled++;
        }
      }
    }
    expect(veiled).toBeGreaterThan(0);
  });

  it('names the wide chart\'s structural low under its own line only, never left of where it starts', () => {
    for (const [period, k] of [[65, 1], [130, 1], [250, 1], [130, 50]]) {
      const el = container(1000, 340);
      renderPriceChart(el, busy(k), { period, animate: false });
      const line = el.querySelector('line.bc-structural'), label = el.querySelector('.bc-structural-text');
      expect({ period, k, named: Boolean(label) }).toEqual({ period, k, named: true });
      expect({ period, k, under: Number(label.getAttribute('x')) >= Number(line.getAttribute('x1')) - 0.05 }).toEqual({ period, k, under: true });
    }
  });

  it('cuts a level line under a label near the plot\'s edge all the way to the edge (no stub reads as a minus sign)', () => {
    let edges = 0;
    for (const [width, period] of [[290, 130], [332, 130], [332, 250], [332, 104], [1000, 130]]) for (const k of [1, 50]) {
      const el = container(width, 340);
      renderPriceChart(el, { ...busy(k), interval: period === 104 ? 'week' : 'day' }, { period, animate: false });
      const pw = width - 68;
      for (const r of el.querySelectorAll('mask[id$="-cut"] rect[fill="#000"]')) {
        const x0 = Number(r.getAttribute('x')), x1 = x0 + Number(r.getAttribute('width'));
        expect({ width, period, k, stub: (x0 > 0 && x0 < 7) || (x1 < pw && x1 > pw - 7) }).toEqual({ width, period, k, stub: false });
        if (x0 === 0) edges++;
      }
    }
    expect(edges).toBeGreaterThan(0);
  });

  it('shortens the volume caption to the plot\'s width on the narrowest phones, keeping ● and ■', () => {
    const heavyDown = bars.map((b, i) => (i === bars.length - 4 ? { ...b, close: bars[i - 1].close - 2, volume: 5000 } : b));
    for (const [width, caption] of [[262, '出来高・●1.4×・■下落日'], [332, '出来高・●1.4×以上（独自判定）・■下落日']]) {
      const el = container(width, 340);
      renderPriceChart(el, { ...model, bars: heavyDown }, { period: 65, animate: false });
      const node = el.querySelector('.bc-volcaption');
      expect(node.textContent).toBe(caption);
      expect(4 + _test.width(node.textContent)).toBeLessThanOrEqual(width - 68 - 4);
    }
  });

  it('keys the heavy down bars (■ 下落日) in the volume caption on a narrow chart only when one is drawn', () => {
    const heavyDown = bars.map((b, i) => (i === bars.length - 4 ? { ...b, close: bars[i - 1].close - 2, volume: 5000 } : b));
    const phone = container(332, 340), quiet = container(332, 340), desk = container(1000, 470);
    renderPriceChart(phone, { ...model, bars: heavyDown }, { period: 65, animate: false });
    renderPriceChart(quiet, model, { period: 65, animate: false });
    renderPriceChart(desk, { ...model, bars: heavyDown }, { period: 65, animate: false });
    expect(phone.querySelector('.bc-volcaption').textContent).toBe('出来高・●1.4×以上（独自判定）・■下落日');
    expect(quiet.querySelector('.bc-volcaption').textContent).not.toContain('■');
    expect(desk.querySelector('.bc-volcaption').textContent).not.toContain('■');
  });

  it('redraws when the earnings call or the New York date changes (the content key)', () => {
    const base = { ...model, earnings: { date: '2026-10-10', days: 7, soon: true }, today: '2026-10-03' };
    expect(chartContentKey({ ...base, today: '2026-10-04', earnings: { ...base.earnings, days: 6 } }, 130)).not.toBe(chartContentKey(base, 130));
    expect(chartContentKey({ ...base, today: '2026-10-04' }, 130)).not.toBe(chartContentKey(base, 130));
    expect(chartContentKey({ ...base, crossing: { date: bars.at(-3).date, volumeRatio: null } }, 130)).not.toBe(chartContentKey(base, 130));
    expect(chartContentKey({ ...base }, 130)).toBe(chartContentKey(base, 130));
  });
});
