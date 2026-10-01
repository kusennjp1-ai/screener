// Bound each structured-clone delivery; a whole decoded universe otherwise
// monopolizes the main thread even when all computation ran in a Worker.
export function* researchPackets(bundle, size = 300) {
  const ids = new Map(bundle.rows.map((row, index) => [row, index]));
  for (let offset=0;offset<bundle.rows.length;offset+=size) yield {kind:'rows',rows:bundle.rows.slice(offset,offset+size)};
  for (const [method, ranked] of Object.entries(bundle.rankings)) for (let offset=0;offset<ranked.length;offset+=size) {
    yield {kind:'ranking',method,items:ranked.slice(offset,offset+size).map(({row,assessment})=>({id:ids.get(row),assessment}))};
  }
  yield {kind:'complete',date:bundle.date,prepared:{...bundle.prepared,candidates:bundle.prepared.candidates.map(row=>ids.get(row))}};
}

export function createResearchReceiver() {
  const rows=[],rankings={};
  return packet => {
    if(packet.kind==='rows') rows.push(...packet.rows);
    else if(packet.kind==='ranking') (rankings[packet.method] ||= []).push(...packet.items.map(({id,assessment})=>({row:rows[id],assessment})));
    else if(packet.kind==='complete') return {rows,rankings,date:packet.date,prepared:{...packet.prepared,candidates:packet.prepared.candidates.map(id=>rows[id])}};
    return null;
  };
}
