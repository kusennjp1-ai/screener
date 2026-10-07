// Artifact-only, bounded local extension. This is never a source selector,
// provider call, publication verifier, financial carry or activation mechanism.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,statfsSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
import {completeCurrentPriceQuarantine} from './complete-retained-price-quarantine.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex'),cap=64*1024*1024;
function raw(path){path=resolve(path);assert.equal(realpathSync(path),path,'Linked residual input');assert(lstatSync(path).isFile()&&lstatSync(path).size<=cap,'Residual input exceeds bounded file limit');return readFileSync(path);}
export function prepareResidualFromFiles({reviewPath,preparedPath,planPath,candidateSourcePath,candidateResearchPath,candidateChartIndexPath,candidateChartsDirectory,output}){
  const reviewRaw=raw(reviewPath),review=JSON.parse(reviewRaw),bindings={};
  function read(name,path){const bytes=raw(path),binding={bytes:bytes.length,sha256:sha(bytes)};assert.deepEqual(binding,review.input_files?.[name],`Residual exact input differs: ${name}`);bindings[name]=binding;return JSON.parse(bytes);}
  const prepared=read('prepared',preparedPath),plan=read('plan',planPath),candidateSource=read('candidate_source',candidateSourcePath),candidateRows=decodeResearchIndex(read('candidate_research',candidateResearchPath)).rows,candidateChartIndex=read('candidate_chart_index',candidateChartIndexPath),candidateCharts={};
  for(const item of review.symbols)if(item.observation_date!==null){assert(/^[A-Z0-9.-]+$/.test(item.symbol),'Unsafe residual chart filename');candidateCharts[item.symbol]=read(`chart:${item.symbol}`,join(candidateChartsDirectory,item.symbol+'.json'));}
  assert.deepEqual(Object.keys(bindings).sort(),Object.keys(review.input_files).sort(),'Unconsumed residual input binding');
  const compiled=completeCurrentPriceQuarantine({prepared,plan,candidateSource,candidateRows,candidateChartIndex,candidateCharts,review});
  const content={'compiler-inputs.json':Buffer.from(JSON.stringify(compiled)),'residual-review.json':reviewRaw};
  const receipt={schema_version:'retained-price-residual-preparation-v1',publication_authority:false,ready_to_publish:false,full_compiler_passed:false,
    scope:'unpublished_local_preparation_only',target_as_of_date:compiled.target_as_of_date,review_sha256:sha(reviewRaw),input_files:bindings,
    rows:compiled.rows.length,affected_research_rows:compiled.patches.filter(p=>p.row).length+compiled.row_quarantines.length,
    restored_prior_histories:compiled.patches.filter(p=>p.history_origin!=='candidate_current_quarantine').length,
    restored_research_rows:compiled.patches.filter(p=>p.row&&p.history_origin!=='candidate_current_quarantine').length,
    stale_candidate_histories:compiled.residual_current_review.stale_histories,undated_quarantines:compiled.row_quarantines.length,
    residual_before:compiled.residual_current_review.residual_before,residual_after:compiled.residual_current_review.residual_after,
    ...(compiled.home_history?{retained_home_histories:1,retained_home_patch_sha256:compiled.home_history.patch_sha256}:{}),
    coverage:compiled.coverage,files:Object.fromEntries(Object.entries(content).map(([path,bytes])=>[path,{bytes:bytes.length,sha256:sha(bytes)}])),
    pending:['full 5901-row graph/compiler/public-alias replay','current renewed live predecessor carry and expiry','same approved UI/browser proof','full transport/Pages proof','reviewed new producer and restore admission','separate publication authorization']};
  content['receipt.json']=Buffer.from(JSON.stringify(receipt));const size=Object.values(content).reduce((total,bytes)=>total+bytes.length,0);assert(size<=cap,'Residual output exceeds 64 MiB');
  output=resolve(output);assert(!existsSync(output),'Residual output already exists');mkdirSync(dirname(output),{recursive:true});assert.equal(realpathSync(dirname(output)),dirname(output),'Linked output parent');const disk=statfsSync(dirname(output));assert(disk.bavail*disk.bsize>size+cap,'Insufficient bounded output disk');
  const staging=mkdtempSync(join(dirname(output),'.retained-residual-'));try{for(const [path,bytes]of Object.entries(content))writeFileSync(join(staging,path),bytes,{flag:'wx'});assert(!existsSync(output));renameSync(staging,output);}catch(error){rmSync(staging,{recursive:true,force:true});throw error;}
  return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const keys={'--review':'reviewPath','--prepared':'preparedPath','--plan':'planPath','--source':'candidateSourcePath','--research':'candidateResearchPath','--chart-index':'candidateChartIndexPath','--charts':'candidateChartsDirectory','--output':'output'},args=process.argv.slice(2),options={};assert.equal(args.length,Object.keys(keys).length*2,'Expected eight explicit path options');
  for(let i=0;i<args.length;i+=2){assert(keys[args[i]]&&!Object.hasOwn(options,keys[args[i]]),'Unknown/duplicate option');options[keys[args[i]]]=args[i+1];}
  console.log(JSON.stringify(prepareResidualFromFiles(options)));
}
