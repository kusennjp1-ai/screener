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
