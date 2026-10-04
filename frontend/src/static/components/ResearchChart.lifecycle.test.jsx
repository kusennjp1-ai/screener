import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResearchChart from './ResearchChart';

const { fetchPayload, factory, livePrice, liveRS, instances, observeViewport } = vi.hoisted(() => ({
  fetchPayload: vi.fn(), factory: vi.fn(), livePrice: vi.fn(), liveRS: vi.fn(), instances: [], observeViewport: vi.fn(),
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
  instances.length = 0;
  vi.stubGlobal('IntersectionObserver', observeViewport);
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
const waitReady = () => screen.findByRole('group', { name: 'チャート操作' });

it('mounts verified bars eagerly and retains source and invalid-history warnings without viewport observation', async () => {
  fetchPayload.mockResolvedValue(payload('AAA', { bars: [{ date, open: 100, high: 90, low: 98, close: 102, volume: 1000 }] }));
  setup();
  await waitReady();
  expect(fetchPayload).toHaveBeenCalledExactlyOnceWith('a.json');
  expect(screen.getByRole('note', { name: /書籍の追随目安外/ })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('日足の価格・出来高または日付に不整合');
  expect(factory).toHaveBeenCalledOnce();
  expect(observeViewport).not.toHaveBeenCalled();
  expect(document.querySelector('[data-chart-symbol="AAA"]')).toHaveAttribute('data-chart-pivot', '');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '日次チャートを表示' })).not.toBeInTheDocument();
  expect(livePrice).not.toHaveBeenCalled(); expect(liveRS).not.toHaveBeenCalled();
});

it.each([false, true])('uses the actual plot height with normal-flow disclosures (small: %s)', small => {
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: small, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  const view = setup({}, payload());
  const plot = view.container.querySelector('[data-chart-symbol]');
  expect(factory).toHaveBeenCalledOnce();
  expect(factory.mock.calls[0][1].height).toBe(small ? 360 : 440);
  expect(plot.parentElement).toHaveStyle({ height: `${small ? 360 : 440}px` });
  const explanation = screen.getByText('図解の見方・判定方法').closest('details');
  fireEvent.click(explanation.querySelector('summary'));
  expect(explanation).toHaveAttribute('open');
  expect(explanation).toBeVisible();
  expect(view.container.querySelector('.research-chart-reservation')).toBeNull();
  expect(view.container.querySelector('.research-chart-placeholder')).toBeNull();
});

it('retains the instance, manual range, timeframe and annotation choice through scroll and matching method updates', async () => {
  const view = setup(); await waitReady();
  const instance = instances[0], canvas = view.container.querySelector('canvas');
  fireEvent.click(screen.getByRole('button', { name: '週足' }));
  fireEvent.click(screen.getByRole('button', { name: '図解 詳細' }));
  instance.timeScale.setVisibleLogicalRange({ from: 10.25, to: 35.5 });
  fireEvent.scroll(window, { target: { scrollY: 1000 } });
  fireEvent.scroll(window, { target: { scrollY: 0 } });
  view.update({ method: 'minervini2', row: { symbol: 'AAA', current_price: 102, se_pivot_price: 100 } });
  expect(factory).toHaveBeenCalledOnce();
  expect(view.container.querySelector('canvas')).toBe(canvas);
  expect(instance.timeScale.getVisibleLogicalRange()).toEqual({ from: 10.25, to: 35.5 });
  expect(screen.getByRole('button', { name: '週足' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '図解 簡易' })).toHaveAttribute('aria-pressed', 'false');
  expect(view.container.querySelector('[data-chart-symbol]')).toHaveAttribute('data-chart-upper', '103');
  expect(instance.chart.remove).not.toHaveBeenCalled();
  expect(observeViewport).not.toHaveBeenCalled();
});

it('makes chart controls directly keyboard-accessible after eager rendering', async () => {
  const user = userEvent.setup(); setup(); await waitReady();
  screen.getByRole('button', { name: '日次チャートを分析' }).focus();
  await user.tab();
  expect(screen.getByRole('button', { name: '日足', exact: true })).toHaveFocus();
  await user.tab(); await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: '週足' })).toHaveAttribute('aria-pressed', 'true');
  expect(factory).toHaveBeenCalledOnce();
});

