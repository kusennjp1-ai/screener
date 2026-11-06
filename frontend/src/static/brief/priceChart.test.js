import { describe, expect, it, vi } from 'vitest';
import { _test, dateTicks, indexRuns, keepRightFirst, NARROW_CHART_WIDTH, renderPriceChart, RS_CAPTION, spread, weeklyBars } from './priceChart';
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
function chartBoxes(el) {
  const labels = [...el.querySelectorAll('.bc-levelnote, .bc-malabel, .bc-ttext, .bc-legtext, .bc-zonetext, .bc-notice, .bc-breakouttext, .bc-rscaption')]
    .filter(node => node.getAttribute('visibility') !== 'hidden').map(node => {
      const w = _test.width(node.textContent, (node.getAttribute('font-family') || '').includes('mono')), x = Number(node.getAttribute('x')), anchor = node.getAttribute('text-anchor');
      const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x, centre = Number(node.getAttribute('y')) - 4;
      return { name: node.textContent, x0, x1: x0 + w, y0: centre - 6, y1: centre + 6 };
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

  it('keeps contraction T labels right-first, 18px apart, always with the last one and its depth', () => {
    expect(keepRightFirst([{ x: 10 }, { x: 20 }, { x: 30 }, { x: 45 }], 18).map(item => item.x)).toEqual([20, 45]);
    const narrow = Array.from({ length: 6 }, (_, k) => ({ startDate: day(276 + k * 3), endDate: day(277 + k * 3), high: 112, low: 110, depthPct: 6 - k * 0.5 }));
    const el = container();
    renderPriceChart(el, { ...model, legs: narrow }, { period: 130, animate: false });
    const labels = [...el.querySelectorAll('.bc-tlabel')];
    // The last box is too narrow for its depth under it: one combined label above it.
    expect(labels.map(node => node.textContent)).toContain('T6 −4%');
    expect(labels.length).toBeLessThan(6);
    const xs = labels.map(node => Number(node.querySelector('text').getAttribute('x'))).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(18);
    expect(collisions(el)).toEqual([]);
  });

  it('keeps the final contraction depth with 4 legs at 390, dropping older depths first and T(last−1) before T1', () => {
    const four = [[150, 175, 108, 85, 21], [190, 215, 108, 95, 12], [230, 250, 108, 101, 6.5], [262, 290, 108, 104.5, 3.2]]
      .map(([a, b, high, low, depthPct]) => ({ startDate: day(a), endDate: day(b), high, low, depthPct }));
    for (const period of [130, 250]) {
      const el = container(332, 340);
      renderPriceChart(el, { ...model, legs: four }, { period, animate: false });
      const last = el.querySelector('.bc-legtext[data-i="3"]') || el.querySelector('.bc-tlabel[data-leg="3"] .bc-tdepth');
      expect({ period, depth: last?.textContent }).toEqual({ period, depth: expect.stringMatching(/−3%$/) });
      const tIndices = [...el.querySelectorAll('.bc-tlabel')].map(node => Number(node.dataset.leg));
      expect(tIndices).toContain(3);
      if (tIndices.includes(0)) expect(tIndices).toContain(2);
      // Older depths go first: a depth is shown only when every newer one is.
      const depths = [...el.querySelectorAll('.bc-legtext')].map(node => Number(node.dataset.i));
      for (const i of depths) for (let j = i + 1; j < 3; j++) expect({ i, j, newer: depths.includes(j) || el.querySelector(`.bc-tlabel[data-leg="${j}"] .bc-tdepth`) !== null }).toEqual({ i, j, newer: true });
      expect(collisions(el)).toEqual([]);
    }
  });

  it('draws the plan lines and the 52-week high only inside the y-range, never widening it', () => {
    const inside = container(), outside = container();
    renderPriceChart(inside, { ...model, r2: 111, r3: 112, entry: 109, auditHigh: 112.5 }, { period: 130, animate: false });
    renderPriceChart(outside, { ...model, r2: 160, r3: 190, auditHigh: 300 }, { period: 130, animate: false });
    expect(inside.querySelectorAll('.bc-r2, .bc-r3, .bc-entry, .bc-high52')).toHaveLength(4);
    expect(texts(inside, '.bc-levelnote')).toEqual(expect.arrayContaining(['2R 111.00', '3R 112.00', '買値 109.00']));
    expect(texts(inside, '.bc-high52-text')[0] ?? '52週高値 112.50（−0.0%）').toMatch(/^52週高値 112\.50（[−+±]\d+\.\d%）$/);
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

  it('writes 出来高の枯渇 inside the volume panel, clear of its caption', () => {
    const el = container(600, 420);
    renderPriceChart(el, { ...model, dryUpLeg: model.legs[1] }, { period: 130, animate: false });
    const note = el.querySelector('.bc-notetext'), caption = el.querySelector('.bc-volcaption');
    expect(note.textContent).toBe('出来高の枯渇');
    expect(note.getAttribute('y')).toBe(caption.getAttribute('y'));
    expect(Number(note.getAttribute('x'))).toBeGreaterThan(4 + 12 * 14);
    expect(caption.querySelector('.bc-volkey').textContent).toBe('●');
    // A phone has no room beside the caption: the name goes on the line under it, still in the panel.
    const phone = container(390, 340);
    renderPriceChart(phone, { ...model, dryUpLeg: model.legs[1] }, { period: 130, animate: false });
    const under = phone.querySelector('.bc-notetext');
    expect(Number(under.getAttribute('y'))).toBe(Number(phone.querySelector('.bc-volcaption').getAttribute('y')) + 14);
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
