import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SetupRadar from './SetupRadar';
import { radarMarks } from '../radarMarks';

afterEach(cleanup);
const ranked = ['SAFE', '<script>alert("x")</script>'].map((symbol,index)=>({assessment:{qualified:true},row:{symbol,current_price:101+index,se_pivot_price:100,rs_rating:90+index,se_volume_vs_50d:1.5,chart_path:index?null:'actual.json'}}));
it('keeps every SVG point, native title, selection, delegated hover and disabled point behavior',()=>{
 const onSelect=vi.fn();const {container}=render(<SetupRadar ranked={ranked} selectedSymbol="SAFE" onSelect={onSelect}/>);
 const circles=container.querySelectorAll('circle[data-radar-point]');
 expect(circles).toHaveLength(2);
 expect(container.querySelectorAll('script')).toHaveLength(0);
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
