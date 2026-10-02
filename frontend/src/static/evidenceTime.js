// One formatter per module, rather than one ICU allocation for every stock.
const newYorkDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

export const validClock = value => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
export const evidenceTimestamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
export const validEvidenceDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const newYorkDate = now => {
  const date = validClock(now) ? newYorkDayFormatter.format(now) : null;
  return validEvidenceDay(date) ? date : null;
};
