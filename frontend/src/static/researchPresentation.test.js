import { describe, expect, it } from 'vitest';
import { canonicalPivot, filterRanked, formatPublished, sessionCurrent } from './researchPresentation';
import { entryPlan, rankCandidates } from './researchEngine';
import { withAuditFixture } from './testAuditFixture';

describe('audit remediation contracts', () => {
  it('uses one level and rejects remote obsolete pivots without inventing a base', () => {
    expect(canonicalPivot({current_price:100,se_pivot_price:99,vcp_pivot:110}).price).toBe(99);
    expect(entryPlan({current_price:85.71,se_pivot_price:31.68}).pivot).toBeNull();
    expect(canonicalPivot({current_price:80,se_pivot_price:110}).price).toBeNull();
    expect(canonicalPivot(null).price).toBeNull();
  });
  it('filters already evaluated rows without replacing their evidence', () => {
    const ranked = [{row:{symbol:'A',technical_audit:{valid:true}},assessment:{qualified:true}}, {row:{symbol:'B'},assessment:{qualified:false}}];
    expect(filterRanked(ranked,{coverage:'verified'})[0]).toBe(ranked[0]);
    expect(filterRanked(ranked,{coverage:'unverified'})).toEqual([ranked[1]]);
    expect(filterRanked(ranked,{search:'b',qualifiedOnly:true})).toEqual([]);
  });
  it('does not mark Friday stale on a calendar-verified weekend, nor after expiry', () => {
    const rows = [{entry_evidence:{as_of_date:'2026-09-25',calendar:{latest_completed_session:'2026-09-25',evaluated_at:'2026-09-26T00:00:00Z',valid_until:'2026-09-28T20:00:00Z'}}}];
    expect(sessionCurrent(rows,'2026-09-25',Date.parse('2026-09-27T16:00:00Z'))).toBe(true);
    expect(sessionCurrent(rows,'2026-09-25',Date.parse('2026-09-28T21:00:00Z'))).toBe(false);
    expect(sessionCurrent(rows,'2026-09-24',Date.parse('2026-09-27T16:00:00Z'))).toBe(false);
  });
  it('labels UTC and naive UTC timestamps in Japanese local time', () => {
    expect(formatPublished('2026-09-26T04:37:23')).toBe(formatPublished('2026-09-26T04:37:23Z'));
    expect(formatPublished('2026-09-26T04:37:23Z')).toContain('13:37:23 JST');
  });
  it('puts a qualified near-trigger candidate ahead of an extended high-RS name', () => {
    const base = withAuditFixture({symbol:'NEAR',market:'US',current_price:102,se_pivot_price:100,rs_rating:80});
    const far = {...base,symbol:'FAR',se_pivot_price:85,rs_rating:99,technical_audit:{...base.technical_audit,symbol:'FAR'}};
    expect(rankCandidates([far,base],'minervini')[0].row.symbol).toBe('NEAR');
  });
});
