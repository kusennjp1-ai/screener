import { useEffect, useMemo, useState } from 'react';
import { financialNextExpiry } from './financialCurrent.js';

// All values in one render share an evaluation instant. A timer covers an open
// tab; focus/visibility covers throttled or suspended background tabs.
export function useFinancialClock(rows = []) {
  const [now, setNow] = useState(Date.now);
  const next = useMemo(() => financialNextExpiry(rows, Math.max(now, Date.now())), [rows, now]);
  useEffect(() => {
    const wake = () => setNow(Date.now());
    const visible = () => { if (document.visibilityState !== 'hidden') wake(); };
    const timeout = next === null ? null : setTimeout(wake, Math.min(2147483647, Math.max(1, next - Date.now())));
    const check = setInterval(() => { if (Date.now() < now || (next !== null && Date.now() >= next)) wake(); }, 15000);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timeout); clearInterval(check); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', visible); };
  }, [next, now]);
  // A newly loaded publication can have a later evidence evaluation than the
  // previous render. Re-evaluate it immediately using the current clock.
  return Math.max(now, Date.now());
}
