// Measure the current Design build in the same packed representation
// used by publication. This preview carries no release or financial authority.
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {dataInventoryDigest,inventoryDigest,sha256,uiInventory} from './publication-state.mjs';
import {canonicalPublication,packPublication,previewPublication,transportCapable,validateTransportPreview} from './static-transport-publication.mjs';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const carryPreviewSchema='design-financial-carry-preview-v1';

function assertCarryBinding(record,revision,generation,logicalDigest) {
  if(record.schema!==carryPreviewSchema||record.publication_authority!=='none'||record.financial_admission!==false
    ||record.ui_sha!==revision||!sha(record.baseline_sha)||!hash(record.source_financial_generation)
    ||!hash(record.financial_generation)||record.financial_generation!==generation||!hash(record.financial_lineage_sha256)
    ||record.logical_data_inventory_sha256!==logicalDigest)throw Error('Verified Design carry transport binding changed');
}

function comparisonInventory(baselineRoot,dist) {
  if(typeof baselineRoot!=='string'||!baselineRoot.trim())throw Error('Verified Design carry requires DESIGN_COMPARISON_BASELINE');
  baselineRoot=resolve(baselineRoot);
  for(const path of [baselineRoot,join(baselineRoot,'static-data')]){
    const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Design comparison baseline must contain a real raw logical data tree');
  }
  if(realpathSync(baselineRoot)===realpathSync(dist)||existsSync(join(baselineRoot,'static-data/_transport')))throw Error('Design comparison baseline must be a separate raw logical data tree');
  return {root:baselineRoot,digest:dataInventoryDigest(baselineRoot)};
}

export async function prepareDesignTransport({dist,provenancePath,repoRoot=process.cwd(),frontendRoot=join(repoRoot,'frontend'),expectedSha=process.env.GITHUB_SHA,baselineRoot=process.env.DESIGN_COMPARISON_BASELINE}) {
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
  const manifestBytes=readFileSync(join(dist,'static-data/manifest.json')),manifest=JSON.parse(manifestBytes);
  const generation=manifest.financial_generation??null,active=state.live?.financialRelease,liveReceipt=state.live?.receipt;
  let lineage=null,comparison=null,verifiedCarry=null;
  const logicalDigest=dataInventoryDigest(dist);
  if(state.schema===carryPreviewSchema){
    comparison=comparisonInventory(baselineRoot,dist);
    if(comparison.digest!==logicalDigest)throw Error('Design current and comparison logical data inventories differ');
    assertCarryBinding(state,revision,generation,logicalDigest);
    // Only the explicit closed preview contract may enter this independent
    // evidence replay. Ordinary Design never manufactures a carry generation.
    const {verifyDesignCarryPreview}=await import('./design-financial-carry.mjs');
    verifiedCarry=await verifyDesignCarryPreview({provenancePath,root:dist,baselineRoot:comparison.root,repoRoot,frontendRoot});
    assertCarryBinding(verifiedCarry,revision,generation,logicalDigest);
    lineage=verifiedCarry.financial_lineage_sha256;
  }else{
    if(state.decision?.mode!=='design'||state.sourceSha!==revision||state.controllerSha!==revision||state.activation||state.correction||state.carry
      ||Object.hasOwn(state,'schema')||Object.hasOwn(state,'schema_version')||Object.hasOwn(state,'publication_authority')||Object.hasOwn(state,'financial_admission')
      ||!positive(state.source?.artifact?.id)||!/^sha256:[a-f0-9]{64}$/.test(state.source.artifact.digest||'')
      ||!positive(state.source.runId)||!positive(state.source.attempt)||!hash(state.source.manifestHash))throw Error('Normal Design requires its exact checked input provenance');
    if(generation!==null||active){
      if(!hash(generation)||!active||generation!==active.financial_generation||generation!==liveReceipt?.financial_generation
        ||!hash(active.lineage_sha256)||active.lineage_sha256!==liveReceipt?.financial_lineage_sha256)throw Error('Normal Design lacks the active financial generation; explicit carry validation is required');
      lineage=active.lineage_sha256;
    }
  }
  if(sha256(readFileSync(provenancePath))!==sha256(provenanceBytes)||dataInventoryDigest(dist)!==logicalDigest
    ||sha256(readFileSync(join(dist,'static-data/manifest.json')))!==sha256(manifestBytes))throw Error('Design input changed during verification');
  const publication=previewPublication({uiSha:revision,uiDigest:inventoryDigest(uiInventory(dist)),manifestSha256:sha256(manifestBytes)});
  await packPublication({root:dist,frontendRoot,publication,bindings:{sourceCommit:revision,appCommit:revision,candidateId:sha256(provenanceBytes),financialGeneration:generation,financialLineageSha256:lineage}});
  if(sha256(readFileSync(provenancePath))!==sha256(provenanceBytes))throw Error('Design input provenance changed during packing');
  validateTransportPreview(publication);
  const temporary=mkdtempSync(join(dirname(dist),'.design-transport-roundtrip-'));
  try{
    const canonical=await canonicalPublication({root:dist,frontendRoot,publication,restore:join(temporary,'logical')});
    if(publication.transport.logical_data_inventory_sha256!==logicalDigest||dataInventoryDigest(canonical)!==logicalDigest)throw Error('Packed Design round-trip logical data inventory changed');
    if(comparison&&(dataInventoryDigest(comparison.root)!==comparison.digest||dataInventoryDigest(canonical)!==comparison.digest))throw Error('Packed Design differs from the raw comparison baseline');
    // Replaying at the real post-pack clock also catches expiry transitions
    // while encoding. Nothing in this branch grants publication authority.
    if(verifiedCarry){
      const {verifyDesignCarryPreview}=await import('./design-financial-carry.mjs');
      const current=await verifyDesignCarryPreview({provenancePath,root:canonical,baselineRoot:comparison.root,repoRoot,frontendRoot});
      if(JSON.stringify(current)!==JSON.stringify(verifiedCarry))throw Error('Design carry provenance changed during packing');
    }
  }finally{rmSync(temporary,{recursive:true,force:true});}
  if(sha256(readFileSync(provenancePath))!==sha256(provenanceBytes))throw Error('Design input provenance changed during round-trip verification');
  return {schema:'packed-design-preview-v1',publication_authority:'none',ui_sha:revision,input_provenance_sha256:sha256(provenanceBytes),
    logical_data_inventory_sha256:publication.transport.logical_data_inventory_sha256,physical_inventory_sha256:publication.transport.physical_inventory_sha256,generation:publication.transport.root.generation};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==4){console.error('Expected design-transport.mjs CURRENT_DIST DESIGN_INPUT_PROVENANCE');process.exitCode=1;}
  else prepareDesignTransport({dist:process.argv[2],provenancePath:process.argv[3]}).then(result=>console.log(JSON.stringify(result)),error=>{console.error(error.stack||error);process.exitCode=1;});
}
