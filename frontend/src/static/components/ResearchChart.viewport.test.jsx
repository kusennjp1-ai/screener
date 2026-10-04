import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResearchChart from './ResearchChart';

const { fetchPayload, factory, livePrice, liveRS, instances, observers } = vi.hoisted(() => ({
  fetchPayload: vi.fn(), factory: vi.fn(), livePrice: vi.fn(), liveRS: vi.fn(), instances: [], observers: [],
}));
vi.mock('../chartClient', () => ({ fetchStaticChartPayload: fetchPayload, staticChartKeys: { payload: (symbol, path) => ['chart', symbol, path] } }));
vi.mock('../../components/Charts/createPriceChartSeries', () => ({ createPriceChartSeries: factory }));
vi.mock('../../api/priceHistory', () => ({ fetchPriceHistory: livePrice, fetchRSLine: liveRS, PRICE_HISTORY_STALE_TIME: 60000,
  priceHistoryKeys: { symbol: (symbol, period) => ['live', symbol, period], rsLine: (symbol, period) => ['rs', symbol, period] },
}));
const seriesKeys = ['candlestickSeries', 'volumeSeries', 'avgVolumeSeries', 'ema10Series', 'ema20Series', 'ema50Series', 'sma50Series', 'sma150Series', 'sma200Series', 'rsLineSeries', 'epsLineSeries'];
const bars = Array.from({ length: 365 }, (_, index) => {
  const day = new Date(Date.UTC(2025, 0, index + 1));
  return [0, 6].includes(day.getUTCDay()) ? null : { date: day.toISOString().slice(0, 10), open: 100, high: 103, low: 98, close: 102, volume: 1000 };
}).filter(Boolean);
const date = bars.at(-1).date;
const payload = (symbol = 'AAA', overrides = {}) => ({ symbol, as_of_date: date, bars, rs_line: bars.map(bar => ({ time: bar.date, value: 100 })), ...overrides });
const defaults = { symbol: 'AAA', date, generation: 'g1', entry: { path: 'a.json' }, method: 'minervini', row: { symbol: 'AAA', current_price: 104, se_pivot_price: 100 } };
beforeEach(() => {
  instances.length = 0; observers.length = 0;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.disconnect = vi.fn(); observers.push(this); }
    observe(target) { this.target = target; }
  });
  factory.mockImplementation(container => {
    const context = { save: vi.fn(), restore: vi.fn(), resetTransform: vi.fn(), clearRect: vi.fn() };
    const canvas = document.createElement('canvas'); canvas.getContext = () => context; container.appendChild(canvas);
    let range = null;
    const timeScale = { subscribeVisibleTimeRangeChange: vi.fn(), unsubscribeVisibleTimeRangeChange: vi.fn(), getVisibleRange: () => null,
      timeToIndex: vi.fn(time => item.candlestickSeries.setData.mock.lastCall?.[0].findIndex(bar => bar.time === time)),
      getVisibleLogicalRange: () => range, fitContent: vi.fn(), setVisibleRange: vi.fn(),
      setVisibleLogicalRange: vi.fn(value => { range = value; }),
    };
    const item = { chart: { subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn(), clearCrosshairPosition: vi.fn(),
      resize: vi.fn(), remove: vi.fn(), applyOptions: vi.fn(), timeScale: () => timeScale, priceScale: () => ({ applyOptions: vi.fn() }) }, timeScale, context };
    for (const key of seriesKeys) item[key] = { setData: vi.fn(), applyOptions: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }),
      attachPrimitive: vi.fn(), detachPrimitive: vi.fn(), createPriceLine: vi.fn(value => value), removePriceLine: vi.fn() };
    item.candleMarkers = { setMarkers: vi.fn() }; item.rsMarkers = { setMarkers: vi.fn() };
    instances.push(item); return item;
  });
  fetchPayload.mockResolvedValue(payload());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
