import {describe,it,expect} from 'vitest';
import {mobileChromeBudget} from './mobile-chrome-contract.mjs';
import {requiredScreeningCaptures} from './screening-priority-acceptance.mjs';
describe('measured thumb toolbar allowance',()=>{
 const measured=()=>({viewport:{height:844},bottomNavHeight:104,mobileActionBar:{top:740,bottom:793,height:53,width:390}});
 it('retains the original budget without a second row',()=>expect(mobileChromeBudget({})).toBe(110));
 it('counts the two rows only when the action row is measured',()=>expect(mobileChromeBudget(measured())).toBe(160));
 it.each(['oversized','offscreen','inconsistent'])('rejects %s action geometry',kind=>{
  const m=measured();
  if(kind==='oversized'){m.mobileActionBar.height=90;m.mobileActionBar.bottom=830;}
  if(kind==='offscreen')m.mobileActionBar.top=900;
  if(kind==='inconsistent')m.mobileActionBar.height=44;
  expect(mobileChromeBudget(m)).toBe(110);
 });
 it('requires both market-map themes only for captures declaring the new contract',()=>{
  const old=requiredScreeningCaptures('ordinary'),next=requiredScreeningCaptures('ordinary',true);
  expect(next.filter(key=>!old.includes(key))).toEqual(['market-map/390/dark','market-map/390/light']);
 });
});
