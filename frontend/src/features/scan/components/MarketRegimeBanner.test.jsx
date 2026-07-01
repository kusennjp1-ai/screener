import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import MarketRegimeBanner from './MarketRegimeBanner';

describe('MarketRegimeBanner', () => {
  it('renders nothing when no row carries a regime', () => {
    const { container } = renderWithProviders(<MarketRegimeBanner results={[{ symbol: 'AAA' }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for empty/undefined results', () => {
    const { container } = renderWithProviders(<MarketRegimeBanner results={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the regime label, health, exposure and distribution days', () => {
    const results = [
      {
        symbol: 'AAA',
        market_regime: 'confirmed_uptrend',
        market_health: 88.5,
        market_exposure_pct: 100,
        market_distribution_days: 1,
      },
    ];
    renderWithProviders(<MarketRegimeBanner results={results} />);
    expect(screen.getByText('Confirmed Uptrend')).toBeInTheDocument();
    expect(screen.getByText(/Health 89\/100/)).toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    expect(screen.getByText(/1 distribution day$/)).toBeInTheDocument();
  });

  it('falls back to the raw regime string for an unknown regime', () => {
    renderWithProviders(<MarketRegimeBanner results={[{ market_regime: 'weird_state' }]} />);
    expect(screen.getByText('weird_state')).toBeInTheDocument();
  });
});
