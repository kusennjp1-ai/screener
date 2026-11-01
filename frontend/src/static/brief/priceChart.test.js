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

  it('says so instead of drawing when there are no bars', () => {
    const el = container();
    expect(renderPriceChart(el, { ...model, bars: [] }, { animate: false })).toBeNull();
    expect(el.textContent).toContain('日足データが不足しています');
  });
});