it('keeps expansion available during loading and after eager rendering', async () => {
  let deliver; fetchPayload.mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
  const onExpand = vi.fn(); setup({ onExpand });
  fireEvent.click(screen.getByRole('button', { name: '日次チャートを分析' }));
  expect(onExpand).toHaveBeenCalledOnce(); expect(factory).not.toHaveBeenCalled();
  await act(async () => deliver(payload())); await waitReady();
  fireEvent.click(screen.getByRole('button', { name: '日次チャートを分析' }));
  expect(onExpand).toHaveBeenCalledTimes(2); expect(factory).toHaveBeenCalledOnce();
});

it('mounts eagerly when IntersectionObserver is unavailable', async () => {
  vi.stubGlobal('IntersectionObserver', undefined); setup();
  await waitReady();
  expect(factory).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '日次チャートを表示' })).not.toBeInTheDocument();
});

it('keeps matching source context during a delayed request and mounts only its verified result', async () => {
  let deliver; fetchPayload.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
  const view = setup({ row: { ...defaults.row, symbol: 'AAA', as_of_date: date } });
  expect(screen.getByRole('note', { name: /書籍の追随目安外/ })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('チャートを読み込み中');
  expect(factory).not.toHaveBeenCalled();
  await act(async () => deliver(payload())); await waitReady();
  expect(view.container.querySelector('canvas')).toBeVisible();
  expect(factory).toHaveBeenCalledOnce();
  expect(livePrice).not.toHaveBeenCalled(); expect(liveRS).not.toHaveBeenCalled();
});

it.each([{ symbol: 'OTHER', as_of_date: date }, { symbol: 'AAA', as_of_date: '2026-01-02' }, { symbol: 'AAA', as_of_date: 0 }])('does not show a pending source warning from mismatched row context: %j', identity => {
  fetchPayload.mockImplementation(() => new Promise(() => {}));
  setup({ row: { ...defaults.row, ...identity } });
  expect(screen.getByRole('status')).toHaveTextContent('チャートを読み込み中');
  expect(screen.queryByRole('note', { name: /書籍の追随目安外/ })).not.toBeInTheDocument();
  expect(factory).not.toHaveBeenCalled();
});

it('mounts a fresh verified cached chart offline without a new static or live request', async () => {
  fetchPayload.mockRejectedValue(Error('offline'));
  setup({}, payload()); await waitReady();
  expect(factory).toHaveBeenCalledOnce();
  expect(fetchPayload).not.toHaveBeenCalled();
  expect(livePrice).not.toHaveBeenCalled(); expect(liveRS).not.toHaveBeenCalled();
});

it.each(['symbol', 'generation', 'date'])('does not replace current bars with a late old %s payload', async change => {
  let old; fetchPayload.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }));
  const view = setup();
  const nextDate = change === 'date' ? '2026-01-02' : date;
  const nextSymbol = change === 'symbol' ? 'BBB' : 'AAA';
  const nextBars = change === 'date' ? [...bars, { ...bars.at(-1), date: nextDate }] : bars;
  fetchPayload.mockResolvedValue(payload(nextSymbol, { as_of_date: nextDate, bars: nextBars }));
  view.update({ symbol: nextSymbol, date: nextDate, generation: 'g2', entry: { path: change === 'symbol' ? 'b.json' : 'a.json' } });
  await waitReady();
  const canvas = view.container.querySelector('canvas');
  await act(async () => old(payload()));
  const plot = view.container.querySelector('[data-chart-symbol]');
  expect(plot).toHaveAttribute('data-chart-symbol', nextSymbol);
  expect(plot).toHaveAttribute('data-chart-asof', nextDate);
  expect(instances[0].candlestickSeries.setData.mock.lastCall[0].at(-1).time).toBe(nextDate);
  expect(view.container.querySelector('canvas')).toBe(canvas);
  expect(factory).toHaveBeenCalledOnce();
});

