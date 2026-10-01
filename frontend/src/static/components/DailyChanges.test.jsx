import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DailyChanges from './DailyChanges';
afterEach(cleanup);

it('shows loading rather than zero changes when only a summary or no data has arrived',()=>{
  const {rerender}=render(<DailyChanges query={{}} method="minervini"/>);
  expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
  rerender(<DailyChanges query={{data:{changes:{minervini:{counts:{new:7}}}}}} method="minervini"/>);
  expect(screen.getByRole('status')).toHaveTextContent('未取得を0件とは扱いません');
  expect(screen.queryByText('この分類の銘柄はありません。')).not.toBeInTheDocument();
});

it('hides formerly loaded changes on a failed identity or network revalidation',()=>{
  render(<DailyChanges query={{isError:true,data:{changes:{minervini:{counts:{new:7},items:[]}}}}} method="minervini"/>);
  expect(screen.getByRole('alert')).toHaveTextContent('脱落とは扱いません');
  expect(screen.queryByText(/今回通過 7/)).not.toBeInTheDocument();
});

it('retains missing-symbol history without offering a different current stock as its detail', () => {
  const onSelect=vi.fn();
  const query={data:{as_of:'2026-09-30',history:{previous_as_of:'2026-09-29'},changes:{minervini:{counts:{incomparable:2},items:['MISSING','CURRENT'].map(symbol=>({symbol,state:'incomparable',reason:'前回または今回のデータが欠損',changes:[]}))}}}};
  render(<DailyChanges query={query} method="minervini" onSelect={onSelect} availableSymbols={new Set(['CURRENT'])} />);
  fireEvent.click(screen.getByText('変化の内訳を開く'));
  fireEvent.click(screen.getByRole('button',{name:'比較不能 2'}));
  fireEvent.click(screen.getByText('MISSING · 比較不能'));
  expect(screen.getByRole('button',{name:'MISSING の現在データなし'})).toBeDisabled();
  fireEvent.click(screen.getByText('CURRENT · 比較不能'));
  fireEvent.click(screen.getByRole('button',{name:'現在の CURRENT を分析'}));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('CURRENT');
});
