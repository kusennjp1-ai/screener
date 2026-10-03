import {describe,expect,it} from 'vitest';
import {entrySourceContext,trendTemplateSourceContext} from './bookSourceContext';
import {entryPlan} from './researchEngine';

describe('first-book entry proximity versus application settings',()=>{
 it.each([[null,'unknown'],[NaN,'unknown'],[-.1,'waiting'],[0,'near'],[2,'near'],[2.01,'edge'],[3,'edge'],[3.01,'beyond']])('classifies %j without certifying a setup',(distance,state)=>{
  const result=entrySourceContext('minervini',5,distance);
  expect(result.state).toBe(state);expect(result.warning).toBe(state==='beyond');
  expect(result.detail).toContain('2〜3%');expect(result.detail).toContain('Kindle表示292/421');
 });
 it('preserves each model while exposing the first-book conflict at +4%',()=>{
  const row={current_price:104,se_pivot_price:100};
  const first=entryPlan(row,null,'minervini'),second=entryPlan(row,null,'minervini2'),ibd=entryPlan(row,null,'ibd');
  expect(first).toMatchObject({state:'買いゾーン内',zone:5,upper:105,sourceContext:{warning:true,state:'beyond'}});
  expect(second).toMatchObject({state:'買いゾーン超過',zone:3,upper:103,sourceContext:{warning:false,state:'unverified'}});
  expect(ibd).toMatchObject({state:'買いゾーン内',zone:5,sourceContext:{warning:false,state:'unverified'}});
  expect(second.sourceContext.detail).toContain('第2冊の数値指定の根拠にはしていません');
 });
 it('does not confirm proximity when pivot or price is unavailable',()=>{
  expect(entryPlan({current_price:100},null,'minervini').sourceContext.state).toBe('unknown');
 });
});


describe('first-book trend attribution versus application approximation',()=>{
 it('distinguishes eight source criteria and one independent data-integrity check',()=>{
  const text=trendTemplateSourceContext('minervini');
  for(const evidence of ['Kindle表示115/421','30%以上','25%以内','RS順位70以上','近似判定8件','品質確認1件','21営業日前','252営業日','同等性は未検証']) expect(text).toContain(evidence);
 });
 it('does not attribute the second mode low threshold to either verified book',()=>{
  const text=trendTemplateSourceContext('minervini2');
  expect(text).toContain('25%は既存アプリ設定');
  expect(text).toContain('第1冊の正式な8条件は30%以上');
  expect(text).toContain('第2冊の25%指定は未確認');
 });
 it.each(['oneil','ibd'])('does not attach Minervini source claims to %s',method=>{
  expect(trendTemplateSourceContext(method)).toBeNull();
 });
});
