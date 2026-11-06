import { describe, expect, it } from 'vitest';
import { breakoutEvent, candidateView, earningsCall, trendTemplate } from './briefCandidate';
import { crossingEvent } from './breakoutHistory';
import { baseCheck, buyGate, HEAVY_DOWN_NOTE, marketGuidePercent, PLAN_BLOCKED, SE_BELOW_FLOOR_CHECK, SE_CONFIDENCE_FLOOR, templateReference } from './buyGate';
import { conditionNote } from '../missingCondition';
import { withAuditFixture } from '../testAuditFixture';

const DAY = '2026-10-02';
const OPEN = { label: '上昇トレンド（独自判定）', cap: 0.5 };
const HOLD = { label: '50日線割れ（弱含み・独自判定）', cap: 0 };
const NOW = Date.parse(`${DAY}T19:00:00Z`);
/** A verified research row for DAY: TT 8/8 in a confirmed uptrend, with a current Setup Engine base at confidence 60. */
const audited = ({ price = 101, pivot = 100, change = 2, volume = 1.6, rs = 90, ...extra } = {}) => {
  const row = withAuditFixture({ symbol: 'AAA', market: 'US', currency: 'USD', company_name: 'Alpha', current_price: price, se_pivot_price: pivot, rs_rating: rs,
    setup_recalculation: { status: 'calculated', as_of_date: DAY }, se_pattern_confidence: 60, ...extra }, DAY);
  Object.assign(row.technical_audit.values, { change, volumeRatio: volume });
  return row;
};
const subject = (over = {}) => {
  const row = audited(over), template = trendTemplate(row);
  const assessment = { qualified: template.qualified, passed: template.passed + (template.integrity?.state === 'pass' ? 1 : 0), failed: template.failed, unknown: template.unknown, total: 9 };
  return { row, template, view: candidateView({ row, assessment }, DAY) };
};
const gateOf = (over = {}, context = {}) => {
  const { view, template } = subject(over);
  return buyGate({ view, template, market: OPEN, earnings: earningsCall(view, NOW), ...context });
};
const check = (key, extra = {}) => ({ key, label: key, state: 'hit', detail: `${key} の詳細`, ...extra });
const sells = (...weakness) => ({ strength: [], weakness });
/** Certified bars ending on DAY: under 100, then above it for `ago` sessions before DAY's 103. */
const crossed = ago => {
  const day = i => new Date(Date.UTC(2026, 6, 1) + i * 86400000).toISOString().slice(0, 10);
  const closes = [...Array(60 - ago).fill(95), ...Array(ago).fill(102)];
  return [...closes.map((close, i) => ({ date: day(i), close })), { date: DAY, close: 103 }];
};

