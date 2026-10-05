import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contract, parseCorrectionIntent, verifyCorrectionSource, verifyCorrectionChecks, assertCorrectionProgress, compareCorrectionData, verifyConsumerCapability, validateCorrectionReceipt } from './financial-correction.mjs';
const H='a'.repeat(64), SHA='b'.repeat(40), repo='kusennjp1-ai/screener';
const source=()=>({repository:repo,workflow:contract.source_workflow,head_sha:SHA,run_id:12,run_attempt:2,artifact_id:99,artifact_name:`financial-statement-recovery-${SHA}-2`,artifact_sha256:H,archive_manifest_sha256:H,acquisition_base_sha256:H,cohort_sha256:H});
const intent=()=>({schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:`1/1/${H}/${H}`,source:source()});
const parse=value=>parseCorrectionIntent(JSON.stringify(value));
const sourceFixture=()=>{
 const run={id:12,run_attempt:2,repository:{full_name:repo},head_repository:{full_name:repo},head_sha:SHA,path:contract.source_workflow,head_branch:'improve/mandatory-financial-source-recovery',event:'push',status:'completed',conclusion:'success'};
 const job={id:31,name:contract.source_job,run_attempt:2,conclusion:'success',started_at:'2026-10-04T11:00:00Z',completed_at:'2026-10-04T11:30:00Z'};
 const artifact={id:99,name:source().artifact_name,expired:false,digest:`sha256:${H}`,size_in_bytes:1000,created_at:'2026-10-04T11:29:00Z',workflow_run:{id:12,head_sha:SHA}};
 return {run,job,artifact,api:path=>path.includes('/jobs?')?[{jobs:[job]}]:path.includes('/artifacts?')?[{artifacts:[artifact]}]:run};
};
test('typed intent is closed and normal dispatch remains opt-out',()=>{
 assert.equal(parseCorrectionIntent(''),null); assert.equal(parseCorrectionIntent(undefined),null);assert.deepEqual(parse(intent()),intent());
 for(const value of [true,{allow_equal_date:true},{...intent(),success:true},{...intent(),source:{...source(),validated:true}},{...intent(),schema_version:'financial-correction-v0'}])assert.throws(()=>parse(value));
});
for(const [key,value] of [['repository','attacker/repo'],['workflow','.github/workflows/static-site.yml'],['head_sha','short'],['run_id',0],['run_attempt',1.5],['artifact_id',-1],['artifact_name','latest'],['artifact_sha256','SHA256:a'],['archive_manifest_sha256','bad'],['cohort_sha256',null]])test(`intent rejects invalid ${key}`,()=>assert.throws(()=>parse({...intent(),source:{...source(),[key]:value}})));
test('source binds outer exact attempt/job/artifact rather than nested seed',()=>{const f=sourceFixture();assert.equal(verifyCorrectionSource(source(),f.api).job.id,31);});
for(const [group,key,value] of [
 ['run','id',13],['run','run_attempt',1],['run','head_sha','c'.repeat(40)],['run','repository',{full_name:'evil/repo'}],['run','head_repository',{full_name:'evil/repo'}],['run','path','.github/workflows/static-site.yml'],['run','status','in_progress'],['run','conclusion','failure'],['run','event','workflow_dispatch'],
 ['job','run_attempt',1],['job','conclusion','skipped'],['job','id',null],['job','started_at','invalid'],['job','completed_at','2026-10-04T11:10:00Z'],
 ['artifact','expired',true],['artifact','id',98],['artifact','digest',`sha256:${'0'.repeat(64)}`],['artifact','created_at','2026-10-04T10:59:00Z'],['artifact','workflow_run',{id:12,head_sha:'d'.repeat(40)}],['artifact','size_in_bytes',0]
])test(`source rejects ${group}.${key} tampering`,()=>{const f=sourceFixture();f[group][key]=value;assert.throws(()=>verifyCorrectionSource(source(),f.api));});
test('source rejects duplicate and missing artifacts',()=>{for(const list of [[],[sourceFixture().artifact,sourceFixture().artifact]]){const f=sourceFixture();assert.throws(()=>verifyCorrectionSource(source(),path=>path.includes('/artifacts?')?[{artifacts:list}]:f.api(path)));}});
function checksFixture(){const f=sourceFixture();Object.assign(f.run,{id:51,run_attempt:3,path:'.github/workflows/ci.yml',head_branch:'main'});const jobs=contract.required_ci_jobs.map((name,i)=>({id:i+1,name,run_attempt:3,status:'completed',conclusion:'success'}));return {run:f.run,jobs,api:path=>path.includes('/workflows/')?[{workflow_runs:[f.run]}]:path.includes('/jobs?')?[{jobs}]:f.run};}
test('correction requires exact current controller CI and each required job',()=>{const f=checksFixture();assert.equal(verifyCorrectionChecks(repo,SHA,f.api).length,contract.required_ci_jobs.length);});
for(const failure of ['skipped','cancelled','failure','pending',null])test(`controller rejects ${failure} required job`,()=>{const f=checksFixture();f.jobs[0].conclusion=failure;assert.throws(()=>verifyCorrectionChecks(repo,SHA,f.api));});
test('controller rejects missing duplicate or wrong-attempt required job',()=>{for(const mode of ['missing','duplicate','attempt']){const f=checksFixture();if(mode==='missing')f.jobs.pop();if(mode==='duplicate')f.jobs.push({...f.jobs[0]});if(mode==='attempt')f.jobs[0].run_attempt=2;assert.throws(()=>verifyCorrectionChecks(repo,SHA,f.api));}});
test('no financial progress from repeated generation or wrapper metadata',()=>{const value={schema_version:contract.projection_schema,financial_generation:H,receipt_inventory:[{}],knowledge_basis:contract.knowledge_basis,point_in_time:false,source_publication_date:null};assertCorrectionProgress(value,'legacy-none');assert.throws(()=>assertCorrectionProgress({...value,financial_evaluated_at:'2099-01-01'},H));assert.throws(()=>assertCorrectionProgress({...value,receipt_inventory:[]},'legacy-none'));assert.throws(()=>assertCorrectionProgress({...value,point_in_time:true},'legacy-none'));});
function bundleFixture(){const root=mkdtempSync(join(tmpdir(),'financial-correction-')),before=join(root,'before'),after=join(root,'after'),frontend=join(root,'frontend');
 const put=(base,path,value)=>{mkdirSync(join(base,path,'..'),{recursive:true});writeFileSync(join(base,path),typeof value==='string'?value:JSON.stringify(value));};
 put(frontend,'src/static/researchTransport.js','export const decodeResearchIndex = value => value;');put(frontend,'package.json',{type:'module'});
 const row={symbol:'AAA',market:'US',current_price:100,adv_usd:50000000,eps_growth_yy:null,financial_history:null,chart_path:'charts/AAA.json',research_detail_path:'research-details/AAA-aaaaaaaaaaaaaaaa.json'};
 const manifest={as_of_date:'2026-10-02',supported_markets:['US'],default_market:'US',markets:{US:{as_of_date:'2026-10-02',pages:{scan:{path:'scan.json'}},assets:{research:{path:'research-index-aaaaaaaaaaaaaaaa.json'},charts:{path:'charts-index-aaaaaaaaaaaaaaaa.json'}}}}};
 const files={'static-data/manifest.json':manifest,'static-data/research-index-aaaaaaaaaaaaaaaa.json':{as_of_date:'2026-10-02',rows:[row]},'static-data/charts-index-aaaaaaaaaaaaaaaa.json':{symbols:[{symbol:'AAA',path:'charts/AAA.json'}]},'static-data/charts/AAA.json':{symbol:'AAA',market:'US',bars:[{date:'2026-10-02',open:90,high:101,low:89,close:100,volume:1000}],stock_data:row},'static-data/research-details/AAA-aaaaaaaaaaaaaaaa.json':row,'static-data/scan.json':{as_of_date:'2026-10-02',initial_rows:[row],chunks:[]},'static-data/home.json':{bars:[{date:'2026-10-02',close:100}]},'static-data/sector-prices.json':{bars:[{date:'2026-10-02',close:200}]},'static-data/candidate-history/index.json':{snapshots:[]},'ibd-reference.json':null};
 for(const base of [before,after])for(const [path,value]of Object.entries(files))put(base,path,value);
 return {root,before,after,frontend,put,change(path,fn){const file=join(after,path),value=JSON.parse(readFileSync(file,'utf8'));fn(value);put(after,path,value);},check:()=>compareCorrectionData(before,after,frontend,{financial_generation:H,symbols:{AAA:{}}}),cleanup:()=>rmSync(root,{recursive:true,force:true})};}
