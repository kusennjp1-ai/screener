// Explicit offline replay. The source checkout is an external evidence input,
// not a vendored alternate frontend and never a production environment switch.
// PINNED_RESEARCH_DECODER_ROOT=/exact/checkout node --test .github/scripts/pinned-research-decoder.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decodePinnedResearchIndex,loadPinnedResearchDecoder,pinnedResearchDecoderFiles} from './pinned-research-decoder.mjs';

if(!process.env.PINNED_RESEARCH_DECODER_ROOT)throw Error('Explicit exact PINNED_RESEARCH_DECODER_ROOT is required for this offline integration replay');
const root=resolve(process.env.PINNED_RESEARCH_DECODER_ROOT);
const capability=await loadPinnedResearchDecoder(root);
const transport=await import(pathToFileURL(join(root,'frontend/src/static/researchTransport.js')).href);
const floats=await import(pathToFileURL(join(root,'frontend/src/static/researchFloat64.js')).href);
const hex=await import(pathToFileURL(join(root,'frontend/src/static/researchHex.js')).href);
const wire=(fields,columns,count=5,extra={})=>({schema:'research-table-v2',column_encoding:'sparse-binary-and-signed-zero-v1',as_of_date:'2026-10-16',count,fields,columns,paths:{},orders:{},...extra});
const decode=value=>decodePinnedResearchIndex(capability,JSON.parse(JSON.stringify(value)));

test('all seven exact producer bytes and exported version are bound to the real clean checkout',()=>{
  assert.equal(transport.RESEARCH_TRANSPORT_VERSION,'research-table-v2');
  assert.equal(Object.keys(pinnedResearchDecoderFiles).length,7);
  for(const [path,digest] of Object.entries(pinnedResearchDecoderFiles))assert.equal(createHash('sha256').update(readFileSync(join(root,path))).digest('hex'),digest);
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),'8cf7d9b231a5926696d261da51a4bab531f33cfa');
  assert.equal(execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),'82d9278408ebdb927a5124453d5c004ebf0306b8');
  assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'');
});

test('sparse binary, dictionary, copy and nested cells preserve absence, null, zeros, signs and unknown status',()=>{
  const input=wire([['metric'],['copied'],['negative'],['status'],['nested'],['digest']],
    [{f64_present:floats.encodeResearchFloat64([null,0,-0,1.0000000000000002]),missing:[[0,1]]},
      {copy:0,patch:[]},{copy:0,factor:-1,patch:[]},
      {pool:['unknown','unavailable',null,0,false],refs:[0,1,2,3,4]},
      {pool:[{values:[0,null,false]}],refs:[0,0,-1,0,0]},
      {hex_present:hex.encodeResearchHex(['0'.repeat(64),null,'a'.repeat(64),'f'.repeat(64)]),missing:[[2,3]]}],5,
    {negative_zeros:[[0,4,['values',0]]]});
  const before=JSON.stringify(input),rows=decode(input).rows;
  assert.equal(Object.hasOwn(rows[0],'metric'),false);assert.equal(Object.hasOwn(rows[0],'copied'),false);
  assert.equal(rows[1].metric,null);assert.equal(Object.is(rows[2].metric,0),true);assert.equal(Object.is(rows[3].metric,-0),true);
  assert.equal(Object.is(rows[2].negative,-0),true);assert.equal(Object.is(rows[3].negative,0),true);assert.equal(rows[4].metric,1.0000000000000002);
  assert.equal(Object.is(rows[0].nested.values[0],-0),true);assert.equal(Object.is(rows[1].nested.values[0],0),true);
  assert.equal(Object.hasOwn(rows[2],'nested'),false);assert.equal(Object.hasOwn(rows[2],'digest'),false);
  assert.deepEqual(rows.map(row=>row.status),['unknown','unavailable',null,0,false]);assert.equal(rows[1].digest,null);assert.equal(rows[0].digest,'0'.repeat(64));
  assert.equal(JSON.stringify(input),before);
});

