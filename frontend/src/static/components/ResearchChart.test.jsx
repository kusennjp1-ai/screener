import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchChart from './ResearchChart';
const fetchPayload = vi.hoisted(() => vi.fn());
vi.mock('../chartClient', () => ({ fetchStaticChartPayload: fetchPayload, staticChartKeys: { payload: (symbol, path) => ['chart', symbol, path] } }));
vi.mock('../../components/Charts/CandlestickChart', () => ({ default: ({ symbol, priceData, pivotPrice }) => <div data-testid="chart">{symbol}:{priceData.length}:{pivotPrice}</div> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function setup(props) {
  props={date:'2026-09-21',...props};
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, placeholderData: previous => previous } } });
  const wrap = p => <QueryClientProvider client={client}><ResearchChart date="2026-09-21" {...p} /></QueryClientProvider>;
  const view = render(wrap(props));
  return { ...view, update: p => view.rerender(wrap(p)) };
}
describe('inline chart integration', () => {
  it('loads static bars, then switches symbol without reusing the previous chart', async () => {
    fetchPayload.mockImplementation(async path=>({ symbol:path==='a.json'?'AAA':'BBB',as_of_date:'2026-09-21',bars: [{ date: '2026-09-21', close: 100 }], signal: { trigger_price: 120 }, stock_data: {vcp_pivot:110} }));
    const view = setup({ entry: { path: 'a.json' }, symbol: 'AAA', generation: '1', row:{current_price:100,se_pivot_price:99} });
    expect(await screen.findByTestId('chart')).toHaveTextContent('AAA:1:99');
    view.update({ entry: { path: 'b.json' }, symbol: 'BBB', generation: '1', row:{current_price:100,se_pivot_price:99} });
    await waitFor(() => expect(screen.getByTestId('chart')).toHaveTextContent('BBB:1:99'));
    expect(fetchPayload).toHaveBeenCalledWith('b.json');
  });
  it('refetches unchanged paths when the generation changes', async () => {
    fetchPayload.mockResolvedValue({symbol:'AAA',as_of_date:'2026-09-21',bars:[{date:'2026-09-21',close:100}]});
    const props = { entry: { path: 'a.json' }, symbol: 'AAA', generation: '1' };
    const view = setup(props);
    await screen.findByTestId('chart');
    view.update({ ...props, generation: '2' });
    await waitFor(() => expect(fetchPayload).toHaveBeenCalledTimes(2));
  });
  it('never labels previous-symbol bars as the newly selected symbol while loading', async () => {
    fetchPayload.mockResolvedValueOnce({symbol:'AAA',as_of_date:'2026-09-21',bars:[{date:'2026-09-21',close:100}]}).mockImplementationOnce(() => new Promise(() => {}));
    const view = setup({ entry: { path: 'a.json' }, symbol: 'AAA' });
    await screen.findByTestId('chart');
    view.update({ entry: { path: 'b.json' }, symbol: 'BBB' });
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
  it('does not request a live backend when a static chart is absent', () => {
    setup({ symbol: 'NONE' });
    expect(screen.getByText('この銘柄のチャートは未配信です。')).toBeInTheDocument();
    expect(fetchPayload).not.toHaveBeenCalled();
  });
  it('recovers after a failed chart download', async () => {
    fetchPayload.mockRejectedValueOnce(Error('offline')).mockResolvedValue({symbol:'AAA',as_of_date:'2026-09-21',bars:[{date:'2026-09-21',close:100}]});
    setup({ entry: { path: 'a.json' }, symbol: 'AAA' });
    await screen.findByText('チャートを取得できません。');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByTestId('chart')).toHaveTextContent('AAA');
  });
});

it.each([
 ['other symbol',{symbol:'BBB'}],['other snapshot',{as_of_date:'2026-09-18'}],['missing symbol',{symbol:undefined}],['missing snapshot',{as_of_date:undefined}],['stale last bar',{bars:[{date:'2026-09-18',close:100}]}],
])('refuses %s from the chart response',async(_label,override)=>{
 fetchPayload.mockResolvedValue({symbol:'AAA',as_of_date:'2026-09-21',bars:[{date:'2026-09-21',close:100}],...override});
 setup({entry:{path:'a.json'},symbol:'AAA',date:'2026-09-21'});
 await screen.findByText('チャートを取得できません。');
 expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
});
it('revalidates cached bars when the expected date changes without a path change',async()=>{
 fetchPayload.mockResolvedValue({symbol:'AAA',as_of_date:'2026-09-21',bars:[{date:'2026-09-21',close:100}]});
 const props={entry:{path:'a.json'},symbol:'AAA',date:'2026-09-21'};
 const view=setup(props);await screen.findByTestId('chart');
 view.update({...props,date:'2026-09-22'});
 await screen.findByText('チャートを取得できません。');
 expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
 expect(fetchPayload).toHaveBeenCalledTimes(1);
});
it('does not treat a missing expected analysis date as verified',async()=>{
 fetchPayload.mockResolvedValue({symbol:'AAA',as_of_date:'2026-09-21',bars:[{date:'2026-09-21',close:100}]});
 setup({entry:{path:'a.json'},symbol:'AAA',date:undefined});
 await screen.findByText('チャートを取得できません。');
 expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
});
