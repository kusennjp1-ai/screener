// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { date, marketTrends, rows as FIXTURE_ROWS, sessions } from '../../../tests/static/brief-fixture.js';
import { capText, marketLines, modelMarket } from '../portfolioPlan';
import { marketUpdateState } from '../marketUpdateState';
import { freshness, freshnessLine } from './briefFreshness';
import { marketCardView } from './marketTabModel';
import { gateReads, REGIME_NAMES } from './marketGateFacts';
import { BAND_SUBJECT, CONDITION_KIND, CONDITION_LABELS, FACT_KINDS, GATE_GROUPS, GATE_KINDS, NO_KIND, REGIME_DISTRIBUTION_PRESSURE, SIGN_KIND, SIGN_TITLE,
  gateFacts, gateSign, marketBand, marketGate, resumeConditions } from './marketGate';

// ---- the states of plan S1-P2's table, opened from the browser fixture (tests/static/brief-fixture.js, frozen) with the
// specs' own mutators (copied with their source lines, as the yardstick's states.mjs copies them) ------------------------------

// brief-market-r3.spec.js:60-61
const ftdUpgraded = { rows: rows => { for (const row of rows) row.market_above_50dma = false; },
  manifest: value => { value.markets.US.market_context = { as_of_date: date, regime: 'confirmed_uptrend', distribution_days: 1, ftd_date: sessions.at(-8), ftd_days_since: 7, exposure_pct: 40, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' }; } };
// brief-market-r3.spec.js:63
const belowFiftyIndex = { trends: value => { const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 3) point.close = Math.round(point.close * 96) / 100; else if (i >= n - 200 && i < n - 50) point.close = Math.round(point.close * 90) / 100; }); } };
// brief-market-r3.spec.js:65-66
const below200 = { rows: rows => { for (const row of rows) { row.market_above_200dma = false; row.market_regime = 'correction'; } },
  trends: value => { const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 10) point.close = Math.round(point.close * 85) / 100; }); } };
// brief-market-r3.spec.js:291
const ftdAgo = n => ({ trends: value => { const dates = value.indices[0].points.map(point => point.date), ft = value.indices[0].followThrough; ft.ftd = { ...ft.ftd, date: dates.at(-1 - n), sessionsSince: n }; } });
// brief-market-r3.spec.js:295
const below50Rows = { rows: rows => { for (const row of rows) { row.market_above_50dma = false; row.market_regime = 'correction'; } } };
// brief-market-r3.spec.js:383-384 (with d = 2: the FTD conflict of brief-market-phone.spec.js:395-398)
const gspcRally = d => ({ trends: value => { const dates = value.indices[0].points.map(point => point.date), last = dates.length - 1;
  Object.assign(value.indices[0].followThrough, { state: 'rally_attempt', low: { date: dates[last - d], low: 4980 }, attempt: { startDate: dates[last - d + 1], day: d }, ftd: null, events: [] }); } });
