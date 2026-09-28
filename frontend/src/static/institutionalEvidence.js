const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function institutionalGrowth(data, symbol, asOf) {
  const result = {increasing:null, delta:null, reason:'比較可能な保有機関数の履歴が未取得'};
  if (data?.symbol !== symbol || data?.status !== 'available' || data.unit !== '13f_reporting_manager_cik' || !validDate(asOf) || !validDate(data.publication_cutoff) || data.publication_cutoff > asOf) return result;
  const observations = data.observations;
  if (!Array.isArray(observations) || observations.length !== 2) return result;
  if (observations.some(o => !validDate(o.period) || !validDate(o.filing_date_first) || !validDate(o.filing_date_last) || o.filing_date_first < o.period || o.filing_date_last < o.filing_date_first || o.filing_date_last > data.publication_cutoff || !Number.isInteger(o.manager_count) || o.manager_count <= 0)) return result;
  const [previous,current] = observations;
  const spacing = (Date.parse(current.period)-Date.parse(previous.period))/86400000;
  const age = (Date.parse(asOf)-Date.parse(current.period))/86400000;
  if (spacing < 89 || spacing > 92 || age < 45 || age > 180) return result;
  const delta = current.manager_count-previous.manager_count;
  return {increasing:delta>0, delta, reason:`13F報告運用会社 ${previous.manager_count} → ${current.manager_count}社 / 公表集計期限 ${data.publication_cutoff}。ファンド数ではありません。`};
}
