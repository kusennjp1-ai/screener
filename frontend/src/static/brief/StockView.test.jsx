import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import StockView from './StockView';
import { earningsCall } from './briefCandidate';

// The shell measures the contractions again when the published evidence is of an earlier method; the
// measurement itself is bookTechnicalEvidence.test.js's, so here it returns a known result.
const rebuilt = vi.hoisted(() => ({ vcp: null, calls: [] }));
vi.mock('../bookTechnicalEvidence', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, buildBookTechnicalEvidence: (...args) => { rebuilt.calls.push(args); return { ...actual.buildBookTechnicalEvidence(...args), vcp: rebuilt.vcp }; } };
});

// The props StockView hands its cards (the round-2 seams, plan §2.2): each card renders as it is, and the last props are kept.
const { seen, recorded } = vi.hoisted(() => {
  const seen = {};
  const recorded = name => async importOriginal => {
    const actual = await importOriginal(), { createElement } = await import('react');
    return { ...actual, default: props => { seen[name] = props; return createElement(actual.default, props); } };
  };
  return { seen, recorded };
});
vi.mock('./StockChartCard', recorded('chart'));
vi.mock('./StockPlanCard', recorded('plan'));
vi.mock('./StockVerdict', recorded('verdict'));

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

describe('brief stock view shell', () => {
  afterEach(() => sessionStorage.clear());

  it('judges the RS line new high from certified bars only, not the backend flag', () => {
    // The backend says new high, but no RS line was delivered: the conclusion has no RS-line chip.
    render(<StockView data={{ ...data(true), view: { ...view, rsLineHigh: true } }} />);
    expect(screen.queryByText(/^RS線 新高値/)).toBeNull();
    expect(screen.getByTestId('brief-price-chart').querySelector('.bc-rscaption')).toHaveTextContent('RS線 未配信');
  });

  it('gathers the chart footnotes into the 注記 on a phone and shows them on the chart card on a desktop', () => {
    render(<StockView data={data(true)} />);
    const notes = document.querySelector('.brief-screen-notes');
    expect(notes).toHaveTextContent('—＝必要な本数に足りない値');
    // The 10-day and 21-day lines are drawn at 1024px and wider only.
    expect(notes).not.toHaveTextContent('10日線・21日EMA');
    // 200 bars: the 200-day line exists on its last bar only.
    expect(notes).toHaveTextContent('200日線は直近1本のみ（日足が足りないため）。');
    cleanup();
    render(<StockView data={data(true)} wide />);
    expect(document.querySelector('.brief-screen-notes')).toBeNull();
    expect(document.querySelector('.brief-chart-notes')).toHaveTextContent('10日線・21日EMAは独自計算です。');
  });
});

