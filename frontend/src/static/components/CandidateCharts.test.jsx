import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import CandidateCharts from './CandidateCharts';
import { fetchStaticChartPayload } from '../chartClient';

vi.mock('../chartClient',()=>({staticChartKeys:{payload:(symbol,path)=>[symbol,path]},fetchStaticChartPayload:vi.fn()}));
vi.mock('../../components/Charts/CandlestickChart',()=>({default:()=> <div data-testid="price-chart"/>}));
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
