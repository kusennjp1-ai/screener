import { useEffect, useState } from 'react';
import { snapshotFreshness } from './researchEngine';
import { validEvidenceDay } from './evidenceTime';

// Calendar age is a disclosure, never proof of the latest exchange session.
// The charts index carries no entry-evidence calendar or holdings context.
export function observationFreshness(asOf, now = Date.now(), market = 'US') {
  const age = snapshotFreshness(asOf, now);
  const date = validEvidenceDay(asOf) ? asOf : null;
  // Research's age helper is US-specific; other markets remain unverified.
  if (date && market !== 'US') return { date, state: 'unverified', label: '最新取引日は未確認' };
  if (age.state === 'future') return { date, state: 'future', label: '基準日が未来・鮮度未確認' };
  if (age.state === 'unknown') return { date, state: 'unknown', label: date ? '現在時刻未確認・鮮度未確認' : '基準日未確認・鮮度未確認' };
  return {
    date, state: age.state === 'old' ? 'old' : 'unverified',
    label: `基準日から${age.days}暦日・最新取引日は未確認`,
  };
}

export function signalDateLabel(value, now = Date.now(), market = 'US') {
  const date = typeof value === 'string' ? value.slice(0, 10) : null;
  if (!validEvidenceDay(date) || !Number.isFinite(Date.parse(value))) return '未確認';
  return observationFreshness(date, now, market).state === 'future' ? `${date}（未来・未確認）` : date;
}

export function useObservationClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return now;
}

export const observedPrice = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

export function pricePosition(buy) {
  const trigger = observedPrice(buy?.trigger_price), close = observedPrice(buy?.last_close);
  if (trigger == null || close == null) return { label: '価格位置未確認', delta: null };
  const delta = (close / trigger - 1) * 100;
  return { label: close > trigger ? '基準値より上' : close < trigger ? '基準値より下' : '基準値と同値', delta: Number.isFinite(delta) ? delta : null };
}
