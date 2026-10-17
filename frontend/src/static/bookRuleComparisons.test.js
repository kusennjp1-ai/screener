import { describe, expect, it } from 'vitest';
import { bookRuleComparisons } from './bookRuleComparisons';
import { BOOK_SOURCES, entrySourceContext, trendTemplateSourceContext } from './bookSourceContext';
import { assess, entryChecks, entryPlan, rankCandidates } from './researchEngine';
import { withAuditFixture } from './testAuditFixture';
import { withFinancialProof, FINANCIAL_TEST_NOW as now, FINANCIAL_TEST_DATE as date } from './testFinancialFixture';

const technical = (values = {}) => {
  const row = withAuditFixture({ symbol: 'BOOK', market: 'US', current_price: 104, se_pivot_price: 100, rs_rating: 90 }, date);
  Object.assign(row.technical_audit.values, values);
  return row;
};
const report = (row = technical(), clock = now, asOf = date) => bookRuleComparisons(row, { date: asOf, now: clock, method: 'minervini' });
const item = (result, id) => result.cards.find(card => card.id === id);
const annualRow = eps => withFinancialProof({ ...technical(), sales_growth_yy: 20, financial_history: {
  symbol: 'BOOK', as_of_date: date, status: 'available', basis: 'reported_diluted_eps', currency: 'USD',
  source: 'Synthetic provider', retrieved_at: new Date(now - 3600000).toISOString(),
  annual: eps.map((value, i) => ({ end: `${2022 + i}-12-31`, eps: value })), quarterly: [],
} });

describe('four-book source identity and bounded comparisons', () => {
  it('replaces unverified mode attribution with the matching supplied edition', () => {
    expect(BOOK_SOURCES.map(book => book.id)).toEqual(['champion', 'wizard', 'masters', 'oneil']);
    expect(BOOK_SOURCES.every(book => book.printedPage === null)).toBe(true);
    expect(trendTemplateSourceContext('minervini2')).toContain('PDF 221–222');
    expect(trendTemplateSourceContext('minervini2')).toContain('25%以上');
    expect(trendTemplateSourceContext('minervini')).toContain('PDF 151–152');
    expect(entrySourceContext('minervini2', 3, 4)).toMatchObject({ state: 'beyond', warning: true, bookId: 'champion' });
  });
  it.each([[24.99,'fail','fail'],[25,'pass','fail'],[29.99,'pass','fail'],[30,'pass','pass']])('preserves the actual source threshold difference at %s', (value, champion, wizard) => {
    const result = report(technical({ aboveLow: value }));
    expect(item(result, 'champion-low').state).toBe(champion);
    expect(item(result, 'wizard-low').state).toBe(wizard);
    expect(item(result, 'champion-low').evidence).toContain('252営業日');
    expect(item(result, 'champion-low').strength).toBe('required');
  });
  it.each([[1,'fail'],[1.0001,'pass'],[1.3,'pass']])('compares MM volume preference using the disclosed prior-50-day window at %s', (ratio, expected) => {
    const result = report(technical({ volumeRatio: ratio }));
    expect(item(result, 'masters-minervini-volume').state).toBe(expected);
    expect(item(result, 'masters-minervini-volume').strength).toBe('preference');
    expect(item(result, 'masters-minervini-volume').evidence).toContain('直前50営業日');
    expect(item(result, 'app-volume').state).toBe('fail');
  });
  it('keeps Ryan window interpretation, Zanger missing 20-day data and Ritchie discretion distinct', () => {
    const result = report(technical({ volumeRatio: 1.3 }));
    expect(item(result, 'masters-ryan-volume')).toMatchObject({ state: 'pass', scope: 'application_window_comparison' });
    expect(item(result, 'masters-ryan-volume').evidence).toContain('窓はアプリの選択');
    expect(item(result, 'masters-zanger-volume')).toMatchObject({ state: 'unknown', value: null });
    expect(item(result, 'masters-ritchie-volume').state).toBe('review');
    expect(new Set(result.cards.filter(card => card.bookId === 'masters').map(card => card.author)).size).toBe(4);
  });
  it.each(['missing', 'invalid', 'other_date', 'short', 'stale', 'future', 'invalid_clock'])('keeps technical source comparisons unknown for %s evidence', kind => {
    const row = technical(); let clock = now;
    if (kind === 'missing') delete row.technical_audit;
    if (kind === 'invalid') row.technical_audit.valid = false;
    if (kind === 'other_date') row.technical_audit.as_of_date = '2026-10-01';
    if (kind === 'short') row.technical_audit.bars = 20;
    if (kind === 'stale') clock += 8 * 86400000;
    if (kind === 'future') clock -= 4 * 86400000;
    if (kind === 'invalid_clock') clock = NaN;
    const result = report(row, clock);
    for (const id of ['champion-low', 'wizard-low', 'masters-minervini-volume', 'masters-ryan-volume', 'app-volume']) {
      expect(item(result, id).state).toBe('unknown');
      expect(item(result, id).value).toBeNull();
    }
  });
  it('does not certify a source from copied scalar fields or cached scores', () => {
    const result = report({ symbol: 'BOOK', market: 'US', current_price: 104, rs_rating: 99, aboveLow: 50, volume_ratio: 2, sales_growth_yy: 50, annual_eps_growth_3y: [50,50,50], code33: true });
    for (const id of ['champion-low','wizard-low','masters-minervini-volume','oneil-sales','oneil-annual']) expect(item(result, id).state).toBe('unknown');
    expect(item(result, 'wizard-code33').state).toBe('review');
  });
});

