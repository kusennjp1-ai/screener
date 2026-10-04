import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResearchPage from './ResearchPage';
import StaticLayout from '../StaticLayout';
import { ThemeProvider, createTheme } from '@mui/material';
import { ColorModeContext } from '../../contexts/ColorModeContext';
import { prepareResearchBundle } from '../researchPreprocess';
import { withAuditFixture } from '../testAuditFixture';

const data = vi.hoisted(() => ({ bundle: null }));
vi.mock('../useResearchBundle', () => ({ useResearchBundle: () => ({ data: data.bundle, isError: false, isLoading: false }) }));
vi.mock('../dataClient', () => ({ useStaticManifest: () => ({ data: { generated_at: '2026-09-30T04:00:00Z' } }), getStaticSupportedMarkets: () => ['US'], resolveStaticMarketEntry: () => ({ market:'US', as_of_date: '2026-09-29', assets: { research: { path: 'fixture.json' } } }), fetchStaticJson: vi.fn() }));
vi.mock('../chartClient', () => ({ useStaticChartIndex: () => ({ data: null }) }));
vi.mock('../components/ResearchHero', () => ({ default: () => null }));
vi.mock('../components/CandidateCharts', () => ({ default: ({ ordered }) => <div aria-label="比較候補">{ordered.map(({ row }) => <span key={row.symbol}>{row.symbol}</span>)}</div> }));
vi.mock('../components/ResearchDetail', async () => {
  const { forwardRef } = await import('react');
  return { default: forwardRef(function MockResearchDetail({ selected, onExpand }, ref) {
    return <section ref={ref} tabIndex={-1} aria-label="銘柄詳細">{selected && <><h2>{selected.symbol}</h2><button onClick={onExpand}>チャートを開く</button></>}</section>;
  }) };
});
vi.mock('../StaticChartViewerModal', () => ({ default: ({ initialSymbol }) => <div role="dialog" aria-label="日次分析">{initialSymbol}</div> }));

let client;
let navigate;
function Navigation() {
  navigate = useNavigate();
  return null;
}
function mount(hash = '#/') {
  window.history.replaceState(null, '', hash);
  return render(<ThemeProvider theme={createTheme()}><ColorModeContext.Provider value={{toggleColorMode:vi.fn()}}>
    <QueryClientProvider client={client}><HashRouter><Navigation/><StaticLayout><Routes>
      <Route path="/" element={<ResearchPage/>}/><Route path="/compare" element={<ResearchPage compareOnly/>}/>
    </Routes></StaticLayout></HashRouter></QueryClientProvider>
  </ColorModeContext.Provider></ThemeProvider>);
}
const headerSearch=()=>within(document.querySelector('.leader-header')).getByLabelText('銘柄・企業名を検索');
const closeFilters=()=>fireEvent.click(screen.getByRole('button',{name:'絞り込みを閉じる'}));
const shownSymbols=()=>screen.getAllByRole('button',{name:/ の分析を表示/}).map(button=>button.textContent.match(/TECH|BANK|SMALL/)[0]);
const csvText=async()=>{
  fireEvent.click(screen.getByRole('button',{name:/全検索結果をCSV保存/}));
  const blob=URL.createObjectURL.mock.calls.at(-1)[0];
  let csv;
  await act(async()=>{csv=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});});
  return csv;
};
const openFilters = () => {
  fireEvent.click(screen.getByRole('button', { name: '候補を絞り込む' }));
  return screen.getByRole('dialog', { name: '候補を絞り込む' });
};
beforeEach(() => {
  const rows = [['TECH', 'Technology', 102], ['BANK', 'Financial', 102], ['SMALL', 'Technology', 5]].map(([symbol, gics_sector, current_price]) => withAuditFixture({ symbol, company_name: `Synthetic ${symbol}`, gics_sector, market: 'US', currency: 'USD', current_price, adv_usd: 25000000, rs_rating: 90 }, '2026-09-29'));
  data.bundle = prepareResearchBundle([{ rows, as_of_date: '2026-09-29' }], '2026-09-29');
  localStorage.clear();
  vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:vi.fn(()=> 'blob:fixture-csv'),revokeObjectURL:vi.fn()}));
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '#/'); });


