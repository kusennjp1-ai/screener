import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sha256} from './publication-state.mjs';
import {needsCarryHistory,prepareCarryHistory} from './prepare-carry-history.mjs';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'carry-history-preparation-')),date='2026-10-13';mkdirSync(join(root,'static-data'));
  const rows=[{symbol:'A',methods:{ibd:{qualified:false,rules:[{label:'RS',state:'pass'},{label:'3年 EPS',state:'unknown'}]}}},
    {symbol:'B',methods:{minervini:{qualified:false}}}];
  const audit={as_of_date:date,results:rows};
  const target={market:'US',as_of_date:date,rows:rows.map(({symbol})=>({symbol,market:'US',as_of_date:date})),input_bindings:{files:[]}};
  const input={asOfDate:date,bytes:''};
  const bind=()=>{const bytes=JSON.stringify(audit);writeFileSync(join(root,'qualification-audit.json'),bytes);target.input_bindings.files=[{path:'qualification-audit.json',bytes:Buffer.byteLength(bytes),sha256:sha256(bytes)}];input.bytes=JSON.stringify(target);};bind();
  return {root,date,audit,target,input,bind,path:join(root,'static-data/financial-history.json'),run:()=>prepareCarryHistory({root,targetInput:input}),cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('missing history gets only target-bound standard zero-acquisition metadata',()=>{
  const f=fixture();try{
    const before=readFileSync(join(f.root,'qualification-audit.json'));
    assert.equal(f.run().created,true);
    assert.deepEqual(JSON.parse(readFileSync(f.path)),{as_of_date:f.date,results:{},coverage:{eligible:1,requested:0,available:0,four_annual_eps:0}});
    assert.deepEqual(readFileSync(join(f.root,'qualification-audit.json')),before);
    const bytes=readFileSync(f.path);assert.equal(f.run().created,false);assert.deepEqual(readFileSync(f.path),bytes);
  }finally{f.cleanup();}
});

test('existing history is byte-identical, including financial values and optional metadata',()=>{
  const f=fixture();try{
    const bytes='  '+JSON.stringify({as_of_date:f.date,results:{A:{symbol:'A',annual:[{end:'2025-12-31',eps:42}],retrieved_at:'2026-10-10T01:02:03Z'}},custom:{unchanged:true},coverage:{eligible:1,requested:1,available:1,four_annual_eps:0}},null,2)+'\n';
    writeFileSync(f.path,bytes);assert.equal(f.run().created,false);assert.equal(readFileSync(f.path,'utf8'),bytes);
  }finally{f.cleanup();}
});

test('existing unowned history and larger original acquisition cohort are retained',()=>{
  const f=fixture();try{
    const bytes=JSON.stringify({as_of_date:f.date,results:{C:{symbol:'C',annual:[{end:'2025-12-31',eps:42}]}},coverage:{eligible:3,requested:3,available:3,four_annual_eps:0}},null,2);
    writeFileSync(f.path,bytes);assert.equal(f.run().created,false);assert.equal(readFileSync(f.path,'utf8'),bytes);
  }finally{f.cleanup();}
});

test('retained annual EPS can coexist with failed later provider acquisition',()=>{
  const f=fixture();try{
    // The existing provider exporter retains annual data if a later request
    // fails, but marks that symbol unavailable. These counters are independent.
    const bytes=JSON.stringify({as_of_date:f.date,results:{A:{symbol:'A',status:'unavailable',annual:[1,2,3,4].map(eps=>({eps}))}},coverage:{eligible:1,requested:1,available:0,four_annual_eps:1}});
    writeFileSync(f.path,bytes);assert.equal(f.run().created,false);assert.equal(readFileSync(f.path,'utf8'),bytes);
  }finally{f.cleanup();}
});

for(const [name,change]of [
  ['missing target date',f=>{delete f.target.as_of_date;}],
  ['malformed target date',f=>{f.input.asOfDate=f.target.as_of_date='2026-02-31';}],
  ['different target date',f=>{f.target.as_of_date='2026-10-12';}],
  ['empty target universe',f=>{f.target.rows=[];}],
  ['duplicate target symbol',f=>{f.target.rows[1].symbol='A';}],
  ['mixed target market',f=>{f.target.rows[0].market='JP';}],
  ['mixed row date',f=>{f.target.rows[0].as_of_date='2026-10-12';}],
  ['missing audit binding',f=>{f.target.input_bindings.files=[];}],
  ['changed bound audit hash',f=>{f.target.input_bindings.files[0].sha256='f'.repeat(64);}],
  ['changed bound audit bytes',f=>{f.target.input_bindings.files[0].bytes++;}],
])test('rejects '+name+' without creating history',()=>{
  const f=fixture();try{change(f);f.input.bytes=JSON.stringify(f.target);assert.throws(f.run);assert(!existsSync(f.path));}finally{f.cleanup();}
});

for(const [name,change]of [
  ['audit date',f=>{f.audit.as_of_date='2026-10-12';}],
  ['duplicate audit symbol',f=>{f.audit.results[1].symbol='A';}],
  ['outside audit symbol',f=>{f.audit.results[1].symbol='C';}],
  ['missing audit row',f=>{f.audit.results.pop();}],
  ['malformed qualification',f=>{f.audit.results[0].methods.ibd.qualified='true';}],
  ['malformed rule coverage',f=>{f.audit.results[0].methods.ibd.rules[0].state='invented';}],
])test('rejects '+name+' after matching the input hash',()=>{
  const f=fixture();try{change(f);f.bind();assert.throws(f.run);assert(!existsSync(f.path));}finally{f.cleanup();}
});

for(const [name,value]of [
  ['missing date',{results:{}}],['malformed date',{as_of_date:'2026-02-31',results:{}}],
  ['stale date',{as_of_date:'2026-10-02',results:{}}],['missing results',{as_of_date:'2026-10-13'}],
  ...[null,{}, {eligible:1,requested:0,available:1,four_annual_eps:0},
    {eligible:1,requested:0,available:0,four_annual_eps:-1},
    {eligible:1,requested:0,available:0,four_annual_eps:0.5},
    {eligible:-1,requested:0,available:0,four_annual_eps:0}].map((coverage,index)=>['invalid coverage '+index,{as_of_date:'2026-10-13',results:{},coverage}]),
])test('rejects existing '+name+' without altering it',()=>{
  const f=fixture();try{const raw=JSON.stringify(value);writeFileSync(f.path,raw);assert.throws(f.run);assert.equal(readFileSync(f.path,'utf8'),raw);}finally{f.cleanup();}
});

test('a linked history file is rejected without changing its target',()=>{
  const f=fixture();try{const other=join(f.root,'other.json');writeFileSync(other,'original');symlinkSync(other,f.path);assert.throws(f.run,/input file/);assert.equal(readFileSync(other,'utf8'),'original');}finally{f.cleanup();}
});

test('eligibility matches the unchanged provider exporter without loading any provider',()=>{
  const exporter=fileURLToPath(new URL('../../frontend/tools/export-financial-history.py',import.meta.url));
  const rows=[{}, {methods:{minervini:{qualified:true}}}, {methods:{minervini2:{qualified:true}}}, {methods:{ibd:{qualified:true}}},
    ...['pass','fail','unknown','not_applicable'].map(state=>({methods:{ibd:{qualified:false,rules:[{label:'RS',state},{label:'3年 EPS',state:'unknown'}]}}})),
    {methods:{ibd:{rules:[{label:'3年 EPS',state:'unknown'}]}}}];
  const code=`import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('history',sys.argv[1])\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nassert 'yfinance' not in sys.modules\nprint(json.dumps([m.needs_history(row) for row in json.load(sys.stdin)]))`;
  const result=spawnSync('python3',['-c',code,exporter],{input:JSON.stringify(rows),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(rows.map(needsCarryHistory),JSON.parse(result.stdout));
});

test('production hook is before baseline snapshot and excludes immutable exception preparations',()=>{
  const code=readFileSync(new URL('./select-release-source.mjs',import.meta.url),'utf8');
  const start=code.indexOf('async function prepareCarry()'),end=code.indexOf('async function carryAssessment',start),body=code.slice(start,end);
  assert(body.indexOf('readCarryTargetBase')<body.indexOf('prepareCarryHistory({root,targetInput})'));
  assert(body.indexOf('prepareCarryHistory({root,targetInput})')<body.indexOf('copyBundleData(root,baseline)'));
  assert.match(body,/if\(!ordinaryCarrySelected\(state\)&&!state\.source\.repair\)/);
  const helper=readFileSync(new URL('./prepare-carry-history.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/fetch\(|child_process|https?:|Date\.now\(|financial_evaluated_at|retrieved_at/);
});
