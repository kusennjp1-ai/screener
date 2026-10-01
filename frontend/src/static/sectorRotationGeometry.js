import { sectorNumber,sectorValue } from './sectorPresentation';
export const ROTATION_QUADRANTS={lead:{label:'先導',tone:'var(--zone)'},fade:{label:'減速',tone:'var(--ext)'},lag:{label:'遅行',tone:'var(--neg)'},imp:{label:'改善',tone:'var(--wait)'}};
export const rotationQuadrant=(value,momentum)=>value>=100?(momentum>=0?'lead':'fade'):(momentum>=0?'imp':'lag');
export const boxesOverlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;

// Coordinate/collision logic ported from design-target/reference/geometry.js.
// Only display geometry changes. Relative prices and pass rates come from the export.
export function sectorRotationGeometry(groups,period,highlight,width=338,height=238) {
 const L=6,R=6,T=6,B=24,pw=width-L-R,ph=height-T-B;
 const valid=groups.filter(group=>Number.isFinite(sectorValue(group,period))&&Number.isFinite(group.momentum21?.value));
 const sx=Math.max(8,...valid.map(group=>Math.abs(sectorValue(group,period)-100)*1.2));
 const sy=Math.max(3,...valid.map(group=>Math.abs(group.momentum21.value-100)*1.3));
 const X=value=>L+(value-100+sx)/(2*sx)*pw,Y=value=>T+(1-(value+sy)/(2*sy))*ph;
 const cx=X(100),cy=Y(0),boxes=[];
 const quads=[['imp',L+8,T+6,'left'],['lead',L+pw-8,T+6,'right'],['lag',L+8,T+ph-22,'left'],['fade',L+pw-8,T+ph-22,'right']].map(([key,x,y,align])=>{
  const box={x:align==='left'?x:x-28,y,w:28,h:16};boxes.push(box);return {key,...ROTATION_QUADRANTS[key],...box};
 });
 const nodes=valid.map(group=>{
  const value=sectorValue(group,period),momentum=group.momentum21.value-100,percent=group.rates?.minervini?.percent;
  return {key:group.key,label:group.label,value,momentum,percent,q:rotationQuadrant(value,momentum),x:X(value),y:Y(momentum),r:4+Math.sqrt(Number.isFinite(percent)?Math.max(0,percent):0)*1.25};
 });
 nodes.forEach(node=>boxes.push({x:node.x-node.r,y:node.y-node.r,w:node.r*2,h:node.r*2,self:node.key}));
 const order=[...nodes].sort((a,b)=>(b.key===highlight)-(a.key===highlight) || (a.q==='lag')-(b.q==='lag') || (b.percent??-1)-(a.percent??-1));
 const labels=[];
 for(const node of order){
  const w=node.label.length*12+6,h=16,gap=4;
  const candidates=[[node.x+node.r+gap,node.y-h/2],[node.x-node.r-gap-w,node.y-h/2],[node.x-w/2,node.y-node.r-gap-h],[node.x-w/2,node.y+node.r+gap],[node.x+node.r+gap,node.y-h/2-12],[node.x+node.r+gap,node.y-h/2+12],[node.x-node.r-gap-w,node.y-h/2-12],[node.x-node.r-gap-w,node.y-h/2+12]];
  const own=boxes.findIndex(box=>box.self===node.key),ownBox=boxes.splice(own,1)[0];
  const found=candidates.map(([x,y])=>({x,y,w,h})).find(box=>box.x>=L+2&&box.x+box.w<=L+pw-2&&box.y>=T+2&&box.y+box.h<=T+ph-2&&!boxes.some(other=>boxesOverlap(box,other)));
  boxes.push(ownBox);
  if(found){boxes.push(found);labels.push({...found,key:node.key,text:node.label,q:node.q});}
 }
 const byQuadrant=key=>nodes.filter(node=>node.q===key).map(node=>node.label);
 const aria=`業種ローテーション。${Object.entries(ROTATION_QUADRANTS).map(([key,quad])=>`${quad.label}：${byQuadrant(key).join('、')||'なし'}`).join('。')}。価格が未確認の${groups.length-valid.length}業種は図に含めません。`;
 return {width,height,L,T,pw,ph,cx,cy,sx,sy,nodes,labels,quads,aria,excluded:groups.length-valid.length,xTicks:[{x:L,label:sectorNumber(100-sx)},{x:cx,label:'100'},{x:L+pw,label:sectorNumber(100+sx)}]};
}
