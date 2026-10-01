import { entryPlan, quoteStatus } from './researchEngine.js';
export const WATCH_NOTIFICATION_KEY = 'research-watch-notifications-v1';
export const WATCH_NOTIFICATION_PREFERENCE = 'research-watch-notifications-enabled';
const actionableStates = new Set(['ピボット待ち', '買いゾーン内', '買いゾーン超過']);
export const emptyWatchState = () => ({ version: 1, observations: {}, events: [], seen: [] });
const usable = (row, asOf) => row?.technical_audit?.valid === true && row.technical_audit.as_of_date === asOf;
export function watchStorage() { try { return globalThis.localStorage; } catch { return null; } }

export function readWatchState(storage) {
  try {
    const value = JSON.parse(storage?.getItem(WATCH_NOTIFICATION_KEY) || 'null');
    if (value?.version === 1 && value.observations && Array.isArray(value.events) && Array.isArray(value.seen)) return {
      version: 1,
      observations: Object.fromEntries(Object.entries(value.observations).filter(([, item]) => item && typeof item.symbol === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.as_of) && (item.state === null || typeof item.state === 'string'))),
      events: value.events.filter(item => item?.source === 'daily' && typeof item.id === 'string' && typeof item.symbol === 'string' && typeof item.as_of === 'string' && Number.isFinite(Date.parse(item.observed_at)) && actionableStates.has(item.from) && actionableStates.has(item.to)).slice(0, 200),
      seen: value.seen.filter(id => typeof id === 'string').slice(-2000),
    };
  } catch { /* Missing/broken local history starts a baseline, never an alert. */ }
  return emptyWatchState();
}

export function advanceDailyWatch(previous, { rows, watch, asOf, method, now = Date.now() }) {
  if (!asOf || !Array.isArray(watch)) return { state: previous, added: [] };
  const observations = { ...previous.observations }, bySymbol = rows instanceof Map ? rows : new Map(rows.map(row => [row.symbol, row]));
  const seen = new Set(previous.seen), added = [];
  for (const key of Object.keys(observations)) if (!watch.includes(observations[key].symbol)) delete observations[key];
  for (const symbol of watch) {
    const key = `${method}:${symbol}`, before = observations[key], row = bySymbol.get(symbol);
    if (before?.as_of >= asOf) continue;
    const state = usable(row, asOf) ? entryPlan(row, null, method).state : null;
    observations[key] = { symbol, method, as_of: asOf, state };
    if (before && state !== before.state && actionableStates.has(before.state) && actionableStates.has(state)) {
      const id = `daily:${method}:${symbol}:${asOf}:${before.state}>${state}`;
      if (!seen.has(id)) { seen.add(id); added.push({ id, source: 'daily', symbol, method, from: before.state, to: state, previous_as_of: before.as_of, as_of: asOf, observed_at: new Date(now).toISOString() }); }
    }
  }
  return { state: { version: 1, observations, events: [...added, ...previous.events].slice(0, 200), seen: [...seen].slice(-2000) }, added };
}

// Personal feed observations and events stay in memory. No key or quote object
// is accepted by the persistent daily-state functions.
export function advanceLiveWatch(previous, { row, watch, asOf, method, quote, connected, now = Date.now() }) {
  if (!connected || !row || !watch.includes(row.symbol) || quote?.symbol !== row.symbol || quote?.source !== 'Finnhub' || quoteStatus(quote, now) !== 'リアルタイム' || !usable(row, asOf)) return { observation: null, event: null };
  const timestamp = Date.parse(quote.as_of), state = entryPlan(row, quote, method).state;
  const observation = { symbol: row.symbol, method, timestamp, state };
  if (!previous || previous.symbol !== row.symbol || previous.method !== method) return { observation, event: null };
  if (timestamp <= previous.timestamp) return { observation: previous, event: null };
  if (state === previous.state || !actionableStates.has(state) || !actionableStates.has(previous.state)) return { observation, event: null };
  return { observation, event: { id: `live:${method}:${row.symbol}:${quote.as_of}:${previous.state}>${state}`, source: 'live', symbol: row.symbol, method, from: previous.state, to: state, as_of: asOf, observed_at: new Date(now).toISOString() } };
}

export async function deliverLocalWatchNotification(event, { enabled, notification = globalThis.Notification, serviceWorker = globalThis.navigator?.serviceWorker, baseUrl = globalThis.location?.href } = {}) {
  if (!enabled || notification?.permission !== 'granted') return false;
  const options = { body: `${event.from} → ${event.to}。価格位置の変化であり、購入条件の通過ではありません。`, tag: event.id, renotify: false,
    data: { url: new URL(`#/?symbol=${encodeURIComponent(event.symbol)}`, baseUrl).href } };
  const registration = await serviceWorker?.getRegistration?.();
  if (registration?.showNotification) { await registration.showNotification(`${event.symbol} の状態変化`, options); return true; }
  if (notification) {
    const notice = new notification(`${event.symbol} の状態変化`, options);
    notice.onclick = click => {
      click?.preventDefault?.();
      notice.close?.();
      globalThis.focus?.();
      globalThis.location?.assign(options.data.url);
    };
    return true;
  }
  return false;
}
