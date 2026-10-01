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
});
