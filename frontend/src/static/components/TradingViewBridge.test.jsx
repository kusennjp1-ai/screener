import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import TradingViewBridge from './TradingViewBridge';

const signal = { trigger_price: 132.5, target_price_2r: 149.3, target_price_3r: 157.7 };
const riskPlan = { stop_loss: 124.1, stop_pct: 6.3 };

describe('TradingViewBridge', () => {
  it('renders nothing without a symbol', () => {
    const { container } = renderWithProviders(<TradingViewBridge symbol={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('links to the symbol on TradingView', () => {
    renderWithProviders(<TradingViewBridge symbol="NVDA" market="US" signal={signal} riskPlan={riskPlan} />);
    const link = screen.getByTestId('tradingview-open');
    expect(link).toHaveAttribute('href', 'https://www.tradingview.com/chart/?symbol=NVDA');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('copies a Pine overlay with the plan levels to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithProviders(
      <TradingViewBridge symbol="NVDA" market="US" signal={signal} riskPlan={riskPlan} asOf="2026-07-21" />,
    );
    fireEvent.click(screen.getByTestId('tradingview-copy-pine'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const pine = writeText.mock.calls[0][0];
    expect(pine).toContain('//@version=5');
    expect(pine).toContain('pivot = 132.5');
    expect(pine).toContain('stop = 124.1');
    await screen.findByText('コピーしました');
  });

  it('hides the Pine button when there is no plan (no signal/stop)', () => {
    renderWithProviders(<TradingViewBridge symbol="NVDA" market="US" />);
    expect(screen.getByTestId('tradingview-open')).toBeInTheDocument();
    expect(screen.queryByTestId('tradingview-copy-pine')).not.toBeInTheDocument();
  });
});
