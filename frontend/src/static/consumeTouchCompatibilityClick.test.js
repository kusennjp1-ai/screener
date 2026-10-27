import { afterEach, expect, it, vi } from 'vitest';
import { consumeTouchCompatibilityClick } from './consumeTouchCompatibilityClick';
afterEach(()=>{document.dispatchEvent(new Event('pointerdown',{bubbles:true}));document.body.replaceChildren();});
const guard=()=>consumeTouchCompatibilityClick({clientX:25,clientY:25,pointerId:7});
const click=(props={})=>Object.assign(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:25,clientY:25}),props);
it('consumes only the original touch click after the modal node has unmounted',()=>{
 const modal=document.createElement('button'),behind=document.createElement('button'),handler=vi.fn();
 document.body.append(modal,behind);behind.addEventListener('click',handler);guard();modal.remove();
 const event=click({pointerType:'touch',pointerId:7});behind.dispatchEvent(event);
 expect(event.defaultPrevented).toBe(true);expect(handler).not.toHaveBeenCalled();
 behind.dispatchEvent(click());expect(handler).toHaveBeenCalledOnce();
});
it.each(['keyboard','assistive','other-pointer','mouse-source','other-location'])('does not consume %s activation',kind=>{
 guard();let event=click();
 if(kind==='keyboard'||kind==='assistive')event=new MouseEvent('click',{bubbles:true,cancelable:true,detail:0,clientX:25,clientY:25});
 if(kind==='other-pointer')event=click({pointerType:'touch',pointerId:8});
 if(kind==='mouse-source')event=click({sourceCapabilities:{firesTouchEvents:false}});
 if(kind==='other-location')event=new MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:50,clientY:50});
 document.body.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
});
it.each(['pointerdown','keydown','blur'])('clears an unconsumed guard on the next %s without blocking the next tap',type=>{
 guard();(type==='blur'?window:document).dispatchEvent(new Event(type,{bubbles:true}));const event=click();document.body.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
});
it('replaces a pending guard without stacking capture listeners',()=>{
 guard();consumeTouchCompatibilityClick({clientX:100,clientY:100,pointerId:8});
 const event=click();document.body.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
});
