import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DailyChanges from './DailyChanges';
import { CHANGE_LABELS } from '../candidateHistory';
afterEach(cleanup);
const counts=extra=>({...Object.fromEntries(Object.keys(CHANGE_LABELS).map(key=>[key,0])),...extra});
const detailQuery=(items,values)=>({data:{as_of:'2026-09-30',history:{previous_as_of:'2026-09-29'},changes:{minervini:{counts:counts(values),items}}}});

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
  const query=detailQuery(['MISSING','CURRENT'].map(symbol=>({symbol,state:'incomparable',reason:'前回または今回のデータが欠損',changes:[]})),{incomparable:2});
  render(<DailyChanges query={query} method="minervini" onSelect={onSelect} availableSymbols={new Set(['CURRENT'])} />);
  fireEvent.click(screen.getByText('変化の内訳を開く'));
  fireEvent.click(screen.getByRole('button',{name:'比較不能 2'}));
  fireEvent.click(screen.getByText('MISSING · 比較不能'));
  expect(screen.getByRole('button',{name:'MISSING の現在データなし'})).toBeDisabled();
  fireEvent.click(screen.getByText('CURRENT · 比較不能'));
  fireEvent.click(screen.getByRole('button',{name:'現在の CURRENT を分析'}));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('CURRENT');
});

it('explains full incomparability and opens its rows by default without inventing a shared cause',()=>{
  const query=detailQuery([
    {symbol:'A',state:'incomparable',reason:'条件に未確認があります。',changes:[]},
    {symbol:'B',state:'incomparable',reason:'前回の銘柄データが欠損しています。',changes:[]},
  ],{incomparable:2});
  render(<DailyChanges query={query} method="minervini"/>);
  expect(screen.getByRole('alert')).toHaveTextContent('全2銘柄が比較不能のため、通過・脱落の変化は判定できません');
  expect(screen.getByRole('alert')).not.toHaveTextContent('定義変更');
  fireEvent.click(screen.getByText('変化の内訳を開く'));
  expect(screen.getByRole('button',{name:'比較不能 2'})).toHaveAttribute('aria-pressed','true');
  fireEvent.click(screen.getByText('A · 比較不能'));
  expect(screen.getByText('条件に未確認があります。')).toBeVisible();
  fireEvent.click(screen.getByText('B · 比較不能'));
  expect(screen.getByText('前回の銘柄データが欠損しています。')).toBeVisible();
});

it('explains partial coverage while preserving comparable counts and default transition rows',()=>{
  const query=detailQuery([
    {symbol:'A',state:'new',changes:[]},
    {symbol:'B',state:'incomparable',reason:'条件に未確認があります。',changes:[]},
  ],{new:1,incomparable:1});
  render(<DailyChanges query={query} method="minervini"/>);
  expect(screen.getByRole('alert')).toHaveTextContent('2銘柄のうち1銘柄は比較不能');
  expect(screen.getByRole('alert')).toHaveTextContent('比較できた1銘柄分');
  fireEvent.click(screen.getByText('変化の内訳を開く'));
  expect(screen.getByRole('button',{name:'今回通過 1'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByText('A · 今回通過')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'比較不能 1'}));
  expect(screen.getByText('B · 比較不能')).toBeVisible();
});

it('does not call first recording a failed comparison and keeps missing methods uncounted',()=>{
  const query=detailQuery([{symbol:'A',state:'incomparable',reason:'前回判定なし',changes:[]}],{incomparable:1});
  query.data.history.previous_as_of=null;
  const {rerender}=render(<DailyChanges query={query} method="minervini"/>);
  expect(screen.getByText('前回比較は、次の営業日の公開後から表示します。')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  rerender(<DailyChanges query={query} method="oneil"/>);
  expect(screen.getByRole('status')).toHaveTextContent('未取得を0件とは扱いません');
});
