import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import VcpCard, { PIVOT_DAY_UNKNOWN, QUIET_DAYS_TITLE, QUIET_DAYS_WINDOW, WEEKLY_PATTERN, pivotDayNote, quietDaysText } from './StockVcpCard';
import { mergeFinancialDetail } from '../financialCurrent';
import { shortDate } from './briefShared';

const DATE = '2026-10-02';
const leg = (startDate, endDate, depthPct, bars, intervalRatio) => ({ startDate, endDate, depthPct, bars, high: 100, low: 100 - depthPct, volumeEvidence: { intervalRatio } });
const technical = (legs, extra = {}) => ({ vcp: { legs, measurementsValid: true, depthsContract: true, base: { startDate: legs[0]?.startDate }, ...extra } });
const legs = [leg('2026-06-23', '2026-07-31', 13.1, 28, 0.9), leg('2026-09-17', '2026-10-01', 4.2, 11, null)];
const daily = Array.from({ length: 140 }, (_, i) => new Date(Date.UTC(2026, 3, 1) + i * 86400000)).filter(d => d.getUTCDay() % 6).map(d => ({ date: d.toISOString().slice(0, 10), open: 1, high: 1, low: 1, close: 1, volume: 1 }));
const bars = [...daily.filter(b => b.date <= DATE), { date: DATE, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
afterEach(cleanup);

describe('brief VCP card', () => {
  it('lists each contraction with its T number, depth, length and volume ratio, 出来高 未確認 when unknown', () => {
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{ pivot: 110 }} />);
    expect(screen.getByText('VCP 14週 13/4 2T')).toBeInTheDocument();
    expect(screen.getByText(/最大の押し 13% → 最後の押し 4%・収縮 2回.*独自近似です。各収縮を押すとチャートで強調します。/)).toBeInTheDocument();
    const group = screen.getByRole('group', { name: /収縮ごと/ });
    const [first, second] = within(group).getAllByRole('button');
    expect(first).toHaveTextContent('T1−13%28日0.90×');
    expect(second).toHaveTextContent('T2−4%11日未確認');
    expect(second).toHaveAccessibleName('T2：深さ 4.2%、長さ 11日、出来高 未確認。押すとチャートで強調');
  });

  it('counts weeks on the weekly chart', () => {
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} interval="week" />);
    const [first] = within(screen.getByRole('group', { name: /収縮ごと/ })).getAllByRole('button');
    expect(first).toHaveTextContent(/T1−13%\d+週0\.90×/);
  });

  it('emphasises the pressed contraction on the chart and clears it on a second press', () => {
    const highlightLeg = vi.fn(), chartRef = { current: { highlightLeg } };
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} chartRef={chartRef} />);
    const [, second] = within(screen.getByRole('group', { name: /収縮ごと/ })).getAllByRole('button');
    fireEvent.click(second);
    expect(highlightLeg).toHaveBeenLastCalledWith(1);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(second);
    expect(highlightLeg).toHaveBeenLastCalledWith(null);
    expect(second).toHaveAttribute('aria-pressed', 'false');
  });

  it('reads VCP 未確認 when nothing is measurable', () => {
    render(<VcpCard technical={technical(legs.slice(0, 1))} bars={bars} judged={null} view={{}} />);
    expect(screen.getByText('VCP 未確認')).toBeInTheDocument();
    expect(screen.getByText('測定できる収縮が2回以上ないため、VCPは未確認です。')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /収縮ごと/ })).toBeNull();
  });

  it('says the VCP is unknown while the detail loads and why on uncertified bars, never drawing the legs', () => {
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} pending />);
    expect(screen.getByText('VCP 未確認（読み込み中）')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /収縮ごと/ })).toBeNull();
    cleanup();
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} uncertified={{ reason: '最終日足が分析日と不一致' }} />);
    expect(screen.getByText('日足を分析基準日で検証できないため（最終日足が分析日と不一致）、VCPは未確認です。')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /収縮ごと/ })).toBeNull();
    const dry = screen.getByText('最後の収縮の出来高').nextSibling;
    expect(dry).toHaveTextContent('未確認');
  });

  it('says when the base has been broken out of', () => {
    render(<VcpCard technical={technical(legs, { base: { startDate: legs[0].startDate, endDate: '2026-09-25', brokeOut: true, breakoutDate: '2026-09-28' } })} bars={bars} judged={null} view={{}} />);
    expect(screen.getByText('VCP 13週 13/4 2T・土台の高値を上抜け（9/28）')).toBeInTheDocument();
    expect(screen.getByText(/9\/28に土台の高値を上抜けています。/)).toBeInTheDocument();
  });

  it('shows the Setup Engine base beside the result only when it is current, and says when they differ', () => {
    const row = weeks => ({ setup_recalculation: { status: 'calculated', as_of_date: DATE }, se_base_length_weeks: weeks, se_base_depth_pct: 12.6 });
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} row={row(14.2)} date={DATE} />);
    expect(screen.getByText('Setup Engine：土台 14週・深さ 13%')).toBeInTheDocument();
    cleanup();
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} row={row(30)} date={DATE} />);
    expect(screen.getByText('Setup Engine：土台 30週・深さ 13%（独自近似と異なります）')).toBeInTheDocument();
    cleanup();
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} row={{ ...row(14), setup_recalculation: { status: 'calculated', as_of_date: '2026-09-30' } }} date={DATE} />);
    expect(screen.queryByText(/^Setup Engine：/)).toBeNull();
  });
});

