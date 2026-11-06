import { describe, expect, it } from 'vitest';
import { BASE_DEPTH_MAX_PERCENT, BASE_LENGTH_MIN_WEEKS, briefOrder, breakoutEvent, candidateMarketGate, candidateView, EARNINGS_WARN_DAYS, earningsCall, earningsSoon, EPS_YOY_FILTER_PERCENT, EXTENDED_FROM_SMA50_PERCENT, filterCounts, filterLabel, focusCandidates, focusCounts, focusHeadingNote, focusTone, memoCandidateView, POSITION_NAMES, positionText, ratioShown, rowEvent, rsShown, ruleEvidence, matchesSearch, setupPatternName, templateChip, trendTemplate, watchEvent, LIST_FILTERS, LIST_SORTS } from './briefCandidate';
import { withAuditFixture } from '../testAuditFixture';

const view = (over = {}) => ({ symbol: 'AAA', state: 'zone', position: 'zone', stateLabel: '買いゾーン', distance: 1, volumeRatio: 1.2, rs: 80, passed: 9, pivot: 100, price: 101, qualified: true, ...over });

describe('brief model', () => {
  it('shows the 52-week distances behind the trend-template rules and keeps unknowns blank', () => {
    expect(ruleEvidence({ label: '52週安値から ≥ 30%（日中安値）', value: 45.24, unit: '%' })).toBe('52週安値から +45.2%');
    expect(ruleEvidence({ label: '52週高値からの距離 ≤ 25%（日中高値）', value: 8.31, unit: '%' })).toBe('52週高値から −8.3%');
    expect(ruleEvidence({ label: '52週高値からの距離 ≤ 25%（日中高値）', value: 0, unit: '%' })).toBe('52週高値と同値');
    expect(ruleEvidence({ label: '52週安値から ≥ 30%（日中安値）', value: null, unit: '%' })).toBe('');
    expect(ruleEvidence({ label: 'RS 推計 ≥ 70', value: 88, unit: '', evidence: '1000銘柄' })).toBe('1000銘柄');
    // Never rounded across the threshold: a failing 25.04% reads 25.1%, a failing 29.96% reads 29.9%.
    expect(ruleEvidence({ label: '52週高値からの距離 ≤ 25%（日中高値）', value: 25.04, unit: '%' })).toBe('52週高値から −25.1%');
    expect(ruleEvidence({ label: '52週安値から ≥ 30%（日中安値）', value: 29.96, unit: '%' })).toBe('52週安値から +29.9%');
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
    const crossing = over => view({ asOf: '2026-10-02', close: 101, prevClose: 101 / 1.02, change: 2, ...over });
    // Today's watch card says the day as the rows do (rowEvent's short form).
    expect(watchEvent(crossing({ volumeRatio: 1.4 }))).toEqual({ kind: 'breakout', tone: 'zone', title: '10/2上抜け 1.40×' });
    // A crossing without the volume keeps the zone's ● (kind zone) but not its green.
    expect(watchEvent(crossing({ volumeRatio: 1.39 }))).toEqual({ kind: 'zone', tone: 'wait', title: '上抜け・出来高不足' });
    expect(watchEvent(crossing({ volumeRatio: null }))).toEqual({ kind: 'zone', tone: 'wait', title: '上抜け・出来高 未確認' });
    // Without the analysis date nothing is said about a breakout: the position, as the row's chip says it.
    expect(watchEvent(crossing({ asOf: null, volumeRatio: 1.6 }))).toEqual({ kind: 'zone', tone: 'zone', title: '買いゾーン +1.0%' });
    // No verified day change: nothing is said about a breakout, whatever the volume.
    expect(watchEvent(view({ volumeRatio: 1.6 }))).toEqual({ kind: 'zone', tone: 'zone', title: '買いゾーン +1.0%' });
    expect(watchEvent(view({ state: 'wait', distance: -3.25 })).title).toBe('ピボット接近（あと3.3%）');
    expect(watchEvent(view({ state: 'ext', distance: 8 })).tone).toBe('ext');
    expect(watchEvent(view({ state: 'wait', distance: -9 }))).toEqual({ kind: 'base', tone: 'neutral', title: '土台形成中' });
  });

  it('turns the watch rows\' green neutral while the market is not open to new buying, keeping the titles', () => {
    const breakout = view({ asOf: '2026-10-02', close: 101, prevClose: 99, change: 2, volumeRatio: 1.6 });
    const OPEN = { label: '上昇トレンド（独自判定）', cap: 0.5 }, HOLD = { label: '50日線割れ（弱含み・独自判定）', cap: 0 };
    expect(watchEvent(breakout, OPEN)).toEqual({ kind: 'breakout', tone: 'zone', title: '10/2上抜け 1.60×' });
    for (const market of [HOLD, { label: '市場未確認', cap: 0, state: 'unknown' }, null]) {
      expect(watchEvent(breakout, market)).toEqual({ kind: 'breakout', tone: 'neutral', title: '10/2上抜け 1.60×' });
      expect(watchEvent(view(), market)).toEqual({ kind: 'zone', tone: 'neutral', title: '買いゾーン +1.0%' });
    }
    // Warnings and the other positions keep their tones; without the argument, the tones are as before.
    expect(watchEvent(view({ asOf: '2026-10-02', close: 101, prevClose: 102, change: -1, volumeRatio: 1.6 }), HOLD).tone).toBe('ext');
    expect(watchEvent(view({ state: 'wait', distance: -2 }), HOLD).tone).toBe('wait');
    expect(watchEvent(breakout).tone).toBe('zone');
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
    // Dated by the analysis date, never 「本日」: the data may be older than today.
    expect(breakoutEvent(v)).toEqual({ kind: 'breakout', tone: 'zone', title: '10/2に上抜け・出来高1.60×' });
    expect(v.asOf).toBe(DATE);
  });
  it('(b) a zone day that fell 1% on 1.6× volume is no breakout but a warning (ext tone)', () => {
    expect(breakoutEvent(verdict(audited('B', { price: 101, change: -1, volume: 1.6 })))).toEqual({ kind: 'heavyDown', tone: 'ext', title: '10/2 下落日の大商い 1.60×（要注意）' });
  });
  it('(c) already above the pivot the day before: in the zone after the breakout, never 「本日上抜け」', () => {
    const event = breakoutEvent(verdict(audited('C', { price: 102, change: 1, volume: 2 })));
    expect(event).toMatchObject({ kind: 'after', tone: 'zone', title: '買いゾーン内（上抜け後）' });
    expect(event.title).not.toContain('本日');
  });
  it('(d) a close exactly at the pivot reads 10/2にピボット到達 (dated by the analysis date)', () => {
    expect(breakoutEvent(verdict(audited('D', { price: 100, change: 2, volume: 1.6 })))).toEqual({ kind: 'touch', tone: 'zone', title: '10/2にピボット到達' });
  });
  it('a crossing without 1.4× volume says so, and an unknown volume stays unknown', () => {
    // Not a breakout: tone wait (never the green call), the ratio and the bar in the note.
    expect(breakoutEvent(verdict(audited('T', { price: 101, change: 2, volume: 1.2 })))).toEqual({ kind: 'cross', tone: 'wait', title: '10/2に上抜け・出来高不足', note: '出来高1.20×は基準の1.4×に届きません。' });
    expect(breakoutEvent(verdict(audited('U', { price: 101, change: 2, volume: null })))).toMatchObject({ kind: 'cross', tone: 'wait', title: '10/2に上抜け・出来高 未確認' });
  });
  it('shows a volume ratio floored to 2 decimals, so it never reads past the 1.4× bar it missed', () => {
    expect([ratioShown(1.396), ratioShown(1.4), ratioShown(1.6049), ratioShown(2)]).toEqual(['1.39×', '1.40×', '1.60×', '2.00×']);
    expect(breakoutEvent(verdict(audited('V', { price: 101, change: 2, volume: 1.396 })))).toMatchObject({ kind: 'cross', note: '出来高1.39×は基準の1.4×に届きません。' });
    expect(breakoutEvent(verdict(audited('W', { price: 101, change: -1, volume: 1.4049 }))).title).toBe('10/2 下落日の大商い 1.40×（要注意）');
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
  });
  it('counts the earnings days from the later of the analysis date and today in New York, and says each case in one form', () => {
    const v = { asOf: '2026-10-02', earnings: { date: '2026-10-05', days: 3 } };
    const at = iso => Date.parse(`${iso}T15:00:00Z`);
    // Fresh data (today is the analysis date): 3 days. Viewed on 10/4: 1 day, never 「決算まで3日」.
    expect(earningsCall(v, at('2026-10-02'))).toEqual({ date: '2026-10-05', days: 3, soon: true, chip: '決算まで3日', line: '決算まで3日（10/5）：新規買いは見送り候補（独自判定）' });
    expect(earningsCall(v, at('2026-10-04'))).toMatchObject({ days: 1, chip: '決算まで1日' });
    // The day itself: never 「決算まで0日」.
    expect(earningsCall(v, at('2026-10-05'))).toMatchObject({ days: 0, soon: true, chip: '決算当日', line: '決算当日（10/5）：新規買いは見送り候補（独自判定）' });
    // Passed since the analysis: the analysis predates the report, and it still holds the call.
    expect(earningsCall(v, at('2026-10-06'))).toMatchObject({ days: -1, soon: true, chip: '決算日経過', line: '決算（10/5）後のデータ待ち：新規買いは保留（独自判定）' });
    // 11 days from the analysis date, 9 from today: the warning starts.
    const far = { asOf: '2026-10-02', earnings: { date: '2026-10-13', days: 11 } };
    expect([earningsSoon(far), earningsSoon(far, at('2026-10-02')), earningsSoon(far, at('2026-10-04'))]).toEqual([false, false, true]);
    // New York's date, not UTC's: 10/5 01:00 UTC is still 10/4 in New York.
    expect(earningsCall(v, Date.parse('2026-10-05T01:00:00Z')).days).toBe(1);
    expect(earningsCall({ asOf: '2026-10-02', earnings: null }, at('2026-10-02'))).toBeNull();
    expect(verdict(audited('N', { entry_evidence: { earnings: { date: '2026-10-05' } } })).earnings).toEqual({ date: '2026-10-05', days: 3 });
  });
  it('names the one unmet rule of an あと1条件 row with its value', () => {
    const v = verdict(audited('ONE', { rs: 61.7 }), { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 });
    expect(v.missing).toEqual({ chip: 'あと1条件：RS推計（61）', text: '未達：RS推計 ≥ 70（61）', rs: true });
    const high = verdict(audited('HIGH', { rs: 80 }), { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 });
    expect(high.missing).toBeNull();
    const sma = audited('SMA', { rs: 80 });
    sma.technical_audit.values.sma50 = 120;
    expect(verdict(sma, { qualified: false, passed: 7, failed: 1, unknown: 0, total: 9 }).missing).toEqual({ chip: 'あと1条件：株価 > 50日線', text: '未達：株価 > SMA50', rs: false });
    // A 52-week rule: the chip names the rule short (no value), the full text keeps the threshold and the value.
    const far = audited('FAR', { rs: 80 });
    far.technical_audit.values.belowHigh = 30.25;
    expect(verdict(far, { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 }).missing).toEqual({ chip: 'あと1条件：高値から25%以内', text: '未達：52週高値からの距離 ≤ 25%（30.3%）', rs: false });
    const low = audited('LOW', { rs: 80 });
    low.technical_audit.values.aboveLow = 25.3;
    expect(verdict(low, { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 }).missing).toEqual({ chip: 'あと1条件：安値から30%以上', text: '未達：52週安値から ≥ 30%（25.3%）', rs: false });
    // The rule is evaluated on first use: an あと1条件 view carries it as an enumerable getter until read.
    const lazy = verdict(audited('LAZ', { rs: 61.7 }), { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 });
    expect(typeof Object.getOwnPropertyDescriptor(lazy, 'missing').get).toBe('function');
    expect(lazy.missing).toEqual({ chip: 'あと1条件：RS推計（61）', text: '未達：RS推計 ≥ 70（61）', rs: true });
    expect(Object.getOwnPropertyDescriptor(lazy, 'missing').value).toBe(lazy.missing);
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
    expect(focusCounts(ranked, '2026-10-02')).toEqual({ zone: 2, near: 3, total: 5, breakout: 0 });
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
    expect(focusCounts([], '2026-10-02')).toEqual({ zone: 0, near: 0, total: 0, breakout: 0 });
    expect(focusCounts(undefined, '2026-10-02')).toEqual({ zone: 0, near: 0, total: 0, breakout: 0 });
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
    // A ready bundle that carries no verdict: 未確認 (the verdict comes with the bundle). Still loading: nothing.
    expect([focusHeadingNote(null, 'ready'), focusHeadingNote(undefined, 'ready'), focusHeadingNote(null, 'loading'), focusHeadingNote(OPEN[0], 'ready'), focusHeadingNote(HOLD[0], 'ready')])
      .toEqual(['（地合い未確認）', '（地合い未確認）', null, null, '（地合い：買いは控える・監視のみ）']);
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
    // Z1 touches its pivot on the synthetic day (+2%, 1.6×) and Z2 was above it the day before: the touch first.
    expect(focusCounts(ranked, DATE)).toEqual({ zone: 2, near: 2, total: 4, breakout: 0 });
    const views = ranked.map(item => candidateView(item, DATE));
    expect(views.slice().sort(briefOrder).map(v => v.symbol)).toEqual(['Z1', 'Z2', 'Z3', 'U1', 'N2', 'N1', 'N3', 'B1', 'E1', 'S1']);
    expect(Object.fromEntries(Object.entries(LIST_FILTERS).map(([key, filter]) => [key, views.filter(filter.test).map(v => v.symbol)]))).toEqual({
      zone: ['Z1', 'Z2'], near: ['N1', 'N2'], all: ['Z1', 'Z2', 'N1', 'N2', 'B1', 'E1', 'S1'], one: ['Z3', 'N3'], focus: ['Z1', 'Z2', 'N1', 'N2'], breakout: [], eps: [] });
    // The one-pass counts agree with every filter's own test.
    expect(filterCounts(views)).toEqual({ counts: { zone: 2, near: 2, all: 7, one: 2, focus: 4, breakout: 0, eps: 0 }, unknown: { eps: 7 } });
  });
});

