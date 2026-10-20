// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { observeCandidateOrigin, recordCandidateOriginFailure } from '../tests/static/candidate-origin-observation.js';

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function dom(outside=-1) {
  const rect={left:800,right:1252,top:184,bottom:235,width:452,height:51};
  const styles={display:'block',visibility:'visible',contentVisibility:'auto',pointerEvents:'auto',position:'relative',zIndex:'auto',overflowX:'visible',overflowY:'visible',contain:'none',paddingTop:'0px'};
  const element=(tag,box=rect)=>({tagName:tag,id:'',getAttribute:()=>null,getBoundingClientRect:()=>({...box})});
  const row=element('BUTTON'),child=element('SPAN'),overlay=element('ASIDE'),listitem=element('DIV'),list=element('DIV'),port=element('DIV'),columns=element('DIV'),fixture=element('SECTION');
  row.contains=node=>node===row||node===child;fixture.contains=node=>node!==null&&node!==overlay;
  list.querySelector=selector=>selector==='[role=listitem]'?listitem:row;
  port.querySelector=selector=>selector==='[role=list]'?list:columns;
  fixture.querySelector=()=>port;
  port.getBoundingClientRect=()=>({...rect,top:150});columns.getBoundingClientRect=()=>({...rect,top:156,bottom:184,height:28});
  Object.assign(port,{scrollTop:0,scrollLeft:0,clientHeight:160,clientWidth:452,scrollHeight:160,scrollWidth:452});
  const calls=[];
  vi.stubGlobal('getComputedStyle',node=>({...styles,paddingTop:node===list?'6px':'0px'}));
  vi.stubGlobal('document',{elementFromPoint:(x,y)=>{const index=calls.length;calls.push({x,y});return index===outside?overlay:child;},elementsFromPoint:()=>[overlay,child,row,listitem,port,fixture]});
  for(const [name,value]of Object.entries({innerWidth:1440,innerHeight:900,scrollX:0,scrollY:500,devicePixelRatio:1}))vi.stubGlobal(name,value);
  return {fixture,calls,row,overlay};
}

it('records all nine original coordinates, layout and actual target without changing the all-hit check',()=>{
  const {fixture,calls}=dom(),result=observeCandidateOrigin(fixture);
  expect(result).toMatchObject({padding:'0px',listPadding:'6px',portTop:150,columnsTop:156,columnsBottom:184,rowTop:184,rowHeight:51,hits:true});
  expect(calls).toEqual([.1,.5,.9].flatMap(x=>[.05,.5,.95].map(y=>({x:800+452*x,y:184+51*y}))));
  expect(result.samples).toHaveLength(9);expect(result.samples.every(point=>point.hit&&point.target.inRow)).toBe(true);
  expect(result.elements.row.rect).toMatchObject({left:800,right:1252,width:452});
  expect(result.elements.listitem.style.contentVisibility).toBe('auto');
  expect(result.viewport).toMatchObject({width:1440,height:900,scrollY:500});
});
it.each(Array.from({length:9},(_,index)=>index))('keeps failure at sample %i and identifies the outside target',index=>{
  const {fixture,calls}=dom(index),result=observeCandidateOrigin(fixture);
  expect(result.hits).toBe(false);expect(calls).toHaveLength(9);
  expect(result.samples.filter(point=>!point.hit)).toHaveLength(1);
  expect(result.samples[index]).toMatchObject({hit:false,target:{tag:'ASIDE',inRow:false,inFixture:false}});
});
it('retains a null target as a failed hit',()=>{
  const {fixture}=dom();document.elementFromPoint=()=>null;
  const result=observeCandidateOrigin(fixture);
  expect(result.hits).toBe(false);expect(result.samples.every(point=>point.target===null&&!point.hit)).toBe(true);
});
it('does not let later green frames replace the original failure or its exception',async()=>{
  const {fixture}=dom(0),origin=observeCandidateOrigin(fixture),original=new Error('original hit assertion');
  const attachments=[],page={screenshot:vi.fn(async()=>Buffer.from('image')),evaluate:vi.fn(async()=>{})};
  const locator={evaluate:vi.fn(async()=>({hits:true}))},info={attach:vi.fn(async(name,value)=>attachments.push({name,...value}))};
  await expect((async()=>{try{throw original;}finally{await recordCandidateOriginFailure({page,fixture:locator,info});}})()).rejects.toBe(original);
  expect(origin.hits).toBe(false);expect(locator.evaluate).toHaveBeenCalledTimes(2);
  expect(JSON.parse(attachments.find(item=>item.name==='candidate-origin-after-failure.json').body).frames.every(frame=>frame.observation.hits)).toBe(true);
  expect(page.screenshot).toHaveBeenCalledTimes(1);
});
it('preserves the original exception even if all diagnostic operations fail',async()=>{
  const original=new Error('original hit assertion'),page={screenshot:vi.fn(async()=>{throw Error('screenshot unavailable');}),evaluate:vi.fn(async()=>{throw Error('page closed');})};
  const fixture={evaluate:vi.fn()},info={attach:vi.fn(async()=>{throw Error('attachment unavailable');})};
  await expect((async()=>{try{throw original;}finally{await recordCandidateOriginFailure({page,fixture,info});}})()).rejects.toBe(original);
  expect(page.evaluate).toHaveBeenCalledTimes(2);expect(fixture.evaluate).not.toHaveBeenCalled();
});

it.each(['screenshot','frame','observation','attachment'])('bounds a pending %s without starting any stage after the deadline',async stage=>{
  vi.useFakeTimers();
  const pending=new Promise(()=>{}),page={screenshot:vi.fn(async()=>Buffer.from('image')),evaluate:vi.fn(async()=>{})};
  const fixture={evaluate:vi.fn(async()=>({hits:true}))},info={attach:vi.fn(async()=>{})};
  if(stage==='screenshot')page.screenshot.mockReturnValue(pending);
  if(stage==='frame')page.evaluate.mockReturnValue(pending);
  if(stage==='observation')fixture.evaluate.mockReturnValue(pending);
  if(stage==='attachment')info.attach.mockReturnValue(pending);
  const completion=recordCandidateOriginFailure({page,fixture,info});
  await vi.advanceTimersByTimeAsync(1001);
  const result=await completion;
  expect(result.exhausted).toBe(true);expect(result.budgetMs).toBe(1000);expect(result.frames).toEqual([]);
  expect(result.errors).toHaveLength(1);expect(result.errors[0].error).toContain('Diagnostic total budget exhausted');
  if(stage==='screenshot'){expect(info.attach).not.toHaveBeenCalled();expect(page.evaluate).not.toHaveBeenCalled();}
  if(stage==='attachment')expect(page.evaluate).not.toHaveBeenCalled();
  if(stage==='frame')expect(fixture.evaluate).not.toHaveBeenCalled();
});

it.each(['resolve','reject'])('ignores late screenshot %s after its diagnostic deadline',async kind=>{
  vi.useFakeTimers();
  let resolve,reject;
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const page={screenshot:vi.fn(()=>pending),evaluate:vi.fn()},fixture={evaluate:vi.fn()},info={attach:vi.fn()};
  const completion=recordCandidateOriginFailure({page,fixture,info});
  await vi.advanceTimersByTimeAsync(1001);
  const result=await completion;
  if(kind==='resolve')resolve(Buffer.from('late image'));else reject(Error('late screenshot error'));
  await vi.advanceTimersByTimeAsync(1);
  expect(result.frames).toEqual([]);expect(result.errors).toHaveLength(1);
  expect(info.attach).not.toHaveBeenCalled();expect(page.evaluate).not.toHaveBeenCalled();
});
