import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openPublishedInput } from './input.mjs';
test('requires an exact external pin and one source without credentials or query parameters',async()=>{
 await assert.rejects(openPublishedInput({directory:'/tmp'}),/SHA-256/);
 await assert.rejects(openPublishedInput({directory:'/tmp',baseURL:'https://example.test/',publicationSha256:'0'.repeat(64)}),/exactly one/);
 await assert.rejects(openPublishedInput({baseURL:'http://example.test/',publicationSha256:'0'.repeat(64)}),/Invalid published/);
 await assert.rejects(openPublishedInput({baseURL:'https://user:secret@example.test/',publicationSha256:'0'.repeat(64)}),/Invalid published/);
 await assert.rejects(openPublishedInput({baseURL:'https://example.test/?latest=true',publicationSha256:'0'.repeat(64)}),/Invalid published/);
});
test('rejects a changed receipt before reading any transport data and leaves the source intact',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'indicator-input-'));
 try{const receipt=Buffer.from('{"schema":"untrusted"}');await writeFile(join(directory,'publication.json'),receipt);
  await assert.rejects(openPublishedInput({directory,publicationSha256:'0'.repeat(64)}),/digest mismatch/);
  assert.deepEqual(await readFile(join(directory,'publication.json')),receipt);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('the browser harness exits before any browser work outside an admitted CI job',()=>{
 const result=spawnSync(process.execPath,['.github/scripts/indicator-preview/capture.mjs'],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'',GITHUB_RUN_ID:''}});
 assert.equal(result.status,1);assert.match(result.stderr,/restricted to admitted GitHub Actions jobs/);assert.doesNotMatch(result.stderr,/browserType.launch|<launching>/);
});

test('accepts only the exact repository, isolated push branch and checked-in #99 pin',async()=>{
 const {loadPreviewPin,verifyPreviewPin,requireAdmittedPreview,previewInputOptions}=await import('./controls.mjs');
 const pin=await loadPreviewPin();assert.equal(pin.source_release.run_id,37456692717);
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kusennjp1-ai/screener',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/preview/market-indicator-histories',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
 requireAdmittedPreview(env);
 assert.deepEqual(await previewInputOptions(env),{baseURL:'https://kusennjp1-ai.github.io/screener/',publicationSha256:'0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a'});
 for(const patch of [{GITHUB_REPOSITORY:'other/repo'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_EVENT_NAME:'workflow_dispatch'},{GITHUB_REF:'refs/heads/main'},{GITHUB_REF:'refs/heads/preview/other'},{GITHUB_SHA:'short'},{GITHUB_RUN_ID:''},{INDICATOR_INPUT_BASE_URL:'https://example.test/'},{INDICATOR_INPUT_DIRECTORY:'/tmp'},{INDICATOR_PUBLICATION_SHA256:'b'.repeat(64)}])assert.throws(()=>requireAdmittedPreview({...env,...patch}));
 for(const patch of [{base_url:'https://example.test/'},{publication_sha256:'b'.repeat(64)},{source_release:{...pin.source_release,run_attempt:2}},{branch:'main'},{publication_authority:'release'}])assert.throws(()=>verifyPreviewPin({...pin,...patch}));
 await assert.rejects(previewInputOptions({INDICATOR_INPUT_BASE_URL:'https://example.test/'}),/prohibited/);
});

test('accepts the exact 766121-byte deployed #99 receipt within a bounded 1 MiB cap',async()=>{
 const {gunzipSync}=await import('node:zlib');
 const {parsePinnedPublication,sha256,PUBLICATION_BYTE_LIMIT,ASSET_BYTE_LIMIT}=await import('./input.mjs');
 const {validateExpectedRoot}=await import('../../../frontend/src/static/transport/index.mjs');
 const raw=gunzipSync(await readFile(new URL('./fixtures/publication-99.json.gz',import.meta.url)));
 const pin='0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a';
 assert.equal(raw.length,766121);assert.equal(sha256(raw),pin);
 assert.equal(PUBLICATION_BYTE_LIMIT,1048576);assert.equal(ASSET_BYTE_LIMIT,134217728);
 const value=parsePinnedPublication(raw,pin);validateExpectedRoot(value.transport.root);
 assert.equal(value.run_id,37456692717);assert.equal(value.run_attempt,1);
 assert.equal(value.transport.root.bytes,54900);
 assert.equal(value.transport.root.bindings.manifestSha256,value.data_manifest_sha256);
 assert.equal(value.transport.root.bindings.financialGeneration,value.financial_generation);
 assert.equal(value.transport.root.bindings.appCommit,value.ui_sha);
 const changed=Buffer.from(raw);changed[changed.length-1]^=1;
 assert.throws(()=>parsePinnedPublication(changed,pin),/digest mismatch/);
 assert.throws(()=>parsePinnedPublication(Buffer.alloc(PUBLICATION_BYTE_LIMIT+1),pin),/1 MiB cap/);
});