describe('O’Neil source comparisons with current financial proof', () => {
  it.each([[25,'pass'],[24.99,'unknown'],[-5,'unknown']])('evaluates only the latest-quarter sales branch at %s, retaining the missing alternative', (growth, expected) => {
    const result = report(withFinancialProof({ ...technical(), sales_growth_yy: growth }));
    const card = item(result, 'oneil-sales');
    expect(card.state).toBe(expected);
    expect(card.evidence).toContain('2026-06-30');
    expect(card.evidence).toContain('2025-06-30');
    expect(card.evidence).toContain('3四半期');
    expect(card.evidence).toContain('有効期限');
  });
  it('distinguishes increasing annual EPS + 3-year CAGR from every year ≥25%', () => {
    const row = annualRow([1, 1.2, 1.6, 2]);
    const result = report(row);
    expect(item(result, 'oneil-annual')).toMatchObject({ state: 'pass', strictThresholdState: 'fail' });
    expect(item(result, 'oneil-annual').value).toBeCloseTo(25.99210499);
    expect(item(result, 'oneil-annual').evidence).toContain('2022-12-31');
    expect(item(result, 'oneil-annual').evidence).toContain('2025-12-31');
    expect(assess(row, 'oneil', now).rules.find(rule => rule.label.startsWith('A：')).state).toBe('fail');
  });
  it.each([[1,2,1.8,3],[1,1.1,1.2,1.3],[1,1.5,1.5,2]])('does not let a positive CAGR hide a flat/down year or low growth: %j', (...eps) => {
    expect(item(report(annualRow(eps)), 'oneil-annual').state).toBe('fail');
  });
  it.each([[0,1,2,3],[-1,1,2,3],[1,null,2,3]])('does not invent comparable growth from missing/nonpositive baselines: %j', (...eps) => {
    expect(item(report(annualRow(eps)), 'oneil-annual').state).toBe('unknown');
  });
  it('rechecks source expiry on every call without retaining a previous pass', () => {
    const row = annualRow([1,1.3,1.7,2.3]); row.sales_growth_yy = 30;
    const sales = withFinancialProof({ ...row, sales_growth_yy: 30 });
    expect(item(report(sales), 'oneil-sales').state).toBe('pass');
    expect(item(report(sales, now + 8 * 86400000), 'oneil-sales').state).toBe('unknown');
    expect(item(report(row), 'oneil-annual').state).toBe('pass');
    expect(item(report(row, now + 4 * 86400000), 'oneil-annual').state).toBe('unknown');
  });
  it('does not combine mismatched symbols or snapshot dates', () => {
    const row = annualRow([1,1.3,1.7,2.3]); row.financial_history.symbol = 'OTHER';
    expect(item(report(row), 'oneil-annual').state).toBe('unknown');
    expect(item(report(withFinancialProof({ ...technical(), sales_growth_yy:30 }), now, '2026-10-01'), 'oneil-sales').state).toBe('unknown');
  });
});

