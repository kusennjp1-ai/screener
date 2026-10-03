import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StaticChartViewerModal from './StaticChartViewerModal';
import { staticChartKeys } from './chartClient';
import { dailyObservationIndex } from './testDailyObservationFixture';

const chartSpy = vi.fn();
const sidebarSpy = vi.fn();

vi.mock('../components/Charts/CandlestickChart', () => ({
  default: (props) => {
    chartSpy(props);
    return <>
      <div className="research-chart-toolbar" data-testid="mock-chart-toolbar">
        <div className="research-chart-controls" data-testid="mock-chart-controls"><button type="button">1か月</button></div>
      </div>
      <div data-testid="static-candlestick-chart" data-chart-symbol={props.symbol} style={{height:props.height}}>{props.symbol}:{props.priceData?.length || 0}</div>
    </>;
  },
}));

vi.mock('../components/Scan/StockMetricsSidebar', () => ({
  default: (props) => {
    sidebarSpy(props);
    return (
      <div data-testid="static-stock-sidebar">
        {props.stockData?.symbol}:{props.fundamentals?.symbol}
      </div>
    );
  },
}));

const renderModal = (props, cachedPayload = null) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        placeholderData: previous => previous,
      },
    },
  });

  if (cachedPayload) queryClient.setQueryData(staticChartKeys.payload(props.initialSymbol, props.chartIndex.symbols[0].path), cachedPayload);
  const element = nextProps => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createTheme()}>
        <StaticChartViewerModal {...nextProps} />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(element(props));
  return { ...view, rerenderModal: nextProps => view.rerender(element(nextProps)) };
};