// Round 3 C4: the Setup Engine pivot's own bar (pivotBar, H1) and the Setup Engine's quiet days, on the VCP card.
describe('the Setup Engine pivot day and quiet days', () => {
  // The weekdays from 2026-06-01 to the analysis day (Friday 2026-10-02), highs of 10, except the bars a case gives its own high.
  const weekdays = Array.from({ length: 124 }, (_, i) => new Date(Date.UTC(2026, 5, 1) + i * 86400000)).filter(d => d.getUTCDay() % 6).map(d => d.toISOString().slice(0, 10));
  const withHighs = highs => weekdays.map(date => ({ date, open: 9, low: 9, close: 9.5, volume: 1, high: highs[date] ?? 10 }));
  const current = { setup_recalculation: { status: 'calculated', as_of_date: DATE } };
  // A weekly pattern: se_pivot_date is the pivot week's Friday label (09-25); the bar whose high is the pivot is that week's Tuesday.
  const weeklyRow = { ...current, se_pattern_primary: 'cup_with_handle', se_pivot_date: '2026-09-25', se_pivot_price: 89.88 };
  const weeklyBarsList = withHighs({ '2026-09-22': 89.88, '2026-09-25': 88.1 });
  // A daily pattern: the bar dated se_pivot_date (the day before the analysis day) is the pivot's bar.
  const dailyRow = { ...current, se_pattern_primary: 'nr7_inside_day', se_pivot_date: '2026-10-01', se_pivot_price: 62.4 };
  const dailyBarsList = withHighs({ '2026-10-01': 62.4 });

  it('dates a weekly pattern by the bar whose high is the pivot (the Tuesday), never by the Friday label, with 「（週足の型）」', () => {
    expect(pivotDayNote({ view: { pivot: 89.88 }, row: weeklyRow, judged: weeklyBarsList, date: DATE })).toBe(`ピボット $89.88＝9/22の高値（SE）${WEEKLY_PATTERN}`);
    expect(WEEKLY_PATTERN).toBe('（週足の型）');
  });

  it('dates a daily pattern by the bar dated se_pivot_date, without the weekly suffix', () => {
    expect(pivotDayNote({ view: { pivot: 62.4 }, row: dailyRow, judged: dailyBarsList, date: DATE })).toBe('ピボット $62.40＝10/1の高値（SE）');
  });

  it('matches a float-noise pivot in whole cents', () => {
    const noisy = { ...weeklyRow, se_pivot_price: 89.88000000000001 };
    const clean = pivotDayNote({ view: { pivot: 89.88 }, row: weeklyRow, judged: weeklyBarsList, date: DATE });
    expect(clean).not.toBe(PIVOT_DAY_UNKNOWN);
    expect(pivotDayNote({ view: { pivot: 89.88000000000001 }, row: noisy, judged: weeklyBarsList, date: DATE })).toBe(clean);
    expect(pivotDayNote({ view: { pivot: 89.88 }, row: noisy, judged: weeklyBarsList, date: DATE })).toBe(clean);
  });

  it('gives the year when the pivot bar is in another year than the analysis day', () => {
    const day = '2027-01-08', bars = [...weeklyBarsList, ...['2026-12-29', '2026-12-30', '2027-01-04', '2027-01-08'].map(date => ({ date, open: 9, low: 9, close: 9.5, volume: 1, high: date === '2026-12-29' ? 70.25 : 10 }))];
    const row = { setup_recalculation: { status: 'calculated', as_of_date: day }, se_pattern_primary: 'first_pullback', se_pivot_date: '2026-12-29', se_pivot_price: 70.25 };
    const note = pivotDayNote({ view: { pivot: 70.25 }, row, judged: bars, date: day });
    expect(note).toContain(shortDate('2026-12-29', day));
    expect(shortDate('2026-12-29', day)).toContain('2026');
  });

  it('says 「ピボットの日 未確認」 when no bar can be named: no se_pivot_date (a VCP primary), no high in cents, bars not certified, an unnamed pattern', () => {
    const view = { pivot: 89.88 };
    expect(PIVOT_DAY_UNKNOWN).toBe('ピボットの日 未確認');
    const vcp = { ...current, se_pattern_primary: 'vcp', se_pivot_price: 89.88 };
    expect(pivotDayNote({ view, row: vcp, judged: weeklyBarsList, date: DATE })).toBe(PIVOT_DAY_UNKNOWN);
    // The week's highest bar is 89.87: one cent short of the pivot, so no bar is the pivot's.
    expect(pivotDayNote({ view, row: weeklyRow, judged: withHighs({ '2026-09-22': 89.87 }), date: DATE })).toBe(PIVOT_DAY_UNKNOWN);
    expect(pivotDayNote({ view, row: weeklyRow, judged: null, date: DATE })).toBe(PIVOT_DAY_UNKNOWN);
    expect(pivotDayNote({ view, row: { ...weeklyRow, se_pattern_primary: 'double_bottom' }, judged: weeklyBarsList, date: DATE })).toBe(PIVOT_DAY_UNKNOWN);
    expect(pivotDayNote({ view, row: { ...weeklyRow, se_pattern_primary: null }, judged: weeklyBarsList, date: DATE })).toBe(PIVOT_DAY_UNKNOWN);
    // The Friday label itself is never printed as the bar.
    for (const judged of [weeklyBarsList, null]) expect(pivotDayNote({ view, row: { ...weeklyRow, se_pivot_price: 88.1 }, judged, date: DATE })).toBeNull();
  });

  it('shows no line when the screen pivot is not the current Setup Engine pivot', () => {
    // A vcp_pivot fallback (no se_pivot_price), another price, no pivot at all.
    expect(pivotDayNote({ view: { pivot: 89.88 }, row: { ...current, se_pattern_primary: 'cup_with_handle', se_pivot_date: '2026-09-25', vcp_pivot: 89.88 }, judged: weeklyBarsList, date: DATE })).toBeNull();
    expect(pivotDayNote({ view: { pivot: 89.87 }, row: weeklyRow, judged: weeklyBarsList, date: DATE })).toBeNull();
    expect(pivotDayNote({ view: { pivot: null }, row: weeklyRow, judged: weeklyBarsList, date: DATE })).toBeNull();
    expect(pivotDayNote({ view: null, row: weeklyRow, judged: weeklyBarsList, date: DATE })).toBeNull();
    // A recalculation of another day, one that did not calculate, none, or no analysis date.
    expect(pivotDayNote({ view: { pivot: 89.88 }, row: { ...weeklyRow, setup_recalculation: { status: 'calculated', as_of_date: '2026-10-01' } }, judged: weeklyBarsList, date: DATE })).toBeNull();
    expect(pivotDayNote({ view: { pivot: 89.88 }, row: { ...weeklyRow, setup_recalculation: { status: 'failed', as_of_date: DATE } }, judged: weeklyBarsList, date: DATE })).toBeNull();
    expect(pivotDayNote({ view: { pivot: 89.88 }, row: { ...weeklyRow, setup_recalculation: undefined }, judged: weeklyBarsList, date: DATE })).toBeNull();
    expect(pivotDayNote({ view: { pivot: 89.88 }, row: weeklyRow, judged: weeklyBarsList, date: null })).toBeNull();
    expect(pivotDayNote({ view: { pivot: 89.88 }, row: null, judged: weeklyBarsList, date: DATE })).toBeNull();
  });

  it('counts the quiet days in the Setup Engine\'s own 10-day window: a real 0 is shown, a missing or invalid value is not', () => {
    expect(QUIET_DAYS_WINDOW).toBe(10);
    expect(quietDaysText({ ...current, se_quiet_days_10d: 2 }, DATE)).toBe('静かな日 2/10日（SE）');
    // A real 0 and the full window are shown with their own count (the form is pinned by the 2 above).
    for (const days of [0, 10]) expect(quietDaysText({ ...current, se_quiet_days_10d: days }, DATE)).toBe(quietDaysText({ ...current, se_quiet_days_10d: 2 }, DATE).replace(' 2/', ` ${days}/`));
    const invalid = [undefined, null, 2.5, 11, -1, '2', NaN, Infinity];
    expect(invalid.map(value => quietDaysText({ ...current, se_quiet_days_10d: value }, DATE))).toEqual(invalid.map(() => null));
    expect(quietDaysText({ se_quiet_days_10d: 2 }, DATE)).toBeNull();
    expect(quietDaysText({ setup_recalculation: { status: 'calculated', as_of_date: '2026-10-01' }, se_quiet_days_10d: 2 }, DATE)).toBeNull();
    expect(quietDaysText({ setup_recalculation: { status: 'unavailable', as_of_date: DATE }, se_quiet_days_10d: 2 }, DATE)).toBeNull();
    expect(quietDaysText({ ...current, se_quiet_days_10d: 2 }, null)).toBeNull();
  });

  it('draws the pivot day as a note under the Setup Engine base and the quiet days beside the day\'s volume, with their definition', () => {
    const row = { ...weeklyRow, se_quiet_days_10d: 2, se_base_length_weeks: 14, se_base_depth_pct: 12.6 };
    const { container } = render(<VcpCard technical={technical(legs)} bars={weeklyBarsList} judged={weeklyBarsList} view={{ pivot: 89.88, volumeRatio: 1.2, pivotSource: 'カップ・ウィズ・ハンドル（SE信頼度60）' }} row={row} date={DATE} />);
    const note = container.querySelector('.brief-vcp-pivotday');
    expect(note).toHaveTextContent(pivotDayNote({ view: { pivot: 89.88 }, row, judged: weeklyBarsList, date: DATE }));
    // 「（週足の型）」 is its own span, so a wrap moves it whole.
    expect(note.querySelector('.brief-vcp-weekly')).toHaveTextContent(WEEKLY_PATTERN);
    expect(note.tagName).toBe('P');
    expect(note).toHaveClass('brief-note');
    // It follows the Setup Engine's base note.
    expect(note.previousElementSibling).toHaveTextContent(/^Setup Engine：/);
    const day = screen.getByText('当日の出来高').nextSibling;
    expect(day).toHaveTextContent(`1.20×上抜けの目安 1.40×以上${quietDaysText(row, DATE)}`);
    const quiet = within(day).getByText(quietDaysText(row, DATE));
    expect(quiet.tagName).toBe('SMALL');
    expect(quiet).toHaveAttribute('title', QUIET_DAYS_TITLE);
    // The other rows read as before.
    expect(screen.getByText('ピボット').nextSibling).toHaveTextContent('$89.88カップ・ウィズ・ハンドル（SE信頼度60）');
    expect(container.querySelectorAll('.brief-vcp-pivotday')).toHaveLength(1);
  });

  it('keeps the quiet days when the day\'s volume ratio is unknown, and shows neither line without the fields', () => {
    const row = { ...weeklyRow, se_quiet_days_10d: 0 };
    render(<VcpCard technical={technical(legs)} bars={weeklyBarsList} judged={null} view={{ pivot: 89.88 }} row={row} date={DATE} uncertified={{ reason: null }} />);
    expect(screen.getByText('当日の出来高').nextSibling).toHaveTextContent(`未確認${quietDaysText(row, DATE)}`);
    // Bars not certified: the pivot's bar cannot be named.
    expect(screen.getByText(PIVOT_DAY_UNKNOWN)).toHaveClass('brief-note');
    cleanup();
    // An older publication (neither key) on certified bars: 「ピボットの日 未確認」 and no quiet days.
    const older = { ...current, se_pattern_primary: 'cup_with_handle', se_pivot_price: 89.88 };
    const { container } = render(<VcpCard technical={technical(legs)} bars={weeklyBarsList} judged={weeklyBarsList} view={{ pivot: 89.88, volumeRatio: 1.2 }} row={older} date={DATE} />);
    expect(screen.getByText(PIVOT_DAY_UNKNOWN)).toBeInTheDocument();
    expect(screen.getByText('当日の出来高').nextSibling).toHaveTextContent(/^1\.20×上抜けの目安 1\.40×以上$/);
    expect(container.querySelector('.brief-vcp-quiet')).toBeNull();
  });

  it('shows no pivot day while the detail that carries its date is loading (loading, not 未確認)', () => {
    const { container } = render(<VcpCard technical={technical(legs)} bars={weeklyBarsList} judged={weeklyBarsList} view={{ pivot: 89.88 }} row={weeklyRow} date={DATE} pending />);
    expect(screen.getByText('VCP 未確認（読み込み中）')).toBeInTheDocument();
    expect(container.querySelector('.brief-vcp-pivotday')).toBeNull();
    expect(screen.queryByText(PIVOT_DAY_UNKNOWN)).toBeNull();
  });

  it('shows no pivot day line for a vcp_pivot fallback, a stale recalculation or another price, and the card is as before', () => {
    for (const [row, view] of [[{ ...current, vcp_pivot: 89.88 }, { pivot: 89.88 }], [{ ...weeklyRow, setup_recalculation: { status: 'calculated', as_of_date: '2026-09-30' } }, { pivot: 89.88 }], [weeklyRow, { pivot: 91 }]]) {
      const { container } = render(<VcpCard technical={technical(legs)} bars={weeklyBarsList} judged={weeklyBarsList} view={view} row={row} date={DATE} />);
      expect(container.querySelector('.brief-vcp-pivotday')).toBeNull();
      expect(container.querySelector('.brief-vcp-quiet')).toBeNull();
      cleanup();
    }
  });

  it('reaches the stock screen through the research detail: the merged row keeps se_pivot_date and se_quiet_days_10d', () => {
    // Neither key is in the list row (export-research.mjs listFields); the detail is the whole row and is merged under it.
    const summary = { symbol: 'ZZHB', as_of_date: DATE, market: 'US', se_pivot_price: 48.5, se_pattern_primary: 'cup_with_handle', setup_recalculation: { status: 'calculated', as_of_date: DATE } };
    const detail = { ...summary, se_pivot_date: '2026-09-25', se_quiet_days_10d: 2 };
    const merged = mergeFinancialDetail(summary, detail, { now: Date.parse(`${DATE}T22:00:00Z`), asOfDate: DATE });
    expect(merged.se_pivot_date).toBe('2026-09-25');
    expect(merged.se_quiet_days_10d).toBe(2);
    expect(merged.se_pivot_price).toBe(48.5);
    expect(quietDaysText(merged, DATE)).toBe(quietDaysText({ ...current, se_quiet_days_10d: 2 }, DATE));
    // Without a matching detail (another day's), the keys are absent: the card reads 未確認 and shows no quiet days.
    const unmatched = mergeFinancialDetail(summary, { ...detail, as_of_date: '2026-10-01' }, { now: Date.parse(`${DATE}T22:00:00Z`), asOfDate: DATE });
    expect(unmatched).not.toHaveProperty('se_pivot_date');
    expect(quietDaysText(unmatched, DATE)).toBeNull();
    expect(pivotDayNote({ view: { pivot: 48.5 }, row: unmatched, judged: withHighs({ '2026-09-22': 48.5 }), date: DATE })).toBe(PIVOT_DAY_UNKNOWN);
  });
});