describe('brief stock view evidence', () => {
  const vcpLeg = (startDate, endDate, depthPct, high) => ({ startDate, endDate, depthPct, high, low: high * (1 - depthPct / 100), bars: 10, validPeak: true, lowAfterPeak: true, volumeEvidence: { intervalRatio: 0.8 } });
  const current = { vcp: { source: 'algorithm', legs: [vcpLeg('2025-06-01', '2025-06-20', 9, 80), vcpLeg('2025-06-25', '2025-07-10', 4, 80)], measurementsValid: true, depthsContract: true, base: { startDate: '2025-06-01' } } };
  const v1 = { version: 'book-technical-evidence-v1', as_of_date: DATE, vcp: { legs: Array.from({ length: 6 }, (_, i) => vcpLeg(day(150 + i * 8), day(154 + i * 8), 4 - i * 0.3, 90)), measurementsValid: true, depthsContract: false } };
  const withDetail = (technical, detail, certified = true) => ({ ...data(certified), technical, row: { symbol: 'AAA', chart_path: 'AAA.json', research_detail_path: 'detail/AAA.json' }, detail });
  afterEach(() => { sessionStorage.clear(); rebuilt.vcp = null; rebuilt.calls = []; });

  it('never draws the legs of an earlier method: it measures them again on the certified bars', async () => {
    const { BOOK_TECHNICAL_VERSION } = await import('../bookTechnicalEvidence');
    rebuilt.vcp = current.vcp;
    render(<StockView data={withDetail(v1, { data: { value: {} }, isError: false })} />);
    expect(rebuilt.calls).toHaveLength(1);
    expect(screen.getAllByText(/^VCP \d+週 9\/4 2T$/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('brief-price-chart').querySelectorAll('.bc-legbox')).toHaveLength(2);
    expect(screen.queryByText(/6T/)).toBeNull();
    cleanup();
    // Evidence of the current method is used as published.
    render(<StockView data={withDetail({ ...current, version: BOOK_TECHNICAL_VERSION }, { data: { value: {} }, isError: false })} />);
    expect(rebuilt.calls).toHaveLength(1);
    expect(screen.getAllByText(/^VCP \d+週 9\/4 2T$/).length).toBeGreaterThan(0);
  });

  it('keeps the VCP unknown while the research detail loads and on uncertified bars', async () => {
    const { BOOK_TECHNICAL_VERSION } = await import('../bookTechnicalEvidence');
    render(<StockView data={withDetail({ ...current, version: BOOK_TECHNICAL_VERSION }, { data: undefined, isError: false })} />);
    expect(screen.getByText('VCP 未確認（読み込み中）')).toBeInTheDocument();
    const chart = screen.getByTestId('brief-price-chart');
    expect(chart.querySelectorAll('.bc-legbox')).toHaveLength(0);
    // Loading is not a measured absence: the chart does not say 収縮は未確認 yet.
    expect(chart.querySelector('.bc-notice')?.textContent ?? '').not.toContain('収縮は未確認');
    expect(rebuilt.calls).toHaveLength(0);
    cleanup();
    render(<StockView data={withDetail({ ...current, version: BOOK_TECHNICAL_VERSION }, { data: { value: {} }, isError: false }, false)} />);
    expect(screen.getByText('日足を分析基準日で検証できないため（最終日足が分析日と不一致）、VCPは未確認です。')).toBeInTheDocument();
    expect(screen.getByTestId('brief-price-chart').querySelectorAll('.bc-legbox')).toHaveLength(0);
    expect([...screen.getByTestId('brief-price-chart').querySelectorAll('.bc-notice')].map(node => node.textContent)).toContain('収縮は未確認');
  });
});

describe('the props StockView hands its cards in round 2', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); sessionStorage.clear(); });

  it('computes the earnings call once and passes it to the chart card, the plan card and the conclusion (unread at step 0)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${DATE}T19:00:00Z`));
    const near = { ...view, asOf: DATE, earnings: { date: '2026-10-05', days: 3 } };
    render(<StockView data={{ ...data(true), view: near }} />);
    const call = earningsCall(near, Date.now());
    expect(call).toMatchObject({ date: '2026-10-05', days: 3, soon: true });
    expect(seen.chart.earningsCall).toEqual(call);
    expect(seen.plan.earningsCall).toEqual(call);
    expect(seen.verdict.earningsCall).toEqual(call);
    cleanup();
    render(<StockView data={data(true)} />);
    expect([seen.chart.earningsCall, seen.plan.earningsCall, seen.verdict.earningsCall]).toEqual([null, null, null]);
  });

  it('hands the conclusion a stage without a phase while stagePhase names none', () => {
    render(<StockView data={{ ...data(true), row: { symbol: 'AAA', chart_path: 'AAA.json', stage: 2 } }} />);
    expect(seen.verdict.stage).toEqual({ value: 2, computed: false });
    expect('phase' in seen.verdict.stage).toBe(false);
    cleanup();
    // 200 bars are too few for the stage from bars: no stage, and no phase either.
    render(<StockView data={data(true)} />);
    expect(seen.verdict.stage).toBeNull();
  });
});
