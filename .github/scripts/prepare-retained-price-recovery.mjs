// Bounded local preparation. No provider, GitHub, build or publication calls.
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,statfsSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {decodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
import {planRetainedPriceRecovery,compileRetainedPriceRecovery,recoveryDigest} from './retained-price-recovery.mjs';
import {prepareRetainedHomeHistory} from './retained-home-history.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const cap=64*1024*1024;
const readJson=path=>JSON.parse(readFileSync(path));
function safeRead(root,path){
  assert(typeof path==='string'&&!path.startsWith('/')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Unsafe extraction path');
  let part=resolve(root);assert(!lstatSync(part).isSymbolicLink(),'Linked extraction root');
  for(const item of path.split('/')){part=join(part,item);assert(!lstatSync(part).isSymbolicLink(),'Linked extraction path');}
  assert(lstatSync(part).isFile()&&lstatSync(part).size<=cap,'Invalid extraction file');return readFileSync(part);
}
function scopedReader(root,expected,expectedReceiptSha256){
  const bytes=safeRead(root,'scoped-extraction-manifest.json');
  assert.equal(hash(bytes),expectedReceiptSha256,'Extraction receipt differs from the independently reviewed bytes');
  const receipt=JSON.parse(bytes);
  assert.equal(receipt.schema_version,'retained-price-scoped-extraction-v1');
  assert.equal(receipt.archive.sha256,expected.sha256);assert.equal(receipt.archive.bytes,expected.bytes);
  assert.equal(receipt.fullSiteVerified,false,'Scoped extraction cannot grant full verification');
  assert(Number.isSafeInteger(receipt.outputCapBytes)&&receipt.outputCapBytes>0&&receipt.outputCapBytes<=cap
    &&receipt.outputBytes<=receipt.outputCapBytes,'Unexpected extraction budget');
  return {receipt,receiptSha256:hash(bytes),read(path,expectedHash){
    const item=receipt.files[path];assert(item,'Unverified requested file');const raw=safeRead(root,path);
    assert.equal(raw.length,item.decodedBytes);assert.equal(hash(raw),item.decodedSha256);
    if(expectedHash)assert.equal(hash(raw),expectedHash);return raw;
  }};
}
export function prepare({reviewPath,priorMetadata,candidateMetadata,priorHistories,sourceManifest,sourceCompanion,output,priorHomeMetadata}){
  const reviewBytes=readFileSync(reviewPath),review=JSON.parse(reviewBytes);
  assert.equal(review.schema_version,'retained-price-recovery-review-inputs-v1');assert.equal(review.publication_authority,false);
  assert.equal(review.mode,'offline_exact_inputs_only');assert.equal(review.constraints.providers,'denied');
  assert.equal(review.constraints.remote_writes,'denied');assert.equal(review.constraints.existing_gates,'unchanged');
  assert.equal(review.expected_recovery.minimum_verification_ratio,.9);
  const pinnedReceipts=review.scoped_extraction_receipts;
  const old=scopedReader(priorMetadata,review.prior,pinnedReceipts.prior_metadata),
    current=scopedReader(candidateMetadata,review.candidate,pinnedReceipts.candidate_metadata),
    history=scopedReader(priorHistories,review.prior,pinnedReceipts.prior_history);
  const priorPublication=JSON.parse(old.read('publication.json',review.prior.publication_sha256));
  assert.equal(priorPublication.run_id,review.prior.run_id);assert.equal(priorPublication.run_attempt,review.prior.run_attempt);
  const priorManifest=JSON.parse(old.read('static-data/manifest.json',review.prior.manifest_sha256));
  assert.equal(priorPublication.data_manifest_sha256,review.prior.manifest_sha256);
  const candidateManifest=current.read('static-data/manifest.json',review.candidate.manifest_sha256);
  assert.equal(JSON.parse(candidateManifest).markets.US.as_of_date,review.target_price_session);
  const priorIndex=decodeResearchIndex(JSON.parse(old.read(review.prior.research_path,review.prior.research_sha256)));
  const candidateIndex=decodeResearchIndex(JSON.parse(current.read(review.candidate.research_path,review.candidate.research_sha256)));
  assert.equal(priorManifest.markets.US.assets.research.path,review.prior.research_path.slice('static-data/'.length));
  const sourceBytes=readFileSync(sourceManifest);assert(sourceBytes.length<cap,'Source metadata exceeds cap');
  assert.equal(hash(sourceBytes),review.candidate.retained_source_json_sha256,'Retained source manifest changed');
  assert(sourceCompanion&&!lstatSync(sourceCompanion).isSymbolicLink()&&lstatSync(sourceCompanion).size===review.candidate.companion_bytes,'Exact companion ZIP required');
  assert.equal(hash(readFileSync(sourceCompanion)),review.candidate.companion_sha256,'Companion ZIP digest mismatch');
  const companionBytes=execFileSync('python3',['-c',`import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.namelist()==['source.json'], 'Unexpected companion members'
 i=z.getinfo('source.json'); assert i.file_size<1048576 and not i.is_dir(), 'Invalid companion member'
 sys.stdout.buffer.write(z.read(i))`,resolve(sourceCompanion)],{maxBuffer:1048576,timeout:10000});
  assert(companionBytes.equals(sourceBytes),'Companion member and retained source bytes differ');
  const candidateSource=JSON.parse(sourceBytes);
  assert.equal(candidateSource.manifest_json,candidateManifest.toString('utf8'),'Companion and archive manifest differ');
  for(const [actual,expected]of [[candidateSource.run_id,review.candidate.run_id],[candidateSource.run_attempt,review.candidate.run_attempt],
    [candidateSource.source_sha,review.candidate.head_sha],[candidateSource.artifact_name,review.candidate.artifact_name],
    [candidateSource.price_observations_sha256,review.candidate.price_observations_sha256]])assert.equal(actual,expected,'Candidate provenance differs from review');
  const input={priorPublication,priorRows:priorIndex.rows,candidateRows:candidateIndex.rows,candidateSource,
    priorChartIndex:JSON.parse(old.read(review.prior.chart_index_path)),
    candidateChartIndex:JSON.parse(current.read(review.candidate.chart_index_path)),rowQuarantines:review.quarantine_adjustments ?? []};
  if(review.home_history){
    assert(priorHomeMetadata,'Exact prior home extraction required');
    const home=review.home_history,priorHome=scopedReader(priorHomeMetadata,review.prior,pinnedReceipts.prior_home);
    input.homeHistory=prepareRetainedHomeHistory({priorPublication,candidateSource,
      priorHomeBytes:priorHome.read('static-data/'+home.prior_path,home.prior_sha256),priorHomeSha256:home.prior_sha256,
      candidateHomeBytes:current.read('static-data/'+home.candidate_path,home.candidate_sha256),candidateHomeSha256:home.candidate_sha256,
      priorHomePath:home.prior_path,candidateHomePath:home.candidate_path});
  }else assert(!priorHomeMetadata,'Unreviewed home extraction');
  const plan=planRetainedPriceRecovery(input),expected=review.expected_recovery;
  assert.equal(plan.target_as_of_date,review.target_price_session);
  if(expected.required_symbols_sha256)assert.equal(recoveryDigest(plan.required_symbols),expected.required_symbols_sha256,'Protected denominator identities changed');
  if(expected.known_regression)assert.deepEqual(plan.original_regressions,[{key:JSON.stringify(['US','chart',expected.known_regression.symbol]),previous:expected.known_regression.prior,observed:expected.known_regression.candidate}],'Exact reviewed regression changed');
  if(expected.retained_home_histories!==undefined)assert.equal(plan.home_history?1:0,expected.retained_home_histories,'Exact home-history scope changed');
  for(const [actual,want]of [[input.priorRows.length,expected.prior_public_rows],[input.candidateRows.length,expected.candidate_public_rows],
    [plan.previous_required_symbols.length,review.prior.required_symbol_count],[plan.required_symbols.length,expected.required_union],
    [plan.original_coverage.verified,expected.conservative_verified],[plan.retained.length,expected.actual_recoverable_histories],
    [plan.retained.filter(x=>x.prior_detail_path).length,expected.restored_research_rows ?? expected.affected_research_rows],
    [plan.row_quarantines.length,expected.quarantined_research_rows ?? 0],
    [plan.retained.filter(x=>!x.prior_detail_path).length,expected.chart_index_only_histories]])assert.equal(actual,want,'Exact recovery count changed');
  assert.deepEqual(plan.ledger_only_absences.map(key=>JSON.parse(key)[2]).sort(),[...expected.ledger_only_absences].sort());
  const priorCharts={},priorDetails={},wanted=[];
  for(const item of plan.retained){
    const path='static-data/'+item.prior_chart_path;wanted.push(path);priorCharts[item.symbol]=JSON.parse(history.read(path));
    if(item.prior_detail_path){const detail='static-data/'+item.prior_detail_path;wanted.push(detail);priorDetails[item.symbol]=JSON.parse(history.read(detail));}
  }
  assert.deepEqual([...history.receipt.request].sort(),wanted.sort(),'Unexpected historical extraction scope');
  const compiled=compileRetainedPriceRecovery({...input,plan,priorCharts,priorDetails});
  const restoredResearchRows=compiled.patches.filter(p=>p.row).length,quarantinedResearchRows=compiled.row_quarantines.length;
  const totalUnknownRows=restoredResearchRows+quarantinedResearchRows;
  assert.equal(totalUnknownRows,expected.total_unknown_rows ?? expected.affected_research_rows,'Exact unknown-row count changed');
  assert.deepEqual(compiled.coverage,{total:expected.required_union,verified:expected.conservative_verified,minimum_target:.9},'Exact coverage changed');
  const contents={'plan.json':JSON.stringify(plan),'compiler-inputs.json':JSON.stringify(compiled)};
  const receipt={schema_version:'retained-price-recovery-preparation-v1',publication_authority:false,ready_to_publish:false,
    target_price_session:review.target_price_session,catch_up_only:review.catch_up_only,review_sha256:hash(reviewBytes),
    archive_bindings:{prior:{sha256:review.prior.sha256,bytes:review.prior.bytes},candidate:{sha256:review.candidate.sha256,bytes:review.candidate.bytes}},
    extraction_receipts:{prior_metadata:old.receiptSha256,candidate_metadata:current.receiptSha256,prior_history:history.receiptSha256},
    retained_source_json_sha256:hash(sourceBytes),companion_archive_verified:true,
    actual_histories:compiled.patches.length,research_rows:totalUnknownRows,
    restored_research_rows:restoredResearchRows,quarantined_research_rows:quarantinedResearchRows,total_unknown_rows:totalUnknownRows,
    quarantine_adjustments:compiled.row_quarantines.map(({symbol,reason,observation_date,prior_row_sha256,candidate_row_sha256})=>
      ({symbol,reason,observation_date,prior_row_sha256,candidate_row_sha256})),
    recovery_summary:`${compiled.patches.length} retained histories; ${restoredResearchRows} restored research rows; ${quarantinedResearchRows} row-only quarantines without charts or observation dates; ${totalUnknownRows} current-unknown research rows`,
    chart_index_only:compiled.patches.filter(p=>!p.row).length,ledger_only_absences:compiled.ledger_only_absences,
    ...(compiled.home_history?{retained_home_histories:1,home_history_sha256:hash(JSON.stringify(compiled.home_history))}:{}),
    coverage:compiled.coverage,plan_sha256:plan.plan_sha256,
    files:Object.fromEntries(Object.entries(contents).map(([path,bytes])=>[path,{bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}])),
    pending:['complete target graph materialization','full compiler/cross-view replay',
      'financial source carry and expiry checks','same approved UI binding','full payload/transport verification','separately authorized publication']};
  contents['receipt.json']=JSON.stringify(receipt);
  const total=Object.values(contents).reduce((n,b)=>n+Buffer.byteLength(b),0);assert(total<=cap,'Recovery outputs exceed 64 MiB');
  output=resolve(output);assert(!existsSync(output),'Recovery output already exists');mkdirSync(dirname(output),{recursive:true});
  const disk=statfsSync(dirname(output));assert(disk.bavail*disk.bsize>total+64*1024*1024,'Insufficient disk for bounded outputs');
  const staging=mkdtempSync(join(dirname(output),'.retained-price-prepare-'));
  try{for(const [path,bytes]of Object.entries(contents))writeFileSync(join(staging,path),bytes,{flag:'wx'});assert(!existsSync(output));renameSync(staging,output);}
  catch(error){rmSync(staging,{recursive:true,force:true});throw error;}
  return {...receipt,output_bytes:total};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),keys=['--review','--prior-metadata','--candidate-metadata','--prior-histories','--source-manifest','--source-companion','--output'];
  assert([keys.length*2,keys.length*2+2].includes(args.length),'Expected seven path options and optional exact prior home');
  const parsed={};for(let i=0;i<args.length;i+=2){assert([...keys,'--prior-home-metadata'].includes(args[i])&&!Object.hasOwn(parsed,args[i]),'Unknown/duplicate option');parsed[args[i]]=args[i+1];}
  assert(keys.every(key=>parsed[key]),'Missing required path option');
  const result=prepare({reviewPath:parsed['--review'],priorMetadata:parsed['--prior-metadata'],candidateMetadata:parsed['--candidate-metadata'],
    priorHistories:parsed['--prior-histories'],sourceManifest:parsed['--source-manifest'],sourceCompanion:parsed['--source-companion'],output:parsed['--output'],priorHomeMetadata:parsed['--prior-home-metadata']});
  console.log(JSON.stringify({publication_authority:result.publication_authority,ready_to_publish:result.ready_to_publish,actual_histories:result.actual_histories,
    research_rows:result.research_rows,restored_research_rows:result.restored_research_rows,quarantined_research_rows:result.quarantined_research_rows,
    total_unknown_rows:result.total_unknown_rows,coverage:result.coverage,output_bytes:result.output_bytes}));
}
