// Exact diagnostic continuation. This retrieval harness never becomes the
// checkpoint's executable runtime or its synthetic certification authority.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ACTUAL} from './fixtures/postcapture-pages-rehearsal.mjs';
import {checkoutIdentity,measureRuntimeUsage,pinnedCarryContinuation,pinnedContract,requiredGitDependencies,
  restoreRehearsalInputs,sha256,verifyPreservedControls,verifyRehearsalInputs,verifyStableEvidence} from './restore-postcapture-pages-rehearsal.mjs';

const harnessRoot=fileURLToPath(new URL('../../',import.meta.url));
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024}).trim();
const read=path=>JSON.parse(readFileSync(path));
const write=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');

export function verifyCheckoutBytes(root) {
  assert.equal(git(root,'status','--porcelain'),'','Pinned executable checkout must be clean');
  const commit=git(root,'rev-parse','HEAD'),tree=git(root,'rev-parse','HEAD^{tree}');
  const inventory=git(root,'ls-tree','-r',commit).split('\n');
  for(const row of inventory) {
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    assert.ok(match,'Pinned executable tree contains an unsupported member');
    const [,mode,expected,path]=match;
    assert.ok(!path.startsWith('/') && !path.split('/').some(p=>['','.','..'].includes(p)),'Unsafe executable path');
    const target=join(root,path),info=lstatSync(target);
    assert.ok(info.isFile()&&!info.isSymbolicLink(),'Pinned executable member is not a regular file');
    assert.equal(Boolean(info.mode&0o111),mode==='100755','Pinned executable mode changed');
    const bytes=readFileSync(target);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),expected,`Pinned executable bytes changed: ${path}`);
  }
  return {commit,tree,tracked_files:inventory.length};
}

export async function verifyFrozenRuntime(runtimeRoot) {
  assert.notEqual(resolve(runtimeRoot),resolve(harnessRoot),'Runtime and retrieval harness must be separate checkouts');
  const pin=pinnedCarryContinuation().runtime,bytes=verifyCheckoutBytes(runtimeRoot);
  assert.equal(bytes.commit,pin.commit,'Literal checkpoint runtime commit changed');
  assert.equal(bytes.tree,pin.tree,'Literal checkpoint runtime tree changed');
  // Import only after every tracked executable byte has matched the pinned Git
  // tree. No copied/rewritten fixture and no environment-based trust override.
  const runtime=await import(pathToFileURL(join(resolve(runtimeRoot),'.github/scripts/fixtures/postcapture-rehearsal-checkpoint.mjs')).href);
  assert.deepEqual(runtime.runtimeIdentity(runtimeRoot),pin,'Literal checkpoint protected runtime changed');
  verifyPreservedControls(runtimeRoot);
  return {runtime,identity:pin,tracked_files:bytes.tracked_files};
}

export function importExactGitObjects(runtimeRoot,evidence) {
  const c=pinnedContract(),objects=[];
  for(const [head,tree] of Object.entries(requiredGitDependencies(c))) {
    assert.equal(evidence.responses[`GET repos/${c.repository}/git/commits/${head}`]?.tree?.sha,tree,'Missing authenticated runtime Git object');
    assert.equal(git(harnessRoot,'show','-s','--format=%H %T',head),`${head} ${tree}`,'Harness Git object changed');
    try {git(runtimeRoot,'cat-file','-e',`${head}^{commit}`);} catch {
      // Local object transfer only. The frozen runtime HEAD and worktree stay put.
      git(runtimeRoot,'fetch','--no-tags',harnessRoot,head);
    }
    assert.equal(git(runtimeRoot,'show','-s','--format=%H %T',head),`${head} ${tree}`,'Frozen runtime Git object changed');
    objects.push({head_sha:head,tree_sha:tree});
  }
  return objects;
}

function context() {
  return {repository:process.env.GITHUB_REPOSITORY,branch:process.env.GITHUB_REF_NAME,event:process.env.GITHUB_EVENT_NAME,
    id:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT),sha:process.env.GITHUB_SHA,stage:'carry-continuation'};
}

async function main() {
  const [command,directory,root,...extra]=process.argv.slice(2);
  assert.ok(['restore','recheck'].includes(command)&&directory&&root&&!extra.length,
    'Usage: continue-postcapture-pages-carry.mjs restore|recheck INPUT_DIRECTORY PINNED_RUNTIME_CHECKOUT');
  const output=resolve(directory),runtimeRoot=resolve(root),c=pinnedCarryContinuation();
  let verified=await verifyFrozenRuntime(runtimeRoot);
  const caller=context();
  if(command==='restore') await restoreRehearsalInputs(output,caller,{runtime:()=>measureRuntimeUsage(execFileSync,{runtimeRoot})});
  const evidencePath=join(output,'api-evidence.json'),before=read(evidencePath);
  // The final fresh source/main/expiry/deployment observation follows all
  // downloads and extraction. Only this exact after-evidence reaches runtime.
  const after=verifyRehearsalInputs(caller);verifyStableEvidence(before,after);
  const objects=importExactGitObjects(runtimeRoot,after);
  verified=await verifyFrozenRuntime(runtimeRoot);
  const checkpoint=verified.runtime.verifyPublicationCheckpoint({directory:join(output,'retained-publication'),
    checkpointSha256:c.checkpoint.manifest_sha256,runtimeRoot,
    actualInputs:Object.fromEntries(Object.keys(pinnedContract().inputs).map(role=>[role,ACTUAL[role]]))});
  assert.deepEqual(checkpoint.files,c.checkpoint.files,'Retained publication member identity changed');
  write(evidencePath,after);
  const evidenceBytes=readFileSync(evidencePath),harness=checkoutIdentity();
  assert.equal(harness.clean,true,'Retrieval harness changed before offline execution');
  const provenance={schema_version:'postcapture-pages-carry-continuation-provenance-v1',publication_authority:false,provider_work:false,
    harness:{commit:harness.head,tree:harness.tree,caller:after.caller},runtime:c.runtime,runtime_tracked_files:verified.tracked_files,
    checkpoint:{artifact_id:c.checkpoint.artifact_id,run_id:c.checkpoint.run_id,run_attempt:1,artifact_sha256:c.checkpoint.artifact_sha256,
      manifest_sha256:c.checkpoint.manifest_sha256,files:checkpoint.files},runtime_git_objects:objects,
    api_evidence_sha256:sha256(evidenceBytes),observed_at:after.observed_at,stage:'carry',fresh_boundary:command};
  write(join(output,'carry-continuation-provenance.json'),provenance);
  console.log(JSON.stringify(provenance));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