test('semantic inventory accepts financial-only canonical ownership changes',async()=>{const f=bundleFixture();try{for(const path of ['static-data/research-index-aaaaaaaaaaaaaaaa.json','static-data/scan.json','static-data/research-details/AAA-aaaaaaaaaaaaaaaa.json','static-data/charts/AAA.json'])f.change(path,value=>{const row=value.rows?.[0]||value.initial_rows?.[0]||value.stock_data||value;row.eps_growth_yy=25;row.financial_history={annual:[]};row.financial_generation=H;});await f.check();}finally{f.cleanup();}});
for(const [path,change]of [
 ['static-data/charts/AAA.json',v=>v.bars[0].close=101],['static-data/charts/AAA.json',v=>v.bars[0].volume=1001],['static-data/charts/AAA.json',v=>v.bars.unshift({date:'2026-10-01',close:90})],
 ['static-data/research-index-aaaaaaaaaaaaaaaa.json',v=>v.rows[0].current_price=101],['static-data/research-index-aaaaaaaaaaaaaaaa.json',v=>v.rows[0].adv_usd=1],['static-data/research-index-aaaaaaaaaaaaaaaa.json',v=>v.rows=[]],
 ['static-data/research-details/AAA-aaaaaaaaaaaaaaaa.json',v=>v.company_name='Different issuer'],['static-data/manifest.json',v=>v.markets.US.as_of_date='2026-10-03'],
 ['static-data/home.json',v=>v.bars[0].close=101],['static-data/sector-prices.json',v=>v.bars[0].close=1],['static-data/candidate-history/index.json',v=>v.snapshots.push({as_of:'2026-10-02'})],
 ['static-data/charts-index-aaaaaaaaaaaaaaaa.json',v=>v.symbols=[]],
])test(`same-price correction rejects unauthorized mutation ${path}`,async()=>{const f=bundleFixture();try{f.change(path,change);await assert.rejects(f.check);}finally{f.cleanup();}});
test('correction fails closed when approved UI lacks executed hook',async()=>{const f=bundleFixture();try{await assert.rejects(()=>verifyConsumerCapability(f.frontend),/lacks/);f.put(f.frontend,'tools/financial-correction-overlay.mjs',`export const FINANCIAL_CORRECTION_SCHEMA='financial-statement-projection-v1';export const verifyCorrectionCompatibility=()=>({});`);f.put(f.frontend,'tools/export-research.mjs','console.log("unapproved dependency injection is not compatibility");');await assert.rejects(()=>verifyConsumerCapability(f.frontend),/does not execute/);}finally{f.cleanup();}});

