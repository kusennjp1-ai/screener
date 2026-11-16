import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import StockView from './StockView';
import SellCard from './StockSellCard';
import { failedBreakoutContext, stockSells, WEAKNESS_CHIP, WEAKNESS_ROW_CHIP } from './briefSell';

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
    // The conclusion's chip names a broken setup for a stock not held, never a bare sell count (sellChipView's
    // `text`; D's conclusion may show its `full` sentence instead).
    const conclusion = screen.getByTestId('brief-conclusion').textContent;
    expect(conclusion.includes(WEAKNESS_ROW_CHIP) || conclusion.includes(WEAKNESS_CHIP)).toBe(true);
    expect(screen.queryByText(/^売りのサイン [0-9]+件$/)).toBeNull();
    expect(screen.getByTestId('brief-sell')).toHaveTextContent('出来高を伴う50日線割れ');
    expect(screen.getByTestId('brief-sell')).toHaveTextContent(/に出来高 3\.00×で割れ、以降50日線の下（1営業日）/);
  });

  it('judges the climax checks only beyond +20% from the pivot (or +25% from the 50-day line) and says why not on the card', () => {
    render(<StockView data={data(true)} />);
    const sell = screen.getByTestId('brief-sell');
    // The gate's own reason (the 注記 gives both bars): below the pivot, the 50-day alternative never judges either.
    expect(sell).toHaveTextContent('上昇の加速は判定せず（ピボットより下）。');
    // The advance's 起点 is said as a short date, like every date on the card.
    expect(sell).toHaveTextContent(/起点（直近1年の安値）2025\/1\/1 の /);
    // A stock below its pivot: the four climax checks are folded as 判定せず with the reason (never 対象外).
    expect(within(sell).getByText('サインなし 1件・判定せず 4件').closest('summary')).toBeTruthy();
    expect(sell).not.toHaveTextContent('対象外');
    expect(sell).toHaveTextContent('ピボットより下（ブレイク前）のため判定しません');
  });

  it('says 判定していない項目 n件 while a check is not judged, never 「いま出ているサインはありません」', () => {
    // A steady advance below its pivot, the book's diagnostics in and clear: nothing fired, the four climax checks not judged.
    const steady = Array.from({ length: 200 }, (_, i) => { const close = 50 * 1.003 ** i; return { date: i === 199 ? DATE : day(i), open: close, high: close * 1.005, low: close * 0.995, close, volume: 10000 }; });
    const diagnostics = { valid: true, as_of_date: DATE, priceWarnings: { below20: false, threeLowerLows: false, currentVolumeRatio: 1, combinedWarning: false, recoveryInUpperHalf: false } };
    render(<StockView data={{ ...data(true), bars: steady, diagnostics }} />);
    const sell = screen.getByTestId('brief-sell');
    expect(sell).toHaveTextContent('判定していない項目 4件。');
    expect(sell).not.toHaveTextContent('いま出ているサインはありません');
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
    expect(within(sell).getByText(/^(サインなし \d+件・)?判定せず \d+件$/).closest('summary')).toBeTruthy();
  });

  it('keeps 独自判定 and 売買の推奨ではありません on the sell card itself, never only behind a fold', () => {
    for (const wide of [false, true]) {
      render(<StockView data={data(true)} wide={wide} />);
      const sell = screen.getByTestId('brief-sell');
      const heading = within(sell).getByRole('heading', { level: 2 });
      expect(heading).toHaveTextContent('売りのサイン（独自判定）');
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

// Round 3 R5: a failed breakout past its 10-session window is one neutral, dated line on the card (failedBreakoutContext),
// outside the fold and outside every check: the checks, their states and the card's status read as without it.
describe('the sell card dates a failed breakout after its window (round 3 R5)', () => {
  // 200 sessions under the pivot of 100, a close above it on 2.2x the prior volume, back under the next session and under
  // it for the 12 sessions since; the last bar is the analysis day.
  const failedBars = () => {
    const closes = [...Array(200).fill(95), 102, 98, 97, 96, 90, 92, 94, 95, 96, 97, 98, 98, 99];
    return closes.map((close, i) => ({ date: i === closes.length - 1 ? DATE : day(i), open: close, high: close * 1.005, low: close * 0.995, close, volume: i === 200 ? 22000 : 10000 }));
  };
  const failedView = { ...view, distance: -1, price: 99 };
  const lines = node => within(node).queryAllByTestId('brief-failed-context');

  it('renders the producer\'s line once, as a plain note outside the fold, on a phone and on the desktop', () => {
    const judged = failedBars(), context = failedBreakoutContext(judged, 100);
    expect(context).not.toBeNull();
    for (const wide of [false, true]) {
      render(<StockView data={{ ...data(true), view: failedView, bars: judged }} wide={wide} />);
      const sell = screen.getByTestId('brief-sell');
      expect(lines(sell)).toHaveLength(1);
      const [line] = lines(sell);
      expect(line.textContent).toBe(context.text);
      // Neutral: a plain note (no tone, no check glyph), never a check row and never folded.
      expect(line.tagName).toBe('P');
      expect(line.className).toBe('brief-note');
      expect(line.closest('li')).toBeNull();
      expect(line.closest('details')).toBeNull();
      // The failed-breakout check is still clear with its own sentence, and nothing fired.
      const check = within(sell).getByText(/^出来高を伴う上抜け後のピボット割れ/).closest('li');
      expect(check.querySelector('.is-sell-clear')).toBeTruthy();
      expect(check).toHaveTextContent('直近10営業日にピボットの上抜けなし（終値はピボット比 −1.0%）');
      expect(sell.querySelectorAll('.is-sell-hit')).toHaveLength(0);
      cleanup();
    }
  });

  it('keeps every check, its state and the card\'s status line as without the line', () => {
    const judged = failedBars(), sells = stockSells({ judged, diagnostics: null, view: failedView });
    const { failedContext, ...without } = sells;
    expect(failedContext).toBeTruthy();
    const card = value => {
      const { container } = render(<SellCard sells={value} wide />);
      const out = { checks: [...container.querySelectorAll('li')].map(li => [li.querySelector('.brief-check').className, li.textContent]), notes: [...container.querySelectorAll('.brief-note')].filter(node => !node.dataset.testid).map(node => node.textContent) };
      cleanup();
      return out;
    };
    expect(card(sells)).toEqual(card(without));
    render(<SellCard sells={without} wide />);
    expect(lines(screen.getByTestId('brief-sell'))).toHaveLength(0);
  });

  it('shows no line without one: inside the window (the hit says it) or for any other card', () => {
    // Back under the pivot three sessions ago: the check's hit, no line.
    const closes = [...Array(200).fill(95), 102, 98, 97, 99];
    const recent = closes.map((close, i) => ({ date: i === closes.length - 1 ? DATE : day(i), open: close, high: close * 1.005, low: close * 0.995, close, volume: i === 200 ? 22000 : 10000 }));
    render(<StockView data={{ ...data(true), view: failedView, bars: recent }} />);
    const sell = screen.getByTestId('brief-sell');
    expect(within(sell).getByText(/^出来高を伴う上抜け後のピボット割れ/).closest('li').querySelector('.is-sell-hit')).toBeTruthy();
    expect(lines(sell)).toHaveLength(0);
    cleanup();
    render(<StockView data={data(true)} />);
    expect(lines(screen.getByTestId('brief-sell'))).toHaveLength(0);
  });
});
