// Step-0 seams C owns and other tracks call: the conclusion's Code 33 chip (D) and the published SEC
// coverage block that useStockData (E) hands to secStatus.
import { describe, expect, it } from 'vitest';
import { code33ChipView, publishedFundamentalsCoverage } from './fundamentalsExplain.js';

describe('code33ChipView', () => {
  const financial = (code33, sec = { state: 'ok' }) => ({ code33, sec });

  it('says 達成 in the zone tone only for a pass, and 未達 neutral for a fail', () => {
    expect(code33ChipView(financial({ state: 'pass', source: 'sec' }))).toEqual({ text: 'Code 33 達成', tone: 'zone' });
    expect(code33ChipView(financial({ state: 'fail', source: 'sec' }))).toEqual({ text: 'Code 33 未達', tone: '' });
  });

  it('says 読み込み中 while the detail loads and 未確認 for anything else unknown, never a pass', () => {
    expect(code33ChipView(financial({ state: 'unknown', source: null }, { state: 'detail_loading' }))).toEqual({ text: 'Code 33 読み込み中', tone: '' });
    expect(code33ChipView(financial({ state: 'unknown', source: null }))).toEqual({ text: 'Code 33 未確認', tone: '' });
    expect(code33ChipView(financial(null, { state: 'not_published' }))).toEqual({ text: 'Code 33 未確認', tone: '' });
    expect(code33ChipView(null)).toEqual({ text: 'Code 33 未確認', tone: '' });
  });

  it('marks a Yahoo reference judgement as （参考）', () => {
    expect(code33ChipView(financial({ state: 'pass', source: 'yahoo' }))).toEqual({ text: 'Code 33 達成（参考）', tone: 'zone' });
    expect(code33ChipView(financial({ state: 'fail', source: 'yahoo' }))).toEqual({ text: 'Code 33 未達（参考）', tone: '' });
  });
});

describe('publishedFundamentalsCoverage', () => {
  it('reads no block yet, whatever the manifest entry and the bundle carry', () => {
    expect(publishedFundamentalsCoverage(null)).toBeNull();
    expect(publishedFundamentalsCoverage(null, { bundle: null })).toBeNull();
    expect(publishedFundamentalsCoverage({ as_of_date: '2026-10-02', fundamentals_coverage: { listed: 993, sec_record: 0 } }, { bundle: { fundamentals_coverage: { listed: 993 } } })).toBeNull();
  });
});