test('out-of-cohort source financial values remain immutable',async()=>{const f=bundleFixture();try{f.change('static-data/research-index-aaaaaaaaaaaaaaaa.json',v=>v.rows[0].eps_growth_yy=25);await assert.rejects(()=>compareCorrectionData(f.before,f.after,f.frontend,{financial_generation:H,symbols:{}}),{message:'Correction changed US research rows at $["rows"]["AAA"]["eps_growth_yy"]'});}finally{f.cleanup();}});
test('out-of-cohort EPS chart series remain immutable',async()=>{const f=bundleFixture();try{for(const base of [f.before,f.after]){const p='static-data/charts/AAA.json',v=JSON.parse(readFileSync(join(base,p)));v.eps_line=[{time:'2026-10-02',value:1}];f.put(base,p,v);}f.change('static-data/charts/AAA.json',v=>v.eps_line=[]);await assert.rejects(()=>compareCorrectionData(f.before,f.after,f.frontend,{financial_generation:H,symbols:{}}),/full chart/);}finally{f.cleanup();}});
test('a US cohort ticker does not authorize another market financials',async()=>{const f=bundleFixture();try{for(const base of [f.before,f.after]){const p='static-data/research-index-aaaaaaaaaaaaaaaa.json',v=JSON.parse(readFileSync(join(base,p)));v.rows[0].market='JP';f.put(base,p,v);}f.change('static-data/research-index-aaaaaaaaaaaaaaaa.json',v=>v.rows[0].eps_growth_yy=25);await assert.rejects(f.check,/research rows/);}finally{f.cleanup();}});
test('retained historical financial audit cannot be rewritten as a current field',async()=>{const f=bundleFixture();try{for(const base of [f.before,f.after]){const p='static-data/research-details/AAA-aaaaaaaaaaaaaaaa.json',v=JSON.parse(readFileSync(join(base,p)));v.financial_historical={values:{eps_rating:77}};f.put(base,p,v);}f.change('static-data/research-details/AAA-aaaaaaaaaaaaaaaa.json',v=>v.financial_historical.values.eps_rating=99);await assert.rejects(f.check,/retained financial audit/);}finally{f.cleanup();}});
for(const field of ['as_of_date','universe_size','liquidity','generated_at','unexpected'])test(`mixed derived daily file retains ${field}`,async()=>{const f=bundleFixture();try{for(const base of [f.before,f.after])f.put(base,'research-daily.json',{as_of_date:'2026-10-02',universe_size:1,liquidity:{min_price_usd:10},generated_at:'2026-10-02T20:00:00Z',candidates:{},ibd_comparison:null});f.change('research-daily.json',v=>v[field]='tampered');await assert.rejects(f.check,/protected derived metadata/);}finally{f.cleanup();}});
test('unprojected top-level history entries remain immutable',async()=>{const f=bundleFixture();try{for(const base of [f.before,f.after])f.put(base,'static-data/financial-history.json',{as_of_date:'2026-10-02',results:{AAA:null,OTHER:{annual:[{end:'2025-12-31',eps:1}]}}});f.change('static-data/financial-history.json',v=>v.results.OTHER.annual[0].eps=10);await assert.rejects(f.check,/protected derived metadata/);}finally{f.cleanup();}});
test('source scan may duplicate its initial rows in full-universe chunks',async()=>{const f=bundleFixture();try{for(const base of [f.before,f.after]){const p='static-data/scan.json',v=JSON.parse(readFileSync(join(base,p)));f.put(base,'static-data/chunk.json',{as_of_date:'2026-10-02',rows:v.initial_rows});v.chunks=[{path:'chunk.json',count:1}];f.put(base,p,v);}await f.check();}finally{f.cleanup();}});
function chunkedFixture(){const f=bundleFixture();for(const base of [f.before,f.after]){
 const scan=JSON.parse(readFileSync(join(base,'static-data/scan.json'))),row=scan.initial_rows[0];
 f.put(base,'static-data/chunk-a.json',{as_of_date:'2026-10-02',offset:0,rows:[row,{...row,symbol:'BBB'}]});
 f.put(base,'static-data/chunk-b.json',{as_of_date:'2026-10-02',offset:2,rows:[{...row,symbol:'CCC'}]});
 scan.chunks=[{path:'chunk-a.json',count:2},{path:'chunk-b.json',count:1}];f.put(base,'static-data/scan.json',scan);
 }return f;}
