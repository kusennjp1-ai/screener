import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const watchdog=fileURLToPath(new URL('./financial-lifecycle-watchdog.py',import.meta.url));
const diagnostics=new URL('./fixtures/financial-release-lifecycle-diagnostics.mjs',import.meta.url).href;
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const gone=pid=>{try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}};

function fixture(code,{timeout=2,allocationReason=null,heartbeat=30,preparedSeconds=null}={}){
  const root=mkdtempSync(join(tmpdir(),'lifecycle-watchdog-')),report=join(root,'report');
  const budgetArgs=[];
  if(preparedSeconds!==null){
    const clockPath=join(root,'job-clock.json'),clock=spawnSync('python3',['-c','import time;print(time.monotonic())'],{encoding:'utf8'});
    assert.equal(clock.status,0,clock.stderr);
    writeFileSync(clockPath,JSON.stringify({schema_version:'offline-financial-lifecycle-job-clock-v1',started_at:'fixture start',started_monotonic_seconds:Number(clock.stdout)-preparedSeconds}));
    budgetArgs.push('--job-clock',clockPath,'--job-timeout-seconds','5400','--upload-reserve-seconds','600','--minimum-runtime-seconds','3600');
  }
  const prefix=`import {mkdirSync,writeFileSync} from 'node:fs';
    import {createLifecycleDiagnostics} from ${JSON.stringify(diagnostics)};
    const root=${JSON.stringify(root)},directory=${JSON.stringify(report)};
    mkdirSync(directory);const report={phases:[]},progress=createLifecycleDiagnostics(directory,report);`;
  return {root,report,run(){return spawnSync('python3',[watchdog,'--timeout-seconds',String(timeout),'--heartbeat-seconds',String(heartbeat),...(allocationReason?['--allocation-reason',allocationReason]:[]),...budgetArgs,'--report-directory',report,'--',process.execPath,'--input-type=module','-e',prefix+code],
    {encoding:'utf8',timeout:6000,maxBuffer:1024*1024,env:{PATH:process.env.PATH}});},
    cleanup(){rmSync(root,{recursive:true,force:true});}};
}

test('external watchdog preserves success and reports real command/phase durations',()=>{
  const f=fixture(`progress.beginPhase('small successful phase');const command=progress.commandStart('node fixture');
    const end=performance.now()+30;while(performance.now()<end){}
    progress.commandEnd(command,{status:0});progress.checkpoint('small successful phase');progress.complete();`);
  try{
    const result=f.run();assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
    const guard=read(join(f.report,'watchdog.json')),report=read(join(f.report,'report.json'));
    assert.equal(guard.status,'completed');assert.equal(guard.exit_code,0);assert.equal(guard.partial_execution,false);
    assert.equal(guard.last_phase,'small successful phase');assert.equal(guard.last_command,'node fixture');
    assert.equal(guard.process_group_cleaned,true);assert.equal(guard.descendants_cleaned,true);
    assert.equal(report.status,'completed');assert.ok(report.commands[0].elapsed_ms>=20);assert.ok(report.phases[0].elapsed_ms>=report.commands[0].elapsed_ms);
    assert.match(result.stdout,/phase start: small successful phase/);assert.match(result.stdout,/command start: node fixture/);
    assert.match(result.stdout,/command end: node fixture \([\d.]+s\)/);assert.match(result.stdout,/phase end: small successful phase \([\d.]+s\)/);
  }finally{f.cleanup();}
});

test('external watchdog preserves a nonzero exit and existing partial evidence',()=>{
  const f=fixture(`progress.beginPhase('failing phase');progress.commandStart('node failing fixture');
    writeFileSync(directory+'/last-failure.json','{"original":true}');writeFileSync(directory+'/trace.jsonl',${JSON.stringify('original trace\n')});process.exit(23);`);
  try{
    const result=f.run();assert.ifError(result.error);assert.equal(result.status,23,result.stderr);
    const guard=read(join(f.report,'watchdog.json'));
    assert.equal(guard.status,'failed');assert.equal(guard.child_exit_code,23);assert.equal(guard.partial_execution,true);
    assert.equal(guard.last_phase,'failing phase');assert.deepEqual(read(join(f.report,'last-failure.json')),{original:true});
    assert.equal(readFileSync(join(f.report,'trace.jsonl'),'utf8'),'original trace\n');
  }finally{f.cleanup();}
});

test('the explicit longer rehearsal allocation records its reason without waiting for the deadline',()=>{
  const reason='Measured full-input rehearsal exceeded the default; diagnostic runtime only.';
  const f=fixture(`if(Number(process.env.FINANCIAL_RELEASE_ARCHIVE_WATCHDOG_SECONDS)!==4500)throw Error('cooperative timeout disagrees');
    progress.beginPhase('immediate fixture');progress.checkpoint('immediate fixture');progress.complete();`,{timeout:4500,allocationReason:reason});
  try{
    const result=f.run();assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
    const guard=read(join(f.report,'watchdog.json'));assert.equal(guard.timeout_seconds,4500);assert.equal(guard.allocation_reason,reason);assert.ok(guard.elapsed_seconds<4);
  }finally{f.cleanup();}
});

