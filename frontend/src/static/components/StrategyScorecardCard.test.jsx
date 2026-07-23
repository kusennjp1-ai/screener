import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import StrategyScorecardCard from './StrategyScorecardCard';

const sample = {
  as_of: '2026-07-23',
  window: { start: '2020-07-01', end: '2026-07-01', years: 6 },
  universe_size: 810,
  metrics: {
    cagr_pct: 24.3,
    max_drawdown_pct: -18.2,
    sharpe: 1.1,
    sortino: 1.7,
    win_rate_pct: 42,
    trades: 908,
    payoff_distribution: {
      expectancy_r: 0.61,
      payoff_ratio: 2.8,
      top10pct_gain_share: 0.64,
      best_trade_gain_share: 0.19,
    },
  },
  benchmark: { cagr_pct: 12.5, max_drawdown_pct: -33.7 },
};

describe('StrategyScorecardCard', () => {
  it('renders nothing without metrics', () => {
    const { container } = renderWithProviders(<StrategyScorecardCard data={null} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = renderWithProviders(<StrategyScorecardCard data={{}} />);
    expect(c2.firstChild).toBeNull();
  });

  it('shows the five priority metrics with values', () => {
    renderWithProviders(<StrategyScorecardCard data={sample} />);
    expect(screen.getByTestId('strategy-scorecard')).toBeInTheDocument();
    expect(screen.getByText('+24.3%')).toBeInTheDocument(); // CAGR
    expect(screen.getByText('-18.2%')).toBeInTheDocument(); // max DD
    expect(screen.getByText('1.70')).toBeInTheDocument(); // Sortino primary
    expect(screen.getByText('0.61R')).toBeInTheDocument(); // expectancy
    expect(screen.getByText('42%')).toBeInTheDocument(); // win rate
  });

  it('prefers Sortino but still surfaces Sharpe in the meaning line', () => {
    renderWithProviders(<StrategyScorecardCard data={sample} />);
    expect(screen.getByText(/Sortino/)).toBeInTheDocument();
    expect(screen.getByText(/Sharpe 1\.10/)).toBeInTheDocument();
  });

  it('renders the right-tail concentration when present', () => {
    renderWithProviders(<StrategyScorecardCard data={sample} />);
    expect(screen.getByText(/上位10%の勝ちが利益の 64%/)).toBeInTheDocument();
    expect(screen.getByText(/最大の勝ち1件で利益の 19%/)).toBeInTheDocument();
  });

  it('falls back to Sharpe when Sortino is null', () => {
    const d = { ...sample, metrics: { ...sample.metrics, sortino: null } };
    renderWithProviders(<StrategyScorecardCard data={d} />);
    expect(screen.getByText(/リスク1あたりのリターン/)).toBeInTheDocument();
  });
});
