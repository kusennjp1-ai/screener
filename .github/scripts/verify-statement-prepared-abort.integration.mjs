// Explicit offline integration: provide the independently downloaded reviewed ZIP.
// It is never downloaded by this test, committed, or treated as a completed source.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preparedAbortFixture,preparedAbortRequest} from './fixtures/targeted-prepared-abort-run8/offline-fixture.mjs';
import {authenticateRecovery,validateRequest} from './run-statement-targeted-recovery.mjs';
import {reviewedPreparedAbort8,reviewedAbort7,reviewedAbort6,reviewedAbort,reviewedSource,verifyPreparedAbortArtifactBytes} from './verify-statement-pre-provider-abort.mjs';
const path=process.argv[2];if(!path||process.argv.length!==3)throw Error('Provide the exact reviewed run8 artifact ZIP path');
const zip=readFileSync(path);verifyPreparedAbortArtifactBytes(zip);
const f=preparedAbortFixture(),request=preparedAbortRequest(),artifactReads=[];
validateRequest(request,Date.parse('2026-10-17T08:01:00Z'));
const readArtifact=id=>{artifactReads.push(id);assert.equal(id,reviewedPreparedAbort8.artifact_id);return zip;};
const result=authenticateRecovery(request,f.context,f.api,f.readLog,readArtifact);
assert.equal(result.run.id,reviewedSource.run_id);assert.equal(result.run.conclusion,'failure');
assert.equal(result.artifact.id,reviewedSource.artifact_id);assert.equal(result.preparedAbort.id,reviewedPreparedAbort8.run_id);
assert.deepEqual(result.aborts.map(run=>run.id),[reviewedPreparedAbort8.run_id,reviewedAbort7.run_id,reviewedAbort6.run_id,reviewedAbort.run_id]);
assert.deepEqual(f.logCalls,[reviewedPreparedAbort8.job_id,reviewedAbort7.job_id,reviewedAbort6.job_id,reviewedAbort.job_id]);
assert.deepEqual(artifactReads,[reviewedPreparedAbort8.artifact_id]);
for(const identity of [reviewedPreparedAbort8,reviewedAbort7,reviewedAbort6,reviewedAbort]){
  for(const suffix of ['', '/attempts/1','/artifacts?per_page=100','/attempts/1/jobs?per_page=100'])
    assert.ok(f.calls.includes(`${f.apiRoot}/actions/runs/${identity.run_id}${suffix}`));
}
// The original source interval stays bounded by abort5, not prepared abort8.
f.endpoints[`${f.apiRoot}/actions/runs/${reviewedSource.run_id}/artifacts?per_page=100`].artifacts[0].created_at='2026-10-17T07:00:00Z';
assert.throws(()=>authenticateRecovery(request,f.context,f.api,f.readLog,readArtifact),/prior attempt interval/);
// Revalidation rehashes the actual bytes; a prior authentic read is not cached approval.
const edited=Buffer.from(zip);edited[edited.length-1]^=1;
assert.throws(()=>authenticateRecovery(request,f.context,f.api,f.readLog,()=>edited),/artifact bytes/);
// A genuine run8 ZIP never excuses any changed historical proof. Exercise each
// old run and its exact log/job/artifact/request independently after byte proof.
let historicalNegatives=0;
for(const identity of [reviewedAbort7,reviewedAbort6,reviewedAbort]){
  const prefix=`repos/kusennjp1-ai/screener/actions/runs/${identity.run_id}`;
  const changes=[
    f=>f.endpoints[prefix].run_attempt=2,
    f=>f.endpoints[prefix+'/attempts/1'].status='in_progress',
    f=>f.endpoints[prefix+'/attempts/1/jobs?per_page=100'].jobs[0].steps[7].conclusion='success',
    f=>f.endpoints[prefix+'/artifacts?per_page=100']={total_count:1,artifacts:[{id:1}]},
    f=>f.endpoints[`repos/kusennjp1-ai/screener/contents/.github/targeted-financial-recovery/request.json?ref=${identity.head_sha}`].content=Buffer.from('{}').toString('base64'),
  ];
  for(const change of changes){const altered=preparedAbortFixture();change(altered);
    assert.throws(()=>authenticateRecovery(request,altered.context,altered.api,altered.readLog,readArtifact));historicalNegatives++;
  }
  const altered=preparedAbortFixture();
  assert.throws(()=>authenticateRecovery(request,altered.context,altered.api,id=>id===identity.job_id?Buffer.alloc(0):altered.readLog(id),readArtifact),/log/);
  historicalNegatives++;
}
console.log(JSON.stringify({passed:true,run:9,prepared_abort:8,source:4,artifact_bytes:zip.length,
  artifact_sha256:reviewedPreparedAbort8.artifact_sha256,historical_negatives:historicalNegatives,remote_calls:0,provider_calls:0}));
