import { prepareResearchBundle } from './researchPreprocess.js';
import { researchPackets, workbenchPackets } from './researchWorkerPackets.js';
import { summarizeWorkbench } from './workbenchSummary.js';

import { readStaticPayload } from './staticPublication.js';

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
      sendPackets(researchPackets(prepareResearchBundle(data.payloads,data.date,data.evaluation)));
      return;
    }
    const read = (path, sha256) => readStaticPayload(path, { publication: data.publication, sha256 });
    const index = await read(data.path, data.sha256);
    const result = data.operation === 'research'
      ? prepareResearchBundle([index, ...await Promise.all((index.chunks || []).map(chunk => read(chunk.path, chunk.sha256)))], data.date, data.evaluation)
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
