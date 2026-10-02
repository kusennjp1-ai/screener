import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import StrategyScorecardCard from './StrategyScorecardCard';
import legacyScorecard from '../../../public/strategy-scorecard.json';

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

  it('shows the real archived values, exact windows, provenance and limits without an equivalence claim', () => {
    renderWithProviders(<StrategyScorecardCard data={legacyScorecard} />);
    const card = screen.getByTestId('strategy-scorecard');
    expect(card).toHaveTextContent('旧バックテスト記録');
    expect(card).toHaveTextContent('現行手法は未再検証');
    expect(card).toHaveTextContent('2021-08-05 〜 2026-07-23（約5年）');
    expect(card).toHaveTextContent('2017-08-04 〜 2026-07-24');
    expect(card).toHaveTextContent('run 30051701118');
    expect(card).toHaveTextContent('variant: full_tactics');
    expect(card).toHaveTextContent('run 30135665125');
    expect(card).toHaveTextContent('--pit-universe');
    expect(card).toHaveTextContent('+15.2%');
    expect(card).toHaveTextContent('CAGR +11.0%');
    const warning = screen.getByTestId('legacy-evaluation-warning');
    expect(warning).toHaveTextContent('寄付きの判断・数量計算で当日終値を参照する先読み');
    expect(warning).toHaveTextContent('旧集計への影響は未算定');
    expect(warning).toHaveTextContent('上場廃止銘柄は復元していません');
    expect(warning.compareDocumentPosition(screen.getByText('+15.2%')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('legacy-window-correction')).toHaveTextContent('当初の9年窓はCAGR +4.3%（run 30064735759）');
    expect(card).not.toHaveTextContent(/6年|同じ選び方|不当に低く|ほぼ互角|やや届|途中で利確せず/);
  });

  it('keeps the warning visible even with an older payload that lacks disclosure metadata', () => {
    renderWithProviders(<StrategyScorecardCard data={sample} />);
    expect(screen.getByTestId('legacy-evaluation-warning')).toHaveTextContent('現在の候補リスト');
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