test('scan row order stays irrelevant within and across chunks while ordered metadata is preserved',async()=>{const f=chunkedFixture();try{
 const a=JSON.parse(readFileSync(join(f.after,'static-data/chunk-a.json'))),b=JSON.parse(readFileSync(join(f.after,'static-data/chunk-b.json')));
 [a.rows[0],b.rows[0]]=[b.rows[0],a.rows[0]];a.rows.reverse();f.put(f.after,'static-data/chunk-a.json',a);f.put(f.after,'static-data/chunk-b.json',b);await f.check();
 }finally{f.cleanup();}});
for(const [label,path,mutate]of[
 ['cross-chunk duplicate','static-data/chunk-b.json',v=>v.rows[0].symbol='AAA'],
 ['missing symbol','static-data/chunk-b.json',v=>v.rows=[]],
 ['extra symbol','static-data/chunk-b.json',v=>v.rows.push({...v.rows[0],symbol:'DDD'})],
 ['nonfinancial row value','static-data/chunk-b.json',v=>v.rows[0].current_price=101],
 ['chunk metadata value','static-data/chunk-b.json',v=>v.offset=3],
 ['ordered chunk metadata','static-data/scan.json',v=>v.chunks.reverse()],
 ])test(`scan canonical comparison rejects ${label}`,async()=>{const f=chunkedFixture();try{f.change(path,mutate);await assert.rejects(f.check);}finally{f.cleanup();}});
