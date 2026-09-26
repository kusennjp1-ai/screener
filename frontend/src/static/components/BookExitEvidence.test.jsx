import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BookExitEvidence from './BookExitEvidence';
import { fetchStaticChartPayload } from '../chartClient';
vi.mock('../chartClient', () => ({ fetchStaticChartPayload: vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);
it('starts with blank context and cannot fetch or certify until required evidence is supplied', () => {
  render(<BookExitEvidence row={{ symbol: 'AAA' }} entry={{ path: '/chart.json' }} date="2026-09-21" />);
  expect(screen.getByLabelText('出口検証のブレイク日')).toHaveValue('');
  expect(screen.getByLabelText('確認した局面')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'ブレイク後の実測を照合', hidden: true })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('出口検証の確認資料'), { target: { value: 'source' } });
  expect(screen.getByRole('button', { name: 'ブレイク後の実測を照合', hidden: true })).toBeDisabled();
});
it('resets context when switching symbols', () => {
  const view = render(<BookExitEvidence row={{ symbol: 'AAA' }} entry={{ path: '/chart.json' }} date="2026-09-21" />);
  fireEvent.change(screen.getByLabelText('出口検証の確認資料'), { target: { value: 'AAA source' } });
  view.rerender(<BookExitEvidence row={{ symbol: 'BBB' }} entry={{ path: '/b.json' }} date="2026-09-21" />);
  expect(screen.getByLabelText('出口検証の確認資料')).toHaveValue('');
});
it('locks context while fetching and saves only successfully validated actual context locally', async () => {
  const bars = [];
  for (let t = Date.parse('2024-01-01'); bars.length < 260; t += 86400000) {
    const d = new Date(t); if ([0,6].includes(d.getUTCDay())) continue;
    bars.push({ date: d.toISOString().slice(0,10), open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  }
  const date = bars.at(-1).date;
  let resolvePayload;
  fetchStaticChartPayload.mockReturnValue(new Promise(resolve => { resolvePayload = resolve; }));
  render(<BookExitEvidence row={{ symbol: 'AAA', current_price: 100 }} entry={{ path: '/chart.json' }} date={date} />);
  fireEvent.click(screen.getByText('ブレイク後の異常動作と初期・後期の区別'));
  for (const [label,value] of [['出口検証のブレイク日',bars[252].date],['文脈を確認した日',date],['出口検証の確認資料','User verified chart']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByLabelText('適切なベースからの上放れを資料で確認した'));
  fireEvent.click(screen.getByRole('button', { name: 'ブレイク後の実測を照合' }));
  expect(screen.getByLabelText('出口検証の確認資料')).toBeDisabled();
  expect(screen.getByLabelText('確認した局面')).toBeDisabled();
  expect(screen.getByLabelText('適切なベースからの上放れを資料で確認した')).toBeDisabled();
  resolvePayload({ symbol: 'AAA', as_of_date: date, bars });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('この端末に保存'));
  expect(screen.getByLabelText('出口検証の確認資料')).not.toBeDisabled();
  const stored = JSON.parse(localStorage.getItem(`book-exit-review-v1:AAA:${date}`));
  expect(stored).toMatchObject({ symbol: 'AAA', asOfDate: date, breakoutDate: bars[252].date, stage: 'unknown', baseCount: null, setupConfirmed: true });
  expect(stored.reviewedAtISO).toBeTruthy();
  localStorage.clear();
  fetchStaticChartPayload.mockResolvedValue({ symbol: 'OTHER', as_of_date: date, bars });
  fireEvent.click(screen.getByRole('button', { name: 'ブレイク後の実測を照合' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('銘柄または分析日が不一致'));
  expect(localStorage.length).toBe(0);
});
