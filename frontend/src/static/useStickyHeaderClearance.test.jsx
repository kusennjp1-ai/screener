import { useRef } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { stickyBoardHeightLimit, stickyHeaderClearance, useStickyHeaderClearance } from './useStickyHeaderClearance';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([[80,56,0],[58,56,0],[57.9,56,1],[52.0625,56,6],[-10.2,56,69],[NaN,56,0],[50,NaN,0]])('rounds scroll top %s and header bottom %s to a safe clearance %s', (top,bottom,expected) => {
  expect(stickyHeaderClearance(top,bottom)).toBe(expected);
});

it('tracks constrained desktop scroll ports without rerendering and resets on mobile, disable and unmount', () => {
  let top=80,frame; const observers=[];
  vi.stubGlobal('innerWidth',1440);
  vi.stubGlobal('scrollY',0);
  vi.stubGlobal('requestAnimationFrame',vi.fn(callback => {frame=callback;return 1;}));
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.stubGlobal('ResizeObserver',class {constructor(callback){this.callback=callback;this.observe=vi.fn();this.disconnect=vi.fn();observers.push(this);}});
  const measure=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){return this.classList.contains('leader-header')?{bottom:56}:{top};});
  let renders=0;
  function Harness({enabled=true}) {renders++;const ref=useRef(null);useStickyHeaderClearance(ref,enabled);return <><header className="leader-header"/><div className="research-grid"><div ref={ref} className="candidate-scroll"/></div></>;}
  const {container,rerender,unmount}=render(<Harness/>),scroll=container.querySelector('.candidate-scroll');
  const value=()=>scroll.style.getPropertyValue('--candidate-header-clearance');
  expect(value()).toBe('');expect(measure).not.toHaveBeenCalled();expect(observers[0].observe).toHaveBeenCalledTimes(3);
  vi.stubGlobal('scrollY',3207);top=52.0625;act(()=>{fireEvent.scroll(window);frame();});expect(value()).toBe('6px');expect(renders).toBe(1);
  top=22.25;act(()=>{observers[0].callback();frame();});expect(value()).toBe('36px');
  vi.stubGlobal('innerWidth',390);act(()=>{fireEvent.resize(window);frame();});expect(value()).toBe('');
  vi.stubGlobal('innerWidth',1440);act(()=>{fireEvent.resize(window);frame();});expect(value()).toBe('36px');
  rerender(<Harness enabled={false}/>);expect(value()).toBe('');expect(observers[0].disconnect).toHaveBeenCalledOnce();
  rerender(<Harness/>);expect(value()).toBe('36px');unmount();expect(value()).toBe('');expect(observers[1].disconnect).toHaveBeenCalledOnce();
});

it('reserves first-row clearance inside the list without padding the sticky scrollport edge', () => {
  const css=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'workbench.css'),'utf8');
  const {container}=render(<style>{css}</style>);
  const rules=[...container.querySelector('style').sheet.cssRules];
  const declarations=selector=>rules.filter(rule=>rule.selectorText?.replaceAll(' ','').replaceAll('"','')===selector).flatMap(rule=>Array.from({length:rule.style.length},(_,index)=>rule.style[index]).map(name=>[name,rule.style.getPropertyValue(name)]));
  expect(declarations('.candidate-scroll').filter(([name])=>name==='padding-top')).toEqual([]);
  expect(declarations('.candidate-scroll>[role=list]')).toContainEqual(['padding-top','var(--candidate-header-clearance,0px)']);
  expect(declarations('.candidate-columns')).toContainEqual(['top','var(--candidate-header-clearance,0px)']);
  expect(declarations('.candidate-scroll')).toContainEqual(['scroll-padding-top','calc(28px + var(--candidate-header-clearance,0px))']);
});

it.each([
  [749.984375,56,900,225,691],
  [803.921875,56,900,225,745],
  [749.984375,56,900,539,691],
  [200,56,900,225,225],
  [1500,56,900,225,null],
  [NaN,56,900,225,null],
])('caps grid bottom %s below header %s in viewport %s with minimum %s to %s', (bottom,header,viewport,minimum,expected) => {
  expect(stickyBoardHeightLimit(bottom,header,viewport,minimum)).toBe(expected);
});

