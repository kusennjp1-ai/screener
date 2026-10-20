// Passed directly to locator.evaluate: keep all browser helpers inside this function.
export function observeCandidateOrigin(node) {
  const port=node.querySelector('.candidate-scroll'),list=port.querySelector('[role=list]'),columns=port.querySelector('.candidate-columns'),row=list.querySelector('.candidate-row');
  const p=port.getBoundingClientRect(),c=columns.getBoundingClientRect(),r=row.getBoundingClientRect();
  const origin={padding:getComputedStyle(port).paddingTop,listPadding:getComputedStyle(list).paddingTop,portTop:p.top,columnsTop:c.top,columnsBottom:c.bottom,rowTop:r.top,rowHeight:r.height};
  // Read the original nine hit targets before doing additional style/stack work.
  // A later successful frame must never replace a false in this first sample.
  const points=[.1,.5,.9].flatMap(x=>[.05,.5,.95].map(y=>{
    const px=r.left+r.width*x,py=r.top+r.height*y,target=document.elementFromPoint(px,py);
    return {xFraction:x,yFraction:y,x:px,y:py,hit:row.contains(target),target};
  }));
  const rect=element=>{const {top,bottom,left,right,width,height}=element.getBoundingClientRect();return {top,bottom,left,right,width,height};};
  const style=element=>{
    const s=getComputedStyle(element);
    return Object.fromEntries(['display','visibility','contentVisibility','pointerEvents','position','zIndex','overflowX','overflowY','contain'].map(key=>[key,s[key]]));
  };
  const describe=element=>element?{tag:element.tagName,id:(element.id||'').slice(0,200),class:(element.getAttribute('class')||'').slice(0,300),role:element.getAttribute('role'),inRow:row.contains(element),inFixture:node.contains(element),style:style(element)}:null;
  const listitem=list.querySelector('[role=listitem]');
  return {...origin,hits:points.every(point=>point.hit),
    samples:points.map(({target,...point})=>({...point,target:describe(target),stack:document.elementsFromPoint(point.x,point.y).slice(0,8).map(describe)})),
    elements:Object.fromEntries(Object.entries({fixture:node,port,list,listitem,columns,row}).map(([name,element])=>[name,element?{rect:rect(element),style:style(element)}:null])),
    viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,devicePixelRatio},
    scroll:{top:port.scrollTop,left:port.scrollLeft,clientHeight:port.clientHeight,clientWidth:port.clientWidth,scrollHeight:port.scrollHeight,scrollWidth:port.scrollWidth}};
}

// Called in afterEach, after the runner registers the original failure.
// This independent one-second diagnostic budget never changes test acceptance.
export async function recordCandidateOriginFailure({page,fixture,info}) {
  const errors=[],frames=[],budgetMs=1000,deadline=performance.now()+budgetMs;
  let exhausted=false;
  const attempt=async(stage,action)=>{
    const remaining=Math.floor(deadline-performance.now());
    if(exhausted||remaining<=0){exhausted=true;return {ok:false};}
    let timer;
    try {
      const value=await Promise.race([
        Promise.resolve().then(()=>{
          const left=Math.floor(deadline-performance.now());
          if(exhausted||left<=0){exhausted=true;throw Error('Diagnostic total budget exhausted');}
          return action(left);
        }),
        new Promise((_,reject)=>{timer=setTimeout(()=>{exhausted=true;reject(Error('Diagnostic total budget exhausted'));},remaining);}),
      ]);
      return {ok:true,value};
    } catch(error){errors.push({stage,error:String(error)});return {ok:false};}
    finally{clearTimeout(timer);}
  };
  const screenshot=await attempt('screenshot',timeout=>page.screenshot({timeout}));
  if(screenshot.ok)await attempt('screenshot-attachment',()=>info.attach('candidate-origin-failure.png',{body:screenshot.value,contentType:'image/png'}));
  for(let frame=1;frame<=2&&!exhausted;frame++) {
    const tick=await attempt(`frame-${frame}`,()=>page.evaluate(()=>new Promise(requestAnimationFrame)));
    if(!tick.ok)continue;
    const sample=await attempt(`frame-observation-${frame}`,()=>fixture.evaluate(observeCandidateOrigin));
    if(sample.ok)frames.push({frame,observation:sample.value});
  }
  await attempt('frames-attachment',()=>info.attach('candidate-origin-after-failure.json',{body:JSON.stringify({frames,errors,budgetMs},null,2),contentType:'application/json'}));
  if(errors.length)await attempt('errors-attachment',()=>info.attach('candidate-origin-diagnostic-errors.json',{body:JSON.stringify(errors,null,2),contentType:'application/json'}));
  return {frames,errors,budgetMs,exhausted};
}
