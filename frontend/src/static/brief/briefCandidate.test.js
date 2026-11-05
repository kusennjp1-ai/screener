import { describe, expect, it } from 'vitest';
import { briefOrder, breakoutEvent, candidateMarketGate, candidateView, EARNINGS_WARN_DAYS, earningsSoon, focusCandidates, focusCounts, focusHeadingNote, focusTone, pivotCrossing, POSITION_NAMES, rsShown, ruleEvidence, matchesSearch, trendTemplate, watchEvent, LIST_FILTERS, LIST_SORTS } from './briefCandidate';
import { withAuditFixture } from '../testAuditFixture';

const view = (over = {}) => ({ symbol: 'AAA', state: 'zone', distance: 1, volumeRatio: 1.2, rs: 80, passed: 9, pivot: 100, price: 101, qualified: true, ...over });

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

  it('describes watch changes and calls a breakout only from the verified up day with 1.4x volume', () => {
    // A verified day: the close crossed the pivot (100) from a previous close of 99.02.
    const crossing = over => view({ close: 101, prevClose: 101 / 1.02, change: 2, ...over });
    expect(watchEvent(crossing({ volumeRatio: 1.4 }))).toEqual({ kind: 'breakout', tone: 'zone', title: '本日ピボットを出来高1.40×で上抜け' });
    expect(watchEvent(crossing({ volumeRatio: 1.39 })).kind).toBe('zone');
    expect(watchEvent(crossing({ volumeRatio: null })).kind).toBe('zone');
    // No verified day change: nothing is said about a breakout, whatever the volume.
    expect(watchEvent(view({ volumeRatio: 1.6 }))).toEqual({ kind: 'zone', tone: 'zone', title: '買いゾーン内' });
    expect(watchEvent(view({ state: 'wait', distance: -3.25 })).title).toBe('ピボット接近（あと3.3%）');
    expect(watchEvent(view({ state: 'ext', distance: 8 })).tone).toBe('ext');
    expect(watchEvent(view({ state: 'wait', distance: -9 }))).toEqual({ kind: 'base', tone: 'neutral', title: '土台形成中' });
  });

  it('keeps a watched stock that is not a buy candidate neutral, with the reason', () => {
    expect(watchEvent(view({ qualified: false, failed: 1, unknown: 0, stateLabel: '買いゾーン', close: 101, prevClose: 99, change: 2, volumeRatio: 2 }))).toEqual({ kind: 'unqualified', tone: 'neutral', title: '買いゾーン（TT未達）' });
    expect(watchEvent(view({ qualified: false, failed: 0, unknown: 2, stateLabel: 'ピボット接近' })).title).toBe('ピボット接近（TT未確認）');
    expect(watchEvent(view({ qualified: false, failed: 0, unknown: 0, stateLabel: '買いゾーン' })).title).toBe('買いゾーン（選定対象外）');
  });
});

const DATE = '2026-10-02';
/** A research row whose daily bars the publisher verified for DATE (the synthetic audit), with its own day change and volume. */
const audited = (symbol, { price = 100, pivot = 100, change = 2, volume = 1.6, rs = 90, ...extra } = {}) => {
  const row = withAuditFixture({ symbol, market: 'US', currency: 'USD', company_name: symbol, current_price: price, se_pivot_price: pivot, rs_rating: rs, ...extra }, DATE);
  Object.assign(row.technical_audit.values, { change, volumeRatio: volume });
  return row;
};
const verdict = (row, assessment = { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 }) => candidateView({ row, assessment }, DATE);

