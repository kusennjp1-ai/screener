import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import StaticHomePage from './StaticHomePage';

const fetchStaticJson = vi.fn();
const useStaticManifest = vi.fn();
const useStaticChartIndex = vi.fn();
const useStaticMarket = vi.fn();
const modalSpy = vi.fn();
const priceSparklineSpy = vi.fn();

vi.mock('../dataClient', () => ({
  fetchStaticJson: (...args) => fetchStaticJson(...args),
  useStaticManifest: (...args) => useStaticManifest(...args),
  // Mirrors the real resolver's tolerance of a missing manifest — the page must
  // survive the manifest itself failing to load.
  resolveStaticMarketEntry: (manifest, selectedMarket) => {
    const entry = manifest?.markets?.[selectedMarket];
    return {
      market: selectedMarket,
      display_name: entry?.display_name || selectedMarket,
      pages: entry?.pages || {},
      assets: entry?.assets || {},
    };
  },
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

  it('keeps top candidate price sparklines within the compact table width', async () => {
    scanChunkPayload.rows[0].price_sparkline_data = [20, 22, 24];
    scanChunkPayload.rows[0].price_trend = 1;
    scanChunkPayload.rows[0].price_change_1d = 12.3;

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    // 0700.HK now also appears in the backtest-aligned list (C97), so scope the
    // assertion to the top-candidates section it is testing.
    const topSection = await screen.findByTestId('top-scan-candidates-section');
    expect(await within(topSection).findByText('0700.HK')).toBeInTheDocument();
    expect(priceSparklineSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: [20, 22, 24],
      width: 137,
      sparklineWidth: 86,
      change1d: 12.3,
    }));
  });

  it('loads top candidates from the static scan bundle, filters by market cap, and keeps chart navigation aligned', async () => {
    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    // Symbols can appear in both the top-candidates and backtest-aligned lists
    // (C97), so scope every symbol assertion to the top-candidates section.
    const topSection = await screen.findByTestId('top-scan-candidates-section');
    expect(await within(topSection).findByText('0700.HK')).toBeInTheDocument();
    expect(screen.getAllByText('時価総額').length).toBeGreaterThan(0);
    expect(within(topSection).getByText('$500.0M')).toBeInTheDocument();
    expect(within(topSection).queryByText('HK$3.9T')).not.toBeInTheDocument();
    expect(fetchStaticJson).toHaveBeenCalledWith('markets/us/scan/manifest.json');
    expect(fetchStaticJson).toHaveBeenCalledWith('markets/us/scan/chunks/chunk-0001.json');
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

  it('uses the static scan manifest default volume for Daily top candidates', async () => {
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
    const topSection = await screen.findByTestId('top-scan-candidates-section');
    expect(await within(topSection).findByText('LOCALPASS')).toBeInTheDocument();
    expect(within(topSection).queryByText('TOOTHIN')).not.toBeInTheDocument();
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

  it('shows the price timestamp from freshness.prices_generated_at ahead of the scan date', async () => {
    homePayload.freshness.prices_generated_at = '2026-04-24T20:35:00Z';

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    const line = await screen.findByText(/価格 .+ · スキャン 2026-04-24/);
    expect(line).toBeInTheDocument();
  });

  it('omits the price label on pre-fast-publish bundles without the field', async () => {
    delete homePayload.freshness.prices_generated_at;
    delete homePayload.generated_at;

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    const line = await screen.findByText(/スキャン 2026-04-24/);
    expect(line.textContent).not.toContain('価格 ');
  });

  // The header used to print "騰落 - · グループ -" and wrap onto a second row to
  // say nothing — 100px of the first screen spent on placeholders.
  it('drops freshness fields the snapshot does not carry', async () => {
    homePayload.freshness = { scan_as_of_date: '2026-04-24' };
    delete homePayload.generated_at;

    renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

    const line = await screen.findByText(/スキャン 2026-04-24/);
    expect(line.textContent).toBe('スキャン 2026-04-24');
  });

  // C98 — one failed fetch used to blank the entire product: the page returned a
  // single red line and every loaded section disappeared with it.
  describe('partial degradation', () => {
    const OLD_ERROR = '日次スナップショットの読み込みに失敗しました。';

    it('keeps the scan sections when the home payload fails', async () => {
      fetchStaticJson.mockImplementation(async (path) => {
        if (path === 'markets/us/home.json') throw new Error('home 404');
        if (path === 'markets/us/scan/manifest.json') return scanManifestPayload;
        if (path === 'markets/us/scan/chunks/chunk-0001.json') return scanChunkPayload;
        throw new Error(`Unexpected static path: ${path}`);
      });

      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      const topSection = await screen.findByTestId('top-scan-candidates-section');
      expect(await within(topSection).findByText('0700.HK')).toBeInTheDocument();
      expect(screen.getByTestId('backtest-aligned-section')).toBeInTheDocument();
      expect(screen.getByTestId('leaders-in-leading-groups-section')).toBeInTheDocument();
      expect(screen.queryByText(OLD_ERROR)).not.toBeInTheDocument();

      const banner = screen.getByTestId('static-data-error-banner');
      expect(within(banner).getByTestId('static-data-failure-home')).toHaveTextContent('主要指数と業種グループ');
      expect(within(banner).queryByTestId('static-data-failure-scan')).not.toBeInTheDocument();
      expect(screen.getByTestId('top-groups-section')).toHaveTextContent('業種グループを読み込めませんでした');
    });

    it('keeps the index cards and group table when the scan bundle fails', async () => {
      homePayload.key_markets = [{
        symbol: 'SPY',
        display_name: 'S&P 500',
        currency: 'USD',
        latest_close: 500,
        change_1d: 0.5,
        history: [{ close: 495 }, { close: 500 }],
      }];
      homePayload.top_groups = [{
        industry_group: 'Semiconductors', rank: 1, rank_change_1w: 2, rank_change_1m: 5, top_symbol: 'NVDA',
      }];
      fetchStaticJson.mockImplementation(async (path) => {
        if (path === 'markets/us/home.json') return homePayload;
        throw new Error(`scan unavailable: ${path}`);
      });

      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      expect(await screen.findByText('SPY')).toBeInTheDocument();
      expect(screen.getByText('Semiconductors')).toBeInTheDocument();
      expect(screen.queryByText(OLD_ERROR)).not.toBeInTheDocument();
      expect(screen.getByTestId('static-data-failure-scan')).toHaveTextContent('スキャン結果');
      expect(screen.getByTestId('top-scan-candidates-section'))
        .toHaveTextContent('スキャン結果を読み込めませんでした');
    });

    it('still renders the page shell when the manifest itself fails', async () => {
      useStaticManifest.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });

      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      expect(await screen.findByText(/スナップショット$/)).toBeInTheDocument();
      expect(screen.getByTestId('static-data-failure-manifest')).toBeInTheDocument();
      expect(screen.getByTestId('top-groups-section')).toBeInTheDocument();
      expect(screen.queryByText(OLD_ERROR)).not.toBeInTheDocument();
    });

    it('recovers the failed section when 再試行 is tapped', async () => {
      let homeFails = true;
      fetchStaticJson.mockImplementation(async (path) => {
        if (path === 'markets/us/home.json') {
          if (homeFails) throw new Error('home 404');
          return homePayload;
        }
        if (path === 'markets/us/scan/manifest.json') return scanManifestPayload;
        if (path === 'markets/us/scan/chunks/chunk-0001.json') return scanChunkPayload;
        throw new Error(`Unexpected static path: ${path}`);
      });
      homePayload.top_groups = [{
        industry_group: 'Semiconductors', rank: 1, rank_change_1w: 2, rank_change_1m: 5, top_symbol: 'NVDA',
      }];

      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      await screen.findByTestId('static-data-error-banner');
      homeFails = false;
      await userEvent.setup().click(screen.getByTestId('static-data-retry'));

      expect(await screen.findByText('Semiconductors')).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.queryByTestId('static-data-error-banner')).not.toBeInTheDocument();
      });
    });
  });

  // (A) The page never used to state whether the market was buyable; you had to
  // scroll past every candidate to find two 1-day percentages.
  describe('market regime band', () => {
    it('states the verdict from the regime fields riding on the scan rows', async () => {
      scanChunkPayload.rows[0].market_regime = 'correction';
      scanChunkPayload.rows[0].market_health = 54;
      scanChunkPayload.rows[0].market_exposure_pct = 20;
      scanChunkPayload.rows[0].market_distribution_days = 6;

      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      const band = await screen.findByTestId('market-regime-band');
      expect(within(band).getByTestId('market-regime-verdict')).toHaveTextContent('待機');
      expect(within(band).getByTestId('market-regime-inputs'))
        .toHaveTextContent('健全度 54/100 · 売り抜け 6日');
      expect(within(band).getByTestId('market-regime-exposure')).toHaveTextContent('推奨 20%');
    });

    it('is the first element under the title, ahead of the buy list', async () => {
      scanChunkPayload.rows[0].market_regime = 'confirmed_uptrend';

      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      const band = await screen.findByTestId('market-regime-band');
      const topSection = screen.getByTestId('top-scan-candidates-section');
      expect(within(band).getByTestId('market-regime-verdict')).toHaveTextContent('買い場');
      expect(
        band.compareDocumentPosition(topSection) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('says 判定不能 rather than inventing a verdict when no row carries a regime', async () => {
      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      const band = await screen.findByTestId('market-regime-band');
      expect(within(band).getByTestId('market-regime-verdict')).toHaveTextContent('判定不能');
      expect(within(band).getByTestId('market-regime-inputs'))
        .toHaveTextContent('スキャン出力に地合いデータが含まれていません');
      expect(within(band).queryByText('買い場')).not.toBeInTheDocument();
      expect(within(band).queryByText('慎重')).not.toBeInTheDocument();
    });
  });

  // (B) 1200px of dead weight used to sit above the fold: the scorecard alone was
  // 568px of backtest receipts between the market verdict and today's buys.
  describe('strategy scorecard placement', () => {
    const scorecard = {
      metrics: {
        cagr_pct: 10.4,
        max_drawdown_pct: -15.8,
        payoff_distribution: { expectancy_r: 0.38 },
      },
      correction: '以前このカードは年率+15.2%と表示していましたが、検証側の不具合で過大でした。',
    };

    beforeEach(() => {
      globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => scorecard }));
    });

    it('collapses to a one-line summary that sits below the buy list', async () => {
      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      const row = await screen.findByTestId('scorecard-summary-row');
      expect(row).toHaveTextContent('検証実績');
      expect(row).toHaveTextContent('CAGR +10.4% · 最大DD -15.8% · 期待値 0.38R');
      expect(screen.queryByTestId('strategy-scorecard')).not.toBeInTheDocument();

      const buyListSlot = screen.getByTestId('buy-list-slot');
      expect(
        buyListSlot.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('keeps the 訂正 — one tap away, never deleted', async () => {
      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      const row = await screen.findByTestId('scorecard-summary-row');
      expect(screen.queryByTestId('scorecard-correction')).not.toBeInTheDocument();

      await userEvent.setup().click(row);

      expect(await screen.findByTestId('strategy-scorecard')).toBeInTheDocument();
      expect(screen.getByTestId('scorecard-correction')).toHaveTextContent('訂正');
    });
  });

  // (C) Four sections used to render an empty 540px <table> inside a 317px
  // scroller at once — ~1100px of chrome around nothing, empty message clipped.
  describe('zero-row sections', () => {
    it('collapses every empty section to a title bar and hides its prose', async () => {
      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      const groups = await screen.findByTestId('top-groups-section');
      expect(within(groups).getByTestId('top-groups-section-toggle')).toHaveTextContent('0件');
      // No table chrome at all — the headers used to render around zero rows.
      expect(within(groups).queryByRole('table')).not.toBeInTheDocument();
      expect(within(groups).queryByText('業種グループのデータがありません。')).not.toBeInTheDocument();
    });

    it('reveals the full untruncated empty message on tap', async () => {
      scanManifestPayload.initial_rows = [];
      scanManifestPayload.chunks = [];

      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      const section = await screen.findByTestId('top-scan-candidates-section');
      expect(within(section).queryByText('現在の条件に一致する銘柄はありません。')).not.toBeInTheDocument();

      await userEvent.setup().click(within(section).getByTestId('top-scan-candidates-section-toggle'));

      expect(within(section).getByText('現在の条件に一致する銘柄はありません。')).toBeInTheDocument();
      expect(within(section).getByText(/トレンドテンプレート合格/)).toBeInTheDocument();
    });

    it('keeps a failed section open, because the failure message is the content', async () => {
      fetchStaticJson.mockImplementation(async (path) => {
        if (path === 'markets/us/home.json') return homePayload;
        throw new Error(`scan unavailable: ${path}`);
      });

      renderWithProviders(<MemoryRouter><StaticHomePage /></MemoryRouter>);

      const section = await screen.findByTestId('top-scan-candidates-section');
      expect(within(section).getByTestId('top-scan-candidates-section-toggle'))
        .toHaveTextContent('読み込み失敗');
      expect(section).toHaveTextContent('スキャン結果を読み込めませんでした。上の再試行を押してください。');
    });
  });
});
