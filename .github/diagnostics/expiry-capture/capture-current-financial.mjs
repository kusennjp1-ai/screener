// Harness-only diagnostic. It neither changes UI/data nor suppresses loading.
export function installExpiryObserver({ clockAnchor = null, holdPrepareCompletion = false } = {}) {
  const NativeDate = Date, NativeWorker = Worker;
  const offset = clockAnchor === null ? 0 : clockAnchor - NativeDate.now();
  function installClock(shift) {
    const OriginalDate=Date;
    function ClockDate(...args) { if (new.target) return new OriginalDate(...(args.length ? args : [OriginalDate.now()+shift])); return new OriginalDate(OriginalDate.now()+shift).toString(); }
    Object.setPrototypeOf(ClockDate,OriginalDate);ClockDate.prototype=OriginalDate.prototype;ClockDate.now=()=>OriginalDate.now()+shift;globalThis.Date=ClockDate;
  }
  if (clockAnchor !== null) installClock(offset);
  const diagnostic={clock:{mode:clockAnchor===null?'real-clock':'advancing-historical-clock',offset,anchor:clockAnchor},workers:[],events:[],held:[],sequence:0};
  const stamp=()=>({wall_at:new NativeDate().toISOString(),financial_now:Date.now(),monotonic_ms:performance.now()});
  const event=(kind,extra={})=>diagnostic.events.push({kind,...stamp(),...extra});
  diagnostic.release=()=>{const held=diagnostic.held.splice(0);for(const deliver of held)deliver();event('release-held-completion',{count:held.length});};
  globalThis.__expiryDiagnostic=diagnostic;
  globalThis.Worker=class extends NativeWorker {
    constructor(url,options) {
      let actual=url;
      if(clockAnchor!==null)actual=URL.createObjectURL(new Blob([`(${installClock.toString()})(${JSON.stringify(offset)}); self.postMessage({__expiryClockProbe:{now:Date.now()}}); const pending=[]; const defer=e=>{e.stopImmediatePropagation();pending.push(e.data);}; self.addEventListener('message',defer); await import(${JSON.stringify(new URL(url,location.href).href)}); self.removeEventListener('message',defer); for(const data of pending)self.dispatchEvent(new MessageEvent('message',{data}));`],{type:'text/javascript'}));
      super(actual,options);
      const worker=this,record={id:++diagnostic.sequence,url:String(url),created:stamp(),request:null,completed:null,delivered:null,terminated:null,clock_probe:null};diagnostic.workers.push(record);
      const nativePost=worker.postMessage.bind(worker),nativeTerminate=worker.terminate.bind(worker);let handler=null;
      Object.defineProperty(worker,'onmessage',{configurable:true,get:()=>handler,set:value=>{handler=value;}});
      worker.addEventListener('message',message=>{
        if(message.data?.__expiryClockProbe){record.clock_probe={worker_now:message.data.__expiryClockProbe.now,page_now:Date.now(),...stamp()};return;}
        const packet=message.data?.packet;
        if(packet?.kind==='complete'){
          record.completed={...stamp(),date:packet.date,generation:packet.generation,evaluation_epoch:packet.evaluation_epoch,evaluated_at:packet.evaluated_at,next_expiry_at:packet.next_expiry_at};
          event('worker-complete',{worker_id:record.id,operation:record.request?.operation,evaluation_epoch:packet.evaluation_epoch});
        }
        const deliver=()=>{if(record.terminated)return;if(packet?.kind==='complete'){record.delivered={...record.completed,...stamp()};event('worker-deliver',{worker_id:record.id,evaluation_epoch:packet.evaluation_epoch});}handler?.call(worker,message);};
        if(holdPrepareCompletion&&record.request?.operation==='prepare'&&packet?.kind==='complete'){diagnostic.held.push(deliver);event('held-completion',{worker_id:record.id});}else deliver();
      });
      worker.postMessage=(message,...rest)=>{if(message.operation!=='next-packet'){record.request={...stamp(),operation:message.operation,date:message.date,evaluation:message.evaluation};event('worker-request',{worker_id:record.id,operation:message.operation,evaluation:message.evaluation});}return nativePost(message,...rest);};
      worker.terminate=()=>{record.terminated=stamp();if(clockAnchor!==null)URL.revokeObjectURL(actual);return nativeTerminate();};
    }
  };
  let previous=null;
  const observe=()=>{const loading=[...document.querySelectorAll('[role=status]')].some(node=>node.textContent.includes('銘柄と分析根拠を読み込んでいます'));if(loading!==previous){previous=loading;event(loading?'loading-start':'loading-end',{scroll_y:scrollY,symbol:document.querySelector('.symbol-title h2')?.textContent?.trim()||null,tab:document.querySelector('[role=tab][aria-selected=true]')?.id||null});}};
  new MutationObserver(observe).observe(document,{childList:true,subtree:true,characterData:true});
}

