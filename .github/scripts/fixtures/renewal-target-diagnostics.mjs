// Read-only diagnostic evidence. Equality authority remains the production
// request SHA-256 check; this report never normalizes or accepts a target.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';

const MAX_BYTES=64*1024*1024,MAX_ROWS=10000,MAX_EXAMPLES=24;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const kind=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
const display=value=>{const text=JSON.stringify(value);return text===undefined?'[absent]':text.length>240?text.slice(0,240)+'…':text;};
function load(path){
  const info=lstatSync(path);
  if(!info.isFile()||info.nlink!==1||info.size>MAX_BYTES)throw Error('Unsafe or over-limit target diagnostic input');
  const bytes=readFileSync(path),value=JSON.parse(bytes);
  if(!Array.isArray(value.rows)||value.rows.length>MAX_ROWS)throw Error('Invalid target diagnostic rows');
  return {bytes,value};
}

export function compareRenewalTargets(expectedPath,actualPath,{evaluatedAt}={}){
  const expected=load(expectedPath),actual=load(actualPath),fields={},symbols={},examples=[];
  let differences=0;
  function difference(path,reason,left,right,symbol){
    differences++;const key=path.replace(/\[\d+\]/g,'[*]');fields[key]=(fields[key]||0)+1;
    if(symbol)symbols[symbol]=(symbols[symbol]||0)+1;
    if(examples.length<MAX_EXAMPLES)examples.push({path,reason,...(symbol?{symbol}:{}),expected:display(left),actual:display(right)});
  }
  function walk(left,right,path,symbol){
    if(Object.is(left,right))return;
    if(kind(left)!==kind(right)){difference(path,'type',left,right,symbol);return;}
    if(left===null||typeof left!=='object'){difference(path,'value',left,right,symbol);return;}
    if(Array.isArray(left)){
      for(let i=0;i<Math.max(left.length,right.length);i++){
        const next=path==='$.rows'?`${left[i]?.symbol??'[absent]'}→${right[i]?.symbol??'[absent]'}`:symbol;
        if(i>=left.length||i>=right.length)difference(`${path}[${i}]`,'presence',left[i],right[i],next);
        else walk(left[i],right[i],`${path}[${i}]`,next);
      }return;
    }
    for(const key of new Set([...Object.keys(left),...Object.keys(right)])){
      const child=`${path}[${JSON.stringify(key)}]`;
      if(!Object.hasOwn(left,key)||!Object.hasOwn(right,key))difference(child,'presence',left[key],right[key],symbol);
      else walk(left[key],right[key],child,symbol);
    }
  }
  // Keep row identity/order visible while using the same recursive comparator
  // for every field, including derived paths, prices and financial clocks.
  for(const key of new Set([...Object.keys(expected.value),...Object.keys(actual.value)])){
    const path=key==='rows'?'$.rows':`$[${JSON.stringify(key)}]`;
    if(!Object.hasOwn(expected.value,key)||!Object.hasOwn(actual.value,key))difference(path,'presence',expected.value[key],actual.value[key]);
    else walk(expected.value[key],actual.value[key],path);
  }
  return {schema_version:'renewal-target-diagnostic-v1',authority:'none',evaluated_at:evaluatedAt??null,
    expected:{bytes:expected.bytes.length,sha256:hash(expected.bytes),rows:expected.value.rows.length},
    actual:{bytes:actual.bytes.length,sha256:hash(actual.bytes),rows:actual.value.rows.length},
    exact_bytes_equal:expected.bytes.equals(actual.bytes),semantic_equal:differences===0,differences,
    fields,symbols,examples,examples_truncated:differences>examples.length};
}
