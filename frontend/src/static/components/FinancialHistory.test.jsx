import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import FinancialHistory from './FinancialHistory';

afterEach(cleanup);
const now = Date.parse('2026-10-03T12:00:00Z');
const row = { symbol: 'TEST', financial_history: { symbol: 'TEST', as_of_date: '2026-10-02',
  retrieved_at: '2026-10-03T11:00:00Z', source: 'Test provider', basis: 'reported_diluted_eps', currency: 'USD', status: 'available',
  annual: [{ end: '2025-12-31', eps: 3.24 }], quarterly: [] } };

it('shows an explicit quarterly unavailable state instead of an empty table', () => {
  render(<FinancialHistory row={row} date="2026-10-02" now={now} expanded/>);
  expect(screen.getByText(/四半期の報告業績は未取得/)).toHaveTextContent('年次EPSから四半期EPSや売上前年比を補完しません');
  expect(screen.getAllByRole('table')).toHaveLength(1);
  const table = screen.getByRole('table', { name: '年次の希薄化EPS' });
  expect(table).toHaveClass('financial-history-table');
  expect(within(table).getByRole('rowheader', { name: '2025-12-31' })).toHaveAttribute('scope', 'row');
  expect(within(table).getByRole('cell', { name: '3.24' })).toBeInTheDocument();
  expect(table.closest('details')).toBeNull();
});

it('retains a disclosure where requested and readable zero/negative quarterly EPS', () => {
  render(<FinancialHistory row={{ ...row, financial_history: { ...row.financial_history, quarterly: [
    { end: '2026-03-31', eps: 0, revenue: 0 }, { end: '2026-06-30', eps: -1.5, revenue: 100 },
  ] } }} date="2026-10-02" now={now}/>);
  const table = screen.getByRole('table', { name: /四半期の報告業績/ });
  expect(table.closest('details')).not.toHaveAttribute('open');
  expect(within(table).getByRole('cell', { name: '-1.5' })).toBeInTheDocument();
  expect(within(table).getAllByRole('cell', { name: '0' })).toHaveLength(2);
});

it('uses the explicit evaluation time and hides expired history', () => {
  render(<FinancialHistory row={row} date="2026-10-02" now={now + 73 * 3600000} expanded/>);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByText(/72時間を超えています/)).toBeInTheDocument();
});

it.each([undefined, '', 'unknown', '未確認'])('withholds current history when its source is %s', source => {
  const history={...row.financial_history,source};
  render(<FinancialHistory row={{...row,financial_history:history}} date="2026-10-02" now={now}/>);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByText(/有効なUSD財務履歴は未取得/)).toBeInTheDocument();
  expect(history.annual).toEqual(row.financial_history.annual);
});
