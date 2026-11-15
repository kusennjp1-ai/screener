// The market tab's study parts (marketTabStudy.js), round 2: the 〔参考〕 checks counted apart, the warning tag of a fired
// distribution count, the direction of a confirmed line, the block's one-line summary and the tag sentence without the
// guide's disclosure (that is said once, in exposureRuleText).
import { describe, expect, it } from 'vitest';
import reference from './market-regime-reference-v1.json' with { type: 'json' };
import { bigUpDayLine, bigUpDays, currentLegLine, distributionDetail, followThroughDetail, marketRegimeContext, marketTabStudy, nasdaqNote, publishedMarketContext, regimeCause, signalTagText, stallingLine, zeroCapNote, BIG_UP_DAY, BIG_UP_HEAD, BIG_UP_NOTE, FTD_SOURCE_GAINS, STALLING_HEAD } from './marketTabStudy.js';
import { KEY_ABSENT } from '../brief/marketTabGroups';
import { followThroughDay, FTD_MIN_DECLINE } from '../followThroughDay';
import { shortDate } from '../brief/briefShared';
import { CONTRACT_DATE, marketContext, marketContextUnknown } from '../../test/fixtures/publishedContracts.js';
import { biasTag, ddGradeState, ftdRecent, INDEX_SYMBOLS, meanLowerStates, referenceState, stateTag, TAGS } from './marketRegimeReference.js';
import { indexSummary } from './indexSummary.js';
import { capText, MARKET_CAPS } from '../portfolioPlan';
import { exposureRuleText } from './marketTabStudy.js';
import { ftdPrevious, FTD_PREVIOUS_NAME, FTD_RECENT_SESSIONS, FTD_TEXT, NASDAQ_CAUTION_STATES } from '../brief/briefEnvironment.js';
import { REFERENCE_CHECKS, verdictBasis } from '../brief/marketTabModel.js';
import { attempt, confirmed, days, failed, trends } from '../../test/fixtures/marketTrends';

const DATE = '2026-10-02', DD = reference.methods.distribution, WINDOW = reference.methods.followThroughWindowSessions;
/** An index series of the study's window ending on its newest point, with the study's method id and `count` active days. */
const series = (item, count) => ({ ...item, method: DD, latest: { ...item.latest, value: count }, lastObserved: { date: item.points[0].date, value: count },
  points: [...days(item.points[0].date, WINDOW).slice(0, -1).map(date => ({ date, value: count, distribution: false, reason: null })), { ...item.points[0], value: count }] });
const make = (counts = [3, 4]) => { const value = trends(); value.data.indices = value.data.indices.map((item, i) => series(item, counts[i])); return value; };

describe('the warning summary\'s study inputs', () => {
  it('tags a fired distribution count with the tag of its graded bucket, the one its 過去の傾向 line carries (MK2)', () => {
    for (const count of [5, 6, 7, 9]) {
      const value = make([count, count]), study = marketTabStudy({ trends: value, reference, date: DATE });
      const lines = marketRegimeContext({ history: value.data.long_history, trends: value, reference, date: DATE }).indices;
      for (const [key, symbol, block] of [['dist-S&P', '^GSPC', lines[0]], ['dist-NAS', '^IXIC', lines[1]]]) {
        const line = block.items.find(item => item.indicator === `${symbol}.dd.graded`);
        expect(line.state).toBe(ddGradeState(count, reference));
        expect(study.signalTags[key]).toEqual(line.parts.tags);
        expect(study.signalTags[key][0]).toBe(stateTag(reference, 'dd.graded', symbol, line.state));
      }
      // 5–6 days are not established on either index; 7 or more is the reference's own robust label.
      expect(study.signalTags['dist-S&P'][0]).toBe(count >= 7 ? TAGS.both : TAGS.unestablished);
    }
  });

  it('names the checks whose tag is 〔参考〕 so the card counts them apart (MK9)', () => {
    const study = marketTabStudy({ trends: make(), reference, date: DATE });
    expect(study.referenceKeys).toEqual(['split', 'lows', 'template', 'stage', 'leaders', 'breakout']);
    // Today never loads the reference: its list (REFERENCE_CHECKS) is this one, so a rebuilt reference cannot drift apart.
    expect(study.referenceKeys).toEqual([...REFERENCE_CHECKS]);
    expect(marketTabStudy({ trends: make(), reference: null, date: DATE }).referenceKeys).toEqual([]);
  });

  it('explains the tags shown without repeating the guide\'s disclosure, which exposureRuleText says once (MK6)', () => {
    const fired = [{ key: 'dist-S&P', tags: [TAGS.unestablished] }, { key: 'lows', tags: [TAGS.breadth] }];
    const { note, legend } = signalTagText(reference, fired);
    expect(legend).toBe('〔参考〕＝指数の下げとの関係は未確認');
    // The years and what the breadth study never tested are said in the note (in the legend they add lines on a phone).
    expect(note).toContain('〔参考〕は、2021〜2026年の参加度データ');
    expect(note).toContain('（全体として偶然と区別できない結果・個別株のブレイクアウト成績との関係は未検証）。');
    expect(note).not.toMatch(/目安|基準と/);
    expect(note.endsWith('その指数では確認できず）。')).toBe(true);
    expect(exposureRuleText()).toContain('注意サインも指数の過去の傾向も目安を変えません。');
  });

  it('notes the Nasdaq by the condition Today\'s 「NAS調整中」 uses', () => {
    for (const state of ['correction', 'rally_attempt', 'ftd_failed', 'confirmed', 'no_correction', 'attempt_expired'])
      expect(Boolean(nasdaqNote({ ...attempt(DATE), state, ...(state === 'ftd_failed' ? { failedDate: DATE, ftd: confirmed(DATE).ftd } : {}) }, DATE))).toBe(NASDAQ_CAUTION_STATES.includes(state));
    expect(nasdaqNote(failed(DATE), DATE).short).toBe('NasdaqはFTD失敗（判定はSPYのみ）');
    // An expired rally attempt is still a correction; its words already say there is no FTD (no 「FTD未確認」).
    const expired = nasdaqNote({ ...attempt(DATE), state: 'attempt_expired' }, DATE);
    expect(expired).toEqual({ long: '判定はS&P 500（SPY）のみに基づきます。Nasdaq総合は調整中・15日以内のFTDなし（独自判定）。', short: 'Nasdaqは調整中（判定はSPYのみ）' });
    expect(nasdaqNote(failed(DATE), DATE).long).not.toContain('FTD未確認');
  });
});