describe('StaticChartViewerModal', () => {
  it('does not assess a missing selection while the global scan list loads', () => {
    expect(() => renderModal({open:false,onClose:vi.fn(),initialSymbol:null,chartIndex:{symbols:[]},researchRows:[{symbol:'AMD'}]})).not.toThrow();
  });
  beforeEach(() => {
    chartSpy.mockClear();
    sidebarSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders exported bars and sidebar metadata without live API calls', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
    globalThis.fetch = vi.fn(async (url) => {
      const path = String(url).split('/static-data/')[1];

      if (path === 'charts/NVDA.json') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            generated_at: '2026-04-03T20:10:00Z',
            as_of_date: '2026-04-02',
            symbol: 'NVDA',
            bars: [
              { date: '2026-04-01', open: 100, high: 105, low: 99, close: 104, volume: 1000000 },
              { date: '2026-04-02', open: 104, high: 107, low: 103, close: 106, volume: 1200000 },
            ],
            stock_data: {
              symbol: 'NVDA',
              company_name: 'NVIDIA Corporation',
              ibd_group_rank: 1,
              ibd_industry_group: 'Semiconductors',
              gics_sector: 'Technology',
              gics_industry: 'Semiconductors',
              adr_percent: 3.7,
              eps_rating: 94,
            },
            fundamentals: {
              symbol: 'NVDA',
              description: 'AI chip leader',
              pe_ratio: 45.2,
            },
            signal: {
              active: true,
              headline: 'Buying Now!',
              trigger_price: 104.5,
              stop: 96.1,
              risk_pct: 8.0,
              as_of: '2026-04-02T00:00:00Z',
            },
            sell_plan: {
              action: 'raise_stop',
              climax: { flags: [] },
              breakdown: null,
              trailing: { r_multiple: 2.1, stop: 101.3, raised: true },
            },
          }),
        };
      }

      if (path === 'charts/MSFT.json') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            generated_at: '2026-04-03T20:10:00Z',
            as_of_date: '2026-04-02',
            symbol: 'MSFT',
            bars: [],
            stock_data: { symbol: 'MSFT', company_name: 'Microsoft Corporation' },
            fundamentals: { symbol: 'MSFT' },
          }),
        };
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      };
    });

    renderModal({
      open: true,
      onClose: vi.fn(),
      initialSymbol: 'NVDA',
      date: '2026-04-02',
      chartIndex: {
        symbols: [
          { symbol: 'NVDA', rank: 1, path: 'charts/NVDA.json' },
          { symbol: 'MSFT', rank: 2, path: 'charts/MSFT.json' },
        ],
      },
    });

    expect(await screen.findByText('1 / 2 銘柄', {}, { timeout: 10000 })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('static-candlestick-chart')).toHaveTextContent('NVDA:2');
      expect(screen.getByTestId('static-stock-sidebar')).toHaveTextContent('NVDA:NVDA');
    });
    const compactReadiness = screen.getByTestId('mobile-chart-readiness');
    // No selection/market observations are a lack of evidence, not two failures.
    expect(compactReadiness).toHaveTextContent('購入条件 0/7（未確認 7）');
    expect(compactReadiness).toHaveTextContent('未達・未確認：選定条件 ／ 市場環境 ／ 最新の取引日');
    expect(compactReadiness).not.toHaveTextContent('日次条件を確認済み');
    expect(screen.getByText('価格未確認 · 2026-04-02 日次終値')).toBeInTheDocument();
    const legend = screen.getByTestId('mobile-chart-legend');
    expect(legend).not.toHaveAttribute('open');
    expect(legend).toHaveTextContent('チャートの凡例（移動平均線・RS）');
    expect(legend).toHaveTextContent('SMA50日 / 10週');
    expect(screen.getByTestId('static-candlestick-chart').compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('mobile-chart-interaction')).toHaveTextContent('左スワイプ：次 ／ 右：前');
    expect(screen.getByRole('button', { name: 'チャート操作（拡大・移動）' })).toHaveStyle({ minHeight: '44px' });

    expect(chartSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'NVDA',
        priceData: expect.arrayContaining([
          expect.objectContaining({ date: '2026-04-01', close: 104 }),
        ]),
      })
    );
    expect(sidebarSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stockData: expect.objectContaining({ symbol: 'NVDA', company_name: 'NVIDIA Corporation' }),
        fundamentals: expect.objectContaining({ symbol: 'NVDA', pe_ratio: 45.2 }),
      })
    );
    const requestedUrls = globalThis.fetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls.every((url) => url.includes('/static-data/') && !url.includes('/api'))).toBe(true);

    // The research chart shows measured diagram aids, without trade cards
    // obscuring the candles or implying author endorsement.
    expect(chartSpy).toHaveBeenCalledWith(expect.objectContaining({ bookAnnotations: true }));
    expect(screen.queryByText('Buying Now!')).not.toBeInTheDocument();
    expect(screen.queryByText('Raise Stop')).not.toBeInTheDocument();
    const surface = screen.getByTestId('chart-swipe-surface');
    const swipe = (x, y) => {
      fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 100 }] });
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: x, clientY: y }] });
    };
    swipe(190, 300);
    expect(screen.getByText('1 / 2 銘柄')).toBeInTheDocument();
    swipe(80, 110);
    expect(await screen.findByText('2 / 2 銘柄')).toBeInTheDocument();
    swipe(330, 110);
    expect(await screen.findByText('1 / 2 銘柄')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'チャート操作（拡大・移動）' }));
    swipe(80, 110);
    expect(screen.getByText('1 / 2 銘柄')).toBeInTheDocument();
    expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ interactive: true, height: 420 }));
    expect(screen.getByTestId('mobile-chart-interaction')).toHaveTextContent('チャートを拡大・移動中');
    fireEvent.click(screen.getByRole('button', { name: '銘柄スワイプに戻る' }));
    expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ interactive: false }));
  }, 10000);

  it('keeps toolbar gaps out of stock swipes while retaining plot navigation in both directions', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
    const payload = symbol => ({ symbol, as_of_date: '2026-04-02', bars: [{ date: '2026-04-02', close: 100 }] });
    vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () => payload(String(url).includes('MSFT') ? 'MSFT' : 'NVDA') })));
    renderModal({ open: true, onClose: vi.fn(), initialSymbol: 'NVDA', date: '2026-04-02',
      chartIndex: { symbols: [{ symbol: 'NVDA', path: 'charts/NVDA.json' }, { symbol: 'MSFT', path: 'charts/MSFT.json' }] },
    }, payload('NVDA'));
    const swipe = (target, x) => {
      fireEvent.touchStart(target, { touches: [{ clientX: 200, clientY: 100 }] });
      fireEvent.touchEnd(target, { changedTouches: [{ clientX: x, clientY: 110 }] });
    };
    for (const id of ['mock-chart-toolbar', 'mock-chart-controls']) {
      swipe(screen.getByTestId(id), 80);
      expect(screen.getByText('1 / 2 銘柄')).toBeInTheDocument();
    }
    swipe(screen.getByTestId('static-candlestick-chart'), 80);
    expect(await screen.findByText('2 / 2 銘柄')).toBeInTheDocument();
    for (const id of ['mock-chart-toolbar', 'mock-chart-controls']) {
      swipe(await screen.findByTestId(id), 330);
      expect(screen.getByText('2 / 2 銘柄')).toBeInTheDocument();
    }
    swipe(screen.getByTestId('static-candlestick-chart'), 330);
    expect(await screen.findByText('1 / 2 銘柄')).toBeInTheDocument();
  });

  it('does not turn a pending mobile chart selection into zero confirmed conditions', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderModal({open:true,onClose:vi.fn(),initialSymbol:'AMD',date:'2026-04-02',chartIndex:{symbols:[{symbol:'AMD',path:'charts/pending-AMD.json'}]}});
    expect(screen.getByTestId('mobile-chart-readiness')).toHaveTextContent('購入条件を読み込み中…');
    expect(screen.getByTestId('mobile-chart-readiness')).not.toHaveTextContent('0/7');
  });
});

