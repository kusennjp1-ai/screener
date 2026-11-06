import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import StockView from './StockView';
import { AUDIT_VERSION } from '../qualificationAudit';
import { lastPivotCrossing } from './breakoutHistory';

// The crossing helper is verdict's (VD1/VD2 write its round-2 body): the chart's tests mock it (plan §2.2), keeping
// the rest of the module (the conclusion's crossingEvent) as it is.
vi.mock('./breakoutHistory', async importOriginal => ({ ...await importOriginal(), lastPivotCrossing: vi.fn(() => null) }));

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
afterEach(() => { cleanup(); sessionStorage.clear(); vi.useRealTimers(); lastPivotCrossing.mockReset(); lastPivotCrossing.mockReturnValue(null); });

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
  it('names the weekly period without a count when there are no bars: never 「0週」', () => {
    for (const chart of [{ data: null, isError: false }, { data: null, isError: true }]) {
      render(<StockView data={{ ...data(true), row: { symbol: 'AAA', chart_path: null }, bars: null, certification: null, chart }} />);
      const weekly = within(screen.getByRole('group', { name: '表示期間' })).getByRole('button', { name: '週足（本数 未確認）' });
      expect(weekly).toHaveTextContent(/^週足$/);
      expect(screen.getByRole('group', { name: '表示期間' })).not.toHaveTextContent(/0週/);
      cleanup();
    }
  });

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

  it('prints the volume ratio floored as the chips, the events and the sell card do: 1.396 reads 1.39×', () => {
    const quiet = data(true);
    quiet.bars = quiet.bars.map((bar, i, all) => (i === all.length - 1 ? { ...bar, volume: 13960 } : bar));
    render(<StockView data={quiet} />);
    const readout = screen.getByRole('group', { name: '最新の足の値' });
    expect(readout).toHaveTextContent('1.39×');
    expect(readout).not.toHaveTextContent('1.40×');
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

  it('draws the 52-week high and reads the distance from it only from an audit of the analysis date', () => {
    const list = bars(), close = list.at(-1).close;
    const audit = asOf => ({ version: AUDIT_VERSION, symbol: 'AAA', as_of_date: asOf, valid: true, status: 'verified', errors: [], values: { close, high: close * 1.03 } });
    const audited = asOf => ({ ...data(true), view: { ...view, pivot: close * 0.99, upper: close * 1.04 }, row: { symbol: 'AAA', chart_path: 'AAA.json', current_price: close, technical_audit: audit(asOf) } });
    render(<StockView data={audited(DATE)} />);
    expect(screen.getByTestId('brief-price-chart').querySelector('.bc-high52')).not.toBeNull();
    // On screen 「高値から」 (52週 for screen readers and in the title), so the line fits a phone.
    expect(screen.getByRole('group', { name: '最新の足の値' })).toHaveTextContent('52週高値から−2.9%');
    expect(screen.getByTitle('52週高値から')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '最新の足の値' })).toHaveTextContent('対ピボット+1.0%');
    cleanup();
    // An older audit is never today's 52-week high.
    render(<StockView data={audited('2026-10-01')} />);
    expect(screen.getByTestId('brief-price-chart').querySelector('.bc-high52')).toBeNull();
    expect(screen.getByRole('group', { name: '最新の足の値' })).not.toHaveTextContent('52週高値');
  });

  it('names the contraction marks only when they are drawn, shortly on a phone, with ▼▲ explained in the 注記', () => {
    const legsOf = high => [{ startDate: day(150), endDate: day(160), depthPct: 9, high, low: high * 0.91, bars: 11, validPeak: true, lowAfterPeak: true, volumeEvidence: { intervalRatio: 0.8 } },
      { startDate: day(170), endDate: day(180), depthPct: 4, high, low: high * 0.96, bars: 11, validPeak: true, lowAfterPeak: true, volumeEvidence: { intervalRatio: 0.7 } }];
    const legend = () => document.querySelector('.brief-legend').textContent;
    render(<StockView data={data(true)} />);
    expect(legend()).not.toContain('収縮');
    cleanup();
    const measured = { ...data(true), technical: { version: 'book-technical-evidence-v2', vcp: { source: 'algorithm', legs: legsOf(bars()[150].high), measurementsValid: true, depthsContract: true } } };
    render(<StockView data={measured} />);
    expect(legend()).toContain('収縮の安値');
    expect(legend()).toContain('枠＝収縮');
    cleanup();
    render(<StockView data={measured} wide />);
    expect(legend()).toContain('枠＝値幅の収縮');
  });

  it('keeps the 10-day and 21-day lines and their values to 1024px and wider, and prices from 1,000 without decimals below it', () => {
    render(<StockView data={data(true)} />);
    expect(screen.getByTestId('brief-price-chart').querySelector('.bc-ma10, .bc-ema21')).toBeNull();
    expect(screen.getByRole('group', { name: '最新の足の値' })).not.toHaveTextContent(/10日|21日/);
    cleanup();
    render(<StockView data={data(true)} wide />);
    expect(screen.getByTestId('brief-price-chart').querySelectorAll('.bc-ma10, .bc-ema21')).toHaveLength(2);
    expect(screen.getByRole('group', { name: '最新の足の値' })).not.toHaveTextContent(/10日|21日/);
    cleanup();
    const scaled = bars().map(b => ({ ...b, open: b.open * 20, high: b.high * 20, low: b.low * 20, close: b.close * 20 }));
    render(<StockView data={{ ...data(true), bars: scaled }} />);
    const close = scaled.at(-1).close;
    expect(screen.getByRole('group', { name: '最新の足の値' })).toHaveTextContent(`終${Math.round(close).toLocaleString('en-US')}`);
    cleanup();
    render(<StockView data={{ ...data(true), bars: scaled }} wide />);
    expect(screen.getByRole('group', { name: '最新の足の値' })).toHaveTextContent(`終${close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  });

  it('draws the 10-day and 21-day lines on the phone 3か月 only, without their values in the readout', () => {
    render(<StockView data={data(true)} />);
    fireEvent.click(within(screen.getByRole('group', { name: '表示期間' })).getByRole('button', { name: '3か月' }));
    expect(screen.getByTestId('brief-price-chart').querySelectorAll('.bc-ma10, .bc-ema21')).toHaveLength(2);
    expect(screen.getByRole('group', { name: '最新の足の値' })).not.toHaveTextContent(/10日|21日/);
    fireEvent.click(within(screen.getByRole('group', { name: '表示期間' })).getByRole('button', { name: '1年' }));
    expect(screen.getByTestId('brief-price-chart').querySelectorAll('.bc-ma10, .bc-ema21')).toHaveLength(0);
  });

  it('counts the earnings days from the screen one call and redraws when the New York date changes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${DATE}T19:00:00Z`));
    const near = { ...data(true), view: { ...view, asOf: DATE, earnings: { date: '2026-10-05', days: 3 } } };
    const { rerender } = render(<StockView data={near} />);
    const chart = () => screen.getByTestId('brief-price-chart');
    expect(chart().getAttribute('aria-label')).toContain('決算 10/5 あと3日');
    // The next New York day, same data: the call counts 2 days and the chart redraws (its content key holds the date).
    vi.setSystemTime(new Date('2026-10-03T16:00:00Z'));
    rerender(<StockView data={near} />);
    expect(chart().getAttribute('aria-label')).toContain('決算 10/5 あと2日');
    vi.setSystemTime(new Date('2026-10-05T16:00:00Z'));
    rerender(<StockView data={near} />);
    expect(chart().getAttribute('aria-label')).toContain('決算 10/5 当日');
    vi.setSystemTime(new Date('2026-10-06T16:00:00Z'));
    rerender(<StockView data={near} />);
    expect(chart().getAttribute('aria-label')).toContain('決算 10/5 経過');
    expect(chart().getAttribute('aria-label')).not.toContain('あと');
  });

  it('marks the pivot crossing only on certified bars, and names it in the legend only when drawn', () => {
    const list = bars();
    lastPivotCrossing.mockImplementation(judged => ({ index: judged.length - 3, date: judged.at(-3).date, sessionsAgo: 2, volumeRatio: 1.62 }));
    const crossed = certified => ({ ...data(certified), bars: list, view: { ...view, pivot: list.at(-3).close * 0.99 } });
    render(<StockView data={crossed(true)} />);
    const mark = screen.getByTestId('brief-price-chart').querySelector('.bc-breakout');
    expect(mark?.dataset.date).toBe(list.at(-3).date);
    expect(document.querySelector('.brief-legend [data-key="breakout"]')).toHaveTextContent('▲上抜け');
    cleanup();
    lastPivotCrossing.mockClear();
    render(<StockView data={crossed(false)} />);
    expect(screen.getByTestId('brief-price-chart').querySelector('.bc-breakout')).toBeNull();
    expect(document.querySelector('.brief-legend [data-key="breakout"]')).toBeNull();
    // On bars not certified the helper is never asked by the chart.
    expect(lastPivotCrossing.mock.calls.every(([judged]) => judged === null || judged === undefined)).toBe(true);
  });

  it('starts the readout with 未検証の足 on uncertified bars and qualifies the change and the ratio; ADR reads — there', () => {
    render(<StockView data={data(false)} />);
    const readout = screen.getByRole('group', { name: '最新の足の値' });
    const chip = readout.querySelector('.ro-unverified');
    expect(chip).toHaveTextContent(/^未検証の足/);
    expect(chip.getAttribute('title')).toContain('最終日足が分析日と不一致');
    expect(readout.querySelector('.ro-change')).toHaveTextContent(/^[+−±]\d+\.\d%（未検証）$/);
    expect(readout).toHaveTextContent(/\d\.\d{2}×（未検証）/);
    expect(readout.querySelector('.ro-adr')).toHaveTextContent('ADR —');
    cleanup();
    render(<StockView data={data(true)} />);
    const certified = screen.getByRole('group', { name: '最新の足の値' });
    expect(certified.querySelector('.ro-unverified')).toBeNull();
    expect(certified).not.toHaveTextContent('未検証');
    expect(certified.querySelector('.ro-adr')).toHaveTextContent(/^ADR \d+\.\d%$/);
    // The 50-day distance is the desktop's.
    expect(certified.querySelector('.ro-dist')).toBeNull();
    cleanup();
    render(<StockView data={data(true)} wide />);
    expect(screen.getByRole('group', { name: '最新の足の値' }).querySelector('.ro-ma50')).toHaveTextContent(/^50日 [\d,.]+（[+−±]\d+\.\d%）$/);
  });

  it('names the RS line in the legend with what it is, only when the RS line is drawn', () => {
    const withLine = { ...data(true), chart: { data: { rs_line: bars().map((b, i) => ({ time: b.date, value: 1 + i / 1000 })) }, isError: false } };
    render(<StockView data={withLine} />);
    expect(document.querySelector('.brief-legend [data-key="rs"]')).toHaveTextContent('株価÷S&P 500・RS推計やIBD RSとは別');
    expect(screen.getByTestId('brief-price-chart').querySelector('.bc-rscaption')).toHaveTextContent(/^RS線$/);
    cleanup();
    render(<StockView data={withLine} wide />);
    expect(document.querySelector('.brief-legend [data-key="rs"]')).toHaveTextContent('RS線＝株価÷S&P 500・RS推計やIBD RSとは別');
    cleanup();
    render(<StockView data={data(true)} />);
    expect(document.querySelector('.brief-legend [data-key="rs"]')).toBeNull();
  });

  it('names a week by its first session on screen and spells out its sessions for screen readers', () => {
    render(<StockView data={data(true)} />);
    fireEvent.click(within(screen.getByRole('group', { name: '表示期間' })).getByRole('button', { name: /^週足/ }));
    const readout = screen.getByRole('group', { name: /^最新の足（\d\d\/\d\d〜\d\d\/\d\dの週）の値$/ });
    expect(readout.querySelector('.ro-date').textContent).toMatch(/^\d\d\/\d\d週$/);
  });
});
