import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import CandidateCharts from './CandidateCharts';
import { withAuditFixture } from '../testAuditFixture';
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
it('uses the same audited daily volume as the checklist and candidate list',()=>{
 const row=withAuditFixture({symbol:'VOLUME',current_price:102,se_pivot_price:100,rs_rating:95,se_volume_vs_50d:3,entry_evidence:{volumeRatio:2}},date);
 row.technical_audit.values.volumeRatio=1.39;
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><CandidateCharts ordered={[{row,assessment:{passed:9,total:9}}]} date={date} method="minervini" market={{}} now={Date.parse(`${date}T22:00:00Z`)} onSelect={vi.fn()}/></QueryClientProvider>);
 expect(screen.getByRole('article',{name:'VOLUME 比較チャート'})).toHaveTextContent('95 · 1.39×');
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

it.each([['minervini2','5/7',103,true],['minervini','6/7',105,true]])('keeps %s application limits and matching-book context distinct in chart cards',async(method,score,upper,sourceWarning)=>{
 const {withAuditFixture}=await import('../testAuditFixture');
 const row=withAuditFixture({symbol:'LIMIT',current_price:104,se_pivot_price:100,rs_rating:95,composite_rating:95,eps_rating:90,ibd_group_rank:10,
  chart_path:'LIMIT.json',entry_evidence:{as_of_date:date,calendar:{latest_completed_session:date,evaluated_at:`${date}T21:00:00Z`,valid_until:'2026-09-30T20:00:00Z'},earnings:{date:'2026-10-20',checked_at:`${date}T21:00:00Z`},shape:{candidate:true},volumeRatio:1.5}},date);
 fetchStaticChartPayload.mockResolvedValue({symbol:'LIMIT',as_of_date:date,bars:[{date,close:104}],rs_line:[]});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><CandidateCharts ordered={[{row,assessment:{passed:9,total:9}}]} date={date} method={method} market={{cap:.5,label:'上昇'}} now={Date.parse(`${date}T22:00:00Z`)} onSelect={vi.fn()}/></QueryClientProvider>);
 const card=screen.getByRole('article',{name:'LIMIT 比較チャート'});
 expect(within(card).getByText(`$${upper}.00`)).toBeInTheDocument();
 expect(within(card).getByText(score)).toBeInTheDocument();
 const description=card.querySelector('p.sr-only');
 expect(description).toHaveTextContent('アプリ上限');
 if(sourceWarning){expect(description).toHaveTextContent('書籍の追随目安外');expect(within(card).getByRole('note')).toBeInTheDocument();}
 else expect(description).not.toHaveTextContent('書籍の追随目安外');
 await screen.findByTestId('price-chart');
});

it('keeps an unknown condition, the source warning and price together without a separate warning row',()=>{
 const row=withAuditFixture({symbol:'UNKNOWN',company_name:'Unverified relative-strength company',market:'US',current_price:104,se_pivot_price:100,rs_rating:null},date);
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><CandidateCharts ordered={[{row,assessment:{passed:8,total:9}}]} nearOnly date={date} method="minervini" market={{cap:.5,label:'上昇'}} now={Date.parse(`${date}T22:00:00Z`)} onSelect={vi.fn()}/></QueryClientProvider>);
 const card=screen.getByRole('article',{name:'UNKNOWN 比較チャート'}),line=card.querySelector('.comparison-company');
 expect(line).toHaveTextContent('未確認：RS ≥ 70');
 expect(line).toHaveTextContent('$104.00');
 expect(within(line).getByRole('note',{name:/書籍の追随目安外：アプリの範囲内ですが/})).toHaveTextContent('△ 書籍目安2〜3%超');
 expect(card.querySelector('.entry-source-note')).toBeNull();
 expect(within(card).getByRole('button',{name:'UNKNOWN を分析'})).toHaveAccessibleDescription(/購入条件.*未達・未確認/);
});