// The rows' contracts other tracks read in round 2 (plan §2.2): breakoutEvent's shape with its undated 'after'
// event, earningsCall's frozen shape and the candidateView fields (rows may add fields, never rename or remove one).
describe('the round-2 contracts of the candidate view', () => {
  it('breakoutEvent(view) is { kind, tone, title, note? } and its after event is undated, whatever else it is given', () => {
    const after = verdict(audited('C', { price: 102, change: 1, volume: 2 }));
    expect(breakoutEvent(after)).toEqual({ kind: 'after', tone: 'zone', title: '買いゾーン内（上抜け後）' });
    const bars = [98, 99, 101, 102, 103].map((close, i) => ({ date: `2026-09-${20 + i}`, close }));
    expect(breakoutEvent(after, bars)).toEqual(breakoutEvent(after));
    for (const row of [audited('A', { price: 101, change: 2, volume: 1.6 }), audited('B', { price: 101, change: -1, volume: 1.6 }), audited('D', { price: 100 }), audited('T', { price: 101, volume: 1.2 })]) {
      const keys = Object.keys(breakoutEvent(verdict(row)));
      expect(keys.filter(key => !['kind', 'tone', 'title', 'note'].includes(key))).toEqual([]);
    }
  });

  it('earningsCall keeps its five fields, and candidateView every field the conclusion and the chart read', () => {
    const v = verdict(audited('E', { price: 101, entry_evidence: { earnings: { date: '2026-10-05' } } }));
    expect(Object.keys(earningsCall(v, Date.parse('2026-10-02T19:00:00Z'))).sort()).toEqual(['chip', 'date', 'days', 'line', 'soon']);
    expect(['pivot', 'upper', 'state', 'position', 'distance', 'close', 'change', 'prevClose', 'volumeRatio', 'fromSma50', 'earnings', 'asOf', 'row', 'pivotSource'].filter(key => !Object.hasOwn(v, key))).toEqual([]);
  });
});

