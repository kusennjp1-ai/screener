import { expect, it } from 'vitest';
import { summarizeWorkbench, validateWorkbenchSummary, validateWorkbenchDetails } from './workbenchSummary';

const date='2026-09-29', source='a'.repeat(64);
const ref={path:'workbench-full.json',sha256:'b'.repeat(64),as_of_date:date,snapshot_id:'snapshot'};
const full={as_of:date,snapshot_id:ref.snapshot_id,generated_at:`${date}T23:00:00Z`,source_research_sha256:source,
  history:{previous_as_of:'2026-09-28',limit:126},current_snapshot:{path:'candidate-history/immutable.json.gz'},
  sectors:{groups:[{key:'Technology',rates:{minervini:{pass:12,unknown:8}}}]},
  changes:{minervini:{counts:{new:1,incomparable:1},items:[{symbol:'PASS',state:'new',changes:[]},{symbol:'MISSING',state:'incomparable',reason:'未確認',changes:[]}]}}};

it('keeps published counts, sector inputs and F3 references without transferring any change item',()=>{
  const before=JSON.stringify(full), summary=summarizeWorkbench(full,ref);
  expect(summary.changes.minervini).toEqual({counts:{new:1,incomparable:1},item_count:2});
  expect(summary.changes.minervini).not.toHaveProperty('items');
  expect(summary.sectors).toEqual(full.sectors);
  expect(summary.current_snapshot).toEqual(full.current_snapshot);
  expect(summary.details).toEqual(ref);
  expect(JSON.stringify(full)).toBe(before);
  expect(summarizeWorkbench(summary)).toEqual(summary);
  expect(validateWorkbenchDetails(full,summary)).toBe(full);
});

it('does not invent a zero count or list for missing changes',()=>{
  expect(summarizeWorkbench({as_of:date,sectors:{groups:[]}},ref)).not.toHaveProperty('changes');
  const summary=summarizeWorkbench({...full,changes:{minervini:{}}},ref);
  expect(summary.changes.minervini.counts).toBeUndefined();
  expect(()=>validateWorkbenchSummary(summary,ref,ref,date,null,true)).toThrow('count mismatch');
});

it('rejects mixed dates, generations, full references, counts and incomplete detail responses',()=>{
  const summary=summarizeWorkbench(full,ref);
  const summaryRef={...ref,path:'summary.json',source_research_sha256:source};
  expect(validateWorkbenchSummary(summary,summaryRef,ref,date,`research-index-${source.slice(0,16)}.json`,true)).toEqual(summary);
  for (const change of [{as_of:'2026-09-30'},{snapshot_id:'different'},{source_research_sha256:'c'.repeat(64)}]) {
    expect(()=>validateWorkbenchSummary({...summary,...change},summaryRef,ref,date,null,true)).toThrow();
    expect(()=>validateWorkbenchDetails({...full,...change},summary)).toThrow();
  }
  expect(()=>validateWorkbenchSummary(summary,summaryRef,{...ref,sha256:'other'},date,null,true)).toThrow('reference mismatch');
  expect(()=>validateWorkbenchSummary(summary,summaryRef,ref,date,'research-index-cccccccccccccccc.json',true)).toThrow('generation mismatch');
  expect(()=>validateWorkbenchDetails({...full,generated_at:'2026-09-30T00:00:00Z'},summary)).toThrow('generation mismatch');
  expect(()=>validateWorkbenchDetails({...full,history:{previous_as_of:'2026-09-25'}},summary)).toThrow('history mismatch');
  expect(()=>validateWorkbenchDetails({...full,comparison_basis:{mode:'saved_first_same_policy'}},summary)).toThrow('comparison basis mismatch');
  for(const changes of [{},{minervini:{counts:{new:1,incomparable:1}}},{minervini:{counts:{new:2,incomparable:0},items:full.changes.minervini.items}}]) {
    expect(()=>validateWorkbenchDetails({...full,changes},summary)).toThrow();
  }
  const changed=structuredClone(full);changed.changes.minervini.items[1].state='new';
  expect(()=>validateWorkbenchDetails(changed,summary)).toThrow('count mismatch');
});

it('projects a legacy full response using the unchanged full reference',()=>{
  const result=validateWorkbenchSummary(full,ref,ref,date,null,false);
  expect(result.changes.minervini.items).toBeUndefined();
  expect(result.changes.minervini.counts).toEqual(full.changes.minervini.counts);
  expect(validateWorkbenchDetails(full,result)).toBe(full);
});
