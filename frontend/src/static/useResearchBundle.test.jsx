import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useResearchBundle } from './useResearchBundle';
import { prepareResearchBundle } from './researchPreprocess';
import { withFinancialProof, FINANCIAL_TEST_NOW as start, FINANCIAL_TEST_DATE as date } from './testFinancialFixture';

const worker=vi.hoisted(()=>({loadResearchBundle:vi.fn(),refreshResearchBundle:vi.fn()}));
vi.mock('./researchWorkerClient',()=>worker);
vi.mock('./dataClient',()=>({fetchStaticJson:vi.fn()}));
afterEach(()=>vi.restoreAllMocks());

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
