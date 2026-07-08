import { describe, expect, it } from 'vitest';

import { positionPriceLines } from './positionLines';

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
      { id: 'position-entry', price: 100, color: '#3aa0ff', dashed: false, title: 'Entry 100.00' },
      { id: 'position-stop', price: 92, color: '#f23645', dashed: true, title: 'Stop 92.00' },
    ]);
  });

  it('prefers the ladder stop and turns green once raised', () => {
    const lines = positionPriceLines({
      status: 'open',
      entry_price: 110,
      initial_stop: 101.2,
      sell_plan: { trailing: { stop: 128.87, raised: true } },
    });
    expect(lines[1]).toEqual({
      id: 'position-stop', price: 128.87, color: '#22ab94', dashed: true, title: 'Stop 128.87 ↑',
    });
  });

  it('omits the stop line when the position has no stop at all', () => {
    const lines = positionPriceLines({ status: 'open', entry_price: 100, initial_stop: null });
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe('position-entry');
  });
});
