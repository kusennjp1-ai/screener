import {it,expect} from 'vitest';
import {entryReadiness,prepareReadinessTimeline} from './entryReadiness';
import {buildPortfolioPlan} from './portfolioPlan';
import {withAuditFixture} from './testAuditFixture';
const now=Date.parse('2026-09-26T10:00:00Z'),date='2026-09-25';
const row=()=>withAuditFixture({symbol:'LEAD',market:'US',currency:'USD',gics_sector:'Tech',market_regime:'confirmed_uptrend',market_above_50dma:true,market_above_200dma:true,passes_template:true,rs_rating:95,week_52_low_distance:50,week_52_high_distance:3,composite_rating:95,eps_rating:90,ibd_group_rank:10,adv_usd:50000000,current_price:101,se_pivot_price:100,se_pattern_confidence:80,
entry_evidence:{as_of_date:date,calendar:{latest_completed_session:date,evaluated_at:'2026-09-26T09:00:00Z',valid_until:'2026-09-28T20:00:00Z'},earnings:{date:'2026-10-20',checked_at:'2026-09-26T09:00:00Z'},shape:{candidate:true,summary:'自動推定'},volumeRatio:1.5}},date);
it('leaves blanket hold when every measured daily condition passes',()=>{
 const r=row(), result=entryReadiness(r,date,{cap:.5,label:'上昇'},now);
 expect(result.ready).toBe(true);
 const plan=buildPortfolioPlan([r],date,100000,now);
 expect(plan.decision).toBe('1銘柄が日次の買い条件を通過'); expect(plan.dailyPositions).toHaveLength(1);
 expect(plan.executionExposure).toBe(0); // passing rules does not invent a fill
});
it('fails closed for missing/expired calendars, earnings, shape or volume',()=>{
 for(const modify of [r=>r.entry_evidence.earnings=null,r=>r.entry_evidence.earnings.date='2026-09-28',r=>r.entry_evidence.calendar.valid_until='2026-09-25T20:00:00Z',r=>r.entry_evidence.shape.candidate=false,r=>r.entry_evidence.volumeRatio=1,r=>r.current_price=106,r=>r.entry_evidence.as_of_date='2026-09-24']){
 const r=row();modify(r);expect(entryReadiness(r,date,{cap:.5,label:'上昇'},now).ready).toBe(false);
 }
});
it('keeps cash acquisitions and near-static prices out of purchase plans without changing book qualifications',()=>{
 for(const extra of [{corporate_action:{cash_acquisition:true}},{price_activity:{lowRange:true,range60pct:3}}]){
  const r={...row(),...extra};
  expect(entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules[0].state).toBe('fail');
  expect(buildPortfolioPlan([r],date,100000,now).positions).toEqual([]);
 }
});
it('does not let unready high-RS rows crowd out qualified daily positions',()=>{
 const rows=Array.from({length:8},(_,i)=>withAuditFixture({...row(),symbol:`S${i}`,gics_sector:`Sector${i}`,rs_rating:99-i,entry_evidence:{...row().entry_evidence,volumeRatio:i===7?2:.5}},date));
 const plan=buildPortfolioPlan(rows,date,100000,now);expect(plan.dailyPositions[0].symbol).toBe('S7');
});
it('describes compact shape evidence without labelling known results as missing',()=>{
 for(const [candidate,state,detail] of [[true,'pass','日足の自動検出による形状候補'],[false,'fail','現在の形状条件は未達'],[null,'unknown','日足による形状検証が未取得']]){
  const r=row();r.entry_evidence.shape={candidate};
  const shape=entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules.find(rule=>rule.id==='shape');
  expect(shape.state).toBe(state);expect(shape.detail).toContain(detail);
 }
});
it.each([
 ['current',()=>{},'pass','まで有効'],
 ['expired',r=>r.entry_evidence.calendar.valid_until='2026-09-25T20:00:00Z','fail','有効期限切れ'],
 ['exact expiry',r=>r.entry_evidence.calendar.valid_until=new Date(now).toISOString(),'fail','有効期限切れ'],
 ['future evaluation',r=>r.entry_evidence.calendar.evaluated_at='2026-09-26T11:00:00Z','fail','検証時刻が未来'],
 ['invalid evaluation',r=>r.entry_evidence.calendar.evaluated_at='invalid','fail','検証時刻または有効期限が不正'],
 ['invalid expiry',r=>r.entry_evidence.calendar.valid_until='invalid','fail','検証時刻または有効期限が不正'],
 ['different session',r=>r.entry_evidence.calendar.latest_completed_session='2026-09-24','fail','取引日が不一致'],
 ['different evidence date',r=>r.entry_evidence.as_of_date='2026-09-24','unknown','検証基準日 2026-09-24 が不一致'],
 ['missing calendar',r=>r.entry_evidence.calendar=null,'unknown','取引カレンダー未取得'],
])('explains %s calendar while preserving its state',(_label,modify,state,reason)=>{
 const r=row();modify(r);
 const rule=entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules.find(item=>item.id==='date');
 expect(rule.state).toBe(state);expect(rule.detail).toContain(reason);
 if(reason==='有効期限切れ'){
  expect(rule.detail).toContain('最新完了取引日 2026-09-25');
  expect(rule.detail).toContain('JST');
 }
});

