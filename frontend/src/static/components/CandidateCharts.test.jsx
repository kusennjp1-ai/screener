import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import CandidateCharts from './CandidateCharts';
import { fetchStaticChartPayload } from '../chartClient';
import CandlestickChart from '../../components/Charts/CandlestickChart';

vi.mock('../chartClient',()=>({staticChartKeys:{payload:(symbol,path)=>[symbol,path]},fetchStaticChartPayload:vi.fn()}));
vi.mock('../../components/Charts/CandlestickChart',()=>({default:vi.fn(()=> <div data-testid="price-chart"/>)}));
const date='2026-09-29';
beforeEach(()=>{
  vi.stubGlobal('IntersectionObserver',class {constructor(callback){this.callback=callback;}observe(){this.callback([{isIntersecting:true}]);}disconnect(){}});
});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
function mount(audit,lastDate=date) {
  fetchStaticChartPayload.mockResolvedValue({symbol:'CASE',as_of_date:date,bars:[{date:lastDate,close:100}],rs_line:[]});
  const row={symbol:'CASE',current_price:100,chart_path:'case.json',technical_audit:audit};
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><CandidateCharts ordered={[{row,plan:{state:'未判定'},assessment:{passed:0,total:9}}]} date={date} method="minervini" market={{}} now={Date.parse(`${date}T22:00:00Z`)} onSelect={vi.fn()} /></QueryClientProvider>);
}
it('renders an identity-matched chart when the current daily history is verified',async()=>{
  mount({valid:true});
  expect(await screen.findByTestId('price-chart')).toBeInTheDocument();
});
it('explains failed daily verification instead of plotting it as a current comparison',async()=>{
  mount({valid:false,errors:['最終日足が分析日と不一致']},'2026-08-21');
  expect(await screen.findByRole('alert')).toHaveTextContent('日足を検証できません：最終日足が分析日と不一致');
  expect(screen.queryByTestId('price-chart')).not.toBeInTheDocument();
});
it('rejects a stale final bar even when the payload and audit claim the current date',async()=>{
  mount({valid:true},'2026-09-28');
  expect(await screen.findByRole('alert')).toHaveTextContent('最終日足が分析日と不一致');
  expect(screen.queryByTestId('price-chart')).not.toBeInTheDocument();
});
it('renders six cards, preserves canonical three-percent levels and changes the shared period together',async()=>{
  fetchStaticChartPayload.mockImplementation(path=>Promise.resolve({symbol:path.split('.')[0],as_of_date:date,bars:[{date,open:100,close:100,high:101,low:99,volume:1000}],rs_line:[]}));
  const ordered=Array.from({length:7},(_,i)=>({row:{symbol:`CASE${i}`,current_price:100,chart_path:`CASE${i}.json`,technical_audit:{valid:true}},plan:{state:'買いゾーン内',pivot:100,upper:103,stopExample:93,distance:0},assessment:{passed:9,total:9}}));
  const onSelect=vi.fn();
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><CandidateCharts ordered={ordered} date={date} method="minervini2" market={{}} now={Date.parse(`${date}T22:00:00Z`)} onSelect={onSelect}/></QueryClientProvider>);
  await waitFor(()=>expect(screen.getAllByTestId('price-chart')).toHaveLength(6));
  expect(screen.getAllByRole('article')).toHaveLength(6);
  expect(screen.queryByRole('article',{name:'CASE6 比較チャート'})).toBeNull();
  expect(fetchStaticChartPayload).toHaveBeenCalledTimes(6);
  for(const [props] of CandlestickChart.mock.calls){expect(props.buyCeiling).toBe(103);expect(props.stopPrice).toBe(93);expect(props.pivotPrice).toBe(100);expect(props.height).toBe(220);}
  const card=screen.getByRole('article',{name:'CASE0 比較チャート'});
  expect(within(card).getByText('$103.00')).toBeVisible();
  fireEvent.click(within(card).getByRole('button',{name:'CASE0 を分析'}));
  expect(onSelect).toHaveBeenCalledWith('CASE0');
  CandlestickChart.mockClear();
  fireEvent.change(screen.getByLabelText('全チャートの期間'),{target:{value:'21'}});
  expect(CandlestickChart).toHaveBeenCalledTimes(6);
  for(const [props] of CandlestickChart.mock.calls)expect(props.comparisonSessions).toBe(21);
});
it('reports absent data instead of converting it into a zero or a chart',async()=>{
  fetchStaticChartPayload.mockResolvedValue({symbol:'CASE',as_of_date:date,bars:[],rs_line:[]});
  const row={symbol:'CASE',chart_path:'case.json',technical_audit:{valid:true}};
  render(<QueryClientProvider client={new QueryClient()}><CandidateCharts ordered={[{row,plan:{state:'未判定'},assessment:{passed:0,total:9}}]} date={date} method="minervini" market={{}} onSelect={vi.fn()}/></QueryClientProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('日足データが不足しています');
  expect(screen.queryByTestId('price-chart')).not.toBeInTheDocument();
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
});