describe('the analysis day as an event (verified change and volume only)', () => {
  it('(a) a close crossing the pivot from below on a +2% day with 1.6× volume is today\'s breakout', () => {
    const v = verdict(audited('A', { price: 101, change: 2, volume: 1.6 }));
    expect([v.change, v.prevClose < 100, v.close]).toEqual([2, true, 101]);
    expect(breakoutEvent(v)).toEqual({ kind: 'breakout', tone: 'zone', title: '本日ピボットを出来高1.60×で上抜け' });
  });
  it('(b) a zone day that fell 1% on 1.6× volume is no breakout but a warning (ext tone)', () => {
    expect(breakoutEvent(verdict(audited('B', { price: 101, change: -1, volume: 1.6 })))).toEqual({ kind: 'heavyDown', tone: 'ext', title: '下落日の大商い 1.60×（要注意）' });
  });
  it('(c) already above the pivot the day before: in the zone after the breakout, never 「本日上抜け」', () => {
    const event = breakoutEvent(verdict(audited('C', { price: 102, change: 1, volume: 2 })));
    expect(event).toMatchObject({ kind: 'after', tone: 'zone', title: '買いゾーン内（上抜け後）' });
    expect(event.title).not.toContain('本日');
  });
  it('(d) a close exactly at the pivot reads ピボット到達', () => {
    expect(breakoutEvent(verdict(audited('D', { price: 100, change: 2, volume: 1.6 })))).toEqual({ kind: 'touch', tone: 'zone', title: 'ピボット到達' });
  });
  it('a crossing without 1.4× volume says so, and an unknown volume stays unknown', () => {
    expect(breakoutEvent(verdict(audited('T', { price: 101, change: 2, volume: 1.2 }))).title).toBe('本日ピボットを上抜け（出来高1.20×・1.4×未満）');
    expect(breakoutEvent(verdict(audited('U', { price: 101, change: 2, volume: null }))).title).toBe('本日ピボットを上抜け（出来高 未確認）');
  });
  it('(e) without the verified audit of the analysis day the change is unknown, never 0%, and nothing is said about a breakout', () => {
    const missing = audited('E', { price: 101, price_change_1d: 5 });
    delete missing.technical_audit;
    const stale = audited('F', { price: 101 });
    stale.technical_audit.as_of_date = '2026-10-01';
    for (const row of [missing, stale]) {
      const v = verdict(row);
      expect([v.change, v.prevClose, v.close, v.fromSma50]).toEqual([null, null, null, null]);
      expect(breakoutEvent(v)).toBeNull();
    }
    // price_change_1d is never the source.
    expect(verdict(audited('G', { price: 101, change: 2, price_change_1d: 9 })).change).toBe(2);
  });
  it('dates a crossing 1 to 3 sessions back from certified bars, and nothing older or broken', () => {
    const bars = closes => closes.map((close, i) => ({ date: `2026-09-${String(20 + i).padStart(2, '0')}`, close }));
    expect(pivotCrossing(bars([98, 99, 101, 102, 103]), 100)).toEqual({ date: '2026-09-22', sessionsAgo: 2 });
    expect(pivotCrossing(bars([98, 101, 102, 103, 104, 105]), 100)).toBeNull();
    expect(pivotCrossing(bars([98, 99, 101, 99, 102]), 100)).toBeNull();
    expect(pivotCrossing(bars([98, 99, 101, null, 102]), 100)).toBeNull();
    expect(pivotCrossing(null, 100)).toBeNull();
    const v = verdict(audited('H', { price: 103, change: 1 }));
    expect(breakoutEvent(v, bars([98, 99, 101, 102, 103])).title).toBe('買いゾーン内（9/22に上抜け・2営業日前）');
  });
  it('gives the conclusion the distance from the 50-day line from the verified audit', () => {
    expect(verdict(audited('S', { price: 100 })).fromSma50).toBeCloseTo(100 / 90 * 100 - 100, 6);
  });
});

