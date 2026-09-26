import { describe, expect, it } from 'vitest';
import { reviewBookPattern } from './bookPatternReview';

function fixture() {
  const bars = [];
  for (let t = Date.parse('2025-01-01'); bars.length < 300; t += 86400000) {
    const d = new Date(t); if ([0, 6].includes(d.getUTCDay())) continue;
    const p = 100 + bars.length / 10;
    bars.push({ date: d.toISOString().slice(0, 10), open: p, high: p + 1, low: p - 1, close: p, volume: 1000 });
  }
  const set = (i, low, high, volume = 1000) => Object.assign(bars[i], { open: (low + high) / 2, close: (low + high) / 2, low, high, volume });
  set(229, 198, 200);
  for (let i = 230; i < 280; i++) set(i, 175, 185);
  set(230, 190, 200); set(250, 140, 150);
  for (let i = 270; i < 280; i++) set(i, 160, 165, 500);
  set(280, 164, 168);
  const date = bars.at(-1).date;
  const review = { pattern: 'three-c', source: 'reviewed chart', reviewedAt: '2026-09-26T05:00:00Z', advanceStart: bars[100].date,
    baseStart: bars[230].date, troughDate: bars[250].date, cheatStart: bars[270].date, cheatEnd: bars[279].date, breakoutDate: bars[280].date };
  return { bars, set, date, review, row: { symbol: 'TEST', current_price: bars.at(-1).close }, payload: { symbol: 'TEST', as_of_date: date, bars } };
}
const run = f => reviewBookPattern(f.row, f.payload, f.date, f.review);
const find = (r, text) => r.rules.find(rule => rule.label.includes(text));

describe('reviewer dated book pattern measurements', () => {
  it('measures actual selected OHLCV and structural entry/stop examples', () => {
    const f = fixture(), r = run(f);
    expect(r.valid).toBe(true);
    expect(r.facts.baseDepth).toBe(30);
    expect(r.facts.cheatDepth).toBeCloseTo(5 / 165 * 100);
    expect(r.facts.cheatSessions).toBe(10);
    expect(r.facts.dryRatio).toBe(.5);
    expect(r.plan).toMatchObject({ entryTriggerExample: 165.01, structuralStopExample: 159.99, orderReady: false });
    expect(r.plan.riskPerShare).toBeCloseTo(5.02);
    expect(r.certification).toBe(false);
    expect(find(r, '3〜36か月').state).toBe('pass');
    expect(find(r, '上抜けた').state).toBe('pass');
    expect(find(r, '初期／後期').state).toBe('unknown');
  });
  it('does not turn all manual declarations into automatic certification', () => {
    const f = fixture(); f.review.context = { stageConfirmed: true, supplyConfirmed: true, weeklyTightnessConfirmed: true };
    const r = run(f);
    expect(find(r, '初期／後期').state).toBe('pass');
    expect(find(r, '初期／後期').scope).toBe('reviewer-declaration');
    expect(r.certification).toBe(false);
  });
  it('leaves a future breakout unknown rather than using later highs', () => {
    const f = fixture(); delete f.review.breakoutDate;
    const r = run(f);
    expect(find(r, '上抜けた').state).toBe('unknown');
    expect(r.facts.actualBreakoutHigh).toBeNull();
  });
  for (const [name, mutate] of [
    ['missing provenance', f => { f.review.source = ''; }],
    ['bad review date', f => { f.review.reviewedAt = 'not a date'; }],
    ['reverse interval', f => { f.review.cheatStart = f.bars[281].date; }],
    ['unknown day', f => { f.review.baseStart = '2000-01-01'; }],
    ['breakout inside base', f => { f.review.breakoutDate = f.review.cheatStart; }],
    ['invalid tick', f => { f.review.tickSize = 0; }],
    ['wrong symbol', f => { f.payload.symbol = 'OTHER'; }],
    ['invalid OHLC', f => { f.bars[100].high = 1; }],
  ]) it(`rejects ${name}`, () => {
    const f = fixture(); mutate(f); const r = run(f);
    expect(r.valid).toBe(false); expect(r.plan).toBeNull();
  });
  it('distinguishes lower-third low cheat and optional IPO evidence', () => {
    const f = fixture(); f.review.pattern = 'low-cheat';
    expect(find(run(f), '下部3分の1').state).toBe('fail');
    for (let i = 270; i < 280; i++) f.set(i, 154, 159, 500);
    f.review.ipoDate = f.bars[220].date; f.review.ipoPrice = 150;
    const r = run(f);
    expect(find(r, '下部3分の1').state).toBe('pass');
    expect(find(r, 'IPO後').state).toBe('pass');
    expect(r.facts.aboveIpoPrice).toBe(true);
  });
  it('uses impulse terminal high and does not require ordinary fundamentals for power play', () => {
    const f = fixture(); f.review.pattern = 'power-play';
    f.set(200, 99, 101); f.set(229, 200, 200);
    f.review.advanceStart = f.bars[200].date;
    for (let i = 230; i < 250; i++) f.set(i, 155, 180);
    f.set(235, 150, 160);
    for (let i = 240; i < 250; i++) f.set(i, 155, 160, 500);
    Object.assign(f.review, { troughDate: f.bars[235].date, cheatStart: f.bars[240].date, cheatEnd: f.bars[249].date, breakoutDate: f.bars[250].date });
    let r = run(f);
    expect(r.facts.baseDepth).toBe(25);
    expect(r.facts.fundamentalsRequired).toBe(false);
    expect(find(r, '100%以上').state).toBe('pass');
    expect(find(r, '25%以内').state).toBe('pass');
    f.set(235, 135, 160);
    r = run(f);
    expect(r.facts.baseDepth).toBe(32.5);
    expect(find(r, '25%以内').state).toBe('fail');
  });
  it('preserves unknown SMA200 for legitimate short IPO history', () => {
    const f = fixture(), original = f.bars;
    f.payload.bars = original.slice(220);
    f.review.advanceStart = original[221].date;
    f.review.pattern = 'low-cheat';
    const r = run(f);
    expect(r.valid).toBe(true);
    expect(find(r, 'SMA200').state).toBe('unknown');
  });
  it('accepts dated VCP interval provenance without reusing the 3C fields or certifying the pattern', () => {
    const f = fixture();
    f.review = { pattern: 'vcp', source: 'annotated daily chart', reviewedAt: '2026-09-26T05:00:00Z', intervals: [
      { startDate: f.bars[230].date, endDate: f.bars[250].date }, { startDate: f.bars[270].date, endDate: f.bars[279].date }, {},
    ] };
    const r = run(f);
    expect(r.valid).toBe(true);
    expect(r.vcp.legs).toHaveLength(2);
    expect(r.vcp.legs[0].depthPct).toBe(30);
    expect(r.certification).toBe(false);
    expect(r.review.source).toBe('annotated daily chart');
    f.review.intervals[1].startDate = f.bars[240].date;
    expect(run(f).valid).toBe(false);
    f.review.intervals = [null];
    expect(run(f).valid).toBe(false);
  });
});
