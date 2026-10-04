import { withFinancialProof } from './testFinancialFixture';
import {it,expect} from 'vitest';
import {entryReadiness,prepareReadinessTimeline} from './entryReadiness';
import {assess} from './researchEngine';
import {buildPortfolioPlan} from './portfolioPlan';
import {withAuditFixture} from './testAuditFixture';
const now=Date.parse('2026-09-26T10:00:00Z'),date='2026-09-25';
const row=()=>withAuditFixture({symbol:'LEAD',market:'US',currency:'USD',gics_sector:'Tech',market_regime:'confirmed_uptrend',market_above_50dma:true,market_above_200dma:true,passes_template:true,rs_rating:95,week_52_low_distance:50,week_52_high_distance:3,composite_rating:95,eps_rating:90,ibd_group_rank:10,adv_usd:50000000,current_price:101,se_pivot_price:100,se_pattern_confidence:80,
entry_evidence:{as_of_date:date,calendar:{latest_completed_session:date,evaluated_at:'2026-09-26T09:00:00Z',valid_until:'2026-09-28T20:00:00Z'},earnings:{date:'2026-10-20',checked_at:'2026-09-26T09:00:00Z'},shape:{candidate:true,summary:'自動推定'},volumeRatio:1.5}},date);
it('keeps allocation empty while required financial ratings remain unverified',()=>{
 const r=row(), result=entryReadiness(r,date,{cap:.5,label:'上昇'},now);
 expect(assess(r,'minervini',now)).toMatchObject({qualified:true,passed:9,total:9});
 expect(result.rules.find(rule=>rule.id==='selection')).toMatchObject({
  label:'共通購入モデルへの適合',state:'unknown',
  detail:expect.stringContaining('選択中の手法とは別に、ミネルヴィニとIBD型の両方'),
 });
 expect(result.status).toBe('共通購入モデルへの適合を確認');
 expect(result.ready).toBe(false); expect(result.rules.find(rule=>rule.id==='selection').state).toBe('unknown');
 const plan=buildPortfolioPlan([r],date,100000,now);
 expect(plan.decision).toBe('購入条件を満たす銘柄なし'); expect(plan.dailyPositions).toHaveLength(0);
 expect(plan.executionExposure).toBe(0); // passing rules does not invent a fill
});
it('fails closed for missing/expired calendars, earnings, shape or volume',()=>{
 for(const modify of [r=>r.entry_evidence.earnings=null,r=>r.entry_evidence.earnings.date='2026-09-28',r=>r.entry_evidence.calendar.valid_until='2026-09-25T20:00:00Z',r=>r.entry_evidence.shape.candidate=false,r=>r.technical_audit.values.volumeRatio=1,r=>r.current_price=106,r=>r.entry_evidence.as_of_date='2026-09-24']){
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
it('does not promote high-RS rows with unavailable required financial ratings',()=>{
 const rows=Array.from({length:8},(_,i)=>{
  const r=withAuditFixture({...row(),symbol:`S${i}`,gics_sector:`Sector${i}`,rs_rating:99-i},date);
  r.technical_audit.values.volumeRatio=i===7?2:.5;
  return r;
 });
 const plan=buildPortfolioPlan(rows,date,100000,now);expect(plan.dailyPositions).toEqual([]); expect(plan.positions).toEqual([]);
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
 expect(entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules[0].state).toBe('unknown');
 expect(entryReadiness(withFinancialProof(r,now,date),date,{cap:.5,label:'上昇'},now).rules[0].state).toBe('fail');
 const measured=entryReadiness(withFinancialProof(r,now,date),date,{cap:.5,label:'上昇'},now).rules[0];
 expect(measured.id).toBe('selection');expect(measured.label).toBe('共通購入モデルへの適合');
 expect(measured.detail).toContain('ミネルヴィニ 9/9');
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
 expect(entryReadiness(other,date,{cap:.5,label:'上昇'},now).rules.find(rule=>rule.id==='earnings').state).toBe('pass');
 expect(timeline(now+10000)).toBe(timeline(now)); // still valid at exactly 72h
 expect(timeline(now+15000)).toBeGreaterThan(timeline(now));
 expect(entryReadiness(other,date,{cap:.5,label:'上昇'},now+15000).rules.find(rule=>rule.id==='earnings').state).toBe('unknown');
 expect(entryReadiness(selected,date,{cap:.5,label:'上昇'},now+15000).rules.find(rule=>rule.id==='earnings').state).toBe('pass');
});
it('indexes calendar and financial boundaries once and ignores invalid dates',()=>{
 const rows=[{entry_evidence:{calendar:{evaluated_at:new Date(now).toISOString(),valid_until:new Date(now+1000).toISOString()}},financial_history:{retrieved_at:new Date(now).toISOString()}}];
 const timeline=prepareReadinessTimeline([...rows,...rows,{entry_evidence:{earnings:{checked_at:'invalid'}}}]);
 expect(timeline(now-5001)).toBe(0);expect(timeline(now-5000)).toBe(1);
 expect(timeline(now)).toBe(2);expect(timeline(now+1000)).toBe(3);
 expect(timeline(now+72*3600000)).toBe(3);expect(timeline(now+72*3600000+1)).toBe(4);
});

it.each([
 ['2026-09-28','2026-09-26T10:00:00Z'],
 ['2026-09-26','2026-09-26T02:00:00Z'], // Still September 25 in New York.
])('rejects a claimed completed session on a future New York date: %s',(futureDate,clock)=>{
 const time=Date.parse(clock),r=withAuditFixture({...row(),rs_as_of_date:futureDate},futureDate);
 r.entry_evidence={...r.entry_evidence,as_of_date:futureDate,calendar:{latest_completed_session:futureDate,evaluated_at:new Date(time-3600000).toISOString(),valid_until:'2026-09-29T20:00:00Z'},earnings:{...r.entry_evidence.earnings,checked_at:new Date(time-3600000).toISOString()}};
 const result=entryReadiness(r,futureDate,{cap:.5,label:'上昇'},time);
 expect(result.freshness.state).toBe('future');expect(result.ready).toBe(false);
 expect(result.passed).toBe(5);expect(result.failed).toBe(1);expect(result.unknown).toBe(1);
 expect(result.rules.find(rule=>rule.id==='date')).toMatchObject({state:'fail',detail:expect.stringContaining('米国東部の本日より未来')});
});
it('keeps a calendar-verified old session valid through a long exchange closure',()=>{
 const time=Date.parse('2026-10-02T10:00:00Z'),r=row();
 r.entry_evidence.calendar.valid_until='2026-10-05T20:00:00Z';
 r.entry_evidence.earnings.checked_at=new Date(time-3600000).toISOString();
 const result=entryReadiness(r,date,{cap:.5,label:'上昇'},time);
 expect(result.freshness.state).toBe('old');expect(result.ready).toBe(false); expect(result.rules.find(rule=>rule.id==='selection').state).toBe('unknown');
 expect(result.rules.find(rule=>rule.id==='date').state).toBe('pass');
});
it.each([[.2,'fail'],[1.4,'pass'],[null,'unknown'],[undefined,'unknown'],[-1,'unknown'],['2','unknown']])('uses the same-date audited volume ratio instead of a copied entry ratio: %j',(volumeRatio,state)=>{
 const r=row();r.entry_evidence.volumeRatio=2;r.technical_audit.values.volumeRatio=volumeRatio;
 const result=entryReadiness(r,date,{cap:.5,label:'上昇'},now);
 const rule=result.rules.find(item=>item.id==='volume');
 expect(rule.state).toBe(state);
 expect(result.ready).toBe(false); expect(result.rules.find(rule=>rule.id==='selection').state).toBe('unknown');
 if(typeof volumeRatio==='number'&&volumeRatio>=0) expect(rule.detail).toContain(`検証済み直前50日平均比 ${volumeRatio.toFixed(2)}倍`);
});
it('does not let a stale copied entry ratio override current audited volume',()=>{
 const r=row();r.entry_evidence.volumeRatio=.2;
 const rule=entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules.find(item=>item.id==='volume');
 expect(rule.state).toBe('pass');expect(rule.detail).toContain('1.60倍');
 r.technical_audit.as_of_date='2026-09-24';
 expect(entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules.find(item=>item.id==='volume').state).toBe('unknown');
});
it('uses a readable minus sign for a verified down day',()=>{
 const r=row();r.technical_audit.values.change=-4.34;
 const rule=entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules.find(item=>item.id==='volume');
 expect(rule.state).toBe('fail');expect(rule.detail).toContain('−4.34%');expect(rule.detail).not.toContain('-4.34%');
});
it.each([null,42,{},[],['2026-09-26T09:00:00Z'],{toString:42}])('rejects non-string JSON timestamps without coercion or crashes: %j',value=>{
 for(const field of ['evaluated_at','valid_until']) {
  const r=row();r.entry_evidence.calendar[field]=value;
  const result=entryReadiness(r,date,{cap:.5,label:'上昇'},now);
  expect(result.ready).toBe(false);expect(result.rules.find(rule=>rule.id==='date').state).not.toBe('pass');
 }
 const r=row();r.entry_evidence.earnings.checked_at=value;
 expect(entryReadiness(r,date,{cap:.5,label:'上昇'},now).rules.find(rule=>rule.id==='earnings').state).toBe('unknown');
 const malformed={entry_evidence:{as_of_date:'2020-01-01',calendar:{evaluated_at:value,valid_until:value},earnings:{checked_at:value}},financial_history:{retrieved_at:value}};
 expect(prepareReadinessTimeline([malformed])(now)).toBe(0);
});
it('fails closed when a finite expiry timestamp would overflow JST formatting',()=>{
 const r=row();r.entry_evidence.calendar.valid_until='+275760-09-13T00:00:00Z';
 expect(Number.isFinite(Date.parse(r.entry_evidence.calendar.valid_until))).toBe(true);
 const result=entryReadiness(r,date,{cap:.5,label:'上昇'},now);
 expect(result.ready).toBe(false);
 expect(result.rules.find(rule=>rule.id==='date')).toMatchObject({state:'fail',detail:expect.stringContaining('有効期限が不正')});
 expect(Number.isFinite(prepareReadinessTimeline([r])(now))).toBe(true);
});
it.each([NaN,Infinity,-Infinity,8640000000000001,null,{},'2026-09-26T10:00:00Z'])('keeps time-dependent conditions unknown for an invalid current time: %j',time=>{
 const result=entryReadiness(row(),date,{cap:.5,label:'上昇'},time);
 expect(result.ready).toBe(false);expect(result.freshness.state).toBe('unknown');
 for(const id of ['date','earnings']) expect(result.rules.find(rule=>rule.id===id).state).toBe('unknown');
});
it.each(['2026-09-26T09:00:00+00:00','2026-09-26T09:00:00.123456+00:00','2026-09-26T09:00:00'])('retains supported exporter and legacy timestamp strings: %s',value=>{
 const r=row();r.entry_evidence.calendar.evaluated_at=value;r.entry_evidence.earnings.checked_at=value;
 const time=Date.parse(value)+3600000;
 expect(entryReadiness(r,date,{cap:.5,label:'上昇'},time).rules.find(rule=>rule.id==='date').state).toBe('pass');
 expect(prepareReadinessTimeline([r])(time)).toBeGreaterThan(0);
});
