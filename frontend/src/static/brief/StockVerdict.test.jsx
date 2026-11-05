import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import StockView from './StockView';

const DATE = '2026-10-02';
const day = i => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const bars = (end = DATE) => {
  const list = Array.from({ length: 200 }, (_, i) => { const close = 50 * 1.003 ** i; return { date: day(i), open: close, high: close * 1.005, low: close * 0.995, close, volume: 10000 }; });
  const last = { ...list.at(-1), date: end, open: list.at(-1).close * 0.9, close: list.at(-1).close * 0.9, low: list.at(-1).close * 0.89, volume: 30000 };
  return [...list.slice(0, -1), last];
};
const view = { symbol: 'AAA', name: 'Alpha', state: 'wait', stateLabel: 'ピボット待ち', distance: -3, pivot: 100, upper: 105, price: 97, rs: 80, volumeRatio: 1, fromHigh: 10, earnings: null, pivotSource: 'test' };
const data = (certified, end) => ({
  view, row: { symbol: 'AAA', chart_path: 'AAA.json' }, template: null, technical: null, diagnostics: null, financial: null, institutional: null,
  bars: bars(end), date: DATE, certification: certified ? { certified: true, reason: null } : { certified: false, reason: '最終日足が分析日と不一致' },
  chart: { data: { rs_line: [] }, isError: false },
});
afterEach(cleanup);

describe('brief stock view', () => {
  it('keeps everything computed from uncertified or lagging bars unknown and says why (the conclusion)', () => {
    render(<StockView data={data(false, '2026-10-01')} />);
    expect(screen.getByText('ステージ 未確認')).toBeInTheDocument();
    expect(screen.getByText('損切り（−7.0%）')).toBeInTheDocument();
  });

  it('labels the stop without a percentage when there is no plan', () => {
    render(<StockView data={{ ...data(true), view: { ...view, pivot: null, price: null } }} />);
    expect(within(screen.getByTestId('brief-conclusion')).getByText('損切り')).toBeInTheDocument();
    expect(screen.queryByText(/−—%/)).toBeNull();
  });
});

describe('brief stock view on a phone folds what is secondary, never a fired or unknown check', () => {
  const rule = (label, state) => ({ label, state, evidence: `${label} の根拠` });
  const template = states => ({ passed: states.filter(s => s === 'pass').length, failed: states.filter(s => s === 'fail').length, unknown: states.filter(s => s === 'unknown').length,
    rules: states.map((state, i) => rule(`条件${i + 1}`, state)) });
  const folded = element => Boolean(element.closest('details'));
  const item = text => screen.getByText(text).closest('li');
  afterEach(() => sessionStorage.clear());

  it('lists unmet and unknown conditions and folds the met ones into a line that counts them', () => {
    render(<StockView data={{ ...data(true), template: template(['pass', 'fail', 'pass', 'unknown', 'pass', 'pass', 'pass', 'pass']) }} />);
    expect(folded(item('条件2'))).toBe(false);
    expect(folded(item('条件4'))).toBe(false);
    expect(folded(item('条件1'))).toBe(true);
    expect(screen.getByText('達成した条件 6件').closest('summary')).toBeTruthy();
    cleanup();
    // All met: the eight conditions fold behind one line that says so.
    render(<StockView data={{ ...data(true), template: template(Array(8).fill('pass')) }} />);
    expect(screen.getByText('8条件の内訳（すべて達成）').closest('summary')).toBeTruthy();
    for (let i = 1; i <= 8; i++) expect(folded(item(`条件${i}`))).toBe(true);
  });

  it('shows everything open on the desktop, each footnote in place on its card and no 注記 (the template card)', () => {
    render(<StockView data={{ ...data(true), template: template(Array(8).fill('pass')) }} wide />);
    for (let i = 1; i <= 8; i++) expect(folded(item(`条件${i}`))).toBe(false);
  });
});
