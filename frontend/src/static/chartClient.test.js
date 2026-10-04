import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchStaticChartPayload } from './chartClient';
import { fetchStaticJson } from './dataClient';

vi.mock('./dataClient', () => ({ fetchStaticJson: vi.fn() }));

const now = Date.parse('2026-10-01T12:00:00Z');
const observedAt = Date.parse('2026-09-30T12:00:00Z');
const expiresAt = observedAt + 7 * 86400000;
const provenRow = (value) => ({
  symbol: 'TEST', market: 'US', eps_growth_qq: value,
  financial_current: {
    v: 2, t: now, s: 'TEST', m: 'US', a: '2026-10-01', r: '0222222222222222',
    p: { 0: [value, '0', 'Diluted EPS', ['2026-06-30', '2026-03-31'], observedAt, expiresAt, value > 0 ? 'g' : value < 0 ? 'd' : 'u', 'r'] },
  },
});

describe('static chart payload boundary', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('masks raw financial fields in chart rows and fundamentals while retaining price and history', async () => {
    const historical = { symbol: 'TEST', quarterly: [{ end: '2026-06-30', eps: -1 }] };
    const payload = {
      symbol: 'TEST', market: 'US', as_of_date: '2026-10-01',
      bars: [{ date: '2026-10-01', close: 123 }],
      stock_data: { symbol: 'TEST', current_price: 123, eps_growth_qq: 55, eps_rating: 90, composite_score: 99, rating: 'Strong Buy', financial_history: historical },
      fundamentals: { symbol: 'TEST', eps_growth_qq: 88, eps_growth_quarterly: 88, eps_rating: 97, pe_ratio: 22 },
    };
    fetchStaticJson.mockResolvedValue(payload);

    const result = await fetchStaticChartPayload('charts/TEST.json', { now });

    expect(fetchStaticJson).toHaveBeenCalledWith('charts/TEST.json', { now, asOfDate: undefined, market: undefined });
    expect(result.stock_data).toMatchObject({ current_price: 123, eps_growth_qq: null, eps_rating: null, composite_score: null, rating: null });
    expect(result.fundamentals).toMatchObject({ eps_growth_qq: null, eps_growth_quarterly: null, eps_rating: null, pe_ratio: 22 });
    expect(result.bars).toBe(payload.bars);
    expect(result.stock_data.financial_history).toBe(historical);
    expect(payload.stock_data.eps_growth_qq).toBe(55);
    expect(payload.fundamentals.eps_growth_quarterly).toBe(88);
  });

  it('retains valid zero and negative values at one explicit clock and masks them after expiry', async () => {
    const payload = { symbol: 'TEST', market: 'US', as_of_date: '2026-10-01', stock_data: provenRow(-5), fundamentals: provenRow(0) };
    fetchStaticJson.mockResolvedValue(payload);

    const current = await fetchStaticChartPayload('charts/TEST.json', { now: expiresAt });
    expect(current.stock_data.eps_growth_qq).toBe(-5);
    expect(current.fundamentals.eps_growth_qq).toBe(0);
    expect(current.fundamentals.financial_current_state.evaluated_at).toBe(expiresAt);

    const expired = await fetchStaticChartPayload('charts/TEST.json', { now: expiresAt + 1 });
    expect(expired.stock_data.eps_growth_qq).toBeNull();
    expect(expired.fundamentals.eps_growth_qq).toBeNull();
    expect(payload.stock_data.eps_growth_qq).toBe(-5);
    expect(payload.fundamentals.eps_growth_qq).toBe(0);
  });

  it('never falls back to raw payload after an unavailable value or failed static read', async () => {
    const payload = { symbol: 'TEST', market: 'US', as_of_date: '2026-10-01', stock_data: provenRow(42) };
    fetchStaticJson.mockResolvedValue(payload);
    const expired = await fetchStaticChartPayload('charts/TEST.json', { now: expiresAt + 1 });
    fetchStaticJson.mockResolvedValue(expired);
    expect((await fetchStaticChartPayload('charts/TEST.json', { now })).stock_data.eps_growth_qq).toBeNull();

    fetchStaticJson.mockRejectedValue(new Error('static asset unavailable'));
    await expect(fetchStaticChartPayload('charts/TEST.json', { now })).rejects.toThrow('static asset unavailable');
  });

  it('uses the completion clock when a static read crosses the source expiry boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(expiresAt);
    let resolveRead;
    fetchStaticJson.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));
    const pending = fetchStaticChartPayload('charts/TEST.json');
    vi.setSystemTime(expiresAt + 1);
    resolveRead({ symbol: 'TEST', market: 'US', as_of_date: '2026-10-01', stock_data: provenRow(0) });

    const result = await pending;
    expect(result.stock_data.eps_growth_qq).toBeNull();
    expect(result.stock_data.financial_current_state.evaluated_at).toBe(expiresAt + 1);
  });
});
