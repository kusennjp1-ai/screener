import { signed, STATES } from './positionGeometry';

const text = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
// HTML labels, canvas and legend are immutable for a ranked publication and
// viewport. Insert them together; the canvas is painted synchronously before
// React returns from mounting. Only the selection overlay changes on hover.
export function radarFrame(g, small) {
  if (![g.width,g.height].every(value=>Number.isFinite(value)&&value>0)||![g.left,g.top,g.pw,g.ph,...[-15,-10,-5,0,5,10,25].map(g.x),...[70,80,90,100].map(g.y)].every(Number.isFinite)) throw Error('Invalid radar frame');
  const percent=(value,size)=>`${value/size*100}%`;
  const xs=[-15,-10,-5,0,5,10,25].filter(value=>!small||[-15,0,5,25].includes(value))
    .map(value=>`<span class="radar-x mono" style="left:${percent(g.x(value),g.width)};top:${percent(g.top+g.ph+5,g.height)}">${value===0?'0%':signed(value,0)}</span>`).join('');
  const ys=[70,80,90,100].map(value=>`<span class="radar-y mono" style="left:${percent(g.left-6,g.width)};top:${percent(g.y(value),g.height)}">${value}</span>`).join('');
  return `<header><strong>セットアップ・レーダー</strong><span>横：ピボット比 · 縦：RS推計</span></header>`+
    `<div class="radar-plot" style="aspect-ratio:${g.width}/${g.height}">`+
    `<canvas data-radar-canvas width="${g.width}" height="${g.height}" style="display:block;width:100%;height:100%" role="img" aria-label="ミネルヴィニ条件通過のうち有効なピボットがある${g.points.length}銘柄。点の大きさは出来高比。銘柄一覧でも選択できます。価格位置の0〜+5%はアプリ設定で、第1冊の追随目安は約2〜3%です。購入条件とは別です。"></canvas>`+
    `<svg viewBox="0 0 ${g.width} ${g.height}" preserveAspectRatio="none" aria-hidden="true" style="position:absolute;inset:0;pointer-events:none"><g data-radar-selection></g><path d="M${g.x(10)-3} ${g.top+g.ph+4}l3 -8m1 8l3 -8" stroke="var(--text-3)"></path></svg>`+
    xs+ys+`<span class="radar-zone-label" style="left:${percent((g.x(0)+g.x(5))/2,g.width)}" title="0〜+5%はアプリの価格位置設定。第1冊の追随目安は約2〜3%で、購入条件は別途確認。">アプリ設定 0〜+5%</span><span data-radar-label style="display:contents"></span></div>`+
    '<footer><span>◔ ピボット待ち</span><span>● ゾーン内</span><span>▲ 超過</span><span>+10%以降は圧縮</span></footer>';
}

// Canvas shares exactly the same canonical geometry and painter's order as the
// SVG implementation. Alpha is applied to each circle, never to a state group.
// Return the number of circles actually drawn, not merely the source length.
export function drawRadar(context, g, palette) {
  const {left,top,pw,ph,x,y,points}=g;
  if (![left,top,pw,ph].every(Number.isFinite)) throw Error('Invalid radar geometry');
  context.clearRect(0,0,g.width,g.height);
  context.globalAlpha=1;context.globalCompositeOperation='source-over';context.lineWidth=1;
  context.fillStyle=palette['zone-fill'];context.fillRect(x(0),top,x(5)-x(0),ph);
  for(const value of [-15,-10,-5,0,5,10,25]) {
    context.strokeStyle=palette[value===0||value===5?'zone-edge':'grid'];context.setLineDash(value===0||value===5?[3,3]:[]);
    context.beginPath();context.moveTo(x(value),top);context.lineTo(x(value),top+ph);context.stroke();
  }
  context.strokeStyle=palette.grid;context.setLineDash([]);
  for(const value of [70,80,90,100]) {context.beginPath();context.moveTo(left,y(value));context.lineTo(left+pw,y(value));context.stroke();}
  let count=0,previousState=null;
  for(const point of points) {
    if (![point.x,point.y,point.radius,point.distance,point.rs].every(Number.isFinite)||point.radius<0||!Object.hasOwn(STATES,point.state)) throw Error('Invalid radar point');
    // Geometry already supplies painter order. Avoid repeatedly crossing into
    // canvas to set an unchanged color/alpha, but keep every circle a separate
    // fill so overlapping translucent points composite exactly as before.
    if(point.state!==previousState) {
      context.fillStyle=palette[STATES[point.state][2]];context.globalAlpha=point.state==='zone'?.95:.6;
      previousState=point.state;
    }
    context.beginPath();context.arc(point.x,point.y,point.radius,0,Math.PI*2);context.fill();count++;
  }
  context.globalAlpha=1;
  return count;
}

export function radarHit(points, x, y) {
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  for(let index=points.length-1;index>=0;index--) {
    const point=points[index];if((point.x-x)**2+(point.y-y)**2<=point.radius**2)return point;
  }
  return null;
}

export function radarSelection(g, active) {
  if (!active) return {overlay:'',label:''};
  const {x,y,radius,distance,rs,symbol,pickable}=active;
  if (![x,y,radius,distance,rs,g.width,g.height,g.left,g.top,g.pw,g.ph].every(Number.isFinite) || radius<0) throw Error('Invalid radar selection');
  return {
    overlay:`<path d="M${x} ${g.top}V${g.top+g.ph}M${g.left} ${y}H${g.left+g.pw}" stroke="var(--accent)" stroke-dasharray="3 4" opacity=".5"></path><circle cx="${x}" cy="${y}" r="${radius+5}" fill="none" stroke="var(--accent)"></circle>`,
    label:`<span class="radar-point-label" style="left:${x/g.width*100}%;top:${y/g.height*100}%;transform:${x>g.left+g.pw*.72?'translate(calc(-100% - 12px),-50%)':'translate(12px,-50%)'}"><b>${text(symbol)}</b><small>${signed(distance)} · RS ${Math.round(rs)}${pickable?'':' · 詳細なし'}</small></span>`,
  };
}