// brief-market.spec.js:394 and :388
const pressure = { rows: rows => { for (const row of rows) row.market_regime = 'uptrend_under_pressure'; },
  manifest: value => { value.markets.US.market_context = { as_of_date: date, regime: 'uptrend_under_pressure', distribution_days: 4, ftd_date: null, ftd_days_since: null, exposure_pct: 55, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' }; } };
// The yardstick's own (states.mjs): SPY above both lines under a regime outside the two uptrends, and every row's 50-day field missing.
const restrain = { rows: rows => { for (const row of rows) row.market_regime = 'correction'; } };
const partUnknown = { rows: rows => { for (const row of rows) row.market_above_50dma = null; } };
// Two regimes in one publication (portfolioPlan.test.js: conflicts are blocked).
const mixed = { rows: rows => { rows[0].market_regime = 'uptrend_under_pressure'; } };
// A leader cohort large enough for a rate on every session (the fixture's newest cohort is under LEADER_MIN_COHORT).
const bigCohort = { trends: value => { for (const row of value.long_history.breadth) if (row.leaderCohort !== null) Object.assign(row, { leaderCohort: 30, leaderCohortAbove50: 21 }); } };
// The regime's own block for the default market (a valued SPY count, for the kind table).
const upContext = { manifest: value => { value.markets.US.market_context = { as_of_date: date, regime: 'confirmed_uptrend', distribution_days: 2, ftd_date: null, ftd_days_since: null, exposure_pct: 100, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' }; } };

const compose = (...parts) => Object.fromEntries([...new Set(parts.flatMap(Object.keys))].map(key => [key, value => { for (const part of parts) part[key]?.(value); }]));
const apply = (fn, value) => { const copy = structuredClone(value); fn?.(copy); return copy; };

/** One state as Today would read it: rows → modelMarket and marketLines, the trends query, the manifest, the 地合い card's view. */
function open({ mutate = {}, historyEnd = date, fail = null, loading = false, target = null, late = null } = {}) {
  const rows = apply(mutate.rows, FIXTURE_ROWS);
  const market = fail === 'manifest' || loading ? null : modelMarket(rows), lines = market ? marketLines(rows) : { above50: null, above200: null };
  const data = JSON.parse(marketTrends({ historyEnd, mutate: mutate.trends }).text);
  const trends = loading ? { loading: true } : fail === 'series' ? { error: true, failureReason: Object.assign(new Error('Failed to load static data: series (404)'), { name: 'Error' }) } : { data, loading: false };
  const manifest = fail === 'manifest' ? null : apply(mutate.manifest, { as_of_date: date, markets: { US: { as_of_date: date } } });
  const view = marketCardView({ market, marketLoading: loading, trends, date, update: { target }, facts: gateReads });
  const gate = marketGate({ market, loading, lines, date, target, late, trends, manifest, view });
  const facts = gateFacts({ market, marketLoading: loading, trends, manifest: { data: manifest }, date }, { lines, target, view });
  return { rows, market, lines, data, trends, manifest, view, gate, facts };
}
const everyText = value => JSON.stringify(value);
const ftdDay = data => { const day = data.indices[0].followThrough.ftd.date; const [, m, d] = day.split('-').map(Number); return `${m}/${d}`; };

describe('marketBand and the gate in every state of plan S1-P2\'s table', () => {
  it('上昇トレンド, 最大50%: 検討可 with the figure, its label and its definition; no condition line; NAS調整中 as the sign', () => {
    const { gate, market } = open();
    expect(market.cap).toBe(0.5);
    expect(gate.band.line1).toBe('地合い 検討可・目安 最大50%');
    expect(gate.band.chip).toBe('地合い 上昇トレンド（独自判定）・新規買いの目安 最大50%（独自設定）');
    expect(gate.band.kinds).toEqual({ long: '判定＝独自判定・目安＝独自設定', short: '独自判定・独自設定' });
    expect(gate.head).toMatchObject({ kicker: '地合い・10/2（金）引け', age: null, headline: '新規の買いを検討できる', headlineKind: '独自判定',
      figure: '最大50%', figureLabel: '新規買いの目安（独自設定）', definition: '最大50%＝新規建ての上限（口座比・独自設定）' });
    expect(gate.conditions.title).toBe('目安が動く条件');
    expect(gate.conditions.first).toEqual([]);
    expect(gate.conditions.fold).toEqual(['SPY終値が200日線・50日線の上：達成', '局面判定が上昇トレンド／上昇に圧力：達成']);
    expect(gate.sign).toMatchObject({ type: 'nasdaq', text: 'NAS調整中', title: SIGN_TITLE, kind: SIGN_KIND });
    expect(gate.sign.sentence).toMatch(/^判定はS&P 500（SPY）のみに基づきます。Nasdaq総合は反発3日目/);
    expect(gate.summary).toBe('根拠と目安が動く条件');
    // The phone's first fold says the short form (ledger step 3); the fold and the wide line the market tab's own words.
    expect(gate.basis).toEqual({ text: '根拠：SPYが50日線・200日線の上で、局面判定が「上昇トレンド」', full: '根拠（10/2スキャン時点）：S&P 500（SPY）が50日線・200日線の上で、局面判定（分配日・FTDなど）が「上昇トレンド」', kind: '実測', conflict: false });
  });

  it('上昇に圧力, 最大25%: the same form with 最大25%', () => {
    const { gate } = open({ mutate: pressure });
    expect(gate.band.line1).toBe('地合い 検討可・目安 最大25%');
    expect(gate.band.chip).toBe('地合い 上昇に圧力（独自判定）・新規買いの目安 最大25%（独自設定）');
    expect(gate.head).toMatchObject({ headline: '新規の買いを検討できる', figure: '最大25%', definition: '最大25%＝新規建ての上限（口座比・独自設定）' });
    expect(gate.conditions.first).toEqual([]);
    expect(gate.summary).toBe('根拠と目安が動く条件');
  });

  it('50日線割れ: 買いは控える with 0%; the 50-day line and the regime named in the first fold, 反発n日目 as the sign', () => {
    const { gate } = open({ mutate: below50Rows });
    expect(gate.band.line1).toBe('地合い 買いは控える・目安 0%');
    expect(gate.band.chip).toBe('地合い 50日線割れ（弱含み・独自判定）・新規買いの目安 0%（独自設定）');
    expect(gate.head).toMatchObject({ headline: '買いは控える', headlineKind: '独自判定', figure: '0%', figureLabel: '新規買いの目安（独自設定）', definition: '0%＝新規建ての上限（口座比・独自設定）' });
    expect(gate.conditions.title).toBe('買いの再開の条件');
    expect(gate.conditions.first).toEqual(['SPY終値が50日線の上：未達', '局面判定が上昇トレンド／上昇に圧力：未達（いま 調整）']);
    expect(gate.conditions.fold).toEqual(['SPY終値が200日線の上：達成']);
    expect(gate.sign).toMatchObject({ type: 'rally', text: '反発3日目', kind: SIGN_KIND });
    expect(gate.sign.sentence).toMatch(/反発3日目。4日目以降の\+1\.2%上昇待ち（独自判定）。判定と目安は変わりません。$/);
    expect(gate.summary).toBe('根拠と再開の条件');
  });

  it('an FTD-upgraded regime under the 50-day line: its own sign line, never merged with a condition, and the regime met in the fold', () => {
    const old = open({ mutate: compose(ftdUpgraded, belowFiftyIndex) });
    expect(old.market).toMatchObject({ cap: 0, ftdUpgraded: true });
    expect(old.gate.band.line1).toBe('地合い 買いは控える・目安 0%');
    expect(old.gate.conditions.first).toEqual(['SPY終値が50日線の上：未達']);
    expect(old.gate.conditions.fold).toEqual(['SPY終値が200日線の上：達成', '局面判定が上昇トレンド／上昇に圧力：達成']);
    // The fixture's ^GSPC FTD is 35 sessions old: the existing rule names it 前回のFTD with its date.
    expect(old.gate.sign.text).toBe(`前回のFTD ${ftdDay(old.data)}（参考・目安は 0%のまま：SPYが50日線の下）`);
    const recent = open({ mutate: compose(ftdUpgraded, belowFiftyIndex, ftdAgo(5)) });
    expect(recent.gate.sign).toMatchObject({ type: 'ftd', text: 'FTD確認済み（参考・目安は 0%のまま：SPYが50日線の下）', sentence: null, title: SIGN_TITLE, kind: SIGN_KIND });
    for (const { gate } of [old, recent]) {
      expect(gate.conditions.first.some(line => /FTD/.test(line))).toBe(false);
      expect(gate.sign.text).not.toMatch(/：未達|：達成/);
      expect(gate.basis.conflict).toBe(false);
    }
  });

  it('長期トレンド警戒: the 200-day line unmet in the first fold, the 50-day line as it is', () => {
    const { gate } = open({ mutate: below200 });
    expect(gate.band.line1).toBe('地合い 買いは控える・目安 0%');
    expect(gate.band.chip).toBe('地合い 長期トレンド警戒（独自判定）・新規買いの目安 0%（独自設定）');
    expect(gate.conditions.first).toEqual(['SPY終値が200日線の上：未達', '局面判定が上昇トレンド／上昇に圧力：未達（いま 調整）']);
    expect(gate.conditions.fold).toEqual(['SPY終値が50日線の上：達成']);
  });

  it('新規購入を抑制: above both lines under another regime, named with its name', () => {
    const { gate } = open({ mutate: restrain });
    expect(gate.band.chip).toBe('地合い 新規購入を抑制（独自判定）・新規買いの目安 0%（独自設定）');
    expect(gate.conditions.first).toEqual(['局面判定が上昇トレンド／上昇に圧力：未達（いま 調整）']);
    expect(gate.conditions.fold).toEqual(['SPY終値が200日線・50日線の上：達成']);
  });

  it('市場未確認 (the manifest failed, or two regimes in one publication): 未確認・買いは見送り with no figure, and the conditions unknown, never 未達 or 達成', () => {
    for (const state of [open({ fail: 'manifest' }), open({ mutate: mixed })]) {
      const { gate, facts } = state;
      expect(gate.band.line1).toBe('地合い 未確認・買いは見送り');
      expect(gate.band.chip).toBe('地合い 未確認・買いは見送り');
      expect(gate.band).toMatchObject({ state: 'unknown', guide: null, guideLabel: null, kinds: null, label: null });
      expect(gate.head).toMatchObject({ headline: '買いは見送り', headlineKind: null, figure: null, figureLabel: null, definition: null });
      expect(gate.basis).toBeNull();
      expect(gate.conditions.first).toEqual(['再開の条件：未確認']);
      expect(gate.conditions.fold).toEqual([]);
      expect(gate.conditions.conditions.every(c => c.state === 'unknown')).toBe(true);
      expect(gate.summary).toBe('根拠（未確認の項目）');
      const judgement = [gate.band, gate.head, gate.conditions, facts.filter(f => f.group === GATE_GROUPS.verdict || f.key.startsWith('spy'))];
      expect(everyText(judgement)).not.toMatch(/%|未達|達成|あと0/);
    }
    expect(open({ fail: 'manifest' }).gate.band.name).toBe('地合い 市場未確認・新規の買いは見送り');
  });

  it('part of the conditions unknown: each by name, met ones in the fold; under modelMarket\'s filter no rows reach it', () => {
    // The yardstick's partunk recipe (every 50-day field missing): modelMarket sees no observed row, so marketLines reads none
    // either and the market is 市場未確認: every condition unknown, the 200-day line is not claimed from unobserved rows.
    const partunk = open({ mutate: partUnknown });
    expect(partunk.market.label).toBe('市場未確認');
    expect(partunk.lines).toEqual({ above50: null, above200: null });
    expect(partunk.gate.conditions.first).toEqual(['再開の条件：未確認']);
    // The per-condition form itself, for a judged market whose 50-day line is not given (not reachable from rows; see the
    // property test: a judged market always has both lines).
    const conditions = resumeConditions(modelMarket(FIXTURE_ROWS), { above50: null, above200: true });
    expect(conditions.first).toEqual(['SPY終値が50日線の上：未確認']);
    expect(conditions.fold).toEqual(['SPY終値が200日線の上：達成', '局面判定が上昇トレンド／上昇に圧力：達成']);
    expect(conditions.met).toBe(false);
  });

  it('loading: 読込中, no figure, no condition and no summary', () => {
    const { gate, facts } = open({ loading: true });
    expect(gate.band).toMatchObject({ state: 'loading', line1: '地合い 読込中', chip: '地合い 読込中', name: '地合い 読込中', guide: null, kinds: null });
    expect(gate.head).toMatchObject({ headline: null, figure: null, definition: null });
    expect(gate.conditions).toBeNull();
    expect(gate.summary).toBeNull();
    expect(everyText([gate, facts.filter(f => f.group === GATE_GROUPS.verdict)])).not.toMatch(/%/);
  });

  it('one session behind: the verdict from the rows, Today\'s note, and the signs withheld as 未確認（M/D分は再集計待ち）', () => {
    const { gate } = open({ historyEnd: sessions.at(-2) });
    expect(gate.band.line1).toBe('地合い 検討可・目安 最大50%');
    expect(gate.todayNote).toBe('市場の集計は10/1時点（10/2分は再集計待ち）');
    expect(gate.sign).toMatchObject({ type: 'withheld', text: '未確認（10/2分は再集計待ち）', title: SIGN_TITLE, kind: SIGN_KIND });
  });

  it('the index series missing: the verdict from the rows, the index-side facts in their absent words, never 0', () => {
    const { gate, facts } = open({ fail: 'series' });
    expect(gate.band.line1).toBe('地合い 検討可・目安 最大50%');
    expect(gate.sign).toBeNull();
    const index = facts.filter(f => [GATE_GROUPS.index, GATE_GROUPS.breadth, GATE_GROUPS.stock].includes(f.group) && f.key !== 'spyLines' && f.key !== 'spyDistribution');
    expect(index.map(f => [f.key, f.value, f.kind])).toEqual([
      ['indexDistribution', '取得できません', NO_KIND], ['extremes', '取得できません', NO_KIND], ['above200', '取得できません', NO_KIND],
      ['tt', '取得できません', NO_KIND], ['breakout', '取得できません', NO_KIND], ['health', '取得できません', NO_KIND]]);
    for (const f of index) expect(f.value).not.toMatch(/\d/);
  });

  it('the FTD conflict and the basis conflict: the verdict unchanged, the basis line notes the disagreement', () => {
    const ftd = open({ mutate: compose(ftdUpgraded, belowFiftyIndex, gspcRally(2)) });
    expect(ftd.gate.band.line1).toBe('地合い 買いは控える・目安 0%');
    expect(ftd.gate.basis).toEqual({ text: '根拠：SPYの終値が50日線の下（指数の履歴と不一致・下に詳細）', full: '根拠（10/2スキャン時点）：S&P 500（SPY）の終値が50日線の下（指数の履歴と不一致・下に詳細）', kind: '実測', conflict: true });
    // The ^GSPC record is not a confirmed FTD that day: no FTD sign is asserted.
    expect(ftd.gate.sign?.type).not.toBe('ftd');
    const basis = open({ mutate: ftdUpgraded });
    expect(basis.view.conflict).toMatch(/一致していません。$/);
    expect(basis.gate.basis.text).toBe('根拠：SPYの終値が50日線の下（指数の履歴と不一致・下に詳細）');
    expect(basis.gate.basis.full).toBe('根拠（10/2スキャン時点）：S&P 500（SPY）の終値が50日線の下（指数の履歴と不一致・下に詳細）');
    expect(basis.gate.band.chip).toBe('地合い 50日線割れ（弱含み・独自判定）・新規買いの目安 0%（独自設定）');
  });
});

// ---- D18: the newer closed session, on the clocks of the specs and the fixture (s1a-results' clock facts) ---------------------

const CLOCK = Object.freeze({
  monMorning: '2026-10-05T15:00:00Z', fixture: '2026-10-03T16:35:00Z', pending: '2026-10-05T20:10:00Z', pastValid: '2026-10-10T12:00:00Z', later: '2026-11-19T00:00:00Z',
  tue: '2026-10-06T16:00:00Z', wed: '2026-10-07T16:00:00Z', twoLater: '2026-10-07T09:00:00Z', withinGrace: '2026-10-06T21:00:00Z',
});
const MARKETS = { m50: {}, m25: pressure, m0: below50Rows };

describe('D18: verdictWaiting with marketUpdateState().target, as the 市場 tab reads it', () => {
  afterEach(() => vi.useRealTimers());

  it('gives the 市場 tab\'s answer on every clock: waiting only for an open guide after a newer close', () => {
    const asset = JSON.parse(marketTrends().text);
    const expected = { monMorning: '2026-10-02', fixture: '2026-10-02', pending: '2026-10-05', pastValid: null, later: null, tue: '2026-10-05', wed: '2026-10-06', twoLater: '2026-10-06', withinGrace: '2026-10-06' };
    // The regime's label without its 独自判定 mark, as the verdict fact prints it (the two markets that can wait).
    const bare = { m50: '上昇トレンド', m25: '上昇に圧力' };
    for (const [clock, iso] of Object.entries(CLOCK)) {
      const target = marketUpdateState(asset, Date.parse(iso)).target;
      expect(target).toBe(expected[clock]);
      for (const [id, mutate] of Object.entries(MARKETS)) {
        const { gate, market, facts } = open({ mutate, target });
        const tab = marketCardView({ market, trends: { data: asset }, date, update: { target } }).verdict;
        const waits = id !== 'm0' && target !== null && target > date;
        expect(gate.band.state === 'waiting').toBe(waits);
        expect(gate.band.waiting?.short ?? null).toBe(tab.leadShort);
        if (waits) {
          expect(gate.band.line1).toBe('地合い 10/2時点の判定・更新待ち');
          expect(gate.band.chip).toBe(`地合い 10/2時点の判定・更新待ち（独自判定）・新規買いの目安 ${capText(market.cap)}（10/2時点・独自設定）`);
          expect(gate.head).toMatchObject({ headline: '10/2時点の判定・更新待ち', headlineWide: tab.lead, figure: capText(market.cap), figureLabel: '新規買いの目安（10/2時点・独自設定）' });
          expect(gate.band.kinds).toEqual({ long: '判定＝独自判定', short: '独自判定' });
          expect(everyText([gate.band, gate.head, facts])).not.toMatch(/検討可|検討できる/);
          expect(facts.find(f => f.key === 'verdict').value).toBe(`${bare[id]}・10/2時点の判定・更新待ち`);
          expect(facts.find(f => f.key === 'guide').asOf).toBe('10/2');
          expect(gate.summary).toBe('根拠と目安が動く条件');
        } else {
          expect(gate.band.line1).toBe(id === 'm0' ? '地合い 買いは控える・目安 0%' : `地合い 検討可・目安 ${capText(market.cap)}`);
        }
      }
    }
  });

  it('on a late publication carries the age apart (warning tone) and never changes the answer; at 0% the verdict words stay', () => {
    const asset = JSON.parse(marketTrends().text);
    const now = Date.parse(CLOCK.twoLater), target = marketUpdateState(asset, now).target;
    const late = freshnessLine(freshness({ trends: { data: asset }, date, now }), date);
    expect(late).toMatchObject({ tone: 'warn', age: '2営業日前' });
    expect(freshnessLine(freshness({ trends: { data: asset }, date, now: Date.parse(CLOCK.pending) }), date)).toBeNull();
    for (const mutate of Object.values(MARKETS)) {
      const pending = open({ mutate, target }), stale = open({ mutate, target, late });
      expect(stale.gate.head).toMatchObject({ kicker: '地合い・10/2（金）引け', age: '2営業日前', ageTone: 'warn' });
      expect(stale.gate.band.age).toBe('2営業日前');
      const { age, ...rest } = stale.gate.band;
      expect(age).toBe('2営業日前');
      expect(rest).toEqual((({ age: _age, ...others }) => others)(pending.gate.band));
      expect(stale.gate.head.headline).toBe(pending.gate.head.headline);
    }
    const zero = open({ mutate: below50Rows, target, late });
    expect(zero.gate.band.line1).toBe('地合い 買いは控える・目安 0%');
    expect(zero.gate.band.line1Labelled).toBe('地合い 買いは控える（独自判定）・目安 0%（独自設定）');
    expect(zero.gate.head.headline).toBe('買いは控える');
    const open50 = open({ target, late });
    expect(open50.gate.band.line1Labelled).toBe('地合い 10/2時点の判定・更新待ち（独自判定）');
    // freshnessLine's unknown form (鮮度未確認) is the bar's, not an age: the band carries none.
    expect(marketBand(open50.market, { date, target, late: { tone: 'unknown', age: '鮮度未確認' } }).age).toBeNull();
  });

  it('reads no clock: every state gives the same model under two system times, and target is required', () => {
    const states = () => {
      const asset = JSON.parse(marketTrends().text), target = marketUpdateState(asset, Date.parse(CLOCK.pending)).target;
      return everyText([open(), open({ mutate: below50Rows }), open({ target }), open({ mutate: pressure, target }), open({ fail: 'manifest' }), open({ loading: true }), open({ historyEnd: sessions.at(-2) })]
        .map(({ gate, facts }) => ({ gate, facts })));
    };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T20:10:00Z'));
    const first = states();
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    expect(states()).toBe(first);
    vi.useRealTimers();
    const market = modelMarket(FIXTURE_ROWS);
    expect(() => marketBand(market, { date })).toThrow(TypeError);
    expect(() => marketGate({ market, date })).toThrow(TypeError);
    expect(() => gateFacts({ market, date }, {})).toThrow(TypeError);
    expect(marketBand(market, { date, target: null }).state).toBe('open');
  });
});

// ---- D14: the conditions are modelMarket's own rule ----------------------------------------------------------------------------

describe('D14: all conditions met exactly when the cap is above 0', () => {
  const row = extra => ({ market: 'US', currency: 'USD', market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true, ...extra });
  const REGIMES = ['confirmed_uptrend', 'uptrend_under_pressure', 'correction', 'downtrend', 'unrecognised_regime', null, 'conflicting'];
  const combos = [];
  for (const above50 of [true, false, null]) for (const above200 of [true, false, null]) for (const regime of REGIMES) combos.push({ above50, above200, regime });
  const rowsOf = ({ above50, above200, regime }) => regime === 'conflicting'
    ? [row({ market_above_50dma: above50, market_above_200dma: above200 }), row({ market_regime: 'uptrend_under_pressure', market_above_50dma: above50, market_above_200dma: above200 })]
    : [row({ market_regime: regime, market_above_50dma: above50, market_above_200dma: above200 })];

  it('holds over all 3 x 3 x 7 inputs, read from rows through modelMarket and marketLines', () => {
    expect(combos).toHaveLength(63);
    for (const combo of combos) {
      const rows = rowsOf(combo), market = modelMarket(rows), conditions = resumeConditions(market, marketLines(rows));
      expect(conditions.met).toBe(market.cap > 0);
      expect(conditions.conditions.map(c => c.key)).toEqual(['above200', 'above50', 'regime']);
      // An unknown market's conditions are all unknown; a judged market's are all known (both lines and the regime).
      if (market.state === 'unknown') expect(conditions.conditions.every(c => c.state === 'unknown')).toBe(true);
      else expect(conditions.conditions.every(c => c.state !== 'unknown')).toBe(true);
      // Two regimes, even two uptrends, never read as a met regime.
      if (combo.regime === 'conflicting') expect(conditions.conditions[2].state).toBe('unknown');
      // The first fold names what is not met; the fold what is; nothing is counted.
      expect(conditions.first.length + conditions.fold.length).toBeGreaterThan(0);
      expect(conditions.first.length).toBeLessThanOrEqual(2);
      expect(everyText(conditions)).not.toMatch(/条件中|undefined|unrecognised_regime/);
      expect(conditions.title).toBe(market.cap > 0 ? '目安が動く条件' : '買いの再開の条件');
      // The band agrees: a figure only for a judged market, never a % when unknown.
      const band = marketBand(market, { target: null });
      if (market.state === 'unknown') expect(everyText(band)).not.toMatch(/%/);
      else expect(band.line1).toBe(market.cap > 0 ? `地合い 検討可・目安 ${capText(market.cap)}` : '地合い 買いは控える・目安 0%');
    }
  });

  it('names an unrecognised regime without its key and an uptrend without any 「いま」', () => {
    const odd = resumeConditions(modelMarket([row({ market_regime: 'unrecognised_regime' })]), { above50: true, above200: true });
    expect(odd.first).toEqual(['局面判定が上昇トレンド／上昇に圧力：未達']);
    const down = resumeConditions(modelMarket([row({ market_regime: 'downtrend' })]), { above50: true, above200: true });
    expect(down.first).toEqual([`局面判定が上昇トレンド／上昇に圧力：未達（いま ${REGIME_NAMES.downtrend}）`]);
    expect(CONDITION_LABELS.regime).toBe(`局面判定が${REGIME_NAMES.confirmed_uptrend}／${REGIME_NAMES.uptrend_under_pressure}`);
    expect(resumeConditions(null, null)).toMatchObject({ allUnknown: true, first: ['再開の条件：未確認'], kind: CONDITION_KIND });
  });
});

// ---- the band's forms agree, and no state counts conditions ---------------------------------------------------------------------

describe('the band\'s phone line, chip and accessible name, and the forbidden forms', () => {
  const asset = JSON.parse(marketTrends().text), target = marketUpdateState(asset, Date.parse(CLOCK.pending)).target;
  const late = freshnessLine(freshness({ trends: { data: asset }, date, now: Date.parse(CLOCK.twoLater) }), date);
  const STATES = {
    m50: open(), m25: open({ mutate: pressure }), below50: open({ mutate: below50Rows }), ftd: open({ mutate: compose(ftdUpgraded, belowFiftyIndex) }),
    ftd5: open({ mutate: compose(ftdUpgraded, belowFiftyIndex, ftdAgo(5)) }), below200: open({ mutate: below200 }), restrain: open({ mutate: restrain }),
    manifest: open({ fail: 'manifest' }), mixed: open({ mutate: mixed }), partunk: open({ mutate: partUnknown }), loading: open({ loading: true }),
    pend50: open({ target }), pend25: open({ mutate: pressure, target }), pend0: open({ mutate: below50Rows, target }),
    late50: open({ target, late }), late25: open({ mutate: pressure, target, late }), late0: open({ mutate: below50Rows, target, late }),
    lag1: open({ historyEnd: sessions.at(-2) }), series: open({ fail: 'series' }), ftdconflict: open({ mutate: compose(ftdUpgraded, belowFiftyIndex, gspcRally(2)) }),
    basisconflict: open({ mutate: ftdUpgraded }),
  };

  it('reads the line, the chip and the name from one value: the same subject, figure and labels', () => {
    for (const { gate } of Object.values(STATES)) {
      const { band } = gate;
      for (const text of [band.line1, band.line1Labelled, band.chip, band.name]) expect(text.startsWith(`${BAND_SUBJECT} `)).toBe(true);
      if (band.guide) {
        // A figure is always preceded by 目安 and carries 独自設定 beside it in the chip; the phone line's labels are on line 2.
        expect(band.chip).toContain(`新規買いの目安 ${band.guide}（`);
        expect(band.chip).toMatch(/独自設定）$/);
        expect(band.name).toContain(band.guide);
        if (band.state !== 'waiting') { expect(band.line1).toBe(`地合い ${band.answer}・目安 ${band.guide}`); expect(band.kinds.short).toBe('独自判定・独自設定'); }
        expect(band.chip.includes(band.label) || band.chip.includes(band.answer)).toBe(true);
        expect(band.name).toContain(band.label);
        expect(gate.head.figure).toBe(band.guide);
      } else {
        expect(everyText([band, gate.head])).not.toMatch(/%/);
      }
      for (const text of [band.line1, band.line1Labelled, band.chip, band.name]) {
        expect(text).not.toMatch(/…|\.\.\./);
        // Every figure is preceded by 目安.
        for (const hit of text.matchAll(/(最大)?\d+%/g)) expect(text.slice(0, hit.index)).toMatch(/目安 $/);
        expect(text.replace(/独自(判定|設定)/g, '')).not.toMatch(/独自/);
      }
    }
  });

  it('never prints a count of conditions, an ASCII minus before a digit, 0 for a missing value, or an order', () => {
    for (const state of Object.values(STATES)) {
      const text = everyText([state.gate, state.facts]);
      expect(text).not.toMatch(/条件中/);
      expect(text).not.toMatch(/-\d/);
      expect(text).not.toMatch(/あと0|してください|推奨|買い時|今すぐ|エントリー|IBD RS/);
      for (const fact of state.facts) if (fact.kind === NO_KIND) expect(fact.value).not.toMatch(/^[0０]|[^0-9]0%|^0/);
    }
  });
});

// ---- gateFacts: the kind table and the groups ---------------------------------------------------------------------------------

describe('gateFacts: one row per fact, each in one group, with its fixed kind', () => {
  it('pins every kind to plan S3-P2\'s table', () => {
    expect(FACT_KINDS).toEqual({ verdict: '独自判定', guide: '独自設定', spyLines: '実測', spyDistribution: '実測・基準は独自設定', indexDistribution: '実測・参考',
      extremes: '実測・参考', above200: '実測・参考', above50: '実測・参考', tt: '独自集計（RS推計を含む）', breakout: '実測・基準は独自設定', health: '独自定義' });
    for (const kind of [...Object.values(FACT_KINDS), CONDITION_KIND, SIGN_KIND]) expect(GATE_KINDS).toContain(kind);
    expect(CONDITION_KIND).toBe('独自設定');
    expect(SIGN_KIND).toBe('独自判定');
    expect(Object.values(GATE_GROUPS)).toEqual(['判定', '根拠（指数側）', '広がり（参考）', '銘柄側（参考・目安は変えません）']);
  });

  it('gives every fact of a fully published day its value and its kind, each fact in exactly one group', () => {
    const { facts } = open({ mutate: compose(upContext, bigCohort) });
    expect(facts.map(f => [f.key, f.group])).toEqual([
      ['verdict', '判定'], ['guide', '判定'],
      ['spyLines', '根拠（指数側）'], ['spyDistribution', '根拠（指数側）'], ['indexDistribution', '根拠（指数側）'], ['extremes', '根拠（指数側）'],
      ['above200', '広がり（参考）'], ['above50', '広がり（参考）'],
      ['tt', '銘柄側（参考・目安は変えません）'], ['breakout', '銘柄側（参考・目安は変えません）'], ['health', '銘柄側（参考・目安は変えません）']]);
    expect(new Set(facts.map(f => f.key)).size).toBe(facts.length);
    for (const fact of facts) expect(fact.kind).toBe(FACT_KINDS[fact.key]);
    const by = Object.fromEntries(facts.map(f => [f.key, f]));
    expect(by.verdict.value).toBe('上昇トレンド・新規の買いを検討できる');
    expect(by.guide).toMatchObject({ value: '最大50%', reading: '最大50%＝新規建ての上限（口座比）' });
    expect(by.spyLines.value).toBe('200日線の上・50日線の上');
    expect(by.spyDistribution).toMatchObject({ value: '2日', reading: `${REGIME_DISTRIBUTION_PRESSURE}日以上で上昇に圧力（独自設定）`, tier: null });
    expect(by.indexDistribution).toMatchObject({ value: 'S&P 3日・NAS 4日', reading: '判定には使わない別集計' });
    expect(by.extremes.value).toBe('新高値 2・新安値 3');
    expect(by.above200.value).toMatch(/^\d+\.\d%$/);
    expect(by.above50.value).toBe('50.0%');
    expect(by.tt.reading).toMatch(/^8条件（RS推計70以上を含む）・1か月前 \d+$/);
    expect(by.breakout.label).toBe('上抜け維持（確定分）');
    expect(by.breakout.value).toMatch(/^\d+%（\d+\/\d+件）$/);
    expect(by.health.value).toBe('70%（21/30銘柄）');
    // The fact rows carry no tone: stock-side numbers have no colour and no ▲.
    expect(everyText(facts.filter(f => f.group === GATE_GROUPS.stock))).not.toMatch(/▲|warn|tone/);
  });

  it('reads the regime\'s SPY count only from a block of the verdict\'s regime, with its grade apart; without one 未収録', () => {
    const counted = n => open({ mutate: { ...pressure, manifest: value => { pressure.manifest(value); value.markets.US.market_context.distribution_days = n; } } }).facts.find(f => f.key === 'spyDistribution');
    expect(counted(4)).toMatchObject({ value: '4日', tier: null, kind: FACT_KINDS.spyDistribution });
    expect(counted(5)).toMatchObject({ value: '5日', tier: '参考（5〜6日）' });
    expect(counted(7)).toMatchObject({ value: '7日', tier: '注意（7日以上）' });
    expect(counted(null)).toMatchObject({ value: '未収録', tier: null, kind: NO_KIND });
    // The default market has no block; a block of another regime is not borrowed.
    expect(open().facts.find(f => f.key === 'spyDistribution')).toMatchObject({ value: '未収録', kind: NO_KIND });
    expect(open({ mutate: { manifest: pressure.manifest } }).facts.find(f => f.key === 'spyDistribution')).toMatchObject({ value: '未収録', kind: NO_KIND });
  });

  it('keeps the threshold of 4 equal to the backend regime\'s DIST_UNDER_PRESSURE', () => {
    const backend = readFileSync(resolve('../backend/app/services/market_regime.py'), 'utf8');
    expect(Number(/^DIST_UNDER_PRESSURE = (\d+)/m.exec(backend)[1])).toBe(REGIME_DISTRIBUTION_PRESSURE);
  });

  it('prints a missing breakout or health count as the row\'s own words, never 0', () => {
    const smallSample = { trends: value => { const last = value.long_history.breadth.at(-1); last.breakoutsJudged = 3; last.breakoutsHeld = 2; last.leaderCohort = 8; last.leaderCohortAbove50 = 5;
      for (const row of value.long_history.breadth) { row.breakoutsJudged = Math.min(row.breakoutsJudged ?? 0, 3) || null; row.leaderCohort = row.leaderCohort === null ? null : 8; } } };
    const { facts } = open({ mutate: smallSample });
    const by = Object.fromEntries(facts.map(f => [f.key, f]));
    expect(by.breakout.value).toMatch(/^\d+件$/);
    expect(by.breakout.reading).toMatch(/件未満のため率は非表示$/);
    expect(by.health.value).toBe('8銘柄');
    expect(by.health.reading).toMatch(/銘柄未満のため率は非表示$/);
    // Without a whole held count there is no rate: the row's own absent words, never a rate of 0.
    const unheld = { trends: value => { for (const row of value.long_history.breadth) row.breakoutsHeld = null; } };
    expect(open({ mutate: unheld }).facts.find(f => f.key === 'breakout')).toMatchObject({ value: '未算出', kind: NO_KIND });
  });
});

describe('gateSign without a series', () => {
  it('has no sign for an unknown market or a series that is not ready', () => {
    expect(gateSign({ market: null })).toBeNull();
    expect(gateSign({ market: modelMarket(FIXTURE_ROWS), trends: { loading: true }, date })).toBeNull();
  });
});
