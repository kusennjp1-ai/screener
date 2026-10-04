import { describe, expect, it } from 'vitest';
import { setupEvidenceFixture } from '../test/fixtures/setupEvidence';
import { buildSetupEvidence } from './setupEvidencePresentation';
import { buildBookTechnicalEvidence } from './bookTechnicalEvidence';
import { entryPosition } from './researchEngine';
import { entryReadiness } from './entryReadiness';

describe('setup evidence presentation', () => {
  it('keeps pre-pivot selection qualification separate from daily purchase readiness', () => {
    const fixture = setupEvidenceFixture(), result = buildSetupEvidence(fixture);
    expect(result.selection.qualified).toBe(true);
    expect(result.selection.passed).toBe(9);
    expect(result.position.state).toBe('ピボット待ち');
    const readiness = entryReadiness(fixture.row, fixture.date, { state: 'positive', cap: 1 }, fixture.now);
    expect(readiness.ready).toBe(false);
    expect(readiness.rules.find(rule => rule.id === 'price').state).toBe('fail');
  });

  it('uses the existing final contraction measurement separately from the latest volume', () => {
    const fixture = setupEvidenceFixture({ lastClose: 141, lastVolume: 2000 });
    const result = buildSetupEvidence(fixture);
    const measured = buildBookTechnicalEvidence(fixture.row, fixture.payload, fixture.date).vcp.finalContractionVolume;
    expect(result.formation.intervalRatio).toBe(measured.intervalRatio);
    expect(result.formation.lastRatio).toBe(measured.lastRatio);
    expect(result.formation.lastTwoRatio).toBe(measured.lastTwoRatio);
    expect(result.formation.intervalRatio).toBe(.5);
    expect(result.formation.end).toBe(fixture.payload.bars[305].date);
    expect(result.formation.reachesCurrentPivot).toBe(false);
    expect(result.dailyVolume.date).toBe(fixture.date);
    expect(result.dailyVolume.ratio).toBeCloseTo(2000 / 980);
    expect(result.dailyVolume.proxyState).toBe('met');
    expect(result.dailyVolume.baselineEnd).toBe(fixture.payload.bars.at(-2).date);
    expect(result.formation.certification).toBe(false);
  });

  it('does not label a candidate window containing current-pivot prices as pre-breakout', () => {
    const fixture = setupEvidenceFixture(); fixture.row.se_pivot_price = 130;
    expect(buildSetupEvidence(fixture).formation.reachesCurrentPivot).toBe(true);
  });

  it('does not treat high volume on a down day as the breakout-volume proxy passing', () => {
    const result = buildSetupEvidence(setupEvidenceFixture({ lastClose: 122, lastVolume: 2000 }));
    expect(result.dailyVolume.ratio).toBeGreaterThan(1.4);
    expect(result.dailyVolume.changePct).toBeLessThan(0);
    expect(result.dailyVolume.proxyState).toBe('not-met');
  });

  it('keeps zero baselines unknown for both formation and current volume', () => {
    const fixture = setupEvidenceFixture({ lastVolume: 2000 });
    fixture.payload.bars.slice(0, -1).forEach(bar => { bar.volume = 0; });
    const result = buildSetupEvidence(fixture);
    expect(result.formation.baselineMean).toBe(0);
    expect(result.formation.intervalRatio).toBeNull();
    expect(result.formation.lastRatio).toBeNull();
    expect(result.dailyVolume.baselineMean).toBe(0);
    expect(result.dailyVolume.ratio).toBeNull();
    expect(result.dailyVolume.proxyState).toBe('unknown');
  });

  it('reports missing baseline/history rather than using published ratios', () => {
    const fixture = setupEvidenceFixture();
    fixture.payload.bars = fixture.payload.bars.slice(-20);
    fixture.row.se_volume_vs_50d = 50;
    const result = buildSetupEvidence(fixture);
    expect(result.valid).toBe(false);
    expect(result.dailyVolume).toBeNull();
    expect(result.formation).toBeNull();
    expect(result.high).toBeNull();
  });

  it('does not silently replace a missing contraction with the last five bars', () => {
    const fixture = setupEvidenceFixture({ contractions: false });
    fixture.payload.bars.slice(-5).forEach(bar => { bar.volume = 100; });
    const result = buildSetupEvidence(fixture);
    expect(result.valid).toBe(true);
    expect(result.formation).toBeNull();
    expect(result.dailyVolume).not.toBeNull();
  });

  it.each([
    ['invalid date', fixture => { fixture.date = '2026-02-30'; }],
    ['missing date', fixture => { fixture.date = undefined; }],
    ['invalid symbol', fixture => { fixture.row.symbol = 12; }],
    ['wrong symbol', fixture => { fixture.payload.symbol = 'OTHER'; }],
    ['wrong payload date', fixture => { fixture.payload.as_of_date = '2026-01-01'; }],
    ['wrong row date', fixture => { fixture.row.as_of_date = '2026-01-01'; }],
    ['wrong last bar', fixture => { fixture.payload.bars.at(-1).date = '2026-01-01'; }],
    ['null bar', fixture => { fixture.payload.bars[0] = null; }],
    ['invalid OHLC', fixture => { fixture.payload.bars[0].high = 0; }],
    ['published row conflict', fixture => { fixture.row.technical_audit.errors = ['同一銘柄のデータが矛盾']; }],
  ])('rejects %s before showing raw price or volume evidence', (_label, mutate) => {
    const fixture = setupEvidenceFixture(); mutate(fixture);
    const result = buildSetupEvidence(fixture);
    expect(result.valid).toBe(false);
    expect(result.dailyVolume).toBeNull();
    expect(result.formation).toBeNull();
    expect(result.high).toBeNull();
  });

  it('shows a canonical local pivot below the major high without substituting the high', () => {
    const fixture = setupEvidenceFixture(), result = buildSetupEvidence(fixture);
    expect(result.pivot.price).toBe(140);
    expect(result.high.price).toBe(150);
    expect(result.high.abovePivotPct).toBeCloseTo((150 / 140 - 1) * 100);
    expect(result.position.pivot).toBe(140);
    expect(result.high.sessions).toBe(252);
    expect(result.high.start).toBe(fixture.payload.bars.at(-252).date);
  });

  it('uses the full validated 252-session raw high, including the current bar', () => {
    const fixture = setupEvidenceFixture();
    fixture.row.week_52_high_distance = 99;
    fixture.row.technical_audit.values.high = 99999;
    fixture.payload.bars.at(-1).high = 151;
    const result = buildSetupEvidence(fixture);
    expect(result.high.price).toBe(151);
    expect(result.high.observed).toBe(fixture.date);
  });

  it('never derives a high by reversing a rounded distance from compact list audit', () => {
    const fixture = setupEvidenceFixture();
    delete fixture.row.technical_audit.values.high;
    fixture.row.technical_audit.values.belowHigh = 17.47;
    expect(buildSetupEvidence({ ...fixture, payload: undefined }).high).toBeNull();
  });

  it('keeps an invalid canonical pivot invalid even when the high is measured', () => {
    const fixture = setupEvidenceFixture(); fixture.row.se_pivot_price = 0; fixture.row.vcp_pivot = 140;
    const result = buildSetupEvidence(fixture);
    expect(result.high.price).toBe(150);
    expect(result.pivot.price).toBeNull();
    expect(result.position.pivot).toBeNull();
    expect(result.formation.reachesCurrentPivot).toBeNull();
    expect(result.dailyVolume.atOrAbovePivot).toBeNull();
  });

  it('lets a live quote change price position only, keeping every dated measurement fixed', () => {
    const fixture = setupEvidenceFixture(), quote = { price: 142, as_of: `${fixture.date}T22:00:00Z` };
    const before = buildSetupEvidence(fixture), after = buildSetupEvidence({ ...fixture, quote });
    expect(entryPosition(fixture.row, quote).state).toBe('買いゾーン内');
    expect(after.position.state).toBe('ピボット待ち');
    expect(after.dailyVolume).toEqual(before.dailyVolume);
    expect(after.formation).toEqual(before.formation);
    expect(after.high).toEqual(before.high);
  });

  it.each([['minervini', 5], ['minervini2', 3], ['oneil', 5], ['ibd', 5]])('keeps the %s application zone at %s percent', (method, zone) => {
    const result = buildSetupEvidence({ ...setupEvidenceFixture(), method });
    expect(result.position.zone).toBe(zone);
  });
});
