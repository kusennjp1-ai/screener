import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResearchPage from './ResearchPage';
import { prepareResearchBundle } from '../researchPreprocess';

// State/placement coverage only: jsdom cannot certify pixels or viewport counts.
const data=vi.hoisted(()=>({bundle:null,date:'2026-10-09',generated:'2026-10-10T11:00:00Z',generation:'first',loading:false,error:false}));
vi.mock('../useResearchBundle',()=>({useResearchBundle:()=>({data:data.bundle,isLoading:data.loading,isError:data.error})}));
vi.mock('../dataClient',()=>({
  useStaticManifest:()=>({data:{generated_at:data.generated,research_generation:data.generation},isLoading:data.loading}),
  resolveStaticMarketEntry:()=>({as_of_date:data.date,assets:{research:{path:'fixture.json'}}}),
  fetchStaticJson:async()=>({}),
}));
vi.mock('../chartClient',()=>({useStaticChartIndex:()=>({data:null})}));
vi.mock('../useWorkbench',()=>({useWorkbench:()=>({}),useWorkbenchDetails:()=>({})}));
vi.mock('../components/SetupRadar',()=>({default:()=> <div aria-label="Test radar"/>}));
vi.mock('../components/PortfolioDecision',()=>({default:()=>null}));
vi.mock('../components/CandidatePerformance',()=>({default:()=>null}));
vi.mock('../components/WatchNotifications',()=>({default:()=>null}));
vi.mock('../components/CandidateBoard',()=>({default:({onSelect})=><button onClick={()=>onSelect('TEST')}>Select test row</button>}));
vi.mock('../components/ResearchDetail',async()=>{
  const {forwardRef}=await import('react');
  return {default:forwardRef(function Detail(_,ref){return <section ref={ref} tabIndex={-1} aria-label="Test detail"/>;})};
});
const now=Date.parse('2026-10-10T12:00:00Z');
let client;
function publish({date='2026-10-09',generated='2026-10-10T11:00:00Z',generation='first',session=false}={}) {
  Object.assign(data,{date,generated,generation,loading:false,error:false});
  const rows=session?[{symbol:'TEST',as_of_date:date,entry_evidence:{as_of_date:date,calendar:{latest_completed_session:date,evaluated_at:'2026-10-10T11:00:00Z',valid_until:'2026-10-10T13:00:00Z'}}}]:[];
  data.bundle=prepareResearchBundle([{rows,as_of_date:date || '2026-10-09'}],date || '2026-10-09',{now,generation});
  if(date===null)data.bundle={...data.bundle,date:null};
}
function viewport(small) {
  vi.stubGlobal('matchMedia',vi.fn(query=>({matches:small&&/max-width:\s*700px/.test(query),media:query,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
}
function tree(compareOnly=false,mode='dark') {
  return <ThemeProvider theme={createTheme({palette:{mode}})}><QueryClientProvider client={client}><HashRouter><ResearchPage compareOnly={compareOnly}/></HashRouter></QueryClientProvider></ThemeProvider>;
}
beforeEach(()=>{
  window.history.replaceState(null,'','#/');localStorage.clear();
  vi.spyOn(Date,'now').mockReturnValue(now);
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));
  viewport(false);publish();
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(()=>{cleanup();client.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});

it.each([
  ['none','2026-10-09','2026-10-10T11:00:00Z',0,false],
  ['price only','2026-10-02','2026-10-10T11:00:00Z',1,false],
  ['publication only','2026-10-09','2026-10-04T04:49:09Z',1,true],
  ['both','2026-10-02','2026-10-04T04:49:09Z',1,true],
  ['missing publication','2026-10-09',null,1,true],
  ['unknown price',null,'2026-10-10T11:00:00Z',1,false],
])('renders the union for %s without duplicated banners',(label,date,generated,count,publication)=>{
  publish({date,generated});render(tree());
  expect(screen.queryAllByRole('alert',{name:'分析データの鮮度'})).toHaveLength(count);
  expect(screen.queryAllByRole('alert')).toHaveLength(count);
  if(count) expect(screen.getByRole('alert').textContent.includes('公開データ要確認')).toBe(publication);
});

it.each([['desktop','dark',false],['desktop','light',false],['mobile','dark',true],['mobile','light',true]])('preserves one warning in the %s %s comparison heading',(label,mode,small)=>{
  viewport(small);publish({date:'2026-10-02',generated:'2026-10-04T04:49:09Z'});render(tree(true,mode));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert').closest('.comparison-page-heading')).not.toBeNull();
  expect(screen.getByRole('alert').querySelector('summary')).toHaveTextContent('公開データ要確認');
});

it('retains the single combined warning while collapsing and expanding the hero',()=>{
  publish({date:'2026-10-02',generated:'2026-10-04T04:49:09Z'});render(tree());
  for(const label of ['概況をたたむ','概況を展開']) {
    fireEvent.click(screen.getByRole('button',{name:label}));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').closest('.research-hero')).not.toBeNull();
  }
});

it('moves the one combined warning to mobile detail and back without hiding it',()=>{
  viewport(true);publish({date:'2026-10-02',generated:'2026-10-04T04:49:09Z'});render(tree());
  expect(screen.getByRole('alert').closest('.research-hero')).not.toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Select test row'}));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert').parentElement).toHaveClass('research-workbench');
  fireEvent.click(screen.getByRole('button',{name:'← 候補一覧に戻る'}));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert').closest('.research-hero')).not.toBeNull();
});

it('updates warning evidence with a changed generation, never renewing the old price date',()=>{
  publish({date:'2026-10-02',generated:'2026-10-04T04:49:09Z'});const view=render(tree());
  expect(screen.getByRole('alert')).toHaveTextContent('公開データ要確認');
  publish({date:'2026-10-02',generation:'replacement'});view.rerender(tree());
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent('分析基準日 2026-10-02');
  expect(screen.getByRole('alert')).not.toHaveTextContent('公開データ要確認');
  publish({generation:'next-date'});view.rerender(tree());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps the existing strict 96-hour publication boundary',()=>{
  publish({generated:new Date(now-96*3600000).toISOString()});const view=render(tree());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  publish({generated:new Date(now-96*3600000-1).toISOString()});view.rerender(tree());
  expect(screen.getByRole('alert')).toHaveTextContent('公開データ要確認');
});

it('preserves the valid-session exemption without letting it erase an old price warning',()=>{
  publish({date:'2026-10-02',generated:'2026-10-04T04:49:09Z',session:true});render(tree());
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent('分析基準日 2026-10-02');
  expect(screen.getByRole('alert')).not.toHaveTextContent('公開データ要確認');
});

it('does not drop the publication warning while the bundle is unavailable',()=>{
  publish({generated:'2026-10-04T04:49:09Z'});data.bundle=undefined;data.loading=true;render(tree());
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent('公開データ要確認');
});

it('preserves the warning and retrieval error as separate meanings when the bundle fails',()=>{
  publish({generated:'2026-10-04T04:49:09Z'});data.bundle=undefined;data.error=true;render(tree());
  expect(screen.getAllByRole('alert',{name:'分析データの鮮度'})).toHaveLength(1);
  expect(screen.getByRole('alert',{name:'分析データの鮮度'})).toHaveTextContent('この画面では現在有効なセッション資料を確認できません。');
  expect(screen.getByText(/データを取得できません/)).toBeInTheDocument();
});

it('keeps the existing future-publication behavior without claiming current source capture',()=>{
  publish({generated:'2026-10-11T12:00:00Z'});render(tree());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('adds the publication warning when the existing clock check crosses 96 hours',async()=>{
  publish({generated:new Date(now-96*3600000).toISOString()});render(tree());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  Date.now.mockReturnValue(now+1);
  await act(async()=>{await client.refetchQueries({queryKey:['researchClock']});});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('公開データ要確認'));
});

it('restores the publication warning when the valid session expires without changing the generation',async()=>{
  publish({date:'2026-10-02',generated:'2026-10-04T04:49:09Z',session:true});render(tree());
  expect(screen.getByRole('alert')).not.toHaveTextContent('公開データ要確認');
  Date.now.mockReturnValue(Date.parse('2026-10-10T13:00:00Z'));
  await act(async()=>{await client.refetchQueries({queryKey:['researchClock']});});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('公開データ要確認'));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent('分析基準日 2026-10-02');
});
