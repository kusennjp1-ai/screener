// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { financialPublicationException, FINANCIAL_PUBLICATION_EXCEPTION } from './financialPublicationException.js';
import { assess, rankCandidates, researchCsv } from './researchEngine.js';
import { entryReadiness } from './entryReadiness.js';
import { buildPortfolioPlan } from './portfolioPlan.js';
import { withFinancialProof } from './testFinancialFixture.js';
import { withAuditFixture } from './testAuditFixture.js';
import { parseFinancialCsv } from '../../tools/financial-design-cases.mjs';
import { encodeAssessment, decodeAssessment } from './assessmentEncoding.js';

const date = '2026-10-02', now = Date.parse('2026-10-04T15:00:00Z');
const row = (symbol = 'NVDA') => withFinancialProof(withAuditFixture({ symbol, market: 'US', currency: 'USD',
  current_price: 101, se_pivot_price: 100, rs_rating: 95, composite_rating: 95, eps_rating: 90, ibd_group_rank: 10,
  adv_usd: 50000000, market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true }, date), now, date);
const history = () => ({ symbol: 'NVDA', as_of_date: date, status: 'available', basis: 'reported_diluted_eps',
  currency: 'USD', source: 'Synthetic test source', retrieved_at: '2026-10-04T11:00:00Z', quarterly: [],
  annual: [1,2,4,8].map((eps,index) => ({ end: `${2022+index}-12-31`, eps })) });
const full = () => ({ ...row(), financial_history: history() });

