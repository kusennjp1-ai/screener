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
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: /max-width:\s*700px/.test(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
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
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: /max-width:\s*700px/.test(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
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
