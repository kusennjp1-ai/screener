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

    expect(screen.getByText('時価総額(現地)')).toBeInTheDocument();
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

    expect(screen.getByText('時価総額(USD)')).toBeInTheDocument();
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

    expect(screen.getByText('時価総額(現地)')).toBeInTheDocument();
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
    expect(screen.getByTestId('bonus-chip-eps_growth_qq')).toHaveTextContent('EPS 前Q +2.5');
    // met=false chip shows the label without points and is marked unmet
    expect(screen.getByTestId('bonus-chip-eps_rating')).toHaveTextContent('EPSレート');
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

// 実データ（static-data/markets/us/charts/FTNT.json）と同じ形：
// スコアも成長率もバリュエーションも全部 null の「listing_only」行。
const EMPTY_STOCK_DATA = {
  symbol: 'FTNT',
  company_name: 'FTNT',
  data_status: 'insufficient_history',
  rating: 'Insufficient Data',
  composite_score: null,
  eps_rating: null,
  minervini_score: null,
  canslim_score: null,
  rs_rating: null,
  eps_growth_qq: null,
  current_price: null,
  market_cap: null,
  stage: null,
  ma_alignment: null,
  passes_template: false,
};

describe('StockMetricsSidebar empty payload', () => {
  it('collapses to a single 40px row instead of 28 dashes', () => {
    renderWithProviders(
      <StockMetricsSidebar stockData={EMPTY_STOCK_DATA} fundamentals={null} />
    );

    const empty = screen.getByTestId('metrics-empty');
    expect(empty).toHaveTextContent('ファンダメンタルデータ未取得');
    expect(empty).toHaveStyle({ height: '40px' });

    // セクション見出しごと畳む
    ['スコア', '相対強度', '成長率', 'バリュエーション', '株価・テクニカル'].forEach((header) => {
      expect(screen.queryByText(header)).not.toBeInTheDocument();
    });
    // 「-」を並べない
    expect(screen.queryAllByText('-')).toHaveLength(0);
  });

  it('translates the Insufficient Data rating pill', () => {
    renderWithProviders(
      <StockMetricsSidebar stockData={EMPTY_STOCK_DATA} fundamentals={null} />
    );

    expect(screen.getByText('データ不足')).toBeInTheDocument();
    expect(screen.queryByText('Insufficient Data')).not.toBeInTheDocument();
  });

  it('still renders the full grid when a single metric is populated', () => {
    renderWithProviders(
      <StockMetricsSidebar
        stockData={{ ...EMPTY_STOCK_DATA, rs_rating: 91.2 }}
        fundamentals={null}
      />
    );

    expect(screen.queryByTestId('metrics-empty')).not.toBeInTheDocument();
    expect(screen.getByText('相対強度')).toBeInTheDocument();
    expect(screen.getByText('91.2')).toBeInTheDocument();
  });
});

describe('StockMetricsSidebar Japanese labels', () => {
  const FULL = {
    symbol: 'NVDA',
    company_name: 'NVIDIA',
    rating: 'Buy',
    composite_score: 88.4,
    rs_rating: 95,
    beta: 1.4,
    current_price: 151.35,
    stage: 2,
    market_cap_usd: 500_000_000_000,
  };

  it('renders section headers and labels in Japanese', () => {
    renderWithProviders(<StockMetricsSidebar stockData={FULL} fundamentals={{ symbol: 'NVDA' }} />);

    ['スコア', '相対強度', '成長率', 'バリュエーション', '株価・テクニカル'].forEach((header) => {
      expect(screen.getByText(header)).toBeInTheDocument();
    });
    ['総合', 'EPSレート', 'ベータ', '時価総額(USD)', '予想PER', '機関保有', '株価', 'テンプレ合格']
      .forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());

    ['SCORES', 'RELATIVE STRENGTH', 'VALUATION', 'PRICE & TECHNICAL', 'Mkt Cap', 'Fwd P/E', 'Inst Own', 'Pass Tmpl', 'β-adj RS']
      .forEach((english) => expect(screen.queryByText(english)).not.toBeInTheDocument());
  });

  it('gives every metric label the same glossary underline (all, not some)', () => {
    const { container } = renderWithProviders(
      <StockMetricsSidebar stockData={FULL} fundamentals={{ symbol: 'NVDA' }} />
    );

    const labels = [
      '総合', 'EPSレート', 'ミネルヴィニ', 'CANSLIM', 'IPO', 'カスタム', '出来高突破',
      'RSレート', 'RS 1か月', 'ベータ', 'β調整RS',
      'EPS 前Q比', '売上 前Q比', 'EPS 通期', '売上成長率',
      '時価総額(USD)', 'PER', '予想PER', 'PEG', 'ROE', '純利益率', '機関保有',
      '株価', 'ステージ', 'MA整列', 'テンプレ合格',
    ];

    labels.forEach((label) => {
      const node = screen.getByText(label);
      expect(node.closest('[data-glossary="true"]')).not.toBeNull();
    });
    expect(container.querySelectorAll('[data-glossary="true"]').length).toBeGreaterThanOrEqual(labels.length);
  });
});
