import { afterEach, expect, it, vi } from 'vitest';
afterEach(()=>vi.unstubAllGlobals());

it('projects 7556 legacy change items inside the worker instead of posting them to the main thread',async()=>{
  const changes=Object.fromEntries(['minervini','minervini2','oneil','ibd'].map(method=>[method,{counts:{incomparable:1889},items:Array.from({length:1889},(_,i)=>({symbol:`S${i}`,state:'incomparable',changes:[]}))}]));
  const raw=JSON.stringify({as_of:'2026-09-29',snapshot_id:'legacy',changes,sectors:{groups:[]},current_snapshot:{path:'candidate-history/immutable.json.gz'}});
  const postMessage=vi.fn();vi.stubGlobal('self',{postMessage});
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,text:async()=>raw})));
  await import('./researchWorker');
  await self.onmessage({data:{operation:'workbench-summary',url:'https://example.test/workbench.json'}});
  expect(postMessage).toHaveBeenCalledTimes(1);
  const message=postMessage.mock.calls[0][0];
  expect(message.error).toBeUndefined();
  for(const result of Object.values(message.result.changes)) {
    expect(result.counts.incomparable).toBe(1889);
    expect(result.item_count).toBe(1889);
    expect(result).not.toHaveProperty('items');
  }
  expect(message.result.current_snapshot.path).toBe('candidate-history/immutable.json.gz');
  expect(JSON.stringify(message).length).toBeLessThan(raw.length/100);
});
