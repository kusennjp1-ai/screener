import {it,expect} from 'vitest';
import {entryReadiness} from './entryReadiness';
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
it('does not let unready high-RS rows crowd out qualified daily positions',()=>{
 const rows=Array.from({length:8},(_,i)=>withAuditFixture({...row(),symbol:`S${i}`,gics_sector:`Sector${i}`,rs_rating:99-i,entry_evidence:{...row().entry_evidence,volumeRatio:i===7?2:.5}},date));
 const plan=buildPortfolioPlan(rows,date,100000,now);expect(plan.dailyPositions[0].symbol).toBe('S7');
});
