import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PriceChart from './PriceChart';
import { loadedPriceChart, loadPriceChart } from './priceChartLoader';

// The renderer is a lazy chunk: mocked so a failed load (offline before the service worker had it, a deploy that
// replaced the hashed asset) can be told apart from one that lands. The failure is the loader's shared state (the card and
// the stock screen read it too), set as the real loader sets it when the import rejects.
const store = vi.hoisted(() => ({ failed: false, listeners: new Set() }));
vi.mock('./priceChartLoader', () => ({ loadedPriceChart: vi.fn(() => null), loadPriceChart: vi.fn(),
  priceChartFailed: () => store.failed, subscribePriceChart: listener => { store.listeners.add(listener); return () => store.listeners.delete(listener); } }));
const fail = () => { store.failed = true; for (const listener of store.listeners) listener(); };

const model = { symbol: 'ZZNV', interval: 'day', bars: [{ date: '2026-10-02', open: 100, high: 102, low: 99, close: 101, volume: 1000 }] };

describe('the price chart while its renderer chunk loads', () => {
  beforeEach(() => { loadedPriceChart.mockReset().mockReturnValue(null); loadPriceChart.mockReset(); store.failed = false; });

  it('says the chart cannot be loaded, with a 再読み込み button, when the chunk fails (a failed import stays failed for the page)', async () => {
    loadPriceChart.mockImplementationOnce(() => { fail(); return Promise.reject(new Error('Failed to fetch dynamically imported module')); });
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location, reload } });
    try {
      render(<PriceChart model={model} period={65} />);
      // The live region is mounted empty before the failure, so its message is announced when it arrives.
      const status = screen.getByRole('status');
      await act(async () => {});
      expect(status).toHaveTextContent('チャートを読み込めません');
      expect(screen.getByRole('status')).toBe(status);
      fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally { Object.defineProperty(window, 'location', { configurable: true, value: location }); }
  });

  it('draws once the chunk lands, with no message', async () => {
    const draw = vi.fn(() => ({ moveStop() {}, highlightLeg() { return false; }, select() {} }));
    loadPriceChart.mockImplementationOnce(() => { loadedPriceChart.mockReturnValue(draw); return Promise.resolve(draw); });
    await act(async () => { render(<PriceChart model={model} period={65} />); });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(document.querySelector('.brief-chart-failed')).toBeNull();
    expect(draw).toHaveBeenCalled();
  });

  it('says nothing while the chunk is still loading (the box keeps its height)', () => {
    loadPriceChart.mockReturnValue(new Promise(() => {}));
    render(<PriceChart model={model} period={65} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(document.querySelector('.brief-chart-failed')).toBeNull();
    expect(screen.getByTestId('brief-price-chart')).toBeInTheDocument();
  });
});
