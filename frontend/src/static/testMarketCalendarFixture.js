// Provider-generated exchange dates; never infer expected sessions from test prices.
import calendar from './__fixtures__/nyse-sessions-2024-2026.json';
export function calendarAt(date) {
  if (!calendar.sessions.includes(date)) throw Error(`Fixture date is not a covered NYSE session: ${date}`);
  return { ...calendar, as_of_date: date, range_end: date, sessions: calendar.sessions.filter(day => day <= date) };
}
export function tradingDays(start, count) {
  const days = calendar.sessions.filter(day => day >= start).slice(0, count);
  if (days.length !== count) throw Error('Fixture calendar does not cover the requested range');
  return days;
}
