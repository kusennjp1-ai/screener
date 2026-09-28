// Local development probe, served only by serve-audit.py; no production UI.
(() => {
  const probe=document.createElement('output');probe.id='audit-performance';
  probe.style.cssText='position:fixed;bottom:0;left:0;z-index:99999;background:#fff;color:#000;font:12px monospace;padding:4px';
  const started=performance.now();let ready=null,action=null,delay=null,readyHeap=null;
  const record=()=>{
    const text=document.body?.innerText||'';
    if(!ready && document.querySelectorAll('tbody tr').length && !text.includes('全データを読み込み中')) {ready=performance.now()-started;readyHeap=performance.memory?.usedJSHeapSize??null;}
    if(action!=null){delay=performance.now()-action;action=null;}
    const resources=performance.getEntriesByType('resource').filter(r=>r.name.includes('/static-data/'));
    const value=JSON.stringify({ready_ms:ready,action_ms:delay,ready_heap:readyHeap,heap:performance.memory?.usedJSHeapSize??null,
      encoded:resources.reduce((s,r)=>s+r.encodedBodySize,0),decoded:resources.reduce((s,r)=>s+r.decodedBodySize,0),requests:resources.length});
    if(probe.textContent!==value)probe.textContent=value;
  };
  document.addEventListener('DOMContentLoaded',()=>{
    document.body.append(probe);
    new MutationObserver(records=>{if(records.some(r=>r.target!==probe && !probe.contains(r.target)))requestAnimationFrame(record);}).observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});
    document.addEventListener('click',e=>{if(e.target.closest('th'))action=performance.now();},true);
    document.addEventListener('input',()=>{action=performance.now();},true);
    record();
  });
})();
