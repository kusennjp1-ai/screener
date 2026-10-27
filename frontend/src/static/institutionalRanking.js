import { institutionalGrowth } from './institutionalEvidence.js';

// Comparable, consecutive quarter observations only. A filing-date range is
// never interpolated into daily trades or daily manager-count observations.
export function institutionalRanking(ranked, date) {
  const seen = new Set(), rows = [], continuityExcluded = [];
  let unavailable = 0, continuityUnconfirmed = 0;
  for (const { row } of ranked) {
    if (!row?.symbol || seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    const data = row.institutional_evidence;
    const growth = institutionalGrowth(data, row.symbol, date);
    if (growth.identityChange) {
      const [previous,current] = data.observations;
      continuityUnconfirmed++; continuityExcluded.push({symbol:row.symbol,previous,current,cutoff:data.publication_cutoff,reason:growth.identityChange.reason,source:growth.identityChange.source}); continue;
    }
    if (growth.delta === null) { unavailable++; continue; }
    const [previous, current] = data.observations;
    // A quarter represented only by late reports can be an amendment-only or
    // newly mapped security history. Do not promote its apparent jump without
    // identity/coverage continuity evidence. This is a conservative UI filter,
    // not a claim that late filing itself means the underlying data is wrong.
    if ([previous,current].some(o => (Date.parse(o.filing_date_first)-Date.parse(o.period))/864e5 > 45)) {
      continuityUnconfirmed++; continuityExcluded.push({symbol:row.symbol,previous,current,cutoff:data.publication_cutoff,reason:'期末45日以内の公表を確認できない対象期あり'}); continue;
    }
    rows.push({ symbol:row.symbol, name:row.company_name, previous, current, delta:growth.delta,
      cutoff:data.publication_cutoff, retrievedAt:data.retrieved_at,
      refreshUnavailable:data.refresh?.status === 'unavailable' });
  }
  // Different report pairs and public cutoffs have different coverage. Do not
  // silently combine them into one cross-sectional ranking.
  const cohorts = new Map();
  for (const row of rows) {
    const key = `${row.previous.period}/${row.current.period}/${row.cutoff}`;
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(row);
  }
  const groups = [...cohorts.values()].sort((a,b) => b[0].current.period.localeCompare(a[0].current.period) || b[0].cutoff.localeCompare(a[0].cutoff));
  for (const group of groups) {
    // Competition ranks preserve ties instead of inventing relative strength.
    for (const period of ['previous','current']) {
      const sorted = [...group].sort((a,b) => b[period].manager_count-a[period].manager_count || a.symbol.localeCompare(b.symbol));
      let rank = 0, last = null;
      sorted.forEach((row,i) => { if (row[period].manager_count !== last) rank = i+1; row[`${period}Rank`] = rank; last = row[period].manager_count; });
    }
    group.sort((a,b) => b.delta-a.delta || b.current.manager_count-a.current.manager_count || a.symbol.localeCompare(b.symbol));
  }
  return { groups, unavailable, continuityUnconfirmed, continuityExcluded, total:seen.size };
}
