import {expect,it} from 'vitest';
import {researchPackets,workbenchPackets,createResearchReceiver,researchPacketBytes,RESEARCH_RANKING_PACKET_BYTES} from './researchWorkerPackets';
it('delivers bounded packets without losing values, ranking, missing fields or shared row identity',()=>{
 const rows=Array.from({length:701},(_,i)=>({symbol:`S${i}`,current_price:i/7,unknown:null,entry_evidence:{calendar:{valid_until:'2026-10-01'}}}));
 const bundle={rows,date:'2026-09-30',rankings:{minervini:[...rows].reverse().map(row=>({row,assessment:{qualified:false,unknown:2}}))},prepared:{market:{cap:0},primary:0,strict:0,candidates:[rows[620]]}};
 const receive=createResearchReceiver();let result;
 for(const packet of researchPackets(bundle)) {expect(packet.rows?.length||0).toBeLessThanOrEqual(150);if(packet.kind==='ranking')expect(researchPacketBytes(packet)).toBeLessThanOrEqual(RESEARCH_RANKING_PACKET_BYTES);result=receive(structuredClone(packet));}
 expect(result).toEqual(bundle);
 expect(result.rankings.minervini[0].row).toBe(result.rows[700]);
 expect(result.prepared.candidates[0]).toBe(result.rows[620]);
});
it('keeps all workbench records and metadata while bounding the second large worker response',()=>{
 const records=Array.from({length:701},(_,index)=>({symbol:`S${index}`,state:'incomparable',changes:[],reason:null,precise:index/7}));
 const original={as_of:'2026-09-30',snapshot_id:'original-id',history:{previous_as_of:null},sectors:{groups:[]},changes:Object.fromEntries(['minervini','minervini2','oneil','ibd'].map(method=>[method,{counts:{incomparable:701},items:records}]))};
 const receive=createResearchReceiver();let result;
 for(const packet of workbenchPackets(original)){expect(packet.items?.length||0).toBeLessThanOrEqual(150);result=receive(structuredClone(packet));}
 expect(result).toEqual(original);
 expect(result.changes.oneil.items[700].precise).toBe(100);
 expect(()=>createResearchReceiver()({kind:'workbench-complete'})).toThrow('Missing workbench header');
});

const makeBundle = (count = 701) => {
 const rows = Array.from({length:count},(_,index)=>({symbol:`S${index}`,precise:index/7,missing:undefined,unknown:null}));
 return {rows,date:'2026-09-30',rankings:Object.fromEntries(['minervini','minervini2','oneil','ibd'].map(method=>[method,[...rows].reverse().map(row=>({row,assessment:{method,qualified:false,score:0,unknown:2,reason:'資料不足'}}))])),prepared:{candidates:rows.slice(0,2)},temporal:{date:'2026-09-30',rows,session_intervals:[],readiness_boundaries:[]}};
};
const consume = packets => {
 const receive=createResearchReceiver();let result;
 for(const packet of packets) result=receive(structuredClone(packet));
 return result;
};

it('batches all four rankings by exact envelope bytes while retaining every value and shared proof index',()=>{
 const bundle=makeBundle(5901),packets=[...researchPackets(bundle)];
 expect(packets.filter(packet=>packet.kind==='rows')).toHaveLength(40);
 expect(packets.filter(packet=>packet.kind==='ranking').length).toBeLessThan(160);
 for(const [sequence,packet] of packets.entries()) {
  expect(packet.sequence).toBe(sequence);
  if(packet.kind==='ranking')expect(new TextEncoder().encode(JSON.stringify({packet})).byteLength).toBeLessThanOrEqual(RESEARCH_RANKING_PACKET_BYTES);
 }
 const result=consume(packets);
 expect(result).toEqual(bundle);
 for(const method of Object.keys(bundle.rankings)){
  expect(result.rankings[method]).toHaveLength(5901);
  expect(result.rankings[method][0].row).toBe(result.rows[5900]);
  expect(result.rankings[method].at(-1).row).toBe(result.rows[0]);
 }
 expect(result.temporal.rows).toBe(result.rows);
 expect(result.prepared.candidates[0]).toBe(result.rows[0]);
 expect(result.rows[0]).toHaveProperty('missing',undefined);
});

it('accepts exactly 64 KiB with multibyte text and splits the next byte into another bounded packet',()=>{
 const bundle=makeBundle(2);bundle.rankings={minervini:bundle.rankings.minervini};
 const assessment=bundle.rankings.minervini[0].assessment;
 assessment.reason='日本🙂';
 let packet=[...researchPackets(bundle)].find(packet=>packet.kind==='ranking');
 assessment.reason+='x'.repeat(RESEARCH_RANKING_PACKET_BYTES-researchPacketBytes(packet));
 packet=[...researchPackets(bundle)].find(packet=>packet.kind==='ranking');
 expect(researchPacketBytes(packet)).toBe(RESEARCH_RANKING_PACKET_BYTES);
 expect(packet.items).toHaveLength(2);
 expect(consume([...researchPackets(bundle)])).toEqual(bundle);
 assessment.reason+='x';
 const packets=[...researchPackets(bundle)],ranking=packets.filter(packet=>packet.kind==='ranking');
 expect(ranking).toHaveLength(2);
 expect(ranking.map(packet=>packet.offset)).toEqual([0,1]);
 expect(ranking.every(packet=>researchPacketBytes(packet)<=RESEARCH_RANKING_PACKET_BYTES)).toBe(true);
 expect(consume(packets)).toEqual(bundle);
});

