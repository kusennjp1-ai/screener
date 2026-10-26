import { fireEvent,render,screen } from '@testing-library/react';
import { describe,it,expect } from 'vitest';
import { MarketTrendDashboard } from './MarketTrendDashboard';
import { readMarketTrends } from '../marketTrendAsset';
const data=()=>({schema_version:'market-trends-v1',market:'US',as_of_date:'2026-10-23',breadth:{points:[{date:'2026-10-22',above50Percent:25,coverage:4,universe:6,newHighs:0,newLows:2},{date:'2026-10-23',above50Percent:50,coverage:4,universe:6,newHighs:1,newLows:0}]},put_call:{points:[{date:'2026-10-22',value:.8,calls:100,puts:80},{date:'2026-10-23',value:null}]},indices:[{symbol:'^GSPC',available:true,points:[{date:'2026-10-23',value:3}],events:[],latest:{date:'2026-10-23',value:3}},{symbol:'^IXIC',available:true,points:[{date:'2026-10-23',value:5}],events:[],latest:{date:'2026-10-23',value:5}}]});
describe('market trend dashboard',()=>{
 it('shows a trend immediately and moves date with the accessible scrubber; formula starts closed',()=>{render(<MarketTrendDashboard data={data()}/>);expect(screen.getByRole('img',{name:/50日線上の割合/})).toBeInTheDocument();const explanation=screen.getByText('計算方法・出典・読み方').closest('details');expect(explanation).not.toHaveAttribute('open');fireEvent.change(screen.getByRole('slider'),{target:{value:'0'}});expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext','2026-10-22');expect(screen.getByText('25%')).toBeInTheDocument();});
 it('switches via keyboard and keeps real zero separate from unknown',()=>{render(<MarketTrendDashboard data={data()}/>);fireEvent.keyDown(screen.getByRole('tab',{name:/50日線/}),{key:'ArrowRight'});expect(screen.getByRole('tab',{name:/新高値・安値/})).toHaveAttribute('aria-selected','true');expect(screen.getByText('0銘柄')).toBeInTheDocument();fireEvent.click(screen.getByRole('tab',{name:/P\/C/}));expect(screen.getByText('未確認',{selector:'b'})).toBeInTheDocument();});
 it('shows both independent index counts and switches chart data',()=>{render(<MarketTrendDashboard data={data()}/>);fireEvent.click(screen.getByRole('tab',{name:/分配日/}));expect(screen.getByRole('button',{name:/S&P 500 3日/})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:/NASDAQ総合 5日/}));expect(screen.getByText('5日',{selector:'b'})).toBeInTheDocument();});
 it('rejects wrong-date and future observations',()=>{expect(()=>readMarketTrends(data(),{as_of_date:'2026-10-22'})).toThrow();const invalid=data();invalid.put_call.points[1].date='2026-10-24';expect(()=>readMarketTrends(invalid,{as_of_date:'2026-10-23'})).toThrow();});
 it('does not truncate active distribution dates and distinguishes the list from the historical cursor',()=>{const input=data();input.indices[0].events=Array.from({length:13},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,state:'active',changePct:-.4}));render(<MarketTrendDashboard data={input}/>);fireEvent.click(screen.getByRole('tab',{name:/分配日/}));expect(screen.getAllByRole('listitem',{hidden:true})).toHaveLength(13);expect(screen.getByText(/グラフで選択した過去日の状態とは別/)).toBeInTheDocument();});
 it('dates retained index events and source to the last confirmed session while the next session stays unknown',()=>{
  const input=data();input.as_of_date='2026-10-26';
  for(const index of input.indices){index.available=false;index.historical=true;index.latest=null;index.provenance={retrieved_at:'2026-10-24T01:00:00Z'};index.source='Yahoo Finance';index.events=[{date:'2026-10-22',state:'active',changePct:-.4}];}
  render(<MarketTrendDashboard data={input}/>);fireEvent.click(screen.getByRole('tab',{name:/分配日/}));
  expect(screen.getByRole('button',{name:'S&P 500 未確認'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'NASDAQ総合 未確認'})).toBeInTheDocument();
  const summary=screen.getByText('最終確認日 2026-10-23 時点の発生日一覧・失効理由');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText(/最終確認日 2026-10-23 時点の有効日すべて.*分析基準日 2026-10-26 現在は未確認/)).toBeInTheDocument();
  expect(screen.getByText('有効（最終確認日時点）')).toBeInTheDocument();
  expect(screen.getByText(/取得 2026-10-24T01:00:00Z · 対象 2026-10-23 · 提供元 Yahoo Finance/)).toBeInTheDocument();
  expect(screen.queryByText('現在の発生日一覧・失効理由')).not.toBeInTheDocument();
  expect(screen.queryByText(/対象 2026-10-26/)).not.toBeInTheDocument();
  expect(screen.getByRole('img',{name:/分配日の有効件数の推移。2026-10-23から2026-10-23/})).toBeInTheDocument();
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext','2026-10-23');
  expect(screen.getByText('3日',{selector:'b'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'NASDAQ総合 未確認'}));
  expect(screen.getByText('5日',{selector:'b'})).toBeInTheDocument();
  expect(screen.getByText('最終確認日 2026-10-23 時点の発生日一覧・失効理由')).toBeInTheDocument();
 });
});