describe('position names, RS and earnings, the same on every screen', () => {
  it('names the four positions from one table and splits ピボット待ち for display only', () => {
    expect(POSITION_NAMES).toEqual({ zone: '買いゾーン', near: 'ピボット接近', base: '土台形成中', ext: '買いゾーン超過' });
    const at = price => verdict(audited('P', { price, pivot: 100 }));
    expect([at(101), at(97), at(90), at(106)].map(v => [v.state, v.position, v.stateLabel])).toEqual([
      ['zone', 'zone', '買いゾーン'], ['wait', 'near', 'ピボット接近'], ['wait', 'base', '土台形成中'], ['ext', 'ext', '買いゾーン超過']]);
    // The filters still count wait as before: the split is a label.
    expect(LIST_FILTERS.near.test(at(97))).toBe(true);
    expect(LIST_FILTERS.near.test(at(90))).toBe(false);
  });
  it('says where a pivot more than 25% away was, never 「ベース崩れ」', () => {
    const above = verdict(audited('X', { price: 132, pivot: 100 })), below = verdict(audited('Y', { price: 70, pivot: 100 }));
    expect([above.state, above.position, above.pivot, above.distance]).toEqual(['na', 'staleAbove', null, null]);
    expect(above.stale).toMatchObject({ above: true, short: '旧ピボットから +32%・有効な買い水準なし', text: '旧ピボットから +32%・有効な買い水準なし（新しいベース待ち）' });
    expect(above.stateLabel).toBe('旧ピボットから +32%・有効な買い水準なし');
    expect(below.stale).toMatchObject({ above: false, text: '旧ピボットから −30%・有効な買い水準なし（ベース再形成待ち）' });
    expect(watchEvent(above)).toMatchObject({ kind: 'stale', tone: 'ext' });
    expect(watchEvent(below)).toMatchObject({ kind: 'stale', tone: 'neutral' });
    for (const v of [above, below]) expect(JSON.stringify(v.stale)).not.toContain('ベース崩れ');
  });
  it('shows an RS estimate as the whole number below it (69.9 reads 69), while thresholds and sorting keep the raw value', () => {
    expect([rsShown(69.9), rsShown(97.01283880171184), rsShown(70), rsShown(null)]).toEqual(['69', '97', '70', '未確認']);
    const sorted = [view({ symbol: 'LOW', rs: 69.9 }), view({ symbol: 'HIGH', rs: 69.95 })].sort(LIST_SORTS.rs.compare);
    expect(sorted.map(v => v.symbol)).toEqual(['HIGH', 'LOW']);
    const template = trendTemplate(audited('R', { rs: 69.9 }));
    const rs = template.rules.find(rule => rule.label.startsWith('RS 推計'));
    expect(rs.state).toBe('fail');
    expect(ruleEvidence(rs)).toBe('RS推計 69（1000銘柄中・2026-10-02・独自推計・IBDの公式値ではない）');
    const unknown = trendTemplate({ ...audited('Q'), rs_universe_size: undefined, rs_as_of_date: null }).rules.find(rule => rule.label.startsWith('RS 推計'));
    expect(ruleEvidence(unknown)).toBe('RS推計 未確認（母集団 未確認・基準日 未確認・独自推計・IBDの公式値ではない）');
  });
  it('uses one earnings constant: 10 calendar days or nearer warns, an unknown date never does', () => {
    expect(EARNINGS_WARN_DAYS).toBe(10);
    expect(earningsSoon({ earnings: { date: '2026-10-12', days: 10 } })).toBe(true);
    expect(earningsSoon({ earnings: { date: '2026-10-13', days: 11 } })).toBe(false);
    expect(earningsSoon({ earnings: null })).toBe(false);
    expect(verdict(audited('N', { entry_evidence: { earnings: { date: '2026-10-05' } } })).earnings).toEqual({ date: '2026-10-05', days: 3 });
  });
  it('names the one unmet rule of an あと1条件 row with its value', () => {
    const v = verdict(audited('ONE', { rs: 61.7 }), { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 });
    expect(v.missing).toEqual({ text: '未達：RS ≥ 70（61）', rs: true });
    const high = verdict(audited('HIGH', { rs: 80 }), { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 });
    expect(high.missing).toBeNull();
    const sma = audited('SMA', { rs: 80 });
    sma.technical_audit.values.sma50 = 120;
    expect(verdict(sma, { qualified: false, passed: 7, failed: 1, unknown: 0, total: 9 }).missing).toEqual({ text: '未達：株価 > SMA50', rs: false });
    // Only those rows pay for the rule evaluation; a qualified or several-short row has none.
    expect(verdict(audited('OK')).missing).toBeNull();
    expect(verdict(audited('TWO', { rs: 61 }), { qualified: false, passed: 7, failed: 2, unknown: 0, total: 9 }).missing).toBeNull();
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
  // prepared.market as modelMarket returns it: a known state carries a label and a cap, an unknown one state 'unknown'.
  const OPEN = [{ label: '上昇トレンド（独自判定）', cap: 0.5 }, { label: '上昇に圧力（独自判定）', cap: 0.25 }];
  const HOLD = [{ label: '50日線割れ（弱含み・独自判定）', cap: 0 }, { label: '長期トレンド警戒', cap: 0 }, { label: '新規購入を抑制', cap: 0 }];
  const UNKNOWN = [{ label: '市場未確認', cap: 0, state: 'unknown' }, { label: '市場条件未確認', cap: 0, state: 'unknown' }];
  it('reads the market verdict as open, hold or unknown, and says nothing before it exists', () => {
    expect([...OPEN, ...HOLD, ...UNKNOWN, null, undefined].map(candidateMarketGate)).toEqual(['open', 'open', 'hold', 'hold', 'hold', 'unknown', 'unknown', null, null]);
  });
  it('focusTone is zone only for a ready bundle with focus candidates while the market is open to new buying', () => {
    for (const market of OPEN) expect(focusTone('ready', { zone: 1, near: 2, total: 3 }, market)).toBe('zone');
    for (const market of [...HOLD, ...UNKNOWN, null]) expect(focusTone('ready', { zone: 1, near: 2, total: 3 }, market)).toBe('');
    for (const market of [...OPEN, ...HOLD, null]) {
      expect(focusTone('ready', { zone: 0, near: 0, total: 0 }, market)).toBe('');
      for (const state of ['loading', 'error', 'none']) expect(focusTone(state, { zone: 1, near: 0, total: 1 }, market)).toBe('');
      expect(focusTone('ready', null, market)).toBe('');
    }
  });
  it('focusHeadingNote says to hold off under a cap of 0, 未確認 for an unknown market (never 控える), and nothing otherwise', () => {
    for (const market of HOLD) expect(focusHeadingNote(market)).toBe('（地合い：買いは控える・監視のみ）');
    for (const market of UNKNOWN) expect(focusHeadingNote(market)).toBe('（地合い未確認）');
    // Open, or not loaded yet: nothing, so nothing flashes while the market loads.
    for (const market of [...OPEN, null, undefined]) expect(focusHeadingNote(market)).toBeNull();
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

// Wording and tone only: the selection, the thresholds and the order stay as they were (a snapshot of the
// focus pool, the order and every filter's count over a mixed set of rows).
describe('selection and order are unchanged by the round-1 wording', () => {
  const pass = { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 };
  const one = { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 };
  const ranked = [
    ['Z1', 100, 100, 95, pass], ['Z2', 104, 100, 80, pass], ['Z3', 101, 100, 88, one], ['N1', 99, 100, 91, pass], ['N2', 95.5, 100, 99, pass],
    ['B1', 90, 100, 97, pass], ['E1', 108, 100, 99, pass], ['S1', 140, 100, 99, pass], ['N3', 97, 100, 61, one], ['U1', 101, 100, 70, { ...pass, qualified: false, failed: 0, unknown: 2, passed: 7 }],
  ].map(([symbol, price, pivot, rs, assessment]) => ({ row: audited(symbol, { price, pivot, rs }), assessment }));
  it('keeps the focus pool, its counts, the order and the filter counts', () => {
    expect(focusCandidates(ranked, DATE).map(v => v.symbol)).toEqual(['Z1', 'Z2', 'N2', 'N1']);
    expect(focusCounts(ranked, DATE)).toEqual({ zone: 2, near: 2, total: 4 });
    const views = ranked.map(item => candidateView(item, DATE));
    expect(views.slice().sort(briefOrder).map(v => v.symbol)).toEqual(['Z1', 'Z2', 'Z3', 'U1', 'N2', 'N1', 'N3', 'B1', 'E1', 'S1']);
    expect(Object.fromEntries(Object.entries(LIST_FILTERS).map(([key, filter]) => [key, views.filter(filter.test).map(v => v.symbol)]))).toEqual({
      zone: ['Z1', 'Z2'], near: ['N1', 'N2'], all: ['Z1', 'Z2', 'N1', 'N2', 'B1', 'E1', 'S1'], one: ['Z3', 'N3'], focus: ['Z1', 'Z2', 'N1', 'N2'] });
  });
});
