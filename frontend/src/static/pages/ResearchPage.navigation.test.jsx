import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResearchPage from './ResearchPage';
import { prepareResearchBundle } from '../researchPreprocess';
import { withAuditFixture } from '../testAuditFixture';

const data = vi.hoisted(() => ({ bundle: null }));
vi.mock('../useResearchBundle', () => ({ useResearchBundle: () => ({ data: data.bundle, isError: false, isLoading: false }) }));
vi.mock('../dataClient', () => ({ useStaticManifest: () => ({ data: { generated_at: '2026-09-30T04:00:00Z' } }), resolveStaticMarketEntry: () => ({ as_of_date: '2026-09-29', assets: { research: { path: 'fixture.json' } } }), fetchStaticJson: vi.fn() }));
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
  return <Link to="/?sector=Financial&method=oneil&view=charts">金融の候補リンク</Link>;
}
function mount(hash = '#/') {
  window.history.replaceState(null, '', hash);
  return render(<QueryClientProvider client={client}><HashRouter><Navigation /><Routes>
    <Route path="/" element={<ResearchPage />} />
    <Route path="/compare" element={<ResearchPage compareOnly />} />
  </Routes></HashRouter></QueryClientProvider>);
}
const openFilters = () => {
  fireEvent.click(screen.getByRole('button', { name: '候補を絞り込む' }));
  return screen.getByRole('dialog', { name: '候補を絞り込む' });
};
beforeEach(() => {
  const rows = [['TECH', 'Technology', 102], ['BANK', 'Financial', 102], ['SMALL', 'Technology', 5]].map(([symbol, gics_sector, current_price]) => withAuditFixture({ symbol, company_name: `Synthetic ${symbol}`, gics_sector, market: 'US', currency: 'USD', current_price, adv_usd: 25000000, rs_rating: 90 }, '2026-09-29'));
  data.bundle = prepareResearchBundle([{ rows, as_of_date: '2026-09-29' }], '2026-09-29');
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '#/'); });