// Round 2 (rows): the day's event on every row, the order within the buy zone, the hidden filters and sorts, the
// TT chip, the RS-line high, the base chip, the shared view memo and the pivot source.
describe('round 2: the day on every row and the order within the buy zone', () => {
  const zone = (symbol, over) => audited(symbol, { pivot: 100, rs: 90, ...over });
  const rows = {
    BRK: zone('BRK', { price: 101, change: 2, volume: 1.6 }), // crossed from below on 1.6×
    TCH: zone('TCH', { price: 100, change: 2, volume: 1.6 }), // closed on the pivot
    CRS: zone('CRS', { price: 101, change: 2, volume: 1.2 }), // crossed without the volume
    AFT: zone('AFT', { price: 102, change: 1, volume: 2 }), // above the pivot the day before
    HVY: zone('HVY', { price: 101, change: -1, volume: 1.6 }), // a down day on heavy volume
  };
  const views = Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, verdict(row)]));

  it('gives each event one short form and tone for the row chip, and none for after or an unverified day', () => {
    expect(Object.fromEntries(Object.entries(views).map(([key, v]) => [key, rowEvent(v)]))).toEqual({
      BRK: { kind: 'breakout', glyph: '↗', text: '10/2上抜け 1.60×', tone: 'zone' },
      TCH: { kind: 'touch', glyph: '●', text: '10/2ピボット到達', tone: 'zone' },
      CRS: { kind: 'cross', glyph: '●', text: '上抜け・出来高不足', tone: 'wait' },
      AFT: null,
      HVY: { kind: 'heavyDown', glyph: '▲', text: '下落日の大商い', tone: 'ext' },
    });
    expect(rowEvent(verdict(zone('UNK', { price: 101, change: 2, volume: null }))).text).toBe('上抜け・出来高 未確認');
    // candidateView carries the event once (breakoutEvent's), the order and the filters read it.
    expect(views.BRK.event).toEqual(breakoutEvent(views.BRK));
    const missing = zone('MIS', { price: 101 });
    delete missing.technical_audit;
    expect([verdict(missing).event, rowEvent(verdict(missing))]).toEqual([null, null]);
    // The after row keeps its position chip, as before.
    expect(positionText(views.AFT)).toBe('買いゾーン +2.0%');
  });

  it('ranks a breakout, then a touch or a crossing, then after, then a heavy down day last, whatever the RS', () => {
    const ranked = Object.entries(rows).map(([key, row], i) => verdict({ ...row, rs_rating: 95 - i * 0 + (key === 'HVY' ? 4 : key === 'AFT' ? 3 : 0) }));
    expect(ranked.slice().reverse().sort(briefOrder).map(v => v.symbol)).toEqual(['BRK', 'CRS', 'TCH', 'AFT', 'HVY']);
    // Touch and crossing share a rank: RS decides between them.
    const higher = verdict({ ...rows.TCH, rs_rating: 99 });
    expect([views.CRS, higher].sort(briefOrder).map(v => v.symbol)).toEqual(['TCH', 'CRS']);
    // Other positions are as before: near, further below and extended keep their order by RS.
    const others = [verdict(zone('EXT', { price: 108, rs: 99 })), verdict(zone('FAR', { price: 90, rs: 99 })), verdict(zone('NEA', { price: 97, rs: 80 })), verdict(zone('NEB', { price: 98, rs: 85 }))];
    expect([...others, views.HVY].sort(briefOrder).map(v => v.symbol)).toEqual(['HVY', 'NEB', 'NEA', 'FAR', 'EXT']);
    // A selected stock still ranks above one that is not, in the zone too.
    const unqualified = verdict(rows.BRK, { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 });
    expect([unqualified, views.HVY].sort(briefOrder).map(v => v.qualified)).toEqual([true, false]);
  });

  it('breaks a tie within the zone by a dated RS-line new high, then by RS', () => {
    const dated = value => ({ value, leading: null, as_of_date: DATE });
    const high = verdict({ ...rows.TCH, symbol: 'HIG', rs_rating: 80, rs_line_high: dated(true) });
    const plain = verdict({ ...rows.TCH, symbol: 'PLN', rs_rating: 95, rs_line_high: dated(false) });
    const old = verdict({ ...rows.TCH, symbol: 'OLD', rs_rating: 90, rs_line_high: { ...dated(true), as_of_date: '2026-10-01' } });
    expect([plain, old, high].sort(briefOrder).map(v => v.symbol)).toEqual(['HIG', 'PLN', 'OLD']);
    expect([high.rsLineHigh, plain.rsLineHigh, old.rsLineHigh]).toEqual([true, false, false]);
    // Outside the zone the RS-line high does not reorder.
    const nearHigh = verdict({ ...zone('NH', { price: 97, rs: 70 }), rs_line_high: dated(true) }), nearPlain = verdict(zone('NP', { price: 97, rs: 90 }));
    expect([nearHigh, nearPlain].sort(briefOrder).map(v => v.symbol)).toEqual(['NP', 'NH']);
  });

  it('reads the RS-line high only through the published value dated for the analysis date (never se_rs_line_new_high)', () => {
    const at = extra => verdict({ ...rows.TCH, ...extra }).rsLineHigh;
    expect(at({ rs_line_high: { value: true, leading: false, as_of_date: DATE } })).toBe(true);
    for (const extra of [{}, { se_rs_line_new_high: true }, { rs_line_high: { value: null, leading: null, as_of_date: DATE } }, { rs_line_high: { value: true, leading: true, as_of_date: '2026-10-01' } }, { rs_line_high: { value: 'yes', leading: null, as_of_date: DATE } }])
      expect({ extra, high: at(extra) }).toEqual({ extra, high: false });
  });

  it('opens the breakout filter only for selected breakouts, and names it by the analysis date', () => {
    expect(Object.entries(views).filter(([, v]) => LIST_FILTERS.breakout.test(v)).map(([key]) => key)).toEqual(['BRK']);
    expect(LIST_FILTERS.breakout.test(verdict(rows.BRK, { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 }))).toBe(false);
    expect([filterLabel('breakout', DATE), filterLabel('breakout', null), filterLabel('zone', DATE)]).toEqual(['10/2の上抜け', '上抜け', '買いゾーン']);
    const items = Object.values(rows).map(row => ({ row, assessment: { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 } }));
    expect(focusCounts(items, DATE)).toEqual({ zone: 5, near: 0, total: 5, breakout: 1 });
    // The segment still shows exactly its four filters.
    expect(Object.entries(LIST_FILTERS).filter(([, value]) => !value.hidden).map(([key]) => key)).toEqual(['zone', 'near', 'all', 'one']);
  });
});

