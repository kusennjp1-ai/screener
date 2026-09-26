import { expect, it } from 'vitest';
import { buildBookExitEvidence } from './bookExitEvidence';
function fixture() {
  const bars = [];
  for (let t = Date.parse('2024-01-01'); bars.length < 280; t += 86400000) {
    const d = new Date(t); if ([0,6].includes(d.getUTCDay())) continue;
    bars.push({ date: d.toISOString().slice(0,10), open: 100, high: 102, low: 98, close: 100, volume: 1000 });
  }
  const date = bars.at(-1).date;
  return { row: { symbol: 'AAA', current_price: 100 }, payload: { symbol: 'AAA', as_of_date: date, bars }, date,
    context: { breakoutDate: bars[260].date, reviewDate: date, source: 'Verified chart', setupConfirmed: true } };
}
const run = f => buildBookExitEvidence(f.row, f.payload, f.date, f.context);
it('requires actual documented context and does not invent stage', () => {
  const f = fixture(); expect(buildBookExitEvidence(f.row,f.payload,f.date).valid).toBe(false);
  const r = run(f); expect(r.valid).toBe(true); expect(r.stage).toBe('unknown');
  expect(r.stageSignals.lateExhaustionReview).toBeNull(); expect(r.automaticSell).toBe(false);
});
it('relates every warning to actual breakout without using pre-breakout lower lows', () => {
  const f = fixture(), bars = f.payload.bars;
  for (let j = 259; j <= 263; j++) Object.assign(bars[j], { open: 97, high: 99, low: 97 - (j - 259), close: 97 - (j - 259), volume: 1000 + j });
  const r = run(f), p = r.postBreakout[2];
  expect(r.postBreakout[0].threeLowerLows).toBe(false);
  expect(p.sessionsSinceBreakout).toBe(3); expect(p.threeLowerLows).toBe(true);
  expect(p.thirdDaySupport).toBe(false); expect(p.combinedConcern).toBe(true);
});
it('upper-half close with increasing volume is supporting evidence, not combined no-support warning', () => {
  const f = fixture(), bars = f.payload.bars;
  for (let j = 261; j <= 263; j++) Object.assign(bars[j], { open: 96, high: 99, low: 97 - (j - 260), close: j === 263 ? 98 : 96, volume: 1000 + j });
  const p = run(f).postBreakout[2];
  expect(p.threeLowerLows).toBe(true); expect(p.thirdDaySupport).toBe(true); expect(p.combinedConcern).toBe(false);
});
it('same strong price sequence is interpreted differently only with declared stage', () => {
  const f = fixture();
  for (let j = 261; j < 280; j++) { const close = 100 + (j - 260) * 3; Object.assign(f.payload.bars[j], { open: close, high: close + 1, low: close - 1, close }); }
  f.row.current_price = f.payload.bars.at(-1).close;
  f.context.stage = 'early'; f.context.baseCount = 1;
  const early = run(f); expect(early.stageSignals.earlyStrength).toBe(true); expect(early.stageSignals.lateExhaustionReview).toBeNull();
  f.context.stage = 'late'; f.context.baseCount = 4;
  const late = run(f); expect(late.stageSignals.lateExhaustionReview).toBe(true); expect(late.stageSignals.earlyStrength).toBeNull();
});
it('does not infer late stage solely from base count and rejects contradictory context', () => {
  const f = fixture(); f.context.baseCount = 4;
  expect(run(f).stage).toBe('unknown'); f.context.stage = 'early'; expect(run(f).valid).toBe(false);
});
it('rejects wrong-date chart and absent/future breakout and preserves insufficient post-breakout history', () => {
  const f = fixture(); f.payload.as_of_date = '2020-01-01'; expect(run(f).valid).toBe(false);
  f.payload.as_of_date = f.date; f.context.breakoutDate = '2099-01-01'; expect(run(f).valid).toBe(false);
  f.context.breakoutDate = f.date; f.context.stage = 'early'; const r = run(f);
  expect(r.postBreakout).toHaveLength(0); expect(r.stageSignals.earlyStrength).toBeNull();
});
it('accepts honestly dated retrospective review without calling it point-in-time evidence', () => {
  const f = fixture(); f.context.reviewDate = new Date().toISOString().slice(0,10);
  expect(run(f).valid).toBe(true); expect(run(f).context.basis).toContain('当時既知');
});
it('keeps late-stage compound review unknown until all stated lookbacks exist', () => {
  const f = fixture(); f.context.stage = 'late';
  for (const sessions of [0, 4, 7, 14]) {
    f.context.breakoutDate = f.payload.bars.at(-1 - sessions).date;
    expect(run(f).stageSignals.lateExhaustionReview).toBeNull();
  }
  f.context.breakoutDate = f.payload.bars.at(-16).date;
  expect(run(f).stageSignals.lateExhaustionReview).toBe(false);
});
