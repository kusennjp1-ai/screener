vi.mock('./staticPublication', async importOriginal => ({ ...await importOriginal(), resolveStaticPublication: async ({ publication, generation } = {}) => publication || { mode: 'legacy', baseURL: new URL('/', location.href).href, generation } }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import StaticChartViewerModal from './StaticChartViewerModal';
import { staticChartKeys } from './chartClient';

// Vitest stubs CSS imports in this suite, so read the actual cascade input.
const workbenchCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'workbench.css'), 'utf8');

const chartSpy = vi.fn();
const sidebarSpy = vi.fn();

vi.mock('../components/Charts/CandlestickChart', () => ({
  default: (props) => {
    chartSpy(props);
    return <><div className="chart-research-meta" data-testid="chart-meta-actions">{props.researchMetaActions}</div><div data-testid="static-candlestick-chart" data-chart-symbol={props.symbol} style={{height:props.height}}>{props.symbol}:{props.priceData?.length || 0}</div></>;
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

  it.each([false,true])('keeps legacy empty navigation unchanged and rejects an active empty subset: %s', async annualEpsOnly => {
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:404,json:async()=>({})})));
    renderModal({open:true,onClose:vi.fn(),initialSymbol:'NVDA',annualEpsOnly,navigationSymbols:[],date:'2026-04-02',
      chartIndex:{symbols:[{symbol:'NVDA',path:'charts/NVDA.json'},{symbol:'MSFT',path:'charts/MSFT.json'}]}},
      {symbol:'NVDA',as_of_date:'2026-04-02',bars:[{date:'2026-04-02',close:100}],stock_data:{symbol:'NVDA'}});
    expect(screen.getByText(annualEpsOnly?'0 / 0 銘柄':'1 / 2 銘柄')).toBeInTheDocument();
    if(annualEpsOnly){expect(screen.queryByTestId('static-candlestick-chart')).not.toBeInTheDocument();expect(fetch).not.toHaveBeenCalled();}
    else expect(await screen.findByTestId('static-candlestick-chart')).toHaveAttribute('data-chart-symbol','NVDA');
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
    expect(compactReadiness).toHaveTextContent('未達・未確認：共通購入モデルへの適合 ／ 市場環境 ／ 最新の取引日');
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

  it('does not turn a pending mobile chart selection into zero confirmed conditions', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderModal({open:true,onClose:vi.fn(),initialSymbol:'AMD',date:'2026-04-02',chartIndex:{symbols:[{symbol:'AMD',path:'charts/pending-AMD.json'}]}});
    expect(screen.getByTestId('mobile-chart-readiness')).toHaveTextContent('購入条件を読み込み中…');
    expect(screen.getByTestId('mobile-chart-readiness')).not.toHaveTextContent('0/7');
  });
});

it.each([false, true])('keeps the complete mobile warning and swipe controls when short-viewport reflow is %s', async short => {
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: query.includes('max-height') ? short : true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn());
  const props = { open:true, onClose:vi.fn(), initialSymbol:'FIT', date:'2026-10-01', chartIndex:{symbols:[{symbol:'FIT',path:'charts/FIT.json'}]} };
  const payload = {symbol:'FIT',as_of_date:'2026-10-01',bars:[{date:'2026-10-01',close:104}],stock_data:{symbol:'FIT',current_price:104,se_pivot_price:100}};
  const { unmount } = renderModal(props, payload);
  await screen.findByTestId('static-candlestick-chart');
  // Exercise the real metadata-child selector after MUI's styles exist,
  // including a late-loaded stylesheet. RTL cleans up this style node.
  expect(workbenchCss).toContain('.chart-research-meta>div{margin:0!important;font-size:11px}');
  render(<style>{workbenchCss}</style>);
  const header = screen.getByTestId('expanded-chart-header');
  const readiness = screen.getByTestId('mobile-chart-readiness');
  const interaction = screen.getByTestId('mobile-chart-interaction');
  expect(readiness.closest('[data-testid="expanded-chart-header"]')).toBe(header);
  expect(readiness.parentElement).toHaveStyle({display:short ? 'contents' : 'block'});
  expect(getComputedStyle(readiness).gridColumn.replaceAll(' ', '')).toBe(short ? '1/-1' : '1');
  expect(getComputedStyle(readiness).fontSize).toBe('12px');
  expect(readiness.querySelector('.entry-source-badge')).toHaveTextContent('△ 書籍目安2〜3%超');
  expect(screen.getByText('$104.00 · 2026-10-01 日次終値')).toBeInTheDocument();
  expect(interaction.closest('[data-testid="chart-meta-actions"]') !== null).toBe(short);
  expect(interaction).toHaveTextContent('左スワイプ：次 ／ 右：前');
  expect(getComputedStyle(interaction).fontSize).toBe('12px');
  expect(screen.getByRole('button',{name:'チャート操作（拡大・移動）'})).toHaveStyle({minHeight:'44px'});
  fireEvent.click(screen.getByRole('button',{name:'チャート操作（拡大・移動）'}));
  expect(interaction).toHaveTextContent('チャートを拡大・移動中');
  expect(getComputedStyle(interaction).fontSize).toBe('12px');
  expect(screen.getByRole('button',{name:'銘柄スワイプに戻る'})).toHaveAttribute('aria-pressed','true');
  expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({interactive:true}));
  fireEvent.click(screen.getByRole('button',{name:'チャートを閉じる'}));
  expect(props.onClose).toHaveBeenCalledOnce();
  unmount(); vi.unstubAllGlobals();
});

