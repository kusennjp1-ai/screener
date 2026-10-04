import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';
import * as financialPresentation from '../financialEvidencePresentation';

vi.mock('./CandidateCharts', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const ranked = Array.from({ length: 103 }, (_, index) => ({ row: { symbol: `S${index}`, current_price: 102, se_pivot_price: 100, rs_rating: index }, assessment: { qualified: true, passed: 9, total: 9 } }));
const symbols = container => [...container.querySelectorAll('[data-feed-symbol]')].map(element => element.dataset.feedSymbol);

it('changes feed/table presentation without re-evaluating, reordering, resetting the page, or selecting a symbol', () => {
 const build = vi.spyOn(financialPresentation, 'buildFinancialEvidencePresentation');
 const onSelect = vi.fn();
 const props = { ranked, method: 'minervini', onSelect, selectedSymbol: 'S77' };
 const { container, rerender } = render(<CandidateBoard {...props}/>);
 expect(build).toHaveBeenCalledTimes(20);
 fireEvent.change(screen.getByRole('combobox', { name: '候補の並び順' }), { target: { value: 'rs' } });
 fireEvent.click(screen.getByRole('button', { name: '次の20件' }));
 const expected = ranked.slice().reverse().slice(20, 40).map(item => item.row.symbol);
 const evaluations = build.mock.calls.length;
 expect(symbols(container)).toEqual(expected);
 rerender(<CandidateBoard {...props} view="table"/>);
 expect(screen.getByRole('table')).toBeInTheDocument();
 expect(symbols(container)).toEqual(expected);
 expect(build).toHaveBeenCalledTimes(evaluations);
 expect(screen.getByRole('status')).toHaveTextContent('全103銘柄中21–40');
 expect(container.querySelector('[data-feed-symbol="S77"] .candidate-row')).toHaveAttribute('aria-current', 'true');
 rerender(<CandidateBoard {...props} view="list"/>);
 expect(symbols(container)).toEqual(expected);
 expect(build).toHaveBeenCalledTimes(evaluations);
 expect(onSelect).not.toHaveBeenCalled();
});

it('keeps shared 20/50 selection and keyboard page-boundary behavior in the table', () => {
 let nextFrame;
 vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { nextFrame = callback; return 1; }));
 const onSelect = vi.fn();
 const props = { ranked, method: 'minervini', view: 'table', selectedSymbol: 'S77', onSelect };
 const { container, rerender } = render(<CandidateBoard {...props}/>);
 fireEvent.change(screen.getByRole('combobox', { name: '1ページの銘柄数' }), { target: { value: '50' } });
 expect(screen.getByRole('status')).toHaveTextContent('全103銘柄中51–100');
 expect(container.querySelector('[data-feed-symbol="S77"] .candidate-row')).toHaveFocus();
 const last = container.querySelector('[data-feed-symbol="S99"] .candidate-row');
 last.focus();
 fireEvent.keyDown(last, { key: 'ArrowDown' });
 expect(onSelect).toHaveBeenLastCalledWith('S100');
 nextFrame();
 expect(container.querySelector('[data-feed-symbol="S100"] .candidate-row')).toHaveFocus();
 expect(symbols(container)).toEqual(['S100', 'S101', 'S102']);
 rerender(<CandidateBoard {...props} view="list"/>);
 expect(symbols(container)).toEqual(['S100', 'S101', 'S102']);
 expect(screen.getByRole('combobox', { name: '1ページの銘柄数' })).toHaveValue('50');
 expect(screen.getByRole('status')).toHaveTextContent('全103銘柄中101–103');
});