function setup(overrides = {}, cached = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  if (cached) client.setQueryData(['chart', 'AAA', 'a.json', 'g1'], cached);
  const wrap = (props, shown = true) => <QueryClientProvider client={client}>{shown && <ResearchChart {...defaults} {...props} />}</QueryClientProvider>;
  const view = render(wrap(overrides));
  return { ...view, update: (props, shown = true) => view.rerender(wrap(props, shown)) };
}
function intersect(observer = observers.at(-1), isIntersecting = true) {
  act(() => observer.callback([{ target: observer.target, isIntersecting }]));
}
const waitPrepared = () => screen.findByRole('button', { name: '日次チャートを表示' });

it('fetches and validates before viewport activation, retaining source and invalid-history warnings', async () => {
  fetchPayload.mockResolvedValue(payload('AAA', { bars: [{ date, open: 100, high: 90, low: 98, close: 102, volume: 1000 }] }));
  setup();
  await waitPrepared();
  expect(fetchPayload).toHaveBeenCalledExactlyOnceWith('a.json');
  expect(screen.getByRole('note', { name: /書籍の追随目安外/ })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('日足の価格・出来高または日付に不整合');
  expect(factory).not.toHaveBeenCalled();
  expect(observers[0].options).toEqual({ rootMargin: '200px 0px', threshold: 0 });
  intersect();
  expect(factory).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-chart-symbol="AAA"]')).toHaveAttribute('data-chart-pivot', '');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(livePrice).not.toHaveBeenCalled(); expect(liveRS).not.toHaveBeenCalled();
});

it.each([false, true])('retains the complete closed-widget reservation and allows disclosures to grow (small: %s)', small => {
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: small, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  const view = setup({}, payload());
  const reservation = view.container.querySelector('.research-chart-reservation');
  expect(reservation).toHaveAttribute('aria-hidden', 'true');
  expect(reservation.lastElementChild).toHaveStyle({ height: `${(small ? 360 : 440) + 176}px` });
  intersect();
  expect(view.container.querySelector('.research-chart-reservation')).toBe(reservation);
  const explanation = screen.getByText('図解の見方・判定方法').closest('details');
  fireEvent.click(explanation.querySelector('summary'));
  expect(explanation).toHaveAttribute('open');
  expect(explanation).toBeVisible();
  // Height/overflow are not fixed on the real content: the grid can expand.
  expect(view.container.querySelector('.research-chart-viewport-content').style.height).toBe('');
  expect(view.container.querySelector('.research-chart-viewport-content').style.overflow).toBe('');
});

it('retains the visited instance, manual range, timeframe and annotation choice on scroll away/return and method changes', async () => {
  const view = setup(), observer = observers[0]; await waitPrepared();
  act(() => observer.callback([{ target: document.body, isIntersecting: true }]));
  expect(factory).not.toHaveBeenCalled();
  intersect(observer);
  const instance = instances[0], canvas = view.container.querySelector('canvas');
  fireEvent.click(screen.getByRole('button', { name: '週足' }));
  fireEvent.click(screen.getByRole('button', { name: '図解 詳細' }));
  instance.timeScale.setVisibleLogicalRange({ from: 10.25, to: 35.5 });
  intersect(observer, false); intersect(observer);
  view.update({ method: 'minervini2', row: { symbol: 'AAA', current_price: 102, se_pivot_price: 100 } });
  expect(factory).toHaveBeenCalledOnce();
  expect(view.container.querySelector('canvas')).toBe(canvas);
  expect(instance.timeScale.getVisibleLogicalRange()).toEqual({ from: 10.25, to: 35.5 });
  expect(screen.getByRole('button', { name: '週足' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '図解 簡易' })).toHaveAttribute('aria-pressed', 'false');
  expect(view.container.querySelector('[data-chart-symbol]')).toHaveAttribute('data-chart-upper', '103');
  expect(instance.chart.remove).not.toHaveBeenCalled();
  expect(observer.disconnect).toHaveBeenCalledOnce();
});

