import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResearchPage from './ResearchPage';
import { prepareResearchBundle } from '../researchPreprocess';
import { withAuditFixture } from '../testAuditFixture';
import { syntheticBookFinancials } from '../../test/fixtures/bookFinancials';

const date = '2026-02-01', now = Date.parse('2026-02-02T12:00:00Z');
const data = vi.hoisted(() => ({ bundle: null, generation: 'old', fetch: vi.fn() }));
vi.mock('../useResearchBundle', () => ({ useResearchBundle: () => ({ data: data.bundle, isLoading: false }) }));
vi.mock('../dataClient', () => ({
  useStaticManifest: () => ({ data: { research_generation: data.generation, generated_at: '2026-02-02T12:00:00Z' } }),
  resolveStaticMarketEntry: () => ({ as_of_date: '2026-02-01', assets: { research: { path: 'fixture.json' } } }),
  fetchStaticJson: (...args) => data.fetch(...args),
}));
vi.mock('../chartClient', () => ({ useStaticChartIndex: () => ({ data: null }) }));
vi.mock('../components/ResearchHero', () => ({ default: () => null }));
vi.mock('../components/CandidateBoard', () => ({ default: ({ ranked, onSelect }) => <div>{ranked.map(({row}) => <button key={row.symbol} onClick={() => onSelect(row.symbol)}>Select {row.symbol}</button>)}</div> }));
vi.mock('../components/ResearchDetail', async () => {
  const { forwardRef } = await import('react');
  const { default: FinancialEvidenceSummary } = await import('../components/FinancialEvidenceSummary');
  return { default: forwardRef(function Detail({ selected, onVerificationToggle, financialEvidence, method, date, version, now }, ref) {
    return <section ref={ref} aria-label="Selected detail">{selected && <>
      <h2>{selected.symbol}</h2>
      <button onClick={() => onVerificationToggle(selected.symbol)}>Load financial detail</button>
      <FinancialEvidenceSummary evidence={financialEvidence} bookFinancials={selected.book_financials} symbol={selected.symbol} method={method} date={date} generation={version} now={now} onNavigate={() => {}}/>
    </>}</section>;
  }) };
});

let client;
const path = (symbol, generation) => `research-details/${symbol}-${generation}.json`;
const response = (symbol, source) => ({ symbol, market: 'US', as_of_date: date, book_financials: { ...syntheticBookFinancials(), symbol, source } });
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function publish(generation) {
  data.generation = generation;
  const rows = ['A', 'B'].map(symbol => withAuditFixture({ symbol, market: 'US', currency: 'USD', current_price: 100, adv_usd: 25000000, rs_rating: 95, research_detail_path: path(symbol, generation) }, date));
  data.bundle = prepareResearchBundle([{ rows, as_of_date: date }], date, { now, generation });
}
const tree = () => <QueryClientProvider client={client}><HashRouter><ResearchPage/></HashRouter></QueryClientProvider>;
const continuity = () => screen.getByRole('button', { name: /^業績の連続性/ });
const load = () => fireEvent.click(screen.getByRole('button', { name: 'Load financial detail' }));
const select = symbol => fireEvent.click(screen.getByRole('button', { name: `Select ${symbol}` }));
beforeEach(() => {
  window.history.replaceState(null, '', '#/');
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  data.fetch.mockReset();
  // Match App.jsx: previous query data is the default unless explicitly disabled.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, placeholderData: previous => previous } } });
  publish('old');
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('withholds same-symbol/same-date financial detail during a publication replacement', async () => {
  const newer = pending();
  data.fetch.mockImplementation(request => request === path('A', 'old') ? Promise.resolve(response('A', 'old source')) : newer.promise);
  const view = render(tree());
  load();
  await waitFor(() => expect(continuity()).toHaveAttribute('data-state', 'reference'));
  expect(continuity()).toHaveAttribute('title', expect.stringContaining('old source'));

  publish('new');view.rerender(tree());
  await waitFor(() => expect(data.fetch).toHaveBeenCalledWith(path('A', 'new')));
  expect(continuity()).toHaveAttribute('data-state', 'unknown');
  expect(continuity()).not.toHaveAttribute('title', expect.stringContaining('old source'));
  await act(async () => newer.resolve(response('A', 'new source')));
  await waitFor(() => expect(continuity()).toHaveAttribute('title', expect.stringContaining('new source')));
  expect(continuity()).toHaveAttribute('data-state', 'reference');
});

it('ignores delayed A and B responses after A → B → A moves to a new generation', async () => {
  const oldA = pending(), oldB = pending(), newA = pending();
  data.fetch.mockImplementation(request => ({ [path('A', 'old')]: oldA.promise, [path('B', 'old')]: oldB.promise, [path('A', 'new')]: newA.promise })[request]);
  const view = render(tree());
  load();await waitFor(() => expect(data.fetch).toHaveBeenCalledWith(path('A', 'old')));
  select('B');load();await waitFor(() => expect(data.fetch).toHaveBeenCalledWith(path('B', 'old')));
  publish('new');select('A');load();view.rerender(tree());
  await waitFor(() => expect(data.fetch).toHaveBeenCalledWith(path('A', 'new')));
  await act(async () => { oldA.resolve(response('A', 'late old A')); oldB.resolve(response('B', 'late old B')); });
  expect(screen.getByRole('heading', { name: 'A' })).toBeInTheDocument();
  expect(continuity()).toHaveAttribute('data-state', 'unknown');
  await act(async () => newA.resolve(response('A', 'current A')));
  await waitFor(() => expect(continuity()).toHaveAttribute('title', expect.stringContaining('current A')));
  expect(continuity()).toHaveAttribute('data-state', 'reference');
});

it('rejects a cached detail whose returned generation differs from its lookup key', () => {
  publish('new');
  client.setQueryData(['researchDetail', 'A', path('A', 'new'), date, 'new'], {
    value: response('A', 'mismatched source'), symbol: 'A', date, generation: 'old', path: path('A', 'old'),
  });
  render(tree());load();
  expect(continuity()).toHaveAttribute('data-state', 'unknown');
  expect(continuity()).not.toHaveAttribute('title', expect.stringContaining('mismatched source'));
});
