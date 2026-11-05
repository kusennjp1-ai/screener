// The candidate list's segment (ListView, E) against the filters briefCandidate (D) defines.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ListView from './ListView';
import { LIST_FILTERS } from './briefCandidate';

afterEach(cleanup);

const DATE = '2026-10-02';
// A row's state and pivot distance come from its price against its pivot (100).
const item = (symbol, price, qualified = true) => ({ row: { symbol, current_price: price, se_pivot_price: 100 }, assessment: { qualified, passed: qualified ? 8 : 7, failed: qualified ? 0 : 1, unknown: 0, total: 8 } });
const ranked = [item('ZON1', 101), item('NEA1', 97), item('FAR1', 90), item('ONE1', 99, false)];
const brief = { bundle: { data: { date: DATE, rankings: { minervini: ranked } }, isLoading: false, isError: false }, manifest: { isLoading: false, isError: false }, ranked, date: DATE, market: null, version: 'v1' };

const list = (filter = 'zone') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <ListView brief={brief} kind="list" watch={[]} open={() => {}} now={0} animate={false} listState={{ filter, sort: 'priority', query: '' }} setListState={() => {}}
      limits={{}} setLimits={() => {}} origin={null} wide />
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
