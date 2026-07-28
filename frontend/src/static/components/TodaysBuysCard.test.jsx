import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import TodaysBuysCard, { classifyEntry, isBenchmarkSymbol, stopBasisLabel } from './TodaysBuysCard';

const buyBlock = (over = {}) => ({
  active: true,
  trigger_price: 132.5,
  stop_loss: 124.1,
  stop_pct: 6.3,
  stop_basis: 'base_low',
  position_size_pct: 19.8,
  account_risk_pct: 1.25,
  target_price_2r: 149.3,
  target_price_3r: 157.7,
  vcp_detected: true,
  vcp_source: 'vcp',
  barrels_passed: 3,
  signal_as_of: '2026-07-17T00:00:00',
  last_close: 134.2, // in zone (+1.3%)
  ...over,
});

const today = new Date().toISOString().slice(0, 10);

const indexData = (entries) => ({ as_of_date: today, symbols: entries });
const uptrendRows = [{ market_regime: 'confirmed_uptrend', market_health: 78 }];

const rowSymbols = () => screen
  .queryAllByTestId(/^todays-buys-row-/)
  .map((el) => el.getAttribute('data-testid').replace('todays-buys-row-', ''));

describe('classifyEntry', () => {
  it('follows the verdict precedence', () => {
    const e = { symbol: 'NVDA', buy: buyBlock() };
    expect(classifyEntry(e, { marketRed: false, stale: false })).toBe('buy_now');
    // stale data or a red market can only DEMOTE — never a buy off untrusted data
    expect(classifyEntry(e, { marketRed: false, stale: true })).toBe('not_triggered');
    expect(classifyEntry(e, { marketRed: true, stale: false })).toBe('not_triggered');
    // past the +5% chase cap -> extended even when active
    const ext = { symbol: 'NVDA', buy: buyBlock({ last_close: 132.5 * 1.07 }) };
    expect(classifyEntry(ext, { marketRed: false, stale: false })).toBe('extended');
    // no buy block -> no signal (this card drops those rows)
    expect(classifyEntry({ symbol: 'XYZ', buy: null }, {})).toBe('no_signal');
    // inactive signal below trigger -> waiting
    const waiting = { symbol: 'NVDA', buy: buyBlock({ active: false, last_close: 128.0 }) };
    expect(classifyEntry(waiting, { marketRed: false, stale: false })).toBe('not_triggered');
    // active + in zone but only 0-1 confirmation barrels -> NOT a BUY NOW
    const unconfirmed = { symbol: 'NVDA', buy: buyBlock({ barrels_passed: 0 }) };
    expect(classifyEntry(unconfirmed, { marketRed: false, stale: false })).toBe('not_triggered');
    const oneBarrel = { symbol: 'NVDA', buy: buyBlock({ barrels_passed: 1 }) };
    expect(classifyEntry(oneBarrel, { marketRed: false, stale: false })).toBe('not_triggered');
    // 2 of 3 barrels is enough
    const twoBarrels = { symbol: 'NVDA', buy: buyBlock({ barrels_passed: 2 }) };
    expect(classifyEntry(twoBarrels, { marketRed: false, stale: false })).toBe('buy_now');
    // unknown barrel count (older export) keeps the old behaviour
    const legacy = { symbol: 'NVDA', buy: buyBlock({ barrels_passed: undefined }) };
    expect(classifyEntry(legacy, { marketRed: false, stale: false })).toBe('buy_now');
  });

  it('hard-excludes benchmarks and index ETFs from the candidate classifier', () => {
    ['SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'TQQQ', '^GSPC', '1306.T', 'spy'].forEach((symbol) => {
      expect(isBenchmarkSymbol(symbol)).toBe(true);
      expect(classifyEntry({ symbol, buy: buyBlock() }, { marketRed: false, stale: false }))
        .toBe('benchmark');
    });
    ['NVDA', 'IBB', 'FTNT', 'LLY'].forEach((symbol) => {
      expect(isBenchmarkSymbol(symbol)).toBe(false);
    });
  });
});

describe('stopBasisLabel', () => {
  it('maps every engineering enum to Japanese and hides unknown ones', () => {
    expect(stopBasisLabel('initial')).toBe('初期ストップ');
    expect(stopBasisLabel('half_risk')).toBe('半分利食い後');
    expect(stopBasisLabel('max_loss_cap')).toBe('最大損失ライン');
    expect(stopBasisLabel('base_low')).toBe('ベース安値');
    expect(stopBasisLabel('some_new_enum')).toBeNull();
    expect(stopBasisLabel(null)).toBeNull();
  });
});

