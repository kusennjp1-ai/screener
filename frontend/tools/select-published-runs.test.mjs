import { describe, expect, it } from 'vitest';
import { publishedRuns } from '../../.github/scripts/select-published-runs.mjs';
const item=(id,created_at,branch='main',expired=false)=>({id:id+100,created_at,expired,workflow_run:{id,head_branch:branch}});
describe('published artifact restoration',()=>{
 it('sorts all API pages by creation time instead of artifact ids or page order',()=>{
  expect(publishedRuns([{artifacts:[item(36805022628,'2026-10-01T05:08:47Z')]},{artifacts:[item(36818410505,'2026-10-01T05:26:00Z')]}])).toEqual([36818410505,36805022628]);
 });
 it('ignores expired, other-branch and malformed entries and deduplicates runs',()=>{
  const good=item(12,'2026-10-01T05:26:00Z');
  expect(publishedRuns([{artifacts:[good,good,item(13,'invalid'),item(14,'2026-10-02','feature'),item(15,'2026-10-02','main',true),item('unsafe','2026-10-02')]}])).toEqual([12]);
  expect(()=>publishedRuns([{unexpected:[]}])).toThrow('Invalid artifact response');
 });
});
