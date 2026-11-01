import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const DATE = '2026-10-02';
const sessions = count => { const out = []; const d = new Date(`${DATE}T00:00:00Z`); while (out.length < count) { const w = d.getUTCDay(); if (w && w < 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); } return out; };
const days = sessions(300);
const calendar = { schema_version: 'market-sessions-v1', market: 'US', exchange: 'XNYS', provider: 'pandas_market_calendars', provider_version: 'test', as_of_date: DATE, range_end: DATE, range_start: days[0], sessions: days };
const closeAt = (i, breakLast) => 50 * 1.003 ** i * (breakLast && i === days.length - 1 ? 0.9 : 1);
const bars = (breakLast, count = days.length) => days.slice(days.length - count).map((date, k) => {
  const i = days.length - count + k, close = closeAt(i, breakLast);
  return { date, open: close, high: close * 1.005, low: close * 0.995, close, volume: breakLast && i === days.length - 1 ? 30000 : 10000 };
});
const payloads = {
  'AAA.json': { symbol: 'AAA', as_of_date: DATE, session_calendar: calendar, bars: bars(true) },
  'BBB.json': { symbol: 'BBB', as_of_date: DATE, session_calendar: calendar, bars: bars(false) },
  // Retained history: bars stop one session before the analysis date.
  'OLD.json': { symbol: 'OLD', as_of_date: DATE, session_calendar: calendar, bars: bars(false).slice(0, -1), retained_price_history: { status: 'stale_reference_only' } },
  'UNV.json': { symbol: 'UNV', as_of_date: DATE, session_calendar: calendar, bars: bars(false) },
  'BAD.json': { symbol: 'OTHER', as_of_date: DATE, bars: [] },
};

vi.mock('../chartClient', () => ({
  staticChartKeys: { payload: (symbol, path) => ['staticChartsPayload', symbol, path] },
  fetchStaticChartPayload: vi.fn(async path => structuredClone(payloads[path])),
}));
vi.mock('../chartPayloadIdentity', () => ({
  requireChartIdentity: (payload, symbol) => { if (payload?.symbol !== symbol) throw Error('mismatch'); return payload; },
}));

describe('watch sell checks', () => {
  it('checks only certified current bars and marks everything else unknown', async () => {
    const { useWatchSellChecks, SELL_WATCH_LIMIT } = await import('./useBriefData');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = (symbol, audited = true, path = `${symbol}.json`) => ({ symbol, row: { symbol, market: 'US', chart_path: path, current_price: payloads[path]?.bars?.at(-1)?.close, technical_audit: { valid: audited } } });
    const views = [view('AAA'), view('BBB'), view('OLD'), view('BAD'), { symbol: 'NOC', row: {} }, view('UNV', false)];
    const { result } = renderHook(() => useWatchSellChecks(views, { version: 'v1', date: DATE }), { wrapper });
    await waitFor(() => expect(Object.keys(result.current).sort()).toEqual(['AAA', 'BAD', 'BBB', 'NOC', 'OLD', 'UNV']));
    expect(result.current.AAA.weakness.map(c => c.key)).toEqual(['day-down', 'ma50', 'book']);
    expect(result.current.AAA.weakness.slice(0, 2).map(c => c.state)).toEqual(['hit', 'hit']);
    expect(result.current.BBB.weakness.slice(0, 2).map(c => c.state)).toEqual(['clear', 'clear']);
    expect(result.current.OLD).toMatchObject({ unknown: true });
    expect(result.current.OLD.reason).toMatch(/最終日足|分析日/);
    expect(result.current.BAD).toMatchObject({ unknown: true, reason: '日足を取得できません' });
    expect(result.current.NOC).toMatchObject({ unknown: true, reason: '日足チャート未配信' });
    expect(result.current.UNV).toMatchObject({ unknown: true, reason: '公開時の日足検証を通過していません' });
    expect(SELL_WATCH_LIMIT).toBeGreaterThan(0);
  });

  it('marks watched stocks beyond the fetch limit as unchecked', async () => {
    const { useWatchSellChecks, SELL_WATCH_LIMIT } = await import('./useBriefData');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const views = Array.from({ length: SELL_WATCH_LIMIT + 1 }, (_, i) => ({ symbol: `S${i}`, row: { symbol: `S${i}`, chart_path: 'BAD.json', technical_audit: { valid: true } } }));
    const { result } = renderHook(() => useWatchSellChecks(views, { version: 'v1', date: DATE }), { wrapper });
    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(SELL_WATCH_LIMIT + 1));
    expect(result.current[`S${SELL_WATCH_LIMIT}`].reason).toBe(`確認は先頭${SELL_WATCH_LIMIT}銘柄まで`);
  });
});
