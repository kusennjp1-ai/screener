// A normal advancing price build owns the baseline. Carry may change only
// explicitly owned financial outputs and the independently replayed first daily
// observation; it never relaxes the strict same-price correction comparator.
import {cpSync,existsSync,linkSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {dataFiles,inventoryDigest,safePath,sha256} from './publication-state.mjs';
import {compareCorrectionData,dataInventory,digest} from './financial-correction.mjs';

function linkTree(source,destination){
  mkdirSync(destination,{recursive:true});
  for(const entry of readdirSync(source,{withFileTypes:true})){
    if(!safePath(entry.name))throw Error('Unsafe carry comparison path');
    if(entry.isDirectory())linkTree(join(source,entry.name),join(destination,entry.name));
    else if(entry.isFile())linkSync(join(source,entry.name),join(destination,entry.name));
    else throw Error('Linked or special carry comparison input');
  }
}
const read=path=>JSON.parse(readFileSync(path,'utf8'));

export async function verifyCarriedBundle({baselineRoot,root,frontendRoot,carry,evaluatedAt=Date.now(),excludePaths=[]}) {
  if(!Array.isArray(excludePaths)||excludePaths.some(path=>!/^static-data\/financial-corrections\/(?:source-projection|source-base|carry-projection|release)-[a-f0-9]{64}\.json$/.test(path)))throw Error('Unlisted carry audit exclusion');
  const helper=await import(pathToFileURL(join(frontendRoot,'tools/financial-generation-carry.mjs')).href);
  const compatibility=await helper.verifyCarryCompatibility({root:join(root,'static-data'),carry,evaluatedAt});
  const catalogPath='static-data/candidate-history/index.json',beforePath=join(baselineRoot,catalogPath);
  const previous=JSON.parse(readFileSync(beforePath,'utf8'));
  const manifest=JSON.parse(readFileSync(join(root,'static-data/manifest.json'),'utf8'));
  const workbench=JSON.parse(readFileSync(join(root,'static-data',manifest.markets.US.assets.workbench.path),'utf8'));
  const {HISTORY_RETENTION_SESSIONS}=await import(pathToFileURL(join(frontendRoot,'src/static/candidatePerformance.js')).href);
  const expected=structuredClone(previous);
  const newDay=!expected.snapshots.some(item=>item.as_of===workbench.as_of);
  if(newDay)expected.snapshots.push(workbench.current_snapshot);
  expected.snapshots=expected.snapshots.sort((a,b)=>a.as_of.localeCompare(b.as_of)).slice(-HISTORY_RETENTION_SESSIONS);
  if(readFileSync(join(root,catalogPath),'utf8')!==JSON.stringify(expected))throw Error('Carried daily history is not its exact first observation');
  const checked=mkdtempSync(join(tmpdir(),'verified-financial-carry-'));
  try {
    linkTree(join(root,'static-data'),join(checked,'static-data'));
    for(const file of dataFiles)linkSync(join(root,file),join(checked,file));
    for(const path of excludePaths)if(!existsSync(join(baselineRoot,path)))rmSync(join(checked,path),{force:true});
    unlinkSync(join(checked,catalogPath));cpSync(beforePath,join(checked,catalogPath));
    const transitions=[];
    if(newDay){
      // Neither baseline's current snapshot nor its current-day changes were
      // ever published. Verify both derivations, then permit exactly today's
      // financial-dependent transition and first-current references. The prior
      // comparison basis and every historical snapshot remain untouched.
      const beforeManifest=read(join(baselineRoot,'static-data/manifest.json'));
      const beforeWorkbench=read(join(baselineRoot,'static-data',beforeManifest.markets.US.assets.workbench.path));
      const {verifyWorkbenchComparison}=await import(pathToFileURL(join(frontendRoot,'tools/workbench-comparison.mjs')).href);
      await verifyWorkbenchComparison({root:join(baselineRoot,'static-data'),workbench:beforeWorkbench});
      const {validateWorkbenchDetails}=await import(pathToFileURL(join(frontendRoot,'src/static/workbenchSummary.js')).href);
      validateWorkbenchDetails(beforeWorkbench,read(join(baselineRoot,'static-data',beforeManifest.markets.US.assets.workbench_summary.path)));
      for(const key of ['workbench','workbench_summary']){
        const beforeRef=beforeManifest.markets.US.assets[key],afterRef=manifest.markets.US.assets[key];
        const beforeBytes=readFileSync(join(baselineRoot,'static-data',beforeRef.path)),afterBytes=readFileSync(join(root,'static-data',afterRef.path));
        if(sha256(beforeBytes)!==beforeRef.sha256||sha256(afterBytes)!==afterRef.sha256)throw Error('Carry workbench content address changed');
        const before=JSON.parse(beforeBytes),after=JSON.parse(afterBytes);
        transitions.push({asset:key,before:beforeRef.sha256,after:afterRef.sha256,fields:['changes','daily_changes_snapshot','comparison_basis.saved_first']});
        after.changes=before.changes;after.daily_changes_snapshot=before.daily_changes_snapshot;
        after.comparison_basis.saved_first=before.comparison_basis.saved_first;
        const path=join(checked,'static-data',afterRef.path);unlinkSync(path);writeFileSync(path,JSON.stringify(after));
      }
    }
    const equality=await compareCorrectionData(baselineRoot,checked,frontendRoot,carry);
    return {compatibility,equality:{...equality,after_inventory_sha256:inventoryDigest(dataInventory(root,excludePaths.filter(path=>!existsSync(join(baselineRoot,path))))),
      current_day_transition_sha256:digest(transitions)}};
  } finally {rmSync(checked,{recursive:true,force:true});}
}
