import {readFile,realpath}from'node:fs/promises';
import {resolve,relative,isAbsolute}from'node:path';
const contracts=new Set(['financial_instrument_applicability_v1.json','native_annual_history_v1.json','static_financial_current_v1.json']);
export async function readDiagnosticSource(roots,pathname){
 const match=pathname.match(/^\/(baseline|candidate)\/((?:src\/[A-Za-z0-9_./-]+\.js)|(?:contracts\/[A-Za-z0-9_]+\.json))$/);
 if(!match||match[2].split('/').some(part=>part==='.'||part==='..'||!part))throw Error('Unapproved diagnostic path');
 if(match[2].startsWith('contracts/')&&!contracts.has(match[2].slice('contracts/'.length)))throw Error('Unapproved diagnostic contract');
 const root=await realpath(roots[match[1]]),file=await realpath(resolve(root,match[2])),rel=relative(root,file);
 if(rel.startsWith('..')||isAbsolute(rel))throw Error('Source path escaped checkout');
 return {body:await readFile(file),type:match[2].endsWith('.json')?'application/json':'text/javascript'};
}