describe('round 2: the TT chip says unmet and unconfirmed apart, never あと0', () => {
  it('follows the RW4 matrix', () => {
    const chip = over => templateChip(view({ qualified: false, ...over }));
    expect(templateChip(view())).toEqual({ text: 'TT 8/8', zone: true });
    expect(chip({ failed: 0, unknown: 2 })).toEqual({ text: 'TT未確認（2条件）', zone: false });
    expect(chip({ failed: 1, unknown: 2 })).toEqual({ text: '未達1・未確認2', zone: false });
    expect(chip({ failed: 2, unknown: 0 })).toEqual({ text: 'あと2条件', zone: false });
    expect(chip({ failed: 0, unknown: 0 })).toEqual({ text: '選定対象外', zone: false });
    expect(chip({ failed: 0, unknown: 0, exclusion: '金融業の例外' })).toEqual({ text: '金融業の例外', zone: false });
    expect(chip({ failed: null, unknown: null })).toEqual({ text: '条件 未確認', zone: false });
    for (const failed of [0, 1, 2]) for (const unknown of [0, 1, 3]) expect(chip({ failed, unknown }).text).not.toMatch(/あと0/);
  });
});

describe('round 2: the questionable-base chip (独自判定)', () => {
  const based = extra => verdict(audited('BAS', { price: 101, ...extra, setup_recalculation: { status: 'calculated', as_of_date: DATE, ...extra.setup_recalculation } }));
  it('flags a base deeper than 35% or shorter than 3 weeks, else a close more than 25% above the 50-day line', () => {
    expect([BASE_DEPTH_MAX_PERCENT, BASE_LENGTH_MIN_WEEKS, EXTENDED_FROM_SMA50_PERCENT]).toEqual([35, 3, 25]);
    expect(based({ se_base_length_weeks: 3, se_base_depth_pct: 38.2 }).baseCaution).toMatchObject({ kind: 'base', text: '土台3週・−38%' });
    expect(based({ se_base_length_weeks: 2, se_base_depth_pct: 12 }).baseCaution).toMatchObject({ kind: 'base', text: '土台2週・−12%' });
    // Shown on its side of the bar: 35.4% reads 35.4, 2.6 weeks reads 2.6.
    expect(based({ se_base_length_weeks: 5, se_base_depth_pct: 35.4 }).baseCaution.text).toBe('土台5週・−35.4%');
    expect(based({ se_base_length_weeks: 2.6, se_base_depth_pct: 10 }).baseCaution.text).toBe('土台2.6週・−10%');
    expect(based({ se_base_length_weeks: 2, se_base_depth_pct: null }).baseCaution.text).toBe('土台2週・深さ 未確認');
    expect(based({ se_base_length_weeks: 2 }).baseCaution.title).toBe('Setup Engineの土台が3週未満（独自判定）');
    // Normal rows: no chip at the thresholds themselves.
    expect(based({ se_base_length_weeks: 3, se_base_depth_pct: 35 }).baseCaution).toBeNull();
    // A base that is not current for the analysis date is not read.
    expect(based({ se_base_length_weeks: 2, se_base_depth_pct: 40, setup_recalculation: { as_of_date: '2026-10-01' } }).baseCaution).toBeNull();
    // The verified close against the 50-day line (100 against 90 in the synthetic audit: +11%): extended above 25%.
    const extended = audited('EXT', { price: 101 });
    extended.technical_audit.values.sma50 = 78;
    expect(verdict(extended).baseCaution).toMatchObject({ kind: 'extended', text: '50日線から+29%' });
    expect(verdict(audited('OK', { price: 101 })).baseCaution).toBeNull();
  });
});