test('untouched non-US market needs no US research consumer and remains byte-bound',async()=>{const f=bundleFixture();try{for(const base of [f.before,f.after]){const p='static-data/manifest.json',v=JSON.parse(readFileSync(join(base,p)));v.supported_markets.push('JP');v.markets.JP={as_of_date:'2026-10-02',pages:{home:{path:'jp/home.json'}}};f.put(base,p,v);f.put(base,'static-data/jp/home.json',{price:100});}await f.check();f.change('static-data/jp/home.json',v=>v.price=101);await assert.rejects(f.check,/unowned/);}finally{f.cleanup();}});
test('correction workflow cannot upload or deploy Pages during preparation',()=>{const value=readFileSync(new URL('../workflows/research-ui-release.yml',import.meta.url),'utf8');assert.match(value,/actions\/upload-pages-artifact@v4\n\s+if: steps.plan.outputs.publish == 'true' && steps.plan.outputs.correction != 'true'/);assert.match(value,/name: Deploy to GitHub Pages\n\s+if: steps.plan.outputs.publish == 'true' && steps.plan.outputs.correction != 'true'/);assert.match(value,/financial-correction-candidate-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);});

function validReceipt(){
 const check=(name,i,design=false)=>({workflow:`.github/workflows/${design?'design-acceptance.yml':'ci.yml'}`,run_id:10+(design?1:0),run_attempt:1,job_id:i+1,name,head_sha:SHA});
 return {schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,
 previous_publication:{identity:intent().previous_publication_identity,ui_sha:SHA,ui_digest:H,data_inventory_sha256:H,artifact_id:20,artifact_sha256:H,financial_generation:'legacy-none'},source:source(),
 target:{markets:{US:'2026-10-02'},universe_sha256:H,semantic_sha256:H,price_observations_sha256:H,known_price_dates_sha256:H},
 financial:{generation:H,projection_path:`static-data/financial-corrections/projection-${H}.json`,projection_sha256:H,receipt_inventory_sha256:H,evaluated_at:'2026-10-04T12:00:00Z',knowledge_basis:contract.knowledge_basis,point_in_time:false,source_publication_date:null,policy:{id:contract.policy_id,contract_sha256:H,projector_sha256:H},source_timestamp_bounds:{earliest:'2026-10-04T11:00:00Z',latest:'2026-10-04T11:01:00Z'},scope:{symbols:2,fields:contract.financial_fields},unavailable_reasons:{'2':10}},
 validation:{controller_sha:SHA,required_checks:contract.required_ci_jobs.map((name,i)=>check(name,i)),consumer_checks:[...contract.required_ci_jobs.map((name,i)=>check(name,i)),check('Real-data design and performance budgets',10,true)],consumer_sha:SHA,ui_digest:H,compatibility_sha256:H,data_inventory_sha256:H}};
}
test('computed receipt is closed and binds exact required controller/consumer jobs',()=>{assert.deepEqual(validateCorrectionReceipt(validReceipt()),validReceipt());for(const mutate of [v=>v.success=true,v=>v.validation.success=true,v=>v.financial.policy.success=true,v=>v.validation.required_checks[0].head_sha='c'.repeat(40),v=>v.validation.consumer_checks.pop(),v=>v.financial.source_timestamp_bounds.latest='2026-10-05T00:00:00Z',v=>v.financial.scope.fields=['anything'],v=>v.previous_publication.financial_generation=null]){const value=validReceipt();mutate(value);assert.throws(()=>validateCorrectionReceipt(value));}});

