import { getStaticDataUrl } from '../config/runtimeMode';
import { prepareResearchBundle } from './researchPreprocess';
import { createResearchReceiver } from './researchWorkerPackets';

export function runDataWorker(request, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./researchWorker.js', import.meta.url), { type: 'module', name: 'research-data' });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      worker.onmessage = null; worker.onerror = null;
      worker.terminate(); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    const receive=createResearchReceiver();
    worker.onmessage = event => {
      if (settled) return;
      try {
        const { data } = event;
        if (data.packet) {
          const result = receive(data.packet);
          if (result) finish(null, result);
          else worker.postMessage({ operation: 'next-packet' });
        } else finish(data.error ? Error(data.error) : null, data.result);
      } catch (error) { finish(error); }
    };
    worker.onerror = () => finish(Error('分析データの前処理に失敗しました'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage(request); } catch (error) { finish(error); }
  });
}

export async function loadResearchBundle(path, date, fetchJson, signal) {
  if (typeof Worker !== 'undefined') return runDataWorker({
    operation: 'research', url: new URL(getStaticDataUrl(path), location.href).href,
    baseUrl: new URL(getStaticDataUrl(''), location.href).href, date,
  }, signal);
  // Compatibility fallback for environments without Worker (including jsdom).
  const index = await fetchJson(path);
  const chunks = await Promise.all((index.chunks || []).map(chunk => fetchJson(chunk.path)));
  return prepareResearchBundle([index, ...chunks], date);
}

export async function refreshResearchBundle(rows, date) {
  const payloads = [{ rows, as_of_date: date }];
  return typeof Worker !== 'undefined' ? runDataWorker({ operation: 'prepare', payloads, date }) : prepareResearchBundle(payloads, date);
}
