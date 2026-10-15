import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OneilSourceComparison from './OneilSourceComparison';
import { nativeAnnualFixture } from '../../test/fixtures/nativeAnnual';
import { withFinancialProof } from '../testFinancialFixture';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../financialEvidencePresentation';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(context.now); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const context = { symbol: 'TEST', date: '2026-10-02', now: Date.parse('2026-10-04T12:00:00Z'), method: 'oneil', generation: 'diagnostic-fixture' };
const fixture = (sales = 20) => withFinancialProof({ eps_growth_yy: 30, sales_growth_yy: sales, technical_audit: { as_of_date: context.date },
  financial_history: nativeAnnualFixture('CAD', [1, 1.2, 1.5, 2]) }, context.now, context.date);
const rows = row => financialEvidencePresentation({ ...context, history: row.financial_history,
  evidence: buildFinancialEvidencePresentation(row, context) }).rows;
const open = () => fireEvent.click(screen.getByText('原典との比較（診断のみ）'));

it('compares the source annual condition with the unchanged stricter app condition and shows provenance', () => {
  const row = fixture();
  render(<OneilSourceComparison {...context} row={row} currentRows={rows(row)}/>);
  expect(screen.getByText('原典との比較（診断のみ）').closest('details')).not.toHaveAttribute('open');
  open();
  const annual = screen.getByRole('region', { name: '年次EPSの原典比較' });
  expect(within(annual).getByRole('region', { name: '現行アプリ' })).toHaveAttribute('data-state', 'fail');
  expect(within(annual).getByRole('region', { name: '現行アプリ' })).toHaveTextContent('20% → 25% → 33.33%');
  const source = within(annual).getByRole('region', { name: '原典の年次EPS条件' });
  expect(source).toHaveAttribute('data-state', 'pass');
  for (const content of ['25.99%', '3年CAGR 25%以上', '過去3年の各年増益', 'Synthetic provider', '2026-10-04T11:00:00.000Z', 'CAD / 提供元の株式単位', '分析日当時の公表確認ではありません']) expect(source).toHaveTextContent(content);
  expect(within(source).getByRole('list', { name: '年次EPSの各年比較' }).children).toHaveLength(3);
  expect(source).toHaveTextContent('EPS 1 → 1.2 · 増益率 20.00% · 該当');
  expect(screen.getByText(/2条件だけを比較する診断/)).toHaveTextContent('選定・順位・購入判定には使いません');
  expect(screen.getByText(/PDF頁はPDFの先頭/)).toHaveTextContent('紙面頁とは異なります');
});

it.each([[20, 'fail', 'unknown'], [25, 'unknown', 'unknown'], [30, 'pass', 'pass']])('keeps the sales branches separate for %s%% and never fills acceleration', (value, latestState, totalState) => {
  const row = fixture(value);
  render(<OneilSourceComparison {...context} row={row} currentRows={rows(row)}/>);
  open();
  const sales = screen.getByRole('region', { name: '原典の売上条件' });
  expect(sales).toHaveAttribute('data-state', totalState);
  expect(within(sales).getByText(/最新YoY：/)).toHaveAttribute('data-state', latestState);
  expect(within(sales).getByText(/最新YoY：/)).toHaveTextContent(`${value.toFixed(2)}%`);
  expect(within(sales).getByText(/3四半期のYoY加速：/)).toHaveAttribute('data-state', 'unknown');
  expect(sales).toHaveTextContent('直近3四半期の売上YoYを確認できません');
  expect(sales).toHaveTextContent('2026-06-30 / 比較 2025-06-30');
  if (value === 25) expect(sales).toHaveTextContent('丸め前が25%未満かを区別できない');
});

it.each([
  ['missing metadata', row => { delete row.financial_history.annual_source; }],
  ['future acquisition', row => { row.financial_history.annual_source.observed_at = row.financial_history.retrieved_at = '2026-10-05T11:00:00Z'; }],
  ['quarantined history', row => { row.financial_history.status = 'quarantined'; }],
  ['zero EPS', row => { row.financial_history.annual[0].eps = 0; }],
])('renders an annual unknown with an explanation and no calculated value for %s', (_, change) => {
  const row = fixture(); change(row);
  render(<OneilSourceComparison {...context} row={row} currentRows={rows(row)}/>);
  open();
  const annual = screen.getByRole('region', { name: '原典の年次EPS条件' });
  expect(annual).toHaveAttribute('data-state', 'unknown');
  expect(annual).toHaveTextContent('3年CAGR：未確認');
  expect(annual).not.toHaveTextContent('25.99%');
  expect(annual).not.toHaveTextContent('3年CAGR：0.00%');
  expect(annual).toHaveTextContent(/確認できません|比較不可|評価時刻より後/);
});

it('removes old diagnostic values when symbol, date, or evaluation time changes', () => {
  const row = fixture(30);
  const { rerender } = render(<OneilSourceComparison {...context} row={row} currentRows={rows(row)}/>);
  open();
  expect(screen.getByRole('region', { name: '原典の年次EPS条件' })).toHaveTextContent('25.99%');
  for (const change of [{ symbol: 'OTHER' }, { date: '2026-10-01' }, { now: context.now + 8 * 86400000 }]) {
    rerender(<OneilSourceComparison {...context} {...change} row={row}/>);
    const annual = screen.getByRole('region', { name: '原典の年次EPS条件' });
    const sales = screen.getByRole('region', { name: '原典の売上条件' });
    expect(annual).toHaveAttribute('data-state', 'unknown');
    expect(annual).not.toHaveTextContent('25.99%');
    expect(sales).toHaveAttribute('data-state', 'unknown');
    expect(within(sales).getByText(/最新YoY：/)).toHaveTextContent('未確認');
  }
});

