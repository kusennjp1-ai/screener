import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import PartialSalePlan from './PartialSalePlan';
afterEach(cleanup);
it('calculates a prospective partial sale without changing the journal holding', () => {
  const state = { holdings: [{ symbol: 'TEST', shares: 100, costBasis: 10010, stop: 95 }] };
  render(<PartialSalePlan state={state} />);
  fireEvent.click(screen.getByText('部分売却前に残株の保護を試算'));
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name: 'TEST（100株）' }));
  for (const [name,value] of [['試算する売却株数','40'],['想定売却価格 $','120'],['売却時手数料 $','4'],['残株の逆指値案 $','105'],['残株売却時の手数料 $','6']]) fireEvent.change(screen.getByLabelText(name), { target: { value } });
  expect(screen.getByText(/合計損益 \$1,080.00/)).toBeVisible();
  expect(state.holdings[0].shares).toBe(100);
  fireEvent.change(screen.getByLabelText('残株の逆指値案 $'), { target: { value: '90' } });
  expect(screen.queryByText(/合計損益/)).not.toBeInTheDocument();
  expect(screen.getByText(/記録済み逆指値以上/)).toBeVisible();
});