it('fits mobile cached opens and resizes without allowing scrolling or below-chart disclosures to shrink the plot', async () => {
  let contentHeight = 678, plotOffset = 136, scheduledFit;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { scheduledFit = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const observers = [];
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); observers.push(this); }
    observe() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
    return this.dataset.testid === 'expanded-chart-scroll' ? contentHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const scrollTop = document.querySelector('[data-testid="expanded-chart-scroll"]')?.scrollTop || 0;
    return { top: this.dataset.chartSymbol ? 97 + plotOffset - scrollTop : 97 };
  });
  vi.stubGlobal('fetch', vi.fn());
  const props = { open: true, onClose: vi.fn(), initialSymbol: 'FIT', date: '2026-10-01', chartIndex: { symbols: [{ symbol: 'FIT', path: 'charts/FIT.json' }] } };
  const payload = { symbol: 'FIT', as_of_date: '2026-10-01', bars: [{ date: '2026-10-01', close: 104 }], stock_data: { symbol: 'FIT', current_price: 104, se_pivot_price: 100 } };
  const { unmount, rerenderModal } = renderModal(props, payload);
  await screen.findByTestId('static-candlestick-chart');
  await waitFor(() => expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 420 })));
  const observer = observers.at(-1);
  act(() => { contentHeight = 446; fireEvent(window, new Event('resize')); scheduledFit(); });
  expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 310 }));
  fireEvent.click(screen.getByTestId('mobile-chart-legend').querySelector('summary'));
  act(() => { screen.getByTestId('expanded-chart-scroll').scrollTop = 120; observer.callback(); scheduledFit(); });
  expect(screen.getByTestId('mobile-chart-legend')).toHaveAttribute('open');
  expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 310 }));
  // Opening the measured MA readout above the plot reduces available space;
  // the plot still keeps its readable minimum and the container can scroll.
  act(() => { plotOffset += 80; observer.callback(); scheduledFit(); });
  expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 300 }));
  rerenderModal({ ...props, open: false });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(observer.disconnect).toHaveBeenCalledOnce();
  contentHeight = 678; plotOffset = 136;
  rerenderModal(props);
  await screen.findByTestId('static-candlestick-chart');
  await waitFor(() => expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 420 })));
  const reopenedObserver = observers.at(-1);
  expect(reopenedObserver).not.toBe(observer);
  expect(fetch).not.toHaveBeenCalled();
  unmount();
  expect(reopenedObserver.disconnect).toHaveBeenCalledOnce();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each([
 ['other symbol',{symbol:'MSFT'}],['other snapshot',{as_of_date:'2026-04-01'}],['missing date',{as_of_date:undefined}],['stale last bar',{bars:[{date:'2026-04-01',close:100}]}],
])('expanded chart refuses %s',async(_label,override)=>{
 chartSpy.mockClear();
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>({symbol:'NVDA',as_of_date:'2026-04-02',bars:[{date:'2026-04-02',close:100}],...override})})));
 renderModal({open:true,onClose:vi.fn(),initialSymbol:'NVDA',date:'2026-04-02',chartIndex:{symbols:[{symbol:'NVDA',path:'charts/NVDA.json'}]}});
 await screen.findByText('チャートデータの読み込みに失敗しました。');
 expect(screen.queryByTestId('static-candlestick-chart')).not.toBeInTheDocument();
 expect(chartSpy).not.toHaveBeenCalled();
 vi.unstubAllGlobals();
});
it('requires a date from the independent selection or chart index',async()=>{
 chartSpy.mockClear();
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>({symbol:'NVDA',as_of_date:'2026-04-02',bars:[{date:'2026-04-02',close:100}]})})));
 renderModal({open:true,onClose:vi.fn(),initialSymbol:'NVDA',chartIndex:{symbols:[{symbol:'NVDA',path:'charts/NVDA.json'}]}});
 await screen.findByText('チャートデータの読み込みに失敗しました。');
 expect(chartSpy).not.toHaveBeenCalled();
 vi.unstubAllGlobals();
});

