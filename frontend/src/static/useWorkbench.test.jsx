import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkbench, useWorkbenchDetails } from './useWorkbench';
import { summarizeWorkbench } from './workbenchSummary';
import { fetchStaticJson } from './dataClient';
vi.mock('./dataClient',()=>({fetchStaticJson:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const date='2026-09-29';
function fixture(id='one') {
  const ref={path:`workbench-${id}.json`,sha256:`full-${id}`,as_of_date:date,snapshot_id:id};
  const full={as_of:date,snapshot_id:id,generated_at:`${date}T23:00:00Z`,source_research_sha256:`source-${id}`,history:{previous_as_of:'2026-09-28'},
    sectors:{groups:[{key:'Technology'}]},current_snapshot:{path:`candidate-history/${id}.json.gz`},
    changes:{minervini:{counts:{new:1,incomparable:1},items:[{symbol:'PASS',state:'new',changes:[]},{symbol:'UNKNOWN',state:'incomparable',changes:[]}]}}};
  const summary=summarizeWorkbench(full,ref);
  return {full,summary,entry:{as_of_date:date,assets:{workbench:ref,workbench_summary:{...ref,path:`summary-${id}.json`,sha256:`summary-${id}`,source_research_sha256:`source-${id}`}}}};
}
function setup() {
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return {client,wrapper};
}
function useBoth(entry,open) {const overview=useWorkbench(entry);const details=useWorkbenchDetails(overview,open);return {overview,details};}

it('loads summary only until opened, then reads verified full items and reuses immutable data when reopened',async()=>{
  const {full,summary,entry}=fixture(),{wrapper}=setup();
  fetchStaticJson.mockImplementation(async path=>path.startsWith('summary')?summary:full);
  const {result,rerender}=renderHook(({open})=>useBoth(entry,open),{wrapper,initialProps:{open:false}});
  await waitFor(()=>expect(result.current.overview.isSuccess).toBe(true));
  expect(fetchStaticJson).toHaveBeenCalledExactlyOnceWith('summary-one.json',{sha256:'summary-one',worker:true});
  expect(result.current.overview.data.changes.minervini).not.toHaveProperty('items');
  expect(result.current.details.data).toBeUndefined();
  rerender({open:true});
  await waitFor(()=>expect(result.current.details.isSuccess).toBe(true));
  expect(fetchStaticJson).toHaveBeenLastCalledWith('workbench-one.json',{sha256:'full-one',worker:'workbench'});
  expect(result.current.details.data.changes.minervini.items[1].state).toBe('incomparable');
  rerender({open:false});rerender({open:true});
  expect(fetchStaticJson).toHaveBeenCalledTimes(2);
});

it('removes old details immediately when the selected snapshot changes and rejects a stale full response',async()=>{
  const a=fixture('one'),b=fixture('two'),{wrapper}=setup();
  let resolveSummary;
  fetchStaticJson.mockImplementation(path=>path==='summary-two.json'?new Promise(resolve=>{resolveSummary=resolve;}):Promise.resolve(path.startsWith('summary')?a.summary:a.full));
  const {result,rerender}=renderHook(({entry})=>useBoth(entry,true),{wrapper,initialProps:{entry:a.entry}});
  await waitFor(()=>expect(result.current.details.isSuccess).toBe(true));
  rerender({entry:b.entry});
  expect(result.current.overview.data).toBeUndefined();
  expect(result.current.details.data).toBeUndefined();
  resolveSummary(b.summary);
  await waitFor(()=>expect(result.current.details.isError).toBe(true));
  expect(result.current.details.data).toBeUndefined();
  expect(result.current.overview.data.changes.minervini.counts.incomparable).toBe(1);
});

it('revalidates cached details against counts and prevents a stale cache from satisfying a new generation at the same path',async()=>{
  const a=fixture(),{client,wrapper}=setup();
  client.setQueryData(['workbench-details',a.entry.assets.workbench.path,'full-one','one',date],a.full);
  const mismatched=structuredClone(a.summary);mismatched.changes.minervini.counts={new:2,incomparable:0};
  const {result,rerender}=renderHook(({summary})=>useWorkbenchDetails({data:summary},true),{wrapper,initialProps:{summary:mismatched}});
  await waitFor(()=>expect(result.current.isError).toBe(true));
  expect(fetchStaticJson).not.toHaveBeenCalled();
  const b=fixture('two');b.summary.details.path=a.summary.details.path;
  fetchStaticJson.mockResolvedValue(b.full);
  rerender({summary:b.summary});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  expect(fetchStaticJson).toHaveBeenCalledExactlyOnceWith('workbench-one.json',{sha256:'full-two',worker:'workbench'});
  expect(result.current.data.snapshot_id).toBe('two');
});

it('retains legacy manifest support without putting full change lists in the overview query',async()=>{
  const {full,entry}=fixture(),{wrapper}=setup();delete entry.assets.workbench_summary;
  fetchStaticJson.mockResolvedValue(full);
  const {result}=renderHook(()=>useWorkbench(entry),{wrapper});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  expect(fetchStaticJson).toHaveBeenCalledExactlyOnceWith('workbench-one.json',{sha256:'full-one',worker:'workbench-summary'});
  expect(result.current.data.changes.minervini).not.toHaveProperty('items');
  expect(result.current.data.details).toEqual(entry.assets.workbench);
});

it('does not fall back to an unrelated full file when a published summary is unavailable',async()=>{
  const {entry}=fixture(),{wrapper}=setup();fetchStaticJson.mockRejectedValue(Error('404'));
  const {result}=renderHook(()=>useBoth(entry,true),{wrapper});
  await waitFor(()=>expect(result.current.overview.isError).toBe(true));
  expect(result.current.details.isError).toBe(true);
  expect(result.current.details.data).toBeUndefined();
  expect(fetchStaticJson).toHaveBeenCalledTimes(1);
});

it.each(['invalid-schema','full-items'])('validates the unmodified new summary response (%s)',async mode=>{
  const {summary,entry}=fixture(),{wrapper}=setup();
  if(mode==='invalid-schema')summary.summary_schema='unsupported';
  else summary.changes.minervini.items=[];
  fetchStaticJson.mockResolvedValue(summary);
  const {result}=renderHook(()=>useBoth(entry,true),{wrapper});
  await waitFor(()=>expect(result.current.overview.isError).toBe(true));
  expect(result.current.details.data).toBeUndefined();
  expect(fetchStaticJson).toHaveBeenCalledExactlyOnceWith('summary-one.json',{sha256:'summary-one',worker:true});
});
