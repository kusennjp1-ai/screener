// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { exportWorkbench } from './export-workbench.mjs';
import { summarizeWorkbench, validateWorkbenchDetails } from '../src/static/workbenchSummary.js';

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
    const firstRef={...ref},firstSnapshot={...result.current_snapshot};
    const again=await exportWorkbench({root,rows,manifest,entry,researchContent:JSON.stringify(rows)});
    expect(entry.assets.workbench).toEqual(firstRef);
    expect(again.current_snapshot).toEqual(firstSnapshot);
  } finally {
    if(!root.startsWith(join(tmpdir(),'workbench-summary-test-')))throw Error('Unexpected temporary workspace');
    await rm(root,{recursive:true,force:true});
  }
});
