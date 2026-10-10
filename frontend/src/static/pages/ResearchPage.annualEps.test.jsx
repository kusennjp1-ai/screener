import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResearchPage from './ResearchPage';
import { prepareResearchBundle } from '../researchPreprocess';
import { withAuditFixture } from '../testAuditFixture';
import { withFinancialProof, FINANCIAL_TEST_NOW as now, FINANCIAL_TEST_DATE as date } from '../testFinancialFixture';
import { BOOK_ANNUAL_EPS_LABEL } from '../bookAnnualEpsEvidence';

const data=vi.hoisted(()=>({bundle:null,chartProps:null}));
vi.mock('../useResearchBundle',()=>({useResearchBundle:()=>({data:data.bundle,evaluatedNow:Date.now(),isError:false,isLoading:false})}));
vi.mock('../dataClient',()=>({useStaticManifest:()=>({data:{generated_at:'2026-10-03T16:35:00Z'}}),resolveStaticMarketEntry:()=>({as_of_date:'2026-10-02',assets:{research:{path:'fixture.json'}}}),fetchStaticJson:vi.fn()}));
vi.mock('../chartClient',()=>({useStaticChartIndex:()=>({data:null})}));
vi.mock('../components/ResearchHero',()=>({default:()=>null}));
vi.mock('../components/CandidateCharts',()=>({default:({ordered})=><div aria-label="比較候補">{ordered.map(({row})=><span key={row.symbol}>{row.symbol}</span>)}</div>}));
vi.mock('../components/ResearchDetail',async()=>{
  const {forwardRef}=await import('react');
  return {default:forwardRef(function MockDetail({selected,onExpand,annualEpsOnly},ref){return <section ref={ref} aria-label="銘柄詳細" data-active={annualEpsOnly}>{selected&&<><h2>{selected.symbol}</h2><button onClick={onExpand}>チャートを開く</button></>}</section>;})};
});
vi.mock('../StaticChartViewerModal',()=>({default:props=>{data.chartProps=props;return <div role="dialog" aria-label="日次分析">{props.navigationSymbols.join(',')}</div>;}}));
let client,navigate;
function Nav(){navigate=useNavigate();return null;}
function mount(hash='#/'){window.history.replaceState(null,'',hash);return render(<QueryClientProvider client={client}><HashRouter><Nav/><Routes><Route path="/" element={<ResearchPage/>}/><Route path="/compare" element={<ResearchPage compareOnly/>}/></Routes></HashRouter></QueryClientProvider>);}
function open(){fireEvent.click(screen.getByRole('button',{name:'候補を絞り込む'}));return screen.getByRole('dialog',{name:'候補を絞り込む'});}
const close=()=>fireEvent.click(screen.getByRole('button',{name:'絞り込みを閉じる'}));
const row=(symbol,values,sector='Technology')=>withFinancialProof(withAuditFixture({symbol,market:'US',gics_sector:sector,currency:'USD',current_price:100,adv_usd:30000000,rs_rating:90,financial_history:{symbol,as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic provider',retrieved_at:new Date(now-3600000).toISOString(),annual:values.map((eps,i)=>({end:`${2022+i}-12-31`,eps})),quarterly:[]}},date),now,date);
beforeEach(()=>{
 vi.spyOn(Date,'now').mockReturnValue(now);localStorage.clear();
 data.bundle=prepareResearchBundle([{rows:[row('PASS',[1,1.2,1.6,2]),row('DOWN',[1,2,1.5,3]),row('MISSING',[1,null,2,3],'Financial')],as_of_date:date}],date,{now});
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));vi.stubGlobal('IntersectionObserver',class{observe(){}disconnect(){}});
 client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(()=>{cleanup();client.clear();vi.unstubAllGlobals();vi.restoreAllMocks();window.history.replaceState(null,'','#/');});

it('defaults off and AND-filters without resetting base filters; lists, detail, modal navigation and CSV agree',async()=>{
 mount();const drawer=open();expect(within(drawer).getByLabelText(BOOK_ANNUAL_EPS_LABEL)).not.toBeChecked();
 expect(within(drawer).getByTestId('annual-eps-coverage')).toHaveTextContent('3銘柄：数値充足 1 · 未充足 1 · 未確認 1');
 fireEvent.change(within(drawer).getByRole('combobox',{name:'業種',exact:true}),{target:{value:'Technology'}});
 expect(within(drawer).getByTestId('annual-eps-coverage')).toHaveTextContent('2銘柄：数値充足 1 · 未充足 1 · 未確認 0');
 fireEvent.click(within(drawer).getByLabelText('全条件通過のみ'));
 fireEvent.click(within(drawer).getByLabelText(BOOK_ANNUAL_EPS_LABEL));
 await waitFor(()=>expect(window.location.hash).toContain('annualEps=1'));
 expect(within(drawer).getByLabelText('全条件通過のみ')).toBeChecked();
 expect(within(drawer).getByRole('combobox',{name:'業種',exact:true})).toHaveValue('Technology');
 const create=vi.fn(()=> 'blob:synthetic');Object.defineProperty(URL,'createObjectURL',{value:create,configurable:true});Object.defineProperty(URL,'revokeObjectURL',{value:vi.fn(),configurable:true});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 fireEvent.click(within(drawer).getByRole('button',{name:/CSV保存/}));expect(create).toHaveBeenCalledTimes(1);
 const csv=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(create.mock.calls[0][0]);});
 expect(csv.split('\r\n')).toHaveLength(2);expect(csv).toContain('"PASS"');expect(csv).not.toContain('"DOWN"');
 close();expect(screen.getByRole('button',{name:/^PASS の分析/})).toBeInTheDocument();expect(screen.queryByRole('button',{name:/^DOWN の分析/})).not.toBeInTheDocument();
 expect(screen.getByText(/追加絞り込み有効：年次EPS/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'チャートを開く'}));expect(screen.getByRole('dialog',{name:'日次分析'})).toHaveTextContent('PASS');expect(data.chartProps.annualEpsOnly).toBe(true);
});

it('restores bounded URL state on Back/Forward and same-route links; chart and mobile results stay filtered',async()=>{
 vi.stubGlobal('matchMedia',vi.fn(query=>({matches:/max-width:\s*700px/.test(query),media:query,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
 const {container}=mount('#/?annualEps=1&symbol=PASS');expect(container.querySelector('main')).toHaveAttribute('data-mobile-view','detail');
 act(()=>navigate('/?annualEps=1&view=charts'));await waitFor(()=>expect(screen.getByLabelText('比較候補')).toHaveTextContent('PASS'));expect(screen.getByLabelText('比較候補')).not.toHaveTextContent('DOWN');
 act(()=>navigate('/?annualEps=unsupported'));await waitFor(()=>expect(screen.getByRole('button',{name:/^DOWN の分析/})).toBeInTheDocument());expect(screen.queryByText(/追加絞り込み有効：年次EPS/)).not.toBeInTheDocument();
 act(()=>navigate(-1));await waitFor(()=>expect(screen.getByLabelText('比較候補')).toHaveTextContent('PASS'));expect(screen.getByLabelText('比較候補')).not.toHaveTextContent('DOWN');
 act(()=>navigate(1));await waitFor(()=>expect(screen.getByRole('button',{name:/^DOWN の分析/})).toBeInTheDocument());
});

it('retains the optional filter on method changes but never overrides the old O’Neil annual rule',async()=>{
 mount('#/?annualEps=1');const drawer=open();fireEvent.click(within(drawer).getByLabelText('全条件通過のみ'));fireEvent.click(within(drawer).getByRole('button',{name:'オニール',exact:true}));
 expect(within(drawer).getByLabelText(BOOK_ANNUAL_EPS_LABEL)).toBeChecked();expect(within(drawer).getByTestId('annual-eps-coverage')).toHaveTextContent('0銘柄');close();
 expect(screen.queryByRole('button',{name:/^PASS の分析/})).not.toBeInTheDocument();expect(screen.getByText(/該当銘柄がありません/)).toBeInTheDocument();
});

it('removes an open excluded chart rather than falling back to unfiltered navigation',async()=>{
 mount();fireEvent.click(screen.getByRole('button',{name:/^DOWN の分析/}));fireEvent.click(screen.getByRole('button',{name:'チャートを開く'}));expect(screen.getByRole('dialog',{name:'日次分析'})).toBeInTheDocument();
 act(()=>navigate('/?annualEps=1'));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'日次分析'})).not.toBeInTheDocument());expect(screen.queryByRole('button',{name:/^DOWN の分析/})).not.toBeInTheDocument();
});
