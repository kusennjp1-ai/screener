import { describe, expect, it } from 'vitest';
import { briefOrder, candidateView, focusCandidates, focusCounts, focusHeadingNote, focusTone, ruleEvidence, matchesSearch, watchEvent, LIST_FILTERS, LIST_SORTS } from './briefCandidate';

const view = (over = {}) => ({ symbol: 'AAA', state: 'zone', distance: 1, volumeRatio: 1.2, rs: 80, passed: 9, pivot: 100, price: 101, ...over });

describe('brief model', () => {
  it('shows the 52-week distances behind the trend-template rules and keeps unknowns blank', () => {
    expect(ruleEvidence({ label: '52週安値から ≥ 30%（日中安値）', value: 45.24, unit: '%' })).toBe('52週安値から +45.2%');
    expect(ruleEvidence({ label: '52週高値からの距離 ≤ 25%（日中高値）', value: 8.31, unit: '%' })).toBe('52週高値から −8.3%');
    expect(ruleEvidence({ label: '52週高値からの距離 ≤ 25%（日中高値）', value: 0, unit: '%' })).toBe('52週高値と同値');
    expect(ruleEvidence({ label: '52週安値から ≥ 30%（日中安値）', value: null, unit: '%' })).toBe('');
    expect(ruleEvidence({ label: 'RS 推計 ≥ 70', value: 88, unit: '', evidence: '1000銘柄' })).toBe('1000銘柄');
  });

  it('orders the buy zone first, then within 5% below the pivot, then further below, then extended', () => {
    const items = [view({ symbol: 'EXT', state: 'ext', distance: 7 }), view({ symbol: 'FAR', state: 'wait', distance: -9 }), view({ symbol: 'NEAR', state: 'wait', distance: -2 }), view({ symbol: 'ZONE' })];
    expect(items.sort(briefOrder).map(v => v.symbol)).toEqual(['ZONE', 'NEAR', 'FAR', 'EXT']);
    expect(LIST_FILTERS.near.test(view({ qualified: true, state: 'wait', distance: -4.9 }))).toBe(true);
    expect(LIST_FILTERS.near.test(view({ qualified: true, state: 'wait', distance: null }))).toBe(false);
    expect(LIST_FILTERS.near.test(view({ qualified: false, state: 'wait', distance: -1 }))).toBe(false);
    expect(LIST_FILTERS.one.test(view({ qualified: false, failed: 1, unknown: 0 }))).toBe(true);
    expect(LIST_FILTERS.one.test(view({ qualified: false, failed: 1, unknown: 1 }))).toBe(false);
    expect(matchesSearch(view({ symbol: 'NVLX', name: 'Novalux' }), 'nova')).toBe(true);
    expect(matchesSearch(view({ symbol: 'NVLX', name: 'Novalux' }), 'zz')).toBe(false);
    const byHigh = [view({ symbol: 'UNK', fromHigh: null }), view({ symbol: 'FAR', fromHigh: 18 }), view({ symbol: 'TOP', fromHigh: 0 })].sort(LIST_SORTS.high.compare);
    expect(byHigh.map(v => v.symbol)).toEqual(['TOP', 'FAR', 'UNK']);
  });

  it('describes watch changes and needs 1.4x volume to call a breakout', () => {
    expect(watchEvent(view({ volumeRatio: 1.4 })).kind).toBe('breakout');
    expect(watchEvent(view({ volumeRatio: 1.39 })).kind).toBe('zone');
    expect(watchEvent(view({ volumeRatio: null })).kind).toBe('zone');
    expect(watchEvent(view({ state: 'wait', distance: -3.25 })).title).toBe('ピボットまで あと3.3%');
    expect(watchEvent(view({ state: 'ext', distance: 8 })).tone).toBe('ext');
  });
});