it('handles an immediate keyboard display request without waiting for an observer callback', async () => {
  const user = userEvent.setup(); setup();
  const show = await waitPrepared(); show.focus(); await user.keyboard('{Enter}');
  expect(factory).toHaveBeenCalledOnce();
  expect(screen.getByRole('group', { name: 'チャート操作' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '日足', exact: true })).toHaveFocus();
});

it('keeps expansion available during loading and after preparation without forcing the inline canvas', async () => {
  let deliver; fetchPayload.mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
  const onExpand = vi.fn(); setup({ onExpand });
  fireEvent.click(screen.getByRole('button', { name: '日次チャートを分析' }));
  expect(onExpand).toHaveBeenCalledOnce(); expect(factory).not.toHaveBeenCalled();
  await act(async () => deliver(payload())); await waitPrepared();
  fireEvent.click(screen.getByRole('button', { name: '日次チャートを分析' }));
  expect(onExpand).toHaveBeenCalledTimes(2); expect(factory).not.toHaveBeenCalled();
});

it('mounts immediately when IntersectionObserver is unavailable', async () => {
  vi.stubGlobal('IntersectionObserver', undefined); setup();
  await waitFor(() => expect(factory).toHaveBeenCalledOnce());
  expect(observers).toHaveLength(0);
  expect(screen.queryByRole('button', { name: '日次チャートを表示' })).not.toBeInTheDocument();
});

it('remembers approach while the eager request is pending and mounts only its verified result', async () => {
  let deliver; fetchPayload.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
  const view = setup({ row: { ...defaults.row, symbol: 'AAA', as_of_date: date } });
  const reservation = view.container.querySelector('.research-chart-reservation');
  expect(reservation.lastElementChild).toHaveStyle({ height: '616px' });
  expect(screen.getByRole('note', { name: /書籍の追随目安外/ })).toBeInTheDocument();
  intersect();
  expect(screen.getByRole('status')).toHaveTextContent('チャートを読み込み中');
  expect(factory).not.toHaveBeenCalled();
  await act(async () => deliver(payload()));
  await waitFor(() => expect(factory).toHaveBeenCalledOnce());
  expect(view.container.querySelector('.research-chart-reservation')).toBe(reservation);
  expect(reservation.lastElementChild).toHaveStyle({ height: '616px' });
  expect(livePrice).not.toHaveBeenCalled(); expect(liveRS).not.toHaveBeenCalled();
});

it.each([{ symbol: 'OTHER', as_of_date: date }, { symbol: 'AAA', as_of_date: '2026-01-02' }, { symbol: 'AAA', as_of_date: 0 }])('does not show a pending source warning from mismatched row context: %j', identity => {
  fetchPayload.mockImplementation(() => new Promise(() => {}));
  setup({ row: { ...defaults.row, ...identity } });
  expect(screen.getByRole('status')).toHaveTextContent('チャートを読み込み中');
  expect(screen.queryByRole('note', { name: /書籍の追随目安外/ })).not.toBeInTheDocument();
  expect(factory).not.toHaveBeenCalled();
});

it('activates a fresh verified cached chart offline without a new static or live request', async () => {
  fetchPayload.mockRejectedValue(Error('offline'));
  setup({}, payload()); await waitPrepared(); intersect();
  expect(factory).toHaveBeenCalledOnce();
  expect(fetchPayload).not.toHaveBeenCalled();
  expect(livePrice).not.toHaveBeenCalled(); expect(liveRS).not.toHaveBeenCalled();
});

