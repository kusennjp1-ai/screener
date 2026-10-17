import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareRecoveryPreflightInputs,planningArguments} from './prepare-statement-recovery-preflight.mjs';
import {encodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
import {decodePinnedResearchIndex,loadPinnedResearchDecoder,pinnedResearchDecoderFiles} from './pinned-research-decoder.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value));
const now='2026-10-16T08:00:00.000Z';
const row=(symbol,price=20)=>({symbol,market:'US',current_price:price,adv_usd:30000000});
function fixture({rows=[row('NVDA'),row('AAOI',2),row('NEW')],symbols=['AAOI','NVDA'],wire=false}={}){
  const index={as_of_date:'2026-10-15',rows},indexBytes=bytes(wire?encodeResearchIndex(index,{}):index);
  const manifestBytes=bytes({schema_version:'static-site-v2',as_of_date:'2026-10-15',markets:{US:{as_of_date:'2026-10-15',assets:{research:{path:`research-index-${sha(indexBytes).slice(0,16)}.json`}}}}});
  const sourceBaseBytes=bytes({as_of_date:'2026-10-02',market:'US',rows:[row('NVDA'),row('AAOI'),row('OTHER')]});
  const sourceCohortBytes=bytes({symbols,base_artifact_sha256:sha(sourceBaseBytes)});
  return {manifestBytes,indexBytes,sourceBaseBytes,sourceCohortBytes,observedAt:now,bindings:{
    canonical_manifest_sha256:sha(manifestBytes),canonical_research_sha256:sha(indexBytes),
    source_base_sha256:sha(sourceBaseBytes),source_cohort_sha256:sha(sourceCohortBytes),source_archive_manifest_sha256:'a'.repeat(64)}};
}
function rebind(value,key,field){value.bindings[key]=sha(value[field]);return value;}

test('preserves every original member and order without admitting new liquid names',()=>{
  const input=fixture(),before=Buffer.from(input.sourceCohortBytes),result=prepareRecoveryPreflightInputs(input);
  assert.deepEqual(result.cohort.symbols,['AAOI','NVDA']);
  assert.equal(result.current_liquid_count,2);
  assert.equal(result.cohort.base_artifact_sha256,sha(result.baseBytes));
  const base=JSON.parse(result.baseBytes);
  assert.equal(base.retained_cohort_size,2);assert.equal(base.rows.length,3);
  assert.equal(base.priority_basis,'retained_original_cohort_order_only');
  assert.equal(base.source.observed_at,now);
  assert.equal(Object.hasOwn(base.rows[0],'financial_history'),false);
  assert.deepEqual(input.sourceCohortBytes,before);
});

test('canonical column transport preserves the exact same original full cohort',()=>{
  assert.deepEqual(prepareRecoveryPreflightInputs(fixture({wire:true})).cohort.symbols,['AAOI','NVDA']);
});

test('v2 requires the pinned producer capability and cannot fall back or relabel',()=>{
  const input=fixture({wire:true}),raw=JSON.parse(input.indexBytes);
  raw.schema='research-table-v2';raw.column_encoding='sparse-binary-and-signed-zero-v1';
  input.indexBytes=bytes(raw);rebind(input,'canonical_research_sha256','indexBytes');
  for(const pinnedDecoder of [undefined,null,{},()=>{}, {decodeResearchIndex:()=>({rows:[row('NVDA')]})}]){
    assert.throws(()=>prepareRecoveryPreflightInputs({...input,pinnedDecoder}),/verified pinned research decoder/);
  }
  assert.equal(JSON.parse(input.indexBytes).schema,'research-table-v2');
  assert.throws(()=>decodePinnedResearchIndex({},raw),/verified pinned research decoder/);
});

test('a supplied forged capability cannot bypass the supported legacy offline decoder',()=>{
  for(const wire of [false,true])assert.throws(()=>prepareRecoveryPreflightInputs({...fixture({wire}),pinnedDecoder:{}}),/verified pinned research decoder/);
});

test('pinned decoder rejects missing, altered or linked source bytes before importing code',async()=>{
  const root=mkdtempSync(join(tmpdir(),'pinned-research-guard-'));
  try{
    await assert.rejects(loadPinnedResearchDecoder(root),/ENOENT/);
    const relative=Object.keys(pinnedResearchDecoderFiles)[0],path=join(root,relative);
    mkdirSync(dirname(path),{recursive:true});writeFileSync(path,"throw Error('untrusted module executed');\n");
    await assert.rejects(loadPinnedResearchDecoder(root),/Pinned research decoder bytes differ/);
    const target=join(root,'unchanged-source');writeFileSync(target,'untrusted');rmSync(path);symlinkSync(target,path);
    await assert.rejects(loadPinnedResearchDecoder(root),/Linked pinned research decoder input/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('zero current liquid members cannot remove the original full source cohort',()=>{
  const result=prepareRecoveryPreflightInputs(fixture({rows:[row('NVDA',1),row('AAOI',2)]}));
  assert.equal(result.current_liquid_count,0);assert.deepEqual(result.cohort.symbols,['AAOI','NVDA']);
});

test('every supplied input digest is bound, including the full original cohort',()=>{
  for(const [key,field] of [['canonical_manifest_sha256','manifestBytes'],['canonical_research_sha256','indexBytes'],['source_base_sha256','sourceBaseBytes'],['source_cohort_sha256','sourceCohortBytes']]){
    const value=fixture();value[field]=Buffer.concat([value[field],Buffer.from(' ')]);
    assert.throws(()=>prepareRecoveryPreflightInputs(value),/digest mismatch/,key);
  }
  const bad=fixture();bad.bindings.source_archive_manifest_sha256='A'.repeat(64);
  assert.throws(()=>prepareRecoveryPreflightInputs(bad),/digest/);
});

test('a missing or foreign member stops rather than shrinking the full cohort',()=>{
  assert.throws(()=>prepareRecoveryPreflightInputs(fixture({rows:[row('NVDA')]})),/absent or foreign/);
  const value=fixture(),old=JSON.parse(value.sourceBaseBytes);old.rows[1].market='HK';value.sourceBaseBytes=bytes(old);
  rebind(value,'source_base_sha256','sourceBaseBytes');value.sourceCohortBytes=bytes({symbols:['AAOI','NVDA'],base_artifact_sha256:sha(value.sourceBaseBytes)});
  rebind(value,'source_cohort_sha256','sourceCohortBytes');
  assert.throws(()=>prepareRecoveryPreflightInputs(value),/foreign/);
});

test('duplicate and malformed original cohorts, changed base bindings, and extra controls fail closed',()=>{
  for(const symbols of [['NVDA','NVDA'],[],['../NVDA'],['NVDA',null]])assert.throws(()=>prepareRecoveryPreflightInputs(fixture({symbols})),/cohort/);
  const changed=fixture();changed.sourceCohortBytes=bytes({symbols:['NVDA'],base_artifact_sha256:'b'.repeat(64)});rebind(changed,'source_cohort_sha256','sourceCohortBytes');
  assert.throws(()=>prepareRecoveryPreflightInputs(changed),/cohort/);
  for(const key of ['symbols','retry_decisions','source_rechecks','provider_resume','publication_authority']){
    const value=fixture();value.bindings[key]=[];
    assert.throws(()=>prepareRecoveryPreflightInputs(value),/closed/);
  }
});

test('new current plan time does not permit future prices or roll back the original source date',()=>{
  assert.throws(()=>prepareRecoveryPreflightInputs({...fixture(),observedAt:'2026-10-14T08:00:00Z'}),/dates disagree/);
  const value=fixture(),old=JSON.parse(value.sourceBaseBytes);old.as_of_date='2026-10-16';value.sourceBaseBytes=bytes(old);
  rebind(value,'source_base_sha256','sourceBaseBytes');value.sourceCohortBytes=bytes({symbols:['NVDA'],base_artifact_sha256:sha(value.sourceBaseBytes)});rebind(value,'source_cohort_sha256','sourceCohortBytes');
  assert.throws(()=>prepareRecoveryPreflightInputs(value),/predates/);
});

test('the only subprocess is the existing offline full-cohort planner with fixed 200, no retry or provider flags',()=>{
  const args=planningArguments({source:'/source',output:'/output',archiveSha:'a'.repeat(64),observedAt:now});
  assert.deepEqual(args,['-m','app.scripts.manage_statement_archive','plan','--archive','/source/archive','--archive-sha256','a'.repeat(64),
    '--base','/output/base.json','--cohort','/output/cohort.json','--now',now,'--batch-limit','200','--output-directory','/output/planning']);
  const code=readFileSync(new URL('./prepare-statement-recovery-preflight.mjs',import.meta.url),'utf8');
  assert.equal((code.match(/execFileSync\(/g)||[]).length,1);
  assert.match(code,/provider_execution:false,current_remote_continuity_verified:false/);
  assert.doesNotMatch(code,/batch\.collect|runtime\(|--retry-decisions|--source-rechecks|--provider-resume|fetch\(|githubApi\(/);
});

test('real offline CLI records selected symbols and retains original cohort order in both input and plan',()=>{
  const root=mkdtempSync(join(tmpdir(),'recovery-preflight-test-')),repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  try{
    const input=fixture({symbols:['NVDA','AAOI']}),canonical=join(root,'canonical'),source=join(root,'source'),output=join(root,'output');
    mkdirSync(canonical);mkdirSync(source);
    writeFileSync(join(canonical,'manifest.json'),input.manifestBytes);
    const research=JSON.parse(input.manifestBytes).markets.US.assets.research.path;
    writeFileSync(join(canonical,research),input.indexBytes);writeFileSync(join(source,'base.json'),input.sourceBaseBytes);writeFileSync(join(source,'cohort.json'),input.sourceCohortBytes);
    const created=execFileSync('python3',['-c',`import json,sys\nfrom pathlib import Path\nfrom app.services import statement_artifact_archive as a,financial_statement_batch as b\np=Path(sys.argv[1]);print(a.create_archive(p/'archive',base_bytes=(p/'base.json').read_bytes(),cohort=json.loads((p/'cohort.json').read_bytes()),now=b.clock(sys.argv[2])))`,source,now],
      {env:{...process.env,PYTHONPATH:join(repo,'backend'),PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'}).trim();
    input.bindings.source_archive_manifest_sha256=created;
    const bindings=join(root,'bindings.json');writeFileSync(bindings,JSON.stringify(input.bindings));
    const stdout=execFileSync(process.execPath,[join(repo,'.github/scripts/prepare-statement-recovery-preflight.mjs'),canonical,source,bindings,output],{encoding:'utf8'});
    const audit=JSON.parse(readFileSync(join(output,'preflight.json'))),plan=JSON.parse(readFileSync(join(output,'planning/plan.json')));
    assert.equal(JSON.parse(stdout).selected,2);assert.deepEqual(audit.selected_symbols,['AAOI','NVDA']);
    assert.deepEqual(plan.verified_us_cohort.symbols,['NVDA','AAOI']);
    assert.deepEqual(JSON.parse(readFileSync(join(output,'cohort.json'))).symbols,['NVDA','AAOI']);
    assert.equal(audit.plan_sha256,sha(readFileSync(join(output,'planning/plan.json'))));
    assert.equal(audit.provider_execution,false);assert.equal(audit.current_remote_continuity_verified,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