it('clears the header query when its chip is removed and exports the restored candidate set',async()=>{
 mount();
 const search=headerSearch();
 fireEvent.change(search,{target:{value:'TECH'}});
 expect(shownSymbols()).toEqual(['BANK','TECH']);
 await waitFor(()=>expect(shownSymbols()).toEqual(['TECH']));
 fireEvent.click(screen.getByRole('button',{name:'検索：TECHの絞り込みを解除'}));
 await waitFor(()=>expect(shownSymbols()).toEqual(['BANK','TECH']));
 expect(search).toHaveValue('');
 const drawer=openFilters();
 expect(within(drawer).getByLabelText('銘柄・企業名を検索')).toHaveValue('');
 const csv=await csvText();
 expect(csv).toContain('BANK'); expect(csv).toContain('TECH'); expect(csv).not.toContain('SMALL');
});

it('shares drawer edits with the header, preserves other filters, and resets every search surface',async()=>{
 mount('#/?sector=Technology&method=oneil');
 const drawer=openFilters(),search=within(drawer).getByLabelText('銘柄・企業名を検索');
 fireEvent.change(search,{target:{value:'TECH'}});
 fireEvent.blur(search);
 expect(headerSearch()).toHaveValue('TECH');
 closeFilters();
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'候補を絞り込む'})).not.toBeInTheDocument());
 expect(screen.getByLabelText('現在の絞り込み')).toHaveTextContent('検索：TECH');
 expect(screen.getByLabelText('現在の絞り込み')).toHaveTextContent('業種');
 expect(screen.getByRole('button',{name:'オニール',exact:true})).toHaveAttribute('aria-pressed','true');
 const reopened=openFilters();
 expect(within(reopened).getByLabelText('銘柄・企業名を検索')).toHaveValue('TECH');
 const csv=await csvText();
 expect(csv).toContain('TECH'); expect(csv).not.toContain('BANK'); expect(csv).not.toContain('SMALL');
 closeFilters();
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'候補を絞り込む'})).not.toBeInTheDocument());
 fireEvent.click(screen.getByRole('button',{name:'初期条件に戻す'}));
 expect(headerSearch()).toHaveValue('');
 expect(shownSymbols()).toEqual(['BANK','TECH']);
 expect(screen.getByRole('button',{name:'オニール',exact:true})).toHaveAttribute('aria-pressed','true');
});

it('keeps header and drawer input IDs distinct and label targets exact',()=>{
 mount();
 const header=headerSearch(),drawer=openFilters(),input=within(drawer).getByLabelText('銘柄・企業名を検索');
 expect(header.id).not.toBe(input.id);
 expect(document.querySelectorAll('input[id^="candidate-search-"]')).toHaveLength(2);
 for(const element of [header,input])expect(document.getElementById(element.labels[0].htmlFor)).toBe(element);
});

it('restores the same shared search on route Back, Forward, and direct symbol navigation',async()=>{
 mount('#/?symbol=TECH');
 expect(headerSearch()).toHaveValue('TECH');
 act(()=>navigate('/?symbol=BANK&method=ibd'));
 await waitFor(()=>expect(headerSearch()).toHaveValue('BANK'));
 await waitFor(()=>expect(shownSymbols()).toEqual(['BANK']));
 act(()=>window.history.back());
 await waitFor(()=>expect(headerSearch()).toHaveValue('TECH'));
 await waitFor(()=>expect(shownSymbols()).toEqual(['TECH']));
 act(()=>window.history.forward());
 await waitFor(()=>expect(headerSearch()).toHaveValue('BANK'));
 act(()=>navigate('/'));
 await waitFor(()=>expect(headerSearch()).toHaveValue(''));
 await waitFor(()=>expect(shownSymbols()).toEqual(['BANK','TECH']));
});
