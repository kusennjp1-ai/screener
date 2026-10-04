import { auditDailyBars, RS_METHOD } from '../../static/qualificationAudit';

export function setupEvidenceFixture({ symbol = 'TEST', contractions = true, lastClose, lastVolume = 1000 } = {}) {
  const bars = [];
  for (let time = Date.parse('2025-07-01'); bars.length < 320; time += 86400000) {
    const day = new Date(time);
    if ([0, 6].includes(day.getUTCDay())) continue;
    const close = 60 + bars.length * .2;
    bars.push({ date: day.toISOString().slice(0, 10), open: close, close, high: close + 1, low: close - 1, volume: 1000 });
  }
  if (contractions) {
    Object.assign(bars[270], { open: 145, close: 145, high: 150, low: 144 });
    Object.assign(bars[304], { open: 133, close: 133, high: 134, low: 132 });
    bars[304].volume = 400;
    bars[305].volume = 600;
  }
  if (lastClose != null) Object.assign(bars.at(-1), { open: lastClose, close: lastClose, high: lastClose + 1, low: lastClose - 1 });
  bars.at(-1).volume = lastVolume;
  const date = bars.at(-1).date;
  const row = { symbol, as_of_date: date, current_price: bars.at(-1).close, se_pivot_price: 140,
    rs_rating: 90, rs_method: RS_METHOD, rs_universe_size: 100, rs_as_of_date: date };
  const payload = { symbol, as_of_date: date, bars };
  row.technical_audit = auditDailyBars(row, payload, date);
  return { row, payload, date, now: Date.parse(`${date}T22:00:00Z`), method: 'minervini' };
}
