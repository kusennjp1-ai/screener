import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const DATE = '2026-10-02';
const sessions = count => { const out = []; const d = new Date(`${DATE}T00:00:00Z`); while (out.length < count) { const w = d.getUTCDay(); if (w && w < 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); } return out; };
const days = sessions(201);
const chart = (symbol, breakLast) => ({ symbol, as_of_date: DATE, bars: days.map((date, i) => {
  const close = 50 * 1.003 ** i * (breakLast && i === days.length - 1 ? 0.9 : 1);
  return { date, open: close, high: close * 1.005, low: close * 0.995, close, volume: breakLast && i === days.length - 1 ? 30000 : 10000 };
}) });

vi.mock('../chartClient', () => ({
  staticChartKeys: { payload: (symbol, path) => ['staticChartsPayload', symbol, path] },
  fetchStaticChartPayload: vi.fn(async path => (path === 'BAD.json' ? { symbol: 'OTHER', as_of_date: DATE, bars: [] } : chart(path.replace('.json', ''), path === 'AAA.json'))),
}));

describe('watch sell checks', () => {
  it('reads the shared chart queries and leaves mismatched or missing charts unknown', async () => {
    const { useWatchSellChecks, SELL_WATCH_LIMIT } = await import('./useBriefData');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = symbol => ({ symbol, row: { chart_path: `${symbol}.json` } });
    const views = [view('AAA'), view('BBB'), view('BAD'), { symbol: 'NOC', row: {} }];
    const { result } = renderHook(() => useWatchSellChecks(views, { version: 'v1', date: DATE }), { wrapper });
    await waitFor(() => expect(Object.keys(result.current).sort()).toEqual(['AAA', 'BBB']));
    expect(result.current.AAA.weakness.map(c => c.state)).toEqual(['hit', 'hit']);
    expect(result.current.BBB.weakness.map(c => c.state)).toEqual(['clear', 'clear']);
    expect(result.current.BAD).toBeUndefined();
    expect(result.current.NOC).toBeUndefined();
    expect(client.getQueryCache().findAll({ queryKey: ['staticChartsPayload'] })).toHaveLength(3);
    expect(SELL_WATCH_LIMIT).toBeGreaterThan(0);
  });
});
