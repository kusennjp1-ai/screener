import { validEvidenceDay } from './evidenceTime.js';
import { SECTOR_ETFS } from './marketLongHistory.js';

// The independently supplied exchange calendar establishes which session has
// closed, never whether a provider has actually delivered that session's data.
export function marketUpdateState(data, now = Date.now()) {
  const schedule = data?.refresh_schedule, sessions = schedule?.sessions;
  const until = Date.parse(schedule?.valid_until);
  const valid = Number.isFinite(now) && schedule?.provider === 'pandas_market_calendars:NYSE' &&
    Number.isFinite(until) && now < until && Array.isArray(sessions) && sessions.length > 0 &&
    sessions.every((row, i) => validEvidenceDay(row?.date) && Number.isFinite(Date.parse(row.close_at)) &&
      Date.parse(row.close_at) < until && (!i || row.date > sessions[i-1].date && Date.parse(row.close_at) > Date.parse(sessions[i-1].close_at)));
  const target = valid ? sessions.filter(row => Date.parse(row.close_at) <= now).at(-1)?.date : null;
  const daily = validEvidenceDay(data?.as_of_date) ? data.as_of_date : null;
  const history = validEvidenceDay(data?.long_history?.as_of_date) ? data.long_history.as_of_date : null;
  if (!target || daily > target || history > target) return { state:'unknown', target:null, daily, history };
  const long=data?.long_history, breadth=long?.breadth?.at(-1), index=long?.sp500?.at(-1), sectors=long?.sectorRotation?.frames?.at(-1);
  const actual = breadth?.date === target && breadth.coverage >= 100 && breadth.eligibleUniverse >= breadth.coverage &&
    breadth.coverage / breadth.eligibleUniverse >= .9 &&
    ['above50Percent','newHighs','newLows','leaderCount'].every(key=>Number.isFinite(breadth[key])&&breadth[key]>=0) && breadth.above50Percent <= 100 &&
    index?.date === target && Number.isFinite(index.close) && index.close > 0 &&
    sectors?.date === target && Array.isArray(sectors.ranks) && sectors.ranks.length === 11 &&
    new Set(sectors.ranks.map(row=>row.symbol)).size === 11 &&
    sectors.ranks.every(row=>SECTOR_ETFS.includes(row.symbol)&&Number.isInteger(row.rank)&&row.rank===1+sectors.ranks.filter(other=>other.relativeIndex>row.relativeIndex).length&&Number.isFinite(row.relativeIndex)&&row.relativeIndex>0);
  return { state:daily === target && history === target && actual ? 'current' : 'pending', target, daily, history };
}