it('preserves pan mode and keyboard focus as short-phone controls move between rows', async () => {
  const heightListeners = new Set();
  const heightQuery = { matches:false, addListener:callback => heightListeners.add(callback), removeListener:callback => heightListeners.delete(callback) };
  vi.stubGlobal('matchMedia', vi.fn(query => query.includes('max-height') ? heightQuery : { matches:true, addListener:vi.fn(), removeListener:vi.fn() }));
  vi.stubGlobal('fetch', vi.fn());
  const props = { open:true, onClose:vi.fn(), initialSymbol:'FIT', date:'2026-10-01', chartIndex:{symbols:[{symbol:'FIT',path:'charts/FIT.json'}]} };
  const payload = {symbol:'FIT',as_of_date:'2026-10-01',bars:[{date:'2026-10-01',close:104}],stock_data:{symbol:'FIT',current_price:104,se_pivot_price:100}};
  const { unmount } = renderModal(props, payload);
  await screen.findByTestId('static-candlestick-chart');
  fireEvent.click(screen.getByRole('button',{name:'チャート操作（拡大・移動）'}));
  act(() => screen.getByRole('button',{name:'銘柄スワイプに戻る'}).focus());
  for (const short of [true, false, true]) {
    act(() => { heightQuery.matches = short; heightListeners.forEach(callback => callback()); });
    const control = screen.getByRole('button',{name:'銘柄スワイプに戻る'});
    expect(control).toHaveFocus();
    expect(control).toHaveAttribute('aria-pressed','true');
    expect(control.closest('[data-testid="chart-meta-actions"]') !== null).toBe(short);
    expect(chartSpy).toHaveBeenLastCalledWith(expect.objectContaining({interactive:true}));
  }
  const close = screen.getByRole('button',{name:'チャートを閉じる'});
  act(() => close.focus());
  act(() => { heightQuery.matches = false; heightListeners.forEach(callback => callback()); });
  expect(close).toHaveFocus();
  fireEvent.keyDown(window,{key:'Escape'});
  expect(props.onClose).toHaveBeenCalledOnce();
  unmount(); vi.unstubAllGlobals();
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
 const clock=vi.spyOn(Date,'now').mockReturnValue(now);
 const row=withAuditFixture({symbol:'LIMIT',current_price:104,se_pivot_price:100,rs_rating:95,composite_rating:95,eps_rating:90,ibd_group_rank:10,
  entry_evidence:{as_of_date:date,calendar:{latest_completed_session:date,evaluated_at:`${date}T21:00:00Z`,valid_until:'2026-09-30T20:00:00Z'},earnings:{date:'2026-10-20',checked_at:`${date}T21:00:00Z`},shape:{candidate:true},volumeRatio:1.5}},date);
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({symbol:'LIMIT',as_of_date:date,bars:[{date,close:104}],stock_data:row})})));
 const {unmount}=renderModal({open:true,onClose:vi.fn(),initialSymbol:'LIMIT',date,now,method:'minervini2',market:{cap:.5,label:'上昇'},researchRows:[row],chartIndex:{symbols:[{symbol:'LIMIT',path:'LIMIT.json'}]}});
 expect(await screen.findByTestId('mobile-chart-readiness')).toHaveTextContent('購入条件 5/7（未確認 1）');
 expect(screen.getByTestId('mobile-chart-readiness')).toHaveTextContent('買い位置');
 await screen.findByTestId('static-candlestick-chart');
 unmount();clock.mockRestore();vi.unstubAllGlobals();
});
it.each([[103.2,'minervini',true],[112.7,'minervini',true],[103,'minervini',false],[104,'minervini2',true]])('keeps the mobile source-specific warning with readiness at %s for %s',async(price,method,warns)=>{
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


it.each(['symbol', 'same-date-generation'])('ignores a late financial detail after %s changes', async change => {
 const {withAuditFixture}=await import('./testAuditFixture');
 const date='2026-10-02', now=Date.parse('2026-10-03T12:00:00Z');
 let finishOld, finishNew;
 const oldDetail=new Promise(resolve=>{finishOld=resolve;}),newDetail=new Promise(resolve=>{finishNew=resolve;});
 const oldRow={symbol:'FIRST',market:'US',current_price:100,research_detail_path:'old-detail.json'};
 const nextRow={...oldRow,symbol:change==='symbol'?'SECOND':'FIRST',research_detail_path:'new-detail.json'};
 vi.stubGlobal('fetch',vi.fn(async url=>({ok:true,status:200,json:async()=>String(url).includes('old-detail')?oldDetail:String(url).includes('new-detail')?newDetail:{symbol:nextRow.symbol,as_of_date:date,bars:[{date,close:100}],stock_data:nextRow}})));
 const first={open:true,onClose:vi.fn(),initialSymbol:'FIRST',date,now,generation:'g1',method:'minervini',researchRows:[oldRow],chartIndex:{symbols:[{symbol:'FIRST',path:'first-chart.json'}]}};
 const view=renderModal(first);
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining('old-detail'),expect.any(Object)));
 const next={...first,initialSymbol:nextRow.symbol,generation:'g2',researchRows:[nextRow],chartIndex:{symbols:[{symbol:nextRow.symbol,path:'second-chart.json'}]}};
 view.rerenderModal(next);
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining('new-detail'),expect.any(Object)));
 await act(async()=>finishOld({...withAuditFixture(oldRow,date),as_of_date:date,eps_growth_yy:999,eps_rating:99}));
 expect(screen.getByText('詳細根拠を読み込み中…')).toBeInTheDocument();
 expect(screen.queryByText('999')).not.toBeInTheDocument();
 await act(async()=>finishNew({...nextRow,as_of_date:date,eps_growth_yy:888}));
 await waitFor(()=>expect(screen.getByText('選定条件の詳細（0/9）')).toBeInTheDocument());
 expect(screen.queryByText('888')).not.toBeInTheDocument();
 view.unmount();vi.unstubAllGlobals();
});

