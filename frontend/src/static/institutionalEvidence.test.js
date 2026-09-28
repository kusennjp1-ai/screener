import {describe,it,expect} from 'vitest';
import {institutionalGrowth} from './institutionalEvidence';
const evidence={symbol:'AMD',status:'available',unit:'13f_reporting_manager_cik',publication_cutoff:'2026-08-31',observations:[
  {period:'2026-03-31',manager_count:100,filing_date_first:'2026-04-10',filing_date_last:'2026-05-15'},
  {period:'2026-06-30',manager_count:110,filing_date_first:'2026-07-10',filing_date_last:'2026-08-15'},
]};
describe('13F reporting-manager evidence',()=>{
  it('uses manager counts, not share changes',()=>expect(institutionalGrowth(evidence,'AMD','2026-09-25')).toMatchObject({increasing:true,delta:10}));
  it.each([null,{...evidence,unit:'shares'},{...evidence,symbol:'TSM'},{...evidence,publication_cutoff:'2026-10-01'},{...evidence,observations:[evidence.observations[1]]}])('rejects incomplete or incompatible evidence',data=>expect(institutionalGrowth(data,'AMD','2026-09-25').increasing).toBeNull());
  it('does not count future amendments in historical decisions',()=>expect(institutionalGrowth(evidence,'AMD','2026-08-20').increasing).toBeNull());
  it('rejects stale quarters',()=>expect(institutionalGrowth(evidence,'AMD','2027-02-01').increasing).toBeNull());
  it('an unchanged count fails rather than becoming unknown',()=>expect(institutionalGrowth({...evidence,observations:[evidence.observations[0],{...evidence.observations[1],manager_count:100}]},'AMD','2026-09-25').increasing).toBe(false));
});
