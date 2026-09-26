import { assess } from './researchEngine.js';
import { auditValues } from './qualificationAudit.js';
export function marketLeadership(rows, date) {
  const verified = rows.filter(r => r.technical_audit?.as_of_date === date && Object.keys(auditValues(r)).length);
  const leaders = verified.filter(r => assess(r, 'minervini2').qualified);
  const rsAvailable = leaders.filter(r => r.book_diagnostics?.valid && r.book_diagnostics.as_of_date === date && ['up', 'flat', 'down'].includes(r.book_diagnostics.rsLine?.sixWeeks?.state));
  return { date, universe: rows.length, verified: verified.length, templateLeaders: leaders.length,
    nearHigh: verified.filter(r => auditValues(r).belowHigh <= 5).length,
    rsAvailable: rsAvailable.length, rsUp: rsAvailable.filter(r => r.book_diagnostics.rsLine.sixWeeks.state === 'up').length,
    automaticExposure: false, historicalComparison: false };
}
