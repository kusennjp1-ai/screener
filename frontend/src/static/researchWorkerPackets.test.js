import {expect,it} from 'vitest';
import {researchPackets,workbenchPackets,createResearchReceiver} from './researchWorkerPackets';
it('delivers bounded packets without losing values, ranking, missing fields or shared row identity',()=>{
 const rows=Array.from({length:701},(_,i)=>({symbol:`S${i}`,current_price:i/7,unknown:null,entry_evidence:{calendar:{valid_until:'2026-10-01'}}}));
 const bundle={rows,date:'2026-09-30',rankings:{minervini:[...rows].reverse().map(row=>({row,assessment:{qualified:false,unknown:2}}))},prepared:{market:{cap:0},primary:0,strict:0,candidates:[rows[620]]}};
 const receive=createResearchReceiver();let result;
 for(const packet of researchPackets(bundle)) {expect(packet.rows?.length||packet.items?.length||0).toBeLessThanOrEqual(150);result=receive(structuredClone(packet));}
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