it('keeps canonical summary price and pivot when the expanded detail arrives',async()=>{
 chartSpy.mockClear();
 const summary={symbol:'NVDA',current_price:100,se_pivot_price:99,research_detail_path:'details/NVDA.json',price_quality:{status:'verified'},setup_recalculation:{status:'calculated'}};
 const detail={...summary,as_of_date:'2026-04-02',current_price:80,se_pivot_price:77,price_quality:{status:'replaced'},setup_recalculation:{status:'unavailable'}};
 vi.stubGlobal('fetch',vi.fn(async(url)=>({ok:true,status:200,json:async()=>String(url).includes('details/')?detail:{symbol:'NVDA',as_of_date:'2026-04-02',bars:[{date:'2026-04-02',close:100}],stock_data:summary}})));
 renderModal({open:true,onClose:vi.fn(),initialSymbol:'NVDA',date:'2026-04-02',chartIndex:{symbols:[{symbol:'NVDA',path:'charts/NVDA.json'}]},researchRows:[summary]});
 await screen.findByTestId('static-candlestick-chart');
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining('details/NVDA.json'),expect.any(Object)));
 await waitFor(()=>expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({pivotPrice:99,buyCeiling:103.95,stopPrice:93})));
 expect(screen.getAllByText(/\$100.00/).length).toBeGreaterThan(0);
 expect(screen.queryByText(/\$80.00/)).not.toBeInTheDocument();
 vi.unstubAllGlobals();
});

it('applies the selected 3% buy limit to the mobile expanded-chart checklist',async()=>{
 const {withAuditFixture}=await import('./testAuditFixture');
 const date='2026-09-29',now=Date.parse(`${date}T22:00:00Z`);
 const row=withAuditFixture({symbol:'LIMIT',current_price:104,se_pivot_price:100,rs_rating:95,composite_rating:95,eps_rating:90,ibd_group_rank:10,
  entry_evidence:{as_of_date:date,calendar:{latest_completed_session:date,evaluated_at:`${date}T21:00:00Z`,valid_until:'2026-09-30T20:00:00Z'},earnings:{date:'2026-10-20',checked_at:`${date}T21:00:00Z`},shape:{candidate:true},volumeRatio:1.5}},date);
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({symbol:'LIMIT',as_of_date:date,bars:[{date,close:104}],stock_data:row})})));
 const {unmount}=renderModal({open:true,onClose:vi.fn(),initialSymbol:'LIMIT',date,now,method:'minervini2',market:{cap:.5,label:'上昇'},researchRows:[row],chartIndex:{symbols:[{symbol:'LIMIT',path:'LIMIT.json'}]}});
 expect(await screen.findByTestId('mobile-chart-readiness')).toHaveTextContent('購入条件 6/7');
 expect(screen.getByTestId('mobile-chart-readiness')).toHaveTextContent('買い位置');
 await screen.findByTestId('static-candlestick-chart');
 unmount();vi.unstubAllGlobals();
});
it.each([[103.2,'minervini',true],[112.7,'minervini',true],[103,'minervini',false],[104,'minervini2',false]])('keeps the mobile first-book warning with readiness at %s for %s',async(price,method,warns)=>{
 const row={symbol:'SOURCE',company_name:'Source Test',current_price:price,se_pivot_price:100};
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({symbol:'SOURCE',as_of_date:'2026-10-01',bars:[{date:'2026-10-01',close:price}],stock_data:row})})));
 const {unmount}=renderModal({open:true,onClose:vi.fn(),initialSymbol:'SOURCE',date:'2026-10-01',method,researchRows:[row],chartIndex:{symbols:[{symbol:'SOURCE',path:`charts/SOURCE-${price}-${method}.json`}]}});
 const header=screen.getByTestId('mobile-chart-readiness');
 const badge=header.querySelector('.entry-source-badge');
 if(warns){
  expect(badge).toHaveTextContent('△ 書籍目安2〜3%超');
  expect(badge).toHaveAttribute('aria-label',expect.stringContaining('書籍の追随目安外'));
  if(price>105)expect(badge).not.toHaveAttribute('aria-label',expect.stringContaining('アプリの範囲内'));
 }else expect(badge).toBeNull();
 await screen.findByTestId('static-candlestick-chart');
 if(warns)expect(screen.getByText('アプリ設定と書籍の確認範囲')).toBeInTheDocument();
 unmount();vi.unstubAllGlobals();
});


