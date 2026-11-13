import { describe, expect, it } from 'vitest';
import { LOW_RANGE_PERCENT, PRICE_ACTIVITY_SESSIONS, priceActivity } from './priceActivity.js';

// The exporter's inline computation before the move (tools/export-research.mjs at 8849bf9), kept verbatim as the
// reference the module must reproduce byte for byte (STEP 0 helper H2 is a pure move).
function exporterBefore(valid, bars) {
  const recent60 = valid ? bars.slice(-60) : [];
  const range60 = recent60.length === 60 ? (Math.max(...recent60.map(b=>b.high))/Math.min(...recent60.map(b=>b.low))-1)*100 : null;
  return {range60pct:range60,lowRange:range60 != null && range60 < 5};
}

const day = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const series = (n, fn) => Array.from({ length: n }, (_, i) => ({ date: day(i), ...fn(i) }));

describe('priceActivity (the exporter\'s price_activity, moved)', () => {
  it('keeps the constants the exporter used', () => {
    expect([PRICE_ACTIVITY_SESSIONS, LOW_RANGE_PERCENT]).toEqual([60, 5]);
  });

  const cases = {
    'a wide 60-session range': series(80, i => ({ high: 20 + i * 0.3, low: 19 + i * 0.3 })),
    'a narrow range (low activity)': series(70, i => ({ high: 50 + (i % 3) * 0.1, low: 49.5 })),
    'exactly 60 bars': series(60, i => ({ high: 10 + i, low: 9 + i })),
    'a range of exactly 5%': series(60, () => ({ high: 105, low: 100 })),
    'fewer than 60 bars': series(59, i => ({ high: 10 + i, low: 9 })),
    'no bars': [],
    'a missing high in the window': series(65, i => ({ high: i === 64 ? undefined : 30, low: 29 })),
  };
  for (const [name, bars] of Object.entries(cases)) {
    it(`gives the exporter's bytes for ${name}`, () => {
      expect(JSON.stringify(priceActivity(bars))).toBe(JSON.stringify(exporterBefore(true, bars)));
    });
  }

  it('gives the exporter\'s bytes for bars the audit refused (null)', () => {
    expect(JSON.stringify(priceActivity(null))).toBe(JSON.stringify(exporterBefore(false, [])));
    expect(priceActivity(null)).toEqual({ range60pct: null, lowRange: false });
  });

  it('never calls a missing range low activity', () => {
    expect(priceActivity(series(10, () => ({ high: 1, low: 1 }))).lowRange).toBe(false);
    expect(priceActivity(undefined).lowRange).toBe(false);
  });
});