for(const [label,preparedSeconds,expected]of [['normal preparation',120,4500],['delayed preparation',900,3900]]){
  test(`job budget preserves the upload reserve after ${label}`,()=>{
    const f=fixture(`writeFileSync(root+'/launched','yes');progress.beginPhase('immediate budget fixture');progress.checkpoint('immediate budget fixture');progress.complete();`,
      {timeout:4500,allocationReason:'Measured retained-input rehearsal.',preparedSeconds});
    try{
      const result=f.run();assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
      const guard=read(join(f.report,'watchdog.json'));
      assert.equal(guard.child_launched,true);assert.ok(existsSync(join(f.root,'launched')));
      assert.equal(guard.requested_timeout_seconds,4500);assert.ok(guard.timeout_seconds<=expected&&guard.timeout_seconds>expected-2);
      assert.equal(guard.job_budget.upload_reserve_seconds,600);
      assert.ok(guard.timeout_seconds+guard.job_budget.preparation_elapsed_seconds+600<=5400.01);
    }finally{f.cleanup();}
  });
}

test('exhausted remaining job budget records refusal without launching the expensive child',()=>{
  const f=fixture(`writeFileSync(root+'/launched','must not happen');`,{timeout:4500,allocationReason:'Measured retained-input rehearsal.',preparedSeconds:1500});
  try{
    const result=f.run();assert.ifError(result.error);assert.equal(result.status,125,result.stderr);
    const guard=read(join(f.report,'watchdog.json'));
    assert.equal(guard.status,'insufficient_job_budget');assert.equal(guard.child_launched,false);assert.equal(guard.child_exit_code,null);
    assert.equal(existsSync(join(f.root,'launched')),false);assert.equal(existsSync(join(f.report,'report.json')),false);
    assert.ok(guard.timeout_seconds<3600);assert.match(guard.reason,/test was not launched/);
  }finally{f.cleanup();}
});

test('a reaped normal leader never authorizes signalling its old numeric process group',()=>{
  const root=mkdtempSync(join(tmpdir(),'lifecycle-reaped-leader-'));
  try{
    const code=`import importlib.util,sys
spec=importlib.util.spec_from_file_location('watchdog',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def reject_group_signal(group):raise AssertionError('A reaped leader must not authorize killpg')
module.kill_group=reject_group_signal
sys.exit(module.main(['--timeout-seconds','2','--report-directory',sys.argv[2],'--',sys.executable,'-c','pass']))`;
    const result=spawnSync('python3',['-c',code,watchdog,root],{encoding:'utf8',timeout:6000});
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.equal(read(join(root,'watchdog.json')).status,'completed');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('external watchdog interrupts synchronous work and reaps its descendants without touching another process',()=>{
  const outsider=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const descendant=`const fs=require('node:fs'),cp=require('node:child_process');
    process.on('SIGTERM',()=>{});const child=cp.spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    fs.writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`;
  const f=fixture(`import {spawn} from 'node:child_process';
    progress.beginPhase('synchronous recheck');progress.commandStart('node blocked fixture');
    writeFileSync(directory+'/last-failure.json','{"prior_failure":"preserved"}');writeFileSync(directory+'/trace.jsonl',${JSON.stringify('prior trace\n')});
    spawn(process.execPath,['-e',${JSON.stringify(descendant)},root+'/descendants.json'],{stdio:'ignore'});
    Date.now=()=>0;while(true){}`,{timeout:0.8,heartbeat:0.2});
  try{
    const result=f.run();assert.ifError(result.error);assert.equal(result.status,124,result.stderr);
    const guard=read(join(f.report,'watchdog.json')),report=read(join(f.report,'report.json'));
    assert.equal(guard.status,'timed_out');assert.equal(guard.partial_execution,true);assert.equal(guard.exit_code,124);
    assert.ok(guard.elapsed_seconds>=0.8&&guard.elapsed_seconds<4);assert.equal(guard.process_group_cleaned,true);assert.equal(guard.descendants_cleaned,true);
    assert.equal(guard.last_phase,'synchronous recheck');assert.equal(guard.last_command,'node blocked fixture');
    assert.ok(guard.heartbeats.length>=2);assert.equal(guard.heartbeats.at(-1).progress_changed,false);
    assert.equal(report.phases[0].status,'running');assert.equal(report.commands[0].status,'running');
    assert.deepEqual(read(join(f.report,'last-failure.json')),{prior_failure:'preserved'});
    assert.equal(readFileSync(join(f.report,'trace.jsonl'),'utf8'),'prior trace\n');
    assert.ok(existsSync(join(f.root,'descendants.json')),'the real descendant processes started before timeout');
    for(const pid of read(join(f.root,'descendants.json')))assert.equal(gone(pid),true,`descendant ${pid} remains`);
    assert.equal(gone(outsider.pid),false,'an unrelated process must survive');
    assert.match(result.stdout,/watchdog end: timed_out; exit 124/);
    assert.match(result.stdout,/watchdog heartbeat: elapsed [\d.]+s; last phase synchronous recheck/);
    assert.match(result.stdout,/no new phase\/command evidence/);
  }finally{outsider.kill('SIGKILL');f.cleanup();}
});

test('external watchdog also cleans a descendant left behind by a successful leader',()=>{
  const f=fixture(`import {spawn} from 'node:child_process';
    progress.beginPhase('orphan cleanup');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    writeFileSync(root+'/child.json',JSON.stringify(child.pid));progress.checkpoint('orphan cleanup');progress.complete();process.exit(0);`);
  try{
    const result=f.run();assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
    assert.equal(gone(read(join(f.root,'child.json'))),true);
    const guard=read(join(f.report,'watchdog.json'));assert.equal(guard.status,'completed');assert.equal(guard.child_exit_code,0);assert.equal(guard.process_group_cleaned,true);assert.equal(guard.descendants_cleaned,true);
  }finally{f.cleanup();}
});
