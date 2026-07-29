import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import StrategyScorecardCard from './StrategyScorecardCard';
import { T, TEXT_MIN_PX } from '../designTokens';

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
    // the share is computed over ALL trades (losers count as 0 gain), not over
    // the winners, so the label must not claim "top 10% of the winners".
    expect(screen.getByText(/全トレード上位10%が利益の 64%/)).toBeInTheDocument();
    expect(screen.getByText(/最大の勝ち1件で利益の 19%/)).toBeInTheDocument();
  });

  it('renders a correction notice when a number has been restated', () => {
    const d = { ...sample, correction: '以前の値は検証側の不具合で過大でした。' };
    renderWithProviders(<StrategyScorecardCard data={d} />);
    expect(screen.getByTestId('scorecard-correction')).toHaveTextContent('訂正');
    expect(screen.getByTestId('scorecard-correction')).toHaveTextContent('過大でした');
  });

  it('omits the correction notice when there is nothing to restate', () => {
    renderWithProviders(<StrategyScorecardCard data={sample} />);
    expect(screen.queryByTestId('scorecard-correction')).not.toBeInTheDocument();
  });

  it('falls back to Sharpe when Sortino is null', () => {
    const d = { ...sample, metrics: { ...sample.metrics, sortino: null } };
    renderWithProviders(<StrategyScorecardCard data={d} />);
    expect(screen.getByText(/リスク1あたりのリターン/)).toBeInTheDocument();
  });
});

// Every rendered text node, with the font size the cascade actually gives it.
const textSizes = (root) => {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = (node.textContent || '').trim();
    if (text) {
      out.push({ text, size: parseFloat(window.getComputedStyle(node.parentElement).fontSize) });
    }
    node = walker.nextNode();
  }
  return out;
};

const full = {
  ...sample,
  correction: '以前の値は検証側の不具合で過大でした。',
  caveat: '窓の取り方で結論は変わりません。',
  wider_window: {
    window: { years: 9 }, cagr_pct: 11.0, benchmark_cagr_pct: 14.8, max_drawdown_pct: -18.6,
  },
};

describe('StrategyScorecardCard type scale (B6/B11)', () => {
  it('renders no text below the 12px floor, even in the caveat/correction block', () => {
    renderWithProviders(<StrategyScorecardCard data={full} />);
    const under = textSizes(screen.getByTestId('strategy-scorecard')).filter((n) => n.size < TEXT_MIN_PX);
    expect(under).toEqual([]);
  });

  it('draws only from the exported scale', () => {
    renderWithProviders(<StrategyScorecardCard data={full} />);
    const sizes = textSizes(screen.getByTestId('strategy-scorecard')).map((n) => n.size);
    const steps = new Set(Object.values(T));
    expect(sizes.filter((s) => !steps.has(s))).toEqual([]);
    expect([...new Set(sizes)].sort((a, b) => a - b)).toEqual([T.micro, T.body, T.strong, T.heading]);
  });

  it('keeps the card title above every item inside it', () => {
    renderWithProviders(<StrategyScorecardCard data={full} />);
    const sizeOf = (el) => parseFloat(window.getComputedStyle(el).fontSize);
    const title = sizeOf(screen.getByText('戦略スコアカード'));
    const value = sizeOf(screen.getByText('+24.3%'));
    expect(title).toBe(T.heading);
    expect(value).toBeLessThan(title);
  });

  it('colours gains and losses from the one semantic pair', () => {
    renderWithProviders(<StrategyScorecardCard data={full} />);
    // C.up / C.down — 6.37:1 and 4.69:1 on #12151b, both AA.
    expect(window.getComputedStyle(screen.getByText('+24.3%')).color).toBe('rgb(34, 171, 148)');
    const loss = { ...full, metrics: { ...full.metrics, cagr_pct: -3.2 } };
    const { unmount } = renderWithProviders(<StrategyScorecardCard data={loss} />);
    expect(window.getComputedStyle(screen.getByText('-3.2%')).color).toBe('rgb(242, 54, 69)');
    unmount();
  });
});
