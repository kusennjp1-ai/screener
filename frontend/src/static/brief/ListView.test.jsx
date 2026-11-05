// The candidate list's segment (ListView, E) against the filters briefCandidate (D) defines.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ListView, { listShown, watchOrder } from './ListView';
import { candidateView, LIST_FILTERS } from './briefCandidate';

afterEach(cleanup);

const DATE = '2026-10-02';
// A row's state and pivot distance come from its price against its pivot (100).
const item = (symbol, price, qualified = true) => ({ row: { symbol, current_price: price, se_pivot_price: 100 }, assessment: { qualified, passed: qualified ? 8 : 7, failed: qualified ? 0 : 1, unknown: 0, total: 8 } });
const ranked = [item('ZON1', 101), item('NEA1', 97), item('FAR1', 90), item('ONE1', 99, false)];
const brief = { bundle: { data: { date: DATE, rankings: { minervini: ranked } }, isLoading: false, isError: false }, manifest: { isLoading: false, isError: false }, ranked, date: DATE, market: null, version: 'v1' };

const list = (filter = 'zone', { kind = 'list', watch = [], setListState = () => {}, onUnwatch = () => {} } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <ListView brief={brief} kind={kind} watch={watch} open={() => {}} now={0} animate={false} listState={{ filter, sort: 'priority', query: '' }} setListState={setListState}
      limits={{}} setLimits={() => {}} origin={null} wide onUnwatch={onUnwatch} />
  </QueryClientProvider>);
};

describe('candidate list segment', () => {
  it('shows a button for every filter but the hidden ones, so 注目候補 is never a segment button', () => {
    const { getByRole } = list();
    const labels = within(getByRole('group', { name: '絞り込み' })).getAllByRole('button').map(button => button.firstChild.textContent);
    expect(labels).toEqual(Object.values(LIST_FILTERS).filter(value => !value.hidden).map(value => value.label));
    expect(labels).toEqual(['買いゾーン', 'ピボット接近', '選定すべて', 'あと1条件']);
    expect(labels).not.toContain(LIST_FILTERS.focus.label);
  });

  it('counts each shown filter over the same rows', () => {
    const { getByRole } = list();
    const counts = within(getByRole('group', { name: '絞り込み' })).getAllByRole('button').map(button => button.lastChild.textContent);
    expect(counts).toEqual(['1', '1', '3', '1']);
  });
});

describe('the hidden focus filter (Today\'s 注目候補 tile)', () => {
  it('lists the zone and near rows, presses no segment button, and is said as a chip that clears it', () => {
    let state = { filter: 'focus' };
    const { getByRole, getAllByTestId } = list('focus', { setListState: update => { state = update(state); } });
    expect(getAllByTestId('brief-candidate').map(row => row.dataset.symbol)).toEqual(['ZON1', 'NEA1']);
    for (const button of within(getByRole('group', { name: '絞り込み' })).getAllByRole('button')) expect(button).toHaveAttribute('aria-pressed', 'false');
    const chip = getByRole('button', { name: '注目候補（ゾーン＋接近）2（絞り込みを解除）' });
    chip.click();
    expect(state.filter).toBe('zone');
    cleanup();
    expect(list('zone').queryByRole('button', { name: /注目候補（ゾーン＋接近）/ })).toBeNull();
  });
});

describe('the watch list', () => {
  it('leads with a symbol the publication does not list, its reason and a 外す, and keeps the listed rows', () => {
    const removed = [];
    const { container, getAllByTestId, getByRole } = list('zone', { kind: 'watch', watch: ['NEA1', 'QQQX', 'ZON1'], onUnwatch: symbol => removed.push(symbol) });
    const items = [...container.querySelectorAll('.brief-rows > li')];
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('QQQX：この公開（10/2引け）の分析対象外（上場廃止・ティッカー変更・データ欠落など）。売りのサイン・位置は未確認');
    expect(getAllByTestId('brief-candidate').map(row => row.dataset.symbol)).toEqual(['ZON1', 'NEA1']);
    getByRole('button', { name: '外す（QQQX をウォッチから外す）' }).click();
    expect(removed).toEqual(['QQQX']);
  });

  it('puts the broken setups first, only once every check is in', () => {
    const views = ['A', 'B', 'C'].map(symbol => ({ symbol }));
    const quiet = { weaknessHits: 0, breakdownHits: 0 }, weak = { weaknessHits: 1, breakdownHits: 1 };
    expect(watchOrder(views, { A: quiet, B: quiet, C: weak }).map(v => v.symbol)).toEqual(['C', 'A', 'B']);
    expect(watchOrder(views, { A: quiet, B: weak }).map(v => v.symbol)).toEqual(['A', 'B', 'C']);
    expect(watchOrder(views, { A: { unknown: true }, B: weak, C: { hits: 2, strengthHits: 2, weaknessHits: 0 } }).map(v => v.symbol)).toEqual(['B', 'A', 'C']);
    // The advance's largest down day alone is a holder's signal: it does not move a row.
    expect(watchOrder(views, { A: quiet, B: quiet, C: { hits: 1, weaknessHits: 1, breakdownHits: 0 } }).map(v => v.symbol)).toEqual(['A', 'B', 'C']);
    expect(watchOrder([], {})).toEqual([]);
  });

  it('lists every watched stock whatever the 候補 tab\'s filter, search and sort, in Today\'s order', () => {
    const views = ranked.map(entry => candidateView(entry, DATE));
    const plain = listShown(views, 'watch', { filter: 'zone', sort: 'priority', query: '' }).map(v => v.symbol);
    expect(plain).toHaveLength(ranked.length);
    for (const state of [{ filter: 'one', sort: 'rs', query: 'ZON1' }, { filter: 'near', sort: 'volume', query: 'nothing matches' }])
      expect(listShown(views, 'watch', state).map(v => v.symbol)).toEqual(plain);
    // The 候補 tab keeps its search.
    expect(listShown(views, 'list', { filter: 'all', sort: 'priority', query: 'ZON1' }).map(v => v.symbol)).toEqual(['ZON1']);
  });

  it('renders every watched row while the 候補 tab has a search', () => {
    const { getAllByTestId } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ListView brief={brief} kind="watch" watch={['NEA1', 'ZON1', 'FAR1']} open={() => {}} now={0} animate={false} listState={{ filter: 'zone', sort: 'priority', query: 'ZON1' }} setListState={() => {}}
        limits={{}} setLimits={() => {}} origin={null} wide onUnwatch={() => {}} />
    </QueryClientProvider>);
    expect(getAllByTestId('brief-candidate')).toHaveLength(3);
  });
});
