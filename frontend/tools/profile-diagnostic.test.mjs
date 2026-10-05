import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordProfileDiagnostic } from './profile-diagnostic.mjs';
import { retainProfileSources } from './retain-profile-sources.mjs';

function protocol({ lost = false, failedEnd = false } = {}) {
  const cdp = new EventEmitter(), calls = [], trace = '{"traceEvents":[{"name":"Layout"}]}';
  let chunk = 0;
  cdp.send = async (method, args) => {
    calls.push({ method, args });
    if (method === 'Profiler.stop') return { profile:{ startTime:100, endTime:900, timeDeltas:[500], nodes:[], samples:[] } };
    if (method === 'Tracing.end') {
      if (failedEnd) throw Error('Disconnected trace');
      cdp.emit('Tracing.tracingComplete', { stream:'trace-stream', dataLossOccurred:lost });
    }
    if (method === 'IO.read') return chunk++ ? { data:Buffer.from(trace.slice(10)).toString('base64'), base64Encoded:true, eof:true } : { data:trace.slice(0,10), eof:false };
    return {};
  };
  const page = {
    evaluate:async (_fn, value) => value ? {label:value.label,time_origin:1000,now:calls.length} : {long_tasks:[{start:42,duration:51}]},
    waitForTimeout:async ms => calls.push({method:'settle',args:{ms}}),
  };
  return { cdp, calls, page, trace };
}

it('retains a CPU profile, streamed timeline and phase boundaries from the same diagnostic action', async () => {
  const output=await mkdtemp(join(tmpdir(),'profile-diagnostic-')), {cdp,calls,page,trace}=protocol();
  try {
    const result=await recordProfileDiagnostic({cdp,page,output,name:'method',settleMs:500,action:async()=>calls.push({method:'action'})});
    expect(result.acceptance_measurement).toBe(false);
    expect(result.profile_clock.first_sample_gap_us).toBe(500);
    expect(Object.keys(result.markers)).toEqual(['start','ready','end']);
    expect(await readFile(join(output,'method.trace.json'),'utf8')).toBe(trace);
    expect(JSON.parse(await readFile(join(output,'method.cpuprofile'),'utf8')).startTime).toBe(100);
    expect(calls.find(call=>call.method==='Tracing.start').args.transferMode).toBe('ReturnAsStream');
    expect(calls.findIndex(call=>call.method==='Profiler.start')).toBeLessThan(calls.findIndex(call=>call.method==='action'));
    expect(calls.findIndex(call=>call.method==='action')).toBeLessThan(calls.findIndex(call=>call.method==='Profiler.stop'));
    expect(calls.some(call=>call.method==='IO.close')).toBe(true);
    expect(cdp.listenerCount('Tracing.tracingComplete')).toBe(0);
  } finally {await rm(output,{recursive:true,force:true});}
});

it.each(['action','lost','disconnect'])('preserves useful partial evidence and releases tracing resources on %s failure', async failure => {
  const output=await mkdtemp(join(tmpdir(),'profile-failure-')), {cdp,page,calls}=protocol({lost:failure==='lost',failedEnd:failure==='disconnect'});
  try {
    await expect(recordProfileDiagnostic({cdp,page,output,name:'initial',action:async()=>{if(failure==='action')throw Error('Readiness failed');}})).rejects.toThrow();
    const metadata=JSON.parse(await readFile(join(output,'initial.json'),'utf8'));
    expect(metadata.error || metadata.trace_error || metadata.trace_data_loss).toBeTruthy();
    expect(JSON.parse(await readFile(join(output,'initial.cpuprofile'),'utf8')).endTime).toBe(900);
    expect(calls.at(-1).method).toBe('Profiler.disable');
    expect(cdp.listenerCount('Tracing.tracingComplete')).toBe(0);
  } finally {await rm(output,{recursive:true,force:true});}
});