describe('TodaysBuysCard', () => {
  it('renders a full BUY NOW card with zone, stop, size and targets', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([{ symbol: 'NVDA', rank: 1, rs_rating: 94, buy: buyBlock() }])}
        scanRows={uptrendRows}
      />,
    );
    expect(screen.getByText('ゾーン内 — 買い')).toBeInTheDocument();
    // the risk→reward ladder ticks (graphical C87) carry the real prices
    expect(screen.getByText('損切り')).toBeInTheDocument();
    expect(screen.getByText('ピボット')).toBeInTheDocument();
    expect(screen.getByText('132.50')).toBeInTheDocument(); // pivot tick
    expect(screen.getByText('149.30')).toBeInTheDocument(); // 2R tick
    expect(screen.getByText('157.70')).toBeInTheDocument(); // 3R tick
    expect(screen.getByText(/損切り 124\.10/)).toBeInTheDocument(); // footer basis line
    expect(screen.getByText(/比率 19\.8%/)).toBeInTheDocument();
  });

  it('shows only genuine buy candidates, best first, and hides the rest', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([
          // a wait (below its pivot) and an extended name -> 監視中 only
          { symbol: 'GEV', buy: buyBlock({ last_close: 120.0 }) },
          { symbol: 'IBB', buy: buyBlock({ last_close: 132.5 * 1.061 }) },
          // no computed signal -> dropped from this card entirely
          { symbol: 'AA', buy: { active: false, trigger_price: null, last_close: 54.1 } },
          { symbol: 'MSFT', buy: null },
          // benchmarks -> never candidates
          { symbol: 'SPY', buy: buyBlock() },
          { symbol: 'QQQ', buy: buyBlock() },
          // two real candidates; FTNT has fewer barrels than LLY
          { symbol: 'FTNT', rs_rating: 91, buy: buyBlock({ barrels_passed: 2 }) },
          { symbol: 'LLY', rs_rating: 88, buy: buyBlock({ barrels_passed: 3 }) },
        ])}
        scanRows={uptrendRows}
      />,
    );
    // exactly the two buy candidates are rendered, strongest setup first
    expect(rowSymbols()).toEqual(['LLY', 'FTNT']);
    // the watch names live behind a collapsed disclosure
    expect(screen.getByTestId('todays-buys-watch-toggle')).toHaveTextContent('監視中 (2)');
    fireEvent.click(screen.getByTestId('todays-buys-watch-toggle'));
    expect(rowSymbols()).toEqual(['LLY', 'FTNT', 'IBB', 'GEV']);
    // no-signal rows and benchmarks never appear, expanded or not
    const card = screen.getByTestId('todays-buys-card');
    ['SPY', 'QQQ', 'AA', 'MSFT'].forEach((symbol) => {
      expect(within(card).queryByTestId(`todays-buys-row-${symbol}`)).toBeNull();
      expect(card).not.toHaveTextContent(symbol);
    });
  });

  it('answers with one line when nothing qualifies', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([
          { symbol: 'SPY', buy: buyBlock() },
          { symbol: 'AA', buy: { active: false, trigger_price: null, last_close: 54.1 } },
        ])}
        scanRows={uptrendRows}
      />,
    );
    expect(screen.getByTestId('todays-buys-empty')).toHaveTextContent('本日の新規買い候補: 0件');
    expect(rowSymbols()).toEqual([]);
    expect(screen.queryByTestId('todays-buys-watch-section')).toBeNull();
  });

  it('never prints a raw stop_basis enum', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([{
          symbol: 'NVDA',
          buy: buyBlock({ stop_basis: 'initial' }),
          sell: { action: 'raise_stop', stop: 173.43, stop_basis: 'half_risk' },
        }])}
        scanRows={uptrendRows}
      />,
    );
    const card = screen.getByTestId('todays-buys-card');
    expect(card).toHaveTextContent('初期ストップ');
    expect(card).toHaveTextContent('半分利食い後');
    ['initial', 'half_risk', 'max_loss_cap', 'base_low'].forEach((raw) => {
      expect(card).not.toHaveTextContent(raw);
    });
  });

  it('renders nothing at all on a pre-v2 index without buy blocks', () => {
    const { container } = renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([{ symbol: 'AAA', rank: 1 }, { symbol: 'BBB', rank: 2 }])}
        scanRows={uptrendRows}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('collapses the whole list when the market regime is red', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([{ symbol: 'NVDA', rank: 1, buy: buyBlock() }])}
        scanRows={[{ market_regime: 'correction' }]}
      />,
    );
    expect(screen.getByTestId('todays-buys-market-red')).toBeInTheDocument();
    expect(screen.queryByText('ゾーン内 — 買い')).not.toBeInTheDocument();
    expect(screen.getByTestId('todays-buys-watch-toggle')).toHaveTextContent('監視中 (1)');
  });

  it('issues no buy judgement when the export as_of is old', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={{ as_of_date: '2020-01-02', symbols: [{ symbol: 'NVDA', rank: 1, buy: buyBlock() }] }}
        scanRows={uptrendRows}
      />,
    );
    expect(screen.getByTestId('todays-buys-empty')).toHaveTextContent('本日の新規買い候補: 0件');
    expect(screen.queryByText('ゾーン内 — 買い')).not.toBeInTheDocument();
  });

  // Staleness is counted in trading sessions. The old 4-calendar-day constant
  // called a Friday snapshot fresh on the following Tuesday.
  describe('trading-session staleness', () => {
    // 2026-07-24 Fri · 2026-07-25 Sat · 2026-07-27 Mon · 2026-07-28 Tue
    const FRIDAY = '2026-07-24';
    const et = (iso) => new Date(`${iso}-04:00`); // July = EDT (UTC-4)
    const fridaySnapshot = { as_of_date: FRIDAY, symbols: [{ symbol: 'NVDA', rank: 1, buy: buyBlock() }] };

    it('keeps a Friday snapshot buyable over the weekend', () => {
      renderWithProviders(
        <TodaysBuysCard indexData={fridaySnapshot} scanRows={uptrendRows} market="US" now={et('2026-07-25T12:00:00')} />,
      );
      expect(screen.getByText('ゾーン内 — 買い')).toBeInTheDocument();
      expect(screen.queryByTestId('todays-buys-empty')).not.toBeInTheDocument();
    });

    it('keeps it buyable on Monday morning, before Monday has closed', () => {
      renderWithProviders(
        <TodaysBuysCard indexData={fridaySnapshot} scanRows={uptrendRows} market="US" now={et('2026-07-27T10:00:00')} />,
      );
      expect(screen.getByText('ゾーン内 — 買い')).toBeInTheDocument();
    });

    it('downgrades every row once a completed session has gone by', () => {
      renderWithProviders(
        <TodaysBuysCard indexData={fridaySnapshot} scanRows={uptrendRows} market="US" now={et('2026-07-28T10:00:00')} />,
      );
      expect(screen.queryByText('ゾーン内 — 買い')).not.toBeInTheDocument();
      expect(screen.getByTestId('todays-buys-empty'))
        .toHaveTextContent('データが最新ではないため判定は出していません');
      // the page-level banner owns the staleness message — no per-row badges
      expect(screen.getByTestId('todays-buys-card')).not.toHaveTextContent('データ未更新');
    });

    it('does not flash stale during the post-close publish window', () => {
      renderWithProviders(
        <TodaysBuysCard indexData={fridaySnapshot} scanRows={uptrendRows} market="US" now={et('2026-07-27T16:30:00')} />,
      );
      expect(screen.getByText('ゾーン内 — 買い')).toBeInTheDocument();
    });
  });

  it('shows exact share count once equity is set', () => {
    localStorage.setItem('todaysBuysEquity', '10000');
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([{ symbol: 'NVDA', rank: 1, buy: buyBlock() }])}
        scanRows={uptrendRows}
      />,
    );
    // floor(10000 * 0.198 / 134.20) = 14
    expect(screen.getByText(/14株/)).toBeInTheDocument();
    localStorage.removeItem('todaysBuysEquity');
  });

  it('adds a symbol to the watchlist when its star is tapped', () => {
    localStorage.removeItem('todaysWatchlist');
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([{ symbol: 'NVDA', rank: 1, rs_rating: 94, buy: buyBlock() }])}
        scanRows={uptrendRows}
      />,
    );
    fireEvent.click(screen.getByTestId('todays-buys-watch-NVDA'));
    expect(JSON.parse(localStorage.getItem('todaysWatchlist'))).toEqual(['NVDA']);
    localStorage.removeItem('todaysWatchlist');
  });

  it('shows a "do less" caution when the market is under pressure', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([{ symbol: 'NVDA', rank: 1, buy: buyBlock() }])}
        scanRows={[{ market_regime: 'uptrend_under_pressure', market_distribution_days: 8 }]}
      />,
    );
    const note = screen.getByTestId('todays-buys-under-pressure');
    expect(note).toHaveTextContent('数を絞る');
    expect(note).toHaveTextContent('分配日 8');
    // candidates still list (unlike a red market) — the user just does less
    expect(screen.getByText('ゾーン内 — 買い')).toBeInTheDocument();
  });

  it('downgrades an unconfirmed breakout (0 barrels) to the watch list', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([{ symbol: 'AVT', rank: 1, buy: buyBlock({ barrels_passed: 0 }) }])}
        scanRows={uptrendRows}
      />,
    );
    expect(screen.queryByText('ゾーン内 — 買い')).not.toBeInTheDocument();
    expect(screen.getByTestId('todays-buys-empty')).toHaveTextContent('本日の新規買い候補: 0件');
    fireEvent.click(screen.getByTestId('todays-buys-watch-toggle'));
    expect(screen.getByTestId('todays-buys-verdict-AVT')).toHaveTextContent('待機');
  });

  it('opens the chart when a row is tapped', () => {
    const onOpen = vi.fn();
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([{ symbol: 'NVDA', rank: 1, buy: buyBlock() }])}
        scanRows={uptrendRows}
        onOpenChart={onOpen}
      />,
    );
    fireEvent.click(screen.getByTestId('todays-buys-row-NVDA'));
    expect(onOpen).toHaveBeenCalledWith('NVDA');
  });
});