it('keeps all source comparisons out of qualification, scores, ranking, entry gates and input rows', () => {
  const row = annualRow([1,1.2,1.6,2]); const before = structuredClone(row);
  const modes = ['minervini','minervini2','oneil','ibd'];
  const values = modes.map(method => ({ assessment:assess(row,method,now), entry:entryChecks(row,method), plan:entryPlan(row,null,method), ranked:rankCandidates([row],method,{now}) }));
  for (const method of modes) bookRuleComparisons(row, { date, now, method });
  expect(row).toEqual(before);
  expect(modes.map(method => ({ assessment:assess(row,method,now), entry:entryChecks(row,method), plan:entryPlan(row,null,method), ranked:rankCandidates([row],method,{now}) }))).toEqual(values);
  const result = report(row);
  expect(result).not.toHaveProperty('qualified');
  expect(item(result,'champion-power-play')).toMatchObject({ strength:'exception',state:'review' });
  expect(result.policy).toContain('口座');
});

it.each([false,true])('preserves fund exclusion or identity quarantine (conflict: %s)', async conflict => {
  const {default:registry}=await import('../..//contracts/financial_instrument_applicability_v1.json');
  const fund=registry.records[0];
  const row=withAuditFixture({symbol:fund.symbol,company_name:conflict?'Conflicting issuer':fund.name,market:fund.market,current_price:104,rs_rating:95},date);
  const result=report(row);
  for(const id of ['champion-low','wizard-low','oneil-sales','oneil-annual','masters-minervini-volume']) {
    expect(item(result,id)).toMatchObject({state:conflict?'unknown':'not_applicable',value:null});
  }
});

it('rejects future or conflicting snapshot dates for annual comparisons as well as technical values',()=>{
 const row=annualRow([1,1.3,1.7,2.3]);
 expect(item(report(row,now-5*86400000),'oneil-annual').state).toBe('unknown');
 expect(item(report({...row,as_of_date:'2026-10-01'}),'oneil-annual').state).toBe('unknown');
 row.technical_audit.as_of_date='2026-10-01';
 expect(item(report(row),'oneil-annual').state).toBe('unknown');
});

it.each(['annual_currency','cell_currency','cell_basis','annual_source','scope_symbol','scope_market','scope_date'])('does not certify ambiguous annual or observed identity metadata: %s', kind=>{
 const row=annualRow([1,1.2,1.6,2]);
 if(kind==='annual_currency')row.financial_history.annual_currency='EUR';
 if(kind==='cell_currency')row.financial_history.annual[1].currency='EUR';
 if(kind==='cell_basis')row.financial_history.annual[1].basis='adjusted_eps';
 if(kind==='annual_source')row.financial_history.annual_source={observed_at:new Date(now).toISOString()};
 if(kind==='scope_symbol')row.financial_identity={observed_scope:{symbol:'OTHER'}};
 if(kind==='scope_market')row.financial_identity={observed_scope:{market:'JP'}};
 if(kind==='scope_date')row.financial_identity={observed_scope:{as_of_date:'2026-10-01'}};
 expect(item(report(row),'oneil-annual')).toMatchObject({state:'unknown',value:null,strictThresholdState:'unknown'});
});

it.each(['missing_symbol','empty_symbol','missing_market','empty_market'])('requires a named stock and market before current comparisons: %s',kind=>{
 const row=annualRow([1,1.2,1.6,2]);
 if(kind==='missing_symbol'){delete row.symbol;delete row.financial_history.symbol;delete row.technical_audit.symbol;}
 if(kind==='empty_symbol'){row.symbol='';row.financial_history.symbol='';row.technical_audit.symbol='';}
 if(kind==='missing_market')delete row.market;
 if(kind==='empty_market')row.market=' ';
 const result=report(row);
 for(const id of ['champion-low','wizard-low','oneil-sales','oneil-annual','masters-minervini-volume'])expect(item(result,id)).toMatchObject({state:'unknown',value:null});
});