test('chart-root financial aliases share bounded row ownership while bars stay protected',async()=>{const f=bundleFixture();try{for(const base of [f.before,f.after]){const p='static-data/charts/AAA.json',v=JSON.parse(readFileSync(join(base,p)));v.eps_growth_yy=null;f.put(base,p,v);}f.change('static-data/charts/AAA.json',v=>v.eps_growth_yy=25);await f.check();f.change('static-data/charts/AAA.json',v=>v.bars[0].close=101);await assert.rejects(f.check,/full chart/);}finally{f.cleanup();}});

// Lock the existing canonical proof while testing only failure diagnostics.
test('mismatch diagnostics preserve semantic and universe digests',async()=>{const f=bundleFixture();try{
 const result=await f.check();
 assert.equal(result.semantic_sha256,'ef4d74921140f0755c11e3147b62366c4d19893b5e6c1a7fa7d2741d9914f2dd');
 assert.equal(result.universe_sha256,'7589348579c8aa6cc02f8922477cafb4ab35ea9b765abaf397faae6ec610b966');
 // Canonical object order and allowed fields do not change the proof.
 for(const base of [f.before,f.after]){
   const path='static-data/research-index-aaaaaaaaaaaaaaaa.json',value=JSON.parse(readFileSync(join(base,path)));
   if(base===f.after){value.rows[0].eps_growth_yy=25;value.rows[0]=Object.fromEntries(Object.entries(value.rows[0]).reverse());}
   f.put(base,path,value);
 }
 assert.equal((await f.check()).semantic_sha256,result.semantic_sha256);
 }finally{f.cleanup();}});
test('protected price failure reports the first canonical symbol and key',async()=>{const f=bundleFixture();try{
 f.change('static-data/research-index-aaaaaaaaaaaaaaaa.json',v=>{v.rows[0].z_later_change=true;v.rows[0].current_price=101;});
 await assert.rejects(f.check,{message:'Correction changed US research rows at $["rows"]["AAA"]["current_price"]'});
 }finally{f.cleanup();}});
test('unowned financial field reports its exact symbol and key',async()=>{const f=bundleFixture();try{
 f.change('static-data/research-index-aaaaaaaaaaaaaaaa.json',v=>v.rows[0].financial_forecast=25);
 await assert.rejects(f.check,{message:'Correction changed US research rows at $["rows"]["AAA"]["financial_forecast"]'});
 }finally{f.cleanup();}});