it('does not turn raw standalone sales values into certified diagnostics', () => {
  const row = { symbol: 'TEST', market: 'US', as_of_date: context.date, sales_growth_yy: 999 };
  render(<OneilSourceComparison {...context} row={row}/>); open();
  const source = screen.getByRole('region', { name: '原典の売上条件' });
  expect(source).toHaveAttribute('data-state', 'unknown');
  expect(source).not.toHaveTextContent('999');
  expect(source).toHaveTextContent('最新YoY：未確認');
});

it.each(['annual period age', 'annual 72-hour source', 'sales proof'])('expires an open diagnostic at the first invalid millisecond of %s', kind => {
  let start = context.now, date = context.date;
  const row = fixture(30);
  if (kind === 'annual period age') {
    row.financial_history.annual.forEach((point, index) => { point.end = `${2022 + index}-04-02`; });
    start = Date.parse('2025-04-02') + 551 * 86400000 - 1001;
    date = new Date(start).toISOString().slice(0, 10);
    row.as_of_date = row.technical_audit.as_of_date = row.financial_history.as_of_date = date;
    row.financial_history.retrieved_at = row.financial_history.annual_source.observed_at = new Date(start - 3600000).toISOString();
  } else if (kind === 'annual 72-hour source') {
    row.financial_history.retrieved_at = row.financial_history.annual_source.observed_at = new Date(start - 72 * 3600000 + 1000).toISOString();
  } else row.financial_current.p['3'][5] = start + 1000;
  vi.setSystemTime(start);
  render(<OneilSourceComparison {...context} row={row} date={date} now={start}/>); open();
  const target = screen.getByRole('region', { name: kind === 'sales proof' ? '原典の売上条件' : '原典の年次EPS条件' });
  expect(target).toHaveAttribute('data-state', 'pass');
  act(() => vi.advanceTimersByTime(1000));
  expect(target).toHaveAttribute('data-state', 'pass');
  act(() => vi.advanceTimersByTime(1));
  expect(target).toHaveAttribute('data-state', 'unknown');
  expect(screen.getByText(/診断の確認時刻：/)).toHaveTextContent(new Date(start + 1001).toISOString());
  expect(target).toHaveTextContent(kind === 'sales proof' ? '最新YoY：未確認' : '3年CAGR：未確認');
  const expired = target.textContent;
  act(() => vi.advanceTimersByTime(10000));
  expect(target.textContent).toBe(expired);
});

it('accepts a valid evaluation context after an initially missing clock without retaining an invalid local clock', () => {
  const row = fixture();
  const { rerender } = render(<OneilSourceComparison {...context} row={row} now={undefined}/>); open();
  expect(screen.getByRole('region', { name: '原典の年次EPS条件' })).toHaveAttribute('data-state', 'unknown');
  rerender(<OneilSourceComparison {...context} row={row}/>);
  expect(screen.getByRole('region', { name: '原典の年次EPS条件' })).toHaveAttribute('data-state', 'pass');
});

it.each([null, false, '123', undefined, NaN])('keeps an invalid supplied clock %s unknown after focus and visibility wakes', now => {
  render(<OneilSourceComparison {...context} row={fixture(30)} now={now}/>); open();
  for (const event of ['focus', 'visibilitychange']) {
    act(() => (event === 'focus' ? window : document).dispatchEvent(new Event(event)));
    expect(screen.getByRole('region', { name: '原典の年次EPS条件' })).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByRole('region', { name: '原典の売上条件' })).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByText(/診断の確認時刻：/)).toHaveTextContent('未確認');
    expect(screen.getByRole('region', { name: '原典の年次EPS条件' })).not.toHaveTextContent('25.99%');
  }
});

it.each(['focus', 'visibilitychange'])('rechecks a suspended diagnostic on %s', event => {
  const row = fixture(30); row.financial_current.p['3'][5] = context.now + 1000;
  render(<OneilSourceComparison {...context} row={row}/>); open();
  const sales = screen.getByRole('region', { name: '原典の売上条件' });
  expect(sales).toHaveAttribute('data-state', 'pass');
  vi.setSystemTime(context.now + 1001);
  act(() => (event === 'focus' ? window : document).dispatchEvent(new Event(event)));
  expect(sales).toHaveAttribute('data-state', 'unknown');
});

it('detects a clock rollback and clears its wake timers on unmount', () => {
  const row = fixture(30); row.financial_current.p['3'][5] = context.now + 1000;
  const { unmount } = render(<OneilSourceComparison {...context} row={row}/>); open();
  const sales = screen.getByRole('region', { name: '原典の売上条件' });
  act(() => vi.advanceTimersByTime(1001));
  expect(sales).toHaveAttribute('data-state', 'unknown');
  vi.setSystemTime(context.now - 15000);
  act(() => vi.advanceTimersByTime(15000));
  expect(sales).toHaveAttribute('data-state', 'pass');
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
