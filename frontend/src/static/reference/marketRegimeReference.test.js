import { describe, expect, it } from 'vitest';
import reference from './market-regime-reference-v1.json' with { type: 'json' };
import { biasTag, ddGradeState, ftdRecent, ftdState, highState, meanLowerStates, quadrantState, referencePeriod, referenceState, signalTags, stateTag, validReference, SIGNAL_INDICATORS, TAGS } from './marketRegimeReference.js';

const copy = () => structuredClone(reference);
const METHODS = { distribution: reference.methods.distribution, followThrough: reference.methods.followThrough, followThroughWindow: reference.methods.followThroughWindowSessions };

describe('the committed reference', () => {
  it('is a valid market-regime-reference-v1, and a broken one is refused', () => {
    expect(validReference(reference)).toBe(true);
    for (const breakIt of [
      ref => { ref.schema_version = 'market-regime-reference-v2'; },
      ref => { delete ref.methods.distribution; },
      ref => { ref.outcome.horizonSessions = 10; },
      ref => { ref.indicators['^GSPC.ma.quadrant'].states.above_both.labelDd5 = 'strong'; },
      ref => { ref.indicators['^GSPC.ma.quadrant'].states.above_both.pDd5 = 120; },
      ref => { ref.indicators['^GSPC.ma.quadrant'].states.above_both.comparator = 'average'; },
      ref => { ref.breadth['rule.lows'] = { labelDd5: 'robust' }; },
      ref => { delete ref.samples['^IXIC']; },
      ref => { delete ref.methods.followThroughWindowSessions; },
      // A mean direction only with a robust mean label, and only as a word.
      ref => { ref.indicators['^GSPC.ma.quadrant'].states.above_both.meanDirection = 'higher'; },
      ref => { ref.indicators['^GSPC.ftd.state'].states.correction.meanDirection = 1.22; },
      ref => { delete ref.indicators['^GSPC.ftd.state'].states.correction.meanDirection; },
    ]) { const ref = copy(); breakIt(ref); expect(validReference(ref)).toBe(false); }
    expect(validReference(null)).toBe(false);
  });

  it('spans 1990-2026 on both indices', () => {
    expect(referencePeriod(reference)).toEqual({ first: '1990-01-02', last: '2026-11-03', fromYear: '1990', toYear: '2026', same: true });
  });

  it('has no state with a robustly lower mean return on either index (the study block\'s footer says so)', () => {
    expect(meanLowerStates(reference)).toEqual([]);
    const robust = Object.entries(reference.indicators).flatMap(([key, indicator]) => Object.entries(indicator.states).filter(([, state]) => state.labelMean === 'robust').map(([state, row]) => [key, state, row.meanDirection]));
    expect(robust).toEqual([['^GSPC.ftd.state', 'correction', 'higher'], ['^GSPC.ma.quadrant', 'above200_below50', 'higher'], ['^IXIC.ftd.state', 'correction', 'higher']]);
    const ref = copy(); ref.indicators['^IXIC.ma.quadrant'].states.below_both = { ...ref.indicators['^IXIC.ma.quadrant'].states.below_both, labelMean: 'robust', meanDirection: 'lower' };
    expect(meanLowerStates(ref)).toEqual([['^IXIC.ma.quadrant', 'below_both']]);
  });

  it('labels no breadth rule robust: the 〔参考〕 legend 「検証で関係未確認」 relies on it', () => {
    expect(Object.values(reference.breadth).every(rule => rule.labelDd5 !== 'robust')).toBe(true);
  });
});