it('handles trace completion timeout even while the end-command acknowledgement remains pending', async () => {
  const output=await mkdtemp(join(tmpdir(),'profile-timeout-')), {cdp,page}=protocol();
  const original=cdp.send;
  let signalEnd;
  const ended=new Promise(resolve=>{signalEnd=resolve;});
  cdp.send=async (method,args)=>{
    if(method==='Tracing.end'){signalEnd();return new Promise(()=>{});}
    return original(method,args);
  };
  vi.useFakeTimers();
  try {
    const pending=recordProfileDiagnostic({cdp,page,output,name:'timed-out',action:async()=>{}});
    const rejected=expect(pending).rejects.toThrow('Trace completion timed out');
    await ended;
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(cdp.listenerCount('Tracing.tracingComplete')).toBe(0);
    expect(JSON.parse(await readFile(join(output,'timed-out.json'),'utf8')).trace_error).toBe('Trace completion timed out');
  } finally {vi.useRealTimers();await rm(output,{recursive:true,force:true});}
});

it.each(['pending','rejected'])('closes an already delivered trace handle when the end acknowledgement is %s', async state => {
  const output=await mkdtemp(join(tmpdir(),'profile-ack-')), {cdp,page,calls}=protocol();
  const original=cdp.send;let signalEnd;
  const ended=new Promise(resolve=>{signalEnd=resolve;});
  cdp.send=async (method,args)=>{
    if(method==='Tracing.end'){
      cdp.emit('Tracing.tracingComplete',{stream:'early-stream'});signalEnd();
      if(state==='rejected')throw Error('End acknowledgement failed');
      return new Promise(()=>{});
    }
    return original(method,args);
  };
  vi.useFakeTimers();
  try {
    const pending=recordProfileDiagnostic({cdp,page,output,name:'ack-failure',action:async()=>{}});
    const rejected=expect(pending).rejects.toThrow(state==='pending'?'Trace completion timed out':'End acknowledgement failed');
    await ended;
    if(state==='pending')await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(calls).toContainEqual({method:'IO.close',args:{handle:'early-stream'}});
    expect(cdp.listenerCount('Tracing.tracingComplete')).toBe(0);
  } finally {vi.useRealTimers();await rm(output,{recursive:true,force:true});}
});

async function sourceFixture() {
  const directory=await mkdtemp(join(tmpdir(),'profile-sources-')), root=join(directory,'tested'), output=join(directory,'diagnostics');
  await mkdir(join(root,'assets'),{recursive:true});
  await writeFile(join(root,'assets/main.js'),'exact production body');
  await writeFile(join(root,'assets/vendor.js'),'exact vendor body');
  return {directory,root,output};
}

it('retains byte-identical production assets and accepts only maps for that complete build', async () => {
  const {directory,root,output}=await sourceFixture();let config;
  try {
    const build=async options=>{config=options;return {output:['main','vendor'].flatMap(name=>[
      {type:'chunk',fileName:`assets/${name}.js`,code:name==='main'?'exact production body':'exact vendor body'},
      {type:'asset',fileName:`assets/${name}.js.map`,source:'{"version":3,"sources":[]}'},
    ])};};
    const result=await retainProfileSources({root,output,quoteUrl:'',build});
    expect(config).toMatchObject({publicDir:false,build:{write:false,copyPublicDir:false,sourcemap:'hidden'}});
    expect(config.define['import.meta.env.VITE_RESEARCH_QUOTE_URL']).toBe('""');
    expect(result.maps_reproduced).toBe(true);
    expect(result.assets.every(item=>item.source_map)).toBe(true);
    expect(await readFile(join(root,'assets/main.js'),'utf8')).toBe('exact production body');
  } finally {await rm(directory,{recursive:true,force:true});}
});

it('keeps original script evidence but rejects all maps when any rebuilt production body differs', async () => {
  const {directory,root,output}=await sourceFixture();
  try {
    const build=async()=>({output:[
      {type:'chunk',fileName:'assets/main.js',code:'exact production body'},
      {type:'asset',fileName:'assets/main.js.map',source:'{"version":3}'},
      {type:'chunk',fileName:'assets/vendor.js',code:'different body'},
    ]});
    await expect(retainProfileSources({root,output,build})).rejects.toThrow('differs from tested asset');
    const saved=join(output,'diagnostic-code');
    expect(await readFile(join(saved,'assets/vendor.js'),'utf8')).toBe('exact vendor body');
    expect((await readdir(join(saved,'assets'))).some(name=>name.endsWith('.map'))).toBe(false);
    expect(JSON.parse(await readFile(join(saved,'manifest.json'),'utf8')).maps_reproduced).toBe(false);
  } finally {await rm(directory,{recursive:true,force:true});}
});