it('accounts for growing sequence and offset digits and rejects an indivisible oversized assessment',()=>{
 const bundle=makeBundle(151);
 bundle.rankings={minervini:bundle.rankings.minervini};
 for(const item of bundle.rankings.minervini)item.assessment.reason='x'.repeat(33_000);
 const packets=[...researchPackets(bundle,1)],ranking=packets.filter(packet=>packet.kind==='ranking');
 expect(ranking).toHaveLength(151);
 expect(ranking.at(-1)).toMatchObject({sequence:301,offset:150});
 expect(ranking.every(packet=>researchPacketBytes(packet)<=RESEARCH_RANKING_PACKET_BYTES)).toBe(true);
 expect(consume(packets)).toEqual(bundle);
 bundle.rankings.minervini[0].assessment.reason='x'.repeat(RESEARCH_RANKING_PACKET_BYTES);
 expect(()=>[...researchPackets(bundle)]).toThrow('Oversized research ranking item');
});

it('retains explicit empty method counts and completes only at the final endpoint',()=>{
 const bundle=makeBundle(0),packets=[...researchPackets(bundle)];
 expect(packets).toHaveLength(1);
 expect(packets[0]).toMatchObject({sequence:0,row_count:0,ranking_counts:{minervini:0,minervini2:0,oneil:0,ibd:0}});
 expect(consume(packets)).toEqual(bundle);
 const nonempty=makeBundle(1),receive=createResearchReceiver(),stream=[...researchPackets(nonempty)];
 for(const packet of stream.slice(0,-1))expect(receive(packet)).toBeNull();
 expect(receive(stream.at(-1))).toEqual(nonempty);
 expect(()=>receive(stream.at(-1))).toThrow('already complete');
});

it.each([
 ['stale sequence',packets=>{packets[1].sequence=0;},'sequence'],
 ['future sequence',packets=>{packets[1].sequence=2;},'sequence'],
 ['fractional sequence',packets=>{packets[1].sequence=1.5;},'sequence'],
 ['row offset',packets=>{packets[0].offset=1;},'row packet'],
 ['row count cap',packets=>{packets[0].rows=Array(151).fill({symbol:'S'});},'row packet'],
 ['rank offset',packets=>{packets[1].offset=1;},'ranking offset'],
 ['bad row reference',packets=>{packets[1].items[0].id=1;},'row reference'],
 ['negative row reference',packets=>{packets[1].items[0].id=-1;},'row reference'],
 ['fractional row reference',packets=>{packets[1].items[0].id=0.5;},'row reference'],
 ['oversized rank',packets=>{packets[1].items[0].assessment.reason='x'.repeat(RESEARCH_RANKING_PACKET_BYTES);},'ranking packet'],
 ['missing rows',packets=>{packets.at(-1).row_count=2;},'Incomplete research stream'],
 ['missing ranks',packets=>{packets.at(-1).ranking_counts.oneil=2;},'Incomplete research rankings'],
 ['missing method',packets=>{delete packets.at(-1).ranking_counts.ibd;},'Incomplete research rankings'],
 ['negative method count',packets=>{packets.at(-1).ranking_counts.ibd=-1;},'Incomplete research rankings'],
 ['bad prepared candidate',packets=>{packets.at(-1).prepared.candidates=[1];},'row reference'],
 ['unknown packet kind',packets=>{packets[1].kind='unexpected';},'packet kind'],
 ['mixed stream',packets=>{packets[1]={kind:'workbench-start',value:{changes:{}}};},'Mixed worker'],
])('rejects %s without publishing a partial bundle',(_,mutate,error)=>{
 const packets=structuredClone([...researchPackets(makeBundle(1))]);mutate(packets);
 expect(()=>consume(packets)).toThrow(error);
});

it('rejects rows arriving after ranking and ranks arriving before their rows',()=>{
 const packets=[...researchPackets(makeBundle(1))],receive=createResearchReceiver();
 receive(packets[0]);receive(packets[1]);
 expect(()=>receive({...packets[0],sequence:2,offset:1})).toThrow('row packet');
 expect(()=>createResearchReceiver()({...packets[1],sequence:0})).toThrow('row reference');
});

it.each(['drop','duplicate','reorder','early complete'])('rejects an actual %s in the packet stream', action=>{
 const packets=structuredClone([...researchPackets(makeBundle(151))]);
 if(action==='drop')packets.splice(2,1);
 if(action==='duplicate')packets.splice(3,0,packets[2]);
 if(action==='reorder')[packets[2],packets[3]]=[packets[3],packets[2]];
 if(action==='early complete')packets.splice(2,0,packets.at(-1));
 expect(()=>consume(packets)).toThrow('sequence');
});

it('sizes exact-cap packets across offset and sequence digit rollover',()=>{
 const bundle=makeBundle(12);bundle.rankings={minervini:bundle.rankings.minervini};
 // Each packet has one near-cap item. Rows take sequence zero, so ranking
 // sequences cross 9→10 as item offsets cross 9→10 independently.
 for(const [offset,item]of bundle.rankings.minervini.entries()) {
  item.assessment.reason='日本';
  const packet={kind:'ranking',sequence:offset+1,method:'minervini',offset,items:[{id:11-offset,assessment:item.assessment}]};
  item.assessment.reason+='x'.repeat(RESEARCH_RANKING_PACKET_BYTES-researchPacketBytes(packet));
 }
 const packets=[...researchPackets(bundle)],ranking=packets.filter(packet=>packet.kind==='ranking');
 expect(ranking).toHaveLength(12);
 for(const packet of ranking)expect(researchPacketBytes(packet)).toBe(RESEARCH_RANKING_PACKET_BYTES);
 expect(consume(packets)).toEqual(bundle);
 // A byte of undercounting on a header rollover would let this through.
 bundle.rankings.minervini[9].assessment.reason+='x';
 expect(()=>[...researchPackets(bundle)]).toThrow('Oversized research ranking item');
});
