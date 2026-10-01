import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SetupRadar from './SetupRadar';
import { drawRadar, radarHit, radarFrame, radarSelection } from '../radarMarks';
import { radarGeometry, stateKey, STATES } from '../positionGeometry';
import { entryPlan } from '../researchEngine';
import { palettes } from '../theme/tokens';
import fixture from '../../../tools/fixtures/radar-207-2026-09-29.json';

let context, rect, resizeCallbacks;
function recordingContext() {
 const result={points:[],lines:[],clearRect:vi.fn(),fillRect:vi.fn(),setTransform:vi.fn(),setLineDash:vi.fn(),beginPath(){this.arcArgs=null;},moveTo(x,y){this.start=[x,y];},lineTo(x,y){this.end=[x,y];},stroke(){this.lines.push({start:this.start,end:this.end,color:this.strokeStyle,dash:this.setLineDash.mock.lastCall[0]});},arc(...args){this.arcArgs=args;},fill(){this.points.push({arc:this.arcArgs,color:this.fillStyle,alpha:this.globalAlpha,composite:this.globalCompositeOperation});}};
 return result;
}
beforeEach(()=>{
 context=recordingContext();rect={left:10,top:20,width:620,height:224};resizeCallbacks=[];
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context);
 vi.spyOn(HTMLCanvasElement.prototype,'getBoundingClientRect').mockImplementation(()=>rect);
 vi.stubGlobal('ResizeObserver',class{constructor(callback){resizeCallbacks.push(callback);}observe(){}disconnect(){}});
 vi.stubGlobal('devicePixelRatio',1);document.documentElement.dataset.theme='dark';
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();delete document.documentElement.dataset.theme;});
const ranked=['SAFE','<script>alert("x")</script>'].map((symbol,index)=>({assessment:{qualified:true},row:{symbol,current_price:101+index,se_pivot_price:100,rs_rating:90+index,se_volume_vs_50d:1.5,chart_path:index?null:'actual.json'}}));
const geometryFor=(rows,small=false)=>radarGeometry(rows.filter(item=>item.assessment.qualified).map(({row})=>{const plan=entryPlan(row);return {symbol:row.symbol,distance:plan.distance,rs:row.rs_rating,volume:row.se_volume_vs_50d,state:stateKey(plan.state),pickable:Boolean(row.chart_path)};}),small?340:620,small?124:224);
const coordinates=point=>({clientX:rect.left+point.x/620*rect.width,clientY:rect.top+point.y/224*rect.height});
it('preserves canvas hover labels, selection, tooltip and disabled-point behavior without interpreting symbols as HTML',()=>{
 const onSelect=vi.fn();const {container}=render(<SetupRadar ranked={ranked} selectedSymbol="SAFE" onSelect={onSelect}/>);
 const canvas=screen.getByRole('img'),geometry=geometryFor(ranked);
 expect(canvas).toHaveAttribute('data-radar-point-count','2');expect(canvas.getAttribute('aria-label')).toContain('2銘柄');
 expect(container.querySelectorAll('script')).toHaveLength(0);
 fireEvent.mouseMove(canvas,coordinates(geometry.points[1]));
 expect(container.querySelector('.radar-point-label')).toHaveTextContent(ranked[1].row.symbol);expect(canvas.title).toContain(ranked[1].row.symbol);expect(canvas).toHaveStyle({cursor:'default'});
 fireEvent.click(canvas,coordinates(geometry.points[1]));expect(onSelect).not.toHaveBeenCalled();
 fireEvent.mouseOut(canvas,{relatedTarget:null});expect(container.querySelector('.radar-point-label')).toHaveTextContent('SAFE');
 fireEvent.mouseMove(canvas,coordinates(geometry.points[0]));expect(canvas).toHaveStyle({cursor:'pointer'});
 fireEvent.click(canvas,coordinates(geometry.points[0]));expect(onSelect).toHaveBeenCalledWith('SAFE');
 fireEvent.mouseOut(canvas,{relatedTarget:new window.EventTarget()});expect(container.querySelector('.radar-point-label')).toHaveTextContent('SAFE');
});
it('draws the 207 real canonical points in exact order, size and per-point alpha at both viewports',()=>{
 for(const small of [false,true]) {
  context=recordingContext();vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
  rect={left:0,top:0,width:small?340:620,height:small?124:224};const geometry=geometryFor(fixture.ranked,small);
  const {container,unmount}=render(<SetupRadar ranked={fixture.ranked} small={small} onSelect={()=>{}}/>);
  expect(context.points).toHaveLength(207);expect(screen.getByRole('img')).toHaveAttribute('data-radar-point-count','207');
  for(const [index,point] of geometry.points.entries()) {
   expect(context.points[index]).toEqual({arc:[point.x,point.y,point.radius,0,Math.PI*2],color:palettes.dark[STATES[point.state][2]],alpha:point.state==='zone'?.95:.6,composite:'source-over'});
  }
  expect(context.fillRect).toHaveBeenCalledWith(geometry.x(0),geometry.top,geometry.x(5)-geometry.x(0),geometry.ph);
  expect(context.lines).toHaveLength(11);
  for(const [index,value] of [-15,-10,-5,0,5,10,25].entries())expect(context.lines[index]).toEqual({start:[geometry.x(value),geometry.top],end:[geometry.x(value),geometry.top+geometry.ph],color:palettes.dark[value===0||value===5?'zone-edge':'grid'],dash:value===0||value===5?[3,3]:[]});
  expect(container.querySelectorAll('.radar-x')).toHaveLength(small?4:7);expect(container.querySelectorAll('.radar-y')).toHaveLength(4);unmount();
 }
});
it('updates only the selection overlay and clears stale selections and marks on a new publication',()=>{
 const onSelect=vi.fn();const {container,rerender}=render(<SetupRadar ranked={ranked} selectedSymbol="SAFE" onSelect={onSelect}/>);
 const canvas=screen.getByRole('img'),label=container.querySelector('.radar-point-label');
 fireEvent.mouseMove(canvas,coordinates(geometryFor(ranked).points[0]));expect(container.querySelector('.radar-point-label')).toBe(label);expect(context.points).toHaveLength(2);
 rerender(<SetupRadar ranked={ranked} selectedSymbol={ranked[1].row.symbol} onSelect={onSelect}/>);
 expect(container.querySelector('.radar-point-label')).toHaveTextContent(ranked[1].row.symbol);expect(screen.getByRole('img')).toBe(canvas);expect(context.points).toHaveLength(2);expect(container.querySelector('script')).toBeNull();
 rerender(<SetupRadar ranked={[]} selectedSymbol="SAFE" onSelect={onSelect}/>);
 expect(screen.getByRole('img')).toHaveAttribute('data-radar-point-count','0');expect(container.querySelector('.radar-point-label')).toBeNull();expect(container.querySelector('[data-radar-selection]')).toBeEmptyDOMElement();
});
it('redraws on theme, CSS size and pixel-density changes while hit testing stays in logical coordinates',async()=>{
 const widthWrites=vi.spyOn(HTMLCanvasElement.prototype,'width','set'),heightWrites=vi.spyOn(HTMLCanvasElement.prototype,'height','set');
 const onSelect=vi.fn();render(<SetupRadar ranked={ranked} onSelect={onSelect}/>);const canvas=screen.getByRole('img');
 expect(widthWrites).not.toHaveBeenCalled();expect(heightWrites).not.toHaveBeenCalled();
 expect(context.points[0].color).toBe(palettes.dark.zone);
 document.documentElement.dataset.theme='light';await waitFor(()=>expect(context.points.at(-1).color).toBe(palettes.light.zone));
 const count=context.points.length;resizeCallbacks[0]();expect(context.points).toHaveLength(count);
 rect={...rect,width:310,height:112};vi.stubGlobal('devicePixelRatio',2);fireEvent(window,new Event('resize'));
 expect(canvas.width).toBe(620);expect(canvas.height).toBe(224);expect(context.setTransform).toHaveBeenLastCalledWith(1,0,0,1,0,0);
 fireEvent.click(canvas,coordinates(geometryFor(ranked).points[0]));expect(onSelect).toHaveBeenCalledWith('SAFE');
 rect={...rect,width:620,height:224};resizeCallbacks[0]();expect(canvas.width).toBe(1240);expect(canvas.height).toBe(448);expect(context.setTransform).toHaveBeenLastCalledWith(2,0,0,2,0,0);
});
it('uses the topmost actually painted circle for overlap hit testing and does not make missing points selectable',()=>{
 const points=geometryFor(ranked).points;const top={...points[0],symbol:'TOP',pickable:false};
 expect(radarHit([points[0],top],top.x,top.y)).toBe(top);expect(radarHit(points,0,0)).toBeNull();expect(radarHit(points,NaN,0)).toBeNull();
 const {container}=render(<SetupRadar ranked={[{...ranked[0],assessment:{qualified:false}},{...ranked[1],row:{...ranked[1].row,se_pivot_price:null}}]} onSelect={()=>{}}/>);
 expect(container.querySelector('canvas')).toHaveAttribute('data-radar-point-count','0');
});
it('keeps the canvas, HTML label and SVG selection aligned when maximum height makes the viewport non-proportional',()=>{
 rect={left:10,top:20,width:820,height:228};const onSelect=vi.fn(),point=geometryFor(ranked).points[0];
 const {container}=render(<SetupRadar ranked={ranked} selectedSymbol="SAFE" onSelect={onSelect}/>);
 expect(context.setTransform).toHaveBeenLastCalledWith(820/620,0,0,228/224,0,0);
 const overlay=container.querySelector('svg');expect(overlay).toHaveAttribute('preserveAspectRatio','none');
 expect(overlay.querySelector('circle')).toHaveAttribute('cx',String(point.x));expect(overlay.querySelector('circle')).toHaveAttribute('cy',String(point.y));
 const label=container.querySelector('.radar-point-label');expect(parseFloat(label.style.left)).toBeCloseTo(point.x/620*100);expect(parseFloat(label.style.top)).toBeCloseTo(point.y/224*100);
 fireEvent.click(screen.getByRole('img'),coordinates(point));expect(onSelect).toHaveBeenCalledWith('SAFE');
});
it('rejects invalid geometry and escapes every data-bearing HTML label',()=>{
 const geometry=geometryFor(ranked);
 const html=document.createElement('div');html.innerHTML=radarFrame(geometry,false);html.querySelector('[data-radar-label]').innerHTML=radarSelection(geometry,geometry.points[1]).label;
 expect(html.querySelector('script')).toBeNull();expect(html.querySelector('.radar-point-label b')).toHaveTextContent(ranked[1].row.symbol);
 expect(()=>radarFrame({...geometry,width:'1" onload="alert(1)'},false)).toThrow('Invalid radar frame');
 expect(()=>radarSelection(geometry,{...geometry.points[0],x:Infinity})).toThrow('Invalid radar selection');
 expect(()=>drawRadar(context,{...geometry,points:[{...geometry.points[0],x:NaN}]},palettes.dark)).toThrow('Invalid radar point');
 expect(()=>drawRadar(context,{...geometry,points:[{...geometry.points[0],state:'bad'}]},palettes.dark)).toThrow('Invalid radar point');
});
it('does not report or select undrawn points when a canvas context is unavailable',()=>{
 vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);const onSelect=vi.fn();
 render(<SetupRadar ranked={ranked} onSelect={onSelect}/>);const canvas=screen.getByRole('img');
 expect(canvas.getAttribute('aria-label')).toContain('描画できません');expect(canvas).not.toHaveAttribute('data-radar-point-count');
 fireEvent.click(canvas,coordinates(geometryFor(ranked).points[0]));expect(onSelect).not.toHaveBeenCalled();
});
