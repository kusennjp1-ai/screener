import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';

vi.mock('./CandidateCharts',()=>({default:()=>null}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const props={ranked:[{row:{symbol:'FOCUS',current_price:102,se_pivot_price:100},assessment:{qualified:true,passed:9,total:9}}],method:'minervini'};

function focusedFixture({height=568,headerBottom=48,navTop=512,targetTop=484.4375,targetHeight=44,scrollable=false}={}) {
 let nextFrame,pageY=0;
 vi.stubGlobal('innerHeight',height);
 vi.stubGlobal('requestAnimationFrame',vi.fn(callback=>{nextFrame=callback;return 1;}));
 const scrollBy=vi.fn(({top})=>{pageY+=top;});
 vi.stubGlobal('scrollBy',scrollBy);
 const onSelect=vi.fn(),onCompare=vi.fn(),onWatch=vi.fn();
 const {container}=render(<><header className="leader-header"/><CandidateBoard {...props} onSelect={onSelect} onCompare={onCompare} onWatch={onWatch}/><nav className="leader-mobile-nav"/></>);
 const actions=screen.getAllByRole('button').filter(node=>node.closest('.candidate-feed-card'));
 const target=actions[1],scroll=container.querySelector('.candidate-scroll');
 scroll.style.overflowY=scrollable?'auto':'visible';
 scroll.scrollTop=1000;
 Object.defineProperties(scroll,{scrollHeight:{value:2000},clientHeight:{value:height-273}});
 vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){
  if(this===target){const top=targetTop-pageY-(scrollable?scroll.scrollTop-1000:0);return {top,bottom:top+targetHeight,height:targetHeight};}
  if(this===scroll)return {top:273,bottom:height,height:height-273};
  if(this.classList.contains('leader-header'))return {top:0,bottom:headerBottom,height:headerBottom};
  if(this.classList.contains('leader-mobile-nav'))return {top:navTop??0,bottom:navTop==null?0:height,height:navTop==null?0:height-navTop};
  return {top:0,bottom:0,height:0};
 });
 const tab=(reverse=false)=>{
  const from=actions[reverse?2:0];from.focus({preventScroll:true});
  fireEvent.keyDown(from,{key:'Tab',shiftKey:reverse});
  // Simulate the browser moving focus before the next animation frame. Its
  // native scroll result is the measured, still-clipped target geometry.
  target.focus({preventScroll:true});nextFrame();
 };
 return {target,scroll,scrollBy,tab,onSelect,onCompare,onWatch};
}

it.each([
 ['short mobile evidence',568,48,512,484.4375,44,25],
 ['mobile chart behind fixed nav',844,48,788,800.34375,44,65],
 ['tablet fractional bottom edge',900,56,null,834.15625,66,9],
 ['reverse traversal behind header',568,48,512,47.65625,44,-9],
])('reveals the entire %s action after native Tab scrolling',(label,height,headerBottom,navTop,targetTop,targetHeight,delta)=>{
 const fixture=focusedFixture({height,headerBottom,navTop,targetTop,targetHeight});
 fixture.tab(delta<0);
 expect(fixture.target).toHaveFocus();
 expect(fixture.scrollBy).toHaveBeenCalledExactlyOnceWith({top:delta,behavior:'instant'});
 const bounds=fixture.target.getBoundingClientRect();
 expect(bounds.top).toBeGreaterThanOrEqual(headerBottom);
 expect(bounds.bottom).toBeLessThanOrEqual(navTop??height);
 expect(fixture.onSelect).not.toHaveBeenCalled();
 expect(fixture.onCompare).not.toHaveBeenCalled();
 expect(fixture.onWatch).not.toHaveBeenCalled();
});

it('repairs a fractional desktop clip in the candidate scroller without moving the page',()=>{
 const fixture=focusedFixture({height:900,headerBottom:56,navTop:null,targetTop:856.34375,scrollable:true});
 fixture.tab();
 expect(fixture.scroll.scrollTop).toBe(1009);
 expect(fixture.scrollBy).not.toHaveBeenCalled();
 expect(fixture.target.getBoundingClientRect().bottom).toBeLessThan(900);
});

it('keeps a fully visible action and programmatic Back focus at their saved scroll positions',()=>{
 const fixture=focusedFixture({targetTop:300});
 fixture.tab();
 expect(fixture.scrollBy).not.toHaveBeenCalled();
 expect(fixture.scroll.scrollTop).toBe(1000);
 vi.mocked(requestAnimationFrame).mockClear();
 fixture.target.blur();
 vi.spyOn(fixture.target,'getBoundingClientRect').mockReturnValue({top:484.4375,bottom:528.4375,height:44});
 fixture.target.focus({preventScroll:true});
 expect(requestAnimationFrame).not.toHaveBeenCalled();
 expect(fixture.scrollBy).not.toHaveBeenCalled();
});
