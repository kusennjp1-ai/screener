import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
  // One test per owner over the same certified bars: the sell checks' part is in StockSellCard.test.jsx (E).
  it('judges sell checks and computed values only on certified bars (the chart)', () => {
    render(<StockView data={data(true)} />);
    expect(screen.queryByText(/チャートから算出する判定は未確認/)).toBeNull();
  });
});

describe('brief stock view on a phone folds what is secondary, never a fired or unknown check', () => {
  const rule = (label, state) => ({ label, state, evidence: `${label} の根拠` });
  const template = states => ({ passed: states.filter(s => s === 'pass').length, failed: states.filter(s => s === 'fail').length, unknown: states.filter(s => s === 'unknown').length,
    rules: states.map((state, i) => rule(`条件${i + 1}`, state)) });
  afterEach(() => sessionStorage.clear());

  // The screen's one 注記 gathers each card's footnote: that test is split by the footnote's owner, in
  // StockFundamentalsCard.test.jsx (C) and StockSellCard.test.jsx (E). The desktop test below is split the
  // same way: the template card's part is with D's template tests (StockVerdict.test.jsx), the
  // fundamentals card's in StockFundamentalsCard.test.jsx (C) and the sell card's in StockSellCard.test.jsx (E).
  it('shows everything open on the desktop, each footnote in place on its card and no 注記 (the screen and the VCP card)', () => {
    render(<StockView data={{ ...data(true), template: template(Array(8).fill('pass')) }} wide />);
    expect(document.querySelectorAll('details')).toHaveLength(0);
    expect(screen.queryByText('注記')).toBeNull();
    expect(screen.getByText('上げ下げ出来高比（50日）').nextSibling).toHaveTextContent('上げた日の出来高 ÷ 下げた日の出来高。1超は買いが優勢');
  });
});
