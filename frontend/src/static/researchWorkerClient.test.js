import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadResearchBundle, runDataWorker } from './researchWorkerClient';

afterEach(() => vi.unstubAllGlobals());
describe('research worker lifecycle', () => {
  it('sends parsing and preprocessing to a module worker and terminates it after completion', async () => {
    let instance;
    class WorkerMock {
      constructor(url, options) { this.url = url; this.options = options; instance = this; }
      postMessage = vi.fn();
      terminate = vi.fn();
    }
    vi.stubGlobal('Worker', WorkerMock);
    const fetchJson = vi.fn();
    const pending = loadResearchBundle('research-index-0123456789abcdef.json', '2026-09-29', fetchJson);
    expect(instance.options.type).toBe('module');
    expect(instance.postMessage.mock.calls[0][0]).toMatchObject({ operation: 'research', date: '2026-09-29' });
    instance.onmessage({ data: { result: { rows: [], date: '2026-09-29' } } });
    expect(await pending).toEqual({ rows: [], date: '2026-09-29' });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
  it('terminates aborted workers without accepting their obsolete result', async () => {
    let instance;
    vi.stubGlobal('Worker', class { constructor() { instance = this; } postMessage() {} terminate = vi.fn(); });
    const controller = new AbortController();
    const pending = runDataWorker({ operation: 'json', url: '/data.json' }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
  it('acknowledges only consumed nonterminal packets and preserves shared row identity', async () => {
    let instance;
    vi.stubGlobal('Worker', class { constructor() { instance = this; } postMessage = vi.fn(); terminate = vi.fn(); });
    const pending = runDataWorker({ operation: 'research' });
    const row = { symbol: 'SAFE', precise: 1 / 7, unknown: null };
    instance.onmessage({ data: { packet: { kind: 'rows', rows: [row] } } });
    expect(instance.postMessage.mock.calls).toEqual([[{ operation: 'research' }], [{ operation: 'next-packet' }]]);
    instance.onmessage({ data: { packet: { kind: 'ranking', method: 'minervini', items: [{ id: 0, assessment: { qualified: true } }] } } });
    expect(instance.postMessage).toHaveBeenCalledTimes(3);
    instance.onmessage({ data: { packet: { kind: 'complete', date: '2026-09-30', prepared: { candidates: [0] } } } });
    const result = await pending;
    expect(result.rows).toEqual([row]);
    expect(result.rankings.minervini[0].row).toBe(result.rows[0]);
    expect(result.prepared.candidates[0]).toBe(result.rows[0]);
    expect(instance.postMessage).toHaveBeenCalledTimes(3);
    expect(instance.terminate).toHaveBeenCalledOnce();
    expect(instance.onmessage).toBeNull();
  });
  it('stops acknowledgements after a mid-stream abort and ignores already queued messages', async () => {
    let instance;
    vi.stubGlobal('Worker', class { constructor() { instance = this; } postMessage = vi.fn(); terminate = vi.fn(); });
    const controller = new AbortController();
    const pending = runDataWorker({ operation: 'research' }, controller.signal);
    const queuedHandler = instance.onmessage;
    queuedHandler({ data: { packet: { kind: 'rows', rows: [{ symbol: 'OLD' }] } } });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const readObsoleteData = vi.fn();
    queuedHandler({ get data() { readObsoleteData(); return { packet: { kind: 'rows', rows: [] } }; } });
    expect(readObsoleteData).not.toHaveBeenCalled();
    expect(instance.postMessage).toHaveBeenCalledTimes(2);
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
  it('does not start a request that has already been aborted', async () => {
    let instance;
    vi.stubGlobal('Worker', class { constructor() { instance = this; } postMessage = vi.fn(); terminate = vi.fn(); });
    const controller = new AbortController(); controller.abort();
    await expect(runDataWorker({ operation: 'research' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(instance.postMessage).not.toHaveBeenCalled();
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
  it.each(['request', 'acknowledgement'])('cleans up a failed %s send', async phase => {
    let instance, sends = 0;
    vi.stubGlobal('Worker', class {
      constructor() { instance = this; }
      postMessage() { if (++sends === (phase === 'request' ? 1 : 2)) throw Error('Delivery failed'); }
      terminate = vi.fn();
    });
    const pending = runDataWorker({ operation: 'research' });
    if (phase === 'acknowledgement') instance.onmessage({ data: { packet: { kind: 'rows', rows: [] } } });
    await expect(pending).rejects.toThrow('Delivery failed');
    expect(instance.terminate).toHaveBeenCalledOnce();
    expect(instance.onmessage).toBeNull();
  });
  it('rejects malformed stream packets without requesting another packet', async () => {
    let instance;
    vi.stubGlobal('Worker', class { constructor() { instance = this; } postMessage = vi.fn(); terminate = vi.fn(); });
    const pending = runDataWorker({ operation: 'workbench' });
    instance.onmessage({ data: { packet: { kind: 'workbench-complete' } } });
    await expect(pending).rejects.toThrow('Missing workbench header');
    expect(instance.postMessage).toHaveBeenCalledOnce();
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
});