test('the producer encoder and decoder retain full v1/v2 proof tuples and unknown evidence states',()=>{
  const rows=[
    {symbol:'NVDA',market:'US',current_price:20,adv_usd:30000000,financial_current:{v:2,p:{eps:['unknown',null,0,-0,'USD','2026-10-16',false,'missing']}}},
    {symbol:'AAOI',market:'US',current_price:0,adv_usd:null,financial_current:{v:1,p:{eps:['unavailable',null,0,-0,'USD','missing']}}},
    {symbol:'ABSENT',market:'US',financial_current:{v:2,p:{eps:['unknown',null,null,null,null,null,null,null]}}},
  ];
  const encoded=transport.encodeResearchIndex({as_of_date:'2026-10-16',rows},{});
  assert.equal(encoded.financial_proof_encoding,'tuple-columns-v1');
  const result=decode(encoded);
  assert.deepEqual(result.rows,rows);assert.equal(Object.hasOwn(result.rows[2],'current_price'),false);
  assert.equal(Object.is(result.rows[0].financial_current.p.eps[3],-0),true);
  const malformed=wire([['financial_current','v'],['financial_current','p','eps','0']], [{values:[2]},{values:['unknown']}],1,{financial_proof_encoding:'tuple-columns-v1'});
  assert.equal(decode(malformed).rows[0].financial_current.invalid_transport_proof,true);
  assert.equal(Array.isArray(decode(malformed).rows[0].financial_current.p.eps),false);
});

test('unknown versions and encodings, malformed binary vectors and field conflicts fail closed',()=>{
  const valid=()=>wire([['metric']],[{values:[1]}],1);
  for(const mutation of [
    value=>{value.schema='research-table-v3';},value=>{value.column_encoding='unknown';},value=>{delete value.column_encoding;},
    value=>{value.financial_proof_encoding='unknown';},value=>{value.columns=[{f64_values:{count:1,bytes:'invalid'}}];},
    value=>{value.columns=[{present:[1],missing:[[0,1]]}];},value=>{value.columns=[{copy:0,patch:[]}];},
    value=>{value.fields=[['__proto__']];},value=>{value.fields=[['a'],['a']];value.columns=[{values:[1]},{values:[1]}];},
    value=>{value.fields=[['a'],['a','b']];value.columns=[{values:[{}]},{values:[1]}];},
    value=>{value.negative_zeros=[[0,0,[]]];},value=>{value.schema='research-table-v1';},
  ]){const value=valid();mutation(value);assert.throws(()=>decode(value));}
});

test('every changed dependency, dirty checkout, foreign HEAD/tree and symlink rejects before decode',async()=>{
  const temporary=mkdtempSync(join(tmpdir(),'pinned-decoder-integration-')),directory=join(temporary,'source');
  try{
    cpSync(root,directory,{recursive:true});const local=await loadPinnedResearchDecoder(directory);
    for(const path of Object.keys(pinnedResearchDecoderFiles)){
      const full=join(directory,path),original=readFileSync(full);writeFileSync(full,Buffer.concat([original,Buffer.from(' ')]));
      await assert.rejects(loadPinnedResearchDecoder(directory),/bytes differ/);assert.throws(()=>decodePinnedResearchIndex(local,wire([],[],0)),/bytes differ/);
      writeFileSync(full,original);
    }
    const untracked=join(directory,'unapproved.js');writeFileSync(untracked,'throw Error("must not execute");');
    await assert.rejects(loadPinnedResearchDecoder(directory),/exact and clean/);rmSync(untracked);
    const head=join(directory,'.git/HEAD'),originalHead=readFileSync(head);writeFileSync(head,'a'.repeat(40)+'\n');
    await assert.rejects(loadPinnedResearchDecoder(directory));writeFileSync(head,originalHead);
    const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:directory,encoding:'utf8'}).trim();
    const treePath=join(directory,'.git/objects',tree.slice(0,2),tree.slice(2)),treeBytes=readFileSync(treePath);writeFileSync(treePath,'not the pinned tree');
    await assert.rejects(loadPinnedResearchDecoder(directory));writeFileSync(treePath,treeBytes);
    const path=Object.keys(pinnedResearchDecoderFiles)[0],full=join(directory,path),original=readFileSync(full);rmSync(full);symlinkSync(join(root,path),full);
    await assert.rejects(loadPinnedResearchDecoder(directory),/Linked pinned research decoder input/);rmSync(full);writeFileSync(full,original);
    symlinkSync(directory,join(temporary,'linked-root'));await assert.rejects(loadPinnedResearchDecoder(join(temporary,'linked-root')),/Linked pinned research decoder input/);
    assert.deepEqual(decodePinnedResearchIndex(local,wire([],[],0)).rows,[]);
  }finally{rmSync(temporary,{recursive:true,force:true});}
});
