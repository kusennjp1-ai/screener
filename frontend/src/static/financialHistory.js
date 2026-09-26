const finite = n => typeof n === 'number' && Number.isFinite(n);
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

// Current research only. This fallback never populates dated SEC/book evidence.
export function financialHistory(data, symbol, date, now = Date.now()) {
  const result = { valid: false, annualComplete: null, annualGrowth: null, epsYoY: null, salesYoY: null, annual: [], quarterly: [] };
  const age = now - Date.parse(data?.retrieved_at);
  if (!data || data.symbol !== symbol || data.as_of_date !== date || !validDay(date) ||
      data.status !== 'available' || data.basis !== 'reported_diluted_eps' || data.currency !== 'USD' ||
      !Number.isFinite(age) || age < -5000 || age > 72 * 3600000) return result;
  const clean = values => Array.isArray(values) && values.every((p, i) => validDay(p.end) && p.end <= date && (!i || p.end > values[i-1].end)) ? values : [];
  result.annual = clean(data.annual);
  result.quarterly = clean(data.quarterly);
  result.valid = result.annual.length > 0 || result.quarterly.length > 0;
  const annual = result.annual.slice(-4);
  result.annualComplete = annual.length === 4 && days(date, annual[3].end) <= 550 && annual.every(p => finite(p.eps)) &&
      annual.slice(1).every((p,i) => days(p.end,annual[i].end) >= 345 && days(p.end,annual[i].end) <= 385) ? true : null;
  if (result.annualComplete && annual.slice(0,3).every(p => p.eps > 0)) {
    result.annualGrowth = annual.slice(1).map((p,i) => (p.eps / annual[i].eps - 1) * 100);
  }
  const latest = result.quarterly.at(-1);
  const previous = latest ? result.quarterly.filter(p => days(latest.end,p.end) >= 345 && days(latest.end,p.end) <= 385) : [];
  if (latest && days(date,latest.end) <= 190 && previous.length === 1) {
    for (const [metric, output] of [['eps','epsYoY'],['revenue','salesYoY']]) {
      if (finite(latest[metric]) && finite(previous[0][metric]) && previous[0][metric] > 0) result[output] = (latest[metric] / previous[0][metric] - 1) * 100;
    }
  }
  return result;
}
