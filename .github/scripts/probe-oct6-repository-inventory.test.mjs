import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSnapshot,validatePage,project,route} from './probe-oct6-repository-inventory.mjs';

const repo='kusennjp1-ai/screener',RID=1203919607;
function row(id,extra={}){return{id,workflow_id:294257497,path:'.github/workflows/static-site.yml',head_branch:'main',
 repository:{id:RID,full_name:repo},head_repository:{id:RID,full_name:repo},run_attempt:1,head_sha:'a'.repeat(40),
 created_at:'2020-01-01T00:00:00Z',updated_at:'2026-10-07T22:00:00Z',run_started_at:'2026-10-07T21:59:00Z',...extra};}
const link=(page,total)=>{
 const count=Math.max(1,Math.ceil(total/50)),rel=[];
 if(page<count)rel.push('<https://api.github.com/'+route(page+1)+'>; rel="next"');
 if(page>1)rel.push('<https://api.github.com/'+route(page-1)+'>; rel="prev"');
 if(count>1)rel.push('<https://api.github.com/'+route(count)+'>; rel="last"');
 return rel.join(', ');
};
const response=(page,total)=>({value:{total_count:total,workflow_runs:Array.from({length:Math.min(50,Math.max(0,total-(page-1)*50))},(_,i)=>row((page-1)*50+i+1))},link:link(page,total)});
async function fixture(total,change=()=>{}){
 const controller=new AbortController(),calls=[];let active=0,max=0;
 const read=async n=>{calls.push(n);active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));
 try{if(controller.signal.aborted)throw Error('aborted fixture');const r=response(n,total);change(r,n);return r;}finally{active--;}};
 try{return{result:await collectSnapshot({read,signal:controller.signal,abort:e=>controller.abort(e)}),calls,max,active};}
 catch(error){return{error,calls,max,active,aborted:controller.signal.aborted};}
}
test('complete unfiltered inventory exceeds search cap without losing old or non-main runs',async()=>{
 const f=await fixture(1311,(p,n)=>{if(n===1)p.value.workflow_runs[0]=row(1,{run_attempt:3,head_branch:'main'});});
 assert.equal(f.error,undefined);assert.equal(f.result.runs.length,1311);assert.equal(f.result.pages.length,27);
 assert.equal(f.max,3);assert.equal(f.active,0);assert.deepEqual([...f.calls].sort((a,b)=>a-b),Array.from({length:27},(_,i)=>i+1));
 assert.equal(f.result.runs[0].created_at,'2020-01-01T00:00:00Z');assert.equal(f.result.runs[0].run_attempt,3);
 assert.throws(()=>project(f.result.runs,294257497),/Projected workflow bound/);
});
test('projection retains every matching main attempt regardless of age status or event',()=>{
 const runs=[row(1,{run_attempt:5,event:'workflow_dispatch',status:'failure'}),row(2,{head_branch:'preview/a'}),
 row(3,{head_repository:{id:999,full_name:'foreign/repo'}}),row(4,{workflow_id:364666954,path:'.github/workflows/research-ui-release.yml'}),
 row(5,{workflow_id:555,path:'dynamic/pages'})];
 validatePage({total_count:runs.length,workflow_runs:runs},'',1);
 assert.deepEqual(project(runs,294257497),[runs[0]]);assert.deepEqual(project(runs,364666954),[runs[3]]);
});
test('single-page empty and exact full-page snapshots terminate without inventing pages',async()=>{
 for(const total of[0,1,50]){const f=await fixture(total);assert.equal(f.error,undefined);assert.equal(f.result.total,total);assert.deepEqual(f.calls,[1]);}
});
test('cross-page duplicate IDs reject the complete snapshot',async()=>{
 const f=await fixture(151,(p,n)=>{if(n===4)p.value.workflow_runs[0]=row(1);});
 assert.match(f.error.message,/duplicate/);assert.equal(f.result,undefined);assert.equal(f.active,0);
});
test('changing totals abort siblings and never return a partial snapshot',async()=>{
 const f=await fixture(351,(p,n)=>{if(n===2)p.value.total_count=352;});
 assert.match(f.error.message,/total changed/);assert.equal(f.aborted,true);assert(f.calls.length<=4);assert.equal(f.active,0);
});
test('missing rows incorrect origin and pinned-workflow conflicts fail closed',()=>{
 const base=response(1,1);
 for(const mutate of[
 p=>p.value.workflow_runs=[],
 p=>p.value.workflow_runs[0].repository.id=999,
 p=>p.value.workflow_runs[0].head_repository.id=999,
 p=>p.value.workflow_runs[0].head_repository.full_name='foreign/repo',
 p=>p.value.workflow_runs[0].head_sha='bad',
 p=>p.value.workflow_runs[0].run_attempt=0,
 p=>p.value.workflow_runs[0].path='.github/workflows/other.yml',
 p=>p.value.workflow_runs[0].workflow_id=555,
 p=>p.value.total_count=2001]){
 const p=structuredClone(base);mutate(p);assert.throws(()=>validatePage(p.value,p.link,1));}
});
test('Links cannot add filters change origin skip pages or silently stop early',()=>{
 const p=response(1,151);
 for(const bad of[
 p.link.replace('api.github.com','foreign.example'),
 p.link.replace('per_page=50','per_page=100'),
 p.link.replace('page=2','page=3'),
 p.link.replace('page=2','page=2&branch=main'),
 p.link.replace('page=2','page=2&created=2026'),
 p.link.replace('/actions/runs','/actions/workflows/294257497/runs'),
 p.link+', '+p.link,
 '']){
 assert.throws(()=>validatePage(p.value,bad,1));}
});
test('only the exact repository-name alias is accepted in returned Links',()=>{
 const p=response(1,51),alias=p.link.replaceAll('repositories/'+RID,'repos/'+repo);
 assert.equal(validatePage(p.value,alias,1),51);
 assert.throws(()=>validatePage(p.value,alias.replaceAll(repo,'foreign/repo'),1));
});
test('transport failure cancels the bounded sibling group without retry',async()=>{
 const c=new AbortController(),calls=[];let active=0;
 await assert.rejects(collectSnapshot({signal:c.signal,abort:e=>c.abort(e),read:async n=>{
 calls.push(n);if(n===1)return response(1,301);active++;await new Promise(r=>setImmediate(r));
 try{if(n===2)throw Error('HTTP403 fixture');if(c.signal.aborted)throw Error('aborted');return response(n,301);}finally{active--;}
 }}),/HTTP403 fixture/);
 assert.deepEqual(calls,[1,2,3,4]);assert.equal(active,0);assert.equal(c.signal.aborted,true);
});

test('a syntactically complete but stale or empty snapshot cannot omit required real runs',async()=>{
 for(const total of[0,1]){
 const c=new AbortController();
 await assert.rejects(collectSnapshot({read:async n=>response(n,total),signal:c.signal,abort:e=>c.abort(e),requiredIds:[2]}),/Required real run absent/);
 }
 const c=new AbortController(),r=await collectSnapshot({read:async n=>response(n,51),signal:c.signal,abort:e=>c.abort(e),requiredIds:[1,51]});
 assert.equal(r.total,51);
});
