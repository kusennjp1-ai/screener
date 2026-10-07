// One isolated public-API transport experiment. No source/publication authority.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createRetainedPriceLiveApi} from './retained-price-live-inventory.mjs';

const repo='kusennjp1-ai/screener',repoId=1203919607;
const workflows=[['research-ui-release.yml',364666954],['static-site.yml',294257497]];
const named=file=>'repos/'+repo+'/actions/workflows/'+file+'/runs?branch=main&per_page=100';
const out=resolve(process.env.RUNNER_TEMP,'oct6-numeric-inventory-probe');
const hash=x=>createHash('sha256').update(x).digest('hex');
const started=performance.now(),deadline=started+110000;
const report={schema_version:'oct6-numeric-inventory-probe-v1',head:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID,
  attempt:process.env.GITHUB_RUN_ATTEMPT,started_at:new Date().toISOString(),source_authority:false,publication_authority:false,
  calls:[],inventories:[],comparison:null,status:'running'};
mkdirSync(out,{recursive:false});
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
let calls=0,bytes=0,denied=false;
function check(value,message){if(!value)throw Error(message);}
function parse(raw){
  const split=raw.search(/\r?\n\r?\n/);check(split>=0,'Incomplete HTTP headers');
  const header=raw.slice(0,split),body=raw.slice(split).replace(/^\r?\n\r?\n/,'');
  const status=Number(/^HTTP\/\S+\s+(\d{3})(?:\s|$)/.exec(header)?.[1]);
  const lines=header.split(/\r?\n/),values=name=>lines.slice(1).filter(x=>x.toLowerCase().startsWith(name+':')).map(x=>x.slice(name.length+1).trim());
  const quota=values('x-ratelimit-remaining'),retry=values('retry-after');
  if(status>=400||quota.includes('0')||retry.length){denied=true;throw Error('HTTP or quota denial; probe stopped');}
  check(status===200&&!/^\s*HTTP\//.test(body),'Unexpected HTTP response');
  const safe=lines.filter((line,i)=>i===0||/^(?:link|date|etag|last-modified|age|cache-control|content-type|content-length|x-ratelimit-(?:limit|remaining|reset|used|resource)|x-github-request-id):/i.test(line)).join('\n')+'\n';
  return {body,safe,header,status,link:values('link')};
}
function read(command,args,options={}){
  check(!denied,'Probe already stopped on denial');
  check(command==='gh'&&args.length===3&&args[0]==='api'&&args[1]==='--include','Unexpected probe command');
  check(bytes<128*1024**2,'Probe byte bound');
  check(++calls<=24,'Probe call bound');
  const remaining=Math.floor(deadline-performance.now());check(remaining>0,'Probe time bound');
  const name=String(calls).padStart(2,'0'),entry={call:calls,route:args[2],started_at:new Date().toISOString()};
  report.calls.push(entry);save();
  let raw;
  try{
    raw=execFileSync(command,args,{...options,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:Math.min(options.maxBuffer??16*1024**2,128*1024**2-bytes),
      timeout:Math.min(options.timeout??15000,remaining,15000),killSignal:'SIGKILL'});
    bytes+=Buffer.byteLength(raw);check(bytes<=128*1024**2,'Probe byte bound');
    entry.raw={bytes:Buffer.byteLength(raw),sha256:hash(raw)};
    const parsed=parse(raw);
    writeFileSync(join(out,name+'-body.json'),parsed.body);
    writeFileSync(join(out,name+'-safe-headers.txt'),parsed.safe);
    entry.body={bytes:Buffer.byteLength(parsed.body),sha256:hash(parsed.body)};
    entry.raw_header_sha256=hash(parsed.header);
    const value=JSON.parse(parsed.body);
    entry.total_count=value.total_count;entry.rows=value.workflow_runs?.length;
    if(Array.isArray(value.workflow_runs)&&value.workflow_runs.length<=100){
      entry.ids=value.workflow_runs.map(r=>r.id);entry.ids_sha256=hash(JSON.stringify(entry.ids));
    }
    entry.status='received';return raw;
  }catch(error){
    entry.status='failed';entry.error=denied?'HTTP or quota denial':String(error.message).slice(0,500);
    if(error.stderr)entry.stderr={bytes:Buffer.byteLength(error.stderr),sha256:hash(error.stderr)};
    if(error.stdout){const failedBytes=Buffer.byteLength(error.stdout);bytes+=failedBytes;entry.failed_stdout={bytes:failedBytes,sha256:hash(error.stdout)};}
    if(bytes>=128*1024**2)entry.byte_budget_exhausted=true;
    if(/HTTP(?:\/\S+)?\s+[45]\d\d\b|\b(?:401|403|429)\b|rate.?limit|retry-after|unauthori[sz]ed|forbidden|denied|authentication|authorization|certificate|\bx509\b|\bTLS\b|\bSSL\b|\bSSO\b/i.test(String(error.stderr??'')))denied=true;
    throw error;
  }finally{entry.ended_at=new Date().toISOString();save();}
}
function value(raw){return JSON.parse(parse(raw).body);}
function namedNext(raw){
  const {link,body}=parse(raw),page=JSON.parse(body);
  if(page.total_count<=100){check(page.workflow_runs.length===page.total_count&&link.length===0,'Incoherent terminal named page');return null;}
  check(page.workflow_runs.length===100,'Incomplete named first page');
  check(link.length===1,'Expected one Link header');
  const relations=new Map();
  for(const part of link[0].split(',')){
    const m=/^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(part);
    check(m&&!relations.has(m[2]),'Invalid Link');
    const u=new URL(m[1]);check(u.origin==='https://api.github.com'&&!u.username&&!u.password&&!u.hash,'Foreign Link');
    check(['/repos/'+repo,'/repositories/'+repoId].some(p=>['static-site.yml','294257497'].some(w=>u.pathname===p+'/actions/workflows/'+w+'/runs')),'Changed named route');
    const p=[...u.searchParams];check(p.length===3&&new Set(p.map(x=>x[0])).size===3&&u.searchParams.get('branch')==='main'&&u.searchParams.get('per_page')==='100'&&/^[1-9]\d*$/.test(u.searchParams.get('page')??''),'Changed Link query');
    relations.set(m[2],u);
  }
  check(relations.get('next')?.searchParams.get('page')==='2','Expected next page2');
  const u=relations.get('next');return u.pathname.slice(1)+u.search;
}
function identity(page){
  check(Number.isSafeInteger(page.total_count)&&page.total_count>=0&&Array.isArray(page.workflow_runs)&&page.workflow_runs.length<=100,'Invalid comparison page');
  const ids=new Set();
  for(const row of page.workflow_runs){
    check(Number.isSafeInteger(row.id)&&row.id>0&&!ids.has(row.id)&&row.workflow_id===294257497&&row.path==='.github/workflows/static-site.yml'&&row.head_branch==='main'
      &&['repository','head_repository'].every(k=>row[k]?.id===repoId&&row[k]?.full_name===repo),'Wrong comparison row identity');
    ids.add(row.id);
  }
  return ids;
}
try{
  check(process.env.GITHUB_REPOSITORY===repo&&process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_REF==='refs/heads/preview/oct6-numeric-inventory-probe-20261007'&&process.env.GITHUB_RUN_ATTEMPT==='1','Wrong probe invocation');
  check(execFileSync('git',['rev-parse','HEAD^'],{encoding:'utf8'}).trim()==='f65596befa62622d93aa9d75d3f6bb024e1e60c4','Wrong probe parent');
  check(Date.now()<Date.parse('2026-10-07T21:30:00Z'),'Probe window expired');
  const firstRaw=read('gh',['api','--include',named('static-site.yml')]),first=value(firstRaw),firstIds=identity(first);
  const next=namedNext(firstRaw),secondRaw=next?read('gh',['api','--include',next]):null;
  const second=secondRaw?value(secondRaw):null,secondIds=second?identity(second):new Set();
  report.comparison={authority:false,named_pages:second?2:1,first_total:first.total_count,second_total:second?.total_count??null,
    overlapping_ids:[...secondIds].filter(id=>firstIds.has(id))};
  save();
  const api=createRetainedPriceLiveApi(()=>{throw Error('Unexpected delegated API');},{run:read,report:e=>{report.inventories.push(e);save();console.log(JSON.stringify(e));}});
  for(let round=1;round<=2;round++)for(const[file]of workflows){
    const pages=api(named(file),true);
    report.inventories.at(-1).probe_round=round;
    report.inventories.at(-1).accepted_count=pages.reduce((n,p)=>n+p.workflow_runs.length,0);save();
  }
  report.status='passed';
}catch(error){
  report.status='failed';report.failure=String(error.message).slice(0,500);process.exitCode=1;
}finally{
  report.finished_at=new Date().toISOString();report.elapsed_ms=Math.ceil(performance.now()-started);report.total_raw_bytes=bytes;
  save();console.log(JSON.stringify({status:report.status,comparison:report.comparison,call_count:calls,elapsed_ms:report.elapsed_ms}));
}
