// Synthetic source summaries for consumer tests. Source/capture validation is
// independently covered by the producer-built shared JSON fixtures.
export const FINANCIAL_TEST_NOW = Date.parse('2026-10-03T16:35:00Z');
export const FINANCIAL_TEST_DATE = '2026-10-02';
export function withFinancialProof(input, now = FINANCIAL_TEST_NOW, date = FINANCIAL_TEST_DATE) {
  const row = { symbol:'TEST', market:'US', as_of_date:date, ...input };
  const r = '22222222b222bbbb'.split(''), p = {};
  const periods = ['2026-06-30','2026-03-31','2025-12-31','2025-09-30','2025-06-30'];
  for (const [index,field] of ['eps_growth_qq','eps_growth_yy','sales_growth_qq','sales_growth_yy'].entries()) if (typeof row[field] === 'number' && Number.isFinite(row[field])) {
    r[index]='0'; p[index]=[row[field],index%2?'1':'0',index<2?'Diluted EPS':'Total Revenue',index%2?periods:periods.slice(0,2),now-3600000,now+6*86400000];
  }
  return {...row,financial_current:{v:1,t:now,s:row.symbol,m:row.market,a:date,r:r.join(''),p}};
}
