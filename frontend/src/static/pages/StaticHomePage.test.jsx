import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import StaticHomePage from './StaticHomePage';
import { dailyObservationIndex } from '../testDailyObservationFixture';

const fetchStaticJson = vi.fn();
const useStaticManifest = vi.fn();
const useStaticChartIndex = vi.fn();
const useStaticMarket = vi.fn();
const modalSpy = vi.fn();
const priceSparklineSpy = vi.fn();

vi.mock('../dataClient', () => ({
  fetchStaticJson: (...args) => fetchStaticJson(...args),
  useStaticManifest: (...args) => useStaticManifest(...args),
  resolveStaticMarketEntry: (manifest, selectedMarket) => ({
    market: selectedMarket,
    display_name: manifest.markets[selectedMarket].display_name,
    pages: manifest.markets[selectedMarket].pages,
    assets: manifest.markets[selectedMarket].assets,
  }),
}));

vi.mock('../chartClient', () => ({
  useStaticChartIndex: (...args) => useStaticChartIndex(...args),
}));

vi.mock('../StaticMarketContext', () => ({
  useStaticMarket: (...args) => useStaticMarket(...args),
}));

vi.mock('../StaticChartViewerModal', () => ({
  default: (props) => {
    modalSpy(props);
    return <div data-testid="static-chart-modal" data-open={props.open ? 'yes' : 'no'} />;
  },
}));

vi.mock('../../components/Scan/PriceSparkline', () => ({
  default: (props) => {
    priceSparklineSpy(props);
    return <span data-testid="price-sparkline" />;
  },
}));

vi.mock('../../components/Scan/RSSparkline', () => ({
  default: () => <span data-testid="rs-sparkline" />,
}));

const manifest = {
  markets: {
    US: {
      display_name: 'United States',
      pages: {
        home: { path: 'markets/us/home.json' },
        scan: { path: 'markets/us/scan/manifest.json' },
      },
      assets: {
        charts: { path: 'markets/us/charts/index.json' },
      },
    },
  },
};

const makeLeadersPresetScreen = (minVolume = 100_000_000) => ({
  id: 'leaders_in_leading_groups',
  name: '主導業種グループの主導銘柄',
  short_name: 'Leaders',
  description: 'Strong report-card stocks in top 40 IBD groups',
  tier: 2,
  filters: {
    minVolume,
    ibdGroupRank: { min: null, max: 40 },
    rsRating: { min: 80, max: null },
  },
  sort_by: 'composite_score',
  sort_order: 'desc',
});

const makeLeaderRow = (index, overrides = {}) => ({
  symbol: `LEAD${String(index).padStart(2, '0')}`,
  company_name: `Leader ${index}`,
  composite_score: 100 - index,
  rs_rating: 95,
  current_price: 100 + index,
  rating: 'Strong Buy',
  volume: 150_000_000,
  market_cap: 2_000_000_000,
  currency: 'USD',
  ibd_industry_group: 'Semiconductors',
  ibd_group_rank: 10,
  price_sparkline_data: null,
  rs_sparkline_data: null,
  ...overrides,
});

