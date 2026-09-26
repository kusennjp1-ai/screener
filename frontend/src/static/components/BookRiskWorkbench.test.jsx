import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import BookRiskWorkbench from './BookRiskWorkbench';
afterEach(cleanup);
it('keeps unprovided history unknown and rejects malformed returns', () => {
  render(<BookRiskWorkbench />);
  const history = screen.getByLabelText('決済済み取引の損益率（古い順・%）');
  expect(history).toHaveValue('');
  expect(screen.getByText(/目安上限：未確認/)).toBeInTheDocument();
  fireEvent.change(history, { target: { value: '8, ???' } });
  expect(screen.getByRole('alert')).toHaveTextContent('数値');
});
it('retains peak-based protection after a pullback and clears all declared evidence', () => {
  render(<BookRiskWorkbench />);
  fireEvent.change(screen.getByLabelText('決済済み取引の損益率（古い順・%）'), { target: { value: '10, -3, 10' } });
  expect(screen.getByText(/実績の平均利益／平均損失：3.33倍 ／ 2倍目安：充足/)).toBeInTheDocument();
  for (const [label, value] of [['買値 $','100'],['現在値 $','105'],['購入後の最高値 $','125'],['初期逆指値 $','95'],['現在の逆指値 $','95'],['保有株数','10']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  expect(screen.getByText(/平均利益の2倍に到達/)).toBeInTheDocument();
  expect(screen.getByText(/少なくとも\$100.00/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '計算欄をクリア' }));
  expect(screen.getByLabelText('買値 $')).toHaveValue('');
  expect(screen.queryByText(/少なくとも\$100.00/)).not.toBeInTheDocument();
});
