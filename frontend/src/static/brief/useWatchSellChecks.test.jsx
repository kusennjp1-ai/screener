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
    expect(result.current[`S${SELL_WATCH_LIMIT}`]).toMatchObject({ unknown: true, limit: SELL_WATCH_LIMIT, reason: `確認は先頭${SELL_WATCH_LIMIT}銘柄まで` });
    // The limit is visible text on the row's chip, not only a title.
    const { sellChipView } = await import('./briefSell');
    expect(sellChipView(result.current[`S${SELL_WATCH_LIMIT}`]).text).toBe(`売りのサイン 未確認（上限${SELL_WATCH_LIMIT}銘柄）`);
    expect(result.current.S0.limit).toBeUndefined();
  });

  it('gates the climax checks by each stock\'s position (stockSells gets the view)', async () => {
    const { useWatchSellChecks } = await import('./useBriefData');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const row = { symbol: 'AAA', market: 'US', chart_path: 'AAA.json', current_price: payloads['AAA.json'].bars.at(-1).close, technical_audit: { valid: true } };
    const { result } = renderHook(() => useWatchSellChecks([{ symbol: 'AAA', state: 'wait', distance: -3, pivot: row.current_price * 1.03, row }], { version: 'v1', date: DATE }), { wrapper });
    await waitFor(() => expect(result.current.AAA).toBeTruthy());
    expect(result.current.AAA.strength.map(c => c.state)).toEqual(['na', 'na', 'na', 'na']);
    expect(result.current.AAA.strength[0].detail).toBe('ピボットより下（ブレイク前）のため判定しません');
  });
});

describe('watched symbols the publication does not list', () => {
  it('are kept with their own row once the bundle is in, never before', async () => {
    const { unlistedWatch } = await import('./useBriefData');
    const brief = rows => ({ bundle: { data: rows ? { rankings: { minervini: rows.map(symbol => ({ row: { symbol } })) } } : null } });
    expect(unlistedWatch(brief(['AAA', 'BBB']), ['AAA', 'QQQX', 'BBB', 'OLD'])).toEqual(['QQQX', 'OLD']);
    expect(unlistedWatch(brief(['AAA']), ['AAA'])).toEqual([]);
    // Before the bundle arrives nothing is known about any symbol: none is called unlisted.
    expect(unlistedWatch(brief(null), ['AAA', 'QQQX'])).toEqual([]);
  });
});

describe('certifying the bars against the published audit', () => {
  it('certifies bars whose close, day change and volume ratio are the published audit\'s, and refuses bars that drifted from it', async () => {
    const { certifyBars } = await import('./useBriefData');
    const { auditDailyBars } = await import('../qualificationAudit');
    const payload = payloads['BBB.json'], price = payload.bars.at(-1).close;
    const base = { symbol: 'BBB', market: 'US', current_price: price, technical_audit: { valid: true } };
    const published = auditDailyBars(base, payload, DATE);
    expect(published.valid).toBe(true);
    const row = values => ({ ...base, technical_audit: { ...published, values: { ...published.values, ...values } } });
    expect(certifyBars(row({}), payload, DATE)).toEqual({ certified: true, reason: null });
    // Within the screens' rounding (0.1% and 0.01×): the same reading.
    expect(certifyBars(row({ change: published.values.change + 0.04, volumeRatio: published.values.volumeRatio - 0.004 }), payload, DATE).certified).toBe(true);
    // A change, a ratio or a close the bars do not give: never certified, with the reason.
    for (const values of [{ change: published.values.change + 0.2 }, { volumeRatio: published.values.volumeRatio + 0.3 }, { close: price + 0.5 }]) {
      expect(certifyBars({ ...row(values), current_price: values.close ?? price }, payload, DATE)).toEqual({ certified: false, reason: values.close ? 'スキャン価格と日足終値が不一致' : '公開時の検証値（終値・前日比・出来高倍率）と日足が一致しません' });
    }
    // An audit that publishes no values (the rows read those as 未確認) is not compared.
    expect(certifyBars(base, payload, DATE).certified).toBe(true);
  });
});
