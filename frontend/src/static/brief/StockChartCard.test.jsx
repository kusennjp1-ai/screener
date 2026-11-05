import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
afterEach(() => { cleanup(); sessionStorage.clear(); });

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

describe('brief stock chart card', () => {
  const tap = (clientX) => {
    const chart = screen.getByTestId('brief-price-chart'), front = chart.children[2];
    front.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 340 });
    fireEvent(chart.querySelector('.bc-hit'), new MouseEvent('pointerdown', { clientX, bubbles: true }));
  };

  it('puts the periods above the chart and keeps the chosen one when the next stock remounts the view', () => {
    const { rerender } = render(<StockView key="AAA" data={data(true)} />);
    const periods = screen.getByRole('group', { name: '表示期間' });
    expect(periods.compareDocumentPosition(screen.getByTestId('brief-price-chart')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 200 sessions are under two years of weeks, so the weekly button says how many weeks it draws.
    const weekly = within(periods).getByRole('button', { name: /^週足（\d+週）$/ });
    fireEvent.click(weekly);
    expect(weekly).toHaveAttribute('aria-pressed', 'true');
    rerender(<StockView key="BBB" data={{ ...data(true), view: { ...view, symbol: 'BBB' } }} />);
    expect(within(screen.getByRole('group', { name: '表示期間' })).getByRole('button', { name: /^週足/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('brief-price-chart').getAttribute('aria-label')).toMatch(/^BBB の週足チャート/);
  });

  it('reads out the latest bar, follows a touch, keeps it after release and returns with 最新足', () => {
    render(<StockView data={data(true)} />);
    const readout = () => screen.getByRole('group', { name: /の足の値$|の値$/ });
    expect(readout()).toHaveAccessibleName('最新の足の値');
    expect(readout()).toHaveTextContent('10/02');
    expect(screen.queryByRole('button', { name: '最新足' })).toBeNull();
    tap(1);
    expect(readout()).not.toHaveTextContent('10/02');
    expect(readout().getAttribute('aria-label')).toMatch(/^選んだ足（\d\d\/\d\d）の値$/);
    // Only the latest certified bar is judged against the pivot.
    expect(readout()).not.toHaveTextContent('ピボット');
    fireEvent(screen.getByTestId('brief-price-chart').querySelector('.bc-hit'), new MouseEvent('pointerup', { bubbles: true }));
    fireEvent.click(screen.getByRole('button', { name: '最新足' }));
    expect(readout()).toHaveTextContent('10/02');
    expect(readout()).toHaveTextContent('ピボット');
    expect(screen.queryByRole('button', { name: '最新足' })).toBeNull();
  });

  it('shows — with a screen-reader word for an average whose window is short, never 0', () => {
    render(<StockView data={data(true)} />);
    const averages = screen.getByRole('group', { name: '最新の足の値' }).querySelector('.ro-averages');
    // 200 bars: the 50- and 150-day averages exist, the 200-day one has exactly its window.
    expect(averages).toHaveTextContent(/50日\s*[\d.]+/);
    render(<StockView data={{ ...data(true), bars: bars().slice(-120) }} />);
    const short = screen.getAllByRole('group', { name: '最新の足の値' }).at(-1).querySelector('.ro-ma150');
    expect(short).toHaveTextContent('150日 —本数不足');
    expect(short).not.toHaveTextContent(/150日\s*0/);
  });

  it('draws gap bands (独自判定) only from certified bars', () => {
    const gapped = end => { const list = bars(end); list[150] = { ...list[150], open: list[149].high * 1.05, high: list[149].high * 1.06, close: list[149].high * 1.055, low: list[149].high * 1.04 }; return list; };
    const list = gapped();
    render(<StockView data={{ ...data(true), bars: list }} />);
    expect([...screen.getByTestId('brief-price-chart').querySelectorAll('.bc-gap')].map(node => node.dataset.date)).toContain(list[150].date);
    cleanup();
    render(<StockView data={{ ...data(false), bars: gapped() }} />);
    expect(screen.getByTestId('brief-price-chart').querySelectorAll('.bc-gap')).toHaveLength(0);
  });
});