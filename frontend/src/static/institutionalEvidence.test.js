import {describe,it,expect} from 'vitest';
import {institutionalGrowth} from './institutionalEvidence';
import {assess} from './researchEngine';
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
  it('preserves a documented CUSIP transition as unknown in core sponsorship rules despite a cached positive badge',()=>{
    const data={...evidence,symbol:'CCL',observations:[{...evidence.observations[0],manager_count:29},{...evidence.observations[1],manager_count:988}]};
    expect(institutionalGrowth(data,'CCL','2026-09-25')).toMatchObject({increasing:null,delta:null,identityChange:{effectiveDate:'2026-05-07'}});
    const row={symbol:'CCL',technical_audit:{as_of_date:'2026-09-25'},institutional_evidence:data,institutional_sponsors_increasing:true};
    const sponsorship=assess(row,'oneil',Date.parse('2026-09-25T20:00:00Z')).rules.find(rule=>/13F/.test(rule.label));
    expect(sponsorship).toMatchObject({state:'unknown',evidence:expect.stringContaining('CUSIP変更')});
    const control={...row,symbol:'AMD',institutional_evidence:{...data,symbol:'AMD'}};
    expect(assess(control,'oneil',Date.parse('2026-09-25T20:00:00Z')).rules.find(rule=>/13F/.test(rule.label)).state).toBe('pass');
  });
});
