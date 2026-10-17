// @vitest-environment node
import { expect, it } from 'vitest';
import { validateResearchParity } from './research-quality.mjs';
import { encodeResearchIndex } from '../src/static/researchTransport.js';
import { withAuditFixture } from '../src/static/testAuditFixture.js';
import { withFinancialProof, FINANCIAL_TEST_NOW as now, FINANCIAL_TEST_DATE as date } from '../src/static/testFinancialFixture.js';

const fixture = values => withFinancialProof(withAuditFixture({symbol:'TEST',market:'US',currency:'USD',current_price:100,adv_usd:30000000,rs_rating:90,
 financial_history:{symbol:'TEST',as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic provider',retrieved_at:new Date(now-3600000).toISOString(),annual:values.map((eps,i)=>({end:`${2022+i}-12-31`,eps})),quarterly:[]}},date),now,date);
it.each([[1,1.2,1.6,2],[1,2,1.5,null],[1,null,1.5,2]])('checks canonical, list, encoded JSON, worker, hydration and CSV parity for %j',(...values)=>{
 const row=fixture(values);const wire=JSON.parse(JSON.stringify(encodeResearchIndex({rows:[row],as_of_date:date})));
 expect(()=>validateResearchParity(wire,[row],now)).not.toThrow();
 expect(()=>validateResearchParity(wire,[row],now+4*86400000)).not.toThrow();
});
it('detects a financial value changed only in the compact publication',()=>{
 const row=fixture([1,1.2,1.6,2]), changed=structuredClone(row);changed.financial_history.annual[3].eps=1.6;
 const wire=encodeResearchIndex({rows:[changed],as_of_date:date});
 expect(()=>validateResearchParity(wire,[row],now)).toThrow(/annual EPS/);
});
it.each(['currency','basis','unit'])('keeps hostile per-cell %s parity without certifying the rejected evidence',key=>{
 const row=fixture([1,1.2,1.6,2]);row.financial_history.annual[1][key]='contradiction';
 const wire=JSON.parse(JSON.stringify(encodeResearchIndex({rows:[row],as_of_date:date})));
 expect(()=>validateResearchParity(wire,[row],now)).not.toThrow();
});

it('retains a contradictory history market through the publication quality check',()=>{
 const row=fixture([1,1.2,1.6,2]);row.financial_history.market='JP';
 const wire=JSON.parse(JSON.stringify(encodeResearchIndex({rows:[row],as_of_date:date})));
 expect(()=>validateResearchParity(wire,[row],now)).not.toThrow();
});
