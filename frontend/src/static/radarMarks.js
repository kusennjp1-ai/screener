import { signed, STATES } from './positionGeometry';

const text = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
// Same SVG marks as before, constructed in a single DOM insertion. Event
// delegation avoids mounting hundreds of identical React event handlers.
export function radarMarks(points) {
  let stateGroup=null, markup='';
  for (const [index,point] of points.entries()) {
    const { x, y, radius, state, symbol, distance, rs, pickable } = point;
    if (![x,y,radius,distance,rs].every(Number.isFinite) || radius < 0 || !Object.hasOwn(STATES,state)) throw Error('Invalid radar point');
    if (state!==stateGroup) {
      if(stateGroup!==null) markup+='</g>';
      // Inherited fill-opacity keeps per-circle alpha and overlap identical;
      // group opacity would incorrectly composite intersecting marks together.
      markup+=`<g fill="var(--${STATES[state][2]})" fill-opacity="${state==='zone'?.95:.6}" style="cursor:pointer">`;
      stateGroup=state;
    }
    const title = `${symbol} · ${signed(distance)} · RS ${Math.round(rs)}${pickable?'':' · 詳細なし'}`;
    markup+=`<circle data-radar-point="${index}" cx="${x}" cy="${y}" r="${radius}"${pickable?'':' style="cursor:default"'}><title>${text(title)}</title></circle>`;
  }
  return markup+(stateGroup===null?'':'</g>');
}

// The grid changes only with the geometry, just like its marks. Keep its exact
// SVG attributes and stacking order while mounting the static plot in one DOM
// insertion; selection/hover overlays remain managed by React above this group.
export function radarPlot(geometry) {
  const {left,top,pw,ph,x,y,points}=geometry;
  const xs=[-15,-10,-5,0,5,10,25].map(value=>[value,x(value)]);
  const ys=[70,80,90,100].map(value=>y(value));
  if (![left,top,pw,ph,...xs.map(([,position])=>position),...ys].every(Number.isFinite)) throw Error('Invalid radar geometry');
  const zero=xs[3][1],five=xs[4][1];
  const zone=`<rect x="${zero}" y="${top}" width="${five-zero}" height="${ph}" fill="var(--zone-fill)"></rect>`;
  const vertical=xs.map(([value,position])=>`<path d="M${position} ${top}V${top+ph}" stroke="var(--${value===0||value===5?'zone-edge':'grid'})"${value===0||value===5?' stroke-dasharray="3 3"':''}></path>`).join('');
  const horizontal=ys.map(position=>`<path d="M${left} ${position}H${left+pw}" stroke="var(--grid)"></path>`).join('');
  return zone+vertical+horizontal+radarMarks(points);
}

// The plot, HTML labels and legend are immutable for a ranked publication and
// viewport. Insert them together instead of asking React to create and set
// styles on each individual static node during the cold render. All data text
// continues through text(); coordinates are validated by radarPlot().
export function radarFrame(g, small) {
  if (![g.width,g.height].every(value=>Number.isFinite(value)&&value>0)) throw Error('Invalid radar frame');
  const plot=radarPlot(g), percent=(value,size)=>`${value/size*100}%`;
  const xs=[-15,-10,-5,0,5,10,25].filter(value=>!small||[-15,0,5,25].includes(value))
    .map(value=>`<span class="radar-x mono" style="left:${percent(g.x(value),g.width)};top:${percent(g.top+g.ph+5,g.height)}">${value===0?'0%':signed(value,0)}</span>`).join('');
  const ys=[70,80,90,100].map(value=>`<span class="radar-y mono" style="left:${percent(g.left-6,g.width)};top:${percent(g.y(value),g.height)}">${value}</span>`).join('');
  return `<header><strong>セットアップ・レーダー</strong><span>横：ピボット比 · 縦：RS推計</span></header>`+
    `<div class="radar-plot" style="aspect-ratio:${g.width}/${g.height}">`+
    `<svg viewBox="0 0 ${g.width} ${g.height}" role="img" aria-label="ミネルヴィニ条件通過のうち有効なピボットがある${g.points.length}銘柄。点の大きさは出来高比。銘柄一覧でも選択できます。">`+
    `<g data-radar-marks>${plot}</g><g data-radar-selection></g><path d="M${g.x(10)-3} ${g.top+g.ph+4}l3 -8m1 8l3 -8" stroke="var(--text-3)"></path></svg>`+
    xs+ys+`<span class="radar-zone-label" style="left:${percent((g.x(0)+g.x(5))/2,g.width)}">買いゾーン</span><span data-radar-label></span></div>`+
    '<footer><span>◔ ピボット待ち</span><span>● ゾーン内</span><span>▲ 超過</span><span>+10%以降は圧縮</span></footer>';
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
