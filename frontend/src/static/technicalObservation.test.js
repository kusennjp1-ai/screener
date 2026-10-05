import { act, renderHook } from '@testing-library/react';
import { observationFreshness, observedBarrels, observedPriceBand, pricePosition, signalDateLabel, signedObservationPercent, useObservationClock } from './technicalObservation';

const now = Date.parse('2026-10-02T22:00:00Z');
afterEach(() => vi.useRealTimers());

it.each([undefined, null, '', 'invalid', '2026-02-30', '2026-10-01T00:00:00Z', {}])('leaves malformed snapshot date %j unverified', date => {
  expect(observationFreshness(date, now)).toMatchObject({ date: null, state: 'unknown' });
});
it('keeps recent dates unverified and distinguishes old or future US dates', () => {
  expect(observationFreshness('2026-10-01', now)).toEqual({ date: '2026-10-01', state: 'unverified', label: '基準日から1暦日・最新取引日は未確認' });
  expect(observationFreshness('2026-09-28', now)).toMatchObject({ state: 'old', label: '基準日から4暦日・最新取引日は未確認' });
  expect(observationFreshness('2026-10-03', now)).toMatchObject({ state: 'future' });
  expect(observationFreshness('2026-10-01', NaN)).toMatchObject({ state: 'unknown' });
});
it('does not apply a US calendar age to a different market', () => {
  expect(observationFreshness('2026-10-03', now, 'JP')).toMatchObject({ state: 'unverified', label: '最新取引日は未確認' });
});
it.each([undefined, 'invalid', '2026-02-30T00:00:00', '2026-10-01broken'])('rejects malformed signal date %j', value => {
  expect(signalDateLabel(value, now)).toBe('未確認');
});
it('labels signal dates separately, including a future signal', () => {
  expect(signalDateLabel('2026-10-01T00:00:00', now)).toBe('2026-10-01');
  expect(signalDateLabel('2026-10-03T00:00:00', now)).toBe('2026-10-03（未来・未確認）');
});
it.each([null, undefined, NaN, Infinity, 0, -10, '', '65.63', true])('does not compute a price position from invalid price %j', value => {
  expect(pricePosition({ trigger_price: value, last_close: 100 })).toEqual({ label: '価格位置未確認', delta: null });
  expect(pricePosition({ trigger_price: 100, last_close: value })).toEqual({ label: '価格位置未確認', delta: null });
});
it('describes price position independently of active signals or missing confirmation fields', () => {
  expect(pricePosition({ trigger_price: 100, last_close: 110, active: true })).toMatchObject({ label: '基準値より上' });
  expect(pricePosition({ trigger_price: 100, last_close: 100 })).toEqual({ label: '基準値と同値', delta: 0 });
  expect(pricePosition({ trigger_price: 100, last_close: 90, barrels_passed: 0 })).toMatchObject({ label: '基準値より下' });
});
it('refreshes while mounted across a calendar boundary and after tab focus', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T03:59:30Z'));
  const { result, unmount } = renderHook(() => observationFreshness('2026-09-28', useObservationClock()));
  expect(result.current.state).toBe('unverified');
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current.state).toBe('old');
  expect(result.current.label).toContain('4暦日');
  vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(result.current.label).toContain('5暦日');
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('omits an unrepresentable distance instead of showing Infinity', () => {
  expect(pricePosition({ trigger_price: Number.MIN_VALUE, last_close: Number.MAX_VALUE })).toEqual({ label: '基準値より上', delta: null });
});

it.each(['JP', 'HK'])('leaves the %s signal day unverified without inferring a US session', market => {
  const clock = Date.parse('2026-10-02T03:00:00Z');
  expect(signalDateLabel('2026-10-02T00:00:00', clock, market)).toBe('2026-10-02');
  expect(signalDateLabel('2026-10-02T00:00:00', clock, 'US')).toBe('2026-10-02（未来・未確認）');
});

it.each([undefined, null, NaN, -1, 4, 2.5, '3', true])('keeps malformed barrel evidence %j unconfirmed', barrels_passed => {
  expect(observedBarrels({ barrels_passed })).toBe('未確認');
});
it.each([0, 1, 2, 3])('preserves a measured barrel count %d without a qualification verdict', barrels_passed => {
  expect(observedBarrels({ barrels_passed })).toBe(`${barrels_passed}/3（記録値）`);
});
it('retains the legacy price-band boundaries solely as an observation', () => {
  expect(observedPriceBand({ trigger_price: 100, last_close: 105 })).toEqual({ lower: 100, upper: 105, position: '参考帯内' });
  expect(observedPriceBand({ trigger_price: 100, last_close: 105.01 }).position).toBe('参考帯より上');
  expect(observedPriceBand({ trigger_price: 100, last_close: 99 }).position).toBe('参考帯より下');
  expect(observedPriceBand({ trigger_price: 100 }).position).toBe('価格帯との比較未確認');
  expect(observedPriceBand({ trigger_price: Number.MAX_VALUE }).upper).toBeNull();
});
it('uses a Unicode minus for observed price differences', () => {
  expect(signedObservationPercent(-1.25)).toBe('−1.3%');
  expect(signedObservationPercent(1.25)).toBe('+1.3%');
  expect(signedObservationPercent(NaN)).toBe('未確認');
});
