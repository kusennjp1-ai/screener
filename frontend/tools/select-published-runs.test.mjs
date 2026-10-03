import { describe, expect, it } from 'vitest';
import { latestPublishedRun, publishedRuns, wasPublished } from '../../.github/scripts/select-published-runs.mjs';
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
 it('does not hide the last deployed bundle behind eight skipped uploads',()=>{
  const artifacts=Array.from({length:12},(_,i)=>item(i+1,`2026-10-${String(i+1).padStart(2,'0')}T00:00:00Z`));
  expect(publishedRuns([{artifacts}])).toHaveLength(12);
 });
});

const repository = 'owner/screener';
const run = { status: 'completed', conclusion: 'success', head_branch: 'main',
 path: '.github/workflows/research-ui-release.yml', repository: { full_name: repository }, head_repository: { full_name: repository } };
const deployed = [{ conclusion: 'success', steps: [{ name: 'Deploy to GitHub Pages', conclusion: 'success' }] }];
describe('actual deployment evidence',()=>{
 it('accepts current and legacy successful deployment steps',()=>{
  expect(wasPublished(run,deployed,repository)).toBe(true);
  expect(wasPublished({...run,path:'.github/workflows/static-site.yml'},[{conclusion:'success',steps:[{name:'Run actions/deploy-pages@v4',conclusion:'success'}]}],repository)).toBe(true);
 });
 it('rejects successful workflows with skipped, failed or absent deployment',()=>{
  for(const conclusion of ['skipped','failure',null]){
   expect(wasPublished(run,[{conclusion:'success',steps:[{name:'Deploy to GitHub Pages',conclusion}]}],repository)).toBe(false);
  }
  expect(wasPublished(run,[],repository)).toBe(false);
  expect(wasPublished({...run,conclusion:'failure'},deployed,repository)).toBe(false);
  expect(wasPublished({...run,head_repository:{full_name:'fork/screener'}},deployed,repository)).toBe(false);
  expect(wasPublished({...run,path:'.github/workflows/other.yml'},deployed,repository)).toBe(false);
 });
 it('walks past skipped release artifacts to the last real publication',()=>{
  const pages=[{artifacts:[item(20,'2026-10-02'),item(10,'2026-10-01')]}];
  const api=endpoint=>endpoint.includes('/jobs?') ? [{jobs:endpoint.includes('/20/')?[]:deployed}] : run;
  expect(latestPublishedRun(pages,repository,api)).toBe(10);
  expect(()=>latestPublishedRun(pages,repository,endpoint=>endpoint.includes('/jobs?')?[{jobs:[]}]:run)).toThrow('No verified');
 });
});
