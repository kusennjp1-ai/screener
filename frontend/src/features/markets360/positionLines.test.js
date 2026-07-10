import { describe, expect, it } from 'vitest';

import { positionPriceLines, symbolPositionLines } from './positionLines';

describe('positionPriceLines', () => {
  it('returns [] without a matching open position', () => {
    expect(positionPriceLines(undefined)).toEqual([]);
    expect(positionPriceLines({ status: 'closed', entry_price: 100 })).toEqual([]);
    expect(positionPriceLines({ status: 'open', entry_price: null })).toEqual([]);
  });

  it('draws the entry line plus a red dashed initial stop', () => {
    const lines = positionPriceLines({
      status: 'open', entry_price: 100, initial_stop: 92, sell_plan: null,
    });
    expect(lines).toEqual([
      { id: 'position-entry-0', price: 100, color: '#3aa0ff', dashed: false, title: 'Entry 100.00' },
      { id: 'position-stop-0', price: 92, color: '#f23645', dashed: true, title: 'Stop 92.00' },
    ]);
  });

  it('symbolPositionLines stacks every open position, oldest entry first and numbered', () => {
    const positions = [
      { symbol: 'FTNT', status: 'open', entry_date: '2026-07-07', entry_price: 149.67, initial_stop: 134.7, sell_plan: null },
      { symbol: 'FTNT', status: 'open', entry_date: '2026-06-01', entry_price: 110, initial_stop: 101.2, sell_plan: { trailing: { stop: 128.87, raised: true } } },
      { symbol: 'MSFT', status: 'open', entry_date: '2026-01-15', entry_price: 320, initial_stop: 294.4, sell_plan: null },
      { symbol: 'FTNT', status: 'closed', entry_date: '2026-05-01', entry_price: 90, initial_stop: 84, sell_plan: null },
    ];
    const lines = symbolPositionLines(positions, 'FTNT');
    expect(lines.map((l) => l.title)).toEqual([
      'Entry #1 110.00', 'Stop #1 128.87 ↑', 'Entry #2 149.67', 'Stop #2 134.70',
    ]);
    expect(lines[1].color).toBe('#22ab94'); // raised ladder stop stays green
    // Single-position symbols keep the unnumbered labels.
    expect(symbolPositionLines(positions, 'MSFT').map((l) => l.title)).toEqual([
      'Entry 320.00', 'Stop 294.40',
    ]);
    expect(symbolPositionLines(positions, 'ZZZZ')).toEqual([]);
  });

  it('prefers the ladder stop and turns green once raised', () => {
    const lines = positionPriceLines({
      status: 'open',
      entry_price: 110,
      initial_stop: 101.2,
      sell_plan: { trailing: { stop: 128.87, raised: true } },
    });
    expect(lines[1]).toEqual({
      id: 'position-stop-0', price: 128.87, color: '#22ab94', dashed: true, title: 'Stop 128.87 ↑',
    });
  });

  it('omits the stop line when the position has no stop at all', () => {
    const lines = positionPriceLines({ status: 'open', entry_price: 100, initial_stop: null });
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe('position-entry-0');
  });
});
