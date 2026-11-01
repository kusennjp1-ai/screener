import { describe, expect, it } from 'vitest';
import { renderPriceChart } from './priceChart';

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
  symbol: 'TEST', bars, rsLine: bars.map((b, i) => ({ time: b.date, value: 100 + i * 0.1 })), pivot: 108, upper: 113.4, stop: 100.4, rsNewHigh: true,
  legs: [{ startDate: day(220), endDate: day(245), high: 108, low: 95, depthPct: 12 }, { startDate: day(250), endDate: day(275), high: 108, low: 102, depthPct: 5.6 }],
};

describe('brief price chart', () => {
  it('draws the period, buy zone, contraction boxes, pivot and stop tags with a summary label', () => {
    const el = container();
    renderPriceChart(el, model, { period: 130, animate: false });
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toMatch(/TEST の日足チャート.*ピボット 108\.00.*損切りの目安 100\.40.*値幅の収縮 12%→6%/);
    expect(el.querySelectorAll('.bc-legbox')).toHaveLength(2);
    expect(el.querySelectorAll('.bc-up, .bc-down').length).toBe(130 * 2);
    expect(el.querySelector('.bc-zonefill')).not.toBeNull();
    expect([...el.querySelectorAll('.bc-tagtext')].map(t => t.textContent)).toEqual(['100.40', '108.00']);
    expect(el.querySelector('.bc-rstext')?.textContent).toBe('新高値');
    expect(el.querySelector('.bc-tip').hidden).toBe(true);
  });

  it('moves the stop line when the plan changes and clips a contraction that began before the period', () => {
    const el = container();
    const chart = renderPriceChart(el, model, { period: 40, animate: false });
    expect(el.querySelectorAll('.bc-legbox')).toHaveLength(1);
    expect(Number(el.querySelector('.bc-legbox').getAttribute('x'))).toBe(0);
    expect(renderPriceChart(container(), model, { period: 20, animate: false }) && document.body.lastChild.querySelectorAll('.bc-legbox')).toHaveLength(0);
    const before = Number(el.querySelector('.bc-stop').getAttribute('y1'));
    chart.moveStop(104, false);
    expect(el.querySelector('.bc-stoptag-fill + .bc-tagtext').textContent).toBe('104.00');
    expect(Number(el.querySelector('.bc-stop').getAttribute('y1'))).toBeLessThan(before);
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

  it('says so instead of drawing when there are no bars', () => {
    const el = container();
    expect(renderPriceChart(el, { ...model, bars: [] }, { animate: false })).toBeNull();
    expect(el.textContent).toContain('日足データが不足しています');
  });
});
