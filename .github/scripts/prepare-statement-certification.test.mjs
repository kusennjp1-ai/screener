import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectEvidence, parseRequest } from './prepare-statement-certification.mjs';
const request = JSON.parse(readFileSync(new URL('../financial-source-certification-request.json',import.meta.url)));
const source = request.source;
function api(path) {
  if(path.endsWith('/jobs?per_page=100'))return {total_count:1,jobs:[{name:'statement-recovery',conclusion:'failure'}]};
  if(path.endsWith('/artifacts?per_page=100'))return {total_count:1,artifacts:[{id:source.artifact_id,name:source.artifact_name,expired:false,digest:`sha256:${source.artifact_sha256}`,size_in_bytes:100}]};
  assert.equal(path,`repos/${source.repository}/actions/runs/${source.run_id}/attempts/${source.run_attempt}`);
  return {id:source.run_id,run_attempt:source.run_attempt,head_sha:source.head_sha,path:source.workflow,status:'completed',conclusion:'failure'};
}
test('exact closed request keeps the original failed producer conclusion',()=>{
  assert.deepEqual(parseRequest(JSON.stringify(request)),request);
  assert.equal(collectEvidence(request,api).run.conclusion,'failure');
});
test('extra fields and mismatched artifact names fail',()=>{
  assert.throws(()=>parseRequest(JSON.stringify({...request,allow_failed:true})),/closed/);
  assert.throws(()=>parseRequest(JSON.stringify({...request,source:{...source,artifact_name:'latest'}})),/identity/);
});
test('incomplete GitHub inventories and wrong attempts fail closed',()=>{
  assert.throws(()=>collectEvidence(request,path=>path.endsWith('/jobs?per_page=100')?{total_count:2,jobs:[]}:api(path)),/inventory/);
  assert.throws(()=>collectEvidence(request,path=>path.includes('/jobs?')||path.includes('/artifacts?')?api(path):{...api(path),run_attempt:99}),/terminal/);
});
test('workflow only permits approved read-only certification branch',()=>{
  const workflow=readFileSync(new URL('../workflows/financial-source-certification.yml',import.meta.url),'utf8');
  assert.match(workflow,/branches: \[preview\/financial-source-certification\]/);
  assert.match(workflow,/contents: read\n  actions: read/);
  assert.doesNotMatch(workflow,/^\s+(workflow_run|schedule|workflow_dispatch):/m);
  assert.doesNotMatch(workflow,/permissions:[\s\S]*?(contents|actions|pages|id-token): write/);
  assert.doesNotMatch(workflow,/run-statement-recovery-cycle|capture_financial_statement_batch|deploy-pages/);
});