describe('the 過去の傾向 block (MK5)', () => {
  const context = (value, ref = reference) => marketRegimeContext({ history: value.data.long_history, trends: value, reference: ref, date: DATE });
  it('says which way a confirmed line differs from its comparator, and nothing on a line that is not established', () => {
    const ctx = context(make());
    const valued = ctx.indices.flatMap(block => block.items).filter(item => item.parts);
    expect(valued.length).toBeGreaterThan(0);
    for (const item of valued) {
      const confirmedLine = [TAGS.both, TAGS['^GSPC'], TAGS['^IXIC']].includes(item.tag);
      // On the whole percentages the line prints.
      const [shown, against] = [Math.round(item.pDd5), Math.round(item.comparatorPDd5)];
      const expected = !confirmedLine || shown === against ? null : shown > against ? 'higher' : 'lower';
      expect(item.direction).toBe(expected);
      expect(item.parts.comparator).toBe(`（${item.comparatorLabel} ${Math.round(item.comparatorPDd5)}%${expected ? `より${expected === 'higher' ? '多い' : '少ない'}` : ''}）`);
    }
    // An equal share says no direction, even on a confirmed line.
    const ref = structuredClone(reference);
    Object.assign(ref.indicators['^IXIC.dd.graded'].states['3-4'], { pDd5: 26, comparatorPDd5: 26 });
    const equal = context(make(), ref).indices[1].items.find(item => item.indicator === '^IXIC.dd.graded');
    expect([equal.tag, equal.direction, equal.parts.comparator]).toEqual([TAGS['^IXIC'], null, '（全期間 26%）']);
    // Exact shares that differ but print alike (16.4% against 15.6%, both 16%) say no direction either.
    Object.assign(ref.indicators['^IXIC.dd.graded'].states['3-4'], { pDd5: 16.4, comparatorPDd5: 15.6 });
    const rounded = context(make(), ref).indices[1].items.find(item => item.indicator === '^IXIC.dd.graded');
    expect([rounded.direction, rounded.text]).toEqual([null, '分配日3〜4日（10/2時点）：16%（全期間 16%）〔Nasdaqのみ〕']);
    Object.assign(ref.indicators['^IXIC.dd.graded'].states['3-4'], { pDd5: 16.6, comparatorPDd5: 15.4 });
    expect(context(make(), ref).indices[1].items.find(item => item.indicator === '^IXIC.dd.graded').parts.comparator).toBe('（全期間 15%より多い）');
  });

  it('sums the confirmed lines in one summary line, wrapping only between its parts, or says there is no clear difference', () => {
    const ctx = context(make());
    // A state both indices are in, confirmed the same way on each, is one state (the indices move together), never two.
    const states = new Set(ctx.indices.flatMap(block => block.items.filter(item => item.direction).map(item => `${item.indicator.split('.').slice(1).join('.')}|${item.state}|${item.direction}`)));
    const higher = [...states].filter(key => key.endsWith('|higher')).length;
    expect(ctx.summary).toBe(`過去の傾向：下げが多かった状態 ${higher}・少なかった状態 ${states.size - higher}（1990〜2026年）`);
    expect(ctx.summary.split('・')).toHaveLength(2);
    // No confirmed line: no count, never 「0・0」 read as a finding.
    const ref = structuredClone(reference);
    for (const indicator of Object.values(ref.indicators)) for (const state of Object.values(indicator.states)) if (state.labelDd5 === 'robust') state.labelDd5 = 'weak';
    expect(context(make(), ref).summary).toBe('過去の傾向：差がはっきりした状態なし（1990〜2026年）');
    // Unavailable: the old summary, with 予測ではありません.
    expect(context(make(), null).summary).toBe('過去の傾向（予測ではありません）');
  });

  it('keeps the neutral summary when no line could be judged (a legacy publication without the long history)', () => {
    // No long history, no Nasdaq position, no method ids and no follow-through record: every line is a reason.
    const legacy = trends({ history: false });
    legacy.data.indices = legacy.data.indices.map(item => { const old = { ...item }; for (const key of ['method', 'followThrough', 'state']) delete old[key]; return old; });
    const ctx = context(legacy);
    expect(ctx.indices.flatMap(block => block.items).every(item => item.reason && item.state === null)).toBe(true);
    expect(ctx.indices.flatMap(block => block.items)).toHaveLength(8);
    expect(ctx.summary).toBe('過去の傾向（1990〜2026年・予測ではありません）');
    expect(ctx.summary).not.toContain('差がはっきりした状態なし');
  });

  it('counts a state confirmed on both indices once, and the two indices\' different states apart', () => {
    // Both indices above both moving averages on the same day: the S&P's and the Nasdaq's lines say the same thing.
    const value = make();
    const closes = days(DATE, 300).map((date, i) => ({ date, close: 5000 + i * 5 }));
    value.data.long_history = { ...value.data.long_history, sp500: closes };
    value.data.indices[1] = { ...value.data.indices[1], state: { date: DATE, close: 18000, vs50: 2, vs200: 8, fromHigh: -1, fullYear: true } };
    const ctx = context(value);
    const quadrants = ctx.indices.map(block => block.items.find(item => item.indicator.endsWith('.ma.quadrant')));
    expect(quadrants.map(item => [item.state, item.direction])).toEqual([['above_both', 'lower'], ['above_both', 'lower']]);
    const highs = ctx.indices.map(block => block.items.find(item => item.indicator.endsWith('.high.near')));
    expect(highs.map(item => [item.state, item.direction])).toEqual([['near', 'lower'], ['near', 'lower']]);
    // Two states, each on both indices, and the Nasdaq's own 3–4 distribution days: 3 states, never 5 votes.
    expect(ctx.indices.flatMap(block => block.items.filter(item => item.direction))).toHaveLength(5);
    expect(ctx.summary).toBe('過去の傾向：下げが多かった状態 0・少なかった状態 3（1990〜2026年）');
    const lower = Number(/少なかった状態 (\d+)/.exec(ctx.summary)[1]), higher = Number(/多かった状態 (\d+)/.exec(ctx.summary)[1]);
    const all = ctx.indices.flatMap(block => block.items.filter(item => item.direction));
    expect(lower + higher).toBeLessThan(all.length);
    expect(lower).toBe(new Set(all.filter(item => item.direction === 'lower').map(item => `${item.indicator.split('.').slice(1).join('.')}|${item.state}`)).size);
  });
});

