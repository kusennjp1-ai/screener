import { expect, it } from 'vitest';
import { bookFinancialCurrent } from './bookFinancialCurrent';
import { bookFinancialEvidence } from './bookFinancialEvidence';
import { syntheticBookFinancials } from '../test/fixtures/bookFinancials';
const book=syntheticBookFinancials(), date=book.as_of_date;
const deadline=Date.parse('2025-12-31')+181*86400000-1;
it('preserves the inclusive 180-day book boundary and expires one millisecond later',()=>{
 expect(bookFinancialCurrent(book,'TEST',date,deadline)).toMatchObject({current:true,validUntil:deadline});
 expect(bookFinancialCurrent(book,'TEST',date,deadline+1)).toMatchObject({current:false,reason:'stale_book_period'});
});
it('makes a rebuilt current overview unknown on an old snapshot while keeping filed-time history intact',()=>{
 const original=structuredClone(book), historic=bookFinancialEvidence(book,'TEST',date);
 expect(bookFinancialCurrent(book,'TEST',date,deadline)).toMatchObject({current:true});
 expect(bookFinancialCurrent(book,'TEST',date,Date.parse('2026-10-04T00:00:00Z'))).toMatchObject({current:false,reason:'stale_book_period'});
 expect(bookFinancialCurrent(book,'TEST',date,deadline+1).report).toEqual(historic);
 expect(historic.epsAcceleration).toBe('pass');
 expect(book).toEqual(original);
});
it('rejects absent clock, wrong identity and a future snapshot without moving the filing cutoff',()=>{
 expect(bookFinancialCurrent(book,'TEST',date,NaN).current).toBe(false);
 expect(bookFinancialCurrent(book,'OTHER',date,deadline).current).toBe(false);
 expect(bookFinancialCurrent(book,'TEST',date,Date.parse('2026-01-01T00:00:00Z'))).toMatchObject({current:false,reason:'future_snapshot'});
});
