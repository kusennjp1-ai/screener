import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import TodaysBuysCard, { classifyEntry } from './TodaysBuysCard';

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

describe('classifyEntry', () => {
  it('follows the verdict precedence', () => {
    const e = { buy: buyBlock() };
    expect(classifyEntry(e, { marketRed: false, stale: false })).toBe('buy_now');
    expect(classifyEntry(e, { marketRed: false, stale: true })).toBe('stale');
    // past the +5% chase cap -> extended even when active
    const ext = { buy: buyBlock({ last_close: 132.5 * 1.07 }) };
    expect(classifyEntry(ext, { marketRed: false, stale: false })).toBe('extended');
    // no buy block -> pivot-only degrade, never a fabricated trigger
    expect(classifyEntry({ buy: null }, { marketRed: false, stale: false })).toBe('no_signal');
    // inactive signal below trigger -> waiting
    const waiting = { buy: buyBlock({ active: false, last_close: 128.0 }) };
    expect(classifyEntry(waiting, { marketRed: false, stale: false })).toBe('not_triggered');
    // active + in zone but only 0-1 confirmation barrels -> NOT a BUY NOW
    const unconfirmed = { buy: buyBlock({ barrels_passed: 0 }) };
    expect(classifyEntry(unconfirmed, { marketRed: false, stale: false })).toBe('not_triggered');
    const oneBarrel = { buy: buyBlock({ barrels_passed: 1 }) };
    expect(classifyEntry(oneBarrel, { marketRed: false, stale: false })).toBe('not_triggered');
    // 2 of 3 barrels is enough
    const twoBarrels = { buy: buyBlock({ barrels_passed: 2 }) };
    expect(classifyEntry(twoBarrels, { marketRed: false, stale: false })).toBe('buy_now');
    // unknown barrel count (older export) keeps the old behaviour
    const legacy = { buy: buyBlock({ barrels_passed: undefined }) };
    expect(classifyEntry(legacy, { marketRed: false, stale: false })).toBe('buy_now');
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
    expect(screen.getByText('BUY NOW')).toBeInTheDocument();
    // the risk→reward ladder ticks (graphical C87) carry the real prices
    expect(screen.getByText('STOP')).toBeInTheDocument();
    expect(screen.getByText('PIVOT')).toBeInTheDocument();
    expect(screen.getByText('132.50')).toBeInTheDocument(); // pivot tick
    expect(screen.getByText('149.30')).toBeInTheDocument(); // 2R tick
    expect(screen.getByText('157.70')).toBeInTheDocument(); // 3R tick
    expect(screen.getByText(/stop 124\.10/)).toBeInTheDocument(); // footer basis line
    expect(screen.getByText(/size 19\.8%/)).toBeInTheDocument();
  });

  it('degrades a null-buy row to pivot-only honesty', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([
          { symbol: 'NVDA', rank: 1, buy: buyBlock() },
          { symbol: 'XYZ', rank: 9, buy: null },
        ])}
        scanRows={uptrendRows}
      />,
    );
    const row = screen.getByTestId('todays-buys-row-XYZ');
    expect(row).toHaveTextContent('pivot情報なし');
    expect(row.textContent).not.toMatch(/BUY ZONE/);
    expect(row.textContent).not.toMatch(/stop/);
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
    expect(screen.queryByText('BUY NOW')).not.toBeInTheDocument();
  });

  it('forces STALE when the export as_of is old', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={{ as_of_date: '2020-01-02', symbols: [{ symbol: 'NVDA', rank: 1, buy: buyBlock() }] }}
        scanRows={uptrendRows}
      />,
    );
    expect(screen.getByText(/データ未更新/)).toBeInTheDocument();
    expect(screen.queryByText('BUY NOW')).not.toBeInTheDocument();
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
    expect(screen.getByText('BUY NOW')).toBeInTheDocument();
  });

  it('downgrades an unconfirmed breakout (0 barrels) from BUY NOW to WAIT', () => {
    renderWithProviders(
      <TodaysBuysCard
        indexData={indexData([{ symbol: 'AVT', rank: 1, buy: buyBlock({ barrels_passed: 0 }) }])}
        scanRows={uptrendRows}
      />,
    );
    expect(screen.queryByText('BUY NOW')).not.toBeInTheDocument();
    expect(screen.getByText('WAIT')).toBeInTheDocument();
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
