import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WatchNotifications from './WatchNotifications';
import { WATCH_NOTIFICATION_KEY } from '../watchNotifications';

const row = (price, date) => ({ symbol: 'CASE', current_price: price, se_pivot_price: 100, technical_audit: { valid: true, as_of_date: date } });
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