it('keeps missing selection evidence unknown instead of calling it a measured failure',()=>{
 const r=row();r.eps_growth_yy=null;
 const result=entryReadiness(r,date,{cap:.5,label:'上昇'},now);
 expect(result.rules.find(rule=>rule.id==='selection').state).toBe('unknown');
 expect(result.unknown).toBe(1);expect(result.failed).toBe(0);expect(result.ready).toBe(false);
 r.eps_growth_yy=10;
 expect(entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules[0].state).toBe('fail');
});
it('distinguishes unknown market context from a known restrictive market',()=>{
 for(const market of [undefined,{cap:0,state:'unknown',label:'市場未確認'}]) {
  const result=entryReadiness(row(),date,market,now);
  expect(result.rules.find(rule=>rule.id==='market').state).toBe('unknown');expect(result.ready).toBe(false);
 }
 expect(entryReadiness(row(),date,{cap:0,label:'長期トレンド警戒'},now).rules.find(rule=>rule.id==='market').state).toBe('fail');
});
it.each(['true','false',1,0,{},[]])('rejects malformed shape evidence %j',candidate=>{
 const r=row();r.entry_evidence.shape={candidate};
 expect(entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules.find(rule=>rule.id==='shape').state).toBe('unknown');
});
it.each([[0,'fail'],[-2,'fail'],[null,'unknown'],[2,'pass']])('requires a verified rising day for volume confirmation: %j',(change,state)=>{
 const r=row();r.technical_audit.values.change=change;
 expect(entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules.find(rule=>rule.id==='volume').state).toBe(state);
});
it('uses the displayed method-specific buy limit in the purchase checklist',()=>{
 const r=withAuditFixture({...row(),current_price:104},date);
 const result=entryReadiness(r,date,{cap:.5,label:'上昇'},now,'minervini2');
 expect(result.rules.find(rule=>rule.id==='price')).toMatchObject({state:'fail',detail:expect.stringContaining('0〜3%')});
 expect(result.ready).toBe(false);
 expect(entryReadiness(r,date,{cap:.5,label:'上昇'},now,'minervini').rules.find(rule=>rule.id==='price').state).toBe('pass');
});
it('indexes expiry for nonselected rows outside the portfolio sample',()=>{
 const selected=row(),other=row();other.symbol='OTHER';other.se_pattern_confidence=0;
 other.entry_evidence={...other.entry_evidence,earnings:{date:'2026-10-20',checked_at:new Date(now-72*3600000+10000).toISOString()}};
 other.technical_audit={...other.technical_audit,symbol:'OTHER'};
 const timeline=prepareReadinessTimeline([selected,other]);
 expect(entryReadiness(other,date,{cap:.5,label:'上昇'},now).ready).toBe(true);
 expect(timeline(now+10000)).toBe(timeline(now)); // still valid at exactly 72h
 expect(timeline(now+15000)).toBeGreaterThan(timeline(now));
 expect(entryReadiness(other,date,{cap:.5,label:'上昇'},now+15000).ready).toBe(false);
 expect(entryReadiness(selected,date,{cap:.5,label:'上昇'},now+15000).ready).toBe(true);
});
it('indexes calendar and financial boundaries once and ignores invalid dates',()=>{
 const rows=[{entry_evidence:{calendar:{evaluated_at:new Date(now).toISOString(),valid_until:new Date(now+1000).toISOString()}},financial_history:{retrieved_at:new Date(now).toISOString()}}];
 const timeline=prepareReadinessTimeline([...rows,...rows,{entry_evidence:{earnings:{checked_at:'invalid'}}}]);
 expect(timeline(now-5001)).toBe(0);expect(timeline(now-5000)).toBe(1);
 expect(timeline(now)).toBe(2);expect(timeline(now+1000)).toBe(3);
 expect(timeline(now+72*3600000)).toBe(3);expect(timeline(now+72*3600000+1)).toBe(4);
});