it('fits cached portal opens/reopens, refits chrome and keeps scrolling independent of plot height', async () => {
  let contentHeight = 789, plotOffset = 332, scheduledFit;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { scheduledFit = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const observers = [];
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); observers.push(this); }
    observe() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
    return this.dataset.testid === 'expanded-chart-scroll' ? contentHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const scrollTop = document.querySelector('[data-testid="expanded-chart-scroll"]')?.scrollTop || 0;
    return { top: this.dataset.chartSymbol ? 56 + plotOffset - scrollTop : 56 };
  });
  vi.stubGlobal('fetch', vi.fn());
  const props = { open: true, onClose: vi.fn(), initialSymbol: 'FIT', date: '2026-10-01', chartIndex: { symbols: [{ symbol: 'FIT', path: 'charts/FIT.json' }] } };
  const payload = { symbol: 'FIT', as_of_date: '2026-10-01', bars: [{ date: '2026-10-01', close: 104 }], stock_data: { symbol: 'FIT', current_price: 104, se_pivot_price: 100 } };
  const { unmount, rerenderModal } = renderModal(props, payload);
  await screen.findByTestId('static-candlestick-chart');
  await waitFor(() => expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 457 })));
  expect(screen.getByText('△ 書籍の追随目安外')).toBeInTheDocument();
  const observer = observers.at(-1);
  act(() => { plotOffset += 48; observer.callback(); scheduledFit(); });
  expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 409 }));
  act(() => { contentHeight = 649; plotOffset = 332; fireEvent(window, new Event('resize')); scheduledFit(); });
  expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 317 }));
  act(() => { screen.getByTestId('expanded-chart-scroll').scrollTop = 120; observer.callback(); scheduledFit(); });
  expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 317 }));
  act(() => { contentHeight = 400; observer.callback(); scheduledFit(); });
  expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 300 }));
  expect(screen.getByTestId('expanded-chart-footer')).toHaveStyle({ position: 'relative', flexShrink: '0' });
  rerenderModal({ ...props, open: false });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(observer.disconnect).toHaveBeenCalledOnce();
  contentHeight = 749; plotOffset = 320;
  rerenderModal(props);
  await screen.findByTestId('static-candlestick-chart');
  await waitFor(() => expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({ height: 429 })));
  const reopenedObserver = observers.at(-1);
  expect(reopenedObserver).not.toBe(observer);
  expect(fetch).not.toHaveBeenCalled();
  unmount();
  expect(reopenedObserver.disconnect).toHaveBeenCalledOnce();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});


it.each(dailyObservationIndex.symbols)('keeps $symbol legacy model blocks out of the modal export UI', async entry => {
  const { symbol, buy, path } = entry;
  const date = dailyObservationIndex.as_of_date;
  const payload = {
    symbol, as_of_date: date, bars: [{ date, close: buy.last_close }],
    stock_data: { symbol, current_price: buy.last_close, se_pivot_price: buy.trigger_price },
    signal: { trigger_price: buy.trigger_price, target_price_2r: buy.target_price_2r, target_price_3r: buy.target_price_3r },
    risk_plan: { stop_loss: buy.stop_loss, stop_pct: buy.stop_pct, position_size_pct: buy.position_size_pct },
  };
  const before = JSON.stringify(payload);
  const writeText = vi.fn(), prompt = vi.spyOn(window, 'prompt');
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { unmount } = renderModal({ open: true, onClose: vi.fn(), initialSymbol: symbol, date, chartIndex: { symbols: [{ symbol, path }] } }, payload);
  await screen.findByTestId('static-candlestick-chart');
  const bridge = screen.getByTestId('tradingview-bridge');
  expect(screen.getByRole('link', { name: 'TradingViewで外部チャートを開く' })).toHaveAttribute('href', `https://www.tradingview.com/chart/?symbol=${symbol}`);
  expect(bridge).toHaveTextContent('日次記録の基準日 2026-10-01');
  expect(bridge).toHaveTextContent('価格・配信時刻・遅延はTradingView側');
  expect(screen.queryByTestId('tradingview-copy-pine')).not.toBeInTheDocument();
  expect(bridge.textContent).not.toMatch(/Pine|2R|3R|買いゾーン|43\.59|407\.69/);
  expect(writeText).not.toHaveBeenCalled();
  expect(prompt).not.toHaveBeenCalled();
  expect(JSON.stringify(payload)).toBe(before);
  unmount();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
