// Bound each structured-clone delivery; a whole decoded universe otherwise
// monopolizes the main thread even when all computation ran in a Worker.
export function* researchPackets(bundle, size = 150) {
  const ids = new Map(bundle.rows.map((row, index) => [row, index]));
  for (let offset=0;offset<bundle.rows.length;offset+=size) yield {kind:'rows',rows:bundle.rows.slice(offset,offset+size)};
  for (const [method, ranked] of Object.entries(bundle.rankings)) for (let offset=0;offset<ranked.length;offset+=size) {
    yield {kind:'ranking',method,items:ranked.slice(offset,offset+size).map(({row,assessment})=>({id:ids.get(row),assessment}))};
  }
  yield {kind:'complete',date:bundle.date,evaluated_at:bundle.evaluated_at,next_expiry_at:bundle.next_expiry_at,generation:bundle.generation,evaluation_epoch:bundle.evaluation_epoch,assessment_version:bundle.assessment_version,prepared:{...bundle.prepared,candidates:bundle.prepared.candidates.map(row=>ids.get(row))}};
}

// Workbench history has thousands of change records, independent of the row
// bundle. Keep that second Worker delivery bounded as well.
export function* workbenchPackets(value, size = 150) {
  const changes=Object.fromEntries(Object.entries(value.changes || {}).map(([method,entry])=>[method,{...entry,items:[]} ]));
  yield {kind:'workbench-start',value:{...value,changes}};
  for(const [method,entry] of Object.entries(value.changes || {})) {
    if(!Array.isArray(entry.items)) throw Error('Invalid workbench change records');
    for(let offset=0;offset<entry.items.length;offset+=size) yield {kind:'workbench-items',method,items:entry.items.slice(offset,offset+size)};
  }
  yield {kind:'workbench-complete'};
}

export function createResearchReceiver() {
  const rows=[],rankings={};
  let workbench;
  return packet => {
    if(packet.kind==='rows') rows.push(...packet.rows);
    else if(packet.kind==='ranking') (rankings[packet.method] ||= []).push(...packet.items.map(({id,assessment})=>({row:rows[id],assessment})));
    else if(packet.kind==='complete') return {rows,rankings,date:packet.date,evaluated_at:packet.evaluated_at,next_expiry_at:packet.next_expiry_at,generation:packet.generation,evaluation_epoch:packet.evaluation_epoch,assessment_version:packet.assessment_version,prepared:{...packet.prepared,candidates:packet.prepared.candidates.map(id=>rows[id])}};
    else if(packet.kind==='workbench-start') workbench=packet.value;
    else if(packet.kind==='workbench-items') {
      if(!workbench || !Object.hasOwn(workbench.changes,packet.method)) throw Error('Invalid workbench packet');
      workbench.changes[packet.method].items.push(...packet.items);
    }
    else if(packet.kind==='workbench-complete') {if(!workbench)throw Error('Missing workbench header');return workbench;}
    return null;
  };
}
