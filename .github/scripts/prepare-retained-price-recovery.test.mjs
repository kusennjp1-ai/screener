import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepare} from './prepare-retained-price-recovery.mjs';
import {recoveryDigest} from './retained-price-recovery.mjs';
import {priceObservationDigest} from './price-observations.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('changing both selected history and its mutable receipt cannot replace pinned extraction proof',()=>{
  const root=mkdtempSync(join(tmpdir(),'retained-receipt-test-'));
  try{
    const metadata=join(root,'metadata');mkdirSync(metadata);
    const original=JSON.stringify({schema_version:'retained-price-scoped-extraction-v1',archive:{sha256:'a'.repeat(64),bytes:100},
      fullSiteVerified:false,outputBytes:20,outputCapBytes:67108864,files:{'chart.json':{decodedBytes:2,decodedSha256:hash('{}')}}});
    const altered=JSON.parse(original);altered.files['chart.json']={decodedBytes:9,decodedSha256:hash('{"x":999}')};
    writeFileSync(join(metadata,'chart.json'),'{"x":999}');writeFileSync(join(metadata,'scoped-extraction-manifest.json'),JSON.stringify(altered));
    const review={schema_version:'retained-price-recovery-review-inputs-v1',publication_authority:false,mode:'offline_exact_inputs_only',
      constraints:{providers:'denied',remote_writes:'denied',existing_gates:'unchanged'},expected_recovery:{minimum_verification_ratio:.9},
      prior:{sha256:'a'.repeat(64),bytes:100},scoped_extraction_receipts:{prior_metadata:hash(original)}};
    const reviewPath=join(root,'review.json');writeFileSync(reviewPath,JSON.stringify(review));
    assert.throws(()=>prepare({reviewPath,priorMetadata:metadata}),/Extraction receipt differs/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

function preparedFixture(root){
  const before='2026-10-02',after='2026-10-05',symbols=[...Array.from({length:20},(_,i)=>`GOOD${i}`),'LOST','EQR'];
  const key=s=>JSON.stringify(['US','chart',s]);
  const row=(symbol,date)=>({symbol,market:'US',currency:'USD',exchange:'XNYS',company_name:`Issuer ${symbol}`,as_of_date:date,
    current_price:20,adv_usd:30_000_000,chart_path:symbol==='EQR'?null:`charts/${symbol}.json`,research_detail_path:`details/${symbol}.json`,
    financial_history:{retrieved_at:'2026-10-04T13:07:17.075Z',annual:[]},eps_growth_qq:25,
    technical_audit:{version:'ohlcv-v1',symbol,as_of_date:date,valid:symbol!=='EQR',bars:symbol==='EQR'?0:300,
      errors:symbol==='EQR'?['missing']:[],values:symbol==='EQR'?{}:{close:20,momentum:1}}});
  const priorRows=symbols.map(s=>row(s,before)),candidateRows=symbols.map(s=>row(s,after));
  Object.assign(candidateRows.at(-2),{current_price:null,chart_path:null,technical_audit:{version:'ohlcv-v1',symbol:'LOST',as_of_date:after,valid:false,bars:0,errors:['missing'],values:{}}});
  const priorManifest={markets:{US:{as_of_date:before,assets:{research:{path:'research.json'}}}}};
  const candidateManifest={markets:{US:{as_of_date:after,assets:{research:{path:'research.json'}}}}};
  const priorPublication={schema:1,run_id:1,run_attempt:1,data_manifest_sha256:hash(JSON.stringify(priorManifest)),
    price_observations:Object.fromEntries(symbols.filter(s=>s!=='EQR').map(s=>[key(s),before])),
    known_price_dates:Object.fromEntries(symbols.filter(s=>s!=='EQR').map(s=>[key(s),before])),
    verification_universe:{as_of_date:before,required_symbols:symbols,minimum_target:.9}};
  const price_observations=Object.fromEntries(symbols.filter(s=>!['EQR','LOST'].includes(s)).map(s=>[key(s),after]));
  const source={run_id:2,run_attempt:1,source_sha:'c'.repeat(40),artifact_name:'fixture',manifest_json:JSON.stringify(candidateManifest),
    manifest_sha256:hash(JSON.stringify(candidateManifest)),price_observations,price_observations_sha256:priceObservationDigest(price_observations)};
  const review={schema_version:'retained-price-recovery-review-inputs-v1',publication_authority:false,mode:'offline_exact_inputs_only',target_price_session:after,catch_up_only:true,
    constraints:{providers:'denied',remote_writes:'denied',existing_gates:'unchanged'},scoped_extraction_receipts:{},
    prior:{sha256:'a'.repeat(64),bytes:100,run_id:1,run_attempt:1,publication_sha256:hash(JSON.stringify(priorPublication)),manifest_sha256:hash(JSON.stringify(priorManifest)),
      research_path:'static-data/research.json',research_sha256:hash(JSON.stringify({rows:priorRows})),chart_index_path:'static-data/charts-index.json',required_symbol_count:22},
    candidate:{sha256:'b'.repeat(64),bytes:200,run_id:2,run_attempt:1,head_sha:source.source_sha,artifact_name:'fixture',manifest_sha256:source.manifest_sha256,
      research_path:'static-data/research.json',research_sha256:hash(JSON.stringify({rows:candidateRows})),chart_index_path:'static-data/charts-index.json',
      retained_source_json_sha256:hash(JSON.stringify(source)),price_observations_sha256:source.price_observations_sha256},
    expected_recovery:{prior_public_rows:22,candidate_public_rows:22,required_union:22,conservative_verified:20,minimum_verification_ratio:.9,
      actual_recoverable_histories:1,restored_research_rows:1,quarantined_research_rows:1,total_unknown_rows:2,chart_index_only_histories:0,ledger_only_absences:[]}};
  review.quarantine_adjustments=[{symbol:'EQR',reason:'undated_price_without_chart',observation_date:null,
    prior_row_sha256:recoveryDigest(priorRows.at(-1)),candidate_row_sha256:recoveryDigest(candidateRows.at(-1)),
    source_rows:Object.fromEntries([['prior',priorRows.at(-1)],['candidate',candidateRows.at(-1)]].map(([name,row])=>[name,
      Object.fromEntries(['as_of_date','current_price','adv_usd','chart_path','technical_audit'].map(field=>[field,row[field]]))]))}];
  function extraction(label,archive,files){
    const dir=join(root,label),receipt={schema_version:'retained-price-scoped-extraction-v1',archive:{sha256:archive.sha256,bytes:archive.bytes},
      fullSiteVerified:false,outputBytes:0,outputCapBytes:67108864,files:{},request:Object.keys(files)};
    for(const [path,value] of Object.entries(files)){
      const bytes=JSON.stringify(value);mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);
      receipt.files[path]={decodedBytes:Buffer.byteLength(bytes),decodedSha256:hash(bytes)};receipt.outputBytes+=Buffer.byteLength(bytes);
    }
    const bytes=JSON.stringify(receipt);writeFileSync(join(dir,'scoped-extraction-manifest.json'),bytes);review.scoped_extraction_receipts[label]=hash(bytes);return dir;
  }
  const priorChartIndex={symbols:symbols.filter(s=>s!=='EQR').map(symbol=>({symbol,path:`charts/${symbol}.json`}))};
  const priorMetadata=extraction('prior_metadata',review.prior,{'publication.json':priorPublication,'static-data/manifest.json':priorManifest,
    'static-data/research.json':{rows:priorRows},'static-data/charts-index.json':priorChartIndex});
  const candidateMetadata=extraction('candidate_metadata',review.candidate,{'static-data/manifest.json':candidateManifest,
    'static-data/research.json':{rows:candidateRows},'static-data/charts-index.json':{symbols:priorChartIndex.symbols.filter(r=>r.symbol!=='LOST')}});
  const oldRow=priorRows.at(-2),chart={symbol:'LOST',market:'US',as_of_date:before,generated_at:'2026-10-04T13:00:00Z',stock_data:oldRow,
    bars:[{date:before,open:19,high:21,low:18,close:20,volume:3_000_000}]};
  const priorHistories=extraction('prior_history',review.prior,{'static-data/charts/LOST.json':chart,'static-data/details/LOST.json':oldRow});
  const sourceManifest=join(root,'source.json'),sourceCompanion=join(root,'companion.zip');writeFileSync(sourceManifest,JSON.stringify(source));
  execFileSync('python3',['-c',"import sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],'w') as z: z.write(sys.argv[1],'source.json')",sourceManifest,sourceCompanion]);
  const companion=readFileSync(sourceCompanion);review.candidate.companion_bytes=companion.length;review.candidate.companion_sha256=hash(companion);
  const reviewPath=join(root,'review.json');writeFileSync(reviewPath,JSON.stringify(review));
  return {review,reviewPath,priorMetadata,candidateMetadata,priorHistories,sourceManifest,sourceCompanion,output:join(root,'prepared')};
}

test('preparation reports row-only quarantines separately from actual chart histories and binds exact evidence',()=>{
  const root=mkdtempSync(join(tmpdir(),'retained-quarantine-prepare-'));
  try{
    const input=preparedFixture(root),receipt=prepare(input),compiled=JSON.parse(readFileSync(join(input.output,'compiler-inputs.json')));
    assert.equal(receipt.actual_histories,1);assert.equal(receipt.research_rows,2);assert.equal(receipt.restored_research_rows,1);
    assert.equal(receipt.quarantined_research_rows,1);assert.equal(receipt.total_unknown_rows,2);assert.equal(receipt.chart_index_only,0);
    assert.equal(compiled.patches.length,1);assert.equal(compiled.row_quarantines.length,1);assert.equal(compiled.rows.length,22);
    assert.deepEqual(receipt.coverage,{total:22,verified:20,minimum_target:.9});assert(receipt.output_bytes<67108864);
    assert.equal(compiled.row_quarantines[0].row.current_price,null);assert.equal(compiled.row_quarantines[0].row.chart_path,null);
    assert.equal(compiled.row_quarantines[0].snapshot.candidate_row.current_price,20);
    const originalReceipt=readFileSync(join(input.output,'receipt.json'));
    input.review.quarantine_adjustments[0].candidate_row_sha256='0'.repeat(64);writeFileSync(input.reviewPath,JSON.stringify(input.review));
    const alteredOutput=join(root,'altered');assert.throws(()=>prepare({...input,output:alteredOutput}),/Quarantine candidate row differs from review/);
    assert(!existsSync(alteredOutput));assert(readFileSync(join(input.output,'receipt.json')).equals(originalReceipt));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('committed exact review distinguishes 60 actual histories from 51 unknown research rows',()=>{
  const review=JSON.parse(readFileSync(new URL('./fixtures/retained-price-recovery-inputs.json',import.meta.url)));
  assert.equal(review.expected_recovery.actual_recoverable_histories,60);assert.equal(review.expected_recovery.restored_research_rows,50);
  assert.equal(review.expected_recovery.quarantined_research_rows,1);assert.equal(review.expected_recovery.total_unknown_rows,51);
  assert.equal(review.expected_recovery.required_union,1904);assert.equal(review.expected_recovery.conservative_verified,1850);
  assert.deepEqual(review.quarantine_adjustments.map(item=>item.symbol),['EQR']);
  const adjustment=review.quarantine_adjustments[0];assert.equal(adjustment.observation_date,null);
  for(const [name,date] of [['prior','2026-10-02'],['candidate','2026-10-05']]){
    const row=adjustment.source_rows[name];assert.equal(row.as_of_date,date);assert.equal(row.current_price,63.65999984741211);
    assert.equal(row.adv_usd,196594975);assert.equal(row.chart_path,null);assert.equal(row.technical_audit.valid,false);assert.equal(row.technical_audit.bars,0);
  }
});
