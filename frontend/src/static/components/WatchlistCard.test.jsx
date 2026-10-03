import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { MemoryRouter } from 'react-router-dom';
import WatchlistCard, { orderWatchRows } from './WatchlistCard';

const sell = (over = {}) => ({
  action: 'hold', stop: 118.2, stop_basis: 'initial', r_multiple: 0.4, last_close: 130.0, ...over,
});

const renderCard = ui => renderWithProviders(<MemoryRouter>{ui}</MemoryRouter>);

const indexData = (symbols) => ({ as_of_date: '2026-07-17', symbols });

function seedWatchlist(list) {
  localStorage.setItem('todaysWatchlist', JSON.stringify(list));
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('orderWatchRows', () => {
  it('sorts by exit urgency then symbol', () => {
    const rows = [
      { symbol: 'HLD', sell: { action: 'hold' }, present: true },
      { symbol: 'BRK', sell: { action: 'exit' }, present: true },
      { symbol: 'STP', sell: { action: 'stop_hit' }, present: true },
      { symbol: 'TGT', sell: { action: 'tighten_stop' }, present: true },
    ];
    expect(orderWatchRows(rows).map((r) => r.symbol)).toEqual(['STP', 'BRK', 'TGT', 'HLD']);
  });

  it('treats a missing/null sell as hold (bottom)', () => {
    const rows = [
      { symbol: 'AAA', sell: null, present: false },
      { symbol: 'BBB', sell: { action: 'exit' }, present: true },
    ];
    expect(orderWatchRows(rows).map((r) => r.symbol)).toEqual(['BBB', 'AAA']);
  });
});

describe('WatchlistCard', () => {
  it('renders nothing when the watchlist is empty', () => {
    const { container } = renderCard(
      <WatchlistCard indexData={indexData([{ symbol: 'NVDA', sell: sell() }])} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('surfaces a held name breaking its 50-DMA with the exit action and stop', () => {
    seedWatchlist(['NVDA']);
    renderCard(
      <WatchlistCard indexData={indexData([
        { symbol: 'NVDA', sell: sell({ action: 'exit', stop: 122.5, stop_basis: 'base_low' }) },
      ])} />,
    );
    expect(screen.getByTestId('watchlist-action-NVDA')).toHaveTextContent('50日線割れ');
    expect(screen.getByTestId('watchlist-row-NVDA')).toHaveTextContent('モデル停止水準 122.50');
    expect(screen.getByTestId('watchlist-alert-count')).toHaveTextContent('水準割れの記録 1件');
  });

  it('orders the most urgent exit to the top', () => {
    seedWatchlist(['AAA', 'BBB', 'CCC']);
    renderCard(
      <WatchlistCard indexData={indexData([
        { symbol: 'AAA', sell: sell({ action: 'hold' }) },
        { symbol: 'BBB', sell: sell({ action: 'stop_hit' }) },
        { symbol: 'CCC', sell: sell({ action: 'tighten_stop' }) },
      ])} />,
    );
    const rendered = screen.getAllByTestId(/^watchlist-row-/).map((el) => el.getAttribute('data-testid'));
    expect(rendered[0]).toBe('watchlist-row-BBB');
  });

  it('shows a no-data line for a watched symbol absent from today export', () => {
    seedWatchlist(['GONE']);
    renderCard(<WatchlistCard indexData={indexData([{ symbol: 'NVDA', sell: sell() }])} />);
    expect(screen.getByTestId('watchlist-row-GONE')).toHaveTextContent('今回の配信に記録なし');
  });

  it('removes a symbol when its star is tapped', () => {
    seedWatchlist(['NVDA']);
    renderCard(<WatchlistCard indexData={indexData([{ symbol: 'NVDA', sell: sell() }])} />);
    fireEvent.click(screen.getByTestId('watchlist-remove-NVDA'));
    expect(JSON.parse(localStorage.getItem('todaysWatchlist'))).toEqual([]);
  });

  it('opens the chart from its explicit button', () => {
    seedWatchlist(['NVDA']);
    const onOpen = vi.fn();
    renderCard(
      <WatchlistCard indexData={indexData([{ symbol: 'NVDA', sell: sell() }])} onOpenChart={onOpen} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'NVDAの記録チャートを開く' }));
    expect(onOpen).toHaveBeenCalledWith('NVDA');
  });
});

it('keeps saved records visible without holdings or P&L claims', () => {
  seedWatchlist(['CDNA']);
  localStorage.setItem('wlLastSell', JSON.stringify({ CDNA: { date: '2026-10-01', sell: sell({ stop: 59.07, r_multiple: 0.09 }) } }));
  renderCard(<WatchlistCard indexData={indexData([])} />);
  const row = screen.getByTestId('watchlist-row-CDNA');
  expect(row).toHaveTextContent('前回の保存記録・鮮度未確認');
  expect(row).toHaveTextContent('配信基準日 2026-10-01');
  expect(row).toHaveTextContent('モデル停止水準 59.07');
  expect(row.textContent).not.toMatch(/保有継続|要売却|0\.1R|0\.09R/);
  expect(screen.queryByRole('link', { name: 'CDNAの購入条件をResearchで確認' })).not.toBeInTheDocument();
});
it.each([undefined, 'invalid', '2026-02-30', '2999-01-01'])('does not imply current exits for date %j', asOf => {
  seedWatchlist(['CDNA']);
  renderCard(<WatchlistCard indexData={{ as_of_date: asOf, symbols: [{ symbol: 'CDNA', sell: sell({ action: 'exit' }) }] }} />);
  expect(screen.getByTestId('sell-timing')).toHaveTextContent('未確認');
  expect(screen.getByTestId('watchlist-card')).not.toHaveTextContent('要売却');
});
it('updates a mounted watch model reference after the calendar boundary', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T03:59:30Z'));
  seedWatchlist(['CDNA']);
  const { unmount } = renderCard(<WatchlistCard indexData={{ as_of_date: '2026-10-01', symbols: [{ symbol: 'CDNA', sell: sell() }] }} />);
  expect(screen.getByTestId('sell-timing')).toHaveAttribute('data-freshness', 'unverified');
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByTestId('sell-timing')).toHaveAttribute('data-freshness', 'old');
  unmount();
  vi.useRealTimers();
});

it('does not assign an absent watched symbol to US Research after a market switch', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T03:00:00Z'));
  seedWatchlist(['7203.T', 'CDNA']);
  const jpIndex = { as_of_date: '2026-10-02', symbols: [{ symbol: '7203.T', sell: sell() }] };
  const usIndex = { as_of_date: '2026-10-01', symbols: [{ symbol: 'CDNA', sell: sell() }] };
  const { rerender } = renderCard(<WatchlistCard indexData={jpIndex} market="JP" />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  rerender(<MemoryRouter><WatchlistCard indexData={usIndex} market="US" /></MemoryRouter>);
  expect(screen.getByTestId('watchlist-row-7203.T')).toHaveTextContent('前回の保存記録');
  expect(screen.getByTestId('watchlist-row-7203.T')).not.toHaveTextContent('未来');
  expect(screen.queryByRole('link', { name: '7203.Tの購入条件をResearchで確認' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'CDNAの購入条件をResearchで確認' })).toHaveAttribute('href', '/?symbol=CDNA');
  expect(JSON.parse(localStorage.getItem('todaysWatchlist'))).toEqual(['7203.T', 'CDNA']);
  expect(JSON.parse(localStorage.getItem('wlLastSell'))['7203.T']).toEqual({ date: '2026-10-02', sell: sell() });
});
