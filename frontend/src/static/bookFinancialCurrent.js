import { instrumentApplicability } from './instrumentApplicability.js';
import { bookFinancialEvidence, BOOK_QUARTER_MAX_AGE_DAYS } from './bookFinancialEvidence.js';
import { validClock } from './evidenceTime.js';

// Preserve the original snapshot and filing cutoff for historical measurements.
// Only current overview usability follows today's clock and the existing book
// quarter-age policy. The final UTC day is inclusive, as in the day-based audit.
export function bookFinancialCurrent(data, symbol, date, now, identity) {
  const applicability = instrumentApplicability(identity || { ...data, symbol });
  const report = bookFinancialEvidence(data, symbol, date);
  const latest = report.rows.at(-1)?.end;
  const validUntil = report.valid ? Date.parse(latest) + (BOOK_QUARTER_MAX_AGE_DAYS + 1) * 86400000 - 1 : null;
  const reason = applicability.status !== 'unverified' ? applicability.reason : !report.valid ? 'invalid_book_history' : !validClock(now) ? 'invalid_evaluation_time'
    : new Date(now).toISOString().slice(0, 10) < date ? 'future_snapshot'
      : report.stale || now > validUntil ? 'stale_book_period' : null;
  return { report, applicability, current: reason === null, validUntil, reason };
}
