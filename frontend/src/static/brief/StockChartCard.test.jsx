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
  // One test per owner over the same uncertified, lagging bars: the conclusion's part is in
  // StockVerdict.test.jsx (D) and the sell checks' part in StockSellCard.test.jsx (E).
  it('keeps everything computed from uncertified or lagging bars unknown and says why (the chart and the VCP card)', () => {
    render(<StockView data={data(false, '2026-10-01')} />);
    expect(screen.getByText(/日足は 2026-10-01 までです（分析基準日 2026-10-02 の日足は未取得）/)).toBeInTheDocument();
    const updown = screen.getByText('上げ下げ出来高比（50日）').nextSibling;
    expect(updown).toHaveTextContent('未確認');
  });
});
