export const dateKey = time => typeof time === 'object' && time ? `${time.year}-${String(time.month).padStart(2,'0')}-${String(time.day).padStart(2,'0')}` : String(time);
export function chartHistoryWarning(bars) {
  if(!Array.isArray(bars) || !bars.length)return null;
  const invalid=bars.find((b,i)=>![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) || b.low<=0 || b.volume<0 || b.high<Math.max(b.open,b.close,b.low) || b.low>Math.min(b.open,b.close) || (i>0 && b.date<=bars[i-1].date));
  if(invalid)return `${invalid.date}：日足の価格・出来高または日付に不整合があります。`;
  const jump=bars.find((b,i)=>i>0 && (b.close/bars[i-1].close>=1.8 || b.close/bars[i-1].close<=.55));
  return jump ? `${jump.date}：大幅な価格断絶があります。分割・併合調整を確認してください。` : null;
}
export function relativeStrengthScale(points, range) {
  const visible=points.filter(p=>Number.isFinite(p.value) && (!range || dateKey(p.time)>=dateKey(range.from) && dateKey(p.time)<=dateKey(range.to)));
  if(!visible.length)return null;
  const values=visible.map(p=>p.value),min=Math.min(...values),max=Math.max(...values);
  const pad=Math.max((max-min)*.08,Math.abs(max)*.001,1e-6);
  return {priceRange:{minValue:min-pad,maxValue:max+pad}};
}
export function setResearchRange(chart, bars, sessions) {
  if(!chart || !bars?.length)return;
  const scale=chart.timeScale(),last=bars.at(-1).time,first=bars[Math.max(0,bars.length-sessions)].time;
  const from=scale.timeToIndex(first,true),to=scale.timeToIndex(last,true);
  if(from != null && to != null)scale.setVisibleLogicalRange({from:from-.5,to:to+2});
}
