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
  expect(screen.getByText(/有効な報告財務履歴は未取得/)).toBeInTheDocument();
  expect(history.annual).toEqual(row.financial_history.annual);
});

it('labels annual native amounts and quarterly USD amounts separately with the shared provider limitation', async () => {
  const { nativeAnnualFixture } = await import('../../test/fixtures/nativeAnnual.js');
  const history = nativeAnnualFixture('GBP');
  history.quarterly = [{ end: '2026-06-30', eps: 2, revenue: 500 }];
  history.quarterly_retrieved_at = history.retrieved_at;
  render(<FinancialHistory row={{ symbol: 'TEST', financial_history: history }} date="2026-10-02" now={Date.parse('2026-10-04T12:00:00Z')} expanded/>);
  expect(within(screen.getByRole('table', { name: '年次の希薄化EPS' })).getByRole('columnheader', { name: 'EPS（GBP / 提供元の株式単位）' })).toBeInTheDocument();
  expect(within(screen.getByRole('table', { name: /四半期の報告業績/ })).getByRole('columnheader', { name: 'EPS（USD）' })).toBeInTheDocument();
  expect(screen.getByText(/株式分割・ADR/)).toHaveTextContent('USD履歴も同じ基準');
});

it('renders known declines beside the still-missing EPS year without completing history', () => {
  const data={...row.financial_history,annual:[
    {end:'2022-12-31',eps:8},{end:'2023-12-31',eps:4},{end:'2024-12-31',eps:2},{end:'2025-12-31',eps:null},
  ]};
  render(<FinancialHistory row={{...row,financial_history:data}} date="2026-10-02" now={now} expanded/>);
  expect(screen.getByText(/年次EPS履歴：不完全/)).toBeInTheDocument();
  expect(screen.getByText('2022-12-31 → 2023-12-31: −50.00%')).toBeInTheDocument();
  expect(screen.getByText('2024-12-31 → 2025-12-31: EPS欠損・未確認')).toBeInTheDocument();
  expect(within(screen.getByRole('table',{name:'年次の希薄化EPS'})).getByRole('cell',{name:'未取得'})).toBeInTheDocument();
  expect(data.annual.at(-1).eps).toBeNull();
});
