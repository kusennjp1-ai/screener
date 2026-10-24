import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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
  return { default: forwardRef(function MockResearchDetail() { return null; }) };
});
vi.mock('../StaticChartViewerModal', () => ({ default: () => null }));

let client;
beforeEach(() => {
  const rows = [['TECH', 'Technology', 102], ['BANK', 'Financial', 102], ['SMALL', 'Technology', 5]].map(([symbol, gics_sector, current_price]) => withAuditFixture({ symbol, company_name: `Synthetic ${symbol}`, gics_sector, market: 'US', currency: 'USD', current_price, adv_usd: 25000000, rs_rating: 90 }, '2026-09-29'));
  data.bundle = prepareResearchBundle([{ rows, as_of_date: '2026-09-29' }], '2026-09-29');
  localStorage.clear();
  localStorage.setItem('research-watch', JSON.stringify(['BANK']));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function mount(compareOnly = false) {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?method=oneil&sector=Financial']}><ResearchPage compareOnly={compareOnly} /></MemoryRouter></QueryClientProvider>);
}
function openFilters(compareOnly = false) {
  fireEvent.click(screen.getByRole('button', { name: compareOnly ? '手法・絞り込み' : '候補を絞り込む' }));
  return within(screen.getByRole('dialog', { name: '候補を絞り込む' }));
}

it.each([
  ['desktop list', false, '全条件通過のみ'],
  ['mobile comparison', true, 'あと1条件'],
])('restores default candidates from an empty filtered %s while preserving the method and saved watchlist', async (_name, compareOnly, qualification) => {
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: compareOnly && /max-width:\s*700px/.test(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  mount(compareOnly);
  const filters = openFilters(compareOnly);
  fireEvent.click(filters.getByLabelText(qualification));
  fireEvent.click(filters.getByLabelText('ウォッチのみ'));
  fireEvent.change(filters.getByRole('combobox', { name: '検証状況' }), { target: { value: 'unverified' } });
  fireEvent.click(filters.getByLabelText(/流動性：/));
  fireEvent.change(filters.getByLabelText('銘柄・企業名を検索'), { target: { value: 'NO-MATCH' } });
  // Wait for the debounced search to reach the page before resetting it.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  expect(filters.getByRole('button', { name: /CSV保存/ })).toBeDisabled();
  const reset = filters.getByRole('button', { name: '検索・絞り込みを初期化' });
  act(() => reset.focus());
  fireEvent.click(reset);
  expect(reset).toHaveFocus();
  expect(filters.getByLabelText('銘柄・企業名を検索')).toHaveValue('');
  expect(filters.getByLabelText('全条件通過のみ')).not.toBeChecked();
  expect(filters.getByLabelText('あと1条件')).not.toBeChecked();
  expect(filters.getByLabelText('ウォッチのみ')).not.toBeChecked();
  expect(filters.getByRole('combobox', { name: '業種', exact: true })).toHaveValue('');
  expect(filters.getByRole('combobox', { name: '検証状況' })).toHaveValue('all');
  expect(filters.getByLabelText(/流動性：/)).toBeChecked();
  expect(filters.getByRole('button', { name: 'オニール', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(JSON.parse(localStorage.getItem('research-watch'))).toEqual(['BANK']);
  await waitFor(() => expect(filters.getByRole('button', { name: /CSV保存/ })).toBeEnabled());
  fireEvent.click(filters.getByRole('button', { name: '絞り込みを閉じる' }));
  if (compareOnly) {
    expect(screen.getByLabelText('比較候補')).toHaveTextContent('BANK');
    expect(screen.getByLabelText('比較候補')).toHaveTextContent('TECH');
    expect(screen.getByLabelText('比較候補')).not.toHaveTextContent('SMALL');
  } else {
    expect(screen.getByRole('button', { name: /^BANK の分析/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^TECH の分析/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^SMALL の分析/ })).not.toBeInTheDocument();
  }
  const reopened = openFilters(compareOnly);
  fireEvent.click(reopened.getByLabelText('ウォッチのみ'));
  fireEvent.click(reopened.getByRole('button', { name: '絞り込みを閉じる' }));
  const results = compareOnly ? screen.getByLabelText('比較候補') : screen.getByRole('region', { name: '対象銘柄', exact: true });
  expect(results).toHaveTextContent('BANK');
  expect(results).not.toHaveTextContent('TECH');
});

it('cancels a pending search when reset is clicked before the debounce, even if the page search is already empty', async () => {
  mount();
  const filters = openFilters();
  vi.useFakeTimers();
  fireEvent.change(filters.getByLabelText('銘柄・企業名を検索'), { target: { value: 'NO-MATCH' } });
  fireEvent.click(filters.getByRole('button', { name: '検索・絞り込みを初期化' }));
  expect(filters.getByLabelText('銘柄・企業名を検索')).toHaveValue('');
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(filters.getByLabelText('銘柄・企業名を検索')).toHaveValue('');
  expect(filters.getByRole('button', { name: /CSV保存/ })).toBeEnabled();
  fireEvent.click(filters.getByRole('button', { name: '絞り込みを閉じる' }));
  expect(screen.getByRole('button', { name: /^BANK の分析/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^TECH の分析/ })).toBeInTheDocument();
});

it.each([false,true])('returns drawer focus once to trigger or candidate board, comparison=%s',async(compareOnly)=>{
 mount(compareOnly);
 const trigger=screen.getByRole('button',{name:compareOnly?'手法・絞り込み':'候補を絞り込む'});
 for(const action of ['close','escape','confirm']){
  act(()=>trigger.focus());fireEvent.click(trigger);
  const dialog=screen.getByRole('dialog',{name:'候補を絞り込む'});
  expect(within(dialog).getByLabelText('銘柄・企業名を検索')).toBeInTheDocument();
  if(action==='escape')fireEvent.keyDown(dialog,{key:'Escape',code:'Escape'});
  else fireEvent.click(within(dialog).getByRole('button',{name:action==='close'?'絞り込みを閉じる':'候補を確認する →'}));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'候補を絞り込む'})).not.toBeInTheDocument());
  await waitFor(()=>expect(action==='confirm'?screen.getByRole('region',{name:'対象銘柄',exact:true}):trigger).toHaveFocus());
 }
});
