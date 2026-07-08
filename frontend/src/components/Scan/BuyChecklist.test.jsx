import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import BuyChecklist from './BuyChecklist';
import { renderWithProviders } from '../../test/renderWithProviders';

const buyContext = {
  available: true,
  bands: { pressure_state: 'buy', buy_risk_state: 'low', tpr_state: 'transition' },
  signal: {
    active: true,
    label: 'Buy Point',
    trigger_price: 149.67,
    barrels: { trend: false, pressure: true, breakout: false },
  },
};

const stockData = {
  rs_rating: 61.5, eps_rating: 84, passes_template: true, code33: null,
};

describe('BuyChecklist', () => {
  it('renders nothing when the buy context is unavailable', () => {
    const { container } = renderWithProviders(
      <BuyChecklist buyContext={{ available: false }} stockData={stockData} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('mirrors the engine barrels and the fundamental legs', () => {
    renderWithProviders(<BuyChecklist buyContext={buyContext} stockData={stockData} />);
    expect(screen.getByTestId('buy-checklist')).toBeInTheDocument();
    // Barrels straight from the signal engine.
    expect(screen.getByTestId('buy-check-tpr')).toHaveAttribute('data-met', 'false');
    expect(screen.getByTestId('buy-check-pressure')).toHaveAttribute('data-met', 'true');
    expect(screen.getByTestId('buy-check-pivot')).toHaveAttribute('data-met', 'false');
    // Fundamentals from the scan row: template pass, RS 61.5 < 70, EPS 84 >= 80.
    expect(screen.getByTestId('buy-check-trend_template')).toHaveAttribute('data-met', 'true');
    expect(screen.getByTestId('buy-check-rs_rating')).toHaveAttribute('data-met', 'false');
    expect(screen.getByTestId('buy-check-eps_rating')).toHaveAttribute('data-met', 'true');
    expect(screen.getByTestId('buy-check-code33')).toHaveAttribute('data-met', 'unknown');
    // The active signal headline with its trigger.
    expect(screen.getByText('Buy Point @ 149.67')).toBeInTheDocument();
    // The rule is printed, not implied.
    expect(screen.getByText(/3バレル全点灯＝Triple Barrel買い/)).toBeInTheDocument();
  });

  it('shows the lit-barrel count when the signal is inactive', () => {
    renderWithProviders(
      <BuyChecklist
        buyContext={{ ...buyContext, signal: { active: false, barrels: { trend: true, pressure: true, breakout: false } } }}
        stockData={stockData}
      />,
    );
    expect(screen.getByText('未点灯（2/3 バレル）')).toBeInTheDocument();
  });
});