describe('tags', () => {
  it('tags a state from its own label and the other index\'s', () => {
    expect(stateTag(reference, 'ma.quadrant', '^GSPC', 'above_both')).toBe(TAGS.both);
    expect(stateTag(reference, 'high.near', '^IXIC', 'below')).toBe(TAGS.both);
    expect(stateTag(reference, 'dd.binary', '^GSPC', 'warn')).toBe('〔S&Pのみ〕');
    // Robust on the other index only: not established here.
    expect(stateTag(reference, 'dd.binary', '^IXIC', 'warn')).toBe('〔未確立〕');
    expect(stateTag(reference, 'dd.graded', '^IXIC', '3-4')).toBe('〔Nasdaqのみ〕');
    expect(stateTag(reference, 'dd.graded', '^GSPC', '3-4')).toBe('〔未確立〕');
    expect(stateTag(reference, 'ftd.state', '^GSPC', 'no_correction_pending')).toBe('〔標本不足〕');
    expect(stateTag(reference, 'ftd.state', '^GSPC', 'nope')).toBeNull();
  });

  it('adds 〔偏り〕 at a first-half share of 60% or more, or 40% or less', () => {
    expect([39.9, 40, 40.1, 59.9, 60, 60.1].map(share => biasTag({ firstHalfShare: share }))).toEqual([TAGS.bias, TAGS.bias, null, null, TAGS.bias, TAGS.bias]);
    expect(biasTag({ firstHalfShare: null })).toBeNull();
    expect(biasTag(referenceState(reference, '^IXIC.ma.quadrant', 'below_both'))).toBe(TAGS.bias);
    expect(biasTag(referenceState(reference, '^GSPC.ma.quadrant', 'below_both'))).toBeNull();
  });

  it('maps every warning-summary check to its study indicator (tested here, never by name matching)', () => {
    expect(Object.fromEntries(Object.entries(SIGNAL_INDICATORS).map(([key, map]) => [key, map.breadth || `${map.symbol}.${map.suffix}:${map.state}`]))).toEqual({
      'dist-S&P': '^GSPC.dd.binary:warn', 'dist-NAS': '^IXIC.dd.binary:warn', 'ftd-S&P': '^GSPC.ftd.state:ftd_failed', 'ftd-NAS': '^IXIC.ftd.state:ftd_failed',
      split: 'rule.split', lows: 'rule.lows', template: 'rule.template', stage: 'rule.stage', leaders: 'rule.leaders', breakout: 'rule.breakout' });
    expect(Object.fromEntries(Object.keys(SIGNAL_INDICATORS).map(key => [key, signalTags(reference, key, METHODS)]))).toEqual({
      'dist-S&P': ['〔S&Pのみ〕'], 'dist-NAS': ['〔未確立〕'], 'ftd-S&P': ['〔S&Pのみ〕', '〔偏り〕'], 'ftd-NAS': ['〔未確立〕'],
      split: ['〔参考〕'], lows: ['〔参考〕'], template: ['〔参考〕'], stage: ['〔参考〕'], leaders: ['〔参考〕'], breakout: ['〔参考〕'] });
    // An index check whose published method is not the study's, or unknown, gets no tag; nor a follow-through judged
    // on another window than the study's.
    expect(signalTags(reference, 'dist-S&P', { ...METHODS, distribution: 'other-v1' })).toEqual([]);
    expect(signalTags(reference, 'ftd-S&P', {})).toEqual([]);
    expect(signalTags(reference, 'ftd-S&P', { ...METHODS, followThroughWindow: 279 })).toEqual([]);
    expect(signalTags(reference, 'dist-S&P', { ...METHODS, followThroughWindow: 279 })).toEqual(['〔S&Pのみ〕']);
    expect(signalTags(reference, 'unknown-check', METHODS)).toEqual([]);
    expect(signalTags(null, 'lows', METHODS)).toEqual([]);
    // A breadth rule the study found robust is not 〔参考〕.
    const ref = copy(); ref.breadth['rule.lows'].labelDd5 = 'robust';
    expect([signalTags(ref, 'lows', METHODS), signalTags(ref, 'split', METHODS)]).toEqual([[], ['〔参考〕']]);
  });
});

describe('states, judged as the study judged them', () => {
  it('places the 50/200-day cell only with both distances, above meaning strictly above', () => {
    expect([[3.48, 1.73], [-1, 2], [1, -2], [-1, -2], [0, 1], [1, 0]].map(([vsMa, vs200]) => quadrantState({ vsMa, vs200 })))
      .toEqual(['above_both', 'above200_below50', 'below200_above50', 'below_both', 'above200_below50', 'below200_above50']);
    expect(quadrantState({ vsMa: 1, vs200: null })).toBeNull();
    expect(quadrantState(null)).toBeNull();
  });

  it('judges the high state only on a full year, -5% itself counting as near', () => {
    expect(highState({ fromHigh: -5.29, fullYear: true }, 5)).toBe('below');
    expect(highState({ fromHigh: -5, fullYear: true }, 5)).toBe('near');
    expect(highState({ fromHigh: -1, fullYear: false }, 5)).toBeNull();
    expect(highState({ fromHigh: null, fullYear: true }, 5)).toBeNull();
  });

  it('grades a distribution count and buckets a follow-through record', () => {
    expect([0, 2, 3, 4, 5, 6, 7, 12].map(count => ddGradeState(count, reference))).toEqual(['0-2', '0-2', '3-4', '3-4', '5-6', '5-6', '7+', '7+']);
    expect([null, -1, 2.5].map(count => ddGradeState(count, reference))).toEqual([null, null, null]);
    expect(ftdState({ available: true, state: 'no_correction', peakAtWindowStart: true })).toBe('no_correction_pending');
    expect(ftdState({ available: true, state: 'no_correction' })).toBe('no_correction');
    expect(ftdState({ available: false, state: 'confirmed' })).toBeNull();
    const confirmed = since => ({ available: true, state: 'confirmed', ftd: { sessionsSince: since } });
    expect([25, 26, null].map(since => ftdRecent(confirmed(since), reference))).toEqual([true, false, false]);
    expect(ftdRecent({ available: true, state: 'rally_attempt', ftd: { sessionsSince: 3 } }, reference)).toBe(false);
  });
});
