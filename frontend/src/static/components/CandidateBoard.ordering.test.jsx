import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';
import { orderCandidates } from '../candidateOrdering';
import { researchCsv } from '../researchEngine';
import { withAuditFixture } from '../testAuditFixture';

vi.mock('./CandidateCharts', () => ({ default: () => null }));
vi.mock('./CandidateFeedCard', () => ({ default: ({ item }) => <button className="candidate-row">{item.row.symbol}</button> }));
vi.mock('./ResearchCandidateTable', () => ({ default: ({ items }) => <table><tbody>{items.map(item => <tr key={item.row.symbol} data-feed-symbol={item.row.symbol}><td><button className="candidate-row">{item.row.symbol}</button></td></tr>)}</tbody></table> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const date = '2026-09-29', now = Date.parse('2026-09-29T20:00:00Z');
const ranked = Array.from({ length: 61 }, (_, index) => {
  const row = withAuditFixture({ symbol: `S${index}`, current_price: 96 + index % 10, se_pivot_price: 100, rs_rating: index }, date);
  row.technical_audit.values.volumeRatio = index % 7;
  return { row, assessment: { qualified: true, passed: 9, total: 9, rules: [] } };
});
const symbols = container => [...container.querySelectorAll('[data-feed-symbol]')].map(element => element.dataset.feedSymbol);

it.each(['rank', 'distance', 'rs', 'volume', 'state'])('shares the entire %s order across feed, table and CSV beyond the visible page', sort => {
  const onSortChange = vi.fn();
  let exported;
  function ExportHarness({ view }) {
    const [candidateSort, setCandidateSort] = useState('rank');
    const changeSort = key => { setCandidateSort(key); onSortChange(key); };
    return <><CandidateBoard ranked={ranked} method="minervini" date={date} now={now} onSortChange={changeSort} view={view}/>
      <button onClick={() => { exported = researchCsv(orderCandidates(ranked, { sort: candidateSort, method: 'minervini', date }), 'minervini', date, now); }}>Export all candidates</button></>;
  }
  const { container, rerender } = render(<ExportHarness view="list"/>);
  expect(onSortChange).not.toHaveBeenCalled();
  if (sort !== 'rank') {
    fireEvent.change(screen.getByRole('combobox', { name: '候補の並び順' }), { target: { value: sort } });
    expect(onSortChange).toHaveBeenCalledExactlyOnceWith(sort);
  }
  fireEvent.click(screen.getByRole('button', { name: '次の20件' }));
  const expected = orderCandidates(ranked, { sort, method: 'minervini', date }).map(item => item.row.symbol);
  expect(symbols(container)).toEqual(expected.slice(20, 40));
  rerender(<ExportHarness view="table"/>);
  expect(symbols(container)).toEqual(expected.slice(20, 40));
  fireEvent.click(screen.getByRole('button', { name: 'Export all candidates' }));
  const csvSymbols = exported.split('\r\n').slice(1).map(line => line.split(',')[1].slice(1, -1));
  expect(csvSymbols).toEqual(expected);
  expect(csvSymbols).toHaveLength(61);
  rerender(<ExportHarness view="list"/>);
  expect(symbols(container)).toEqual(csvSymbols.slice(20, 40));
  expect(onSortChange).toHaveBeenCalledTimes(sort === 'rank' ? 0 : 1);
});

it.each([20, 50])('notifies the current callback and resets to the first page while keeping size %s', feedSize => {
  const onSortChange = vi.fn(), replacement = vi.fn();
  const props = { ranked, method: 'minervini', date, now, feedSize };
  const { rerender, container } = render(<CandidateBoard {...props} onSortChange={onSortChange}/>);
  fireEvent.click(screen.getByRole('button', { name: `次の${feedSize}件` }));
  rerender(<CandidateBoard {...props} onSortChange={replacement}/>);
  fireEvent.change(screen.getByRole('combobox', { name: '候補の並び順' }), { target: { value: 'rs' } });
  expect(onSortChange).not.toHaveBeenCalled();
  expect(replacement).toHaveBeenCalledExactlyOnceWith('rs');
  expect(screen.getByRole('combobox', { name: '候補のページ' })).toHaveValue('0');
  expect(screen.getByRole('combobox', { name: '1ページの銘柄数' })).toHaveValue(String(feedSize));
  expect(symbols(container)).toEqual(ranked.slice().reverse().slice(0, feedSize).map(item => item.row.symbol));
  fireEvent.change(screen.getByRole('combobox', { name: '候補の並び順' }), { target: { value: 'rank' } });
  expect(replacement).toHaveBeenLastCalledWith('rank');
  expect(symbols(container)).toEqual(ranked.slice(0, feedSize).map(item => item.row.symbol));
});
