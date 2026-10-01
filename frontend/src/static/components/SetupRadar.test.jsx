import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SetupRadar from './SetupRadar';
import { radarMarks, radarPlot, radarFrame, radarSelection } from '../radarMarks';
import { radarGeometry, stateKey, STATES } from '../positionGeometry';
import { entryPlan } from '../researchEngine';
import fixture from '../../../tools/fixtures/radar-207-2026-09-29.json';

afterEach(cleanup);
const ranked = ['SAFE', '<script>alert("x")</script>'].map((symbol,index)=>({assessment:{qualified:true},row:{symbol,current_price:101+index,se_pivot_price:100,rs_rating:90+index,se_volume_vs_50d:1.5,chart_path:index?null:'actual.json'}}));
it('keeps every SVG point, native title, selection, delegated hover and disabled point behavior',()=>{
 const onSelect=vi.fn();const {container}=render(<SetupRadar ranked={ranked} selectedSymbol="SAFE" onSelect={onSelect}/>);
 const circles=container.querySelectorAll('circle[data-radar-point]');
 expect(circles).toHaveLength(2);
 expect(container.querySelectorAll('script')).toHaveLength(0);
 expect(circles[0].parentElement).toHaveAttribute('fill','var(--zone)');
 expect(circles[0].parentElement).toHaveAttribute('fill-opacity','0.95');
 expect(circles[0].parentElement).not.toHaveAttribute('opacity');
 expect(circles[1]).toHaveStyle({cursor:'default'});
 expect(circles[1].querySelector('title').textContent).toContain('<script>alert("x")</script>');
 expect(screen.getByRole('img').getAttribute('aria-label')).toContain('2銘柄');
 fireEvent.mouseOver(circles[1]);
 expect(container.querySelector('.radar-point-label')).toHaveTextContent('<script>alert("x")</script>');
 fireEvent.click(circles[1]);expect(onSelect).not.toHaveBeenCalled();
 fireEvent.mouseOut(circles[1],{relatedTarget:null});
 expect(container.querySelector('.radar-point-label')).toHaveTextContent('SAFE');
 fireEvent.mouseOver(circles[1]);fireEvent.mouseOut(circles[1],{relatedTarget:new window.EventTarget()});
 expect(container.querySelector('.radar-point-label')).toHaveTextContent('SAFE');
 fireEvent.click(circles[0]);expect(onSelect).toHaveBeenCalledWith('SAFE');
});
it('rejects non-finite coordinates and non-palette state values before SVG insertion',()=>{
 expect(()=>radarMarks([{x:NaN,y:0,radius:3,distance:1,rs:90,state:'zone'}])).toThrow('Invalid radar point');
 expect(()=>radarMarks([{x:1,y:0,radius:3,distance:1,rs:90,state:'bad" onload="alert(1)'}])).toThrow('Invalid radar point');
});
it('keeps the grid coordinates, line styles and marks in the same paint order at both sizes',()=>{
 for(const [width,height] of [[620,224],[340,124]]) {
  const geometry=radarGeometry([{symbol:'SAFE',distance:1,rs:90,volume:1.5,state:'zone',pickable:true}],width,height);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.innerHTML=radarPlot(geometry);
  const children=[...svg.children];expect(children).toHaveLength(13);
  expect(children[0].tagName).toBe('rect');expect(children[0]).toHaveAttribute('x',String(geometry.x(0)));
  expect(children[0]).toHaveAttribute('width',String(geometry.x(5)-geometry.x(0)));
  for(const [index,value] of [-15,-10,-5,0,5,10,25].entries()) {
   expect(children[index+1]).toHaveAttribute('d',`M${geometry.x(value)} ${geometry.top}V${geometry.top+geometry.ph}`);
   expect(children[index+1].getAttribute('stroke-dasharray')).toBe(value===0||value===5?'3 3':null);
  }
  for(const [index,value] of [70,80,90,100].entries()) expect(children[index+8]).toHaveAttribute('d',`M${geometry.left} ${geometry.y(value)}H${geometry.left+geometry.pw}`);
  expect(children.at(-1).firstElementChild).toHaveAttribute('data-radar-point','0');
 }
 expect(()=>radarPlot({...radarGeometry([]),left:Infinity})).toThrow('Invalid radar geometry');
});
it('keeps all 207 canonical observations, coordinates, volume sizes and paint order at both viewports',()=>{
 const points=fixture.ranked.map(({row})=>{const plan=entryPlan(row);return {symbol:row.symbol,distance:plan.distance,rs:row.rs_rating,volume:row.se_volume_vs_50d,state:stateKey(plan.state),pickable:Boolean(row.chart_path)};});
 for(const small of [false,true]) {
  const geometry=radarGeometry(points,small?340:620,small?124:224);
  const {container,unmount}=render(<SetupRadar ranked={fixture.ranked} small={small} onSelect={()=>{}}/>);
  const circles=[...container.querySelectorAll('[data-radar-point]')];expect(circles).toHaveLength(207);
  for(const [index,point] of geometry.points.entries()) {
   expect(circles[index]).toHaveAttribute('cx',String(point.x));expect(circles[index]).toHaveAttribute('cy',String(point.y));expect(circles[index]).toHaveAttribute('r',String(point.radius));
   expect(circles[index].namespaceURI).toBe('http://www.w3.org/2000/svg');
   expect(circles[index].querySelector('title').textContent).toContain(point.symbol);
   expect(circles[index].parentElement).toHaveAttribute('fill',`var(--${STATES[point.state][2]})`);
   expect(circles[index].parentElement).toHaveAttribute('fill-opacity',String(point.state==='zone'?.95:.6));
   expect(circles[index].parentElement).not.toHaveAttribute('opacity');
  }
  expect(container.querySelectorAll('.radar-x')).toHaveLength(small?4:7);
  expect(container.querySelectorAll('.radar-y')).toHaveLength(4);
  unmount();
 }
});
it('updates only the selection overlay on hover and selection, and clears stale selections on a new publication',()=>{
 const onSelect=vi.fn();const {container,rerender}=render(<SetupRadar ranked={ranked} selectedSymbol="SAFE" onSelect={onSelect}/>);
 const point=container.querySelector('[data-radar-point]');const marks=container.querySelector('[data-radar-marks]');
 fireEvent.mouseOver(point);expect(container.querySelector('[data-radar-marks]')).toBe(marks);
 rerender(<SetupRadar ranked={ranked} selectedSymbol={ranked[1].row.symbol} onSelect={onSelect}/>);
 expect(container.querySelector('.radar-point-label')).toHaveTextContent(ranked[1].row.symbol);expect(container.querySelector('script')).toBeNull();
 expect(container.querySelector('[data-radar-point]')).toBe(point);
 rerender(<SetupRadar ranked={[]} selectedSymbol="SAFE" onSelect={onSelect}/>);
 expect(container.querySelectorAll('[data-radar-point]')).toHaveLength(0);expect(container.querySelector('.radar-point-label')).toBeNull();
 expect(container.querySelector('[data-radar-selection]')).toBeEmptyDOMElement();
});
it('rejects invalid frame/selection coordinates and escapes every data-bearing HTML label',()=>{
 const geometry=radarGeometry([{symbol:'<img src=x onerror=alert(1)>',distance:1,rs:90,volume:1,state:'zone',pickable:true}]);
 const html=document.createElement('div');html.innerHTML=radarFrame(geometry,false);
 html.querySelector('[data-radar-label]').innerHTML=radarSelection(geometry,geometry.points[0]).label;
 expect(html.querySelector('img')).toBeNull();expect(html.querySelector('.radar-point-label b')).toHaveTextContent('<img src=x onerror=alert(1)>');
 expect(()=>radarFrame({...geometry,width:'1" onload="alert(1)'},false)).toThrow('Invalid radar frame');
 expect(()=>radarSelection(geometry,{...geometry.points[0],x:Infinity})).toThrow('Invalid radar selection');
});
