import { prepareResearchBundle } from './researchPreprocess.js';

async function read(url, sha256) {
  const response = await fetch(url, { cache: /-[a-f0-9]{16}\.json$/.test(url) ? 'default' : 'no-cache', headers: { Accept: 'application/json' } });
  if (!response.ok) throw Error(`データ取得に失敗しました（${response.status}）`);
  const raw = await response.text();
  if (sha256) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    if ([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== sha256) throw Error('Static asset integrity mismatch');
  }
  return JSON.parse(raw);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.operation === 'prepare') {
      self.postMessage({ result: prepareResearchBundle(data.payloads, data.date) });
      return;
    }
    const index = await read(data.url, data.sha256);
    const result = data.operation === 'research'
      ? prepareResearchBundle([index, ...await Promise.all((index.chunks || []).map(chunk => read(new URL(chunk.path, data.baseUrl).href)))], data.date)
      : index;
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
