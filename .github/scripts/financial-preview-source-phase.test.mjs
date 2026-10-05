import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {contract,dataInventory} from './financial-correction.mjs';
import {inventoryDigest,sha256} from './publication-state.mjs';
import {runPreviewSourcePhase,validateSourcePhase} from './financial-preview-source-phase.mjs';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'preview-source-phase-')),frontend=join(root,'frontend'),data=join(root,'data'),projection=join(root,'projection.json');
 mkdirSync(join(frontend,'tools'),{recursive:true});mkdirSync(join(data,'static-data'),{recursive:true});
 writeFileSync(join(frontend,'package.json'),'{"type":"module"}');writeFileSync(projection,'{"financial_generation":"fixture-generation"}');
 writeFileSync(join(frontend,'tools/export-research.mjs'),"import {} from './financial-correction-overlay.mjs';");
 const hook=body=>writeFileSync(join(frontend,'tools/financial-correction-overlay.mjs'),`export const FINANCIAL_CORRECTION_SCHEMA='${contract.projection_schema}';export function verifyCorrectionCompatibility({projection,evaluatedAt}){${body}}`);
 hook('return {generation:projection.financial_generation,checked_at:evaluatedAt};');
 const input={schema_version:'financial-preview-source-phase-v1',kind:'compatibility',projection_path:projection,projection_sha256:sha256(readFileSync(projection)),frontend_root:frontend,data_root:data,data_inventory_sha256:inventoryDigest(dataInventory(data))};
 return {root,frontend,data,projection,input,hook,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('compatibility runs with a fresh clock in its exiting process and returns the complete report',()=>{
 const f=fixture();try{const start=Date.now(),result=runPreviewSourcePhase(f.input,{auditDirectory:join(f.root,'audit')});assert.equal(result.generation,'fixture-generation');assert.ok(result.checked_at>=start&&result.checked_at<=Date.now());assert.ok(readFileSync(join(f.root,'audit/phase.json')).length);}finally{f.cleanup();}
});
test('source phases reject unknown modes, extra fields and changed projection or bundle bytes',()=>{
 const f=fixture();try{
  for(const change of [v=>v.kind='publish',v=>v.publish=true,v=>v.projection_path='relative',v=>v.projection_sha256='bad']){const v=structuredClone(f.input);change(v);assert.throws(()=>validateSourcePhase(v));}
  writeFileSync(f.projection,'{}');assert.throws(()=>runPreviewSourcePhase(f.input),/projection changed/);
  writeFileSync(f.projection,'{"financial_generation":"fixture-generation"}');writeFileSync(join(f.data,'static-data/changed.json'),'{}');assert.throws(()=>runPreviewSourcePhase(f.input),/data changed/);
 }finally{f.cleanup();}
});
test('a failing compatibility child is rejected even when it emitted JSON first',()=>{
 const f=fixture();try{f.hook('console.log("{}");throw Error("forced failure after output");');assert.throws(()=>runPreviewSourcePhase(f.input),/forced failure/);}finally{f.cleanup();}
});

test('direct preview CLI reaches input validation without an unresolved module cycle',()=>{
 const root=mkdtempSync(join(tmpdir(),'preview-cli-import-'));try{
  const value=spawnSync(process.execPath,[fileURLToPath(new URL('./financial-candidate-preview.mjs',import.meta.url)),'prepare','--request',join(root,'missing.json'),'--evidence',join(root,'evidence.json'),'--candidate-root',root,'--predecessor-zip',join(root,'before.zip'),'--source-zip',join(root,'source.zip'),'--output',join(root,'out')],{encoding:'utf8'});
  assert.equal(value.status,1);assert.match(value.stderr,/ENOENT/);assert.doesNotMatch(value.stderr,/unsettled top-level await/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
