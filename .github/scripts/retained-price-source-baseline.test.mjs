import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPriceRowsUnchanged} from './retained-price-source-baseline.mjs';
const before=[{symbol:'ORD',market:'US',currency:'USD',as_of_date:'2026-10-06',current_price:101,adv_usd:123,technical_audit:{valid:true},financial_current:{p:{eps:[1,2,3]}}},{symbol:'OLD',market:'US',currency:'CAD',as_of_date:'2026-10-06',current_price:null,adv_usd:null,technical_audit:{valid:false},retained_price_history:{observation_date:'2026-09-04'},financial_history:{status:'verified'}},{symbol:'UNDATED',as_of_date:'2026-10-06',current_price:null,price_quarantine:{status:'unverified_observation'}}];
test('compiler may expire financial facts while preserving all authenticated price fields',()=>{const after=structuredClone(before);after.reverse();after[1].financial_history={status:'unavailable',reason:'expired'};after[2].financial_current={p:{}};assertPriceRowsUnchanged(before,after);});
test('wrong price, old observation, quarantine, technical flag, native currency, count and membership reject',()=>{
  for(const change of [a=>a[0].current_price++,a=>a[0].adv_usd++,a=>a[0].as_of_date='2026-10-07',a=>a[0].technical_audit.valid=false,a=>a[1].currency='USD',a=>a[1].retained_price_history.observation_date='2026-10-06',a=>a[1].current_price=5,a=>delete a[2].price_quarantine,a=>a[2].current_price=6,a=>a.pop(),a=>a[2].symbol='ORD']){const after=structuredClone(before);change(after);assert.throws(()=>assertPriceRowsUnchanged(before,after));}
});

import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {assertFinitePriceBaseline} from './retained-price-source-baseline.mjs';
const pin=raw=>({bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')});
function bundleFixture(t){
  const root=mkdtempSync(join(tmpdir(),'finite-baseline-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=join(root,'source'),target=join(root,'target'),replay=join(root,'replay');mkdirSync(replay);
  const write=(base,path,value)=>{const full=join(base,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,JSON.stringify(value));};
  const unknown=symbol=>({symbol,market:'US',currency:'CAD',as_of_date:'2026-10-06',current_price:null,price_change_1d:null,adv_usd:null,volume:null,rs_rating:null,se_pivot_price:null,vcp_pivot:null,se_setup_ready:false,vcp_ready_for_breakout:false,technical_audit:{valid:false},chart_path:symbol==='UNDATED'?null:'charts/OLD.json',research_detail_path:`details/${symbol}.json`});
  const rows=[{...unknown('ORD'),currency:'USD',current_price:100,chart_path:'charts/ORD.json'},unknown('OLD'),unknown('UNDATED')];
  const prior={symbol:'OLD',market:'US',as_of_date:'2026-09-04',generated_at:'2026-09-05T01:00:00Z',bars:[{date:'2026-09-04',close:22,volume:100}]};
  const patch={symbol:'OLD',row:rows[1],snapshot:{publication_authority:false,schema_version:'retained-price-snapshot-v1',prior_chart:prior,actual_observation_date:'2026-09-04'}};
  const chart={...prior,as_of_date:'2026-10-06',stock_data:rows[1],retained_price_history:{observation_date:'2026-09-04',original_as_of_date:'2026-09-04'}};
  const index={market:'US',symbols:[{symbol:'ORD',path:'charts/ORD.json'},{symbol:'OLD',path:'charts/OLD.json'}]};
  const manifest={markets:{US:{assets:{research:{path:'research.json'},charts:{path:'charts-index.json'}},pages:{scan:{path:'scan.json'},home:{path:'home.json'}}}},assets:{charts:{path:'charts-index.json'}}};
  write(source,'static-data/manifest.json',manifest);write(source,'static-data/research.json',{rows});write(source,'static-data/chunk.json',{rows});write(source,'static-data/scan.json',{chunks:[{path:'chunk.json'}],charts:{path:'charts-index.json'},initial_rows:[rows[1]],preview_rows:[rows[2]]});
  write(source,'static-data/charts-index.json',index);write(source,'static-data/markets/us/charts/index.json',index);write(source,'static-data/charts/OLD.json',chart);write(source,'static-data/verified-charts/OLD-hash.json',chart);
  write(source,'static-data/charts/ORD.json',{symbol:'ORD',market:'US',bars:[{date:'2026-10-06',close:100}]});
  for(const row of rows)write(source,'static-data/details/'+row.symbol+'.json',row);
  write(source,'static-data/home.json',{market:'US',generated_at:'2026-10-06T10:00:00Z',key_markets:[{symbol:'TVC:DXY',latest_date:'2026-10-02',latest_close:null,history:[{date:'2026-10-02',close:100}]}],scan_summary:{top_results:[rows[2]]}});
  write(source,'static-data/markets/us/groups.json',{preserved:'real input'});
  const graph={materialized_inventory:{'static-data/markets/us/groups.json':pin(readFileSync(join(source,'static-data/markets/us/groups.json')))}};
  const prepared={target_as_of_date:'2026-10-06',patches:[patch],row_quarantines:[{symbol:'UNDATED'}]};write(replay,'prepared.json',prepared);write(replay,'graph.json',graph);cpSync(source,target,{recursive:true});
  const request={enabled:true,target_as_of_date:'2026-10-06',repair:{prepared:pin(readFileSync(join(replay,'prepared.json'))),expected:{rows:3,affected:2,restored_prior_histories:1,stale_candidate_histories:0,undated:1,chart_members:2}}};
  return{source,target,replay,request,write,check:()=>assertFinitePriceBaseline({sourceRoot:source,targetRoot:target,replayRoot:replay,request})};
}
test('complete finite baseline accepts financial expiry while binding charts, rows, aliases and audit',t=>{
  const f=bundleFixture(t),path='static-data/details/OLD.json',row=JSON.parse(readFileSync(join(f.target,path)));row.financial_history={status:'unavailable',reason:'expired'};f.write(f.target,path,row);assert.equal(f.check().retained_histories,1);
});
test('same-date retained bar mutation, capture clock, undated chart, DXY and group tampering reject',t=>{
  const mutations=[
    ['static-data/charts/OLD.json',x=>x.bars[0].close++],
    ['static-data/verified-charts/OLD-hash.json',x=>x.bars[0].volume++],
    ['static-data/charts/OLD.json',x=>x.generated_at='2026-10-07T00:00:00Z'],
    ['static-data/research.json',x=>x.rows[2].chart_path='charts/OLD.json'],
    ['static-data/details/OLD.json',x=>x.current_price=22],
    ['static-data/home.json',x=>x.key_markets[0].history[0].close++],
    ['static-data/markets/us/groups.json',x=>x.preserved='tampered'],
    ['static-data/charts-index.json',x=>x.symbols.pop()]
  ];
  for(const [path,mutate]of mutations){const f=bundleFixture(t),value=JSON.parse(readFileSync(join(f.target,path)));mutate(value);f.write(f.target,path,value);assert.throws(f.check,undefined,path);}
});
