import { describe, expect, it } from 'vitest';
import { encodeAssessment, decodeAssessment } from './assessmentEncoding';
import { assess, assessmentSummary, RULE_SUMMARY_VERSION } from './researchEngine';
import { withAuditFixture } from './testAuditFixture';

describe('compact assessment transport',()=>{
  it('preserves pass, fail and unknown decisions for every method',()=>{
    for(const row of [{symbol:'NONE'},withAuditFixture({symbol:'LEAD',current_price:102,rs_rating:95}),withAuditFixture({symbol:'FAIL',current_price:10,rs_rating:10})]) {
      for(const method of ['minervini','minervini2','oneil','ibd']) {
        const {rules,...full}=assess(row,method);
        expect(rules.length).toBe(full.total);
        expect(decodeAssessment(encodeAssessment(full))).toEqual(full);
        expect(decodeAssessment(full)).toBe(full);
        const packed={...row,method_summary:{version:RULE_SUMMARY_VERSION,[method]:encodeAssessment(full)}};
        const recomputed=assessmentSummary(packed,method);
        expect(recomputed).not.toHaveProperty('rules');expect(recomputed).toEqual(full);
        expect(full.qualified).toBe(assess(row,method).qualified);
      }
    }
  });
  it('rejects corrupt packed counts without treating unknown as pass',()=>{
    for(const value of [[9,0,1,9,0],[0,0,0,0,0],[9,0,0,9,2],[1.5,0,0,2,0]]) expect(decodeAssessment(value)).toBeNull();
  });
});

it('rejects corrupt object summaries before a cached pass can be reused',()=>{
 const {rules,...valid}=assess(withAuditFixture({symbol:'TEST',current_price:100,rs_rating:95}),'minervini');
 expect(valid.total).toBe(rules.length);
 for(const bad of [{},true,4,'pass',{...valid,passed:-1},{...valid,unknown:1},{...valid,qualified:false},{...valid,score:NaN},{...valid,templateMismatch:null}])expect(decodeAssessment(bad)).toBeNull();
});