it('clears mismatched cached dates and reuses the chart after a successful retry', async () => {
  const view = setup(); await waitReady();
  const canvas = view.container.querySelector('canvas');
  view.update({ date: '2026-01-02' });
  await screen.findByText('チャートを取得できません。');
  expect(canvas).not.toBeVisible();
  expect(instances[0].candlestickSeries.setData.mock.lastCall[0]).toEqual([]);
  fetchPayload.mockResolvedValue(payload('AAA', { as_of_date: '2026-01-02', bars: [{ ...bars.at(-1), date: '2026-01-02' }] }));
  fireEvent.click(screen.getByRole('button', { name: '再試行' })); await waitReady();
  expect(view.container.querySelector('canvas')).toBe(canvas);
  expect(factory).toHaveBeenCalledOnce();
  expect(view.container.querySelector('[data-chart-symbol]')).toHaveAttribute('data-chart-asof', '2026-01-02');
});

it.each(['symbol', 'generation'])('clears the retained bitmap, all series, range and guides during a %s replacement without live API fallback', async change => {
  const view = setup(); await waitReady();
  const instance = instances[0], canvas = view.container.querySelector('canvas');
  fireEvent.click(screen.getByRole('button', { name: '週足' }));
  instance.timeScale.setVisibleLogicalRange({ from: 2, to: 20 });
  let deliver; fetchPayload.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
  const nextSymbol = change === 'symbol' ? 'BBB' : 'AAA';
  view.update({ symbol: nextSymbol, entry: { path: change === 'symbol' ? 'b.json' : 'a.json' }, generation: 'g2' });
  expect(canvas).not.toBeVisible();
  expect(instance.context.clearRect).toHaveBeenCalled();
  for (const key of seriesKeys) expect(instance[key].setData.mock.lastCall[0]).toEqual([]);
  for (const key of ['pivot', 'upper', 'stop']) expect(view.container.querySelector('[data-chart-symbol]')).toHaveAttribute(`data-chart-${key}`, '');
  expect(screen.getByTestId('chart-visible-range').textContent).toBe('');
  await act(async () => deliver(payload(nextSymbol))); await waitReady();
  expect(canvas).toBeVisible();
  expect(view.container.querySelector('canvas')).toBe(canvas);
  expect(screen.getByRole('button', { name: '日足', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(instance.timeScale.getVisibleLogicalRange()).not.toEqual({ from: 2, to: 20 });
  expect(factory).toHaveBeenCalledOnce();
  expect(livePrice).not.toHaveBeenCalled(); expect(liveRS).not.toHaveBeenCalled();
});

it('withholds empty history and clears an existing chart if replacement history is empty', async () => {
  fetchPayload.mockResolvedValueOnce(payload('AAA', { bars: [] })).mockResolvedValueOnce(payload());
  const view = setup();
  await screen.findByText('ローソク足データが不足しています。');
  expect(factory).not.toHaveBeenCalled();
  view.update({ generation: 'g2' }); await waitReady();
  fetchPayload.mockResolvedValueOnce(payload('AAA', { bars: [] }));
  view.update({ generation: 'g3' });
  await screen.findByText('ローソク足データが不足しています。');
  expect(view.container.querySelector('canvas')).not.toBeVisible();
  for (const key of seriesKeys) expect(instances[0][key].setData.mock.lastCall[0]).toEqual([]);
  expect(livePrice).not.toHaveBeenCalled(); expect(liveRS).not.toHaveBeenCalled();
});

it('ignores late results after interruption and creates a fresh chart after the existing parent unmount/reopen', async () => {
  let old; fetchPayload.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }));
  const view = setup(); view.update({}, false);
  await act(async () => old(payload()));
  expect(factory).not.toHaveBeenCalled();
  view.update({}); await waitReady();
  const firstChart = instances[0]; firstChart.timeScale.setVisibleLogicalRange({ from: 2, to: 20 });
  view.update({}, false); expect(firstChart.chart.remove).toHaveBeenCalledOnce();
  fetchPayload.mockResolvedValue(payload('BBB'));
  view.update({ symbol: 'BBB', entry: { path: 'b.json' } }); await waitReady();
  expect(factory).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector('[data-chart-symbol]')).toHaveAttribute('data-chart-symbol', 'BBB');
  expect(instances[1].timeScale.getVisibleLogicalRange()).not.toEqual({ from: 2, to: 20 });
});
