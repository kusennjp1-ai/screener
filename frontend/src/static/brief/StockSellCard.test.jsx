import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import StockView from './StockView';
import SellCard from './StockSellCard';
import { failedBreakoutContext, STOP_ROW_LABEL, stockSells, stopReachedCheck, WEAKNESS_CHIP, WEAKNESS_ROW_CHIP } from './briefSell';
import { positionPlan } from './positionSizing';

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
    expect(sell).toHaveTextContent('上昇の加速は判定なし（ピボットより下）。');
    // The advance's 起点 is said as a short date, like every date on the card.
    expect(sell).toHaveTextContent(/起点（直近1年の安値）2025\/1\/1 の /);
    // A stock below its pivot: the four climax checks are folded as 判定なし with the reason (never 対象外).
    // S2-P6 (BEH-1): the stop row's own segment follows the two counts, which are unchanged (USR-m5).
    expect(within(sell).getByText('サインなし 1件・判定なし 4件／損切り判定なし').closest('summary')).toBeTruthy();
    expect(sell).not.toHaveTextContent('対象外');
    expect(sell).toHaveTextContent('ピボットより下（ブレイク前）のため判定しません');
  });

  it('says 判定なしの項目 n件 while a check is not judged, never 「いま出ているサインはありません」', () => {
    // A steady advance below its pivot, the book's diagnostics in and clear: nothing fired, the four climax checks not judged.
    const steady = Array.from({ length: 200 }, (_, i) => { const close = 50 * 1.003 ** i; return { date: i === 199 ? DATE : day(i), open: close, high: close * 1.005, low: close * 0.995, close, volume: 10000 }; });
    const diagnostics = { valid: true, as_of_date: DATE, priceWarnings: { below20: false, threeLowerLows: false, currentVolumeRatio: 1, combinedWarning: false, recoveryInUpperHalf: false } };
    render(<StockView data={{ ...data(true), bars: steady, diagnostics }} />);
    const sell = screen.getByTestId('brief-sell');
    expect(sell).toHaveTextContent('判定なしの項目 4件。');
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
    expect(within(sell).getByText(/^(サインなし \d+件・)?判定なし \d+件／損切り(判定なし|該当なし)$/).closest('summary')).toBeTruthy();
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

// BEH-1 (plan S2-P6): the stop row on the sell card, its place, its words and the status sentence beside it.
describe('the sell card\'s stop row (損切りに到達, BEH-1)', () => {
  const check = (key, state) => ({ key, label: `${key}の項目`, state, detail: `${key}の内容` });
  const stopOf = state => ({ key: 'stop', label: STOP_ROW_LABEL, state, cause: state === 'na' ? 'lookback' : state === 'unknown' ? 'missingLow' : 'judged', level: 93,
    parts: state === 'hit' || state === 'clear' ? ['仮の損切り $93.00（ピボットの −7.0%・独自設定）', '9/1 の上抜けの後の最安値 $92.00（9/3）'] : null,
    detail: state === 'na' ? '直近60営業日に上抜けの日付なし' : state === 'unknown' ? '9/1 の上抜けの後の安値が欠けています' : 'judged' });
  // A sells result as tally() returns it: the counts from the two sides only.
  const sellsOf = (weakness, stop, strength = ['day-up', 'week-up', 'up-days', 'climax'].map(key => check(key, 'clear'))) => {
    const hit = list => list.filter(c => c.state === 'hit').length;
    return { asOf: DATE, advance: null, run: null, runShort: { reason: 'ピボットより下', fromSma50: null }, strength, weakness, stop,
      hits: hit(strength) + hit(weakness), strengthHits: hit(strength), weaknessHits: hit(weakness), breakdownHits: 0,
      cautions: weakness.filter(c => c.state === 'caution').length, unknowns: weakness.filter(c => c.state === 'unknown').length };
  };
  const clear = () => ['day-down', 'ma50', 'failedBreakout', 'book'].map(key => check(key, 'clear'));
  const note = () => screen.getByTestId('brief-sell').querySelector('.brief-note').textContent;
  const row = () => screen.getByTestId('brief-sell-stop');
  const folded = element => Boolean(element.closest('details'));

  it('never says 「いま出ているサインはありません」 beside a 該当 or 未確認 stop row, and keeps the counts', () => {
    render(<SellCard sells={sellsOf(clear(), stopOf('hit'))} />);
    expect(note()).toContain('損切りの行：仮の損切りに到達しています（サインの件数には含めていません）。');
    expect(note()).not.toContain('いま出ているサインはありません');
    expect(note()).not.toMatch(/件のサイン/);
    cleanup();
    render(<SellCard sells={sellsOf(clear(), stopOf('unknown'))} />);
    expect(note()).toContain(' 損切りの行は未確認です。');
    expect(note()).not.toContain('いま出ているサインはありません');
    cleanup();
    // Quiet rows leave the sentence as it was.
    for (const state of ['clear', 'na']) {
      render(<SellCard sells={sellsOf(clear(), stopOf(state))} />);
      expect(note()).toContain(' いま出ているサインはありません。');
      expect(note()).not.toContain('損切りの行');
      cleanup();
    }
  });

  it('follows every other sentence with the stop clause: counted signs, a caution, an unknown check, the checks not judged', () => {
    const cases = [
      [[check('day-down', 'clear'), check('ma50', 'hit'), check('failedBreakout', 'hit'), check('book', 'clear')], ' 2件のサインが出ています。'],
      [[check('day-down', 'clear'), check('ma50', 'caution'), check('failedBreakout', 'clear'), check('book', 'clear')], ' 50日線の下にあります（大商いの割れは未確認）。'],
      [[check('day-down', 'clear'), check('ma50', 'clear'), check('failedBreakout', 'clear'), check('book', 'unknown')], ' 出ているサインはありませんが、未確認の項目があります。'],
      [[check('day-down', 'na'), check('ma50', 'clear'), check('failedBreakout', 'clear'), check('book', 'clear')], ' 判定なしの項目 1件。'],
    ];
    for (const [weakness, sentence] of cases) for (const [state, clause] of [['hit', '損切りの行：仮の損切りに到達しています（サインの件数には含めていません）。'], ['unknown', '損切りの行は未確認です。']]) {
      render(<SellCard sells={sellsOf(weakness, stopOf(state))} />);
      expect(note()).toContain(`${sentence}${clause}`);
      cleanup();
    }
  });

  it('prints 該当 in bold --neg ink on one line, never ▲, outside the fold on a phone', () => {
    render(<SellCard sells={sellsOf(clear(), stopOf('hit'))} />);
    expect(row()).toHaveAttribute('data-state', 'hit');
    expect(row()).toHaveTextContent(`${STOP_ROW_LABEL} 該当`);
    const word = row().querySelector('.brief-stop-state');
    expect(word).toHaveClass('is-hit');
    expect(word.textContent).toBe('該当');
    expect(row().textContent).not.toContain('▲');
    expect(row()).toHaveTextContent('仮の損切り $93.00（ピボットの −7.0%・独自設定）・9/1 の上抜けの後の最安値 $92.00（9/3）');
    expect(folded(row())).toBe(false);
    // Not one of the signs: no sign glyph class, and the counted rows are the two sides' only.
    expect(row().querySelector('.is-sell-hit')).toBeNull();
    cleanup();
    render(<SellCard sells={sellsOf(clear(), stopOf('unknown'))} />);
    expect(folded(row())).toBe(false);
    expect(row()).toHaveTextContent(`${STOP_ROW_LABEL} 未確認（9/1 の上抜けの後の安値が欠けています）`);
  });

  it('folds a quiet row as the fold\'s first line, with its own summary segment, even when it is the only quiet line', () => {
    render(<SellCard sells={sellsOf(clear(), stopOf('na'))} />);
    const summary = screen.getByTestId('brief-sell').querySelector('summary');
    expect(summary).toHaveTextContent('サインなし 8件／損切り判定なし');
    expect(folded(row())).toBe(true);
    expect(row().closest('details').querySelector('ul')).toBe(row());
    expect(row()).toHaveTextContent(`${STOP_ROW_LABEL} 判定なし（直近60営業日に上抜けの日付なし）`);
    cleanup();
    // Every check loud: the fold holds the stop row alone and its summary is the segment alone.
    const loud = ['day-down', 'ma50', 'failedBreakout', 'book'].map(key => check(key, 'unknown'));
    render(<SellCard sells={sellsOf(loud, stopOf('clear'), ['day-up', 'week-up', 'up-days', 'climax'].map(key => check(key, 'hit')))} />);
    expect(screen.getByTestId('brief-sell').querySelector('summary')).toHaveTextContent(/^損切り該当なし$/);
    expect(folded(row())).toBe(true);
  });

  it('keeps the row in place at 1024px and wider, whatever its state, and says 未確認 when the bars cannot be judged', () => {
    for (const state of ['hit', 'clear', 'na', 'unknown']) {
      render(<SellCard sells={sellsOf(clear(), stopOf(state))} wide />);
      expect(folded(row())).toBe(false);
      expect(row()).toHaveAttribute('data-state', state);
      cleanup();
    }
    for (const wide of [false, true]) {
      render(<SellCard sells={null} reason="最終日足が分析日と不一致" wide={wide} />);
      expect(row()).toHaveAttribute('data-state', 'unknown');
      expect(row()).toHaveTextContent(`${STOP_ROW_LABEL} 未確認`);
      expect(row()).not.toHaveTextContent('該当なし');
      cleanup();
    }
  });

  it('judges at ピボットの −7.0% whatever the plan\'s stop, and names the plan\'s stop beside it when the two read differently (D8)', () => {
    // A stock that broke out of 100, fell back under it and traded at 92.00 (the level is 93.00): 該当 in every plan below.
    const closes = [...Array.from({ length: 199 }, (_, i) => 50 * 1.003 ** i), 99, 101, 99, 98];
    const bars = closes.map((close, i) => ({ date: i === closes.length - 1 ? DATE : day(i), open: close, high: close * 1.005, low: close * 0.995, close, volume: 10000 }));
    bars[201].low = 92;
    const v = { ...view, state: 'wait', pivot: 100, price: 98, distance: -2, symbol: 'AAA' };
    const sells = stockSells({ judged: bars, diagnostics: null, view: v });
    expect(sells.stop).toEqual(stopReachedCheck(bars, v));
    const plans = [
      ['default', positionPlan(v, {}), null],
      ['stopPercent 5', positionPlan(v, { stopPercent: 5 }), '計画の損切り $95.00（設定 −5.0%）'],
      ['structural', { ...positionPlan(v, {}), stop: 94.25, stopPercent: 5.75, stopSource: 'structural' }, '計画の損切り $94.25（構造 −5.8%）'],
      ['blocked', { blocked: '買いゾーン超過：新規の試算はしません（次の土台を待つ）' }, null],
    ];
    for (const [name, plan, own] of plans) {
      render(<SellCard sells={sells} plan={plan} />);
      expect({ name, state: row().getAttribute('data-state') }).toEqual({ name, state: 'hit' });
      const text = row().querySelector('em').textContent;
      expect({ name, text }).toEqual({ name, text: expect.stringContaining('仮の損切り $93.00（ピボットの −7.0%・独自設定）') });
      if (own) expect({ name, text }).toEqual({ name, text: expect.stringContaining(`仮の損切り $93.00（ピボットの −7.0%・独自設定）／${own}・`) });
      else expect({ name, text }).toEqual({ name, text: expect.not.stringContaining('計画の損切り') });
      cleanup();
    }
    // A four-digit pivot whose plan stop prints one cent apart from the level: both, each under its own name.
    const big = { ...v, pivot: 1234.56, price: 1200 };
    const level = { ...sells.stop, state: 'clear', cause: 'judged', level: 1148.14,
      parts: ['仮の損切り $1,148.14（ピボットの −7.0%・独自設定）', '9/30 の上抜けの後の最安値 $1,180.00（10/1）'] };
    render(<SellCard sells={{ ...sells, stop: level }} plan={{ ...positionPlan(big, {}), stop: 1148.1408 - 0.006 }} />);
    expect(row().querySelector('em').textContent).toContain('仮の損切り $1,148.14（ピボットの −7.0%・独自設定）／計画の損切り $1,148.13（設定 −7.0%）');
  });
});