// Executed in the browser. Completion metadata comes from the real Worker,
// never from a published suggested deadline or from this harness's own clock.
export function financialCaptureState({ symbol, generation, date }) {
  const d=globalThis.__expiryDiagnostic;
  if(!d)return {ready:false,reason:'missing-worker-observer'};
  const workers=d.workers.filter(w=>['research','prepare'].includes(w.request?.operation));
  const latest=workers.at(-1),completed=latest?.delivered,request=latest?.request?.evaluation;
  const loading=[...document.querySelectorAll('[role=status]')].some(node=>node.textContent.includes('銘柄と分析根拠を読み込んでいます'));
  const panel=document.querySelector('.financial-evidence-panel');
  const evaluated=Date.parse(panel?.textContent.match(/財務の確認時刻 (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1]);
  const currentSymbol=document.querySelector('.symbol-title h2')?.textContent.trim();
  const tab=document.querySelector('#detail-tab-financial')?.getAttribute('aria-selected');
  const now=Date.now();
  const bound=completed&&request&&completed.generation===generation&&completed.generation===request.generation&&completed.date===date&&completed.evaluation_epoch===request.evaluationEpoch&&completed.evaluated_at===request.now;
  const current=bound&&completed.evaluated_at<=now&&(completed.next_expiry_at===null||now<completed.next_expiry_at);
  const rows=panel?[...panel.querySelectorAll('li[id^=financial-evidence-]')].map(row=>({id:row.id,state:row.dataset.state,text:row.textContent})):[];
  return {ready:Boolean(!loading&&current&&panel&&currentSymbol===symbol&&tab==='true'&&Number.isFinite(evaluated)&&evaluated>=completed.evaluated_at&&evaluated<=now&&now-evaluated<90000),loading,symbol:currentSymbol,tab,evaluated_at:evaluated,now,worker_id:latest?.id,request_operation:latest?.request?.operation,request_generation:request?.generation,request_epoch:request?.evaluationEpoch,generation:completed?.generation,epoch:completed?.evaluation_epoch,next_expiry_at:completed?.next_expiry_at,scroll_y:scrollY,fingerprint:JSON.stringify(rows),event_count:d.events.length};
}
export const sameCaptureEvaluation=(a,b)=>a.ready&&b.ready&&a.worker_id===b.worker_id&&a.generation===b.generation&&a.epoch===b.epoch&&a.evaluated_at===b.evaluated_at&&a.fingerprint===b.fingerprint;

export const legitimateExpiryTransition=(a,b)=>Number.isFinite(a.next_expiry_at)&&b.now>=a.next_expiry_at&&(!b.symbol||b.symbol===a.symbol)&&(!b.request_generation||b.request_generation===a.generation)&&(!b.request_operation||['research','prepare'].includes(b.request_operation));

export async function captureCurrentFinancialViewport({page,identity,selectors,geometry,checkGeometry,scroll,capture,validateCurrent,report,timeoutMs=60000}) {
  const end=Date.now()+timeoutMs;report.attempts||=[];
  while(Date.now()<end){
    await page.waitForFunction(`args => (${financialCaptureState.toString()})(args).ready`,identity,{timeout:Math.max(1,end-Date.now())});
    // Reacquire and scroll the current DOM only after the matching worker has
    // delivered. Old ElementHandles/geometry are never reused across expiry.
    const before=await page.evaluate(financialCaptureState,identity);
    await scroll(page,selectors);
    const scrolled=await page.evaluate(financialCaptureState,identity);
    if(!sameCaptureEvaluation(before,scrolled)){const legitimate=legitimateExpiryTransition(before,scrolled);report.attempts.push({status:legitimate?'expiry-during-scroll':'unexpected-state-change',before,after:scrolled});if(!legitimate)throw Error('Financial state changed without the prior verified expiry boundary');continue;}
    await validateCurrent(scrolled);
    const positions=await page.evaluate(geometry,selectors),issues=[];
    checkGeometry(positions,(ok,message)=>{if(!ok)issues.push(message);});
    const attempt={before:scrolled,geometry:positions,issues,status:'pending'};report.attempts.push(attempt);
    // Every screenshot attempt is retained, including loading/contaminated ones.
    attempt.path=await capture(report.attempts.length);
    const after=await page.evaluate(financialCaptureState,identity);attempt.after=after;
    if(!sameCaptureEvaluation(scrolled,after)){const legitimate=legitimateExpiryTransition(scrolled,after);attempt.status=legitimate?'expiry-during-capture':'unexpected-state-change';if(!legitimate)throw Error('Financial capture changed without the prior verified expiry boundary');continue;}
    if(issues.length){attempt.status='geometry-failed';throw Error(issues.join('\n'));}
    attempt.status='current-capture';return attempt;
  }
  throw Error('No current, identity-matched financial viewport before diagnostic timeout');
}