it('projects the expanded raw-chart fallback and fundamentals before sidebar rendering',async()=>{
 sidebarSpy.mockClear();
 const date='2026-10-02',now=Date.parse('2026-10-03T12:00:00Z');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>({symbol:'RAW',as_of_date:date,bars:[{date,close:100}],stock_data:{symbol:'RAW',eps_growth_yy:999,eps_rating:99,composite_score:98},fundamentals:{symbol:'RAW',eps_growth_yy:777,roe:55}})})));
 const view=renderModal({open:true,onClose:vi.fn(),initialSymbol:'RAW',date,now,chartIndex:{symbols:[{symbol:'RAW',path:'raw-chart.json'}]}});
 await screen.findByTestId('static-stock-sidebar');
 await waitFor(()=>expect(sidebarSpy.mock.calls.at(-1)[0].stockData?.symbol).toBe('RAW'));
 const sidebar=sidebarSpy.mock.calls.at(-1)[0];
 expect(sidebar).toMatchObject({currentFinancialOnly:true,stockData:{eps_growth_yy:null,eps_rating:null,composite_score:null},fundamentals:{eps_growth_yy:null,roe:null}});
 view.unmount();vi.unstubAllGlobals();
});


it.each([false,true])('expires cached fundamentals-only evidence in an open modal (fixed supplied clock: %s)', async supplied => {
 const {withFinancialProof,FINANCIAL_TEST_DATE:date,FINANCIAL_TEST_NOW:now}=await import('./testFinancialFixture');
 vi.useFakeTimers();vi.setSystemTime(now);sidebarSpy.mockClear();
 const fundamentals=withFinancialProof({symbol:'FUND',eps_growth_qq:30},now,date);
 fundamentals.financial_current.p[0][5]=now+150;
 const payload={symbol:'FUND',market:'US',as_of_date:date,bars:[{date,close:100}],fundamentals};
 const view=renderModal({open:true,onClose:vi.fn(),initialSymbol:'FUND',date,...(supplied?{now}:{}),chartIndex:{symbols:[{symbol:'FUND',path:'fund-only.json'}]}},payload);
 try {
  expect(sidebarSpy.mock.calls.at(-1)[0].fundamentals.eps_growth_qq).toBe(30);
  await act(async()=>vi.advanceTimersByTimeAsync(150));
  expect(sidebarSpy.mock.calls.at(-1)[0].fundamentals.eps_growth_qq).toBe(30);
  await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect(sidebarSpy.mock.calls.at(-1)[0].fundamentals.eps_growth_qq).toBeNull();
  expect(sidebarSpy.mock.calls.at(-1)[0].now).toBe(now+151);
 } finally {view.unmount();vi.useRealTimers();}
});