for(const [label,mutate,suffix]of[
 ['protected price',v=>v.rows[0].current_price=101,'["CCC"]["current_price"]'],
 ['out-of-cohort financial',v=>v.rows[0].eps_growth_yy=25,'["CCC"]["eps_growth_yy"]'],
 ['missing symbol',v=>v.rows=[],'["CCC"]'],
 ['extra symbol',v=>v.rows.push({...v.rows[0],symbol:'DDD'}),'["DDD"]'],
])test(`streamed scan reports ${label} location`,async()=>{const f=chunkedFixture();try{
 f.change('static-data/chunk-b.json',mutate);
 await assert.rejects(f.check,{message:`Correction changed US scan path rows and metadata at $["rows"]${suffix}`});
 }finally{f.cleanup();}});
function protectedDiagnosticFixture(beforeValue,afterValue,key='financial_unowned'){
 const f=bundleFixture(),path='static-data/research-index-aaaaaaaaaaaaaaaa.json';
 for(const [base,value]of[[f.before,beforeValue],[f.after,afterValue]]){
   const data=JSON.parse(readFileSync(join(base,path)));data.rows[0][key]=value;f.put(base,path,data);
 }
 return f;
}
test('array diagnostics report the first differing index without dumping rows',async()=>{
 const before=Array.from({length:4096},(_,index)=>({eps:index})),after=structuredClone(before);after[4095].eps=-1;
 const f=protectedDiagnosticFixture(before,after);try{
 await assert.rejects(f.check,{message:'Correction changed US research rows at $["rows"]["AAA"]["financial_unowned"][4095]["eps"]'});
 }finally{f.cleanup();}});
test('array length diagnostics report the first missing index',async()=>{const f=protectedDiagnosticFixture([1,2],[1]);try{
 await assert.rejects(f.check,{message:'Correction changed US research rows at $["rows"]["AAA"]["financial_unowned"][1]'});
 }finally{f.cleanup();}});
test('large scalar diagnostics include only the path',async()=>{const f=protectedDiagnosticFixture('PRIVATE_BEFORE'.repeat(100000),'PRIVATE_AFTER'.repeat(100000));try{
 await assert.rejects(f.check,{message:'Correction changed US research rows at $["rows"]["AAA"]["financial_unowned"]'});
 }finally{f.cleanup();}});
test('diagnostic keys are escaped',async()=>{const f=protectedDiagnosticFixture(1,2,'financial_unowned["x"]\n');try{
 await assert.rejects(f.check,{message:String.raw`Correction changed US research rows at $["rows"]["AAA"]["financial_unowned[\"x\"]\n"]`});
 }finally{f.cleanup();}});
for(const kind of ['depth','long key','escaped long key'])test(`diagnostics bound ${kind}`,async()=>{
 const nested=value=>Array.from({length:80}).reduce(result=>({child:result}),value);
 const f=kind==='depth'?protectedDiagnosticFixture(nested(1),nested(2)):protectedDiagnosticFixture(1,2,(kind==='long key'?'x':'\n').repeat(100000));
 try{await assert.rejects(f.check,error=>{
   if(kind==='depth'){assert.match(error.message,/diagnostic search limit reached at \$\["rows"\]\["AAA"\]/);assert.match(error.message,/mismatch unresolved/);}
   else assert.match(error.message,/mismatch diagnostic truncated at \$\["rows"\]\["AAA"\]/);
   assert.ok(error.message.length<512);return true;
 });}finally{f.cleanup();}
});

test('equal deep branch before a changed price reports an unresolved diagnostic location',async()=>{
 const nested=Array.from({length:80}).reduce(result=>({child:result}),1);
 const f=protectedDiagnosticFixture(nested,nested,'aaa_deep');try{
   f.change('static-data/research-index-aaaaaaaaaaaaaaaa.json',v=>v.rows[0].current_price=101);
   await assert.rejects(f.check,error=>{
     assert.match(error.message,/^Correction changed US research rows \(diagnostic search limit reached at \$\["rows"\]\["AAA"\]\["aaa_deep"\]/);
     assert.match(error.message,/; mismatch unresolved\)$/);
     assert.doesNotMatch(error.message,/mismatch diagnostic truncated|current_price/);
     assert.ok(error.message.length<512);return true;
   });
 }finally{f.cleanup();}});
