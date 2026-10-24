import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { observeCandidateOrigin, recordCandidateOriginFailure } from './candidate-origin-observation.js';

const failedOrigins=new WeakMap();
test.afterEach(async({page},info)=>{
 const fixture=failedOrigins.get(info);failedOrigins.delete(info);
 if(fixture)await recordCandidateOriginFailure({page,fixture,info});
});
const date='2026-09-29';
const rows=Array.from({length:101},(_,index)=>withAuditFixture({
 symbol:`PERF${String(index).padStart(3,'0')}`,company_name:`Synthetic scrolling case ${index}`,market:'US',
 current_price:102,se_pivot_price:100,adv_usd:5e7,rs_rating:95,
},date));
async function openFixture(page,fixtureRows=rows){
 await page.clock.setFixedTime(new Date('2026-09-30T10:00:00Z'));
 await page.route('**/static-data/**',route=>{
  const file=new URL(route.request().url()).pathname.split('/').pop();
  const payload=file==='manifest.json'?{generated_at:`${date}T23:00:00Z`,research_generation:'scroll-fixture',as_of_date:date,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'}}}}}:file==='research.json'?{as_of_date:date,rows:fixtureRows}:{};
  return route.fulfill({json:payload});
 });
 await page.goto('/');
 await expect(page.getByRole('heading',{name:`対象銘柄 ${fixtureRows.length}件`})).toBeVisible();
}
async function expectCompletePost(page,row){
 await row.scrollIntoViewIfNeeded();
 await expect(row).toBeInViewport({ratio:1});
 const geometry=await row.evaluate(node=>{
  const box=node.getBoundingClientRect(),header=document.querySelector('.leader-header').getBoundingClientRect();
  const nav=document.querySelector('.leader-mobile-nav')?.getBoundingClientRect();
  const samples=[.1,.5,.9].flatMap(x=>[.05,.5,.95].map(y=>node.contains(document.elementFromPoint(box.left+box.width*x,box.top+box.height*y))));
  return {top:box.top,bottom:box.bottom,height:box.height,headerBottom:header.bottom,visibleBottom:nav?.height?nav.top:innerHeight,samples};
 });
 expect(geometry.height).toBeGreaterThanOrEqual(240);
 expect(geometry.top).toBeGreaterThanOrEqual(geometry.headerBottom-1);
 expect(geometry.bottom).toBeLessThanOrEqual(geometry.visibleBottom+1);
 expect(geometry.samples).toEqual(Array(9).fill(true));
 return geometry;
}
async function expectGlossary(page,info,label){
 const summary=page.locator('.candidate-glossary > summary');
 await summary.scrollIntoViewIfNeeded();await summary.focus();await expect(summary).toBeFocused();
 await page.keyboard.press('Enter');await expect(page.locator('.candidate-glossary')).toHaveAttribute('open','');
 const definitions=page.locator('.candidate-glossary dl');await expect(definitions).toBeVisible();
 await definitions.scrollIntoViewIfNeeded();
 expect(await definitions.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath(`${label}-glossary-open.png`)});
 await summary.scrollIntoViewIfNeeded();await summary.focus();await page.keyboard.press('Space');
 await expect(page.locator('.candidate-glossary')).not.toHaveAttribute('open');await expect(summary).toBeFocused();
 expect((await new AxeBuilder({page}).include('.research-list').withRules(['target-size']).analyze()).violations).toEqual([]);
}
// Reference03 replaces the compact sticky table with full-height posts. Keep
// the original pagination, focus, hit-test and stable-layout guarantees; table
// row heights/column-header positions are no longer the product contract.
for(const width of [1440,390])test(`X feed keeps complete posts, focus and full pagination at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:width===390?844:900});await openFixture(page);
 const items=page.getByRole('list',{name:'投資手法別の銘柄候補'}).getByRole('listitem');
 await expect(items).toHaveCount(50);await expect(page.locator('.candidate-columns')).not.toBeVisible();
 const sort=page.getByRole('combobox',{name:'候補の並び順'});await expect(sort).toBeVisible();
 await sort.selectOption('rs');await expect(sort).toHaveValue('rs');await sort.selectOption('rank');
 const penultimate=page.getByRole('button',{name:/^PERF048 の分析/});await penultimate.focus();await page.keyboard.press('Tab');
 const last=page.getByRole('button',{name:/^PERF049 の分析/});await expect(last).toBeFocused();
 await expect(last).toHaveCSS('outline-offset','-3px');await expect(last).toHaveCSS('outline-style','solid');
 const lastBounds=await expectCompletePost(page,last);
 const measure=()=>page.locator('.candidate-scroll').evaluate(node=>({height:node.scrollHeight,width:node.scrollWidth}));
 const before=await measure();await last.focus();const after=await measure();expect(after).toEqual(before);
 expect(lastBounds.height).toBeGreaterThanOrEqual(240);
 if(width===1440){
  await last.press('ArrowDown');const next=page.getByRole('button',{name:/^PERF050 の分析/});
  await expect(next).toBeFocused();await expectCompletePost(page,next);
  await next.press('ArrowUp');await expect(last).toBeFocused();await expectCompletePost(page,last);
 }
 const expectPageStart=async symbol=>{
  const first=items.first().getByRole('button');await expect(first).toContainText(symbol);await expect(first).toBeFocused();
  await expectCompletePost(page,first);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 };
 for(const symbol of ['PERF050','PERF100']){await page.getByRole('button',{name:'次の50件',exact:true}).click();await expectPageStart(symbol);}
 await expect(items).toHaveCount(1);
 for(const symbol of ['PERF050','PERF000']){await page.getByRole('button',{name:'前の50件',exact:true}).click();await expectPageStart(symbol);}
 await expect(items).toHaveCount(50);await expectGlossary(page,info,`feed-${width}`);
 await expectCompletePost(page,items.first().getByRole('button'));await page.screenshot({path:info.outputPath(`feed-${width}-first.png`)});
 await expectCompletePost(page,items.last().getByRole('button'));await page.screenshot({path:info.outputPath(`feed-${width}-last.png`)});
 // Repeated scrolling must not leave table-only sticky offsets, collapse the
 // post, or move the document boundary from frame to frame.
 const stable=await page.evaluate(async()=>{
  const values=[];for(let frame=0;frame<6;frame++){await new Promise(requestAnimationFrame);const board=document.querySelector('.research-list');values.push({height:board.getBoundingClientRect().height,documentHeight:document.documentElement.scrollHeight,clearance:document.querySelector('.candidate-scroll').style.getPropertyValue('--candidate-header-clearance')});}return values;
 });
 expect(stable.every(value=>Math.abs(value.height-stable[0].height)<=.5&&Math.abs(value.documentHeight-stable[0].documentHeight)<=.5)).toBe(true);
 expect(new Set(stable.map(value=>value.clearance)).size).toBe(1);
 if(width===1440){
  // Preserve the original single-sample nine-hit origin diagnostic with hidden
  // table columns and ignored obsolete clearance. Later green frames may not overwrite an initial failure.
  await page.evaluate(()=>{
   const fixture=document.createElement('section');fixture.dataset.clearanceOriginFixture='';fixture.className='leader-shell candidate-guidance';
   Object.assign(fixture.style,{position:'fixed',left:'800px',top:'100px',width:'452px',height:'650px',display:'flex',flexDirection:'column',zIndex:'1200',background:'var(--panel)'});
   const port=document.createElement('div');port.className='candidate-scroll';port.style.setProperty('--candidate-header-clearance','6px');
   port.append(document.querySelector('.candidate-columns').cloneNode(true));
   const list=document.createElement('div');list.setAttribute('role','list');list.append(document.querySelector('.candidate-scroll [role=listitem]').cloneNode(true));port.append(list);fixture.append(port);document.body.append(fixture);
  });
  const fixture=page.locator('[data-clearance-origin-fixture]');let passed=false;
  try{
   await expect.poll(()=>fixture.locator('.candidate-row').evaluate(row=>row.checkVisibility({contentVisibilityAuto:true})),{timeout:1000}).toBe(true);
   const origin=await fixture.evaluate(observeCandidateOrigin);
   await info.attach('candidate-nonzero-scroll-origin.json',{body:JSON.stringify(origin,null,2),contentType:'application/json'});
   expect(origin.padding).toBe('0px');expect(origin.listPadding).toBe('0px');expect(origin.columnsVisible).toBe(false);
   expect(origin.columnsTop).toBeNull();expect(origin.columnsBottom).toBeNull();expect(origin.rowTop-origin.portTop).toBe(0);
   expect(origin.rowHeight).toBeGreaterThanOrEqual(240);expect(origin.hits).toBe(true);passed=true;
  }finally{if(!passed)failedOrigins.set(info,fixture);}
  await page.screenshot({path:info.outputPath('candidate-nonzero-scroll-origin.png')});await fixture.evaluate(node=>node.remove());
 }
});
test('empty X feed retains glossary, sorting and stable layout across resize and page end',async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});await openFixture(page,[]);
 await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
 await expect(page.locator('.candidate-help')).toContainText('該当銘柄がありません');
 for(const width of [1440,700,701,390,1440]){
  await page.setViewportSize({width,height:900});await expectGlossary(page,info,`empty-${width}`);
  await expect(page.getByRole('combobox',{name:'候補の並び順'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const heights=await page.evaluate(async()=>{const result=[];for(let n=0;n<6;n++){await new Promise(requestAnimationFrame);result.push(document.documentElement.scrollHeight);}return result;});
  expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(.5);
 }
 await page.screenshot({path:info.outputPath('candidate-empty-page-end.png')});
});
