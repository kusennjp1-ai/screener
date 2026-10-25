import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MarketContextCards from './MarketContextCards';
import { BOOK_MARKET_VERSION } from '../bookMarketEvidence';

const date = '2026-10-23';
const now = Date.parse('2026-10-24T12:00:00Z');
const evidence = () => ({ version: BOOK_MARKET_VERSION, as_of_date: date, currentSnapshotComplete: true,
  latest: { date, coverage: 800, expectedUniverseSize: 1000, newHighs: 35, newLows: 8, leaderCount: 92,
    benchmark: { date, symbol: 'SPY', dailyChangePct: -.43, return20: 2.11 } } });

describe('MarketContextCards', () => {
  it('separates benchmark movement, high/low observations and leader candidates', () => {
    render(<MarketContextCards evidence={evidence()} expectedDate={date} now={now} />);
    const benchmark = within(screen.getByRole('article', { name: '指数の方向' }));
    expect(benchmark.getByText('−0.43%')).toBeInTheDocument();
    expect(benchmark.getByText('+2.11%')).toBeInTheDocument();
    expect(benchmark.getByText(/SPY · 前日比/)).toBeInTheDocument();
    const highs = screen.getByRole('article', { name: '高値と安値の更新' });
    expect(highs).toHaveTextContent('52週高値35銘柄');
    expect(highs).toHaveTextContent('52週安値8銘柄');
    expect(screen.getByRole('article', { name: '先導株の状態' })).toHaveTextContent('92銘柄');
    expect(screen.getByRole('img', { name: '公開チャート集合の観測率 80.0%' })).toBeInTheDocument();
    expect(screen.getByText(/市場全体の統計や/)).toBeInTheDocument();
  });

  it.each(['missing', 'wrong-version', 'wrong-date', 'incomplete', 'wrong-latest-date'])('does not turn %s evidence into current observations', kind => {
    const data = evidence();
    if (kind === 'wrong-version') data.version = 'other';
    if (kind === 'wrong-date') data.as_of_date = '2026-10-22';
    if (kind === 'incomplete') data.currentSnapshotComplete = false;
    if (kind === 'wrong-latest-date') data.latest.date = '2026-10-22';
    render(<MarketContextCards evidence={kind === 'missing' ? null : data} expectedDate={date} now={now} />);
    expect(screen.getByRole('article', { name: '指数の方向' })).not.toHaveTextContent('-0.43%');
    expect(screen.getByRole('article', { name: '先導株の状態' })).not.toHaveTextContent('92銘柄');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/根拠データが未取得/)).toBeInTheDocument();
  });

  it('labels stale observations instead of presenting them as current', () => {
    render(<MarketContextCards evidence={evidence()} expectedDate={date} now={Date.parse('2026-11-01T12:00:00Z')} />);
    expect(screen.getByText(/過去または未確認の観測/)).toHaveTextContent(date);
  });

  it('does not show future observations as completed market data', () => {
    render(<MarketContextCards evidence={evidence()} expectedDate={date} now={Date.parse('2026-10-22T12:00:00Z')} />);
    expect(screen.getByRole('article', { name: '指数の方向' })).not.toHaveTextContent('-0.43%');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/根拠データが未取得/)).toBeInTheDocument();
  });

  it('preserves genuine zeros and rejects impossible coverage or mismatched benchmark dates', () => {
    const data = evidence();
    data.latest.newHighs = 0;
    data.latest.newLows = -3;
    data.latest.leaderCount = 1001;
    data.latest.benchmark.date = '2026-10-22';
    const { rerender } = render(<MarketContextCards evidence={data} expectedDate={date} now={now} />);
    expect(screen.getByRole('article', { name: '高値と安値の更新' })).toHaveTextContent('52週高値0銘柄');
    expect(screen.getByRole('article', { name: '高値と安値の更新' })).toHaveTextContent('52週安値—銘柄');
    expect(screen.getByRole('article', { name: '先導株の状態' })).not.toHaveTextContent('1,001');
    expect(screen.getByRole('article', { name: '指数の方向' })).not.toHaveTextContent('-0.43%');
    data.latest.coverage = 1001;
    rerender(<MarketContextCards evidence={data} expectedDate={date} now={now} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: '高値と安値の更新' })).toHaveTextContent('52週高値—銘柄');
  });
});
