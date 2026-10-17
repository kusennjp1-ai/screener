import { bookAnnualPriceExpiry } from './bookAnnualEpsEvidence.js';
import { useEffect, useMemo, useState } from 'react';
import { financialNextExpiry } from './financialCurrent.js';

// All values in one render share an evaluation instant. A timer covers an open
// tab; focus/visibility covers throttled or suspended background tabs.
function useClockWake(next, now, setNow) {
  useEffect(() => {
    const wake = () => setNow(Date.now());
    const visible = () => { if (document.visibilityState !== 'hidden') wake(); };
    const timeout = next === null ? null : setTimeout(wake, Math.min(2147483647, Math.max(1, next - Date.now())));
    const check = setInterval(() => { if (Date.now() < now || (next !== null && Date.now() >= next)) wake(); }, 15000);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timeout); clearInterval(check); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', visible); };
  }, [next, now, setNow]);
}

export function useFinancialClock(rows = [], annualPriceDate = null) {
  const [now, setNow] = useState(Date.now);
  const next = useMemo(() => {
    const current = Math.max(now, Date.now());
    const dates = [financialNextExpiry(rows, current), bookAnnualPriceExpiry(annualPriceDate)].filter(value => value !== null && value > current);
    return dates.length ? Math.min(...dates) : null;
  }, [rows, now, annualPriceDate]);
  useClockWake(next, now, setNow);
  // A newly loaded publication can have a later evidence evaluation than the
  // previous render. Re-evaluate it immediately using the current clock.
  return Math.max(now, Date.now());
}

// The research worker already computes the first invalid millisecond from all
// validated sources. Call only with its request-bound evaluation deadline;
// selected details and other raw payloads still use useFinancialClock above.
export function useFinancialDeadlineClock(next) {
  const [now, setNow] = useState(Date.now);
  const current = Math.max(now, Date.now());
  // Once invalid, the bundle is withheld while its replacement runs. Re-arming
  // an expired deadline every millisecond would keep aborting that worker.
  useClockWake(next !== null && next > current ? next : null, now, setNow);
  return current;
}
