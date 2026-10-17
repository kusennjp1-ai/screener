import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useResearchBundle } from './useResearchBundle';
import { prepareResearchBundle } from './researchPreprocess';
import * as financial from './financialCurrent';
import { withFinancialProof, FINANCIAL_TEST_NOW as start, FINANCIAL_TEST_DATE as date } from './testFinancialFixture';

const worker=vi.hoisted(()=>({loadResearchBundle:vi.fn(),refreshResearchBundle:vi.fn()}));
vi.mock('./researchWorkerClient',()=>worker);
vi.mock('./dataClient',()=>({fetchStaticJson:vi.fn()}));
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();});

it('withholds expired rows, rankings and portfolio together until the matching epoch completes',async()=>{
  let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const row=withFinancialProof({eps_growth_yy:30});row.financial_current.p['1'][5]=start+1000;
  worker.loadResearchBundle.mockImplementation((_path,_date,_fetch,_signal,options)=>Promise.resolve(prepareResearchBundle([{as_of_date:date,rows:[row]}],date,options)));
  let finish;
  worker.refreshResearchBundle.mockImplementation((rows,date,options)=>new Promise(resolve=>{finish=()=>resolve(prepareResearchBundle([{as_of_date:date,rows}],date,options));}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook=renderHook(()=>useResearchBundle('research-one.json',date,'generation-one'),{wrapper});
  await waitFor(()=>expect(hook.result.current.data?.rows).toHaveLength(1));
  expect(hook.result.current.data.rows[0].eps_growth_yy).toBe(30);
  clock=start+1001;act(()=>window.dispatchEvent(new Event('focus')));
  await waitFor(()=>expect(worker.refreshResearchBundle).toHaveBeenCalled());
  expect(hook.result.current.data).toBeUndefined();
  expect(hook.result.current.evaluating).toBe(true);
  await act(async()=>finish());
  await waitFor(()=>expect(hook.result.current.data?.evaluated_at).toBe(clock));
  expect(hook.result.current.data.rows[0].eps_growth_yy).toBeNull();
  expect(hook.result.current.data.prepared.candidates).toEqual([]);
  hook.unmount();client.clear();
});

it('does not accept a pending expiry result after publication replacement',async()=>{
  let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const row=withFinancialProof({eps_growth_yy:30});row.financial_current.p['1'][5]=start+1000;
  worker.loadResearchBundle.mockImplementation((_path,_date,_fetch,_signal,options)=>Promise.resolve(prepareResearchBundle([{as_of_date:date,rows:[row]}],date,options)));
  let finish, signal;
  worker.refreshResearchBundle.mockImplementation((rows,date,options)=>new Promise(resolve=>{signal=options.signal;finish=()=>resolve(prepareResearchBundle([{as_of_date:date,rows}],date,options));}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook=renderHook(({generation})=>useResearchBundle(`research-${generation}.json`,date,generation),{wrapper,initialProps:{generation:'old'}});
  await waitFor(()=>expect(hook.result.current.data?.generation).toBe('old'));
  clock=start+1001;act(()=>window.dispatchEvent(new Event('focus')));
  await waitFor(()=>expect(finish).toBeTypeOf('function'));
  hook.rerender({generation:'new'});
  await waitFor(()=>expect(hook.result.current.data?.generation).toBe('new'));
  expect(signal.aborted).toBe(true);
  await act(async()=>finish());
  expect(hook.result.current.data.generation).toBe('new');
  hook.unmount();client.clear();
});

it('uses the verified deadline without re-projecting or scanning 5,901 delivered rows on the main thread',async()=>{
  let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const row=withFinancialProof({eps_growth_yy:30});row.financial_current.p['1'][5]=start+1000;
  const prepared=prepareResearchBundle([{as_of_date:date,rows:[row]}],date,{now:start,generation:'one',evaluationEpoch:1});
  // Model the already validated worker delivery. Any main-thread attempt to
  // walk this universe fails, regardless of how financial helpers are named.
  const rows=Array.from({length:5901},()=>prepared.rows[0]);
  Object.defineProperty(rows,Symbol.iterator,{value:()=>{throw Error('Unexpected main-thread universe scan');}});
  const delivered={...prepared,rows};
  worker.loadResearchBundle.mockResolvedValue(delivered);
  const nextExpiry=vi.spyOn(financial,'financialNextExpiry');
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook=renderHook(()=>useResearchBundle('research-one.json',date,'one'),{wrapper});
  await waitFor(()=>expect(hook.result.current.data?.rows).toBe(rows));
  expect(hook.result.current.data.rows.length).toBe(5901);
  hook.rerender();
  clock=start+1000;act(()=>window.dispatchEvent(new Event('focus')));
  expect(hook.result.current.data.rows).toBe(rows);
  expect(nextExpiry).not.toHaveBeenCalled();
  expect(worker.refreshResearchBundle).not.toHaveBeenCalled();
  hook.unmount();client.clear();
});

it('withholds an already expired worker delivery before the first candidate-ready result',async()=>{
  let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const row=withFinancialProof({eps_growth_yy:30});row.financial_current.p['1'][5]=start+1000;
  let deliver,finish;
  worker.loadResearchBundle.mockImplementation((_path,_date,_fetch,_signal,options)=>new Promise(resolve=>{deliver=()=>resolve(prepareResearchBundle([{as_of_date:date,rows:[row]}],date,options));}));
  worker.refreshResearchBundle.mockImplementation((rows,date,options)=>new Promise(resolve=>{finish=()=>resolve(prepareResearchBundle([{as_of_date:date,rows}],date,options));}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const observed=[];
  const hook=renderHook(()=>{const value=useResearchBundle('research-one.json',date,'one');observed.push(value.data);return value;},{wrapper});
  await waitFor(()=>expect(deliver).toBeTypeOf('function'));
  clock=start+1001;
  await act(async()=>deliver());
  await waitFor(()=>expect(finish).toBeTypeOf('function'));
  expect(observed.every(value=>value===undefined)).toBe(true);
  expect(hook.result.current.evaluating).toBe(true);
  await act(async()=>finish());
  await waitFor(()=>expect(hook.result.current.data?.evaluated_at).toBe(clock));
  expect(hook.result.current.data.rows[0].eps_growth_yy).toBeNull();
  hook.unmount();client.clear();
});

it('withholds the prior evaluation after clock rollback until a new source evaluation completes',async()=>{
  let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const row=withFinancialProof({eps_growth_yy:30});
  worker.loadResearchBundle.mockImplementation((_path,_date,_fetch,_signal,options)=>Promise.resolve(prepareResearchBundle([{as_of_date:date,rows:[row]}],date,options)));
  let finish;
  worker.refreshResearchBundle.mockImplementation((rows,date,options)=>new Promise(resolve=>{finish=()=>resolve(prepareResearchBundle([{as_of_date:date,rows}],date,options));}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook=renderHook(()=>useResearchBundle('research-one.json',date,'one'),{wrapper});
  await waitFor(()=>expect(hook.result.current.data?.rows[0].eps_growth_yy).toBe(30));
  clock=start-1;act(()=>window.dispatchEvent(new Event('focus')));
  await waitFor(()=>expect(finish).toBeTypeOf('function'));
  expect(hook.result.current.data).toBeUndefined();
  await act(async()=>finish());
  await waitFor(()=>expect(hook.result.current.data?.evaluated_at).toBe(clock));
  expect(hook.result.current.data.rows[0].eps_growth_yy).toBeNull();
  hook.unmount();client.clear();
});

it('lets the pending expiry worker finish without a timer-driven restart loop',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);
  const row=withFinancialProof({eps_growth_yy:30});row.financial_current.p['1'][5]=start+1000;
  worker.loadResearchBundle.mockImplementation((_path,_date,_fetch,_signal,options)=>Promise.resolve(prepareResearchBundle([{as_of_date:date,rows:[row]}],date,options)));
  let finish,signal;
  worker.refreshResearchBundle.mockImplementation((rows,date,options)=>new Promise(resolve=>{signal=options.signal;finish=()=>resolve(prepareResearchBundle([{as_of_date:date,rows}],date,options));}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook=renderHook(()=>useResearchBundle('research-one.json',date,'one'),{wrapper});
  await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect(hook.result.current.data?.rows[0].eps_growth_yy).toBe(30);
  await act(async()=>vi.advanceTimersByTimeAsync(999));
  expect(hook.result.current.data?.rows[0].eps_growth_yy).toBe(30);
  await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect(hook.result.current.data).toBeUndefined();
  expect(worker.refreshResearchBundle).toHaveBeenCalledTimes(1);
  await act(async()=>vi.advanceTimersByTimeAsync(100));
  expect(signal.aborted).toBe(false);
  expect(worker.refreshResearchBundle).toHaveBeenCalledTimes(1);
  await act(async()=>{finish();await vi.advanceTimersByTimeAsync(1);});
  expect(hook.result.current.data?.rows[0].eps_growth_yy).toBeNull();
  hook.unmount();client.clear();
});

it('keeps a pending source evaluation through later ordinary renders but replaces it on clock rollback',async()=>{
  let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const row=withFinancialProof({eps_growth_yy:30});row.financial_current.p['1'][5]=start+1000;
  worker.loadResearchBundle.mockImplementation((_path,_date,_fetch,_signal,options)=>Promise.resolve(prepareResearchBundle([{as_of_date:date,rows:[row]}],date,options)));
  const pending=[];
  worker.refreshResearchBundle.mockImplementation((rows,date,options)=>new Promise(resolve=>pending.push({signal:options.signal,now:options.now,finish:()=>resolve(prepareResearchBundle([{as_of_date:date,rows}],date,options))})));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook=renderHook(()=>useResearchBundle('research-one.json',date,'one'),{wrapper});
  await waitFor(()=>expect(hook.result.current.data?.rows).toHaveLength(1));
  clock=start+2000;act(()=>window.dispatchEvent(new Event('focus')));
  await waitFor(()=>expect(pending).toHaveLength(1));
  expect(hook.result.current.data).toBeUndefined();
  clock+=100;hook.rerender();
  expect(pending[0].signal.aborted).toBe(false);
  expect(worker.refreshResearchBundle).toHaveBeenCalledTimes(1);
  clock+=100;act(()=>window.dispatchEvent(new Event('focus')));
  expect(pending[0].signal.aborted).toBe(false);
  expect(worker.refreshResearchBundle).toHaveBeenCalledTimes(1);
  // Still expired, so current remains false: rollback must invalidate the
  // newer in-flight evaluation independently of that boolean transition.
  clock=start+1900;act(()=>window.dispatchEvent(new Event('focus')));
  await waitFor(()=>expect(pending).toHaveLength(2));
  expect(pending[0].signal.aborted).toBe(true);
  expect(pending[1].signal.aborted).toBe(false);
  expect(pending[1].now).toBe(clock);
  await act(async()=>pending[0].finish());
  expect(hook.result.current.data).toBeUndefined();
  await act(async()=>pending[1].finish());
  await waitFor(()=>expect(hook.result.current.data?.evaluated_at).toBe(clock));
  expect(hook.result.current.data.rows[0].eps_growth_yy).toBeNull();
  hook.unmount();client.clear();
});

it('withholds and refetches a changed snapshot date even if its path and generation are reused',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(start);
  const nextDate='2026-10-03';
  let deliver;
  worker.loadResearchBundle.mockImplementation((_path,requestedDate,_fetch,_signal,options)=>{
    const value=()=>prepareResearchBundle([{as_of_date:requestedDate,rows:[withFinancialProof({symbol:requestedDate,eps_growth_yy:30},start,requestedDate)]}],requestedDate,options);
    return requestedDate===date ? Promise.resolve(value()) : new Promise(resolve=>{deliver=()=>resolve(value());});
  });
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook=renderHook(({snapshot})=>useResearchBundle('research-one.json',snapshot,'one'),{wrapper,initialProps:{snapshot:date}});
  await waitFor(()=>expect(hook.result.current.data?.date).toBe(date));
  hook.rerender({snapshot:nextDate});
  expect(hook.result.current.data).toBeUndefined();
  await waitFor(()=>expect(deliver).toBeTypeOf('function'));
  expect(worker.refreshResearchBundle).not.toHaveBeenCalled();
  await act(async()=>deliver());
  await waitFor(()=>expect(hook.result.current.data?.date).toBe(nextDate));
  expect(hook.result.current.data.rows[0].symbol).toBe(nextDate);
  hook.unmount();client.clear();
});

it.each([undefined,null])('accepts the actual validated snapshot with expected date %s and reuses it on expiry',async expectedDate=>{
  let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const row=withFinancialProof({eps_growth_yy:30});row.financial_current.p['1'][5]=start+1000;
  worker.loadResearchBundle.mockImplementation((_path,expectation,_fetch,_signal,options)=>Promise.resolve(prepareResearchBundle([{as_of_date:date,rows:[row]}],expectation,options)));
  worker.refreshResearchBundle.mockImplementation((rows,actualDate,options)=>Promise.resolve(prepareResearchBundle([{as_of_date:actualDate,rows}],actualDate,options)));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const invalidate=vi.spyOn(client,'invalidateQueries');
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook=renderHook(()=>useResearchBundle('research-one.json',expectedDate,'one'),{wrapper});
  await waitFor(()=>expect(hook.result.current.data?.date).toBe(date));
  hook.rerender();hook.rerender();
  expect(worker.loadResearchBundle).toHaveBeenCalledTimes(1);
  expect(invalidate).not.toHaveBeenCalled();
  clock=start+1001;act(()=>window.dispatchEvent(new Event('focus')));
  await waitFor(()=>expect(hook.result.current.data?.evaluated_at).toBe(clock));
  expect(worker.refreshResearchBundle).toHaveBeenCalledTimes(1);
  expect(worker.refreshResearchBundle.mock.calls[0][1]).toBe(date);
  expect(hook.result.current.data.rows[0].eps_growth_yy).toBeNull();
  expect(invalidate).not.toHaveBeenCalled();
  expect(worker.loadResearchBundle).toHaveBeenCalledTimes(1);
  hook.unmount();client.clear();
});

it.each(['annual_source','new_york_age'])('withdraws the optional annual condition at %s expiry and rejects the preceding generation result',async boundary=>{
  const deadline=boundary==='annual_source'?start+1000:Date.parse('2026-10-06T04:00:00Z');
  let clock=deadline-1000;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const buildRow=(day,isNew=false)=>({symbol:'ANNUAL',market:'US',as_of_date:day,financial_history:{
    symbol:'ANNUAL',as_of_date:day,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic provider',
    retrieved_at:new Date(boundary==='annual_source'&&!isNew?deadline-72*3600000-1:clock-1000).toISOString(),
    annual:[1,1.2,1.6,2].map((eps,i)=>({end:`${2022+i}-12-31`,eps})),quarterly:[],
  }});
  worker.loadResearchBundle.mockImplementation((_path,day,_fetch,_signal,options)=>Promise.resolve(prepareResearchBundle([{as_of_date:day,rows:[buildRow(day,options.generation==='new')]}],day,options)));
  let finish,signal;
  worker.refreshResearchBundle.mockImplementation((rows,day,options)=>new Promise(resolve=>{signal=options.signal;finish=()=>resolve(prepareResearchBundle([{as_of_date:day,rows}],day,options));}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook=renderHook(({generation,day})=>useResearchBundle(`research-${generation}.json`,day,generation),{wrapper,initialProps:{generation:'old',day:date}});
  await waitFor(()=>expect(hook.result.current.data?.annual_eps.states).toEqual(['pass']));
  expect(hook.result.current.data.next_expiry_at).toBe(deadline);
  clock=deadline;act(()=>window.dispatchEvent(new Event('focus')));
  await waitFor(()=>expect(finish).toBeTypeOf('function'));expect(hook.result.current.data).toBeUndefined();
  hook.rerender({generation:'new',day:boundary==='new_york_age'?'2026-10-05':date});
  await waitFor(()=>expect(hook.result.current.data?.generation).toBe('new'));
  expect(hook.result.current.data.annual_eps.states).toEqual(['pass']);expect(signal.aborted).toBe(true);
  await act(async()=>finish());
  expect(hook.result.current.data.generation).toBe('new');expect(hook.result.current.data.annual_eps.states).toEqual(['pass']);
  expect(hook.result.current.data.annual_eps.rows).toBe(hook.result.current.data.rows);
  hook.unmount();client.clear();
});
