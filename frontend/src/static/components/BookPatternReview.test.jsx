import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BookPatternReview from './BookPatternReview';
const fetchPayload = vi.hoisted(() => vi.fn());
vi.mock('../chartClient', () => ({ fetchStaticChartPayload: fetchPayload }));
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });
const props = { row: { symbol: 'A', current_price: 100 }, entry: { path: 'a.json' }, date: '2026-09-23' };

it('locks all evidence inputs and saved-record deletion during asynchronous chart retrieval', async () => {
  let resolve;
  fetchPayload.mockReturnValue(new Promise(done => { resolve = done; }));
  localStorage.setItem(`book-pattern-review-v1:A:${props.date}`, JSON.stringify({ symbol: 'A', date: props.date, review: { pattern: 'three-c', source: 'Reviewed chart', tickSize: .01, reviewedAt: '2026-09-23T10:00:00Z' } }));
  render(<BookPatternReview {...props} />);
  fireEvent.click(screen.getByText('区間を指定してVCP・3C・低いチート・パワープレーを実測'));
  fireEvent.submit(screen.getByRole('button', { name: '指定区間を実測する' }).closest('form'));
  expect(screen.getByLabelText('確認するパターン')).toBeDisabled();
  expect(screen.getByLabelText('確認資料・チャートの出所')).toBeDisabled();
  expect(screen.getByLabelText('先行上昇の起点')).toBeDisabled();
  expect(screen.getByLabelText('初期／後期ステージ')).toBeDisabled();
  expect(screen.getByRole('button', { name: '記録を消去' })).toBeDisabled();
  await act(async () => { resolve({ symbol: 'A', as_of_date: props.date, bars: [] }); });
  expect(screen.getByLabelText('確認資料・チャートの出所')).not.toBeDisabled();
  expect(screen.getByRole('button', { name: '記録を消去' })).not.toBeDisabled();
});

it('starts with empty evidence, no network, and disables unprovided charts', () => {
  render(<BookPatternReview {...props} entry={null} />);
  expect(screen.getByLabelText('先行上昇の起点')).toHaveValue('');
  expect(screen.getByLabelText('確認資料・チャートの出所')).toHaveValue('');
  expect(screen.getByRole('button', { name: '指定区間を実測する', hidden: true })).toBeDisabled();
  expect(fetchPayload).not.toHaveBeenCalled();
});
it('persists source/date/intervals per symbol but requires remeasurement after remount', async () => {
  const bars = [];
  for (let t = Date.parse('2025-01-01'); bars.length < 280; t += 86400000) {
    const d = new Date(t); if ([0, 6].includes(d.getUTCDay())) continue;
    bars.push({ date: d.toISOString().slice(0, 10), open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  }
  const date = bars.at(-1).date;
  fetchPayload.mockResolvedValue({ symbol: 'A', as_of_date: date, bars });
  const view = render(<BookPatternReview {...props} date={date} />);
  fireEvent.click(screen.getByText('区間を指定してVCP・3C・低いチート・パワープレーを実測'));
  fireEvent.change(screen.getByLabelText('確認するパターン'), { target: { value: 'vcp' } });
  fireEvent.change(screen.getByLabelText('確認資料・チャートの出所'), { target: { value: 'Annotated chart September review' } });
  for (const [label, value] of [['T1 高値の日', bars[200].date], ['T1 安値までの終了日', bars[205].date], ['T2 高値の日', bars[210].date], ['T2 安値までの終了日', bars[215].date]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.submit(screen.getByRole('button', { name: '指定区間を実測する' }).closest('form'));
  expect(await screen.findByRole('table', { name: '指定VCP区間の実測' })).toBeInTheDocument();
  const stored = JSON.parse(localStorage.getItem(`book-pattern-review-v1:A:${date}`));
  expect(stored.review.source).toBe('Annotated chart September review');
  expect(stored.review.intervals[0].startDate).toBe(bars[200].date);
  expect(stored.review.reviewedAt).toMatch(/^\d{4}-/);
  view.unmount();
  render(<BookPatternReview {...props} date={date} />);
  expect(screen.getByLabelText('確認資料・チャートの出所')).toHaveValue(stored.review.source);
  expect(screen.queryByRole('table', { name: '指定VCP区間の実測', hidden: true })).toBeNull();
  expect(fetchPayload).toHaveBeenCalledTimes(1);
});
