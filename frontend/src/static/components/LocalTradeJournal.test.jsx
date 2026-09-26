import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import LocalTradeJournal from './LocalTradeJournal';
import { JOURNAL_STORAGE_KEY } from '../localTradeJournal';

beforeEach(() => localStorage.clear());
afterEach(cleanup);
const fillBuy = () => {
  fireEvent.click(screen.getByText('取引・評価価格・逆指値を記録する'));
  for (const [label, value] of [['記録日 YYYY-MM-DD','2026-01-02'],['日誌の銘柄','AAA'],['取引・評価価格 $','100'],['記録株数','10'],['記録する逆指値 $','95']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
};

it('persists real declared records and reloads them without inventing paper records', () => {
  const first = render(<LocalTradeJournal />);
  expect(screen.getByText('保有記録はありません。')).toBeInTheDocument();
  fillBuy();
  fireEvent.click(screen.getByRole('checkbox', { name: '当日の市場・先導株を自分で確認' }));
  fireEvent.click(screen.getByRole('button', { name: '実施済みの内容を日誌に記録' }));
  expect(screen.getByRole('checkbox', { name: '当日の市場・先導株を自分で確認' })).not.toBeChecked();
  expect(screen.getByText('AAA · 10株')).toBeInTheDocument();
  const saved = JSON.parse(localStorage.getItem(`${JOURNAL_STORAGE_KEY}.live`));
  expect(saved.events).toHaveLength(1);
  expect(saved.events[0]).toMatchObject({ symbol: 'AAA', strategy: 'minervini' });
  expect(localStorage.getItem(`${JOURNAL_STORAGE_KEY}.paper`)).toBeNull();
  first.unmount(); render(<LocalTradeJournal />);
  expect(screen.getByText('AAA · 10株')).toBeInTheDocument();
});

it('isolates paper mode and restores live holdings on switching back', () => {
  render(<LocalTradeJournal />); fillBuy();
  fireEvent.click(screen.getByRole('button', { name: '実施済みの内容を日誌に記録' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '日誌の取引区分' }));
  fireEvent.click(screen.getByRole('option', { name: 'ペーパートレード' }));
  expect(screen.getByText('保有記録はありません。')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '日誌の取引区分' }));
  fireEvent.click(screen.getByRole('option', { name: '実取引（自己申告）' }));
  expect(screen.getByText('AAA · 10株')).toBeInTheDocument();
});

it('rejects broken import without replacing saved records', () => {
  render(<LocalTradeJournal />); fillBuy();
  fireEvent.click(screen.getByRole('button', { name: '実施済みの内容を日誌に記録' }));
  const before = localStorage.getItem(`${JOURNAL_STORAGE_KEY}.live`);
  fireEvent.click(screen.getByText('変更履歴・JSON復元'));
  fireEvent.change(screen.getByLabelText('復元する日誌JSON'), { target: { value: '{broken' } });
  fireEvent.click(screen.getByRole('button', { name: '検証して現在の日誌を置き換える' }));
  expect(screen.getByText('JSONを読み取れません。')).toBeInTheDocument();
  expect(localStorage.getItem(`${JOURNAL_STORAGE_KEY}.live`)).toBe(before);
});

it('invalidates a prospective calculation when its input changes', () => {
  render(<LocalTradeJournal />); fillBuy();
  fireEvent.click(screen.getByRole('button', { name: '全保有を含めて検算' }));
  expect(screen.getByText(/計算可能株数の上限/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('取引・評価価格 $'), { target: { value: '110' } });
  expect(screen.queryByText(/計算可能株数の上限/)).not.toBeInTheDocument();
  expect(localStorage.getItem(`${JOURNAL_STORAGE_KEY}.live`)).toBeNull();
});

it('does not implicitly overwrite corrupt saved data', () => {
  localStorage.setItem(`${JOURNAL_STORAGE_KEY}.live`, '{corrupt');
  render(<LocalTradeJournal />);
  expect(screen.getByRole('alert')).toHaveTextContent('自動上書きはしていません');
  expect(localStorage.getItem(`${JOURNAL_STORAGE_KEY}.live`)).toBe('{corrupt');
});

it('refuses paper data as a replacement for the active live journal', () => {
  render(<LocalTradeJournal />);
  fireEvent.click(screen.getByText('変更履歴・JSON復元'));
  fireEvent.change(screen.getByLabelText('復元する日誌JSON'), { target: { value: JSON.stringify({ version: 1, mode: 'paper', initialCapital: 100000, events: [] }) } });
  fireEvent.click(screen.getByRole('button', { name: '検証して現在の日誌を置き換える' }));
  expect(screen.getByRole('alert')).toHaveTextContent('区分が異なります');
  expect(localStorage.getItem(`${JOURNAL_STORAGE_KEY}.live`)).toBeNull();
});

it('stores an explicit dated MA50 observation without pretending to modify an order', () => {
  render(<LocalTradeJournal />); fillBuy();
  fireEvent.click(screen.getByRole('button', { name: '実施済みの内容を日誌に記録' }));
  fireEvent.click(screen.getByText('残株の利益保護・50日線・バックストップ'));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '保護する保有銘柄' }));
  fireEvent.click(screen.getByRole('option', { name: 'AAA' }));
  for (const [label, value] of [['確認終値 $','110'],['50日移動平均 $（任意）','102'],['今回終値・50日線の日付 YYYY-MM-DD','2026-01-03']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '終値と50日線の観測を日誌に保存' }));
  const saved = JSON.parse(localStorage.getItem(`${JOURNAL_STORAGE_KEY}.live`));
  expect(saved.events.at(-1)).toMatchObject({ type: 'ma50', date: '2026-01-03', close: 110, ma50: 102 });
  expect(screen.getByText(/保存済み50日線観測 1件/)).toHaveTextContent('未確認');
});
