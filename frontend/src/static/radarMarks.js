import { signed, STATES } from './positionGeometry';

const text = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
// Same SVG marks as before, constructed in a single DOM insertion. Event
// delegation avoids mounting hundreds of identical React event handlers.
export function radarMarks(points) {
  return points.map((point,index) => {
    const { x, y, radius, state, symbol, distance, rs, pickable } = point;
    if (![x,y,radius,distance,rs].every(Number.isFinite) || radius < 0 || !Object.hasOwn(STATES,state)) throw Error('Invalid radar point');
    const title = `${symbol} · ${signed(distance)} · RS ${Math.round(rs)}${pickable?'':' · 詳細なし'}`;
    return `<circle data-radar-point="${index}" cx="${x}" cy="${y}" r="${radius}" fill="var(--${STATES[state][2]})" opacity="${state==='zone'?.95:.6}" style="cursor:${pickable?'pointer':'default'}"><title>${text(title)}</title></circle>`;
  }).join('');
}
