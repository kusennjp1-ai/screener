// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { exportWorkbench } from './export-workbench.mjs';
import { summarizeWorkbench, validateWorkbenchDetails } from '../src/static/workbenchSummary.js';
import { withAuditFixture } from '../src/static/testAuditFixture.js';
import { withFinancialProof } from '../src/static/testFinancialFixture.js';
import { verifyWorkbenchComparison } from './workbench-comparison.mjs';

it('exports a separate overview while keeping the complete F3 workbench and immutable observation contract',async()=>{
  const root=await mkdtemp(join(tmpdir(),'workbench-summary-test-'));
  try {
    const rows=[{symbol:'TEST',current_price:20,adv_usd:30e6,gics_sector:'Technology'}];
    const manifest={generated_at:'2026-09-30T05:00:00Z'},entry={as_of_date:'2026-09-29',assets:{}};
    const result=await exportWorkbench({root,rows,manifest,entry,researchContent:JSON.stringify(rows)});
    const ref=entry.assets.workbench,summaryRef=entry.assets.workbench_summary;
    const raw=await readFile(join(root,ref.path),'utf8'),summaryRaw=await readFile(join(root,summaryRef.path),'utf8');
    const summary=JSON.parse(summaryRaw);
    expect(raw).toBe(JSON.stringify(result));
    expect(createHash('sha256').update(raw).digest('hex')).toBe(ref.sha256);
    expect(createHash('sha256').update(summaryRaw).digest('hex')).toBe(summaryRef.sha256);
    expect(summary).toEqual(summarizeWorkbench(result,ref));
    expect(validateWorkbenchDetails(result,summary)).toBe(result);
    expect(result.changes.minervini.items).toHaveLength(1);
    expect(result.changes.minervini.items[0].state).toBe('incomparable');
    expect(summary.changes.minervini).not.toHaveProperty('items');
    expect(summary.changes.minervini.counts).toEqual(result.changes.minervini.counts);
    const saved=await readFile(join(root,summary.current_snapshot.path));
    expect(createHash('sha256').update(saved).digest('hex')).toBe(result.current_snapshot.sha256);
    expect(JSON.parse(gunzipSync(saved).toString('utf8')).records[0].symbol).toBe('TEST');
    await verifyWorkbenchComparison({root,workbench:result,canonicalRows:rows});
    await expect(verifyWorkbenchComparison({root,workbench:result,canonicalRows:[{...rows[0],symbol:'OTHER'}]})).rejects.toThrow(/canonical inputs/);
    const firstRef={...ref},firstSnapshot={...result.current_snapshot};
    const again=await exportWorkbench({root,rows,manifest,entry,researchContent:JSON.stringify(rows)});
    expect(entry.assets.workbench).toEqual(firstRef);
    expect(again.current_snapshot).toEqual(firstSnapshot);
  } finally {
    if(!root.startsWith(join(tmpdir(),'workbench-summary-test-')))throw Error('Unexpected temporary workspace');
    await rm(root,{recursive:true,force:true});
  }
});

it.each([
  {initial:20,corrected:30,daily:'unchanged',current:'pass'},
  {initial:30,corrected:20,daily:'new',current:'fail'},
])('keeps recorded daily $daily after a same-date financial correction while current selection becomes $current',async({initial,corrected,daily,current})=>{
  const root=await mkdtemp(join(tmpdir(),'workbench-correction-test-'));
  const row=(date,now,eps)=>withFinancialProof(withAuditFixture({
    symbol:'TEST',market:'US',current_price:100,adv_usd:30e6,rs_rating:95,gics_sector:'Technology',
    eps_growth_yy:eps,sales_growth_yy:30,market_above_50dma:true,market_above_200dma:true,
    financial_history:{symbol:'TEST',as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Yahoo Finance',retrieved_at:new Date(now).toISOString(),
      annual:[{end:'2022-12-31',eps:1},{end:'2023-12-31',eps:1.3},{end:'2024-12-31',eps:1.7},{end:'2025-12-31',eps:2.3}]},
    institutional_evidence:{symbol:'TEST',status:'available',unit:'13f_reporting_manager_cik',publication_cutoff:date,
      observations:[{period:'2026-03-31',filing_date_first:'2026-04-30',filing_date_last:'2026-05-15',manager_count:5},{period:'2026-06-30',filing_date_first:'2026-07-31',filing_date_last:'2026-08-14',manager_count:7}]},
  },date),now,date);
  const publish=async(date,now,eps)=>{
    const rows=[row(date,now,eps)],entry={as_of_date:date,assets:{}};
    const result=await exportWorkbench({root,rows,manifest:{generated_at:new Date(now).toISOString()},entry,researchContent:JSON.stringify(rows)});
    const snapshot=JSON.parse(gunzipSync(await readFile(join(root,result.current_snapshot.path))).toString('utf8'));
    return {result,snapshot};
  };
  const record=refs=>writeFile(join(root,'candidate-history/index.json'),JSON.stringify({schema_version:1,snapshots:refs}));
  try {
    const previous=await publish('2026-10-01',Date.parse('2026-10-01T22:00:00Z'),20);
    await record([previous.result.current_snapshot]);
    const first=await publish('2026-10-02',Date.parse('2026-10-02T22:00:00Z'),initial);
    const refs=[previous.result.current_snapshot,first.result.current_snapshot];
    await record(refs);
    const recordedBytes=await Promise.all(refs.map(ref=>readFile(join(root,ref.path))));
    expect(first.result.changes.oneil.items[0].state).toBe(daily);
    expect(first.snapshot.financial_evaluated_at).toBe(Date.parse('2026-10-02T22:00:00Z'));
    const correction=await publish('2026-10-02',Date.parse('2026-10-03T10:00:00Z'),corrected);
    expect(correction.snapshot.records[0].methods.oneil.state).toBe(current);
    expect(correction.result.changes).toEqual(first.result.changes);
    expect(correction.result.daily_changes_snapshot).toEqual(first.result.current_snapshot);
    expect(correction.result.comparison_basis.mode).toBe('saved_first_same_policy');
    await verifyWorkbenchComparison({root,workbench:correction.result});
    expect(correction.result.sectors.groups.find(group=>group.key==='Technology').rates.oneil.pass).toBe(current==='pass'?1:0);
    expect(correction.result.current_snapshot.path).not.toBe(first.result.current_snapshot.path);
    expect(JSON.parse(await readFile(join(root,'candidate-history/index.json'),'utf8')).snapshots).toEqual(refs);
    for(let index=0;index<refs.length;index++)expect(await readFile(join(root,refs[index].path))).toEqual(recordedBytes[index]);
    const next=await publish('2026-10-05',Date.parse('2026-10-05T22:00:00Z'),corrected);
    expect(next.result.changes.oneil.items[0].state).toBe(current==='pass'?'new':'dropped');
    expect(next.result.daily_changes_snapshot).toEqual(next.result.current_snapshot);
    expect(next.result.comparison_basis).toMatchObject({mode:'saved_first_same_policy',current_source:'saved_first'});
    await verifyWorkbenchComparison({root,workbench:next.result});
    const tampered={...next.result,comparison_basis:{...next.result.comparison_basis,mode:'incompatible_policy'}};
    await expect(verifyWorkbenchComparison({root,workbench:tampered})).rejects.toThrow(/does not reproduce/);
  } finally {
    if(!root.startsWith(join(tmpdir(),'workbench-correction-test-')))throw Error('Unexpected temporary workspace');
    await rm(root,{recursive:true,force:true});
  }
});
