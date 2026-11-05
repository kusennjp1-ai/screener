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
// The desktop render of the shell's split test: every condition of the trend template met.
const allMet = { passed: 8, failed: 0, unknown: 0, rules: Array.from({ length: 8 }, (_, i) => ({ label: `条件${i + 1}`, state: 'pass', evidence: `条件${i + 1} の根拠` })) };
afterEach(cleanup);

describe('brief stock view', () => {
  it('judges sell checks and computed values only on certified bars (the sell checks)', () => {
    render(<StockView data={data(true)} />);
    expect(screen.getByText(/^売りのサイン [1-9]件$/)).toBeInTheDocument();
    expect(screen.getByTestId('brief-sell')).toHaveTextContent('出来高を伴う50日線割れ');
  });

  it('keeps everything computed from uncertified or lagging bars unknown and says why (the sell checks)', () => {
    render(<StockView data={data(false, '2026-10-01')} />);
    expect(screen.queryByText(/^売りのサイン [0-9]+件$/)).toBeNull();
    expect(screen.getByTestId('brief-sell')).toHaveTextContent('売りのサインは未確認です（最終日足が分析日と不一致）');
  });
});

describe('brief stock view on a phone folds what is secondary, never a fired or unknown check', () => {
  const folded = element => Boolean(element.closest('details'));
  afterEach(() => sessionStorage.clear());

  it('keeps a fired sell check listed and folds the quiet ones with their count', () => {
    render(<StockView data={data(true)} />);
    const sell = screen.getByTestId('brief-sell');
    const hit = within(sell).getByText(/^出来高を伴う50日線割れ/).closest('li');
    expect(hit.querySelector('.is-sell-hit')).toBeTruthy();
    expect(folded(hit)).toBe(false);
    const quiet = [...sell.querySelectorAll('li')].filter(li => !li.querySelector('.is-sell-hit, .is-sell-unknown'));
    expect(quiet.length).toBeGreaterThan(0);
    for (const li of quiet) expect(folded(li)).toBe(true);
    expect(within(sell).getByText(/^サインなし \d+件/).closest('summary')).toBeTruthy();
  });

  it('keeps 独自判定 and 売買の推奨ではありません on the sell card itself, never only behind a fold', () => {
    for (const wide of [false, true]) {
      render(<StockView data={data(true)} wide={wide} />);
      const sell = screen.getByTestId('brief-sell');
      const heading = within(sell).getByRole('heading', { level: 2 });
      expect(heading).toHaveTextContent('売りのサイン（直近5営業日・独自判定）');
      const qualifier = within(sell).getByTestId('brief-sell-qualifier');
      expect(qualifier).toHaveTextContent('独自判定');
      expect(qualifier).toHaveTextContent('売買の推奨ではありません。');
      for (const element of [heading, qualifier]) expect(folded(element)).toBe(false);
      cleanup();
    }
    // Bars that cannot be judged still carry the qualifier.
    render(<StockView data={data(false, '2026-10-01')} />);
    expect(within(screen.getByTestId('brief-sell')).getByTestId('brief-sell-qualifier')).toHaveTextContent('売買の推奨ではありません。');
  });

  it('gathers the methodology footnotes in the screen\'s one 注記 (the sell card\'s)', () => {
    render(<StockView data={data(true)} />);
    // The methodology footnotes are in the screen's one 注記.
    const notes = screen.getByText('注記').closest('details');
    expect(notes).toHaveTextContent('しきい値はこのアプリ独自（独自判定）です。売買の推奨ではありません。');
  });

  it('shows everything open on the desktop, each footnote in place on its card and no 注記 (the sell card)', () => {
    render(<StockView data={{ ...data(true), template: allMet }} wide />);
    expect(within(screen.getByTestId('brief-sell')).getByText(/^保有中の判断材料です。複合警告は『株式トレード 基本と原則』の観点.*売買の推奨ではありません。$/)).toBeInTheDocument();
  });
});
