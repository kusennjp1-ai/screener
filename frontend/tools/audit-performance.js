// Local development probe, served only by serve-audit.py; no production UI.
(() => {
  const probe=document.createElement('output');probe.id='audit-performance';
  probe.style.cssText='display:block;background:#fff;color:#000;font:12px monospace;padding:4px;word-break:break-all';
  const started=performance.now();let ready=null,action=null,delay=null,readyHeap=null;
  const longTasks=[];
  new PerformanceObserver(list=>{for(const item of list.getEntries())longTasks.push({start:Math.round(item.startTime),ms:Math.round(item.duration)});}).observe({type:'longtask',buffered:true});
  const record=()=>{
    const text=document.body?.innerText||'';
    if(!ready && document.querySelectorAll('tbody tr').length && !text.includes('全データを読み込み中')) {ready=performance.now()-started;readyHeap=performance.memory?.usedJSHeapSize??null;}
    if(action!=null){delay=performance.now()-action;action=null;}
    const resources=performance.getEntriesByType('resource').filter(r=>r.name.includes('/static-data/'));
    const value=JSON.stringify({ready_ms:ready,action_ms:delay,ready_heap:readyHeap,heap:performance.memory?.usedJSHeapSize??null,longTasks,
      encoded:resources.reduce((s,r)=>s+r.encodedBodySize,0),decoded:resources.reduce((s,r)=>s+r.decodedBodySize,0),requests:resources.length});
    if(probe.textContent!==value)probe.textContent=value;
  };
  document.addEventListener('DOMContentLoaded',()=>{
    document.body.append(probe);
    const audit=document.createElement('button');audit.textContent='アクセシビリティ検査';audit.onclick=async()=>{const result=await window.axe.run(document.getElementById('root'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});let output=document.getElementById('audit-accessibility');if(!output){output=document.createElement('pre');output.id='audit-accessibility';document.body.append(output);}output.textContent=JSON.stringify(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));};document.body.append(audit);
    new MutationObserver(records=>{if(records.some(r=>r.target!==probe && !probe.contains(r.target)))requestAnimationFrame(record);}).observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});
    document.addEventListener('click',e=>{if(e.target.closest('th,[role=group] button,.candidate-toolbar button'))action=performance.now();},true);
    document.addEventListener('input',()=>{action=performance.now();},true);
    record();
    setInterval(record,1000);
  });
})();