it('applies sector, method and view from a same-route RouterLink without remounting', async () => {
  const { container } = mount('#/?sector=Technology');
  expect(screen.getByRole('button', { name: /^TECH の分析/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^BANK の分析/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: '金融の候補リンク' }));
  await waitFor(() => expect(container.querySelector('.research-grid')).toHaveAttribute('data-view', 'charts'));
  expect(screen.getByRole('button', { name: 'オニール', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('比較候補')).toHaveTextContent('BANK');
  expect(screen.getByLabelText('比較候補')).not.toHaveTextContent('TECH');
  const filters = openFilters();
  expect(within(filters).getByRole('combobox', { name: '業種', exact: true })).toHaveValue('Financial');
});

it('restores a symbol-free list and liquidity on Back, and the linked mobile detail on Forward', async () => {
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: /max-width:\s*(?:700|1279)px/.test(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  const { container } = mount();
  act(() => navigate('/?symbol=SMALL&method=ibd'));
  await screen.findByRole('heading', { name: 'SMALL' });
  expect(container.querySelector('main')).toHaveAttribute('data-mobile-view', 'detail');
  await waitFor(() => expect(screen.getByRole('region', { name: '銘柄詳細' })).toHaveFocus());
  act(() => window.history.back());
  await waitFor(() => expect(container.querySelector('main')).toHaveAttribute('data-mobile-view', 'list'));
  expect(screen.getByRole('button', { name: 'ミネルヴィニ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: /^SMALL の分析/ })).not.toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /^BANK の分析/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^TECH の分析/ })).toBeInTheDocument();
  act(() => window.history.forward());
  await screen.findByRole('heading', { name: 'SMALL' });
  expect(container.querySelector('main')).toHaveAttribute('data-mobile-view', 'detail');
  expect(screen.getByRole('button', { name: 'IBD型', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

it('clears stale local filters and an open drawer when navigating to a symbol link', async () => {
  mount('#/?sector=Financial');
  const filters = openFilters();
  fireEvent.click(within(filters).getByLabelText('ウォッチのみ'));
  fireEvent.click(within(filters).getByLabelText('あと1条件'));
  fireEvent.change(within(filters).getByRole('combobox', { name: '検証状況' }), { target: { value: 'unverified' } });
  fireEvent.change(within(filters).getByLabelText('銘柄・企業名を検索'), { target: { value: 'BANK' } });
  await waitFor(() => expect(within(filters).getByRole('button', { name: /CSV保存/ })).toBeDisabled());
  act(() => navigate('/?symbol=TECH'));
  await screen.findByRole('heading', { name: 'TECH' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const restored = openFilters();
  expect(within(restored).getByLabelText('ウォッチのみ')).not.toBeChecked();
  expect(within(restored).getByLabelText('あと1条件')).not.toBeChecked();
  expect(within(restored).getByRole('combobox', { name: '業種', exact: true })).toHaveValue('');
  expect(within(restored).getByRole('combobox', { name: '検証状況' })).toHaveValue('all');
  expect(within(restored).getByLabelText('銘柄・企業名を検索')).toHaveValue('TECH');
});

it('dismisses a previous chart when a newer location is opened and restores defaults', async () => {
  const { container } = mount('#/?symbol=TECH&method=ibd');
  fireEvent.click(screen.getByRole('button', { name: 'チャートを開く' }));
  expect(screen.getByRole('dialog', { name: '日次分析' })).toHaveTextContent('TECH');
  act(() => navigate('/?method=unsupported&view=unsupported'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(container.querySelector('.research-grid')).toHaveAttribute('data-view', 'list');
  expect(screen.getByRole('button', { name: 'ミネルヴィニ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /^BANK の分析/ })).toBeInTheDocument();
});

it('reopens the same mobile symbol link after returning to the list and follows the latest navigation', async () => {
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: /max-width:\s*(?:700|1279)px/.test(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  const { container } = mount('#/?symbol=TECH');
  await waitFor(() => expect(screen.getByRole('region', { name: '銘柄詳細' })).toHaveFocus());
  act(() => window.dispatchEvent(new Event('research:back')));
  expect(container.querySelector('main')).toHaveAttribute('data-mobile-view', 'list');
  act(() => navigate('/?symbol=TECH'));
  await screen.findByRole('heading', { name: 'TECH' });
  await waitFor(() => expect(screen.getByRole('region', { name: '銘柄詳細' })).toHaveFocus());
  act(() => navigate('/?symbol=SMALL'));
  act(() => navigate('/?symbol=BANK'));
  await screen.findByRole('heading', { name: 'BANK' });
  await waitFor(() => expect(screen.getByRole('region', { name: '銘柄詳細' })).toHaveFocus());
  expect(screen.queryByRole('heading', { name: 'SMALL' })).not.toBeInTheDocument();
});

it('keeps removable filters visible and restores known initial filters without hiding the method',async()=>{
 mount('#/?sector=Financial');
 const chips=screen.getByLabelText('現在の絞り込み');
 expect(chips).toHaveTextContent('流動性');
 expect(chips).toHaveTextContent('業種');
 fireEvent.click(within(chips).getByRole('button',{name:/業種.*の絞り込みを解除/}));
 expect(await screen.findByRole('button',{name:/^TECH の分析/})).toBeInTheDocument();
 fireEvent.click(within(chips).getByRole('button',{name:'流動性の絞り込みを解除'}));
 expect(await screen.findByRole('button',{name:/^SMALL の分析/})).toBeInTheDocument();
 fireEvent.click(within(chips).getByRole('button',{name:'初期条件に戻す'}));
 expect(screen.queryByRole('button',{name:/^SMALL の分析/})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'ミネルヴィニ',exact:true})).toHaveAttribute('aria-pressed','true');
});

it('restores the tablet feed scroll, focus and active filters after returning from detail',async()=>{
 vi.stubGlobal('matchMedia',vi.fn(query=>({matches:/max-width:\s*1279px/.test(query),media:query,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
 const scrollTo=vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 vi.spyOn(window,'scrollY','get').mockReturnValue(624);
 const {container}=mount('#/?sector=Technology');
 const choice=screen.getByRole('button',{name:/^TECH の分析/});
 fireEvent.click(choice);
 expect(container.querySelector('main')).toHaveAttribute('data-mobile-view','detail');
 await waitFor(()=>expect(screen.getByRole('region',{name:'銘柄詳細'})).toHaveFocus());
 fireEvent.click(screen.getByRole('button',{name:'← 候補一覧に戻る'}));
 await waitFor(()=>expect(choice).toHaveFocus());
 expect(scrollTo).toHaveBeenCalledWith({top:624,behavior:'instant'});
 expect(screen.getByLabelText('現在の絞り込み')).toHaveTextContent('業種');
 expect(screen.queryByRole('button',{name:/^BANK の分析/})).not.toBeInTheDocument();
});

function useLargeUniverse() {
 const rows=Array.from({length:103},(_,index)=>withAuditFixture({symbol:`SIZE${String(index).padStart(3,'0')}`,company_name:`Synthetic size case ${index}`,gics_sector:'Technology',market:'US',currency:'USD',current_price:102,adv_usd:25000000,rs_rating:90},'2026-09-29'));
 data.bundle=prepareResearchBundle([{rows,as_of_date:'2026-09-29'}],'2026-09-29');
}

it.each([['',20],['20',20],['50',50],['100',20],['050',20],['50.0',20],['invalid',20]])('cold-loads feedSize=%s with %s cards and the complete count',(query,size)=>{
 useLargeUniverse();
 mount(`#/?feedSize=${query}`);
 expect(screen.getAllByRole('listitem')).toHaveLength(size);
 expect(screen.getByRole('combobox',{name:'1ページの銘柄数'})).toHaveValue(String(size));
 expect(screen.getByRole('status')).toHaveTextContent(`全103銘柄中1–${size}`);
 expect(screen.getByRole('heading',{name:'ミネルヴィニ 候補 103件'})).toBeInTheDocument();
});

it('changes the URL size without resetting search, filters, method, order or an off-page selected symbol',async()=>{
 useLargeUniverse();
 const {container}=mount('#/?sector=Technology&feedSize=50');
 act(()=>window.dispatchEvent(new CustomEvent('research:search',{detail:'Synthetic'})));
 fireEvent.click(screen.getByRole('button',{name:'オニール',exact:true}));
 fireEvent.change(screen.getByRole('combobox',{name:'候補の並び順'}),{target:{value:'rs'}});
 fireEvent.change(screen.getByRole('combobox',{name:'候補のページ'}),{target:{value:'1'}});
 fireEvent.click(screen.getByRole('button',{name:/^SIZE077 の分析/}));
 fireEvent.change(screen.getByRole('combobox',{name:'候補のページ'}),{target:{value:'0'}});
 expect(screen.queryByRole('button',{name:/^SIZE077 の分析/})).not.toBeInTheDocument();
 fireEvent.change(screen.getByRole('combobox',{name:'1ページの銘柄数'}),{target:{value:'20'}});
 await waitFor(()=>expect(window.location.hash).toContain('feedSize=20'));
 expect(window.location.hash).toContain('sector=Technology');
 expect(screen.getByRole('button',{name:'オニール',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('combobox',{name:'候補の並び順'})).toHaveValue('rs');
 expect(screen.getByLabelText('現在の絞り込み')).toHaveTextContent('検索：Synthetic');
 expect(screen.getByLabelText('現在の絞り込み')).toHaveTextContent('業種');
 expect(screen.getByRole('combobox',{name:'候補のページ'})).toHaveValue('3');
 expect(screen.getByRole('button',{name:/^SIZE077 の分析/})).toHaveAttribute('aria-current','true');
 expect(container.querySelector('#candidate-board')).toHaveAttribute('data-feed-selected-symbol','SIZE077');
 expect(screen.getByRole('status')).toHaveTextContent('全103銘柄中61–80');
});

it('restores page size through browser Back and Forward without clearing local research state',async()=>{
 useLargeUniverse();
 mount('#/?feedSize=20');
 act(()=>navigate('/?feedSize=50'));
 await waitFor(()=>expect(screen.getAllByRole('listitem')).toHaveLength(50));
 act(()=>window.dispatchEvent(new CustomEvent('research:search',{detail:'Synthetic'})));
 fireEvent.click(screen.getByRole('button',{name:'IBD型',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:/^SIZE010 の分析/}));
 act(()=>window.history.back());
 await waitFor(()=>expect(screen.getAllByRole('listitem')).toHaveLength(20));
 expect(screen.getByRole('button',{name:'IBD型',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByLabelText('現在の絞り込み')).toHaveTextContent('検索：Synthetic');
 expect(screen.getByRole('button',{name:/^SIZE010 の分析/})).toHaveAttribute('aria-current','true');
 act(()=>window.history.forward());
 await waitFor(()=>expect(screen.getAllByRole('listitem')).toHaveLength(50));
 expect(screen.getByRole('button',{name:'IBD型',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('button',{name:/^SIZE010 の分析/})).toHaveAttribute('aria-current','true');
});

it('keeps the mobile evidence return position when changing size around a selected symbol',async()=>{
 useLargeUniverse();
 vi.stubGlobal('matchMedia',vi.fn(query=>({matches:/max-width:\s*1279px/.test(query),media:query,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
 const scrollTo=vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 vi.spyOn(window,'scrollY','get').mockReturnValue(1864);
 const {container}=mount('#/?sector=Technology&feedSize=50');
 fireEvent.change(screen.getByRole('combobox',{name:'候補のページ'}),{target:{value:'1'}});
 fireEvent.click(screen.getByRole('button',{name:/^SIZE077 の分析/}));
 fireEvent.click(screen.getByRole('button',{name:'← 候補一覧に戻る'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:/^SIZE077 の分析/})).toHaveFocus());
 fireEvent.change(screen.getByRole('combobox',{name:'1ページの銘柄数'}),{target:{value:'20'}});
 await waitFor(()=>expect(window.location.hash).toContain('feedSize=20'));
 const selected=screen.getByRole('button',{name:/^SIZE077 の分析/});
 fireEvent.click(selected);
 await waitFor(()=>expect(screen.getByRole('region',{name:'銘柄詳細'})).toHaveFocus());
 fireEvent.click(screen.getByRole('button',{name:'← 候補一覧に戻る'}));
 await waitFor(()=>expect(selected).toHaveFocus());
 expect(container.querySelector('main')).toHaveAttribute('data-mobile-view','list');
 expect(scrollTo).toHaveBeenLastCalledWith({top:1864,behavior:'instant'});
 expect(screen.getByRole('combobox',{name:'候補のページ'})).toHaveValue('3');
 expect(screen.getByLabelText('現在の絞り込み')).toHaveTextContent('業種');
 expect(selected).toHaveAttribute('aria-current','true');
});
