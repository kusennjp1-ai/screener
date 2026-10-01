import { test as base, expect } from '@playwright/test';

// A missing first page element can come from a browser exception long before
// the assertion. Preserve that evidence instead of reporting only a timeout.
export const test=base.extend({
 browserDiagnostics:[async({page},use,testInfo)=>{
  const messages=[];
  const record=entry=>{messages.push(entry);if(messages.length>100)messages.shift();};
  page.on('pageerror',error=>record({type:'pageerror',message:error.message,stack:error.stack}));
  page.on('console',message=>{if(message.type()==='error'||message.type()==='warning')record({type:message.type(),message:message.text()});});
  await use();
  if(testInfo.status!==testInfo.expectedStatus){
   console.error('Smoke browser diagnostics:',JSON.stringify(messages,null,2));
   await testInfo.attach('browser-errors',{body:JSON.stringify(messages,null,2),contentType:'application/json'});
  }
 },{auto:true}],
});
export {expect};
