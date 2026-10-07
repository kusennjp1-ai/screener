// Isolated read-only experiment: complete unfiltered repository inventories.
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,statfsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const REPO='kusennjp1-ai/screener',RID=1203919607,PER=50,MAX_RUNS=2000,MAX_BYTES=64*1024**2;
const workflows=new Map([[364666954,'research-ui-release.yml'],[294257497,'static-site.yml']]);
const hash=v=>createHash('sha256').update(v).digest('hex'),utc=v=>typeof v==='string'&&v.endsWith('Z')&&Number.isFinite(Date.parse(v));
const check=(v,m)=>{if(!v)throw Error(m);},obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const route=page=>'repositories/'+RID+'/actions/runs?per_page=50&page='+page;
export function validatePage(value,link,page,total=null){
  check(obj(value)&&Number.isSafeInteger(value.total_count)&&value.total_count>=0&&value.total_count<=MAX_RUNS&&Array.isArray(value.workflow_runs),'Invalid repository inventory schema or bound');
  const count=value.total_count,last=Math.max(1,Math.ceil(count/PER));
  check(total===null||count===total,'Repository total changed');
  check(page<=last&&value.workflow_runs.length===Math.min(PER,Math.max(0,count-(page-1)*PER)),'Incomplete repository page');
  const ids=new Set();
  for(const r of value.workflow_runs){
    check(obj(r)&&Number.isSafeInteger(r.id)&&r.id>0&&!ids.has(r.id),'Invalid or duplicate run');ids.add(r.id);
    check(r.repository?.id===RID&&r.repository?.full_name===REPO,'Foreign repository run');
    check(obj(r.head_repository)&&Number.isSafeInteger(r.head_repository.id)&&r.head_repository.id>0&&typeof r.head_repository.full_name==='string'&&r.head_repository.full_name.length<=256,'Invalid head repository');
    check((r.head_repository.id===RID)===(r.head_repository.full_name===REPO),'Conflicting head repository identity');
    check(Number.isSafeInteger(r.workflow_id)&&r.workflow_id>0&&typeof r.path==='string'&&r.path.length>0&&r.path.length<=512
      &&(r.head_branch===null||typeof r.head_branch==='string'&&r.head_branch.length>0&&r.head_branch.length<=256)
      &&Number.isSafeInteger(r.run_attempt)&&r.run_attempt>0&&/^[a-f0-9]{40}$/.test(r.head_sha??'')
      &&utc(r.created_at)&&utc(r.updated_at)&&(r.run_started_at===null||utc(r.run_started_at)),'Invalid run identity or clocks');
    for(const[id,file]of workflows)check((r.workflow_id===id)===(r.path==='.github/workflows/'+file),'Conflicting pinned workflow identity');
  }
  const relations=new Map();
  for(const part of link?link.split(','):[]){
    const m=/^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(part);check(m&&!relations.has(m[2]),'Invalid Link');
    const u=new URL(m[1]),q=[...u.searchParams],n=u.searchParams.get('page');
    check(u.origin==='https://api.github.com'&&!u.username&&!u.password&&!u.hash
      &&['/repos/'+REPO+'/actions/runs','/repositories/'+RID+'/actions/runs'].includes(u.pathname),'Foreign Link');
    check(q.length===2&&new Set(q.map(x=>x[0])).size===2&&u.searchParams.get('per_page')==='50'
      &&/^[1-9]\d*$/.test(n??'')&&Number(n)<=last,'Filtered or invalid Link');
    relations.set(m[2],Number(n));
  }
  check(page<last?relations.get('next')===page+1:!relations.has('next'),'Missing or extra next page');
  for(const[k,n]of [['prev',page-1],['first',1],['last',last]])check(!relations.has(k)||relations.get(k)===n,'Inconsistent Link');
  return count;
}
export function project(runs,id){
  const file=workflows.get(id);check(file,'Unknown workflow projection');
  const out=runs.filter(r=>r.workflow_id===id&&r.path==='.github/workflows/'+file&&r.head_branch==='main'
    &&r.repository.id===RID&&r.repository.full_name===REPO&&r.head_repository.id===RID&&r.head_repository.full_name===REPO);
  check(out.length<=1000,'Projected workflow bound');return out;
}
export async function collectSnapshot({read,signal,abort,requiredIds=[]}){
  const first=await read(1),total=validatePage(first.value,first.link,1),count=Math.max(1,Math.ceil(total/PER)),pages=[first.value];
  let next=2,failure=null;
  const worker=async()=>{while(next<=count&&!signal.aborted){const n=next++;try{
    const p=await read(n);validatePage(p.value,p.link,n,total);pages[n-1]=p.value;
  }catch(e){failure??=e;abort(e);return;}}};
  await Promise.allSettled(Array.from({length:Math.min(3,Math.max(0,count-1))},worker));
  if(failure)throw failure;check(!signal.aborted&&pages.length===count&&pages.every(Boolean),'Incomplete or aborted snapshot');
  const runs=pages.flatMap(p=>p.workflow_runs);
  const ids=new Set(runs.map(r=>r.id));
  check(runs.length===total&&ids.size===total,'Incomplete or duplicate complete inventory');
  check(Array.isArray(requiredIds)&&requiredIds.every(id=>Number.isSafeInteger(id)&&id>0&&ids.has(id)),'Required real run absent from complete inventory');
  return {total,pages,runs};
}
async function main(){
  check(process.env.GITHUB_REPOSITORY===REPO&&process.env.GITHUB_EVENT_NAME==='push'
    &&process.env.GITHUB_REF==='refs/heads/preview/oct6-repository-inventory-probe-20261007'&&process.env.GITHUB_RUN_ATTEMPT==='1','Wrong probe invocation');
  check(execFileSync('git',['rev-parse','HEAD^'],{encoding:'utf8'}).trim()==='c532430b7f8bf2c6c59075a5066fb103320408ae','Wrong probe parent');
  check(Date.now()<Date.parse('2026-10-07T23:15:00Z'),'Probe window expired');
  check(typeof process.env.GH_TOKEN==='string'&&process.env.GH_TOKEN.length>0,'Missing existing Actions token');
  const out=resolve(process.env.RUNNER_TEMP,'oct6-repository-inventory-probe');mkdirSync(out,{recursive:false});
  const free=()=>{const s=statfsSync(out);return s.bavail*s.bsize;};check(free()>=8589934592+2*MAX_BYTES,'Insufficient artifact reserve');
  const report={schema_version:'oct6-repository-inventory-probe-v1',head:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID,run_attempt:1,
    source_authority:false,publication_authority:false,started_at:new Date().toISOString(),status:'running',snapshots:[]};
  const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  let used=0,allIds=null,allProjected=null;
  try{
    for(let round=1;round<=2;round++){
      const start=performance.now(),limit=Math.min(30000,60000-used),controller=new AbortController();
      check(limit>0,'Shared time bound');const timer=setTimeout(()=>controller.abort(Error('Snapshot deadline')),limit);
      const rec={round,required_run_ids:[37456692717,37693010388,Number(process.env.GITHUB_RUN_ID)],started_at:new Date().toISOString(),status:'running',pages:[],bytes:0,max_active:0},rows=[];
      report.snapshots.push(rec);save();let active=0,failed=null;
      const read=async page=>{
        check(!controller.signal.aborted,'Snapshot aborted');active++;rec.max_active=Math.max(rec.max_active,active);
        const item={page,route:route(page),started_at:new Date().toISOString()};rec.pages.push(item);
        try{
          const response=await fetch('https://api.github.com/'+route(page),{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+process.env.GH_TOKEN,'User-Agent':'oct6-finite-inventory-readback'},
            redirect:'error',cache:'no-store',signal:controller.signal});
          item.status=response.status;
          const headers=Object.fromEntries([...response.headers].filter(([k])=>/^(?:link|date|etag|last-modified|age|cache-control|content-type|content-length|x-ratelimit-(?:limit|remaining|reset|used|resource)|x-github-request-id)$/.test(k)));
          item.safe_headers=headers;
          check(response.status===200&&!response.headers.has('retry-after')&&response.headers.get('x-ratelimit-remaining')!=='0','HTTP or quota denial');
          const chunks=[];let n=0;
          for await(const chunk of response.body){n+=chunk.byteLength;rec.bytes+=chunk.byteLength;
            check(n<=8*1024**2&&rec.bytes<=MAX_BYTES,'Byte bound');chunks.push(chunk);}
          const body=Buffer.concat(chunks),text=body.toString('utf8');item.body={bytes:body.length,sha256:hash(body)};
          const base='round'+round+'-page'+String(page).padStart(2,'0');
          writeFileSync(join(out,base+'.json'),body);writeFileSync(join(out,base+'-safe-headers.json'),JSON.stringify(headers,null,2)+'\n');
          const value=JSON.parse(text);item.total_count=value.total_count;item.rows=value.workflow_runs?.length;
          if(Array.isArray(value.workflow_runs)&&value.workflow_runs.length<=PER)item.ids_sha256=hash(JSON.stringify(value.workflow_runs.map(r=>r.id)));
          return {value,link:response.headers.get('link')??''};
        }catch(error){failed??=error;controller.abort(error);item.error=String(error.message).slice(0,200);throw error;}
        finally{active--;item.finished_at=new Date().toISOString();save();}
      };
      try{
        const result=await collectSnapshot({read,signal:controller.signal,abort:e=>controller.abort(e),requiredIds:[37456692717,37693010388,Number(process.env.GITHUB_RUN_ID)]});
        if(failed)throw failed;
        const ids=result.runs.map(r=>r.id),projected=Object.fromEntries([...workflows].map(([id,file])=>[file,project(result.runs,id).map(r=>r.id)]));
        if(allIds!==null)check(JSON.stringify(ids)===JSON.stringify(allIds)&&JSON.stringify(projected)===JSON.stringify(allProjected),'Repeated complete ID sets changed');
        allIds=ids;allProjected=projected;
        rec.status='passed';rec.total_count=result.total;rec.page_count=result.pages.length;rec.ids_sha256=hash(JSON.stringify(ids));
        rec.projected=Object.fromEntries(Object.entries(projected).map(([file,list])=>[file,{count:list.length,ids_sha256:hash(JSON.stringify(list))}]));
        rec.inventory_sha256=hash(JSON.stringify(result.pages));
        writeFileSync(join(out,'round'+round+'-ids.json'),JSON.stringify({all:ids,projected})+'\n');
      }catch(e){rec.status='failed';rec.failure=String(e.message).slice(0,200);throw e;}
      finally{clearTimeout(timer);used+=Math.ceil(performance.now()-start);rec.elapsed_ms=Math.ceil(performance.now()-start);rec.budget_used_ms=used;save();}
      check(used<=60000&&free()>=8589934592,'Budget or reserve exceeded');
    }
    report.status='passed';
  }catch(error){report.status='failed';report.failure=String(error.message).slice(0,200);process.exitCode=1;}
  finally{report.finished_at=new Date().toISOString();report.total_inventory_ms=used;save();console.log(JSON.stringify(report));}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
