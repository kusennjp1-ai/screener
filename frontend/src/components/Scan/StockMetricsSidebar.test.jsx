import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/renderWithProviders';
import StockMetricsSidebar from './StockMetricsSidebar';

describe('StockMetricsSidebar market-cap display', () => {
  it('falls back to scan-row market cap when fundamentals market cap is missing', () => {
    renderWithProviders(
      <StockMetricsSidebar
        stockData={{
          symbol: '0700.HK',
          company_name: 'Tencent Holdings',
          currency: 'HKD',
          market_cap: 3_900_000_000_000,
        }}
        fundamentals={{
          symbol: '0700.HK',
          market_cap: null,
        }}
      />
    );

    expect(screen.getByText('Mkt Cap (local)')).toBeInTheDocument();
    expect(screen.getByText('HK$3.9T')).toBeInTheDocument();
  });

  it('prefers USD-normalized market cap when available', () => {
    renderWithProviders(
      <StockMetricsSidebar
        stockData={{
          symbol: '0700.HK',
          company_name: 'Tencent Holdings',
          currency: 'HKD',
          market_cap: 3_900_000_000_000,
          market_cap_usd: 500_000_000_000,
        }}
        fundamentals={{
          symbol: '0700.HK',
          market_cap: null,
        }}
      />
    );

    expect(screen.getByText('Mkt Cap (USD)')).toBeInTheDocument();
    expect(screen.getByText('$500.0B')).toBeInTheDocument();
    expect(screen.queryByText('HK$3.9T')).not.toBeInTheDocument();
  });

  it('uses native-currency formatting in fundamentals-only mode when USD cap is absent', () => {
    renderWithProviders(
      <StockMetricsSidebar
        stockData={null}
        fundamentals={{
          symbol: '2330.TW',
          currency: 'TWD',
          market_cap: 30_000_000_000_000,
        }}
      />
    );

    expect(screen.getByText('Mkt Cap (local)')).toBeInTheDocument();
    expect(screen.getByText('NT$30.0T')).toBeInTheDocument();
  });
});

describe('StockMetricsSidebar fundamental bonus (C44)', () => {
  const detail = {
    bonus: 9.0,
    max_bonus: 10.0,
    available: true,
    components: {
      code33: { points: 4.0, value: true, met: true },
      eps_growth_qq: { points: 2.5, value: 45.0, met: true },
      sales_growth_qq: { points: 0.5, value: 18.0, met: true },
      roe: { points: 1.0, value: 24.3, met: true },
      eps_rating: { points: 1.0, value: 88, met: false },
    },
  };

  it('renders the bonus total and one chip per measured component', () => {
    renderWithProviders(
      <StockMetricsSidebar
        stockData={{ symbol: 'FTNT', fundamental_bonus: 9.0, fundamental_bonus_detail: detail }}
        fundamentals={{ symbol: 'FTNT' }}
      />
    );

    expect(screen.getByTestId('fundamental-bonus')).toBeInTheDocument();
    expect(screen.getByText('+9.0 / 10')).toBeInTheDocument();
    expect(screen.getByTestId('bonus-chip-code33')).toHaveTextContent('Code 33 +4');
    expect(screen.getByTestId('bonus-chip-eps_growth_qq')).toHaveTextContent('EPS Q/Q +2.5');
    // met=false chip shows the label without points and is marked unmet
    expect(screen.getByTestId('bonus-chip-eps_rating')).toHaveTextContent('EPS Rat');
    expect(screen.getByTestId('bonus-chip-eps_rating')).toHaveAttribute('data-met', 'false');
  });

  it('hides the block entirely when no component was measured', () => {
    renderWithProviders(
      <StockMetricsSidebar
        stockData={{
          symbol: 'FTNT',
          fundamental_bonus: 0,
          fundamental_bonus_detail: {
            bonus: 0,
            available: false,
            components: {
              code33: { points: 0, value: null, met: null },
              eps_growth_qq: { points: 0, value: null, met: null },
            },
          },
        }}
        fundamentals={{ symbol: 'FTNT' }}
      />
    );

    expect(screen.queryByTestId('fundamental-bonus')).not.toBeInTheDocument();
  });

  it('hides the block when the scan predates C43 (no detail field)', () => {
    renderWithProviders(
      <StockMetricsSidebar stockData={{ symbol: 'FTNT' }} fundamentals={{ symbol: 'FTNT' }} />
    );

    expect(screen.queryByTestId('fundamental-bonus')).not.toBeInTheDocument();
  });
});
