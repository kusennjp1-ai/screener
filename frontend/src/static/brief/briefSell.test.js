import { describe, expect, it } from 'vitest';

describe('sell signals', () => {
  const day = i => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  const make = closes => closes.map((close, i) => ({ date: day(i), open: close, high: close * 1.005, low: close * 0.995, close, volume: 10000 }));
  const rising = (count, rate = 0.003) => Array.from({ length: count }, (_, i) => 50 * (1 + rate) ** i);

  it('flags a climax run after an advance and reports each check with its evidence', async () => {
    const { sellSignals } = await import('./briefSell');
    const closes = rising(200);
    for (let k = 0; k < 9; k++) closes.push(closes.at(-1) * 1.03);
    closes.push(closes.at(-1) * 1.05);
    const result = sellSignals(make(closes));
    const state = Object.fromEntries(result.strength.map(c => [c.key, c.state]));
    expect(state).toEqual({ 'day-up': 'hit', 'week-up': 'hit', 'up-days': 'hit', climax: 'hit' });
    expect(result.weakness.map(c => c.state)).toEqual(['clear', 'clear']);
    expect(result.hits).toBe(4);
    expect(result.advance.gainPct).toBeGreaterThan(30);
    const { sellMarks } = await import('./briefSell');
    expect(sellMarks(result)).toEqual([{ date: result.strength[0].date, kind: 'strength' }]);
    expect(sellMarks(null)).toEqual([]);
  });

  it('flags a heavy-volume break of the 50-day line, and leaves it unknown without volume', async () => {
    const { sellSignals } = await import('./briefSell');
    const closes = rising(200);
    closes.push(closes.at(-1) * 0.9);
    const bars = make(closes);
    bars.at(-1).volume = 20000;
    const result = sellSignals(bars);
    expect(result.weakness.map(c => [c.key, c.state])).toEqual([['day-down', 'hit'], ['ma50', 'hit']]);
    expect(result.weakness[1].detail).toContain('2.00×');
    bars.at(-1).volume = 13000;
    expect(sellSignals(bars).weakness[1].state).toBe('clear');
    bars.at(-1).volume = undefined;
    expect(sellSignals(bars).weakness[1].state).toBe('unknown');
  });

  it('judges a heavy-volume 50-day break on short histories too', async () => {
    const { sellSignals } = await import('./briefSell');
    const closes = rising(98);
    closes.push(closes.at(-1) * 0.9, closes.at(-1) * 0.9, closes.at(-1) * 0.9);
    const bars = make(closes);
    bars.at(-3).volume = 30000;
    expect(bars).toHaveLength(101);
    expect(sellSignals(bars).weakness.find(c => c.key === 'ma50').state).toBe('hit');
  });

  it('does not judge strength without an advance and refuses short or broken bars', async () => {
    const { sellSignals } = await import('./briefSell');
    const flat = make(Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 4)));
    const result = sellSignals(flat);
    expect(result.advance).toBeNull();
    expect(result.strength.every(c => c.state === 'na')).toBe(true);
    expect(sellSignals(make(rising(59)))).toBeNull();
    const broken = make(rising(120)); broken[50].close = null;
    expect(sellSignals(broken)).toBeNull();
  });
});

describe('book combined warning', () => {
  it('maps the shared diagnostics to a check and never turns a missing input into clear', async () => {
    const { bookWarningCheck, withBookWarning } = await import('./briefSell');
    const warn = over => ({ valid: true, priceWarnings: { below20: true, threeLowerLows: true, currentVolumeRatio: 1.6, combinedWarning: true, recoveryInUpperHalf: false, ...over } });
    expect(bookWarningCheck(warn()).state).toBe('hit');
    expect(bookWarningCheck(warn()).detail).toBe('20日線割れ・3日連続の安値切り下げ あり・出来高 1.60×');
    expect(bookWarningCheck(warn({ recoveryInUpperHalf: true })).detail).toContain('買い支え');
    expect(bookWarningCheck(warn({ combinedWarning: false, threeLowerLows: false })).state).toBe('clear');
    expect(bookWarningCheck(warn({ combinedWarning: null, currentVolumeRatio: null })).state).toBe('unknown');
    expect(bookWarningCheck({ valid: false }).state).toBe('unknown');
    expect(bookWarningCheck(null).state).toBe('unknown');
    const merged = withBookWarning({ strength: [], weakness: [{ key: 'ma50', state: 'clear' }], hits: 0 }, warn());
    expect(merged.weakness.map(c => c.key)).toEqual(['ma50', 'book']);
    expect(merged.hits).toBe(1);
    expect(withBookWarning(null, warn())).toBeNull();
  });
});
