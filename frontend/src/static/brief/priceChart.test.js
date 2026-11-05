import { describe, expect, it, vi } from 'vitest';
import { dateTicks, keepRightFirst, renderPriceChart, spread, weeklyBars } from './priceChart';

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
    expect(el.querySelector('.bc-rstext')?.textContent).toBe('新高値');
    // The readout above the chart replaced the tooltip.
    expect(el.querySelector('.bc-tip')).toBeNull();
    expect(texts(el, '.bc-levelnote')).toEqual(expect.arrayContaining(['ピボット', '損切り −7.0%']));
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

  it('keeps contraction T labels right-first, 18px apart, always with the last one', () => {
    expect(keepRightFirst([{ x: 10 }, { x: 20 }, { x: 30 }, { x: 45 }], 18).map(item => item.x)).toEqual([20, 45]);
    const narrow = Array.from({ length: 6 }, (_, k) => ({ startDate: day(276 + k * 3), endDate: day(277 + k * 3), high: 112, low: 110, depthPct: 6 - k * 0.5 }));
    const el = container();
    renderPriceChart(el, { ...model, legs: narrow }, { period: 130, animate: false });
    const labels = [...el.querySelectorAll('.bc-tlabel')];
    expect(labels.map(node => node.textContent)).toContain('T6');
    expect(labels.length).toBeLessThan(6);
    const xs = labels.map(node => Number(node.querySelector('text').getAttribute('x'))).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(18);
  });

  it('draws the plan lines and the 52-week high only inside the y-range, never widening it', () => {
    const inside = container(), outside = container();
    renderPriceChart(inside, { ...model, r2: 111, r3: 112, entry: 109, auditHigh: 112.5 }, { period: 130, animate: false });
    renderPriceChart(outside, { ...model, r2: 160, r3: 190, auditHigh: 300 }, { period: 130, animate: false });
    expect(inside.querySelectorAll('.bc-r2, .bc-r3, .bc-entry, .bc-high52')).toHaveLength(4);
    expect(texts(inside, '.bc-levelnote')).toEqual(expect.arrayContaining(['2R 111.00', '3R 112.00', '買値 109.00']));
    expect(texts(inside, '.bc-high52-text')[0]).toMatch(/^52週高値 112\.50（[−+±]\d+\.\d%）$/);
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

  it('dots the RS lead days, draws the 252-point maximum only in range and names a missing RS line with its reason', () => {
    const el = container();
    const dates = bars.slice(-3).map(b => b.date);
    renderPriceChart(el, { ...model, rsLead: { dates: [...dates, '1999-01-01'], threshold: 120 } }, { period: 130, animate: false });
    expect(el.querySelectorAll('.bc-rslead')).toHaveLength(3);
    expect(el.querySelector('.bc-rsmax')).not.toBeNull();
    // The RS line is neither RS推計 (the rating) nor IBD RS, at every width.
    expect(el.querySelector('.bc-rscaption').textContent).toBe('RS線（株価÷S&P 500）・RS推計やIBD RSとは別');
    expect(el.getAttribute('aria-label')).toContain('RS線（株価÷S&P 500。RS推計やIBD RSとは別）を表示');
    const narrow = container(280, 340);
    renderPriceChart(narrow, model, { period: 130, animate: false });
    expect(narrow.querySelector('.bc-rscaption').textContent).toBe('RS線（株価÷S&P 500）・RS推計/IBD RSと別');
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

  it('writes the next earnings outside the date axis only within 28 days, and draws the gap bands it is given', () => {
    const near = container(), soon = container(), far = container(), none = container();
    renderPriceChart(near, { ...model, earnings: { date: '2026-11-12', days: 20 } }, { period: 130, animate: false });
    renderPriceChart(soon, { ...model, earnings: { date: '2026-11-12', days: 8 } }, { period: 130, animate: false });
    renderPriceChart(far, { ...model, earnings: { date: '2026-12-12', days: 40 } }, { period: 130, animate: false });
    renderPriceChart(none, { ...model, earnings: null }, { period: 130, animate: false });
    expect(texts(near, '.bc-earnings')).toEqual(['決算 11/12 あと20日']);
    expect(near.querySelector('.bc-earnings-soon')).toBeNull();
    expect(soon.querySelector('.bc-earnings-soon').textContent).toBe('決算 11/12 あと8日');
    expect(far.querySelector('.bc-earnings')).toBeNull();
    const today = container();
    renderPriceChart(today, { ...model, earnings: { date: '2026-10-02', days: 0 } }, { period: 130, animate: false });
    expect(texts(today, '.bc-earnings')).toEqual(['決算 10/2 当日']);
    expect(none.querySelector('.bc-earnings')).toBeNull();
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
});
