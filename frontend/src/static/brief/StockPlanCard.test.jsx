import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import StockView from './StockView';
import { usePositionPlan } from './StockPlanCard';
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
afterEach(cleanup);

describe('brief stock view on a phone folds what is secondary, never a fired or unknown check', () => {
  const folded = element => Boolean(element.closest('details'));
  afterEach(() => sessionStorage.clear());

  it('names the plan inputs on their line and keeps the plan\'s results in view', () => {
    render(<StockView data={data(true)} />);
    expect(screen.getByText(/口座 \$50,000・リスク 1\.25%・損切り 7\.0%/).closest('summary')).toBeTruthy();
    expect(folded(screen.getByRole('spinbutton', { name: '口座資金（$）', hidden: true }))).toBe(true);
    // The plan's results stay in view.
    expect(folded(screen.getByTestId('brief-shares'))).toBe(false);
  });
});

// Step-0 seam F owns and the stock view shell (A) calls.
describe('usePositionPlan', () => {
  afterEach(() => localStorage.clear());

  it('returns the plan, its inputs, update and moveStop, and moves the chart\'s stop line with the stop', () => {
    const moves = [];
    const chartRef = { current: { moveStop: stop => moves.push(stop) } };
    const { result } = renderHook(() => usePositionPlan({ view, template: null, market: null, technical: null, certified: true, judged: bars(), chartRef }));
    expect(Object.keys(result.current).sort()).toEqual(['moveStop', 'plan', 'settings', 'update']);
    expect(result.current.settings).toEqual({ stopPercent: 7, account: 50000, riskPercent: 1.25 });
    expect(result.current.plan).toEqual(positionPlan(view, result.current.settings));
    act(() => result.current.update('stopPercent', 5));
    expect(result.current.settings.stopPercent).toBe(5);
    expect(moves).toEqual([positionPlan(view, { ...result.current.settings }).stop]);
    expect(JSON.parse(localStorage.getItem('brief-plan'))).toMatchObject({ stopPercent: 5 });
    result.current.moveStop(90);
    expect(moves.at(-1)).toBe(90);
    // A value that is not a number changes nothing.
    act(() => result.current.update('account', Number.NaN));
    expect(result.current.settings.account).toBe(50000);
  });

  it('has no plan without a view', () => {
    const { result } = renderHook(() => usePositionPlan({ view: null, chartRef: { current: null } }));
    expect(result.current.plan).toBeNull();
  });
});
