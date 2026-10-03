import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import TradingViewBridge from './TradingViewBridge';
import { dailyObservationIndex } from '../testDailyObservationFixture';

it('renders nothing without a symbol', () => {
  const { container } = renderWithProviders(<TradingViewBridge symbol={null} />);
  expect(container.firstChild).toBeNull();
});
it.each([
  ['NVDA', 'US', 'NVDA'], ['7203.T', 'JP', 'TSE%3A7203'], ['0700.HK', 'HK', 'HKEX%3A0700'],
])('keeps the external chart link for %s', (symbol, market, encoded) => {
  renderWithProviders(<TradingViewBridge symbol={symbol} market={market} asOf="2026-10-01" />);
  const link = screen.getByRole('link', { name: 'TradingViewで外部チャートを開く' });
  expect(link).toHaveAttribute('href', `https://www.tradingview.com/chart/?symbol=${encoded}`);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByTestId('tradingview-bridge')).toHaveTextContent('日次記録の基準日 2026-10-01');
  expect(screen.getByTestId('tradingview-bridge')).toHaveTextContent('価格・配信時刻・遅延はTradingView側');
});
it.each(dailyObservationIndex.symbols)('does not offer a mixed-model export for $symbol, even if legacy props remain', entry => {
  renderWithProviders(<TradingViewBridge symbol={entry.symbol} market="US" asOf={dailyObservationIndex.as_of_date}
    signal={entry.buy} riskPlan={{ stop_loss: entry.buy.stop_loss, stop_pct: entry.buy.stop_pct }} />);
  const bridge = screen.getByTestId('tradingview-bridge');
  expect(screen.queryByTestId('tradingview-copy-pine')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(bridge.textContent).not.toMatch(/Pine|2R|3R|買いゾーン|5%|43\.59|407\.69/);
});
it.each([undefined, 'invalid', '2026-02-30'])('does not invent a record date for %j', asOf => {
  renderWithProviders(<TradingViewBridge symbol="NVDA" market="US" asOf={asOf} />);
  expect(screen.getByTestId('tradingview-bridge')).toHaveTextContent('日次記録の基準日 未確認');
});
