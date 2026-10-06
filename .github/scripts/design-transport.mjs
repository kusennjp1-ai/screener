// Measure the current ordinary Design build in the same packed representation
// used by publication. This preview carries no release or financial authority.
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inventoryDigest,sha256,uiInventory} from './publication-state.mjs';
import {packPublication,previewPublication,transportCapable,validateTransportPreview} from './static-transport-publication.mjs';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;

export async function prepareDesignTransport({dist,provenancePath,repoRoot=process.cwd(),frontendRoot=join(repoRoot,'frontend'),expectedSha=process.env.GITHUB_SHA}) {
  repoRoot=resolve(repoRoot);dist=resolve(dist);provenancePath=resolve(provenancePath);
  if(dist!==join(repoRoot,'frontend/dist'))throw Error('Only the current Design dist can be packed; the baseline stays unchanged');
  for(const path of [dist,join(dist,'static-data')]){
    const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Design packing requires a real directory; move the static data tree before packing');
  }
  if(!transportCapable(dist))throw Error('Current Design build lacks its captured transport capability marker');
  if(existsSync(join(dist,'publication.json')))throw Error('Design transport must be prepared before measurement, exactly once');
  const revision=execFileSync('git',['-C',repoRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(!sha(expectedSha)||revision!==expectedSha)throw Error('Design transport must bind the exact current tested checkout');
  const stat=lstatSync(provenancePath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw Error('Invalid bounded Design input provenance');
  const provenanceBytes=readFileSync(provenancePath),state=JSON.parse(provenanceBytes);
  if(state.decision?.mode!=='design'||state.sourceSha!==revision||state.controllerSha!==revision||state.activation||state.correction||state.carry
    ||!positive(state.source?.artifact?.id)||!/^sha256:[a-f0-9]{64}$/.test(state.source.artifact.digest||'')
    ||!positive(state.source.runId)||!positive(state.source.attempt)||!hash(state.source.manifestHash))throw Error('Normal Design requires its exact checked input provenance');
  const manifestBytes=readFileSync(join(dist,'static-data/manifest.json')),manifest=JSON.parse(manifestBytes);
  const generation=manifest.financial_generation??null,active=state.live?.financialRelease,liveReceipt=state.live?.receipt;
  let lineage=null;
  if(generation!==null||active){
    // After activation, design-prepare returns candidate=false for the same
    // request and plan(true) still does not create a carry. A fresh raw input
    // on that future UI route remains blocked until explicit carry validation
    // is implemented; this transport helper cannot manufacture the generation.
    if(!hash(generation)||!active||generation!==active.financial_generation||generation!==liveReceipt?.financial_generation
      ||!hash(active.lineage_sha256)||active.lineage_sha256!==liveReceipt?.financial_lineage_sha256)throw Error('Normal Design lacks the active financial generation; explicit carry validation is required');
    lineage=active.lineage_sha256;
  }
  const publication=previewPublication({uiSha:revision,uiDigest:inventoryDigest(uiInventory(dist)),manifestSha256:sha256(manifestBytes)});
  await packPublication({root:dist,frontendRoot,publication,bindings:{sourceCommit:revision,appCommit:revision,candidateId:sha256(provenanceBytes),financialGeneration:generation,financialLineageSha256:lineage}});
  if(sha256(readFileSync(provenancePath))!==sha256(provenanceBytes))throw Error('Design input provenance changed during packing');
  validateTransportPreview(publication);
  return {schema:'packed-design-preview-v1',publication_authority:'none',ui_sha:revision,input_provenance_sha256:sha256(provenanceBytes),
    logical_data_inventory_sha256:publication.transport.logical_data_inventory_sha256,physical_inventory_sha256:publication.transport.physical_inventory_sha256,generation:publication.transport.root.generation};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==4){console.error('Expected design-transport.mjs CURRENT_DIST DESIGN_INPUT_PROVENANCE');process.exitCode=1;}
  else prepareDesignTransport({dist:process.argv[2],provenancePath:process.argv[3]}).then(result=>console.log(JSON.stringify(result)),error=>{console.error(error.stack||error);process.exitCode=1;});
}
