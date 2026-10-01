import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SetupRadar from './SetupRadar';
import { radarMarks, radarPlot } from '../radarMarks';
import { radarGeometry } from '../positionGeometry';

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
