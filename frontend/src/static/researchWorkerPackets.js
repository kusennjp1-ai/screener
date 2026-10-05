// Rows contain substantially more data than rank summaries. Keep their existing
// bound; measured rank envelopes were ~19 KiB for 150 items, so 64 KiB removes
// serial ACKs while remaining smaller than a single measured row packet.
export const RESEARCH_ROW_PACKET_SIZE = 150;
export const RESEARCH_RANKING_PACKET_BYTES = 64 * 1024;
const encoder = new TextEncoder();
// ASCII JSON already has one byte per code unit; avoid temporary byte arrays
// for the usual numeric/boolean rank summaries while sizing Unicode exactly.
const utf8Bytes = json => /[\u0080-\uffff]/.test(json) ? encoder.encode(json).byteLength : json.length;
export const researchPacketBytes = packet => utf8Bytes(JSON.stringify({packet}));

export function* researchPackets(bundle, size = RESEARCH_ROW_PACKET_SIZE) {
  if (!Number.isSafeInteger(size) || size < 1 || size > RESEARCH_ROW_PACKET_SIZE) throw Error('Invalid research row packet size');
  const ids = new Map(bundle.rows.map((row, index) => [row, index]));
  let sequence = 0;
  // The row reference is a local ownership binding, never another copy of the
  // full universe in the final packet. The receiver binds its assembled rows.
  const temporal = bundle.temporal?.rows === bundle.rows && bundle.temporal?.date === bundle.date
    ? {date:bundle.temporal.date,session_intervals:bundle.temporal.session_intervals,readiness_boundaries:bundle.temporal.readiness_boundaries} : undefined;
  for (let offset=0;offset<bundle.rows.length;offset+=size) yield {kind:'rows',sequence:sequence++,offset,rows:bundle.rows.slice(offset,offset+size)};
  for (const [method, ranked] of Object.entries(bundle.rankings)) {
    let offset = 0, pending;
    while (offset < ranked.length) {
      const packet = {kind:'ranking',sequence:sequence++,method,offset,items:[]};
      let bytes = researchPacketBytes(packet);
      while (offset + packet.items.length < ranked.length) {
        if (!pending) {
          const items = ranked.slice(offset + packet.items.length, offset + packet.items.length + RESEARCH_ROW_PACKET_SIZE).map(({row,assessment})=>{
            const id = ids.get(row);
            if (!Number.isSafeInteger(id)) throw Error('Unknown research ranking row');
            return {id,assessment};
          });
          pending = {items,bytes:utf8Bytes(JSON.stringify(items)) - 2};
        }
        // Size the existing small rank chunks once, including UTF-8 characters.
        // Carry an unconsumed chunk to the next packet instead of serializing
        // every item independently. The objects themselves still use clone,
        // retaining values that JSON sizing would otherwise normalize.
        const separator = packet.items.length ? 1 : 0;
        if (bytes + pending.bytes + separator > RESEARCH_RANKING_PACKET_BYTES) {
          if (packet.items.length) break;
          if (pending.items.length === 1) throw Error('Oversized research ranking item');
          // A future larger assessment may need a smaller chunk. The remainder
          // is read from ranked at the next offset, so no item can be skipped.
          const items = pending.items.slice(0, Math.floor(pending.items.length / 2));
          pending = {items,bytes:utf8Bytes(JSON.stringify(items)) - 2};
          continue;
        }
        packet.items.push(...pending.items);
        bytes += pending.bytes + separator;
        pending = undefined;
      }
      offset += packet.items.length;
      yield packet;
    }
  }
  yield {kind:'complete',sequence,row_count:bundle.rows.length,ranking_counts:Object.fromEntries(Object.entries(bundle.rankings).map(([method,items])=>[method,items.length])),instrument_applicability_universe:bundle.instrument_applicability_universe,date:bundle.date,evaluated_at:bundle.evaluated_at,next_expiry_at:bundle.next_expiry_at,generation:bundle.generation,evaluation_epoch:bundle.evaluation_epoch,assessment_version:bundle.assessment_version,temporal,prepared:{...bundle.prepared,candidates:bundle.prepared.candidates.map(row=>ids.get(row))}};
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
  let workbench, streamKind, sequence = 0, rankingStarted = false, complete = false;
  const rowAt = id => {
    if (!Number.isSafeInteger(id) || id < 0 || id >= rows.length) throw Error('Invalid research row reference');
    return rows[id];
  };
  return packet => {
    if (complete) throw Error('Research stream already complete');
    const research = ['rows','ranking','complete'].includes(packet.kind);
    const workbenchPacket = ['workbench-start','workbench-items','workbench-complete'].includes(packet.kind);
    if (!research && !workbenchPacket) throw Error('Invalid research packet kind');
    const kind = research ? 'research' : 'workbench';
    if (streamKind && streamKind !== kind) throw Error('Mixed worker packet streams');
    streamKind = kind;
    if (research) {
      if (packet.sequence !== sequence) throw Error('Invalid research packet sequence');
      sequence++;
    }
    if(packet.kind==='rows') {
      if (rankingStarted || packet.offset !== rows.length || !Array.isArray(packet.rows) || !packet.rows.length || packet.rows.length > RESEARCH_ROW_PACKET_SIZE) throw Error('Invalid research row packet');
      rows.push(...packet.rows);
    }
    else if(packet.kind==='ranking') {
      if (typeof packet.method !== 'string' || !packet.method || !Array.isArray(packet.items) || !packet.items.length || researchPacketBytes(packet) > RESEARCH_RANKING_PACKET_BYTES) throw Error('Invalid research ranking packet');
      const ranked = Object.hasOwn(rankings, packet.method) ? rankings[packet.method] : [];
      if (packet.offset !== ranked.length) throw Error('Invalid research ranking offset');
      const items = packet.items.map(({id,assessment})=>({row:rowAt(id),assessment}));
      if (!Object.hasOwn(rankings, packet.method)) Object.defineProperty(rankings, packet.method, {value:ranked,enumerable:true,writable:true,configurable:true});
      ranked.push(...items);
      rankingStarted = true;
    }
    else if(packet.kind==='complete') {
      if (packet.row_count !== rows.length || !packet.ranking_counts || typeof packet.ranking_counts !== 'object' || Array.isArray(packet.ranking_counts)) throw Error('Incomplete research stream');
      const counts = Object.entries(packet.ranking_counts);
      if (Object.keys(rankings).some(method=>!Object.hasOwn(packet.ranking_counts,method)) || counts.some(([method,count])=>!Number.isSafeInteger(count) || count < 0 || count !== (Object.hasOwn(rankings,method) ? rankings[method].length : 0))) throw Error('Incomplete research rankings');
      for (const [method] of counts) if (!Object.hasOwn(rankings,method)) Object.defineProperty(rankings,method,{value:[],enumerable:true,writable:true,configurable:true});
      const result = {rows,rankings,instrument_applicability_universe:packet.instrument_applicability_universe,date:packet.date,evaluated_at:packet.evaluated_at,next_expiry_at:packet.next_expiry_at,generation:packet.generation,evaluation_epoch:packet.evaluation_epoch,assessment_version:packet.assessment_version,temporal:packet.temporal && {...packet.temporal,rows},prepared:{...packet.prepared,candidates:packet.prepared.candidates.map(rowAt)}};
      complete = true;
      return result;
    }
    else if(packet.kind==='workbench-start') workbench=packet.value;
    else if(packet.kind==='workbench-items') {
      if(!workbench || !Object.hasOwn(workbench.changes,packet.method)) throw Error('Invalid workbench packet');
      workbench.changes[packet.method].items.push(...packet.items);
    }
    else if(packet.kind==='workbench-complete') {if(!workbench)throw Error('Missing workbench header');complete=true;return workbench;}
    else throw Error('Invalid research packet kind');
    return null;
  };
}
