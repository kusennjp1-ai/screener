import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import MarketUpdateStatus from './MarketUpdateStatus';

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
 it('keeps missing long history unknown despite a populated obsolete global clock',()=>{
  const input=data();delete input.long_history;view(input);
  expect(within(acquisitionRow()).getByText('未確認')).toBeInTheDocument();
 });
});
