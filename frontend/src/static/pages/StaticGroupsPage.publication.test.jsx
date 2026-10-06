import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import StaticGroupsPage from './StaticGroupsPage';

const source = vi.hoisted(() => ({ manifest: null, read: vi.fn() }));
vi.mock('../staticPublication', async importOriginal => ({ ...await importOriginal(),
  loadStaticManifest: async () => source.manifest,
  publicationForManifest: manifest => manifest?._publication,
  resolveStaticPublication: async ({ publication }) => publication,
  readStaticPayload: (...args) => source.read(...args),
}));
vi.mock('../StaticGroupDetailModal', () => ({ default: ({ chartIndex }) => <div data-testid="group-chart-index">{chartIndex?.label || 'pending charts'}</div> }));
vi.mock('../../components/Charts/RRGChart', () => ({ default: ({ data }) => <div data-testid="group-rrg">{data?.label || 'pending RRG'}</div> }));
vi.mock('../../components/Charts/useRRGScopeSelection', () => ({ useRRGScopeSelection: () => ({ availableScopes: ['groups'] }) }));

const publication = (revision, mode) => ({ mode, generation: 'same-research-generation', cacheIdentity: revision, ...(mode === 'packed' && { expectedRoot: { sha256: revision } }) });
const manifest = (revision, mode) => ({ generated_at: 'same-export-time', research_generation: 'same-research-generation', _publication: publication(revision, mode),
  pages: { groups: { path: 'groups.json' } }, assets: { groups_rrg: { path: 'groups_rrg.json' }, charts: { path: 'charts/index.json' } } });
const revisionOf = context => context.expectedRoot?.sha256 || context.cacheIdentity;
const payload = (path, revision) => path === 'groups.json' ? { available: true, payload: { rankings: { date: '2026-10-01', rankings: [{ industry_group: `${revision} group`, rank: 1, avg_rs_rating: 90, num_stocks: 2 }] } } }
  : path === 'groups_rrg.json' ? { available: true, available_scopes: ['groups'], payload: { groups: { label: `${revision} RRG` } } }
    : { label: `${revision} charts`, symbols: [] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let client;
beforeEach(() => {
  source.read.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, placeholderData: previous => previous } } });
});
afterEach(() => { cleanup(); client.clear(); });
const mount = () => render(<QueryClientProvider client={client}><MemoryRouter><StaticGroupsPage /></MemoryRouter></QueryClientProvider>);
const refresh = async next => { source.manifest = next; await act(async () => client.invalidateQueries({ queryKey: ['staticManifest'], exact: true })); };

it.each(['packed', 'legacy'])('refetches stable group/RRG/chart aliases together for a new %s publication', async mode => {
  source.manifest = manifest('old', mode);
  const newGroups = deferred(), newRrg = deferred();
  source.read.mockImplementation((path, { publication: context }) => {
    const revision = revisionOf(context);
    if (revision === 'new' && path === 'groups.json') return newGroups.promise;
    if (revision === 'new' && path === 'groups_rrg.json') return newRrg.promise;
    return Promise.resolve(payload(path, revision));
  });
  mount();
  expect(await screen.findByText('old group')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('group-chart-index')).toHaveTextContent('old charts'));
  await refresh(manifest('new', mode));
  await waitFor(() => expect(source.read).toHaveBeenCalledWith('charts/index.json', expect.objectContaining({ publication: expect.objectContaining({ cacheIdentity: 'new' }) })));
  expect(screen.queryByText('old group')).not.toBeInTheDocument();
  await act(async () => newGroups.resolve(payload('groups.json', 'new')));
  expect(await screen.findByText('new group')).toBeInTheDocument();
  expect(screen.getByTestId('group-chart-index')).toHaveTextContent('new charts');
  fireEvent.click(screen.getByRole('button', { name: 'RRG' }));
  expect(screen.getByTestId('group-rrg')).toHaveTextContent('pending RRG');
  expect(screen.queryByText('old RRG')).not.toBeInTheDocument();
  await act(async () => newRrg.resolve(payload('groups_rrg.json', 'new')));
  expect(await screen.findByText('new RRG')).toBeInTheDocument();
});

it('keeps a late same-path A response under A after a successful manifest replacement by B', async () => {
  source.manifest = manifest('A', 'packed');
  const pendingGroups = deferred(), pendingRrg = deferred();
  source.read.mockImplementation((path, { publication: context }) => {
    const revision = revisionOf(context);
    if (revision === 'A' && path === 'groups.json') return pendingGroups.promise;
    if (revision === 'A' && path === 'groups_rrg.json') return pendingRrg.promise;
    return Promise.resolve(payload(path, revision));
  });
  mount();
  await waitFor(() => expect(source.read).toHaveBeenCalledWith('groups.json', expect.objectContaining({ publication: expect.objectContaining({ cacheIdentity: 'A' }) })));
  await refresh(manifest('B', 'packed'));
  expect(await screen.findByText('B group')).toBeInTheDocument();
  expect(screen.getByTestId('group-chart-index')).toHaveTextContent('B charts');
  await act(async () => { pendingGroups.resolve(payload('groups.json', 'A')); pendingRrg.resolve(payload('groups_rrg.json', 'A')); });
  expect(screen.queryByText('A group')).not.toBeInTheDocument();
  expect(screen.getByText('B group')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'RRG' }));
  expect(screen.getByTestId('group-rrg')).toHaveTextContent('B RRG');
  expect(screen.getByTestId('group-chart-index')).toHaveTextContent('B charts');
});
