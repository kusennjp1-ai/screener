import { resolveStaticPublication } from './staticPublication';
import { prepareResearchBundle, validResearchEvaluation } from './researchPreprocess';
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
      if (!error && request.evaluation) {
        if (result?.generation !== request.evaluation.generation || result?.evaluation_epoch !== request.evaluation.evaluationEpoch || result?.evaluated_at !== request.evaluation.now || (request.date != null && result?.date !== request.date)) error = Error('Obsolete research evaluation');
        else if (!validResearchEvaluation(result)) error = Error('Invalid research evaluation deadline');
      }
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

export async function loadResearchBundle(path, date, fetchJson, signal, { now = Date.now(), generation = null, evaluationEpoch = 0, publication, sha256 } = {}) {
  const pinned = await resolveStaticPublication({ publication, generation });
  const indexSha256 = sha256 || (/^research-index-[a-f0-9]{16}\.json$/.test(path) && /^[a-f0-9]{64}$/.test(generation || '') ? generation : undefined);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (typeof Worker !== 'undefined') return runDataWorker({
    operation: 'research', path, publication: pinned, sha256: indexSha256, date, evaluation:{now,generation,evaluationEpoch},
  }, signal);
  // Compatibility fallback for environments without Worker (including jsdom).
  const index = await fetchJson(path, { publication: pinned, sha256: indexSha256, signal, now, asOfDate: date });
  const chunks = await Promise.all((index.chunks || []).map(chunk => fetchJson(chunk.path, { publication: pinned, sha256: chunk.sha256, signal, now, asOfDate: date })));
  return prepareResearchBundle([index, ...chunks], date, {now,generation,evaluationEpoch});
}

export async function refreshResearchBundle(rows, date, { now = Date.now(), generation = null, evaluationEpoch = 0, signal } = {}) {
  const payloads = [{ rows, as_of_date: date }];
  return typeof Worker !== 'undefined' ? runDataWorker({ operation: 'prepare', payloads, date, evaluation:{now,generation,evaluationEpoch} },signal) : prepareResearchBundle(payloads, date,{now,generation,evaluationEpoch});
}
