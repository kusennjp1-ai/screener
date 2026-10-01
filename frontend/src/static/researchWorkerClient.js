import { getStaticDataUrl } from '../config/runtimeMode';
import { prepareResearchBundle } from './researchPreprocess';
import { createResearchReceiver } from './researchWorkerPackets';

export function runDataWorker(request, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./researchWorker.js', import.meta.url), { type: 'module', name: 'research-data' });
    const dispose = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { dispose(); reject(new DOMException('Aborted', 'AbortError')); };
    const receive=createResearchReceiver();
    worker.onmessage = ({ data }) => {
      if(data.packet) { try { const result=receive(data.packet);if(result){dispose();resolve(result);} } catch(error) {dispose();reject(error);} return; }
      dispose(); if (data.error) reject(Error(data.error)); else resolve(data.result);
    };
    worker.onerror = () => { dispose(); reject(Error('分析データの前処理に失敗しました')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.postMessage(request);
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
