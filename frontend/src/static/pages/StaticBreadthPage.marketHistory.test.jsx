import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { observation, payload, series } from '../../../tools/fixtures/market-history.mjs';
import { MARKET_HISTORY_SNAPSHOT_VERSION } from '../marketHistoryAsset';
import StaticBreadthPage from './StaticBreadthPage';

const state = vi.hoisted(() => ({ manifest: null, publication: null, fetch: vi.fn() }));
vi.mock('../dataClient', async importOriginal => ({ ...await importOriginal(),
  useStaticManifest: () => ({ data: state.manifest, isLoading: false, isError: false, refetch: vi.fn() }),
  fetchStaticJson: (...args) => state.fetch(...args),
}));
vi.mock('../staticPublication', async importOriginal => ({ ...await importOriginal(), publicationForManifest: () => state.publication }));
vi.mock('../StaticMarketContext', () => ({ useStaticMarket: () => ({ selectedMarket: 'US' }), STATIC_DEFAULT_MARKET: 'US' }));
vi.mock('../../components/Charts/BreadthChart', () => ({ default: () => null }));
vi.mock('../components/ConnectionStatus', () => ({ default: () => null }));
vi.mock('../components/MarketPulse', () => ({ default: () => null }));
vi.mock('../components/BookBreakoutJournal', () => ({ default: () => null }));

const date = '2026-10-09', hash = 'a'.repeat(64);
const reference = (sha256 = hash, asOf = date) => ({ path: `market-history/snapshots/${sha256}.json`, sha256, schema_version: MARKET_HISTORY_SNAPSHOT_VERSION, market: 'US', as_of_date: asOf });
const saved = (value = 4321, asOf = date) => ({ schema_version: MARKET_HISTORY_SNAPSHOT_VERSION, market: 'US', as_of_date: asOf,
  history: payload(series('new_highs', { observations: [observation(value, asOf)] })),
  provenance: { producer: 'synthetic-test-only', sec: { retrieved_at: '2026-10-10T01:00:00.123456Z', publication_cutoff: '2026-08-31' } } });
const breadth = (asOf = date) => ({ payload: { current: { date: asOf }, chart_data: [],
  market_indicator_history: payload(series('new_highs', { observations: [observation(777, asOf)] })) } });
const setReference = ref => { state.manifest.markets.US.assets.market_indicator_history = ref; };
const openHistory = () => fireEvent.click(screen.getByText('市場指標の履歴と未取得項目', { exact: true }));
const historyRegion = () => screen.getByRole('region', { name: '市場指標の履歴', exact: true });
const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><ThemeProvider theme={createTheme()}><MemoryRouter><StaticBreadthPage /></MemoryRouter></ThemeProvider></QueryClientProvider>;
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()) };
};

