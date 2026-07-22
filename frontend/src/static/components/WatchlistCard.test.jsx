import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import WatchlistCard, { orderWatchRows } from './WatchlistCard';

const sell = (over = {}) => ({
  action: 'hold', stop: 118.2, stop_basis: 'initial', r_multiple: 0.4, last_close: 130.0, ...over,
});

const indexData = (symbols) => ({ as_of_date: '2026-07-17', symbols });

function seedWatchlist(list) {
  localStorage.setItem('todaysWatchlist', JSON.stringify(list));
}

afterEach(() => {
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
    const { container } = renderWithProviders(
      <WatchlistCard indexData={indexData([{ symbol: 'NVDA', sell: sell() }])} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('surfaces a held name breaking its 50-DMA with the exit action and stop', () => {
    seedWatchlist(['NVDA']);
    renderWithProviders(
      <WatchlistCard indexData={indexData([
        { symbol: 'NVDA', sell: sell({ action: 'exit', stop: 122.5, stop_basis: 'base_low' }) },
      ])} />,
    );
    expect(screen.getByTestId('watchlist-action-NVDA')).toHaveTextContent('50日線割れ');
    expect(screen.getByTestId('watchlist-row-NVDA')).toHaveTextContent('stop 122.50');
    expect(screen.getByTestId('watchlist-alert-count')).toHaveTextContent('要売却 1件');
  });

  it('orders the most urgent exit to the top', () => {
    seedWatchlist(['AAA', 'BBB', 'CCC']);
    renderWithProviders(
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
    renderWithProviders(<WatchlistCard indexData={indexData([{ symbol: 'NVDA', sell: sell() }])} />);
    expect(screen.getByTestId('watchlist-row-GONE')).toHaveTextContent('本日データ未取得');
  });

  it('removes a symbol when its star is tapped', () => {
    seedWatchlist(['NVDA']);
    renderWithProviders(<WatchlistCard indexData={indexData([{ symbol: 'NVDA', sell: sell() }])} />);
    fireEvent.click(screen.getByTestId('watchlist-remove-NVDA'));
    expect(JSON.parse(localStorage.getItem('todaysWatchlist'))).toEqual([]);
  });

  it('opens the chart when a row body is tapped', () => {
    seedWatchlist(['NVDA']);
    const onOpen = vi.fn();
    renderWithProviders(
      <WatchlistCard indexData={indexData([{ symbol: 'NVDA', sell: sell() }])} onOpenChart={onOpen} />,
    );
    fireEvent.click(screen.getByTestId('watchlist-row-NVDA'));
    expect(onOpen).toHaveBeenCalledWith('NVDA');
  });
});
