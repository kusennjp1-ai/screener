import { expect, it, vi } from 'vitest';
import { advanceDailyWatch, advanceLiveWatch, deliverLocalWatchNotification, emptyWatchState, readWatchState, WATCH_NOTIFICATION_KEY } from './watchNotifications';

const d1 = '2026-09-29', d2 = '2026-09-30', now = Date.parse('2026-10-01T14:00:00Z');
const row = (price, date = d1, extra = {}) => ({ symbol: 'CASE', current_price: price, se_pivot_price: 100, technical_audit: { valid: true, as_of_date: date }, ...extra });
const daily = (previous, price, date = d1, extra = {}) => advanceDailyWatch(previous, { rows: [row(price, date)], watch: ['CASE'], asOf: date, method: 'minervini', now, ...extra });
const quote = (price, ms = 0, extra = {}) => ({ symbol: 'CASE', price, source: 'Finnhub', as_of: new Date(now + ms).toISOString(), is_realtime: true, delay_seconds: 0, ...extra });
const live = (previous, price, ms = 0, extra = {}) => advanceLiveWatch(previous, { row: row(98), watch: ['CASE'], asOf: d1, method: 'minervini', quote: quote(price, ms), connected: true, now: now + ms, ...extra });

it('sets an initial baseline then records an actual next-day transition exactly once', () => {
  const first = daily(emptyWatchState(), 98);
  expect(first.added).toEqual([]);
  const second = daily(first.state, 102, d2);
  expect(second.added).toHaveLength(1);
  expect(second.added[0]).toMatchObject({ from: 'ピボット待ち', to: '買いゾーン内', previous_as_of: d1, as_of: d2, source: 'daily' });
  expect(daily(second.state, 102, d2).added).toEqual([]);
  expect(daily(second.state, 98, d1).state.observations['minervini:CASE'].as_of).toBe(d2);
});
it('uses the existing method-specific buy zone, never a notification-specific threshold', () => {
  const first = daily(emptyWatchState(), 102, d1, { method: 'minervini2' });
  const second = daily(first.state, 104, d2, { method: 'minervini2' });
  expect(second.added[0].to).toBe('買いゾーン超過');
  expect(daily(daily(emptyWatchState(), 102).state, 104, d2).added).toEqual([]);
});
it('does not make alerts from missing, stale, invalid, acquired, or static-price data', () => {
  const first = daily(emptyWatchState(), 98).state;
  for (const r of [row(102, d2, { technical_audit: { valid: false, as_of_date: d2 } }), row(102, d1), row(102, d2, { se_pivot_price: null }), row(102, d2, { corporate_action: { cash_acquisition: true } }), row(102, d2, { price_activity: { lowRange: true } })]) {
    expect(daily(first, 102, d2, { rows: [r] }).added).toEqual([]);
  }
  const unknown = daily(first, 102, d2, { rows: [] }).state;
  expect(daily(unknown, 102, '2026-10-01').added).toEqual([]);
});
it('removing and readding a watched symbol does not invent a transition while unwatched', () => {
  const first = daily(emptyWatchState(), 98).state;
  const removed = daily(first, 102, d2, { watch: [] }).state;
  expect(removed.observations).toEqual({});
  expect(daily(removed, 102, d2).added).toEqual([]);
});
it('accepts live transitions only from a connected fresh verified personal feed', () => {
  const first = live(null, 98);
  expect(first.event).toBeNull();
  const second = live(first.observation, 102, 1000);
  expect(second.event).toMatchObject({ from: 'ピボット待ち', to: '買いゾーン内', source: 'live' });
  expect(live(second.observation, 102, 1000).event).toBeNull();
  expect(live(second.observation, 98, 500).observation).toEqual(second.observation);
  for (const extra of [{ connected: false }, { watch: [] }, { quote: quote(102, 0, { source: 'Other' }) }, { quote: quote(102, -91000) }, { quote: quote(102, 0, { delay_seconds: 15 }) }, { row: row(98, d2) }]) {
    expect(live(first.observation, 102, 1000, extra).event).toBeNull();
  }
  expect(second.event).not.toHaveProperty('price');
  expect(second.observation).not.toHaveProperty('quote');
});
it('reads only safe daily history and recovers broken storage without manufacturing alerts', () => {
  expect(readWatchState({ getItem: () => '{broken' })).toEqual(emptyWatchState());
  expect(readWatchState({ getItem: () => { throw new Error('disabled'); } })).toEqual(emptyWatchState());
  const event = live(live(null, 98).observation, 102, 1000).event;
  const stored = { ...emptyWatchState(), events: [event, null], observations: { bad: null }, seen: [42, 'valid'] };
  const storage = { getItem: vi.fn(() => JSON.stringify(stored)) };
  const value = readWatchState(storage);
  expect(storage.getItem).toHaveBeenCalledWith(WATCH_NOTIFICATION_KEY);
  expect(value).toEqual({ ...emptyWatchState(), seen: ['valid'] });
});
it('never requests notification permission implicitly and uses the event ID for PWA deduplication', async () => {
  const event = daily(daily(emptyWatchState(), 98).state, 102, d2).added[0];
  const notification = { permission: 'granted', requestPermission: vi.fn() }, showNotification = vi.fn();
  const serviceWorker = { getRegistration: vi.fn(async () => ({ showNotification })) };
  const settings = { enabled: true, notification, serviceWorker, baseUrl: 'https://example.com/screener/#/' };
  expect(await deliverLocalWatchNotification(event, { ...settings, enabled: false })).toBe(false);
  expect(await deliverLocalWatchNotification(event, { ...settings, notification: { permission: 'default' } })).toBe(false);
  expect(await deliverLocalWatchNotification(event, settings)).toBe(true);
  expect(showNotification).toHaveBeenCalledWith('CASE の状態変化', expect.objectContaining({ tag: event.id, renotify: false, data: { url: 'https://example.com/screener/#/?symbol=CASE' } }));
  expect(notification.requestPermission).not.toHaveBeenCalled();
});
it('opens the symbol when a supported desktop notification is clicked without a service worker', async () => {
  let delivered;
  class DesktopNotification {
    static permission = 'granted';
    constructor(title, options) { this.title = title; this.options = options; this.close = vi.fn(); delivered = this; }
  }
  const assign = vi.fn(), focus = vi.fn();
  vi.stubGlobal('location', { assign }); vi.stubGlobal('focus', focus);
  try {
    const event = daily(daily(emptyWatchState(), 98).state, 102, d2).added[0];
    expect(await deliverLocalWatchNotification(event, { enabled: true, notification: DesktopNotification, serviceWorker: null, baseUrl: 'https://example.com/screener/#/compare' })).toBe(true);
    expect(assign).not.toHaveBeenCalled();
    delivered.onclick({ preventDefault: vi.fn() });
    expect(delivered.close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('https://example.com/screener/#/?symbol=CASE');
  } finally { vi.unstubAllGlobals(); }
});
