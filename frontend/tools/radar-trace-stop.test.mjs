import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stoppedTraceArtifact, stopTracingWithDeadline } from './radar-trace-stop.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const session = send => Object.assign(new EventEmitter(), { send: vi.fn(send) });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('bounded trace stop acknowledgement and completion', () => {
  it('accepts acknowledgement followed by completion and removes its deadline/listener', async () => {
    const cdp = session(() => Promise.resolve()); const stopped = stopTracingWithDeadline(cdp, 100);
    await Promise.resolve(); await Promise.resolve();
    cdp.emit('Tracing.tracingComplete');
    expect(await stopped).toMatchObject({ ok: true, timed_out: false, end_acknowledged: true, completion_received: true });
    expect(cdp.send).toHaveBeenCalledExactlyOnceWith('Tracing.end');
    expect(cdp.listenerCount('Tracing.tracingComplete')).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not finish on an early completion event while acknowledgement remains pending', async () => {
    const ack = deferred(), cdp = session(() => { cdp.emit('Tracing.tracingComplete'); return ack.promise; });
    const stopped = stopTracingWithDeadline(cdp, 100); const resolved = vi.fn(); stopped.then(resolved);
    await vi.advanceTimersByTimeAsync(99); expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await stopped).toMatchObject({ ok: false, timed_out: true, end_acknowledged: false, completion_received: true });
    expect(cdp.listenerCount('Tracing.tracingComplete')).toBe(0);
    ack.reject(Error('late acknowledgement failure')); await Promise.resolve();
    expect(resolved).toHaveBeenCalledOnce();
  });
  it('accepts early completion once acknowledgement arrives inside the shared deadline', async () => {
    const ack = deferred(), cdp = session(() => { cdp.emit('Tracing.tracingComplete'); return ack.promise; });
    const stopped = stopTracingWithDeadline(cdp, 100);
    await vi.advanceTimersByTimeAsync(50); ack.resolve();
    expect(await stopped).toMatchObject({ ok: true, end_acknowledged: true, completion_received: true });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a missing completion event even after acknowledgement succeeds', async () => {
    const cdp = session(() => Promise.resolve()), stopped = stopTracingWithDeadline(cdp, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await stopped).toMatchObject({ ok: false, timed_out: true, end_acknowledged: true, completion_received: false });
    expect(cdp.listenerCount('Tracing.tracingComplete')).toBe(0);
  });
  it('does not restart the deadline when acknowledgement arrives late', async () => {
    const ack = deferred(), cdp = session(() => ack.promise), stopped = stopTracingWithDeadline(cdp, 100);
    await vi.advanceTimersByTimeAsync(95); ack.resolve(); await vi.advanceTimersByTimeAsync(5);
    expect(await stopped).toMatchObject({ ok: false, timed_out: true, end_acknowledged: true, completion_received: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([false, true])('records a rejected acknowledgement even if completion was received: %s', async earlyCompletion => {
    const cdp = session(() => { if (earlyCompletion) cdp.emit('Tracing.tracingComplete'); return Promise.reject(Error('session closed')); });
    const result = await stopTracingWithDeadline(cdp, 100);
    expect(result).toMatchObject({ ok: false, timed_out: false, end_acknowledged: false, completion_received: earlyCompletion });
    expect(result.error).toContain('Tracing.end rejected: Error: session closed');
    expect(cdp.listenerCount('Tracing.tracingComplete')).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps partial events and stop metadata when both sides stall, without accepting later events', async () => {
    const cdp = session(() => new Promise(() => {})), events = [{ name: 'Layout', ts: 10, dur: 20 }];
    const pending = stoppedTraceArtifact(cdp, events, 100);
    await vi.advanceTimersByTimeAsync(100);
    const artifact = await pending; events.push({ name: 'late Paint' }); cdp.emit('Tracing.tracingComplete');
    expect(artifact).toMatchObject({ partial: true, trace_stop: { ok: false, timed_out: true, end_acknowledged: false, completion_received: false } });
    expect(artifact.traceEvents).toEqual([{ name: 'Layout', ts: 10, dur: 20 }]);
    expect(cdp.listenerCount('Tracing.tracingComplete')).toBe(0);
  });
  it('keeps partial events when the protocol call throws synchronously', async () => {
    const cdp = session(() => { throw Error('detached'); });
    const artifact = await stoppedTraceArtifact(cdp, [{ name: 'Paint' }], 100);
    expect(artifact.partial).toBe(true); expect(artifact.traceEvents).toEqual([{ name: 'Paint' }]);
    expect(artifact.trace_stop.error).toContain('detached'); expect(vi.getTimerCount()).toBe(0);
  });
});
