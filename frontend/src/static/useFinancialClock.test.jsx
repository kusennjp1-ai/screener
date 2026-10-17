import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFinancialClock, useFinancialDeadlineClock } from './useFinancialClock';
import { withFinancialProof, FINANCIAL_TEST_NOW as start } from './testFinancialFixture';
import { projectFinancialRow } from './financialCurrent';
import { bookFinancialCurrent } from './bookFinancialCurrent';
import { syntheticBookFinancials } from '../test/fixtures/bookFinancials';

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('expires an open view exactly after the inclusive source boundary',()=>{
  vi.useFakeTimers();vi.setSystemTime(start);
  const row=withFinancialProof({eps_growth_yy:30});row.financial_current.p['1'][5]=start+1000;
  const rows=[row];
  const hook=renderHook(()=>{const now=useFinancialClock(rows);return projectFinancialRow(row,{now});});
  expect(hook.result.current.eps_growth_yy).toBe(30);
  act(()=>vi.advanceTimersByTime(1000));expect(hook.result.current.eps_growth_yy).toBe(30);
  act(()=>vi.advanceTimersByTime(1));expect(hook.result.current.eps_growth_yy).toBeNull();
});
it.each(['focus','visibilitychange'])('rechecks a suspended view on %s without waiting for its timer',event=>{
  let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const row=withFinancialProof({eps_growth_yy:0});row.financial_current.p['1'][5]=start+1000;
  const rows=[row];const hook=renderHook(()=>{const now=useFinancialClock(rows);return projectFinancialRow(row,{now});});
  expect(hook.result.current.eps_growth_yy).toBe(0);
  clock=start+1001;
  act(()=>{(event==='focus'?window:document).dispatchEvent(new Event(event));});
  expect(hook.result.current.eps_growth_yy).toBeNull();
});
it('wakes for a selected detail-only book reference at its separate 180-day boundary',()=>{
  const book=syntheticBookFinancials(),row={symbol:'TEST',as_of_date:book.as_of_date,book_financials:book};
  const expiry=Date.parse('2025-12-31')+181*86400000-1;
  vi.useFakeTimers();vi.setSystemTime(expiry-1);
  const rows=[row];
  const hook=renderHook(()=>bookFinancialCurrent(book,row.symbol,row.as_of_date,useFinancialClock(rows)).current);
  expect(hook.result.current).toBe(true);
  act(()=>vi.advanceTimersByTime(1));expect(hook.result.current).toBe(true);
  act(()=>vi.advanceTimersByTime(1));expect(hook.result.current).toBe(false);
});

it('wakes at the worker deadline without adding a second millisecond to its inclusive source boundary',()=>{
  vi.useFakeTimers();vi.setSystemTime(start);
  const deadline=start+1001;
  const hook=renderHook(()=>useFinancialDeadlineClock(deadline)>=deadline);
  expect(hook.result.current).toBe(false);
  act(()=>vi.advanceTimersByTime(1000));expect(hook.result.current).toBe(false);
  act(()=>vi.advanceTimersByTime(1));expect(hook.result.current).toBe(true);
});

it.each(['focus','visibilitychange'])('rechecks a worker deadline on %s after suspended time',event=>{
  let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const deadline=start+1001;
  const hook=renderHook(()=>useFinancialDeadlineClock(deadline)>=deadline);
  expect(hook.result.current).toBe(false);
  clock=deadline;
  act(()=>{(event==='focus'?window:document).dispatchEvent(new Event(event));});
  expect(hook.result.current).toBe(true);
});

it('detects clock rollback during the existing periodic check even with no pending expiry',()=>{
  vi.useFakeTimers();vi.setSystemTime(start);
  const hook=renderHook(()=>useFinancialDeadlineClock(null));
  expect(hook.result.current).toBe(start);
  vi.setSystemTime(start-20000);
  act(()=>vi.advanceTimersByTime(15000));
  expect(hook.result.current).toBe(start-5000);
});

it('does not repeatedly wake an expired deadline while its replacement is pending',()=>{
  vi.useFakeTimers();vi.setSystemTime(start);
  let renders=0;
  const hook=renderHook(()=>{renders++;return useFinancialDeadlineClock(start+1001);});
  act(()=>vi.advanceTimersByTime(1001));
  expect(hook.result.current).toBe(start+1001);
  const expiredRenders=renders;
  act(()=>vi.advanceTimersByTime(10000));
  expect(renders).toBe(expiredRenders);
});

it('wakes at the exact optional annual-price midnight without a financial proof deadline', async () => {
  vi.useFakeTimers();
  const midnight=Date.parse('2026-11-02T05:00:00Z');vi.setSystemTime(midnight-1);
  const hook=renderHook(()=>useFinancialClock([], '2026-10-29'));
  expect(hook.result.current).toBe(midnight-1);
  await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect(hook.result.current).toBe(midnight);
  hook.unmount();vi.useRealTimers();
});
