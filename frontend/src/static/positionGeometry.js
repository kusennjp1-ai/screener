// D9/D10: port of design-target/reference/geometry.js; presentation only.
export const isNumber = Number.isFinite;
export const money = v => isNumber(v) ? `$${v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—';
export const signed = (v,d=1) => isNumber(v) ? `${v>0?'+':v<0?'−':'±'}${Math.abs(v).toFixed(d)}%` : '—';
export const times = v => isNumber(v) ? `${v.toFixed(2)}×` : '—';
export const STATES={zone:['買いゾーン内','●','zone'],wait:['ピボット待ち','◔','wait'],ext:['買いゾーン超過','▲','ext'],low:['低変動・監視のみ','≈','neutral'],acq:['買収合意・対象外','⊘','neutral'],na:['判定不可','?','neutral']};
export function stateKey(state) { return state==='買いゾーン内'?'zone':state==='ピボット待ち'?'wait':state==='買いゾーン超過'?'ext':state?.includes('買収')?'acq':state?.includes('低変動')?'low':'na'; }
export function positionX(v) { return isNumber(v) ? (Math.max(-10,Math.min(10,v))+10)*5 : null; }
export function meterGeometry(distance,width=112,zone=5) {
  const x=v=>4+positionX(v)/100*(width-8);
  return {width,height:14,pivot:x(0),zoneWidth:x(zone)-x(0),price:isNumber(distance)?x(distance):null,clipped:isNumber(distance)&&Math.abs(distance)>10};
}
export function gaugeGeometry(plan) {
  if(!isNumber(plan.pivot)||plan.pivot<=0) return null;
  const relative=v=>isNumber(v)?(v/plan.pivot-1)*100:null;
  const upper=relative(plan.upper),stop=relative(plan.stopExample);
  return {price:positionX(plan.distance),pivot:positionX(0),upper:positionX(upper),stop:positionX(stop),clipped:isNumber(plan.distance)&&Math.abs(plan.distance)>10};
}
export function radarGeometry(points,width=620,height=230) {
  const left=36,top=16,pw=width-50,ph=height-42;
  const x=v=>{v=Math.max(-15,Math.min(25,v));return left+(v<=10?(v+15)/25*.84:.84+(v-10)/15*.16)*pw;};
  const y=v=>top+ph-(Math.max(70,Math.min(100,v))-70)/30*ph;
  const order={ext:0,wait:1,zone:2};
  return {width,height,left,top,pw,ph,x,y,points:points.filter(p=>isNumber(p.distance)&&isNumber(p.rs)).slice().sort((a,b)=>(order[a.state]??0)-(order[b.state]??0)).map(p=>({...p,x:x(p.distance),y:y(p.rs),radius:2.4+Math.min(Math.max(p.volume||0,0),3)*1.4}))};
}
