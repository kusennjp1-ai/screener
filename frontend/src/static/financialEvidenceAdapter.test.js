import { expect, it } from 'vitest';
import { buildFinancialEvidencePresentation, financialEvidencePresentation, financialEvidenceSummary } from './financialEvidencePresentation';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../test/fixtures/financialCurrent';
import { assess } from './researchEngine';
const context = { symbol: 'TEST', method: 'oneil', date, now, generation: 'synthetic-g1' };
const present = row => ({ ...context, evidence: buildFinancialEvidencePresentation(row, context) });
it.each([30, 0, -10])('binds current %s and the exact existing rule to both summary and detail', value => {
  const row = withSyntheticFinancialProof({ eps_growth_yy: value });
  const input = present(row);
  const detail = financialEvidencePresentation(input).rows[0];
  const summary = financialEvidenceSummary(input)[0];
  expect(input.evidence.metrics.eps_growth_yy.condition).toEqual(assess(row, 'oneil', now).rules[0]);
  expect(detail).toMatchObject({ actual: `${value}%`.replace(/^-/, '−'), state: value >= 25 ? 'pass' : 'fail', source: 'yfinance', basis: '比較可能な四半期の前年同期比（報告値）', period: '2026-06-30 / 比較 2025-06-30' });
  expect(summary.actual).toBe(detail.actual); expect(summary.state).toBe(detail.state);
});
it('does not construct proof from raw values or a forged availability state', () => {
  const raw = { symbol: 'TEST', market: 'US', eps_growth_yy: 88, financial_current_state: { fields: { eps_growth_yy: { value: 88, availability: 'current' } } } };
  const view = financialEvidencePresentation(present(raw));
  expect(view.rows[0]).toMatchObject({ actual: '未確認', state: 'unknown' });
  expect(view.historical[0].value).toBe('88（単位未確認・原値）');
});
it.each(['value', 'basis', 'source', 'period'])('withholds corrupt %s proof from both current surfaces', changed => {
  const row = withSyntheticFinancialProof();
  if (changed === 'value') row.eps_growth_yy = 99;
  if (changed === 'basis') row.financial_current.p[1][1] = '0';
  if (changed === 'source') delete row.financial_current;
  if (changed === 'period') row.financial_current.p[1][3][0] = '2026-10-09';
  const input = present(row);
  expect(financialEvidencePresentation(input).rows[0].state).toBe('unknown');
  expect(financialEvidenceSummary(input)[0].state).toBe('unknown');
});
it('keeps rating derivation unknown and annual history separate with its 72h expiry', () => {
  const history = { symbol: 'TEST', as_of_date: date, retrieved_at: new Date(now).toISOString(), source: 'Yahoo reported history', status: 'available', currency: 'USD', basis: 'reported_diluted_eps', annual: [2022,2023,2024,2025].map((year,i)=>({end:`${year}-12-31`,eps:2**i})), quarterly: [] };
  const row = withSyntheticFinancialProof({ eps_rating: 99, composite_rating: 99, financial_history: history });
  const input = { ...present(row), history };
  expect(financialEvidencePresentation(input).rows.find(r=>r.id==='annual_eps_growth_3y').state).toBe('pass');
  expect(financialEvidencePresentation(input).rows.find(r=>r.id==='eps_rating').state).toBe('unknown');
  const later = { ...context, now: now + 72*3600000 + 1 };
  const expired = { ...later, history, evidence: buildFinancialEvidencePresentation(row,later) };
  expect(financialEvidencePresentation(expired).rows.find(r=>r.id==='annual_eps_growth_3y').state).toBe('unknown');
  expect(financialEvidencePresentation(expired).rows[0].state).toBe('pass');
  expect(financialEvidenceSummary(input)[2].state).toBe('unknown');
});
it('rejects previous symbols and same-date old generations in the summary', () => {
  const input = present(withSyntheticFinancialProof());
  for (const change of [{ symbol: 'OTHER' }, { generation: 'synthetic-g2' }]) {
    expect(financialEvidenceSummary({ ...input, ...change })[0]).toMatchObject({ actual: '未確認', state: 'unknown' });
  }
});


it('keeps malformed annual acquisition unknown without throwing when Date.parse would accept it', () => {
 const history={symbol:'TEST',as_of_date:date,retrieved_at:'2026-10-03T12:00:00',source:'Synthetic source',status:'available',currency:'USD',basis:'reported_diluted_eps',annual:[2022,2023,2024,2025].map((year,i)=>({end:`${year}-12-31`,eps:2**i})),quarterly:[]};
 const row=withSyntheticFinancialProof({financial_history:history});
 const input={...present(row),history};
 expect(financialEvidencePresentation(input).rows.find(r=>r.id==='annual_eps_growth_3y').state).toBe('unknown');
});


it.each([['Basic EPS','基本EPS（報告値）'],['Diluted EPS','希薄化EPS（報告値）']])('retains the bound %s metric through the production adapter', (metric,label) => {
 const row=withSyntheticFinancialProof();row.financial_current.p[1][2]=metric;
 const input=present(row);
 expect(input.evidence.metrics.eps_growth_yy.metric).toBe(metric);
 expect(financialEvidencePresentation(input).rows[0]).toMatchObject({metric:label,actual:'30%',state:'pass',basis:'比較可能な四半期の前年同期比（報告値）'});
});

it.each([[50,'l','loss_narrowing','赤字縮小'],[150,'t','turnaround','黒字転換'],[0,'s','loss_unchanged','赤字横ばい']])('presents %s as a %s reference and keeps ordinary growth unknown', (value,code,comparison,label) => {
  const row=withSyntheticFinancialProof({eps_growth_yy:value});
  row.financial_current.r=row.financial_current.r.slice(0,1)+'f'+row.financial_current.r.slice(2);
  row.financial_current.p[1][6]=code;
  const input=present(row), detail=financialEvidencePresentation(input).rows[0], summary=financialEvidenceSummary(input)[0];
  expect(detail).toMatchObject({state:'unknown',actual:label,comparison,comparisonLabel:label,source:'yfinance',metric:'希薄化EPS（報告値）',referenceActual:`${value}%（比較期の絶対値を分母とした参考値）`});
  expect(summary.actual).toBe(detail.actual);
  expect(assess(row,'oneil',now).rules[0].state).toBe('unknown');
  expect(assess(row,'minervini',now).rules).toEqual(assess({...row,financial_current:undefined},'minervini',now).rules);
});
