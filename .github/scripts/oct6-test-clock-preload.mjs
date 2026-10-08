// Diagnostic tests only: advancing wall-clock offsets; no production import.
import assert from 'node:assert/strict';
const NativeDate=globalThis.Date,nativeNow=NativeDate.now.bind(NativeDate);
const allowed=new Set(['2026-10-08T00:00:30.000Z','2026-10-09T00:00:30.000Z']);
const anchor=process.env.OCT6_TEST_CLOCK_ANCHOR;
assert(allowed.has(anchor),'Unapproved diagnostic clock anchor');
const offset=NativeDate.parse(anchor)-nativeNow();
function DiagnosticDate(...args){
  if(!new.target)return new NativeDate(nativeNow()+offset).toString();
  return Reflect.construct(NativeDate,args.length?args:[nativeNow()+offset],new.target);
}
Object.setPrototypeOf(DiagnosticDate,NativeDate);
DiagnosticDate.prototype=NativeDate.prototype;
Object.defineProperty(DiagnosticDate,'name',{value:'Date'});
Object.defineProperty(DiagnosticDate,'now',{value:()=>nativeNow()+offset,writable:true,configurable:true});
globalThis.Date=DiagnosticDate;
assert.equal(new Date(0).toISOString(),'1970-01-01T00:00:00.000Z');
assert(Math.abs(Date.now()-Date.parse(anchor))<1000,'Diagnostic clock not installed');
