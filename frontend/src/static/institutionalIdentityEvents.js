// Public, dated identifier transitions affecting cross-quarter comparability.
// Do not sum old/new CUSIP manager counts: a manager may occur in both sets.
export const institutionalIdentityEvents = Object.freeze([
  {
    symbol:'CCL', effectiveDate:'2026-05-07', previousCusip:'143658300', currentCusip:'G2004J103',
    reason:'2026-05-07の法人統合・CUSIP変更をまたぐため、旧・新識別子の報告会社数を直接比較できません',
    source:'https://www.sec.gov/Archives/edgar/data/876661/000087666126000397/ruleprovisionnotice.htm',
  },
]);