describe('round 2: the EPS filter and sorts (secSummary, dated)', () => {
  const summary = (eps, extra = {}) => ({ sec_summary: { sec_state: 'ok', eps_yoy: eps === null ? null : { value: eps, end: '2026-06-30' }, sales_yoy: null, code33: null, as_of_date: DATE, ...extra } });
  const at = (symbol, extra) => verdict(audited(symbol, { price: 97, ...extra }));
  it('counts the stocks at 25% or more, and those it cannot tell apart, never as a miss', () => {
    expect(EPS_YOY_FILTER_PERCENT).toBe(25);
    const views = [at('A', summary(40)), at('B', summary(25)), at('C', summary(24.9)), at('D', summary(null)), at('E', {}), at('F', summary(60, { as_of_date: '2026-10-01' })), at('G', { sec_summary: { sec_state: 'ok' } })];
    expect(views.map(v => v.epsYoy)).toEqual([40, 25, 24.9, null, null, null, null]);
    const { counts, unknown } = filterCounts(views);
    expect([counts.eps, unknown.eps]).toEqual([2, 4]);
    expect(views.filter(LIST_FILTERS.eps.test).map(v => v.symbol)).toEqual(['A', 'B']);
    // Not a selected stock: neither counted nor 未確認.
    expect(filterCounts([verdict(audited('H', { price: 97, ...summary(90) }), { qualified: false, passed: 8, failed: 1, unknown: 0, total: 9 })])).toMatchObject({ counts: { eps: 0 }, unknown: { eps: 0 } });
    expect(views.slice().sort(LIST_SORTS.eps.compare).map(v => v.symbol)).toEqual(['A', 'B', 'C', ...['D', 'E', 'F', 'G'].sort((x, y) => briefOrder(views.find(v => v.symbol === x), views.find(v => v.symbol === y)))]);
  });

  it('sorts by the current Setup Engine confidence, an unknown or stale one last', () => {
    const conf = (symbol, value, day = DATE) => verdict(audited(symbol, { price: 97, se_pattern_confidence: value, setup_recalculation: { status: 'calculated', as_of_date: day } }));
    const views = [conf('L', 41), conf('H', 72), conf('U', null), conf('S', 99, '2026-10-01'), conf('M', 60)];
    expect(views.map(v => v.setupConfidence)).toEqual([41, 72, null, null, 60]);
    expect(views.slice().sort(LIST_SORTS.base.compare).map(v => v.symbol).slice(0, 3)).toEqual(['H', 'M', 'L']);
    expect(LIST_SORTS.base.label).toBe('土台の質（SE信頼度・未確認は最後）');
  });
});