describe('StaticBreadthPage saved market history', () => {
  beforeEach(() => {
    state.manifest = { as_of_date: date, generated_at: '2026-10-10T01:00:00Z', supported_markets: ['US'],
      markets: { US: { as_of_date: date, pages: { breadth: { path: 'breadth.json' } }, assets: {} } } };
    state.publication = { mode: 'legacy', cacheIdentity: 'synthetic-publication-A' };
    state.fetch.mockReset().mockImplementation(async path => path === 'breadth.json' ? breadth() : saved());
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('preserves legacy inline history and never requests an asset when no reference exists', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '市場環境', exact: true });
    openHistory();
    expect(within(historyRegion()).getByText('777', { exact: true })).toBeInTheDocument();
    expect(state.fetch.mock.calls.map(([path]) => path)).toEqual(['breadth.json']);
  });
  it('reads the exact reference with its hash and pinned publication, keeping inline values separate', async () => {
    setReference(reference());
    renderPage();
    await screen.findByRole('heading', { name: '市場環境', exact: true });
    openHistory();
    expect(await within(historyRegion()).findByText('4,321', { exact: true })).toBeInTheDocument();
    expect(within(historyRegion()).queryByText('777', { exact: true })).not.toBeInTheDocument();
    expect(state.fetch).toHaveBeenCalledWith(reference().path, { sha256: hash, publication: state.publication, signal: expect.any(AbortSignal) });
    expect(within(historyRegion()).getByText(/元記録・UTC.*123456Z/)).toHaveTextContent('2026-08-31');
  });
  it.each([
    ['null', null], ['wrong path', { ...reference(), path: 'research.json' }],
    ['wrong hash', { ...reference(), sha256: 'b'.repeat(64) }],
    ['wrong schema', { ...reference(), schema_version: 'old' }],
    ['wrong market', { ...reference(), market: 'HK' }],
    ['wrong date', { ...reference(), as_of_date: '2026-10-08' }],
  ])('does not fetch or fall back from a %s reference', async (_name, ref) => {
    setReference(ref);
    renderPage();
    await screen.findByRole('heading', { name: '市場環境', exact: true });
    openHistory();
    expect(within(historyRegion()).queryByRole('table')).not.toBeInTheDocument();
    expect(within(historyRegion()).getAllByText(/比較可能な履歴は未取得です/)).toHaveLength(9);
    expect(screen.getByText(/保存履歴.*比較可能な履歴は未取得として表示/)).toBeInTheDocument();
    expect(state.fetch.mock.calls.map(([path]) => path)).toEqual(['breadth.json']);
  });
  it('shows unavailable while loading and after transport failure without displaying inline fallback', async () => {
    let reject;
    const pending = new Promise((_resolve, fail) => { reject = fail; });
    setReference(reference());
    state.fetch.mockImplementation(path => path === 'breadth.json' ? Promise.resolve(breadth()) : pending);
    renderPage();
    await screen.findByRole('heading', { name: '市場環境', exact: true });
    openHistory();
    expect(screen.getByText(/保存履歴を読み込み中/)).toBeInTheDocument();
    expect(within(historyRegion()).queryByRole('table')).not.toBeInTheDocument();
    await act(async () => reject(new Error('SHA-256 mismatch')));
    expect(await screen.findByText(/保存履歴の読み込みまたは整合性確認に失敗/)).toBeInTheDocument();
    expect(within(historyRegion()).queryByText('777', { exact: true })).not.toBeInTheDocument();
    expect(within(historyRegion()).queryByRole('table')).not.toBeInTheDocument();
  });
  it.each([
    ['snapshot date', () => ({ ...saved(), as_of_date: '2026-10-08' })],
    ['snapshot market', () => ({ ...saved(), market: 'HK' })],
    ['snapshot schema', () => ({ ...saved(), schema_version: 'old' })],
  ])('rejects a wrong %s after fetching the pinned asset', async (_name, value) => {
    setReference(reference());
    state.fetch.mockImplementation(async path => path === 'breadth.json' ? breadth() : value());
    renderPage();
    await screen.findByRole('heading', { name: '市場環境', exact: true });
    openHistory();
    expect(await screen.findByText(/保存履歴の読み込みまたは整合性確認に失敗/)).toBeInTheDocument();
    expect(within(historyRegion()).queryByRole('table')).not.toBeInTheDocument();
  });
  it('keeps an asset unavailable when the breadth date differs from the manifest date', async () => {
    setReference(reference());
    state.fetch.mockImplementation(async path => path === 'breadth.json' ? breadth('2026-10-08') : saved());
    renderPage();
    await screen.findByRole('heading', { name: '市場環境', exact: true });
    openHistory();
    expect(screen.getByText(/保存履歴と騰落データの分析基準日が一致しません/)).toBeInTheDocument();
    expect(within(historyRegion()).queryByRole('table')).not.toBeInTheDocument();
  });
  it('retries a failed immutable asset when the user rechecks the same manifest and reference', async () => {
    setReference(reference());
    state.fetch.mockImplementation(async path => path === 'breadth.json' ? breadth() : Promise.reject(new Error('temporary transport failure')));
    renderPage();
    await screen.findByRole('heading', { name: '市場環境', exact: true });
    openHistory();
    expect(await screen.findByText(/保存履歴の読み込みまたは整合性確認に失敗/)).toBeInTheDocument();
    state.fetch.mockImplementation(async path => path === 'breadth.json' ? breadth() : saved());
    fireEvent.click(screen.getByRole('button', { name: 'データを再確認 ↻' }));
    expect(await within(historyRegion()).findByText('4,321', { exact: true })).toBeInTheDocument();
    expect(state.fetch.mock.calls.filter(([path]) => path === reference().path)).toHaveLength(2);
    expect(within(historyRegion()).queryByText('777', { exact: true })).not.toBeInTheDocument();
  });
  it('does not manually fetch an invalid reference through the recheck button', async () => {
    setReference({ ...reference(), path: 'research.json' });
    renderPage();
    await screen.findByRole('heading', { name: '市場環境', exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'データを再確認 ↻' }));
    await waitFor(() => expect(state.fetch.mock.calls.filter(([path]) => path === 'breadth.json')).toHaveLength(2));
    expect(state.fetch.mock.calls.every(([path]) => path === 'breadth.json')).toBe(true);
  });
  it('drops old snapshot rows immediately when the reference or publication changes', async () => {
    setReference(reference());
    const view = renderPage();
    await screen.findByRole('heading', { name: '市場環境', exact: true });
    openHistory();
    expect(await within(historyRegion()).findByText('4,321', { exact: true })).toBeInTheDocument();
    const newHash = 'b'.repeat(64);
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    state.fetch.mockImplementation(path => path === 'breadth.json' ? Promise.resolve(breadth()) : pending);
    setReference(reference(newHash));
    view.refresh();
    expect(within(historyRegion()).queryByText('4,321', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/保存履歴を読み込み中/)).toBeInTheDocument();
    await act(async () => resolve(saved(5432)));
    expect(await within(historyRegion()).findByText('5,432', { exact: true })).toBeInTheDocument();
    state.publication = { mode: 'legacy', cacheIdentity: 'synthetic-publication-B' };
    state.manifest = structuredClone(state.manifest);
    state.fetch.mockImplementation(async path => path === 'breadth.json' ? breadth() : Promise.reject(new Error('changed publication')));
    view.refresh();
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith(reference(newHash).path, expect.objectContaining({ sha256: newHash, publication: state.publication })));
    expect(await screen.findByText(/保存履歴の読み込みまたは整合性確認に失敗/)).toBeInTheDocument();
    // Reopening may be needed because the breadth query also changes identity.
    const disclosure = screen.getByText('市場指標の履歴と未取得項目').closest('details');
    if (!disclosure.open) openHistory();
    expect(within(historyRegion()).queryByText('5,432', { exact: true })).not.toBeInTheDocument();
    expect(within(historyRegion()).queryByText('777', { exact: true })).not.toBeInTheDocument();
  });
});
