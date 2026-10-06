// Same-price renewal does not own performance observations. A daily carry may
// have recorded its first daily catalog entry after exporting its performance
// report; re-exporting now must not invent an extra report cohort or observation.
import {cpSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {digest} from './financial-correction.mjs';
import {inventoryDigest,safePath,sha256} from './publication-state.mjs';

const reportName=/^candidate-performance-[a-f0-9]{16}\.json$/;
const historyName='candidate-performance-history';
function inventory(root){
  const files={},data=join(root,'static-data');
  if(!lstatSync(data).isDirectory()||lstatSync(data).isSymbolicLink())throw Error('Linked renewal performance data root');
  const visit=(path,relative)=>{
    const info=lstatSync(path);
    if(info.isSymbolicLink())throw Error('Linked renewal performance history');
    if(info.isDirectory()){for(const entry of readdirSync(path)){if(!safePath(entry)||entry.includes('/'))throw Error('Unsafe renewal performance history');visit(join(path,entry),`${relative}/${entry}`);}}
    else if(info.isFile()&&info.nlink===1)files[relative]=sha256(readFileSync(path));
    else throw Error('Linked or special renewal performance history');
  };
  for(const name of readdirSync(data))if(name===historyName||reportName.test(name))visit(join(data,name),`static-data/${name}`);
  return files;
}
export function preserveRenewalPriceHistory({predecessor,baseline}){
  predecessor=resolve(predecessor);baseline=resolve(baseline);
  for(const root of [predecessor,baseline]){const info=lstatSync(root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Linked renewal baseline root');}
  predecessor=realpathSync(predecessor);baseline=realpathSync(baseline);
  if(predecessor===baseline||predecessor.startsWith(baseline+sep)||baseline.startsWith(predecessor+sep))throw Error('Renewal predecessor and baseline must be separate trees');
  for(const root of [predecessor,baseline]){const info=lstatSync(join(root,'static-data/manifest.json'));if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('Linked renewal baseline manifest');}
  const priorManifestBytes=readFileSync(join(predecessor,'static-data/manifest.json'));
  const before=JSON.parse(priorManifestBytes),after=JSON.parse(readFileSync(join(baseline,'static-data/manifest.json')));
  if(before.markets?.US?.as_of_date!==after.markets?.US?.as_of_date||!before.markets?.US?.as_of_date)throw Error('Renewal performance preservation changed the price date');
  const original=inventory(predecessor),generated=inventory(baseline),reference=before.markets.US.assets?.candidate_performance;
  if(reference!==undefined){
    if(!reference||Object.keys(reference).sort().join('|')!=='as_of_date|path|sha256'||!reportName.test(reference.path)
      ||typeof reference.sha256!=='string'||!/^[a-f0-9]{64}$/.test(reference.sha256)||reference.as_of_date!==before.markets.US.as_of_date||original[`static-data/${reference.path}`]!==reference.sha256
      ||reference.path!==`candidate-performance-${reference.sha256.slice(0,16)}.json`)throw Error('Renewal original performance descriptor or bytes changed');
  }
  if(!after.markets.US.assets||typeof after.markets.US.assets!=='object'||Array.isArray(after.markets.US.assets))throw Error('Missing compiled renewal asset map');
  const unownedBefore=structuredClone(after);delete unownedBefore.markets.US.assets.candidate_performance;
  for(const name of readdirSync(join(baseline,'static-data')))if(name===historyName||reportName.test(name))rmSync(join(baseline,'static-data',name),{recursive:true,force:true});
  for(const path of Object.keys(original)){mkdirSync(dirname(join(baseline,path)),{recursive:true});cpSync(join(predecessor,path),join(baseline,path));}
  if(reference===undefined)delete after.markets.US.assets.candidate_performance;
  else after.markets.US.assets.candidate_performance=structuredClone(reference);
  writeFileSync(join(baseline,'static-data/manifest.json'),JSON.stringify(after));
  const unownedAfter=structuredClone(after);delete unownedAfter.markets.US.assets.candidate_performance;
  if(digest(unownedBefore)!==digest(unownedAfter)||inventoryDigest(inventory(baseline))!==inventoryDigest(original)
    ||!readFileSync(join(predecessor,'static-data/manifest.json')).equals(priorManifestBytes)||inventoryDigest(inventory(predecessor))!==inventoryDigest(original))throw Error('Renewal published performance preservation failed');
  return {schema_version:'financial-renewal-preserved-price-history-v1',original_inventory_sha256:inventoryDigest(original),generated_inventory_sha256:inventoryDigest(generated),files:Object.keys(original).length};
}
