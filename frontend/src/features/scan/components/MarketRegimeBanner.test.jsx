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
    expect(screen.getByText('上昇トレンド確認')).toBeInTheDocument();
    expect(screen.getByText(/健全度 89\/100/)).toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    expect(screen.getByText(/売り抜け 1日$/)).toBeInTheDocument();
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
    expect(screen.getByText('フォロースルー 2026-06-30（+3日）')).toBeInTheDocument();
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
    // Asserts the painted colour, not a MUI class: the class told us nothing
    // about legibility, and MUI's own error.main measures 3.69:1 on this dark
    // surface — below AA. These are the measured tokens.
    const colorOf = (count) => {
      const { unmount } = renderWithProviders(<MarketRegimeBanner results={[{
        market_regime: 'uptrend_under_pressure', market_distribution_days: count,
      }]} />);
      const chip = screen.getByText(`売り抜け ${count}日`).closest('.MuiChip-root');
      const c = window.getComputedStyle(chip).color;
      unmount();
      return c;
    };
    expect(colorOf(6)).toBe('rgb(242, 54, 69)');   // C.down — 4.69:1
    expect(colorOf(4)).toBe('rgb(224, 165, 46)');  // C.amber — 8.35:1
    expect(colorOf(1)).toBe('rgb(154, 160, 172)'); // C.grey — 6.96:1
    expect(colorOf(6)).not.toBe('rgb(211, 47, 47)'); // MUI error.main — 3.67:1
  });
});
