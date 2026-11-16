import { describe, expect, it } from 'vitest';
import { decodeResearchIndex, encodeResearchIndex, researchListRow } from '../researchTransport';
import { crossingFloor } from './breakoutHistory';

// Round 3 R1, rule 18 (UI before data): the research index's new list field `se_pivot_date` (export-research.mjs listFields)
// goes through the generic, frozen transport unchanged, and the floor it feeds reads the same on the decoded row. An index
// without the field (every older publication) decodes without it and leaves the floor null (unbounded, as before R1).
const DATE = '2026-10-02';
const day = i => new Date(Date.UTC(2026, 6, 1) + i * 86400000).toISOString().slice(0, 10);
const bars = Array.from({ length: 70 }, (_, i) => ({ date: day(i), close: 95, high: i === 66 ? 100 : 95.5, low: 94.5, volume: 10000 }));
const row = (symbol, extra) => ({ symbol, market: 'US', currency: 'USD', current_price: 95, se_pivot_price: 100, se_pattern_primary: 'nr7_inside_day', ...extra });

describe('se_pivot_date through the research index (rule 18)', () => {
  it('encodes and decodes as published: a date, null and absent each come back as they went in', () => {
    const rows = [row('AAA', { se_pivot_date: day(66) }), row('BBB', { se_pivot_date: null }), row('CCC', {}),
      row('DDD', { se_pivot_date: '2026-09-25', se_pattern_primary: 'cup_with_handle' }), row('EEE', { se_pivot_date: null, se_pattern_primary: 'vcp' })];
    const decoded = decodeResearchIndex(encodeResearchIndex({ as_of_date: DATE, rows }));
    expect(decoded.rows).toEqual(rows.map(researchListRow));
    const by = Object.fromEntries(decoded.rows.map(item => [item.symbol, item]));
    expect([by.AAA.se_pivot_date, by.BBB.se_pivot_date, by.DDD.se_pivot_date, by.EEE.se_pivot_date]).toEqual([day(66), null, '2026-09-25', null]);
    expect(Object.hasOwn(by.CCC, 'se_pivot_date')).toBe(false);
    // The floor on the decoded row is the original row's: the pivot's own bar with the field, none without it.
    for (const item of rows) expect(crossingFloor(bars, by[item.symbol])).toBe(crossingFloor(bars, item));
    expect(crossingFloor(bars, by.AAA)).toBe(66);
    for (const symbol of ['BBB', 'CCC', 'DDD', 'EEE']) expect(crossingFloor(bars, by[symbol])).toBeNull();
  });
});
