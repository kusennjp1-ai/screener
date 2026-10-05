// Diagnostic timing only. Monotonic elapsed time is independent of the frozen
// financial evaluation clock in the lifecycle's child processes.
import {writeFileSync,renameSync} from 'node:fs';
import {join,basename} from 'node:path';
import {performance} from 'node:perf_hooks';

export function lifecycleCommandLabel(command,args){
  const name=basename(command);
  if(/^node(?:js)?$/.test(name)&&args[0]?.endsWith('.mjs')){
    return `${name} ${basename(args[0])}${/^[a-z-]+$/.test(args[1]||'')?` ${args[1]}`:''}`;
  }
  if(name==='git')return `git ${args.find(arg=>['clone','checkout','rev-parse','archive','add','commit'].includes(arg))||'read'}`;
  return name;
}

export function createLifecycleDiagnostics(directory,report){
  const started=performance.now(),elapsed=()=>Math.round(performance.now()-started);
  const clock=()=>new Date().toISOString();
  Object.assign(report,{started_at:clock(),status:'running',commands:[],active_phase:null,active_command:null});
  let phase=null;
  const persist=()=>{report.elapsed_ms=elapsed();const path=join(directory,'report.json');writeFileSync(`${path}.tmp`,JSON.stringify(report));renameSync(`${path}.tmp`,path);};
  const announce=(kind,label,state,duration,id)=>console.log(`Archive lifecycle ${kind} ${state}: ${label}${duration===undefined?'':` (${(duration/1000).toFixed(3)}s)`} [${kind} ${id}]`);
  function beginPhase(label){
    if(phase)throw Error(`Unfinished diagnostic phase: ${phase.phase}`);
    phase={phase_id:report.phases.length+1,phase:label,started_phase:label,status:'running',started_at:clock(),started_elapsed_ms:elapsed()};
    report.phases.push(phase);report.active_phase=label;persist();announce('phase',label,'start',undefined,phase.phase_id);
  }
  function checkpoint(label,extra={}){
    if(!phase)beginPhase(label);
    const completed=elapsed();Object.assign(phase,{phase:label,status:'completed',completed_at:clock(),elapsed_ms:completed-phase.started_elapsed_ms,...extra});
    report.active_phase=null;persist();announce('phase',phase.started_phase,'end',phase.elapsed_ms,phase.phase_id);phase=null;
  }
  function commandStart(label){
    const item={command_id:report.commands.length+1,phase_id:phase?.phase_id??null,label,status:'running',started_at:clock(),started_elapsed_ms:elapsed()};
    report.commands.push(item);report.active_command=label;persist();announce('command',label,'start',undefined,item.command_id);return item;
  }
  function commandEnd(item,{status,signal,error}){
    Object.assign(item,{status:status===0&&!error?'completed':'failed',exit_code:status,signal:signal||null,
      ...(error?{error_code:error.code||'spawn_error'}:{}),completed_at:clock(),elapsed_ms:elapsed()-item.started_elapsed_ms});
    report.active_command=null;persist();announce('command',item.label,'end',item.elapsed_ms,item.command_id);
  }
  function complete(){report.status='completed';report.completed_at=clock();persist();}
  persist();return {beginPhase,checkpoint,commandStart,commandEnd,complete};
}
