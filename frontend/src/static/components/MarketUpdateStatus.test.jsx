import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import MarketUpdateStatus from './MarketUpdateStatus';
import { LEGACY_LONG_HISTORY_REASON, LONG_HISTORY_ENVIRONMENT_KEYS } from '../marketUpdateState';
import { SECTOR_ETFS } from '../marketLongHistory';

afterEach(cleanup);
const data=()=>({as_of_date:'2026-10-29',generated_at:'2026-10-30T03:43:28Z',retrieved_at:'2026-10-30T11:30:08Z',
 long_history:{as_of_date:'2026-10-29',retrieved_at:'2026-10-30T04:08:20.871026+00:00'},
 indices:[{symbol:'^GSPC',provenance:{retrieved_at:'2026-10-30T03:44:02.658Z'}}],
 put_call:{points:[{date:'2026-10-29',provenance:{retrieved_at:'2026-10-30T03:44:04.294Z'}}]}});
const view=input=>render(<MarketUpdateStatus data={input} now={Date.parse('2026-10-30T14:00:00Z')}/>);
const acquisitionRow=()=>screen.getByText('長期履歴の取得',{selector:'dt'}).parentElement;

describe('market update disclosure source clocks',()=>{
 it('renders the genuine long-history acquisition clock and remains compact and closed',()=>{
  const input=data(),{container}=view(input),disclosure=container.querySelector('details');
  expect(disclosure).not.toHaveAttribute('open');
  expect(container.querySelectorAll('details')).toHaveLength(1);
  expect(container.querySelectorAll('dt')).toHaveLength(4);
  expect(within(acquisitionRow()).getByText('2026/10/30 13:08:20 JST')).toBeInTheDocument();
  expect(container).not.toHaveTextContent('20:30:08 JST');
  expect(container).not.toHaveTextContent('12:43:28 JST');
  expect(container).not.toHaveTextContent('12:44:02 JST');
  expect(container).not.toHaveTextContent('12:44:04 JST');
  expect(screen.getByText(/取得日時は長期履歴のものです/)).toBeInTheDocument();
  expect(screen.queryByText('市場データの取得')).not.toBeInTheDocument();
  expect(input.long_history.retrieved_at).toBe('2026-10-30T04:08:20.871026+00:00');
 });
 it.each([undefined,null,'not-a-timestamp','',123,{}])('does not borrow another provider clock when history acquisition is invalid: %s',value=>{
  const input=data();input.long_history.retrieved_at=value;view(input);
  expect(within(acquisitionRow()).getByText('未確認')).toBeInTheDocument();
  expect(acquisitionRow()).not.toHaveTextContent('JST');
 });
 it('names an older-schema long history at the target date instead of a bare wait',()=>{
  const environment=Object.fromEntries(LONG_HISTORY_ENVIRONMENT_KEYS.map(key=>[key,1]));
  const history=extra=>({as_of_date:'2026-10-29',retrieved_at:'2026-10-30T04:08:20Z',breadth:[{date:'2026-10-29',coverage:100,eligibleUniverse:100,above50Percent:50,newHighs:10,newLows:1,leaderCount:20,...extra}],sp500:[{date:'2026-10-29',close:6000}],sectorRotation:{frames:[{date:'2026-10-29',ranks:SECTOR_ETFS.map((symbol,i)=>({symbol,rank:i+1,relativeIndex:110-i}))}]}});
  const input=extra=>({...data(),long_history:history(extra),refresh_schedule:{provider:'pandas_market_calendars:NYSE',valid_until:'2026-11-05T05:00:00Z',sessions:[{date:'2026-10-29',close_at:'2026-10-29T20:00:00Z'},{date:'2026-10-30',close_at:'2026-10-30T20:00:00Z'}]}});
  const legacy=view(input({}));
  expect(legacy.container.querySelector('[data-update-state]')).toHaveAttribute('data-update-state','pending');
  expect(within(screen.getByText('長期履歴の形式',{selector:'dt'}).parentElement).getByText(LEGACY_LONG_HISTORY_REASON)).toBeInTheDocument();
  cleanup();
  const current=view(input(environment));
  expect(current.container.querySelector('[data-update-state]')).toHaveAttribute('data-update-state','current');
  expect(screen.queryByText('長期履歴の形式')).not.toBeInTheDocument();
 });
 it('names a long history the reader withdrew as excluded by validation, never 未取得 or 未確認',()=>{
  const input={...data(),long_history_error:'長期市場履歴の整合性を確認できないため、長期集計を表示しません（検証項目: 観測範囲）。',
   refresh_schedule:{provider:'pandas_market_calendars:NYSE',valid_until:'2026-11-05T05:00:00Z',sessions:[{date:'2026-10-29',close_at:'2026-10-29T20:00:00Z'}]}};
  delete input.long_history;
  const {container}=view(input);
  expect(container.querySelector('[data-update-state]')).toHaveAttribute('data-update-state','withdrawn');
  expect(container.querySelector('summary')).toHaveTextContent('10/29 · 長期履歴は検証で除外');
  expect(within(screen.getByText('長期履歴の最終日',{selector:'dt'}).parentElement).getByText('検証で除外')).toBeInTheDocument();
  expect(within(acquisitionRow()).getByText('検証で除外')).toBeInTheDocument();
  expect(container).not.toHaveTextContent(/未取得|未確認|履歴更新待ち/);
 });
 it('keeps missing long history unknown despite a populated obsolete global clock',()=>{
  const input=data();delete input.long_history;view(input);
  expect(within(acquisitionRow()).getByText('未確認')).toBeInTheDocument();
 });
});
