vi.mock('./staticPublication', async importOriginal => ({ ...await importOriginal(), resolveStaticPublication: async ({ publication, generation } = {}) => publication || { mode: 'legacy', baseURL: new URL('/', location.href).href, generation } }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import StaticGroupChartsGrid from './StaticGroupChartsGrid';
const date='2026-01-02';
const payload=(symbol='NVDA',extra={})=>({symbol,as_of_date:date,stock_data:{symbol,company_name:`${symbol} Corp`,ibd_group_rank:12,adr_percent:3.4},bars:[{date,open:1,high:2,low:.5,close:1.5,volume:100}],generated_at:'2026-01-03T00:00:00Z',...extra});
const response=value=>({ok:true,status:200,json:async()=>value});
const index={as_of_date:date,symbols:[{symbol:'NVDA',path:'charts/NVDA.json'},{symbol:'AAPL',path:'charts/AAPL.json'}]};
function renderGrid(props={}) {
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const element=extra=><QueryClientProvider client={client}><ThemeProvider theme={createTheme()}><StaticGroupChartsGrid symbols={['NVDA']} chartIndex={index} {...props} {...extra}/></ThemeProvider></QueryClientProvider>;
 const view=render(element());return {...view,rerenderGrid:extra=>view.rerender(element(extra)),client};
}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('shows missing bars without inventing chart data',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(response(payload('NVDA',{bars:undefined})));
 renderGrid();expect(await screen.findByText('No price data available for NVDA.')).toBeInTheDocument();
 expect(screen.queryByRole('img',{name:/共通時間軸/})).not.toBeInTheDocument();
});
it('draws real SVG and uses separate selection controls without nested buttons',async()=>{
 vi.spyOn(globalThis,'fetch').mockImplementation(async path=>response(payload(String(path).includes('AAPL')?'AAPL':'NVDA')));
 const {container}=renderGrid({symbols:['NVDA','AAPL']});
 await screen.findByRole('img',{name:/NVDA 価格・出来高・RS 共通時間軸/});
 await screen.findByRole('img',{name:/AAPL 価格・出来高・RS 共通時間軸/});
 expect(container.querySelector('canvas')).toBeNull();expect(container.querySelector('button button,[role="button"] button')).toBeNull();
 expect(screen.queryByRole('button',{name:'週足'})).not.toBeInTheDocument();
 const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'NVDA チャートの操作を開く'}));
 const nvda=screen.getByRole('region',{name:'NVDA 業種内チャート'});
 expect(within(nvda).getByRole('button',{name:'NVDA チャートの操作を閉じる'})).toHaveAttribute('aria-pressed','true');
 await user.click(within(nvda).getByRole('button',{name:'週足',exact:true}));
 expect(within(nvda).getByRole('button',{name:'週足',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(within(nvda).getByRole('button',{name:'NVDA チャートの操作を閉じる'})).toHaveAttribute('aria-pressed','true');
 await user.click(screen.getByRole('button',{name:'AAPL チャートの操作を開く'}));
 expect(within(nvda).queryByRole('button',{name:'週足'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'AAPL チャートの操作を閉じる'})).toHaveAttribute('aria-pressed','true');
 expect(container.textContent).not.toMatch(/zoom enabled|click to enable zoom/);
});
it('supports native keyboard selection and does not steal Enter or Space from SVG controls',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(response(payload()));renderGrid();
 await screen.findByRole('img',{name:/NVDA 価格/});const user=userEvent.setup();
 screen.getByRole('button',{name:'NVDA チャートの操作を開く'}).focus();await user.keyboard('{Enter}');
 const weekly=screen.getByRole('button',{name:'週足',exact:true});weekly.focus();await user.keyboard(' ');
 expect(weekly).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('button',{name:'NVDA チャートの操作を閉じる'})).toHaveAttribute('aria-pressed','true');
 const zoom=screen.getByRole('button',{name:'表示期間を拡大'});zoom.focus();await user.keyboard('{Enter}');
 expect(zoom).toHaveFocus();expect(screen.getByRole('button',{name:'NVDA チャートの操作を閉じる'})).toHaveAttribute('aria-pressed','true');
});
it('keeps actual ADR/rank/close and does not refill unknown EPS from raw ratings',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(response(payload('NVDA',{stock_data:{symbol:'NVDA',eps_rating:98,adr_percent:3.4,ibd_group_rank:12},fundamentals:{eps_rating:99}})));
 renderGrid();await screen.findByRole('img',{name:/NVDA 価格/});
 expect(screen.getByText('EPS推計 未確認')).toBeInTheDocument();expect(screen.queryByText('98')).not.toBeInTheDocument();expect(screen.queryByText('99')).not.toBeInTheDocument();
 expect(screen.getByText('3.4%')).toBeInTheDocument();expect(screen.getByText('12')).toBeInTheDocument();expect(screen.getByText('1.50')).toBeInTheDocument();
});
it.each([{symbol:'WRONG'},{as_of_date:'2026-01-01'},{bars:[{date:'2026-01-01',open:1,high:2,low:.5,close:1.5,volume:100}]}])('rejects mismatched payload identity %j',async extra=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(response(payload('NVDA',extra)));renderGrid();
 expect(await screen.findByText('Failed to load chart payload for NVDA.')).toBeInTheDocument();
 expect(screen.queryByRole('img',{name:/共通時間軸/})).not.toBeInTheDocument();
});
it('never draws a relative-strength line without its benchmark identity',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(response(payload('NVDA',{rs_line:[{time:date,value:1.2}]})));const {container}=renderGrid();
 await screen.findByRole('img',{name:/NVDA 価格/});expect(container.querySelector('[data-pane="rs"]')).toHaveTextContent('データなし');
 expect(container.querySelector('[data-series="rs"]')).toBeNull();
});
it('changes the query and SVG identity with a new publication and withholds old payloads',async()=>{
 let resolveNext;
 vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(response(payload())).mockImplementationOnce(()=>new Promise(resolve=>{resolveNext=resolve;}));
 const publication={mode:'legacy',baseURL:new URL('/',location.href).href,generation:'one',cacheIdentity:'one'};
 const view=renderGrid({publication});await screen.findByRole('img',{name:/NVDA 価格/});
 view.rerenderGrid({publication:{...publication,generation:'two',cacheIdentity:'two'}});
 await waitFor(()=>expect(resolveNext).toBeTypeOf('function'));expect(screen.queryByRole('img',{name:/NVDA 価格/})).not.toBeInTheDocument();
 resolveNext(response(payload('NVDA',{benchmark_symbol:'SPY',rs_line:[{time:date,value:1.2}]})));
 await screen.findByRole('img',{name:/NVDA 価格/});expect(view.container.querySelector('[data-series="rs"]')).not.toBeNull();
});

it('rejects invalid OHLC without crashing or displaying a fabricated last close',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(response(payload('NVDA',{bars:[{date,open:1,high:2,low:.5,close:'bad',volume:100}]})));
 renderGrid();expect(await screen.findByRole('alert')).toHaveTextContent('不整合');
 expect(screen.queryByRole('img',{name:/共通時間軸/})).not.toBeInTheDocument();expect(screen.queryByText('bad')).not.toBeInTheDocument();
});