describe('the one buy gate', () => {
  it('keeps the green case exactly as it is: a qualified TT 8/8 stock, an open market, the day\'s breakout, a current base, no warnings', () => {
    const { view } = subject();
    expect(gateOf()).toEqual({ kind: 'breakout', tone: 'zone', title: breakoutEvent(view).title, note: null, units: [], reference: false, moved: false, reason: null, blocked: null, trialOnly: false, event: breakoutEvent(view) });
    // A breakout dated from certified bars within 10 sessions is green too, with the conclusion's dated title.
    const after = subject({ price: 103, change: 1 });
    const dated = buyGate({ view: after.view, template: after.template, market: OPEN, earnings: null, judged: crossed(4) });
    expect(dated).toMatchObject({ kind: 'after', tone: 'zone', reference: false, reason: null, moved: false, note: null, title: crossingEvent(after.view, crossed(4)).title });
  });

  it('a heavy down day in the zone is a reference with its reason, and never the buy range', () => {
    const { view } = subject({ change: -1 });
    const gate = gateOf({ change: -1 });
    expect(gate).toMatchObject({ kind: 'heavyDown', tone: 'ext', title: breakoutEvent(view).title, note: HEAVY_DOWN_NOTE, reference: true, reason: '下落日の大商い', moved: false });
    expect(gate.note).not.toContain('買いの範囲');
    expect(HEAVY_DOWN_NOTE).toContain('独自判定');
  });

  it('a market with a cap of 0 is a neutral hold with 参考（地合い）; an unknown or missing one is 地合い未確認', () => {
    expect(gateOf({}, { market: HOLD })).toMatchObject({ kind: 'marketHold', tone: 'neutral', title: '地合いが新規の買いを控える状態（独自判定）', reference: true, moved: true, reason: '地合い', trialOnly: true });
    for (const market of [{ label: '市場未確認', cap: 0, state: 'unknown' }, null]) {
      expect(gateOf({}, { market })).toMatchObject({ kind: 'marketUnknown', tone: 'neutral', title: '地合い未確認（新規の買いは判断を保留）', reference: true, reason: '地合い未確認', trialOnly: true });
    }
    expect([marketGuidePercent(OPEN), marketGuidePercent(HOLD), marketGuidePercent({ cap: 0.5, state: 'unknown' }), marketGuidePercent(null)]).toEqual([50, 0, null, null]);
  });

  it('a broken setup and a failed breakout are neutral calls that name the check, whatever the position (崩れ)', () => {
    const ma50 = check('ma50', { headline: '50日線割れ（9/22・出来高2.20×）' });
    expect(gateOf({}, { sells: sells(ma50) })).toMatchObject({ kind: 'broken', tone: 'neutral', title: '買いの前提が崩れた（独自判定）', note: '50日線割れ（9/22・出来高2.20×）。', units: ['50日線割れ（9/22・出来高2.20×）'], reference: true, moved: true, reason: '崩れ' });
    const failed = check('failedBreakout', { crossDate: '2026-09-28', ratio: 2.1, headline: 'ブレイク失敗（9/28上抜け・出来高2.10×）' });
    // Below the pivot again (near it): never the wait sentence of a stock that has not broken out yet.
    expect(gateOf({ price: 99 }, { sells: sells(failed) })).toMatchObject({ kind: 'failedBreakout', tone: 'neutral', title: 'ブレイク失敗（独自判定）', note: '9/28に出来高2.10×で上抜け、ピボットの下へ戻りました。', reference: true, moved: true, reason: '崩れ' });
    // The plan's caller has only the flag: the same reason.
    expect(gateOf({}, { broken: true })).toMatchObject({ kind: 'broken', note: null, reason: '崩れ', reference: true });
    // A check that is not a hit breaks nothing.
    expect(gateOf({}, { sells: sells({ ...failed, state: 'unknown' }) })).toMatchObject({ kind: 'breakout', reference: false });
  });

  it('an unmet RS estimate alone is counted in the one-line title and named with its threshold (conditionNote)', () => {
    const { template } = subject({ rs: 57 });
    const rule = template.rules.find(r => /^RS 推計/.test(r.label));
    expect(gateOf({ rs: 57 })).toMatchObject({ kind: 'template', tone: 'neutral', title: 'TT 1条件未達 — 買いの対象外', note: `${conditionNote(rule)}。`, units: ['RS推計 57（基準70）'], reference: true, moved: true, reason: 'TT未達' });
    // Unknown rules: TT未確認, never passed.
    const unknown = audited();
    unknown.technical_audit.values.sma200_21ago = null;
    const t = trendTemplate(unknown);
    expect(buyGate({ view: candidateView({ row: unknown, assessment: { qualified: false, passed: 8, failed: 0, unknown: 1, total: 9 } }, DAY), template: t, market: OPEN })).toMatchObject({ title: 'TT未確認・買い判断不可', reason: 'TT未確認' });
    expect(templateReference(null)).toBe('TT未確認');
  });

  it('checks the Setup Engine base after a broken setup and before the market: weak, missing, stale or failed-check confidence is 参考 (土台未確認)', () => {
    const weak = gateOf({ se_pattern_confidence: 31 });
    expect(weak).toMatchObject({ kind: 'baseCheck', tone: 'neutral', title: '土台を確認できない — ピボットは参考（独自判定）', note: `信頼度 31（基準${SE_CONFIDENCE_FLOOR}）。`, reference: true, moved: true, reason: '土台未確認' });
    expect(gateOf({ se_pattern_confidence: null }).note).toBe('信頼度 未確認。');
    expect(gateOf({ se_pattern_confidence: 54.9 }).note).toBe('信頼度 54（基準55）。');
    expect(gateOf({ setup_recalculation: { status: 'calculated', as_of_date: DAY, reason: `${SE_BELOW_FLOOR_CHECK} / missing_detector` } }).note).toBe('信頼度が基準55未満。');
    expect(gateOf({ setup_recalculation: { status: 'calculated', as_of_date: '2026-10-01' } }).note).toBe('土台の再計算が分析日のものではありません（10/1）。');
    expect(gateOf({ setup_recalculation: { status: 'unavailable', as_of_date: DAY, reason: 'No validated history' } }).note).toBe('土台の再計算不可。');
    expect(gateOf({ setup_recalculation: undefined }).note).toBe('土台の再計算 未確認。');
    // At the floor it is current.
    expect(gateOf({ se_pattern_confidence: SE_CONFIDENCE_FLOOR })).toMatchObject({ kind: 'breakout', reference: false });
    expect(SE_CONFIDENCE_FLOOR).toBe(55);
    // The order: a broken setup first; the base before the market and earnings.
    expect(gateOf({ se_pattern_confidence: 31 }, { broken: true }).kind).toBe('broken');
    expect(gateOf({ se_pattern_confidence: 31 }, { market: HOLD })).toMatchObject({ kind: 'baseCheck', reason: '土台未確認' });
    // Near the pivot too; below it (土台形成中) the call is the position's, with the plan's reason.
    expect(gateOf({ price: 98, se_pattern_confidence: 31 }).kind).toBe('baseCheck');
    expect(gateOf({ price: 90, se_pattern_confidence: 31 })).toMatchObject({ kind: 'basePosition', tone: 'neutral', reference: false, reason: '土台未確認' });
    expect(baseCheck({ asOf: DAY, row: { setup_recalculation: { status: 'calculated', as_of_date: DAY }, se_pattern_confidence: 60 } })).toEqual({ current: true, note: null });
    expect(baseCheck(null)).toEqual({ current: false, note: '土台の再計算 未確認' });
  });

  it('earnings within 10 days stop the green call (決算前), after the market', () => {
    const row = { entry_evidence: { earnings: { date: '2026-10-05' } } };
    const { view } = subject(row);
    const call = earningsCall(view, NOW);
    expect(gateOf(row)).toMatchObject({ kind: 'earnings', tone: 'neutral', title: call.line, reference: true, moved: true, reason: '決算前' });
    expect(gateOf(row, { market: HOLD })).toMatchObject({ kind: 'marketHold', reason: '地合い' });
  });

  it('a breakout still in the zone after 10 sessions waits for the next pivot (停滞); one it cannot date waits too, without 参考', () => {
    const after = subject({ price: 103, change: 1 });
    const stale = buyGate({ view: after.view, template: after.template, market: OPEN, judged: crossed(12) });
    expect(stale).toMatchObject({ kind: 'stale', tone: 'wait', title: '上抜けから12営業日・伸びずに停滞（新規は次のピボット待ち）', reference: true, reason: '停滞', moved: false });
    const undated = buyGate({ view: after.view, template: after.template, market: OPEN, judged: null });
    expect(undated).toMatchObject({ kind: 'undated', tone: 'wait', title: '買いゾーン内（上抜け日 未確認）', reference: false, reason: null });
  });

  it('a position that gets no plan says why (blocked), and only the zone and near the pivot are stopped by the market', () => {
    const ext = gateOf({ price: 112 });
    expect(ext).toMatchObject({ kind: 'ext', tone: 'ext', blocked: PLAN_BLOCKED.ext, reference: false });
    expect(gateOf({ price: 112 }, { market: HOLD })).toMatchObject({ kind: 'ext', reason: '地合い', reference: false });
    expect(buyGate({ view: null })).toMatchObject({ kind: 'unjudged', reason: null, blocked: null, trialOnly: true });
  });
});