describe('Today\'s focus counts', () => {
  // A row's state and pivot distance come from its price against its pivot (100).
  const item = (symbol, price, qualified = true) => ({ row: { symbol, current_price: price, se_pivot_price: 100 }, assessment: { qualified, passed: qualified ? 8 : 7, failed: qualified ? 0 : 1, unknown: 0, total: 8 } });
  const ranked = [
    item('ZON1', 100), item('ZON2', 102), // qualified, in the buy zone
    item('NEA1', 99.5), item('NEA2', 97), item('NEA3', 95.0000001), // qualified, waiting −0.5 / −3 / −5 (the boundary)
    item('FAR1', 93), // qualified, waiting −7: not near
    item('UNQ1', 101, false), // in the zone but not qualified
    item('EXT1', 107), // qualified, extended
  ];
  it('counts the whole focus pool, not the shown slice', () => {
    expect(focusCounts(ranked, '2026-10-02')).toEqual({ zone: 2, near: 3, total: 5 });
    expect(focusCandidates(ranked, '2026-10-02', 2)).toHaveLength(2);
    expect(focusCandidates(ranked, '2026-10-02', 5).length).toBeLessThanOrEqual(focusCounts(ranked, '2026-10-02').total);
    expect(focusCandidates(ranked, '2026-10-02', 5).map(view => view.symbol).sort()).toEqual(['NEA1', 'NEA2', 'NEA3', 'ZON1', 'ZON2']);
  });
  it('agrees with the list\'s zone and near filters over the same rows', () => {
    const views = ranked.map(entry => candidateView(entry, '2026-10-02'));
    const { zone, near } = focusCounts(ranked, '2026-10-02');
    expect(zone).toBe(views.filter(LIST_FILTERS.zone.test).length);
    expect(near).toBe(views.filter(LIST_FILTERS.near.test).length);
  });
  it('is all zero without rows', () => {
    expect(focusCounts([], '2026-10-02')).toEqual({ zone: 0, near: 0, total: 0 });
    expect(focusCounts(undefined, '2026-10-02')).toEqual({ zone: 0, near: 0, total: 0 });
  });
});

// Step-0 seams D owns and E calls (Today's tile and heading, the list's segment).
describe('briefCandidate seams', () => {
  const markets = [null, { cap: 0.5, state: 'confirmed_uptrend' }, { cap: 0, state: 'correction' }, { state: 'unknown' }];
  it('focusTone is zone only for a ready bundle with focus candidates, whatever the market', () => {
    for (const market of markets) {
      expect(focusTone('ready', { zone: 1, near: 2, total: 3 }, market)).toBe('zone');
      expect(focusTone('ready', { zone: 0, near: 0, total: 0 }, market)).toBe('');
      for (const state of ['loading', 'error', 'none']) expect(focusTone(state, { zone: 1, near: 0, total: 1 }, market)).toBe('');
      expect(focusTone('ready', null, market)).toBe('');
    }
  });
  it('focusHeadingNote says nothing yet', () => {
    for (const market of markets) expect(focusHeadingNote(market)).toBeNull();
  });
  it('LIST_FILTERS.focus is the zone and near filters together, hidden from the segment', () => {
    expect(LIST_FILTERS.focus).toMatchObject({ label: '注目候補', hidden: true });
    // The segment shows exactly the four filters it showed before the seam.
    expect(Object.entries(LIST_FILTERS).filter(([, value]) => !value.hidden).map(([key]) => key)).toEqual(['zone', 'near', 'all', 'one']);
    const views = [];
    for (const qualified of [true, false]) for (const [state, distance] of [['zone', 0], ['zone', 4.9], ['wait', -0.5], ['wait', -5], ['wait', -5.01], ['wait', null], ['ext', 6], ['low', null], ['na', null]]) views.push(view({ qualified, state, distance, failed: qualified ? 0 : 1, unknown: 0 }));
    for (const v of views) expect([v.state, v.distance, v.qualified, LIST_FILTERS.focus.test(v)]).toEqual([v.state, v.distance, v.qualified, LIST_FILTERS.zone.test(v) || LIST_FILTERS.near.test(v)]);
    expect(views.filter(LIST_FILTERS.focus.test).length).toBeGreaterThan(0);
  });
});