it.each(['symbol', 'generation', 'date'])('does not activate a late old %s payload under the current selection', async change => {
  let old; fetchPayload.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }));
  const view = setup();
  const nextDate = change === 'date' ? '2026-01-02' : date;
  const nextSymbol = change === 'symbol' ? 'BBB' : 'AAA';
  const nextBars = change === 'date' ? [...bars, { ...bars.at(-1), date: nextDate }] : bars;
  fetchPayload.mockResolvedValue(payload(nextSymbol, { as_of_date: nextDate, bars: nextBars }));
  view.update({ symbol: nextSymbol, date: nextDate, generation: 'g2', entry: { path: change === 'symbol' ? 'b.json' : 'a.json' } });
  await waitPrepared(); await act(async () => old(payload()));
  expect(factory).not.toHaveBeenCalled(); intersect();
  const plot = view.container.querySelector('[data-chart-symbol]');
  expect(plot).toHaveAttribute('data-chart-symbol', nextSymbol);
  expect(plot).toHaveAttribute('data-chart-asof', nextDate);
  expect(instances[0].candlestickSeries.setData.mock.lastCall[0].at(-1).time).toBe(nextDate);
});

it('withholds mismatched cached dates before activation and supports retry after an offscreen error', async () => {
  const view = setup(); await waitPrepared(); view.update({ date: '2026-01-02' });
  await screen.findByText('チャートを取得できません。');
  expect(screen.queryByRole('button', { name: '日次チャートを表示' })).not.toBeInTheDocument();
  expect(factory).not.toHaveBeenCalled();
  fetchPayload.mockResolvedValue(payload('AAA', { as_of_date: '2026-01-02', bars: [{ ...bars.at(-1), date: '2026-01-02' }] }));
  fireEvent.click(screen.getByRole('button', { name: '再試行' })); await waitPrepared();
  expect(factory).not.toHaveBeenCalled(); intersect();
  expect(view.container.querySelector('[data-chart-symbol]')).toHaveAttribute('data-chart-asof', '2026-01-02');
});

it('clears the retained bitmap, all series and guides during a replacement, without live API fallback', async () => {
  const view = setup(); await waitPrepared(); intersect(); const instance = instances[0];
  let deliver; fetchPayload.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
  const next = { symbol: 'BBB', entry: { path: 'b.json' }, generation: 'g2' };
  view.update(next);
  expect(view.container.querySelector('canvas')).not.toBeVisible();
  expect(instance.context.clearRect).toHaveBeenCalled();
  for (const key of seriesKeys) expect(instance[key].setData.mock.lastCall[0]).toEqual([]);
  for (const key of ['pivot', 'upper', 'stop']) expect(view.container.querySelector('[data-chart-symbol]')).toHaveAttribute(`data-chart-${key}`, '');
  await act(async () => deliver(payload('BBB')));
  await waitFor(() => expect(view.container.querySelector('canvas')).toBeVisible());
  expect(factory).toHaveBeenCalledOnce();
  expect(livePrice).not.toHaveBeenCalled(); expect(liveRS).not.toHaveBeenCalled();
});

it('ignores late observer events after interruption and reactivates correctly after the existing parent unmount/reopen', async () => {
  const view = setup(), firstObserver = observers[0]; await waitPrepared();
  view.update({}, false); intersect(firstObserver);
  expect(firstObserver.disconnect).toHaveBeenCalledOnce(); expect(factory).not.toHaveBeenCalled();
  view.update({}); await waitPrepared(); intersect();
  const firstChart = instances[0]; firstChart.timeScale.setVisibleLogicalRange({ from: 2, to: 20 });
  view.update({}, false); expect(firstChart.chart.remove).toHaveBeenCalledOnce();
  fetchPayload.mockResolvedValue(payload('BBB'));
  view.update({ symbol: 'BBB', entry: { path: 'b.json' } }); await waitPrepared();
  expect(factory).toHaveBeenCalledOnce(); intersect();
  expect(factory).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector('[data-chart-symbol]')).toHaveAttribute('data-chart-symbol', 'BBB');
  expect(instances[1].timeScale.getVisibleLogicalRange()).not.toEqual({ from: 2, to: 20 });
});
