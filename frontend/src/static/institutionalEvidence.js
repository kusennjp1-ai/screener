import { validEvidenceDay as validDate } from './evidenceTime.js';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// 13F period_end is the calendar reporting quarter, not a filing date or a
// fiscal quarter. Keep this restriction out of ordinary daily/manual histories.
const quarterEnd = value => validDate(value) && /-(03-31|06-30|09-30|12-31)$/.test(value);
const quarterNumber = value => Number(value.slice(0, 4)) * 4 + Number(value.slice(5, 7)) / 3;
export function institutionalGrowth(data, symbol, asOf) {
  const result = {increasing:null, delta:null, reason:'比較可能な保有機関数の履歴が未取得'};
  if (!record(data) || typeof symbol !== 'string' || !symbol.trim() || data.symbol !== symbol || data.status !== 'available' || data.unit !== '13f_reporting_manager_cik' || !validDate(asOf) || !validDate(data.publication_cutoff) || data.publication_cutoff > asOf) return result;
  const observations = data.observations;
  // Check both own slots explicitly: array iteration skips holes. Do not sort,
  // fill or drop malformed observations to manufacture a comparable pair.
  if (!Array.isArray(observations) || observations.length !== 2 || ![0, 1].every(index => Object.hasOwn(observations, index) && record(observations[index]))) return result;
  if (observations.some(o => !quarterEnd(o.period) || !validDate(o.filing_date_first) || !validDate(o.filing_date_last) || o.filing_date_first < o.period || o.filing_date_last < o.filing_date_first || o.filing_date_last > data.publication_cutoff || !Number.isSafeInteger(o.manager_count) || o.manager_count <= 0)) return result;
  const [previous,current] = observations;
  const age = (Date.parse(asOf)-Date.parse(current.period))/86400000;
  if (quarterNumber(current.period) - quarterNumber(previous.period) !== 1 || age < 45 || age > 180) return result;
  const delta = current.manager_count-previous.manager_count;
  return {increasing:delta>0, delta, reason:`13F報告運用会社 ${previous.manager_count} → ${current.manager_count}社 / 公表集計期限 ${data.publication_cutoff}。ファンド数ではありません。`};
}
