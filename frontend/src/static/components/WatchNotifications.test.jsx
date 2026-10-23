import { withAuditFixture } from '../testAuditFixture';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WatchNotifications from './WatchNotifications';
import { WATCH_NOTIFICATION_KEY } from '../watchNotifications';

const row = (price, date) => withAuditFixture({ symbol: 'CASE', current_price: price, se_pivot_price: 100 }, date);
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });
it('shows daily changes while asking permission only after the explicit notification action', async () => {
  const requestPermission = vi.fn(async () => 'granted');
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  const onSelect = vi.fn(), watch = ['CASE'];
  const { rerender } = render(<WatchNotifications rows={[row(98, '2026-09-29')]} watch={watch} asOf="2026-09-29" onSelect={onSelect}/>);
  fireEvent.click(screen.getByText('ウォッチの状態変化 · 0件'));
  expect(requestPermission).not.toHaveBeenCalled();
  rerender(<WatchNotifications rows={[row(102, '2026-09-30')]} watch={watch} asOf="2026-09-30" onSelect={onSelect}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'CASE · ピボット待ち → 買いゾーン内' }));
  expect(onSelect).toHaveBeenCalledWith('CASE');
  expect(JSON.parse(localStorage.getItem(WATCH_NOTIFICATION_KEY)).events).toHaveLength(1);
  expect(requestPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '端末通知を有効にする' }));
  await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('button', { name: '端末通知を止める' })).toBeVisible();
});

it('labels price-position history separately from qualification and retains dates and unavailable symbols',()=>{
  localStorage.setItem(WATCH_NOTIFICATION_KEY,JSON.stringify({version:1,observations:{},seen:[],events:[
    {id:'old',source:'daily',symbol:'MISSING',method:'minervini',from:'ピボット待ち',to:'買いゾーン内',previous_as_of:'2026-09-28',as_of:'2026-09-29',observed_at:'2026-09-29T21:00:00Z'},
    {id:'new',source:'daily',symbol:'CURRENT',method:'minervini',from:'買いゾーン内',to:'買いゾーン超過',previous_as_of:'2026-09-29',as_of:'2026-09-30',observed_at:'2026-09-30T21:00:00Z'},
  ]}));
  const onSelect=vi.fn();
  render(<WatchNotifications rows={[{symbol:'CURRENT'}]} watch={['CURRENT']} onSelect={onSelect}/>);
  fireEvent.click(screen.getByText('ウォッチの状態変化 · 2件'));
  expect(screen.getAllByText('日次の価格位置')).toHaveLength(2);
  expect(screen.getByText(/購入条件の通過を示す通知ではありません/)).toBeVisible();
  expect(screen.getByText('ミネルヴィニ · 日次 2026-09-29 → 2026-09-30')).toBeVisible();
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('CURRENT');
  expect(screen.getByRole('button',{name:'MISSING · ピボット待ち → 買いゾーン内'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'CURRENT · 買いゾーン内 → 買いゾーン超過'}));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('CURRENT');
});


it('retains live-price history after disconnect without describing it as an active connection',()=>{
  const now=Date.parse('2026-10-01T14:00:00Z');
  const clock=vi.spyOn(Date,'now').mockReturnValue(now);
  try {
    const rows=[row(98,'2026-09-29')], watch=['CASE'];
    const quote=(price,ms=0)=>({symbol:'CASE',price,source:'Finnhub',as_of:new Date(now+ms).toISOString(),is_realtime:true,delay_seconds:0});
    const {rerender}=render(<WatchNotifications rows={rows} watch={watch} asOf="2026-09-29" personalConnected personalQuote={quote(98)}/>);
    fireEvent.click(screen.getByText('ウォッチの状態変化 · 0件'));
    clock.mockReturnValue(now+1000);
    rerender(<WatchNotifications rows={rows} watch={watch} asOf="2026-09-29" personalConnected personalQuote={quote(102,1000)}/>);
    expect(screen.getByText('接続価格の履歴')).toBeVisible();
    expect(screen.getByText('CASE · ピボット待ち → 買いゾーン内')).toBeVisible();
    rerender(<WatchNotifications rows={rows} watch={watch} asOf="2026-09-29" personalConnected={false} personalQuote={null}/>);
    expect(screen.getByText('ウォッチの状態変化 · 1件')).toBeVisible();
    expect(screen.getByText('接続価格の履歴')).toBeVisible();
    expect(screen.queryByText('接続中の価格位置')).not.toBeInTheDocument();
    expect(screen.getByText(/接続価格 .*JST · このタブ内のみ/)).toBeVisible();
    expect(JSON.parse(localStorage.getItem(WATCH_NOTIFICATION_KEY)).events).toHaveLength(0);
  } finally {clock.mockRestore();}
});
