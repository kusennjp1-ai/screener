import { describe,it,expect } from 'vitest';
import { boxesOverlap,sectorRotationGeometry,rotationQuadrant } from './sectorRotationGeometry';
const group=(key,value,momentum,percent=25)=>({key,label:key,relative:{63:{value},126:{value:value==null?null:200-value}},momentum21:{value:momentum==null?null:100+momentum},rates:{minervini:{percent}}});
describe('rotation geometry from the reference implementation',()=>{
 it('uses symmetric axes around 100 and zero and the reference radius',()=>{
  const result=sectorRotationGeometry([group('情報技術',99,5)],63,null,338,238);
  expect(result.cx).toBe(169);expect(result.cy).toBe(110);expect(result.sx).toBe(8);expect(result.sy).toBe(6.5);
  expect(result.nodes[0].r).toBe(10.25);expect(result.nodes[0].x).toBe(148.625);expect(result.nodes[0].q).toBe('imp');
 });
 it('reads every quadrant and omits unknown coordinates rather than plotting zero',()=>{
  const result=sectorRotationGeometry([group('先導業種',105,2),group('減速業種',105,-2),group('改善業種',95,2),group('遅行業種',95,-2),group('未確認',null,2)],63,null);
  expect(result.nodes).toHaveLength(4);expect(result.excluded).toBe(1);expect(result.aria).toContain('先導：先導業種');expect(result.aria).toContain('減速：減速業種');expect(result.aria).toContain('改善：改善業種');expect(result.aria).toContain('遅行：遅行業種');
  expect(rotationQuadrant(100,0)).toBe('lead');
 });
 it.each([63,126])('prevents label/label and label/boundary collisions at %s sessions',period=>{
  const groups=Array.from({length:12},(_,i)=>group(`業種${i}`,86+i*2.6,-6+(i%5)*2,5+i*3));
  for(const width of [294,338,372]){
   const g=sectorRotationGeometry(groups,period,'業種3',width,214);
   for(const [i,label] of g.labels.entries()){
    expect(label.x).toBeGreaterThanOrEqual(g.L+2);expect(label.x+label.w).toBeLessThanOrEqual(g.L+g.pw-2);
    expect(label.y).toBeGreaterThanOrEqual(g.T+2);expect(label.y+label.h).toBeLessThanOrEqual(g.T+g.ph-2);
    for(const other of g.labels.slice(i+1))expect(boxesOverlap(label,other)).toBe(false);
   }
  }
 });
 it('uses actual unknown pass rate in description data and never injects points into missing price history',()=>{
  const g=sectorRotationGeometry([group('情報技術',103,2,null),group('欠損',105,null,30)],63,null);
  expect(g.nodes[0].percent).toBeNull();expect(g.nodes).toHaveLength(1);
 });
});