it('caps the whole board before measuring inner clearance, and preserves the independent grid boundary', () => {
  let frame, gridBottom=749.984375, chrome=146;
  vi.stubGlobal('innerWidth',1440);vi.stubGlobal('innerHeight',900);vi.stubGlobal('scrollY',3207);
  vi.stubGlobal('requestAnimationFrame',vi.fn(callback=>{frame=callback;return 1;}));
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  const observers=[];
  vi.stubGlobal('ResizeObserver',class {constructor(callback){this.callback=callback;this.observe=vi.fn();this.disconnect=vi.fn();observers.push(this);}});
  const measured=[];
  vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){
    if(this.classList.contains('leader-header'))return {bottom:56};
    if(this.classList.contains('research-grid'))return {bottom:gridBottom};
    if(this.classList.contains('candidate-glossary'))return {height:chrome};
    const board=this.closest('.research-list'),limit=parseFloat(board.style.getPropertyValue('--candidate-board-max-height'));
    const height=Number.isFinite(limit)?Math.min(844,limit):844,top=Math.min(56,gridBottom-height);
    measured.push({height,top,gridBottom,chrome});
    return this===board?{top,height}:{top:top+chrome,height:Math.max(0,height-chrome)};
  });
  function Harness({enabled=true}){const ref=useRef(null);useStickyHeaderClearance(ref,enabled);return <><header className="leader-header"/><div className="research-grid" data-view="list"><section className="research-list"><details className="candidate-glossary"><summary>一覧の見方</summary></details><div ref={ref} className="candidate-scroll"/></section></div></>;}
  const {container,rerender,unmount}=render(<Harness/>),board=container.querySelector('.research-list'),scroll=container.querySelector('.candidate-scroll');
  const cap=()=>board.style.getPropertyValue('--candidate-board-max-height');
  const move=vi.fn(({top})=>{gridBottom-=top;});vi.stubGlobal('scrollBy',move);
  expect(cap()).toBe('691px');expect(scroll.style.getPropertyValue('--candidate-header-clearance')).toBe('');
  for(let index=0;index<6;index++)act(()=>{observers[0].callback();frame();});
  expect(cap()).toBe('691px');expect(new Set(measured.map(value=>value.gridBottom))).toEqual(new Set([749.984375]));
  // Opening the glossary grows the chrome without growing/shrinking the grid.
  chrome=460;act(()=>{observers[0].callback();frame();});expect(cap()).toBe('691px');
  gridBottom=803.921875;act(()=>{fireEvent.scroll(window);frame();});expect(cap()).toBe('745px');
  gridBottom=1500;act(()=>{fireEvent.scroll(window);frame();});expect(cap()).toBe('');
  gridBottom=749.984375;act(()=>{fireEvent.scroll(window);frame();});expect(cap()).toBe('691px');
  vi.stubGlobal('innerWidth',700);act(()=>{fireEvent.resize(window);frame();});expect(cap()).toBe('');
  vi.stubGlobal('innerWidth',701);act(()=>{fireEvent.resize(window);frame();});expect(cap()).toBe('691px');
  // Only explicit opening reveals a glossary that needs more space. Scrolling
  // and resizing alone preserve the ordinary containing-block exit behavior.
  gridBottom=590;chrome=146;act(()=>{fireEvent.scroll(window);frame();});expect(cap()).toBe('532px');
  chrome=600;act(()=>{fireEvent.resize(window);frame();});expect(cap()).toBe('679px');expect(move).not.toHaveBeenCalled();
  chrome=146;act(()=>{fireEvent.resize(window);frame();});expect(cap()).toBe('532px');
  chrome=600;
  const glossary=container.querySelector('.candidate-glossary');
  act(()=>{glossary.open=true;fireEvent(glossary,new Event('toggle'));frame();});
  expect(move).toHaveBeenCalledExactlyOnceWith({top:-147,behavior:'instant'});expect(cap()).toBe('679px');
  for(let index=0;index<6;index++)act(()=>{observers[0].callback();frame();});
  expect(cap()).toBe('679px');expect(gridBottom).toBe(737);expect(measured.at(-1).top).toBe(56);expect(move).toHaveBeenCalledTimes(1);
  act(()=>{glossary.open=false;fireEvent(glossary,new Event('toggle'));frame();});expect(move).toHaveBeenCalledTimes(1);
  gridBottom=749.984375;chrome=460;
  rerender(<Harness enabled={false}/>);expect(cap()).toBe('');
  rerender(<Harness/>);expect(cap()).toBe('691px');unmount();expect(cap()).toBe('');
});

it('preserves the original desktop grid minimum independently of the variable sidebar cap', () => {
  const css=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'workbench.css'),'utf8');
  const {container}=render(<style>{css}</style>);
  const media=[...container.querySelector('style').sheet.cssRules].filter(rule=>rule.conditionText==='(min-width:701px)');
  const rules=media.flatMap(rule=>[...rule.cssRules]);
  const grid=rules.find(rule=>rule.selectorText?.replaceAll('"','')==='.research-grid[data-view=list]:has(>.research-list:not(.compare-only))');
  const board=rules.find(rule=>rule.selectorText?.replaceAll('"','')==='.research-grid[data-view=list]>.research-list:not(.compare-only)');
  expect(grid.style.getPropertyValue('min-height')).toBe('calc(100dvh - 56px)');
  expect(board.style.getPropertyValue('height')).toBe('calc(100dvh - 56px)');
  expect(board.style.getPropertyValue('max-height')).toBe('var(--candidate-board-max-height,calc(100dvh - 56px))');
});


it('includes actual non-scroll margins, board padding, borders and flex gaps when the port has collapsed', () => {
  vi.stubGlobal('innerWidth',1440);vi.stubGlobal('innerHeight',900);vi.stubGlobal('scrollY',1);
  vi.stubGlobal('requestAnimationFrame',vi.fn());vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){
    if(this.classList.contains('leader-header'))return {bottom:56};
    if(this.classList.contains('research-grid'))return {bottom:200};
    if(this.classList.contains('candidate-guide'))return {height:200};
    return {top:100,height:0};
  });
  function Harness(){const ref=useRef(null);useStickyHeaderClearance(ref,true);return <><header className="leader-header"/><div className="research-grid"><section className="research-list" style={{paddingTop:2,paddingBottom:3,borderTop:'1px solid',borderBottom:'1px solid',rowGap:5}}><div className="candidate-guide" style={{marginTop:4,marginBottom:6}}/><div ref={ref} className="candidate-scroll"/></section></div></>;}
  const {container}=render(<Harness/>);
  expect(container.querySelector('.research-list').style.getPropertyValue('--candidate-board-max-height')).toBe('301px');
});
