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

  it('shows the follow-through-day chip when a live FTD backs the regime', () => {
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'confirmed_uptrend',
      market_exposure_pct: 25,
      market_ftd_date: '2026-06-30',
      market_ftd_days_since: 3,
    }]} />);
    expect(screen.getByText('FTD 2026-06-30 (+3d)')).toBeInTheDocument();
    expect(screen.getByText(/25%/)).toBeInTheDocument();
  });

  it('renders no FTD chip when the regime is MA-driven', () => {
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'confirmed_uptrend', market_exposure_pct: 100,
    }]} />);
    expect(screen.queryByText(/^FTD /)).not.toBeInTheDocument();
  });

  it('renders the health meter and the exposure ladder graphics', () => {
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'confirmed_uptrend',
      market_health: 89,
      market_exposure_pct: 75,
    }]} />);
    expect(screen.getByTestId('health-meter')).toBeInTheDocument();
    const ladder = screen.getByTestId('exposure-ladder');
    const lit = ladder.querySelectorAll('[data-lit="true"]');
    expect(lit).toHaveLength(3); // 75% -> 3 of 4 segments
  });

  it('lights all four exposure segments at 100% and none at 0%', () => {
    const { unmount } = renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'confirmed_uptrend', market_exposure_pct: 100,
    }]} />);
    expect(screen.getByTestId('exposure-ladder').querySelectorAll('[data-lit="true"]')).toHaveLength(4);
    unmount();
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'downtrend', market_exposure_pct: 0,
    }]} />);
    expect(screen.getByTestId('exposure-ladder').querySelectorAll('[data-lit="true"]')).toHaveLength(0);
  });

  it('escalates the distribution-day chip color with the count', () => {
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'uptrend_under_pressure', market_distribution_days: 6,
    }]} />);
    const chip = screen.getByText('6 distribution days').closest('.MuiChip-root');
    expect(chip.className).toContain('MuiChip-colorError');
  });
});