describe('the opened 分配日 row (MK7)', () => {
  it('names each index\'s year line, so its caption reads 「S&P　1年の最低 …」', () => {
    const value = make([3, 4]);
    for (const item of value.data.indices) item.points = item.points.map((point, i) => ({ ...point, value: i % 9 }));
    const { yearLines } = distributionDetail(value.data.indices, DATE);
    expect(yearLines.map(line => [line.label, line.name])).toEqual([['S&Pの分配日', 'S&P'], ['NASの分配日', 'NAS']]);
    expect(yearLines[0].format(3)).toBe('3日');
  });
});

// The judge side's block (plan §2.3, the data track's export), read raw: only in shape and for the analysis date.
describe('published market context', () => {
  it('reads the frozen contract the data track publishes against, nulls kept, and says 未収録 for its unknown count', () => {
    const entry = value => ({ as_of_date: CONTRACT_DATE, market_context: value });
    expect(publishedMarketContext(entry(marketContext), { date: CONTRACT_DATE })).toBe(marketContext);
    const unknown = publishedMarketContext(entry(marketContextUnknown), { date: CONTRACT_DATE });
    expect(unknown).toBe(marketContextUnknown);
    expect([unknown.distribution_days, unknown.ftd_date, unknown.ftd_days_since, unknown.exposure_pct]).toEqual([null, null, null, null]);
    const up = { label: '上昇トレンド（独自判定）', cap: 0.5, regime: marketContext.regime, ftdUpgraded: false }, basis = verdictBasis(up, CONTRACT_DATE);
    expect(regimeCause(up, unknown, basis, CONTRACT_DATE)).toBe('局面判定の分配日（SPY）は未収録');
    expect(regimeCause(up, publishedMarketContext(entry(marketContext), { date: CONTRACT_DATE }), basis, CONTRACT_DATE)).toBe(`局面判定の分配日：SPY ${marketContext.distribution_days}日（ストーリング日を含む数え方）`);
    // Its FTD date only through the block; the unknown block leaves the date out, never 0 and never a guess.
    const upgraded = { label: '50日線割れ（弱含み・独自判定）', cap: 0, regime: marketContext.regime, ftdUpgraded: true }, below = verdictBasis(upgraded, CONTRACT_DATE);
    expect(regimeCause(upgraded, marketContext, below, CONTRACT_DATE)).toBe('局面判定はSPYのFTD（9/18）による上昇トレンド。この目安はSPYが50日線の下のため0%（独自判定）');
    expect(regimeCause(upgraded, unknown, below, CONTRACT_DATE)).toBe('局面判定はSPYのFTDによる上昇トレンド。この目安はSPYが50日線の下のため0%（独自判定）');
  });

  const DATE = '2026-10-02';
  const block = { as_of_date: DATE, regime: 'uptrend_under_pressure', distribution_days: 4, ftd_date: null, ftd_days_since: null, exposure_pct: 55, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' };
  it('returns a block of the analysis date, with its nulls kept null', () => {
    
    expect(publishedMarketContext({ as_of_date: DATE, market_context: block }, { date: DATE })).toBe(block);
    const nulls = { ...block, distribution_days: null, exposure_pct: null };
    expect(publishedMarketContext({ as_of_date: DATE, market_context: nulls }, { date: DATE })).toEqual(nulls);
    expect(publishedMarketContext({ as_of_date: DATE, market_context: { ...block, regime: 'confirmed_uptrend', ftd_date: '2026-09-18', ftd_days_since: 10 } }, { date: DATE })).toMatchObject({ ftd_date: '2026-09-18' });
  });
  it('refuses an absent, older or malformed block (an older publication never has one)', () => {
    
    const read = (value, entry = {}) => publishedMarketContext({ as_of_date: DATE, ...entry, market_context: value }, { date: DATE });
    expect(publishedMarketContext({ as_of_date: DATE }, { date: DATE })).toBeNull();
    expect(publishedMarketContext(null, { date: DATE })).toBeNull();
    expect(publishedMarketContext({ as_of_date: DATE, market_context: block })).toBeNull();
    for (const [, value] of [['another date', { ...block, as_of_date: '2026-10-01' }], ['an array', [block]], ['another method', { ...block, method: 'x' }], ['another source', { ...block, source: 'x' }],
      ['an unknown regime', { ...block, regime: 'bull' }], ['a negative count', { ...block, distribution_days: -1 }], ['a count of 0.5', { ...block, distribution_days: 0.5 }], ['a count as text', { ...block, distribution_days: '4' }],
      ['a future FTD', { ...block, ftd_date: '2026-10-05' }], ['an FTD that is not a day', { ...block, ftd_date: '9/18' }], ['an exposure as text', { ...block, exposure_pct: '55' }]]) expect(read(value)).toBeNull();
    expect(read(block, { as_of_date: '2026-10-01' })).toBeNull();
  });
});

// ---- Round 3 (M2): the FTD's age, its opened row and the cause line under a correction ---------------------------------
describe('the FTD\'s age (M2)', () => {
  const at = (sessionsSince, asOf = DATE) => ({ ...confirmed(asOf), ftd: { ...confirmed(asOf).ftd, sessionsSince } });
  it('pins FTD_RECENT_SESSIONS (Today\'s chunk never loads the reference) to the study\'s combo.ftd_recent window', () => {
    expect(FTD_RECENT_SESSIONS).toBe(reference.buckets.ftdRecentSessions);
    // 前回のFTD is exactly what the study does not count as recent: they agree on both sides of the line.
    for (const n of [0, 1, 24, 25, 26, 152]) expect([n, ftdPrevious(at(n))]).toEqual([n, !ftdRecent(at(n), reference)]);
  });

  it('opens the row to the app\'s own rule from FTD_TEXT, the rises by source as a second-hand citation, the failure, 前回のFTD and 過去の傾向', () => {
    const { details } = followThroughDetail();
    expect(details).toEqual([
      `FTDの基準は独自設定（${FTD_TEXT.gain}・${FTD_TEXT.minDay}〜${FTD_TEXT.maxDay}日目・高値から${FTD_TEXT.decline}以上の下落後）。${FTD_SOURCE_GAINS}。`,
      '失敗の判定はFTD当日の安値を終値で割ったとき（独自・出典より早く出る場合があります）。',
      `「n日前」はFTDの日からの営業日数で、${FTD_RECENT_SESSIONS}営業日を過ぎた確認は「${FTD_PREVIOUS_NAME}」と表示します（独自設定）。`,
      'FTDの状態ごとの過去の傾向は、下の「過去の傾向」を参照。',
    ]);
    expect(details[0]).toBe('FTDの基準は独自設定（+1.2%・4〜15日目・高値から6%以上の下落後）。出典ごとの上昇率の目安：1.0%〜1.25%（IBD）、1.7%（William O\'Neil + Co.）（二次資料経由・未確認）。');
    // No study figure is put on the row: neither index's past share sits beside the other's line.
    for (const line of details.slice(1)) expect(line).not.toMatch(/\d+(\.\d+)?%/);
    // The market tab passes the published indices: the same four lines first, then the round 3 lines (M8e, M9).
    const value = make(), tab = marketTabStudy({ trends: value, reference, date: DATE }).followThrough;
    expect(tab).toEqual(followThroughDetail(value.data.indices, DATE));
    expect(tab.details.slice(0, 4)).toEqual(details);
    expect(marketTabStudy({ trends: { loading: true }, reference, date: DATE }).followThrough).toBeNull();
  });

  const block = (regime, over = {}) => ({ as_of_date: DATE, regime, distribution_days: 7, ftd_date: null, ftd_days_since: null, exposure_pct: 0, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows', ...over });
  const held = regime => ({ label: '新規購入を抑制（独自判定）', cap: 0, regime, ftdUpgraded: false });
  const cause = (regime, gspc) => regimeCause(held(regime), block(regime), verdictBasis(held(regime), DATE), DATE, { gspc });
  const LINE = '局面判定の分配日：SPY 7日（ストーリング日を含む数え方）。局面判定は「調整」で、分配日のほか50日線・200日線と参加度も見ます';
  it('says under a correction that the same day\'s confirmed ^GSPC FTD is the index\'s own count, not withdrawn under a 6% decline', () => {
    expect(cause('correction', at(12))).toBe(`${LINE}。下の^GSPCのFTD（8/7）は指数の別集計で、高値から6%未満の下落では取り消しません（独自設定）`);
    expect(cause('downtrend', at(26))).toBe(`局面判定の分配日：SPY 7日（ストーリング日を含む数え方）。局面判定は「下降トレンド」で、分配日のほか50日線・200日線と参加度も見ます。下の^GSPCの${FTD_PREVIOUS_NAME}（8/7）は指数の別集計で、高値から6%未満の下落では取り消しません（独自設定）`);
    // Without the FTD's date the clause leaves the date out, never guessed.
    expect(cause('correction', { ...at(12), ftd: { sessionsSince: 12 } })).toBe(`${LINE}。下の^GSPCのFTDは指数の別集計で、高値から6%未満の下落では取り消しません（独自設定）`);
  });

  it('adds nothing for a record of another day, another state, no record, or a regime that is no correction', () => {
    expect(cause('correction', at(12, '2026-10-01'))).toBe(LINE);
    for (const ft of [attempt(DATE), failed(DATE), { available: false, method: 'm', reason: 'x' }, null]) expect(cause('correction', ft)).toBe(LINE);
    const pressure = { label: '上昇に圧力（独自判定）', cap: 0.25, regime: 'uptrend_under_pressure', ftdUpgraded: false };
    expect(regimeCause(pressure, block('uptrend_under_pressure'), verdictBasis(pressure, DATE), DATE, { gspc: at(12) })).not.toContain('^GSPC');
    const up = { label: '上昇トレンド（独自判定）', cap: 0.5, regime: 'confirmed_uptrend', ftdUpgraded: false };
    expect(regimeCause(up, block('confirmed_uptrend'), verdictBasis(up, DATE), DATE, { gspc: at(12) })).toBe('局面判定の分配日：SPY 7日（ストーリング日を含む数え方）');
    // Through the study: the ^GSPC record of the day comes from the series (gspcFollowThrough).
    const value = make(), market = held('correction'), manifest = { markets: { US: { as_of_date: DATE, market_context: block('correction') } } };
    expect(marketTabStudy({ trends: value, reference, date: DATE, market, manifest }).cause).toBe(`${LINE}。下の^GSPCの${FTD_PREVIOUS_NAME}（8/7）は指数の別集計で、高値から6%未満の下落では取り消しません（独自設定）`);
  });
});

// ---- Round 3 (M5): the 50日線割れ verdict's 0% and what the 過去の傾向 block compares ----------------------------------------
describe('the 50日線割れ verdict\'s 0% (M5)', () => {
  const BELOW_50 = { label: '50日線割れ（弱含み・独自判定）', cap: MARKET_CAPS.otherwise, state: 'weak', regime: 'correction', ftdUpgraded: false };
  const CLOSING = `${capText(0)}は独自設定で、検証された水準ではありません。`;
  /** ^GSPC closes ending on `end`, rising, with the last close `last` (6200: under its 50-day line, over its 200-day line). */
  const sp500 = (end = DATE, n = 300, last = 6200, gap = null) => days(end, n).map((date, i) => ({ date, close: i === n - 1 ? last : i === gap ? null : 5000 + i * 5 }));
  const withHistory = closes => { const value = make(); value.data.long_history = { ...value.data.long_history, sp500: closes }; return value; };
  const note = (value, { market = BELOW_50, ref = reference, date = DATE } = {}) => zeroCapNote({ market, regime: marketRegimeContext({ history: value.data.long_history || null, trends: value, reference: ref, date }), reference: ref, date });
  /** The expected line, from the reference's rows and the readers' tags (no percentage typed here). */
  const figures = (ref = reference) => {
    const row = referenceState(ref, '^GSPC.ma.quadrant', 'above200_below50'), both = referenceState(ref, '^GSPC.ma.quadrant', 'above_both');
    const tags = (state, entry) => [stateTag(ref, 'ma.quadrant', '^GSPC', state), biasTag(entry)].filter(Boolean).join('');
    return `^GSPC・${ref.outcome.horizonSessions}営業日で${Math.abs(ref.outcome.drawdownPercent)}%以上の下げ：この状態 ${Math.round(row.pDd5)}%${tags('above200_below50', row)}／両線の上 ${Math.round(both.pDd5)}%${tags('above_both', both)}／全期間 ${Math.round(row.comparatorPDd5)}%。${CLOSING}`;
  };

  it('joins ^GSPC\'s own cell of the analysis date, as 過去の傾向 judged it, and always ends with the 0% being untested', () => {
    const value = withHistory(sp500()), summary = indexSummary(value.data.long_history.sp500);
    expect([summary.vsMa < 0, summary.vs200 > 0, summary.date]).toEqual([true, true, DATE]);
    const line = note(value);
    expect(line).toBe(figures());
    expect(line.endsWith(CLOSING)).toBe(true);
    // The state is not established on the S&P (〔未確立〕): its tag is printed, never left out.
    expect(stateTag(reference, 'ma.quadrant', '^GSPC', 'above200_below50')).toBe(TAGS.unestablished);
    expect(line).toContain(`この状態 ${Math.round(referenceState(reference, '^GSPC.ma.quadrant', 'above200_below50').pDd5)}%${TAGS.unestablished}／`);
    // The block keeps its own line for that state; the note prints each of its three rows once.
    const block = marketRegimeContext({ history: value.data.long_history, trends: value, reference, date: DATE }).indices[0].items.find(item => item.indicator === '^GSPC.ma.quadrant');
    expect([block.state, block.stateDate]).toEqual(['above200_below50', DATE]);
    for (const word of ['この状態', '両線の上', '全期間']) expect(line.split(word)).toHaveLength(2);
    // Through the study, with the verdict MarketScreen hands it.
    expect(marketTabStudy({ trends: value, reference, date: DATE, market: BELOW_50 }).zeroCap).toBe(line);
    // An FTD-upgraded 50日線割れ (the regime confirmed_uptrend) is the same below-50 state with the same 0%.
    expect(note(value, { market: { ...BELOW_50, regime: 'confirmed_uptrend', ftdUpgraded: true } })).toBe(line);
  });

  it('keeps each state\'s own 〔偏り〕 beside its tag, from the reference', () => {
    const ref = structuredClone(reference);
    ref.indicators['^GSPC.ma.quadrant'].states.above_both.firstHalfShare = 70;
    expect(note(withHistory(sp500()), { ref })).toBe(figures(ref));
    expect(figures(ref)).toContain(`${stateTag(ref, 'ma.quadrant', '^GSPC', 'above_both')}${TAGS.bias}／全期間`);
  });

  it('says the closing sentence alone, no number, when the cell cannot be joined', () => {
    const cases = [
      ['no long history', trends({ history: false })],
      ['an empty ^GSPC history', withHistory([])],
      ['fewer than 200 closes (no 200-day line, the cell\'s window)', withHistory(sp500(DATE, 150))],
      ['an unknown close inside the last 200 (the trailing run never bridges it)', withHistory(sp500(DATE, 300, 6200, 250))],
      ['the last close of an older session', withHistory(sp500(days(DATE, 2)[0]))],
      ['above both lines', withHistory(sp500(DATE, 300, 7000))],
      ['under both lines', withHistory(sp500(DATE, 300, 5500))],
    ];
    for (const [name, value] of cases) expect([name, note(value)]).toEqual([name, CLOSING]);
    // An invalid reference, or a reference row without a share (a null pDd5 is valid in the reference), prints no number.
    const value = withHistory(sp500());
    expect(note(value, { ref: null })).toBe(CLOSING);
    expect(note(value, { ref: { ...reference, outcome: { ...reference.outcome, horizonSessions: 10 } } })).toBe(CLOSING);
    for (const [state, over] of [['above_both', { pDd5: null }], ['above_both', { labelDd5: 'insufficient' }], ['above200_below50', { pDd5: null }], ['above200_below50', { labelDd5: 'insufficient' }], ['above200_below50', { comparatorPDd5: null }]]) {
      const ref = structuredClone(reference);
      Object.assign(ref.indicators['^GSPC.ma.quadrant'].states[state], over);
      expect([state, over, note(value, { ref })]).toEqual([state, over, CLOSING]);
    }
    const ref = structuredClone(reference);
    delete ref.indicators['^GSPC.ma.quadrant'].states.above200_below50;
    expect(note(value, { ref })).toBe(CLOSING);
    // A date the cell is not dated (the analysis date after the history's last close).
    expect(note(value, { date: '2026-10-05' })).toBe(CLOSING);
  });

  it('says nothing for any verdict but 50日線割れ, or a 50日線割れ whose guide is not 0%', () => {
    const value = withHistory(sp500());
    for (const market of [{ label: '上昇トレンド（独自判定）', cap: 0.5 }, { label: '上昇に圧力（独自判定）', cap: 0.25 }, { label: '長期トレンド警戒（独自判定）', cap: 0 }, { label: '新規購入を抑制（独自判定）', cap: 0 },
      { label: '市場未確認', cap: 0, state: 'unknown' }, { label: '市場条件未確認', cap: 0, state: 'unknown' }, null, { ...BELOW_50, cap: 0.25 }]) expect([market, note(value, { market })]).toEqual([market, null]);
    expect(marketTabStudy({ trends: value, reference, date: DATE }).zeroCap).toBeNull();
  });
});

describe('what the 過去の傾向 block compares (M5)', () => {
  const footer = (value, ref = reference) => marketRegimeContext({ history: value.data.long_history, trends: value, reference: ref, date: DATE }).footer;
  const COMPARES = `この欄は下げの頻度の比較です（${reference.outcome.horizonSessions}営業日・${INDEX_SYMBOLS.join('／')}）。`;
  const NO_LOWER = '平均リターンが低かった状態はどちらの指数にもありません。';
  const sp500 = last => days(DATE, 300).map((date, i) => ({ date, close: i === 299 ? last : 5000 + i * 5 }));
  const correction = { ...attempt(DATE), state: 'correction', attempt: null };

  it('says it compares the frequency of declines, and no state had a lower mean while the reference says so', () => {
    expect(meanLowerStates(reference)).toEqual([]);
    // No shown state with a robust higher mean: nothing is named.
    const value = make();
    value.data.long_history = { ...value.data.long_history, sp500: sp500(7000) };
    const plain = footer(value);
    expect(plain).toContain(`独立の確認ではありません。${COMPARES}${NO_LOWER}指数の結果で、個別銘柄の値ではありません。`);
    expect(plain).not.toContain('平均リターンは高め');
    expect(plain).not.toMatch(/どの状態でも|振れ幅/);
  });

  it('names a shown state 「平均リターンは高め」 only by its own row, with the index that shows it', () => {
    const value = make();
    value.data.long_history = { ...value.data.long_history, sp500: sp500(6200) };
    // The Nasdaq in the same cell: its own row has no robust mean, so only the S&P is named.
    value.data.indices[1] = { ...value.data.indices[1], state: { date: DATE, close: 18000, vs50: -2, vs200: 3, fromHigh: -4, fullYear: true } };
    expect(referenceState(reference, '^GSPC.ma.quadrant', 'above200_below50')).toMatchObject({ labelMean: 'robust', meanDirection: 'higher' });
    expect(referenceState(reference, '^IXIC.ma.quadrant', 'above200_below50').labelMean).not.toBe('robust');
    expect(footer(value)).toContain(`${COMPARES}${NO_LOWER}表示中の状態のうち、200日線の上・50日線の下（S&P）は平均リターンは高めでした。指数の結果で`);
    // Both indices in a correction (each row robust and higher): one state, both indices named.
    for (const item of value.data.indices) item.followThrough = { ...correction };
    expect(footer(value)).toContain('表示中の状態のうち、200日線の上・50日線の下（S&P）、調整中（S&P・Nasdaq）は平均リターンは高めでした。');
  });

  it('says nothing of lower means once the reference has one, and still names a shown higher row', () => {
    const ref = structuredClone(reference);
    Object.assign(ref.indicators['^IXIC.ftd.state'].states.ftd_failed, { labelMean: 'robust', meanDirection: 'lower' });
    const value = make();
    value.data.long_history = { ...value.data.long_history, sp500: sp500(6200) };
    const text = footer(value, ref);
    expect(text).toContain(`${COMPARES}表示中の状態のうち、200日線の上・50日線の下（S&P）は平均リターンは高めでした。指数の結果で`);
    expect(text).not.toContain(NO_LOWER);
    value.data.long_history = { ...value.data.long_history, sp500: sp500(7000) };
    expect(footer(value, ref)).toContain(`独立の確認ではありません。${COMPARES}指数の結果で`);
  });
});

// ---- round 3: the stalling line (M8d), the current decline under a confirmed FTD (M8e) and the +3% days (M9) -----------
describe('the opened 分配日 row\'s stalling days (M8d)', () => {
  const live = (item, k) => item.points.at(-1 - k).date;
  const withStalling = (value, records) => { value.data.indices.forEach((item, i) => { if (records[i] !== undefined) item.stalling = records[i]; }); return value; };
  const at = value => stallingLine(value.data.indices, DATE);
  it('says 未収録 with its reason when the publication has no stalling key (every one while emission is off)', () => {
    expect(at(make())).toBe(`${STALLING_HEAD}：${KEY_ABSENT}`);
    expect(STALLING_HEAD).toBe('ストーリング日（独自近似・IBDの定義は非公開・本数に含めません）');
    // The row's method line says the count has none, and the stalling line is the row's last line.
    const { details } = distributionDetail(make().data.indices, DATE);
    expect(details[1]).toBe('下の分配日は^GSPC/^IXICの別集計（ストーリング日を含まない・7日以上で注意、5〜6日は参考）');
    expect(details.at(-1)).toBe(`${STALLING_HEAD}：${KEY_ABSENT}`);
  });
  it('counts each index\'s live days, 0日 for an empty list, the reason of an unavailable or withdrawn record, and dates an older index', () => {
    const value = make(), method = 'stalling-up0.2-higher-volume-lower-half-near3-age25-v1';
    withStalling(value, [{ available: true, method, dates: [live(value.data.indices[0], 4), live(value.data.indices[0], 1)] }, { available: true, method, dates: [] }]);
    expect(at(value)).toBe(`${STALLING_HEAD}：S&P 2日／NAS 0日`);
    withStalling(value, [undefined, { available: false, method, reason: '指数OHLCVに欠測・重複・不正値があります。ゼロ件とは扱いません。' }]);
    expect(at(value)).toBe(`${STALLING_HEAD}：S&P 2日／NAS 算出不可（指数OHLCVに欠測・重複・不正値があります。ゼロ件とは扱いません）`);
    // One index with the key, the other without: each says its own.
    const one = make();delete one.data.indices[1].stalling;withStalling(one, [{ available: true, method, dates: [] }]);
    expect(at(one)).toBe(`${STALLING_HEAD}：S&P 0日／NAS ${KEY_ABSENT}`);
    // Withdrawn by the reader (readMarketTrends' own reason).
    const withdrawn = make();withStalling(withdrawn, [{ available: false, method, reason: 'ストーリング日の形式を確認できません。' }, { available: true, method, dates: [] }]);
    expect(at(withdrawn)).toBe(`${STALLING_HEAD}：S&P 算出不可（ストーリング日の形式を確認できません）／NAS 0日`);
    // An index series ending a session early is dated by its own last session.
    const older = trends({ asOf: '2026-10-01', date: DATE });withStalling(older, [{ available: true, method, dates: [] }, { available: true, method, dates: ['2026-10-01'] }]);
    expect(stallingLine(older.data.indices, DATE)).toBe(`${STALLING_HEAD}：S&P 0日（10/1時点）／NAS 1日（10/1時点）`);
  });
  it('leaves the 過去の傾向 join (method ids, the 280-session window) and the row\'s count unchanged by the round 3 keys', () => {
    const plain = make(), keyed = make(), method = 'stalling-up0.2-higher-volume-lower-half-near3-age25-v1';
    for (const item of keyed.data.indices) item.stalling = { available: true, method, dates: [item.points.at(-2).date] };
    for (const row of keyed.data.long_history.breadth) Object.assign(row, { rs90Cohort: 12, rs90CohortAbove50: 5, newHighsClose: 9, breakoutsEarlyJudged: 8, breakoutsEarlyFailed: 2 });
    const ctx = value => marketRegimeContext({ history: value.data.long_history, trends: value, reference, date: DATE });
    expect(ctx(keyed)).toEqual(ctx(plain));
    expect(ctx(plain).indices.flatMap(block => block.items).filter(entry => !entry.reason).map(entry => entry.indicator)).toEqual(expect.arrayContaining(['^GSPC.dd.graded', '^GSPC.ftd.state', '^IXIC.dd.graded']));
    const study = value => marketTabStudy({ trends: value, reference, date: DATE });
    expect(study(keyed).signalTags).toEqual(study(plain).signalTags);
    expect(study(keyed).distribution.details.slice(0, -1)).toEqual(study(plain).distribution.details.slice(0, -1));
  });
});

describe('the current decline under a confirmed FTD (M8e)', () => {
  /** Daily bars from closes (and optional lows / volumes): open at the previous close, high and low around the session. */
  const bars = (closes, { lows = {}, volumes = {} } = {}) => closes.map((close, i) => { const open = i ? closes[i - 1] : close;
    return { date: days('2026-10-02', closes.length)[i], open, high: Math.max(open, close) + 0.2, low: lows[i] ?? Math.min(open, close) - 0.2, close, volume: volumes[i] ?? 1000 }; });
  // A 8% decline to day 5, a rally attempt from day 6, an FTD on its 4th day (+1.5% on higher volume), a new high, then a pullback.
  const BASE = [100, 98, 96, 94, 93, 92, 92.5, 93, 93.4, 94.8, 96, 95, 93.5, 94];
  const run = (closes, extra = {}) => followThroughDay({ symbol: '^GSPC', bars: bars(closes, { volumes: { 9: 2000 }, ...extra }), asOfDate: '2026-10-02', distributionEvents: [] });
  const line = (ft, date = '2026-10-02') => followThroughDetail([{ symbol: '^GSPC', followThrough: ft }, { symbol: '^IXIC', followThrough: attempt(date) }], date).details;
  it('reads the real state machine\'s leg after an FTD: the decline its 6% test uses, the peak and the low, through the producer', () => {
    const ft = run(BASE);
    expect(ft.state).toBe('confirmed');
    expect(ft.ftd.date).toBe(days('2026-10-02', BASE.length)[9]);
    expect([ft.peak.close, ft.declinePct < 100 * FTD_MIN_DECLINE]).toEqual([96, true]);
    const expected = `S&P：現在の下落 −${ft.declinePct.toFixed(1)}%（高値${shortDate(ft.peak.date, '2026-10-02')}→安値${shortDate(ft.low.date, '2026-10-02')}）・${FTD_TEXT.decline}で調整判定（独自設定）`;
    expect(currentLegLine('S&P', ft, '2026-10-02')).toBe(expected);
    expect(expected).toBe('S&P：現在の下落 −2.6%（高値9/29→安値10/1）・6%で調整判定（独自設定）');
    expect(line(ft)).toContain(expected);
    // The four lines of the row come first, unchanged; the Nasdaq's rally attempt adds no decline line.
    expect(line(ft).slice(0, 4)).toEqual(followThroughDetail().details);
    expect(line(ft).filter(text => text.includes('現在の下落'))).toEqual([expected]);
  });
  it('shows nothing once the pullback reaches 6%: the state machine has left the confirmed state', () => {
    const ft = run([...BASE.slice(0, -2), 92, 90]);
    expect(ft.state).not.toBe('confirmed');
    expect(currentLegLine('S&P', ft, '2026-10-02')).toBeNull();
  });
  it('shows nothing at a new high (no decline), for the synthetic 7.6 of a confirmed record, for any other state or an unavailable record', () => {
    const ft = run([...BASE.slice(0, -4), 96, 97]);
    expect([ft.state, ft.declinePct]).toEqual(['confirmed', null]);
    expect(currentLegLine('S&P', ft, '2026-10-02')).toBeNull();
    expect(currentLegLine('S&P', { ...confirmed('2026-10-02'), declinePct: 7.6 }, '2026-10-02')).toBeNull();
    for (const record of [attempt('2026-10-02'), failed('2026-10-02'), { available: false, method: 'x', reason: 'r' }, undefined]) expect(currentLegLine('S&P', record, '2026-10-02')).toBeNull();
  });
  it('never rounds a decline under 6% onto 6.0, never prints −0.0, and dates an older record', () => {
    const at = declinePct => currentLegLine('S&P', { ...confirmed('2026-10-02'), declinePct }, '2026-10-02');
    expect(at(5.996)).toMatch(/^S&P：現在の下落 −5\.99%（/);
    expect(at(5.95)).toMatch(/^S&P：現在の下落 −5\.95%（/);
    expect(at(5.94)).toMatch(/^S&P：現在の下落 −5\.9%（/);
    expect(at(0.04)).toMatch(/^S&P：現在の下落 −0\.04%（/);
    expect(at(0)).toMatch(/^S&P：現在の下落 0\.0%（/);
    expect(currentLegLine('NAS', { ...confirmed('2026-10-01'), declinePct: 2 }, '2026-10-02')).toBe('NAS（10/1時点）：現在の下落 −2.0%（高値7/1→安値8/1）・6%で調整判定（独自設定）');
  });
});

describe('the +3% days (M9)', () => {
  const series = changes => changes.reduce((list, change) => [...list, Math.round(list.at(-1) * (1 + change) * 100) / 100], [1000]).map((close, i, all) => ({ date: days('2026-10-02', all.length)[i], close }));
  const indices = (sp, nas) => [{ symbol: '^GSPC', ...(sp === undefined ? {} : { closes: sp }) }, { symbol: '^IXIC', ...(nas === undefined ? {} : { closes: nas }) }];
  it('pins the constant and counts closes at least +3% above the previous one over the comparisons made', () => {
    expect(BIG_UP_DAY).toBe(0.03);
    expect(BIG_UP_HEAD).toBe('+3%以上の上昇日');
    expect(bigUpDays(series([0.01, -0.02, 0.005]))).toEqual({ sessions: 3, count: 0, date: '2026-10-02' });
    expect(bigUpDays(series([0.031, -0.02, 0.045, 0.01, 0.0305]))).toEqual({ sessions: 5, count: 3, date: '2026-10-02' });
    // Exactly +3.00% counts, also where the ratio's floating point falls just under 1.03; +2.99% does not.
    expect(1102.1 / 1070 - 1 < 0.03).toBe(true);
    expect(bigUpDays([{ date: '2026-10-01', close: 1070 }, { date: '2026-10-02', close: 1102.1 }]).count).toBe(1);
    expect(bigUpDays([{ date: '2026-10-01', close: 1000 }, { date: '2026-10-02', close: 1029.9 }]).count).toBe(0);
    expect(bigUpDays([{ date: '2026-10-02', close: 1000 }])).toBeNull();
    expect(bigUpDays(undefined)).toBeNull();
  });
  it('says each index\'s count in one line with the caveat once, dates an older series, and says 未収録（旧形式） without closes', () => {
    const sp = series([0.031, -0.02, 0.045]), nas = series([0.01, 0.002]);
    expect(bigUpDayLine(indices(sp, nas), '2026-10-02')).toBe(`${BIG_UP_HEAD}：S&P 直近3営業日で2回／NAS 直近2営業日で0回（${BIG_UP_NOTE}）`);
    expect(BIG_UP_NOTE).toBe('弱気相場・調整中に多い。買いの合図ではありません');
    const behind = sp.slice(0, -1);
    expect(bigUpDayLine(indices(behind, nas), '2026-10-02')).toBe(`${BIG_UP_HEAD}：S&P 直近2営業日で1回（10/1時点）／NAS 直近2営業日で0回（${BIG_UP_NOTE}）`);
    expect(bigUpDayLine(indices(), '2026-10-02')).toBe(`${BIG_UP_HEAD}：未収録（旧形式）`);
    expect(bigUpDayLine(indices(sp), '2026-10-02')).toBe(`${BIG_UP_HEAD}：S&P 直近3営業日で2回／NAS 未収録（旧形式）（${BIG_UP_NOTE}）`);
    // Closes the reader withdrew say why, never 0.
    const withdrawn = indices(undefined, nas);withdrawn[0].closes_error = '指数の終値の形式を確認できません。';
    expect(bigUpDayLine(withdrawn, '2026-10-02')).toBe(`${BIG_UP_HEAD}：S&P 算出不可（指数の終値の形式を確認できません）／NAS 直近2営業日で0回（${BIG_UP_NOTE}）`);
    // It is the opened フォロースルーデー row's last line on the market tab.
    expect(followThroughDetail(indices(sp, nas), '2026-10-02').details.at(-1)).toBe(bigUpDayLine(indices(sp, nas), '2026-10-02'));
  });
});
