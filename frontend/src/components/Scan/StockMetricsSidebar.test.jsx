import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/renderWithProviders';
import StockMetricsSidebar from './StockMetricsSidebar';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../../test/fixtures/financialCurrent';

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


it('keeps static raw and fallback financial values unknown without affecting company or price metadata', () => {
  renderWithProviders(<StockMetricsSidebar currentFinancialOnly date="2026-10-02" now={Date.parse('2026-10-03T12:00:00Z')}
    stockData={{ symbol: 'TEST', company_name: 'Synthetic company', eps_growth_yy: null, composite_score: 98, minervini_score: 95, eps_rating: 94, rating: 'Strong Buy', fundamental_bonus: 9, fundamental_bonus_detail: {components:{code33:{met:true,points:4}}} }}
    fundamentals={{ symbol: 'TEST', eps_growth_yy: 888, sales_growth_qq: 777, roe: 66, profit_margin: 55 }}/>);
  expect(screen.getByText('Synthetic company')).toBeInTheDocument();
  expect(screen.getByText(/財務に依存する推計・補助スコアは未確認/)).toBeInTheDocument();
  expect(screen.getAllByText('未確認').length).toBeGreaterThan(5);
  expect(screen.queryByText('Strong Buy')).not.toBeInTheDocument();
  expect(screen.queryByText('888.0%')).not.toBeInTheDocument();
  expect(screen.queryByTestId('fundamental-bonus')).not.toBeInTheDocument();
});

it('does not revive an unknown scan value from a separately certified fundamentals cache', () => {
  renderWithProviders(<StockMetricsSidebar currentFinancialOnly date={date} now={now}
    stockData={{symbol:'TEST',market:'US',as_of_date:date,eps_growth_yy:null,sales_growth_yy:null}}
    fundamentals={withSyntheticFinancialProof({symbol:'TEST',eps_growth_yy:888,sales_growth_yy:777})}/>);
  expect(screen.queryByText('+888.0%')).not.toBeInTheDocument();
  expect(screen.queryByText('+777.0%')).not.toBeInTheDocument();
  expect(screen.getByText('EPS Y/Y').closest('div')).toHaveTextContent('未確認');
  expect(screen.getByText('Sales Y/Y').closest('div')).toHaveTextContent('未確認');
});

it('uses certified scan values until expiry and then hides them without consulting raw fallback values', () => {
  const stockData=withSyntheticFinancialProof({symbol:'TEST'});
  const element=time=><StockMetricsSidebar currentFinancialOnly date={date} now={time} stockData={stockData}
    fundamentals={{symbol:'TEST',eps_growth_yy:888,sales_growth_yy:777}}/>;
  const view=renderWithProviders(element(now));
  expect(screen.getByText('+30.0%')).toBeInTheDocument();
  expect(screen.getByText('+40.0%')).toBeInTheDocument();
  expect(screen.getByText('EPS TTM').closest('div')).toHaveTextContent('未確認');
  view.rerender(element(now+8*86400000));
  expect(screen.queryByText('+30.0%')).not.toBeInTheDocument();
  expect(screen.queryByText('+40.0%')).not.toBeInTheDocument();
  expect(screen.queryByText('+888.0%')).not.toBeInTheDocument();
  expect(screen.getByText('EPS Y/Y').closest('div')).toHaveTextContent('未確認');
});
