import {it,expect} from 'vitest';
import {swipeDirection} from './swipeNavigation';
it('requires an intentional horizontal swipe and distinguishes direction',()=>{
 const start={x:200,y:100,at:0};
 expect(swipeDirection(start,{x:80,y:110,at:300})).toBe('next');
 expect(swipeDirection(start,{x:300,y:110,at:300})).toBe('previous');
 for(const end of [{x:195,y:100,at:100},{x:100,y:300,at:300},{x:80,y:100,at:1000}])expect(swipeDirection(start,end)).toBeNull();
 expect(swipeDirection(null,{x:80,y:100,at:300})).toBeNull();
});
