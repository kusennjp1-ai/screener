import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {preserveRenewalPriceHistory} from './financial-renewal-baseline.mjs';
import {sha256} from './publication-state.mjs';

const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));};
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'renewal-performance-preservation-')),before=join(root,'before'),after=join(root,'after');
  const report=JSON.stringify({as_of:'2026-10-05',cohorts:['2026-10-02'],original_observed_at:'2026-10-02T20:00:00Z'}),hash=sha256(report),name=`candidate-performance-${hash.slice(0,16)}.json`;
  const descriptor={path:name,sha256:hash,as_of_date:'2026-10-05'},manifest={markets:{US:{as_of_date:'2026-10-05',assets:{candidate_performance:descriptor,research:{path:'research-before.json'}}}}};
  write(join(before,'static-data/manifest.json'),manifest);write(join(before,'static-data',name),report);
  write(join(before,'static-data/candidate-performance-history/index.json'),{observations:[{source_observed_at:'2026-10-02T20:00:00Z'}]});
  write(join(before,'static-data/candidate-history/index.json'),{snapshots:[{as_of:'2026-10-02'},{as_of:'2026-10-05'}]});
  write(join(before,'static-data/prices.json'),{value:100});cpSync(before,after,{recursive:true});
  const generated=JSON.stringify({cohorts:['2026-10-02','2026-10-05']}),nextHash=sha256(generated),next=`candidate-performance-${nextHash.slice(0,16)}.json`;
  write(join(after,'static-data',next),generated);write(join(after,'static-data/candidate-performance-history/new.json'),{newly_frozen:'unrequested'});
  const compiled=structuredClone(manifest);compiled.markets.US.assets.candidate_performance={...descriptor,path:next,sha256:nextHash};compiled.markets.US.assets.research.path='research-compiled.json';write(join(after,'static-data/manifest.json'),compiled);
  return {root,before,after,report,name,next,descriptor,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('renewal retains exact published performance cohorts and original observations without changing the daily catalog or compiled financial outputs',()=>{
  const f=fixture();try{
    const catalog=readFileSync(join(f.before,'static-data/candidate-history/index.json')),prior=readFileSync(join(f.before,'static-data/manifest.json'));
    const report=preserveRenewalPriceHistory({predecessor:f.before,baseline:f.after});assert.equal(report.files,2);
    assert.equal(readFileSync(join(f.after,'static-data',f.name),'utf8'),f.report);assert.equal(existsSync(join(f.after,'static-data',f.next)),false);
    assert.equal(existsSync(join(f.after,'static-data/candidate-performance-history/new.json')),false);
    assert.deepEqual(readFileSync(join(f.after,'static-data/candidate-performance-history/index.json')),readFileSync(join(f.before,'static-data/candidate-performance-history/index.json')));
    assert.deepEqual(readFileSync(join(f.after,'static-data/candidate-history/index.json')),catalog);
    const manifest=JSON.parse(readFileSync(join(f.after,'static-data/manifest.json')));assert.deepEqual(manifest.markets.US.assets.candidate_performance,f.descriptor);assert.equal(manifest.markets.US.assets.research.path,'research-compiled.json');
    assert.deepEqual(readFileSync(join(f.before,'static-data/manifest.json')),prior);
    write(join(f.after,'static-data/prices.json'),{value:999});preserveRenewalPriceHistory({predecessor:f.before,baseline:f.after});
    assert.equal(JSON.parse(readFileSync(join(f.after,'static-data/prices.json'))).value,999,'strict downstream price comparator still sees unowned price mutation');
  }finally{f.cleanup();}
});
test('renewal performance preservation refuses changed original bytes, price dates, links or overlapping trees',()=>{
  for(const kind of ['hash','date','link','root-link','overlap']){const f=fixture();try{
    if(kind==='hash')write(join(f.before,'static-data',f.name),'rewritten');
    if(kind==='date'){const manifest=JSON.parse(readFileSync(join(f.after,'static-data/manifest.json')));manifest.markets.US.as_of_date='2026-10-06';write(join(f.after,'static-data/manifest.json'),manifest);}
    if(kind==='link')symlinkSync(join(f.before,'static-data',f.name),join(f.after,'static-data/candidate-performance-history/linked.json'));
    if(kind==='root-link'){rmSync(f.after,{recursive:true});symlinkSync(f.before,f.after,'dir');}
    assert.throws(()=>preserveRenewalPriceHistory({predecessor:f.before,baseline:kind==='overlap'?f.before:f.after}),/descriptor|price date|Linked|separate trees/);
  }finally{f.cleanup();}}
});