describe('round 2: the pivot source names the pattern and its confidence', () => {
  const pivot = extra => verdict(audited('PIV', { price: 101, setup_recalculation: { status: 'calculated', as_of_date: DATE }, ...extra })).pivotSource;
  it('reads Setup Engine, the pattern from one table and the confidence, 未確認 when unknown, never 0', () => {
    expect(pivot({ se_pattern_primary: 'cup_with_handle', se_pattern_confidence: 72.6 })).toBe('Setup Engine・カップ・ウィズ・ハンドル（信頼度72）');
    expect(pivot({ se_pattern_primary: 'vcp', se_pattern_confidence: 31 })).toBe('Setup Engine・VCP（信頼度31・基準55未満）');
    expect(pivot({ se_pattern_primary: 'vcp', se_pattern_confidence: 54.9 })).toBe('Setup Engine・VCP（信頼度54・基準55未満）');
    expect(pivot({ se_pattern_primary: 'saucer_v9', se_pattern_confidence: 60 })).toBe('Setup Engine・saucer_v9（信頼度60）');
    expect(pivot({ se_pattern_confidence: 60 })).toBe('Setup Engine（信頼度60）');
    expect(pivot({ se_pattern_primary: 'vcp', se_pattern_confidence: null })).toBe('Setup Engine・VCP（信頼度 未確認）');
    expect(pivot({ se_pattern_primary: 'vcp', se_pattern_confidence: 0, setup_recalculation: { status: 'calculated', as_of_date: '2026-10-01' } })).toBe('Setup Engine・VCP（信頼度 未確認）');
    expect(pivot({ se_pattern_confidence: 70, setup_recalculation: { status: 'calculated', as_of_date: DATE, reason: 'primary_pattern_below_confidence_floor' } })).toBe('Setup Engine（信頼度70・基準55未満）');
    expect([setupPatternName('double_bottom'), setupPatternName(''), setupPatternName(null)]).toEqual(['ダブルボトム', null, null]);
    // Another source keeps canonicalPivot's reason, which the stale pivot still reads.
    expect(verdict(audited('VC', { price: 101, se_pivot_price: undefined, vcp_pivot: 100 })).pivotSource).toBe('VCP（日次）');
    const far = verdict(audited('FAR', { price: 132, pivot: 100 }));
    expect([far.pivotSource, far.stale?.short]).toEqual(['現在値から25%超離れた旧水準・ベースの再形成待ち', '旧ピボットから +32%・有効な買い水準なし']);
  });
});

describe('round 2: one view per item and bundle', () => {
  it('returns the same view object for an item within one bundle and date, a new one for another bundle or date', () => {
    const item = { row: audited('MEM', { price: 101 }), assessment: { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 } };
    const bundle = { date: DATE }, other = { date: DATE };
    const first = memoCandidateView(item, DATE, bundle);
    expect(memoCandidateView(item, DATE, bundle)).toBe(first);
    expect(first).toEqual(candidateView(item, DATE));
    expect(memoCandidateView(item, DATE, other)).not.toBe(first);
    expect(memoCandidateView(item, '2026-10-01', bundle)).not.toBe(first);
    // Without a bundle nothing is kept.
    expect(memoCandidateView(item, DATE, null)).not.toBe(memoCandidateView(item, DATE, null));
    // The focus helpers share it.
    expect(focusCandidates([item], DATE, 5, bundle)[0]).toBe(memoCandidateView(item, DATE, bundle));
  });
});