describe('explicit five-symbol financial availability exception', () => {
  it('is bounded to the exact five US symbols and leaves other inputs untouched', () => {
    expect(FINANCIAL_PUBLICATION_EXCEPTION.symbols).toEqual(['NVDA','FUTU','AAOI','ALH','AVT']);
    for (const symbol of FINANCIAL_PUBLICATION_EXCEPTION.symbols) {
      const value = row(symbol), before = structuredClone(value);
      expect(financialPublicationException(value, { now })).toMatchObject({ symbol, reason: 'missing_history', qualified: false, satisfies_fresh_category: false });
      expect(value).toEqual(before);
    }
    for (const symbol of ['OTHER','nvda','NVDA ','AAPL']) expect(financialPublicationException(row(symbol), { now })).toBeNull();
    expect(financialPublicationException({ ...row(), market: 'HK' }, { now })).toBeNull();
  });

  it('excludes all methods, CSV and allocation without changing observed technical rule results', () => {
    for (const symbol of FINANCIAL_PUBLICATION_EXCEPTION.symbols) {
      const value = row(symbol);
      for (const method of ['minervini','minervini2','oneil','ibd']) {
        const assessment = assess(value, method, now);
        expect(assessment.qualified).toBe(false);
        expect(assessment.financial_exclusion).toMatchObject({ status: 'excluded_unknown', symbol });
        const encoded = encodeAssessment(assessment);
        expect(decodeAssessment(encoded)).toMatchObject({qualified:false,financial_exclusion:{symbol}});
        expect(decodeAssessment({...encoded,qualified:true})).toBeNull();
        expect(rankCandidates([value],method,{qualifiedOnly:true,now})).toEqual([]);
        const csv = parseFinancialCsv(researchCsv([{row:value}],method,date,now)).rows[0];
        expect(csv.qualified).toBe('false');
        expect(csv.method_status).not.toBe('pass');
        expect(csv.financial_exclusion_policy).toBe(FINANCIAL_PUBLICATION_EXCEPTION.version);
      }
      expect(assess(value,'minervini',now)).toMatchObject({passed:9,total:9,failed:0,unknown:0,qualified:false});
      const readiness = entryReadiness(value,date,{cap:.5,label:'上昇'},now);
      expect(readiness.ready).toBe(false);
      expect(readiness.rules[0].detail).toContain('財務未確認・判定対象外');
      expect(buildPortfolioPlan([value],date,100000,now).dailyPositions).toEqual([]);
    }
  });

  it('returns automatically to normal qualification when genuine current complete evidence exists', () => {
    const value = full();
    expect(financialPublicationException(value,{now})).toBeNull();
    expect(assess(value,'minervini',now)).toMatchObject({qualified:true,passed:9,total:9});
    expect(assess(value,'minervini',now)).not.toHaveProperty('financial_exclusion');
    value.financial_history.retrieved_at = '2026-09-30T11:00:00Z';
    expect(financialPublicationException(value,{now})).toMatchObject({reason:'unavailable_or_expired_annual_history'});
    expect(value.financial_history.retrieved_at).toBe('2026-09-30T11:00:00Z');
    delete value.financial_history.quarterly; // Omitted by compact list transport.
    expect(financialPublicationException(value,{now})).toMatchObject({reason:'unavailable_or_expired_annual_history'});
  });

  it('preserves the inclusive 72-hour history boundary without renewing its observation clock',()=>{
    const value=full(), observed=new Date(now-72*3600000).toISOString();
    value.financial_history.retrieved_at=observed;
    expect(financialPublicationException(value,{now})).toBeNull();
    expect(financialPublicationException(value,{now:now+1})).toMatchObject({reason:'unavailable_or_expired_annual_history'});
    expect(value.financial_history.retrieved_at).toBe(observed);
  });

  it('recognizes only the existing all-null unavailable placeholder as explicit absent metadata',()=>{
    const value={...row(),financial_history:{symbol:'NVDA',as_of_date:date,status:'unavailable',basis:'current-observation',
      source:null,retrieved_at:null,currency:null,annual:[],quarterly:[]}};
    expect(financialPublicationException(value,{now})).toMatchObject({reason:'missing_history'});
    delete value.financial_history.quarterly;
    expect(financialPublicationException(value,{now})).not.toBeNull();
    for (const name of ['schema_version','annual_source','annual_currency','quarterly_currency','quarterly_retrieved_at']) {
      value.financial_history[name] = false;
      expect(financialPublicationException(value,{now})).toBeNull();
      delete value.financial_history[name];
    }
    value.financial_history.currency='HKD';
    expect(financialPublicationException(value,{now})).toBeNull();
  });

  it('keeps known financial and price failures while excluding a missing annual comparison', () => {
    const value = full(); value.financial_history.annual[3].eps = null;
    value.financial_history.annual[1].eps = .5;
    value.technical_audit.values.sma200_21ago = 120;
    expect(financialPublicationException(value,{now})).toMatchObject({reason:'incomplete_annual_history'});
    expect(assess(value,'oneil',now).rules.find(rule=>rule.label.includes('3年')).state).toBe('fail');
    expect(assess(value,'minervini',now).failed).toBeGreaterThan(0);
  });

  it('rejects identity, value, currency, metadata, period and clock contradictions', () => {
    const changes = [
      value => { value.financial_current.s = 'OTHER'; },
      value => { value.eps_growth_yy = 99; },
      value => { value.eps_growth_yy = 'bad'; },
      value => { value.financial_history.currency = 'HKD'; value.financial_history.annual = []; },
      value => { value.financial_history.symbol = 'OTHER'; },
      value => { value.financial_history.as_of_date = '2026-10-01'; },
      value => { value.financial_history.annual[1].end = value.financial_history.annual[0].end; },
      value => { value.financial_history.annual[1].end = '2024-02-31'; },
      value => { value.financial_history.annual[1].eps = 'bad'; },
      value => { value.financial_history.annual[1].end = '2024-06-30'; },
      value => { value.financial_history.retrieved_at = '2026-10-05T00:00:00Z'; },
      value => { value.financial_history.retrieved_at = '2026-02-31T00:00:00Z'; },
      value => { value.financial_history.retrieved_at = '2026-10-03T24:00:00Z'; },
      value => { value.financial_history.retrieved_at = '2026-10-03T00:60:00Z'; },
      value => { value.financial_history.retrieved_at = '2026-10-03T00:00:60Z'; },
      value => { value.financial_history.retrieved_at = '2026-10-03T00:00:00+00:60'; },
      value => { value.financial_history.retrieved_at = 'bad'; },
      value => { value.financial_history.basis = 'adjusted'; },
    ];
    for (const change of changes) { const value=full(); change(value); expect(financialPublicationException(value,{now})).toBeNull(); }
    expect(financialPublicationException(full(),{now:NaN})).toBeNull();
  });
});
