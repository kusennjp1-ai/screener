import { expect, it } from 'vitest';
import { bookFinancialCurrent } from './bookFinancialCurrent';
import { bookFinancialEvidence } from './bookFinancialEvidence';
import { financialEvidenceSummary, FINANCIAL_PRESENTATION_SCHEMA } from './financialEvidencePresentation';
import { syntheticBookFinancials } from '../test/fixtures/bookFinancials';
const book=syntheticBookFinancials(), date=book.as_of_date;
const deadline=Date.parse('2025-12-31')+181*86400000-1;
const summary=now=>financialEvidenceSummary({symbol:'TEST',date,generation:'synthetic',method:'minervini',now,bookFinancials:book,
  evidence:{schema:FINANCIAL_PRESENTATION_SCHEMA,symbol:'TEST',as_of_date:date,generation:'synthetic',method:'minervini',evaluated_at:new Date(now).toISOString(),valid_until:new Date(now).toISOString(),metrics:{}}});
it('preserves the inclusive 180-day book boundary and expires one millisecond later',()=>{
 expect(bookFinancialCurrent(book,'TEST',date,deadline)).toMatchObject({current:true,validUntil:deadline});
 expect(bookFinancialCurrent(book,'TEST',date,deadline+1)).toMatchObject({current:false,reason:'stale_book_period'});
});
it('makes a rebuilt current overview unknown on an old snapshot while keeping filed-time history intact',()=>{
 const original=structuredClone(book), historic=bookFinancialEvidence(book,'TEST',date);
 expect(summary(deadline)[2]).toMatchObject({state:'reference',actual:'4四半期を確認'});
 expect(summary(Date.parse('2026-10-04T00:00:00Z'))[2]).toMatchObject({state:'unknown',actual:'未確認'});
 expect(summary(deadline+1)[2].explanation).toContain('現在の確認日から180日超');
 expect(summary(deadline+1)[3].explanation).toContain('純利益率改善 未確認');
 expect(bookFinancialCurrent(book,'TEST',date,deadline+1).report).toEqual(historic);
 expect(historic.epsAcceleration).toBe('pass');
 expect(book).toEqual(original);
});
it('rejects absent clock, wrong identity and a future snapshot without moving the filing cutoff',()=>{
 expect(bookFinancialCurrent(book,'TEST',date,NaN).current).toBe(false);
 expect(bookFinancialCurrent(book,'OTHER',date,deadline).current).toBe(false);
 expect(bookFinancialCurrent(book,'TEST',date,Date.parse('2026-01-01T00:00:00Z'))).toMatchObject({current:false,reason:'future_snapshot'});
});
