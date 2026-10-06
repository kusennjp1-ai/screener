import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarketIndicatorHistories from './MarketIndicatorHistories';
import InstitutionalEvidence from './InstitutionalEvidence';
import BaseCountEvidence from './BaseCountEvidence';
import { INDICATOR_HISTORY_VERSION } from '../indicatorHistory';
import { entryHistory, ENTRY_HISTORY_VERSION, ENTRY_UNIVERSE, ENTRY_METHODS } from '../entryHistory';
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }) => <div>{children}</div>, LineChart: ({ children }) => <div>{children}</div>, CartesianGrid: () => null, Legend: () => null, Line: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
const date = '2026-09-29';
describe('market indicator history display', () => {
  it('shows high/low immediately with historical coverage and preserves unavailable provider states', () => {
    render(<MarketIndicatorHistories expectedDate={date} bookEvidence={{ version: 'book-market-v1', as_of_date: date, series: [{ date, newHighs: 4, newLows: 0, coverage: 100, expectedUniverseSize: 1000 }] }}/>);
    expect(screen.getByRole('heading', { name: '52週新高値・新安値' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '52週新高値・新安値の履歴', hidden: true })).toHaveTextContent('100 / 1,000');
    fireEvent.click(screen.getByRole('button', { name: 'Put/Call' }));
    expect(screen.getByText(/再配信を許可された/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '分配日' }));
    expect(screen.getByRole('heading', { name: 'S&P 500の通常分配日（推計）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nasdaq総合の通常分配日（推計）' })).toBeInTheDocument();
    expect(screen.getByText(/機関保有の四半期推移/)).toBeInTheDocument();
  });
  it('allows method and approach choice without inventing first-day crossings', () => {
    const snapshot = { version: ENTRY_HISTORY_VERSION, as_of: date, rule_version: 'r', universe_version: ENTRY_UNIVERSE, records: [{ symbol: 'A', market: 'US', price: 98, pivot: 100, distance: -2, methods: Object.fromEntries(ENTRY_METHODS.map(method => [method, { zone: method === 'minervini2' ? 3 : 5, qualified: true, ready: false }])) }] };
    const entry = Object.fromEntries(ENTRY_METHODS.map(method => [method, Object.fromEntries([1, 3, 5].map(approach => [approach, entryHistory([snapshot], date, method, approach)]))]));
    render(<MarketIndicatorHistories expectedDate={date} data={{ version: INDICATOR_HISTORY_VERSION, as_of_date: date, entry }}/>);
    fireEvent.click(screen.getByRole('button', { name: '接近・上抜け' }));
    expect(screen.getByText(/前取引日の記録が揃うまで未確認/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ピボット下の接近幅'), { target: { value: '1' } });
    expect(screen.getByRole('table', { name: '接近・買い範囲・新規上抜けの履歴', hidden: true })).toHaveTextContent('未確認');
    expect(screen.getByText(/接近はピボットの下1%以内/)).toBeInTheDocument();
  });
  it('rejects stale market history', () => {
    render(<MarketIndicatorHistories expectedDate={date} data={{ version: INDICATOR_HISTORY_VERSION, as_of_date: '2026-09-28', highLow: { series: [{ high: 999 }] } }}/>);
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });
  it('renders quarterly and base unknowns safely', () => {
    render(<><InstitutionalEvidence row={{ symbol: 'A' }} date={date}/><BaseCountEvidence row={{ symbol: 'A' }} date={date}/></>);
    expect(screen.getByRole('heading', { name: '四半期の保有報告会社数' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ベース段階の推移（自動推計）' })).toBeInTheDocument();
    expect(screen.getByText(/観測開始前の段階は不明/)).toBeInTheDocument();
  });
});
