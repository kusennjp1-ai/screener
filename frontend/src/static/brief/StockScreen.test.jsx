import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// The stock screen's body (StockView) is a lazy chunk (stockViewLoader.js). Here the chunk is a stand-in whose load can be
// held, failed or let through, and each test starts from a fresh loader (no chunk loaded, no failure), as a page does.
const chunk = vi.hoisted(() => ({ gate: null, fail: false, throwOnRender: false }));
// A fresh stand-in per test (vi.doMock below): a mocked module's factory result is kept across vi.resetModules.
const standIn = async () => {
  if (chunk.gate) await chunk.gate.promise;
  if (chunk.fail) throw new Error('Failed to fetch dynamically imported module');
  const { createElement } = await import('react');
  return { default: function StockView({ data, header, wide }) {
    if (chunk.throwOnRender) throw new Error('a render error of the stock screen');
    return createElement('div', { className: 'brief-stock' }, header, createElement('p', { 'data-testid': 'brief-conclusion' }, `${data.symbol} ${wide ? 'wide' : 'phone'}`));
  } };
};
vi.mock('./useBriefData', () => ({ useStockData: symbol => ({ symbol, item: { symbol }, view: { price: 12.5, name: 'Zeta Corp', sector: 'Tech' } }) }));

const brief = { bundle: { data: {} }, market: null, date: '2026-10-02' };
const props = { brief, symbol: 'ZZNV', watch: [], onToggleWatch: () => {}, step: () => {} };
const held = () => { let open; const promise = new Promise(resolve => { open = resolve; }); return { promise, open }; };
const LOADING = '銘柄データを読み込み中…';
let StockScreen, loader;

beforeEach(async () => {
  Object.assign(chunk, { gate: null, fail: false, throwOnRender: false });
  vi.resetModules();
  vi.doMock('./StockView', standIn);
  ({ default: StockScreen } = await import('./StockScreen'));
  loader = await import('./stockViewLoader');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the stock screen while its chunk loads', () => {
  it('renders a chunk already loaded in the same pass, with no loading frame (a phone opens a stock once its chunk has settled)', async () => {
    await loader.loadStockView();
    render(<StockScreen {...props} />);
    // No await: the first commit already holds the screen.
    expect(screen.getByTestId('brief-conclusion')).toHaveTextContent('ZZNV phone');
    expect(screen.queryByText(LOADING)).toBeNull();
  });

  it('shows the screen\'s loading line under the desktop header while the chunk loads, then the screen', async () => {
    chunk.gate = held();
    render(<StockScreen {...props} wide />);
    expect(screen.getByRole('status')).toHaveTextContent(LOADING);
    // The pane keeps its header (ticker, price, ☆ and the steps) while the body loads.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('ZZNV');
    expect(screen.getByRole('button', { name: 'ウォッチに追加' })).toBeInTheDocument();
    expect(screen.queryByTestId('brief-conclusion')).toBeNull();
    await act(async () => { chunk.gate.open(); await loader.loadStockView(); });
    expect(screen.getByTestId('brief-conclusion')).toHaveTextContent('ZZNV wide');
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });

  it('says the screen cannot be loaded, with a 再読み込み button that reloads the page, when the chunk fails', async () => {
    chunk.fail = true;
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location, reload } });
    try {
      render(<StockScreen {...props} />);
      expect(screen.getByRole('status')).toHaveTextContent(LOADING);
      const button = await screen.findByRole('button', { name: '再読み込み' });
      expect(screen.getByRole('alert')).toHaveTextContent('銘柄の画面を読み込めません（通信状態を確認して、再読み込みしてください）');
      expect(screen.queryByText(LOADING)).toBeNull();
      expect(loader.stockViewFailed()).toBe(true);
      fireEvent.click(button);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally { Object.defineProperty(window, 'location', { configurable: true, value: location }); }
  });

  it('opens on the message at once after a failed load, keeps the desktop header, and draws once a later load succeeds', async () => {
    chunk.fail = true;
    await expect(loader.loadStockView()).rejects.toThrow();
    render(<StockScreen {...props} wide />);
    // No await: a load known to have failed is not tried again by the screen (its button reloads the page).
    expect(screen.getByRole('alert')).toHaveTextContent('銘柄の画面を読み込めません');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('ZZNV');
    chunk.fail = false;
    await act(async () => { await loader.loadStockView(); });
    expect(loader.stockViewFailed()).toBe(false);
    expect(screen.getByTestId('brief-conclusion')).toHaveTextContent('ZZNV wide');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves a render error of the screen itself unhandled, as before the split (only a failed chunk load has a message)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    chunk.throwOnRender = true;
    await loader.loadStockView();
    expect(() => render(<StockScreen {...props} />)).toThrow('a render error of the stock screen');
  });

  it('keeps its own loading line before the data, without loading the chunk', async () => {
    const { unmount } = render(<StockScreen {...props} brief={{ ...brief, bundle: { data: null } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('候補を読み込み中…');
    unmount();
    expect(loader.loadedStockView()).toBeNull();
  });
});
