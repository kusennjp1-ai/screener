// The market tab's study parts (marketTabStudy.js), round 2: the 〔参考〕 checks counted apart, the warning tag of a fired
// distribution count, the direction of a confirmed line, the block's one-line summary and the tag sentence without the
// guide's disclosure (that is said once, in exposureRuleText).
import { describe, expect, it } from 'vitest';
import reference from './market-regime-reference-v1.json' with { type: 'json' };
import { distributionDetail, marketRegimeContext, marketTabStudy, nasdaqNote, publishedMarketContext, signalTagText } from './marketTabStudy.js';
import { ddGradeState, stateTag, TAGS } from './marketRegimeReference.js';
import { exposureRuleText } from '../portfolioPlan.js';
import { NASDAQ_CAUTION_STATES } from '../brief/briefEnvironment.js';
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
    expect(marketTabStudy({ trends: make(), reference: null, date: DATE }).referenceKeys).toEqual([]);
  });

  it('explains the tags shown without repeating the guide\'s disclosure, which exposureRuleText says once (MK6)', () => {
    const fired = [{ key: 'dist-S&P', tags: [TAGS.unestablished] }, { key: 'lows', tags: [TAGS.breadth] }];
    const { note, legend } = signalTagText(reference, fired);
    expect(legend).toBe('〔参考〕＝2021〜26年の検証で関係未確認');
    expect(note).not.toMatch(/目安|基準と/);
    expect(note.endsWith('その指数では確認できず）。')).toBe(true);
    expect(exposureRuleText()).toContain('注意サインも指数の過去の傾向も目安を変えません。');
  });

  it('notes the Nasdaq by the condition Today\'s 「NAS調整中」 uses', () => {
    for (const state of ['correction', 'rally_attempt', 'ftd_failed', 'confirmed', 'no_correction', 'attempt_expired'])
      expect(Boolean(nasdaqNote({ ...attempt(DATE), state, ...(state === 'ftd_failed' ? { failedDate: DATE, ftd: confirmed(DATE).ftd } : {}) }, DATE))).toBe(NASDAQ_CAUTION_STATES.includes(state));
    expect(nasdaqNote(failed(DATE), DATE).short).toBe('NasdaqはFTD失敗（判定はSPYのみ）');
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
      const expected = !confirmedLine || item.pDd5 === item.comparatorPDd5 ? null : item.pDd5 > item.comparatorPDd5 ? 'higher' : 'lower';
      expect(item.direction).toBe(expected);
      expect(item.parts.comparator).toBe(`（${item.comparatorLabel} ${Math.round(item.comparatorPDd5)}%${expected ? `より${expected === 'higher' ? '多い' : '少ない'}` : ''}）`);
    }
    // An equal share says no direction, even on a confirmed line.
    const ref = structuredClone(reference);
    Object.assign(ref.indicators['^IXIC.dd.graded'].states['3-4'], { pDd5: 26, comparatorPDd5: 26 });
    const equal = context(make(), ref).indices[1].items.find(item => item.indicator === '^IXIC.dd.graded');
    expect([equal.tag, equal.direction, equal.parts.comparator]).toEqual([TAGS['^IXIC'], null, '（全期間 26%）']);
  });

  it('sums the confirmed lines in one summary line, wrapping only between its parts, or says there is no clear difference', () => {
    const ctx = context(make());
    const directions = ctx.indices.flatMap(block => block.items.map(item => item.direction)).filter(Boolean);
    const higher = directions.filter(value => value === 'higher').length;
    expect(ctx.summary).toBe(`過去の傾向：下げが多かった状態 ${higher}・少なかった状態 ${directions.length - higher}（1990〜2026年）`);
    expect(ctx.summary.split('・')).toHaveLength(2);
    // No confirmed line: no count, never 「0・0」 read as a finding.
    const ref = structuredClone(reference);
    for (const indicator of Object.values(ref.indicators)) for (const state of Object.values(indicator.states)) if (state.labelDd5 === 'robust') state.labelDd5 = 'weak';
    expect(context(make(), ref).summary).toBe('過去の傾向：差がはっきりした状態なし（1990〜2026年）');
    // Unavailable: the old summary, with 予測ではありません.
    expect(context(make(), null).summary).toBe('過去の傾向（予測ではありません）');
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