describe('StaticHomePage', () => {
  let homePayload;
  let scanManifestPayload;
  let scanChunkPayload;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    modalSpy.mockClear();
    priceSparklineSpy.mockClear();
    useStaticManifest.mockReturnValue({
      data: manifest,
      isLoading: false,
      isError: false,
    });
    useStaticMarket.mockReturnValue({ selectedMarket: 'US' });
    useStaticChartIndex.mockReturnValue({
      data: {
        symbols: [
          { symbol: 'LOW', rank: 1, path: 'charts/LOW.json' },
          { symbol: 'NVDA', rank: 2, path: 'charts/NVDA.json' },
          { symbol: 'AAPL', rank: 3, path: 'charts/AAPL.json' },
        ],
      },
    });
    homePayload = {
      market_display_name: 'United States',
      freshness: {
        scan_as_of_date: '2026-04-24',
        breadth_latest_date: '2026-04-24',
        groups_latest_date: '2026-04-24',
      },
      key_markets: [],
      scan_summary: {
        top_results: [
          { symbol: 'SUMMARYONLY', company_name: 'Home Summary Only', composite_score: 99.9 },
        ],
      },
      top_groups: [],
    };
    scanManifestPayload = {
      default_filters: { minVolume: 100_000_000 },
      initial_rows: [
        {
          symbol: 'NVDA',
          company_name: 'NVIDIA Corporation',
          passes_template: true,
          code33: true,
          rs_rating: 95,
          week_52_high_distance: -4,
          ibd_group_rank: 60,
          composite_score: 98.0,
          current_price: 100,
          rating: 'Strong Buy',
          volume: 180_000_000,
          market_cap: 2_000_000_000,
          currency: 'USD',
          price_sparkline_data: null,
          rs_sparkline_data: null,
        },
      ],
      chunks: [
        { path: 'markets/us/scan/chunks/chunk-0001.json' },
      ],
      preset_screens: [makeLeadersPresetScreen()],
    };
    scanChunkPayload = {
      rows: [
        {
          symbol: '0700.HK',
          company_name: 'Tencent Holdings',
          passes_template: true,
          code33: true,
          rs_rating: 91,
          week_52_high_distance: -8,
          ibd_group_rank: 60,
          composite_score: 99.0,
          current_price: 25,
          rating: 'Buy',
          volume: 170_000_000,
          market_cap: 3_900_000_000_000,
          market_cap_usd: 500_000_000,
          currency: 'HKD',
          price_sparkline_data: null,
          rs_sparkline_data: null,
        },
        {
          symbol: 'AAPL',
          company_name: 'Apple Inc.',
          passes_template: true,
          code33: true,
          rs_rating: 92,
          week_52_high_distance: -7,
          ibd_group_rank: 70,
          composite_score: 97.0,
          current_price: 200,
          rating: 'Buy',
          volume: 160_000_000,
          market_cap: 3_000_000_000,
          currency: 'USD',
          price_sparkline_data: null,
          rs_sparkline_data: null,
        },
      ],
    };

    fetchStaticJson.mockImplementation(async (path) => {
      if (path === 'markets/us/home.json') {
        return homePayload;
      }

      if (path === 'markets/us/scan/manifest.json') {
        return scanManifestPayload;
      }

      if (path === 'markets/us/scan/chunks/chunk-0001.json') {
        return scanChunkPayload;
      }

      throw new Error(`Unexpected static path: ${path}`);
    });
  });

  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('keeps all Daily tables named and keyboard reachable even when no chart row can receive focus', async () => {
    useStaticChartIndex.mockReturnValue({ data: { symbols: [] } });
    scanManifestPayload.initial_rows = [];
    scanChunkPayload.rows = [];
    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);
    await screen.findByRole('region', { name: '業種グループ トップ10の表（横スクロール）' });
    const regions = screen.getAllByRole('region', { name: /の表（横スクロール）$/ });
    expect(regions).toHaveLength(4);
    for (const region of regions) {
      expect(region).toHaveAttribute('tabindex', '0');
      region.focus();
      expect(region).toHaveFocus();
      for (const header of within(region).getAllByRole('columnheader')) {
        expect(header).toHaveStyle({ fontSize: '11px' });
      }
    }
  });

  it('keeps Daily market/rank values while using readable captions and Unicode minus', async () => {
    homePayload.key_markets = [
      { symbol: 'IDX', display_name: 'Market caption', latest_close: 99, currency: 'USD', change_1d: -1.25, history: [{ close: 100 }, { close: 99 }] },
      { symbol: 'UP', display_name: 'Up market', latest_close: 102, currency: 'USD', change_1d: 2.5, history: [{ close: 100 }, { close: 102 }] },
    ];
    homePayload.top_groups = [{ industry_group: 'Test sector', rank: 1, rank_change_1w: -3, rank_change_1m: 2 }];
    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);
    expect(await screen.findByText('−1.25%')).toBeInTheDocument();
    expect(screen.getByText('+2.50%')).toBeInTheDocument();
    expect(screen.getByText('−3')).toBeInTheDocument();
    expect(screen.queryByText('-1.25%')).not.toBeInTheDocument();
    expect(screen.getByText('Market caption')).toHaveStyle({ fontSize: '11px' });
    expect(within(screen.getByTestId('backtest-aligned-section')).getByText(/現在のスナップショットから/)).toHaveStyle({ fontSize: '11px' });
  });

  it.each([
    ['missing finance', { financial_current: null }],
    ['missing source', { financial_history: { source: null } }],
    ['zero financial history', { financial_history: { quarters: [], annual: [] } }],
    ['insufficient financial history', { financial_history: { annual: [{ fiscal_year: 2025, diluted_eps: 1 }] } }],
    ['zero price history', { technical_audit: { valid: false, bars: 0, values: {} } }],
    ['unknown market', { market_regime: null }],
    ['unknown volume', { volume: null, se_volume_vs_50d: null }],
  ])('renders actual Daily observations without a purchase pass for %s', async (_label, extra) => {
    const symbol = dailyObservationIndex.symbols[0].symbol;
    useStaticChartIndex.mockReturnValue({ data: {
      ...dailyObservationIndex,
      symbols: [{ ...dailyObservationIndex.symbols[0], buy: { ...dailyObservationIndex.symbols[0].buy, barrels_passed: undefined } }],
    } });
    scanManifestPayload.as_of_date = '2026-09-30';
    scanManifestPayload.initial_rows = [{ ...makeLeaderRow(1), symbol, passes_template: true, code33: true,
      market: 'US', market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true, ...extra }];
    scanManifestPayload.chunks = [];
    renderWithProviders(<MemoryRouter initialEntries={['/daily']}><StaticHomePage /></MemoryRouter>);
    const card = await screen.findByTestId('todays-buys-card');
    expect(card).toHaveTextContent('テクニカル観測記録');
    expect(card).toHaveTextContent('記録終値 66.23 · シグナル基準値 65.63');
    expect(card).toHaveTextContent('旧モデル確認数（barrels） 未確認');
    expect(card).toHaveTextContent('配信基準日 2026-10-01');
    expect(card).toHaveTextContent('スキャン基準日 2026-09-30');
    expect(card).toHaveTextContent('最新取引日は未確認');
    expect(card).toHaveTextContent('未確認や履歴不足は合格に数えません');
    expect(card.textContent).not.toMatch(/BUY NOW|今日の買い候補|日次の買い条件通過|size |now |資金|株数/);
    expect(within(card).getByRole('link', { name: `${symbol}の購入条件をResearchで確認` })).toHaveAttribute('href', `/?symbol=${symbol}`);
    expect(screen.getByTestId('top-scan-candidates-section')).toHaveTextContent('必要な条件を確認できず、現在の候補には数えていません');
  });

  it('wires both Daily model cards to the selected market instead of routing non-US symbols into Research', async () => {
    const symbol = '7203.T';
    useStaticManifest.mockReturnValue({ data: { markets: { JP: { ...manifest.markets.US, display_name: 'Japan' } } }, isLoading: false, isError: false });
    useStaticMarket.mockReturnValue({ selectedMarket: 'JP' });
    useStaticChartIndex.mockReturnValue({ data: { ...dailyObservationIndex, symbols: [{ ...dailyObservationIndex.symbols[0], symbol }] } });
    localStorage.setItem('todaysWatchlist', JSON.stringify([symbol]));
    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);
    const card = await screen.findByTestId('todays-buys-card');
    expect(card).toHaveAttribute('data-freshness', 'unverified');
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('watchlist-card')).queryByRole('link')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: `${symbol}の記録チャートを開く` }));
    expect(modalSpy).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, initialSymbol: symbol }));
  });

  it('keeps the technical reference filters, RS ordering, top-20 cap and market-cap control unchanged', async () => {
    scanManifestPayload.initial_rows = Array.from({ length: 21 }, (_, index) => makeLeaderRow(index + 1, {
      passes_template: true,
      rs_rating: index === 20 ? 70 : 95 - index,
      code33: false,
      ibd_group_rank: 150,
      market_cap: index === 0 ? 500_000_000 : 2_000_000_000,
    }));
    scanChunkPayload.rows = [
      makeLeaderRow(30, { symbol: 'WEAKRS', passes_template: true, rs_rating: 69 }),
      makeLeaderRow(31, { symbol: 'NOTEMPLATE', passes_template: false, rs_rating: 99 }),
      makeLeaderRow(32, { symbol: 'THINVOL', passes_template: true, volume: 99_999_999 }),
    ];
    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);
    const section = await screen.findByTestId('backtest-aligned-section');
    expect(within(section).getByText('テクニカル参考候補 トップ20')).toBeInTheDocument();
    expect(section).toHaveTextContent('市場の既定フィルターと選択中の時価総額下限');
    expect(section).toHaveTextContent('RS順に最大20銘柄');
    expect(section).not.toHaveTextContent(/15\.2|CAGR|6年|同じ選び方|同じ条件|バックテスト準拠/);
    expect(within(section).getAllByRole('row').slice(1).map(row => row.textContent.match(/LEAD\d+/)?.[0]))
      .toEqual(Array.from({ length: 20 }, (_, index) => `LEAD${String(index + 1).padStart(2, '0')}`));
    for (const symbol of ['WEAKRS', 'NOTEMPLATE', 'THINVOL', 'LEAD21']) {
      expect(within(section).queryByText(symbol)).not.toBeInTheDocument();
    }
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: '時価総額（下限）' }));
    await user.click(await screen.findByRole('option', { name: '>$1B' }));
    await waitFor(() => expect(within(section).queryByText('LEAD01')).not.toBeInTheDocument());
    expect(within(section).getByText('LEAD21')).toBeInTheDocument();
  });

  it.each(['US', 'HK'])('never requests or renders retired performance results for %s', async market => {
    useStaticManifest.mockReturnValue({
      data: { markets: { ...manifest.markets, HK: { ...manifest.markets.US, display_name: 'Hong Kong' } } },
      isLoading: false, isError: false,
    });
    useStaticMarket.mockReturnValue({ selectedMarket: market });
    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);
    const section = await screen.findByTestId('backtest-aligned-section');
    expect(section).toHaveTextContent('テクニカル参考候補 トップ20');
    expect(screen.queryByTestId('strategy-scorecard')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-evaluation-warning')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/15\.2|CAGR|6年|旧バックテスト記録/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('filters key market cards to entries with renderable close history', async () => {
    homePayload.key_markets = [
      {
        symbol: 'VALID',
        display_name: 'Valid Market',
        currency: 'USD',
        latest_close: 102,
        change_1d: 2,
        history: [{ close: 100 }, { close: null }, { close: 102 }],
      },
      {
        symbol: 'NULLS',
        display_name: 'Null History',
        currency: 'USD',
        latest_close: 10,
        change_1d: null,
        history: [{ close: null }],
      },
      {
        symbol: 'SINGLE',
        display_name: 'Single Close',
        currency: 'USD',
        latest_close: 20,
        change_1d: null,
        history: [{ close: 20 }],
      },
      {
        symbol: 'MISSING',
        display_name: 'Missing Price',
        currency: 'USD',
        latest_close: null,
        change_1d: null,
        history: [{ close: 19 }, { close: 20 }],
      },
    ];

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    expect(await screen.findByText('VALID')).toBeInTheDocument();
    expect(screen.queryByText('NULLS')).not.toBeInTheDocument();
    expect(screen.queryByText('SINGLE')).not.toBeInTheDocument();
    expect(screen.queryByText('MISSING')).not.toBeInTheDocument();
    expect(priceSparklineSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: [100, 102],
      showChange: false,
    }));
  });

  it('keeps technical-reference sparklines readable when financial candidates are unknown', async () => {
    scanChunkPayload.rows[0].price_sparkline_data = [20, 22, 24];
    scanChunkPayload.rows[0].price_trend = 1;
    scanChunkPayload.rows[0].price_change_1d = 12.3;

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    // 0700.HK now also appears in the backtest-aligned list (C97), so scope the
    // assertion to the top-candidates section it is testing.
    const topSection = await screen.findByTestId('backtest-aligned-section');
    expect(await within(topSection).findByText('0700.HK')).toBeInTheDocument();
    expect(priceSparklineSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: [20, 22, 24],
      width: 195,
      sparklineWidth: 150,
      change1d: 12.3,
    }));
  });

  it('does not display retained DXY history as a current quote under the newer home clock', async () => {
    const retainedHistory = [{ date: '2026-10-01', close: 101.02 }, { date: '2026-10-02', close: 101.93 }];
    homePayload.freshness.prices_generated_at = '2026-10-07T04:07:35Z';
    homePayload.freshness.scan_as_of_date = '2026-10-06';
    homePayload.key_markets = [
      { symbol: 'TVC:DXY', display_name: 'US Dollar Index', currency: 'USD', latest_close: null, change_1d: null,
        latest_date: '2026-10-02', history: retainedHistory,
        retained_price_history: { status: 'stale_reference_only', observation_date: '2026-10-02', target_as_of_date: '2026-10-06' } },
      { symbol: 'CURRENT', display_name: 'Current market', currency: 'USD', latest_close: 205, change_1d: 2.5,
        latest_date: '2026-10-06', history: [{ date: '2026-10-05', close: 200 }, { date: '2026-10-06', close: 205 }] },
    ];
    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);
    expect(await screen.findByText('CURRENT')).toBeInTheDocument();
    expect(screen.queryByText('TVC:DXY')).not.toBeInTheDocument();
    expect(screen.queryByText('US Dollar Index')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('101.93');
    expect(priceSparklineSpy.mock.calls.some(([props]) => props.data?.includes(101.93))).toBe(false);
    expect(homePayload.key_markets[0].history).toEqual(retainedHistory);
  });

  it('keeps the independent technical-reference market-cap filter and chart navigation aligned', async () => {
    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    // Symbols can appear in both the top-candidates and backtest-aligned lists
    // (C97), so scope every symbol assertion to the top-candidates section.
    const topSection = await screen.findByTestId('backtest-aligned-section');
    expect(await within(topSection).findByText('0700.HK')).toBeInTheDocument();
    expect(screen.getAllByText('時価総額').length).toBeGreaterThan(0);
    expect(within(topSection).getByText('$500.0M')).toBeInTheDocument();
    expect(within(topSection).queryByText('HK$3.9T')).not.toBeInTheDocument();
    expect(fetchStaticJson).toHaveBeenCalledWith('markets/us/scan/manifest.json', { publication: undefined });
    expect(fetchStaticJson).toHaveBeenCalledWith('markets/us/scan/chunks/chunk-0001.json', { publication: undefined, sha256: undefined });
    expect(screen.queryByText('SUMMARYONLY')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: '時価総額（下限）' }));
    await user.click(await screen.findByRole('option', { name: '>$1B' }));

    await waitFor(() => {
      expect(within(topSection).queryByText('0700.HK')).not.toBeInTheDocument();
    });
    expect(within(topSection).getByText('NVDA')).toBeInTheDocument();
    expect(within(topSection).getByText('AAPL')).toBeInTheDocument();

    await user.click(within(topSection).getByText('NVDA'));

    await waitFor(() => {
      const props = modalSpy.mock.calls.at(-1)?.[0];
      expect(props).toMatchObject({
        open: true,
        initialSymbol: 'NVDA',
        navigationSymbols: ['NVDA', 'AAPL'],
      });
    });
  });

  it('keeps the manifest volume floor and explains unknown financial prerequisites', async () => {
    scanManifestPayload.default_filters = { minVolume: 1_300_000 };
    scanManifestPayload.preset_screens = [makeLeadersPresetScreen(1_300_000)];
    scanManifestPayload.initial_rows = [
      {
        symbol: 'LOCALPASS',
        company_name: 'Local Liquid',
        passes_template: true,
        code33: true,
        rs_rating: 90,
        week_52_high_distance: -5,
        ibd_group_rank: 60,
        composite_score: 88.0,
        current_price: 12,
        rating: 'Buy',
        volume: 5_000_000,
        market_cap: 2_000_000_000,
        currency: 'SGD',
        price_sparkline_data: null,
        rs_sparkline_data: null,
      },
      {
        symbol: 'TOOTHIN',
        company_name: 'Too Thin',
        passes_template: true,
        code33: true,
        rs_rating: 90,
        week_52_high_distance: -5,
        ibd_group_rank: 60,
        composite_score: 99.0,
        current_price: 8,
        rating: 'Buy',
        volume: 900_000,
        market_cap: 2_000_000_000,
        currency: 'SGD',
        price_sparkline_data: null,
        rs_sparkline_data: null,
      },
    ];
    scanManifestPayload.chunks = [];

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    // LOCALPASS passes RS>=70 so it also lists in the backtest-aligned section
    // (C97); scope to the top-candidates section under test.
    const topSection = await screen.findByTestId('backtest-aligned-section');
    expect(await within(topSection).findByText('LOCALPASS')).toBeInTheDocument();
    expect(within(topSection).queryByText('TOOTHIN')).not.toBeInTheDocument();
    const financialSection=screen.getByTestId('top-scan-candidates-section');
    expect(financialSection).toHaveTextContent('財務・Code33の根拠が未確認の銘柄 2件');
    expect(financialSection).toHaveTextContent('売買代金 1,300,000 以上');
    expect(financialSection).not.toHaveTextContent('現在の条件に一致する銘柄はありません');
  });

  it('uses market liquidity defaults and composite ranking for leaders in leading groups', async () => {
    scanManifestPayload.default_filters = { minVolume: 1_300_000 };
    scanManifestPayload.preset_screens = [makeLeadersPresetScreen(1_300_000)];
    scanManifestPayload.initial_rows = [
      makeLeaderRow(1, {
        symbol: 'LOCALLEAD',
        composite_score: 64.23,
        rs_rating: 94.94,
        volume: 2_000_000,
        ibd_group_rank: 26,
      }),
      makeLeaderRow(2, {
        symbol: 'THINLEAD',
        composite_score: 65.0,
        rs_rating: 99,
        volume: 900_000,
        ibd_group_rank: 10,
      }),
    ];
    scanManifestPayload.chunks = [];

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    const leadersSection = await screen.findByTestId('leaders-in-leading-groups-section');
    expect(
      within(leadersSection).getByText('上位20銘柄: グループ順位40位以内、RS 80以上、売買代金 1,300,000 以上。')
    ).toBeInTheDocument();
    expect(within(leadersSection).getByText('LOCALLEAD')).toBeInTheDocument();
    expect(within(leadersSection).queryByText('THINLEAD')).not.toBeInTheDocument();
  });

  it('omits the leaders liquidity subtitle when the resolved preset has no volume floor', async () => {
    scanManifestPayload.default_filters = { minVolume: null };
    scanManifestPayload.preset_screens = [makeLeadersPresetScreen(null)];
    scanManifestPayload.initial_rows = [
      makeLeaderRow(1, {
        symbol: 'NOFLOOR',
        volume: 1,
        ibd_group_rank: 10,
        rs_rating: 90,
      }),
    ];
    scanManifestPayload.chunks = [];

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    const leadersSection = await screen.findByTestId('leaders-in-leading-groups-section');
    expect(
      within(leadersSection).getByText('上位20銘柄: グループ順位40位以内、RS 80以上。')
    ).toBeInTheDocument();
    expect(within(leadersSection).queryByText(/dollar volume >=/i)).not.toBeInTheDocument();
    expect(within(leadersSection).getByText('NOFLOOR')).toBeInTheDocument();
  });

  it('shows top 20 leaders in leading groups after top scan candidates with leader-scoped chart navigation', async () => {
    const leaderRows = Array.from({ length: 21 }, (_, index) => makeLeaderRow(index + 1));
    // Verifies preset sorting stays exact and does not demote IPO-weighted rows behind lower-scoring full rows.
    leaderRows[1] = makeLeaderRow(2, { scan_mode: 'ipo_weighted' });
    const rejectedRows = [
      makeLeaderRow(31, { symbol: 'WEAKRS', rs_rating: 79 }),
      makeLeaderRow(32, { symbol: 'LATEGROUP', ibd_group_rank: 41 }),
      makeLeaderRow(33, { symbol: 'LOWSCORE', composite_score: 69 }),
      makeLeaderRow(34, { symbol: 'THINVOL', volume: 99_999_999 }),
    ];
    useStaticChartIndex.mockReturnValue({
      data: {
        symbols: [
          { symbol: 'LEAD01', rank: 1, path: 'charts/LEAD01.json' },
          { symbol: 'LEAD02', rank: 2, path: 'charts/LEAD02.json' },
        ],
      },
    });
    fetchStaticJson.mockImplementation(async (path) => {
      if (path === 'markets/us/home.json') {
        return {
          market_display_name: 'United States',
          freshness: {
            scan_as_of_date: '2026-04-24',
            breadth_latest_date: '2026-04-24',
            groups_latest_date: '2026-04-24',
          },
          key_markets: [],
          scan_summary: { top_results: [] },
          top_groups: [],
        };
      }

      if (path === 'markets/us/scan/manifest.json') {
        return {
          initial_rows: [],
          chunks: [
            { path: 'markets/us/scan/chunks/chunk-0001.json' },
          ],
          preset_screens: [makeLeadersPresetScreen()],
        };
      }

      if (path === 'markets/us/scan/chunks/chunk-0001.json') {
        return {
          rows: [...leaderRows, ...rejectedRows],
        };
      }

      throw new Error(`Unexpected static path: ${path}`);
    });

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    const topCandidatesHeading = await screen.findByText('ミネルヴィニ合格 注目銘柄 トップ20');
    const leadersHeading = await screen.findByText('主導業種グループの主導銘柄');
    const topGroupsHeading = await screen.findByText('業種グループ トップ10');
    expect(
      topCandidatesHeading.compareDocumentPosition(leadersHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      leadersHeading.compareDocumentPosition(topGroupsHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const leadersSection = screen.getByTestId('leaders-in-leading-groups-section');
    expect(within(leadersSection).getByText('LEAD01')).toBeInTheDocument();
    expect(within(leadersSection).getByText('LEAD02')).toBeInTheDocument();
    expect(within(leadersSection).queryByText('LEAD21')).not.toBeInTheDocument();
    expect(within(leadersSection).queryByText('WEAKRS')).not.toBeInTheDocument();
    expect(within(leadersSection).queryByText('LATEGROUP')).not.toBeInTheDocument();
    expect(within(leadersSection).queryByText('LOWSCORE')).not.toBeInTheDocument();
    expect(within(leadersSection).queryByText('THINVOL')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(leadersSection).getByText('LEAD01'));

    await waitFor(() => {
      const props = modalSpy.mock.calls.at(-1)?.[0];
      expect(props).toMatchObject({
        open: true,
        initialSymbol: 'LEAD01',
        navigationSymbols: ['LEAD01', 'LEAD02'],
      });
    });
  });

  it('shows 価格更新 from freshness.prices_generated_at ahead of the scan date', async () => {
    homePayload.freshness.prices_generated_at = '2026-04-24T20:35:00Z';

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    const line = await screen.findByText(/価格更新 .+ · スキャン 2026-04-24/);
    expect(line).toBeInTheDocument();
  });

  it('omits the price label on pre-fast-publish bundles without the field', async () => {
    delete homePayload.freshness.prices_generated_at;
    delete homePayload.generated_at;

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    const line = await screen.findByText(/スキャン 2026-04-24/);
    expect(line.textContent).not.toContain('価格更新');
  });

  it('shows the shared market-regime banner when scan rows carry regime fields', async () => {
    scanChunkPayload.rows[0].market_regime = 'correction';
    scanChunkPayload.rows[0].market_health = 54;
    scanChunkPayload.rows[0].market_exposure_pct = 20;

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    expect(await screen.findByText('Correction')).toBeInTheDocument();
    expect(screen.getByText(/Health 54\/100/)).toBeInTheDocument();
  });
});
