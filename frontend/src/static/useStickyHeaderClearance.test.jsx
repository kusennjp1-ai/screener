import { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { stickyHeaderClearance, useStickyHeaderClearance } from './useStickyHeaderClearance';

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
