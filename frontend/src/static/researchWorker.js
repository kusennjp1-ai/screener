import { prepareResearchBundle } from './researchPreprocess.js';
import { researchPackets, workbenchPackets } from './researchWorkerPackets.js';
import { summarizeWorkbench } from './workbenchSummary.js';

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

// A synchronous postMessage loop can queue the entire decoded publication
// before the main thread reads its first packet. Keep one packet in flight so
// its clone/receive work finishes before the next delivery is scheduled.
let pendingPackets;
function sendNextPacket() {
  if (!pendingPackets) throw Error('Missing worker packet stream');
  const next = pendingPackets.next();
  if (next.done) { pendingPackets = null; return; }
  self.postMessage({ packet: next.value });
}
function sendPackets(packets) {
  pendingPackets = packets;
  sendNextPacket();
}

self.onmessage = async ({ data }) => {
  try {
    if (data.operation === 'next-packet') { sendNextPacket(); return; }
    if (data.operation === 'prepare') {
      sendPackets(researchPackets(prepareResearchBundle(data.payloads,data.date)));
      return;
    }
    const index = await read(data.url, data.sha256);
    const result = data.operation === 'research'
      ? prepareResearchBundle([index, ...await Promise.all((index.chunks || []).map(chunk => read(new URL(chunk.path, data.baseUrl).href)))], data.date)
      : index;
    if(data.operation==='research') sendPackets(researchPackets(result));
    else if(data.operation==='workbench') sendPackets(workbenchPackets(result));
    else if(data.operation==='workbench-summary') self.postMessage({result:summarizeWorkbench(result)});
    else self.postMessage({ result });
  } catch (error) {
    pendingPackets = null;
    self.postMessage({ error: error.message });
  }
};
