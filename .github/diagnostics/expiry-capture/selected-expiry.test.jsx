// Diagnostic-only synthetic two-row fixture. This is not AVT/MRVI source data.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ResearchPage from '@ui/pages/ResearchPage';
import { prepareResearchBundle } from '@ui/researchPreprocess';
import { withAuditFixture } from '@ui/testAuditFixture';
import { withFinancialProof } from '@ui/testFinancialFixture';
import { assess, researchCsv } from '@ui/researchEngine';
const state=vi.hoisted(()=>({rows:[],requests:[],finish:null,worker:{loadResearchBundle:vi.fn(),refreshResearchBundle:vi.fn()}}));
vi.mock('@ui/researchWorkerClient',()=>state.worker);
vi.mock('@ui/dataClient',()=>({
  useStaticManifest:()=>({data:{research_generation:'synthetic-diagnostic-v1',generated_at:'2026-10-03T12:00:00Z'}}),
  resolveStaticMarketEntry:()=>({as_of_date:'2026-10-02',assets:{research:{path:'synthetic.json'}}}),
  fetchStaticJson:vi.fn(),
}));
vi.mock('@ui/chartClient',()=>({useStaticChartIndex:()=>({data:{symbols:[]}})}));
vi.mock('@ui/components/ResearchChart',()=>({default:()=>null}));
vi.mock('@ui/components/ResearchHero',()=>({default:()=>null}));
vi.mock('@ui/components/CandidatePerformance',()=>({default:()=>null}));
vi.mock('@ui/components/WatchNotifications',()=>({default:()=>null}));
const start=Date.parse('2026-10-03T12:00:00Z'),date='2026-10-02',deadline=start+1000;
const history=(symbol,retrieved_at,eps)=>({symbol,as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic diagnostic only',retrieved_at:new Date(retrieved_at).toISOString(),annual:eps.map((eps,index)=>({end:`${2022+index}-12-31`,eps}))});
const makeRows=()=>[
  withFinancialProof(withAuditFixture({symbol:'AVT',company_name:'Synthetic AVT-like diagnostic only',market:'US',current_price:100,adv_usd:50000000,rs_rating:95,eps_growth_yy:30,sales_growth_yy:30,institutional_sponsors_increasing:true,institutional_evidence:{symbol:'AVT',status:'available',unit:'13f_reporting_manager_cik',publication_cutoff:'2026-08-31',observations:[{period:'2026-03-31',manager_count:100,filing_date_first:'2026-04-10',filing_date_last:'2026-05-15'},{period:'2026-06-30',manager_count:110,filing_date_first:'2026-07-10',filing_date_last:'2026-08-15'}]},market_above_50dma:true,market_above_200dma:true,financial_history:history('AVT',start,[5,4,3,null])},date),start,date),
  withFinancialProof(withAuditFixture({symbol:'MRVI',company_name:'Synthetic unselected expiring history only',market:'US',current_price:100,adv_usd:50000000,financial_history:history('MRVI',deadline-72*3600000,[1,2,4,8])},date),start,date),
];
let client;
afterEach(()=>{cleanup();client?.clear();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
it.each([false,true])('withholds all decisions at unrelated expiries, restoring AVT only at the latest current epoch (overlap: %s)',async overlap=>{
  vi.useFakeTimers();vi.setSystemTime(start);
  vi.stubGlobal('requestAnimationFrame',callback=>setTimeout(()=>callback(performance.now()),16));
  vi.stubGlobal('cancelAnimationFrame',id=>clearTimeout(id));
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));
  vi.stubGlobal('matchMedia',vi.fn(query=>({matches:/max-width:\s*700px/.test(query),media:query,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
  const scroll=vi.fn();Element.prototype.scrollIntoView=scroll;
  window.history.replaceState(null,'','#/?method=oneil&symbol=AVT');localStorage.clear();
  state.rows=makeRows();state.requests=[];
  if(overlap)state.rows.push(withFinancialProof(withAuditFixture({symbol:'BWLP',market:'US',current_price:100,financial_history:history('BWLP',deadline+500-72*3600000,[1,2,4,8])},date),start,date));
  state.worker.loadResearchBundle.mockImplementation((_path,_date,_fetch,_signal,options)=>Promise.resolve(prepareResearchBundle([{as_of_date:date,rows:state.rows}],date,options)));
  state.worker.refreshResearchBundle.mockImplementation((rows,actualDate,options)=>new Promise(resolve=>{state.requests.push(options);state.finish=()=>resolve(prepareResearchBundle([{as_of_date:actualDate,rows}],actualDate,options));}));
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  render(<QueryClientProvider client={client}><HashRouter><ResearchPage/></HashRouter></QueryClientProvider>);
  await act(async()=>vi.advanceTimersByTimeAsync(100));
  expect(screen.getByRole('heading',{name:'AVT',exact:true})).toBeInTheDocument();
  await act(async()=>vi.advanceTimersByTimeAsync(20));
  expect(scroll).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('tab',{name:'財務・機関',exact:true}));
  const annual=()=>document.querySelector('#financial-evidence-annual_eps_growth_3y');
  expect(annual()).toHaveAttribute('data-state','fail');
  const before=annual().textContent;
  expect(assess(state.rows[0],'oneil',start)).toMatchObject({passed:7,total:8,failed:1,unknown:0});
  expect(client.getQueryData(['researchRows','synthetic.json','synthetic-diagnostic-v1']).next_expiry_at).toBe(deadline+1);
  const sourceBefore=JSON.stringify(state.rows[0].financial_history);
  const scrollBefore=scroll.mock.calls.length;
  await act(async()=>vi.advanceTimersByTimeAsync(880));
  expect(Date.now()).toBe(deadline);
  expect(annual()).toHaveAttribute('data-state','fail');
  expect(state.worker.refreshResearchBundle).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect(Date.now()).toBe(deadline+1);
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0]).toMatchObject({now:deadline+1,generation:'synthetic-diagnostic-v1',evaluationEpoch:2});
  expect(screen.getByText('銘柄と分析根拠を読み込んでいます…')).toBeInTheDocument();
  expect(annual()).toBeNull();
  expect(screen.queryByRole('heading',{name:'AVT',exact:true})).not.toBeInTheDocument();
  expect(screen.queryByRole('tab',{name:'財務・機関',exact:true})).not.toBeInTheDocument();
  await act(async()=>vi.advanceTimersByTimeAsync(2000));
  expect(state.requests).toHaveLength(1);expect(state.requests[0].signal.aborted).toBe(false);expect(annual()).toBeNull();
  await act(async()=>{state.finish();await vi.advanceTimersByTimeAsync(1);});
  if(overlap){
    expect(state.requests).toHaveLength(2);
    expect(state.requests[1]).toMatchObject({generation:'synthetic-diagnostic-v1',evaluationEpoch:3});
    expect(annual()).toBeNull();
    expect(screen.queryByRole('heading',{name:'AVT',exact:true})).not.toBeInTheDocument();
    await act(async()=>{state.finish();await vi.advanceTimersByTimeAsync(1);});
  }
  const bundle=client.getQueryData(['researchRows','synthetic.json','synthetic-diagnostic-v1']);
  expect(bundle).toMatchObject({generation:'synthetic-diagnostic-v1',evaluation_epoch:overlap?3:2,evaluated_at:state.requests.at(-1).now});
  expect(screen.getByRole('heading',{name:'AVT',exact:true})).toBeInTheDocument();
  expect(screen.getByRole('tab',{name:'財務・機関',exact:true})).toHaveAttribute('aria-selected','true');
  expect(annual()).toHaveAttribute('data-state','fail');expect(annual().textContent).toBe(before);
  expect(screen.queryByText('銘柄と分析根拠を読み込んでいます…')).not.toBeInTheDocument();
  expect(scroll.mock.calls.length).toBe(scrollBefore);
  expect(JSON.stringify(state.rows[0].financial_history)).toBe(sourceBefore);
  const av= bundle.rows.find(row=>row.symbol==='AVT');
  expect(assess(av,'oneil',Date.now())).toMatchObject({passed:7,total:8,failed:1,unknown:0});
  fireEvent.click(screen.getByRole('tab',{name:'判定根拠',exact:true}));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('選定 7/8 · 未達 1 · 未確認 0');
  const csv=researchCsv([{row:av}],'oneil',date,Date.now());
  expect(csv).toContain('annual_eps_rule_state');expect(csv).toContain('fail');
  // jsdom has no layout: this verifies no application scroll request, not
  // preservation of the browser's scroll offset while content is removed.
});
