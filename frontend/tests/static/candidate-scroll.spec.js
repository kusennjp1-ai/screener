import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { observeCandidateOrigin, recordCandidateOriginFailure } from './candidate-origin-observation.js';

const failedOrigins=new WeakMap();
test.afterEach(async({page},info)=>{
  const fixture=failedOrigins.get(info);
  failedOrigins.delete(info);
  // The runner has registered the original assertion before this hook starts.
  if(fixture)await recordCandidateOriginFailure({page,fixture,info});
});

const date='2026-09-29';
const rows=Array.from({length:101},(_,index)=>withAuditFixture({
  symbol:`PERF${String(index).padStart(3,'0')}`,company_name:`Synthetic scrolling case ${index}`,market:'US',
  current_price:102,se_pivot_price:100,adv_usd:5e7,rs_rating:95,
},date));

async function expectSidebarTargets(page, info, label, {toggle=false,onOpen}={}) {
  const summary=page.locator('.candidate-glossary > summary');
  let geometry;
  const inspect=async(runAxe=true)=>{
    try {
      await expect.poll(async()=>{
        geometry=await summary.evaluate(node=>{
          const rect=element=>{const {top,bottom,left,right,width,height}=element.getBoundingClientRect();return {top,bottom,left,right,width,height};};
          const box=rect(node),board=rect(node.closest('.research-list')),grid=rect(node.closest('.research-grid')),header=rect(document.querySelector('.leader-header'));
          const guide=rect(node.closest('.candidate-guide')),port=rect(document.querySelector('.candidate-scroll')),columns=rect(document.querySelector('.candidate-columns')),definitions=node.parentElement.open?rect(node.parentElement.querySelector('dl')):null;
          const hits=[.1,.5,.9].flatMap(x=>[.1,.5,.9].map(y=>{const hit=document.elementFromPoint(box.left+box.width*x,box.top+box.height*y);return {hit:node.contains(hit),target:hit?.className||hit?.tagName};}));
          const failures=[];
          if(box.height<24||box.width<24)failures.push('glossary target is below24px');
          if(box.top-4<header.bottom||box.bottom+4>Math.min(board.bottom,innerHeight))failures.push('glossary/focus outline is clipped vertically');
          if(box.left-4<board.left||box.right+4>board.right)failures.push('glossary/focus outline is clipped horizontally');
          if(hits.some(point=>!point.hit))failures.push('glossary hit samples are covered');
          if(definitions&&(definitions.top<header.bottom||definitions.bottom>Math.min(board.bottom,innerHeight)+.5))failures.push('opened glossary definitions are clipped');
          return {box,board,grid,header,guide,port,columns,definitions,hits,failures,open:node.parentElement.open,scrollY};
        });return geometry.failures;
      }).toEqual([]);
    } finally {
      await info.attach(`${label}-glossary-${geometry?.open?'open':'closed'}.json`,{body:JSON.stringify(geometry??{unavailable:true},null,2),contentType:'application/json'});
    }
    if(runAxe)expect((await new AxeBuilder({page}).include('.research-list').withRules(['target-size']).analyze()).violations).toEqual([]);
  };
  await inspect();
  if(toggle){
    await summary.evaluate(node=>node.focus({preventScroll:true}));await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');await expect(page.locator('.candidate-glossary')).toHaveAttribute('open','');
    await expect(page.locator('.candidate-glossary dl')).toBeVisible();await inspect();await onOpen?.();
    await page.screenshot({path:info.outputPath(`${label}-glossary-open.png`)});
    await page.keyboard.press('Space');await expect(page.locator('.candidate-glossary')).not.toHaveAttribute('open');
    await expect(summary).toBeFocused();await inspect(false);
  }
}

for(const width of [1440,390])test(`offscreen candidates keep height, focus and full pagination at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:width===390?844:900});
  await page.route('**/static-data/**',route=>{
    const file=new URL(route.request().url()).pathname.split('/').pop();
    const payload=file==='manifest.json'?{generated_at:`${date}T23:00:00Z`,research_generation:'scroll-fixture',as_of_date:date,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'}}}}}
      :file==='research.json'?{as_of_date:date,rows}:{};
    return route.fulfill({json:payload});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'対象銘柄 101件'})).toBeVisible();
  const items=page.getByRole('list',{name:'投資手法別の銘柄候補'}).getByRole('listitem');
  await expect(items).toHaveCount(50);
  await expect(items.last()).toHaveCSS('content-visibility','auto');
  const scroll=page.locator('.candidate-scroll'),height=await scroll.evaluate(node=>node.scrollHeight);
  const penultimate=page.getByRole('button',{name:/^PERF048 の分析/});
  await penultimate.focus();
  await page.keyboard.press('Tab');
  const last=page.getByRole('button',{name:/^PERF049 の分析/});
  await expect(last).toBeFocused();
  await expect(last).toHaveCSS('outline-offset','-3px');
  await expect(last).toHaveCSS('outline-style','solid');
  await expect(last).toBeInViewport();
  expect(await scroll.evaluate(node=>node.scrollHeight)).toBe(height);
  expect(await items.last().evaluate(node=>node.getBoundingClientRect().height)).toBe(width===390?70:51);
  if(width===1440){
    await last.press('ArrowDown');
    const next=page.getByRole('button',{name:/^PERF050 の分析/});
    await expect(next).toBeFocused();await expect(next).toBeInViewport();
    await next.press('ArrowUp');
    await expect(last).toBeFocused();await expect(last).toBeInViewport();
  }
  const expectPageStart=async symbol=>{
    const first=items.first().getByRole('button');
    await expect(first).toContainText(symbol);
    await expect(first).toBeFocused();
    await expect(first).toBeInViewport({ratio:1});
    const bounds=await first.evaluate(node=>{
      const row=node.getBoundingClientRect(),header=document.querySelector('.leader-header').getBoundingClientRect();
      const columns=document.querySelector('.candidate-columns').getBoundingClientRect(),nav=document.querySelector('.leader-mobile-nav')?.getBoundingClientRect();
      const heading=document.querySelector('.candidate-board-heading').getBoundingClientRect();
      return {top:row.top,bottom:row.bottom,headingTop:heading.top,headerBottom:header.bottom,columnsBottom:columns.height?columns.bottom:header.bottom,visibleBottom:nav?.height?nav.top:innerHeight};
    });
    expect(bounds.top).toBeGreaterThanOrEqual(Math.max(bounds.headerBottom,bounds.columnsBottom));
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.visibleBottom);
    if(width===390)expect(bounds.headingTop).toBeGreaterThanOrEqual(bounds.headerBottom);
  };
  await page.getByRole('button',{name:'次の50件',exact:true}).click();
  await expectPageStart('PERF050');
  await page.getByRole('button',{name:'次の50件',exact:true}).click();
  await expect(items).toHaveCount(1);
  await expectPageStart('PERF100');
  await page.getByRole('button',{name:'前の50件',exact:true}).click();
  await expect(items).toHaveCount(50);
  await expectPageStart('PERF050');
  await page.getByRole('button',{name:'前の50件',exact:true}).click();
  await expectPageStart('PERF000');
  await expect(page.getByRole('heading',{name:'対象銘柄 101件'})).toHaveText('対象銘柄 101件');
  if(width===1440){
    for(const [count,targetBottom] of [[50,749.984375],[50,590.0625],[1,803.921875]]){
      const caseLabel=`${count}-${Math.floor(targetBottom)}`;
      if(count===1){await page.getByRole('button',{name:'次の50件',exact:true}).click();await page.getByRole('button',{name:'次の50件',exact:true}).click();await expect(items).toHaveCount(1);}
      // Reproduce the containing-block boundary for both a full and short
      // board. Only fixture heights change; the real sticky/header code runs.
      await page.evaluate(()=>window.scrollTo(0,0));
      await expect(page.locator('.candidate-scroll')).not.toHaveCSS('--candidate-header-clearance',/\d/);
      await expect(page.locator('.research-list')).not.toHaveCSS('--candidate-board-max-height',/\d/);
      const originalHeight=await page.locator('.research-list').evaluate(node=>node.getBoundingClientRect().height);
      const boundaryDocumentBottom=await page.evaluate(targetBottom=>{
        const grid=document.querySelector('.research-grid');
        grid.style.minHeight='1800px';
        if(!document.querySelector('[data-sticky-boundary-fixture]')){const after=document.createElement('div');after.dataset.stickyBoundaryFixture='';after.style.height='900px';grid.after(after);}
        const gridBottom=grid.getBoundingClientRect().bottom+window.scrollY;
        window.scrollTo(0,gridBottom-targetBottom);return gridBottom;
      },targetBottom);
      await expect.poll(()=>page.locator('.research-grid').evaluate((node,target)=>Math.abs(node.getBoundingClientRect().bottom-target),targetBottom)).toBeLessThanOrEqual(.5);
      const sortButtons=page.locator('.candidate-columns button');await expect(sortButtons).toHaveCount(5);
      await expect.poll(()=>sortButtons.evaluateAll(buttons=>{
        const header=document.querySelector('.leader-header').getBoundingClientRect(),board=document.querySelector('.research-list').getBoundingClientRect();
        return board.top>=header.bottom && buttons.every(button=>{
          const box=button.getBoundingClientRect();
          return box.top>=header.bottom+1 && box.height>=24 && box.width>=24 && [.1,.5,.9].every(x=>[.1,.5,.9].every(y=>button.contains(document.elementFromPoint(box.left+box.width*x,box.top+box.height*y))));
        });
      })).toBe(true);
      await expectSidebarTargets(page,info,`candidate-boundary-${caseLabel}`);
      let rowInspection=0;
      const expectCompleteRow=async row=>{
        let geometry;
        try {
          await expect.poll(async()=>{
            geometry=await row.evaluate(node=>{
              const rect=element=>{const {top,bottom,left,right,width,height}=element.getBoundingClientRect();return {top,bottom,left,right,width,height};};
              const box=rect(node),port=rect(document.querySelector('.candidate-scroll')),columns=rect(document.querySelector('.candidate-columns')),header=rect(document.querySelector('.leader-header'));
              const samples=[.1,.5,.9].flatMap(x=>[.05,.5,.95].map(y=>{const px=box.left+box.width*x,py=box.top+box.height*y,hit=document.elementFromPoint(px,py);return {x:px,y:py,hit:node.contains(hit),target:hit?.className||hit?.tagName};}));
              const failures=[];
              if(box.height!==51)failures.push(`row height ${box.height} is not51`);
              if(box.top<Math.max(columns.bottom,header.bottom,port.top)-.5)failures.push(`row top ${box.top} is above columns/header/port ${Math.max(columns.bottom,header.bottom,port.top)}`);
              if(box.bottom>Math.min(port.bottom,innerHeight)+.5)failures.push(`row bottom ${box.bottom} exceeds visible bottom ${Math.min(port.bottom,innerHeight)}`);
              if(samples.some(point=>!point.hit))failures.push('row hit samples are covered');
              return {box,port,columns,header,samples,failures,scrollTop:document.querySelector('.candidate-scroll').scrollTop};
            });return geometry.failures;
          }).toEqual([]);
        } finally {
          await info.attach(`candidate-${caseLabel}-row-${rowInspection++}.json`,{body:JSON.stringify(geometry??{unavailable:true,reason:'Geometry evaluation did not complete'},null,2),contentType:'application/json'});
        }
      };
      await scroll.evaluate(node=>{node.scrollTop=0;});await expectCompleteRow(items.first().getByRole('button'));
      await page.screenshot({path:info.outputPath(`candidate-boundary-${caseLabel}-first.png`)});
      await scroll.evaluate(node=>{node.scrollTop=node.scrollHeight;});await expectCompleteRow(items.last().getByRole('button'));
      await page.screenshot({path:info.outputPath(`candidate-boundary-${caseLabel}-last.png`)});
      await scroll.evaluate(node=>{node.scrollTop=0;});
      await expectSidebarTargets(page,info,`candidate-boundary-${caseLabel}`,{toggle:true,onOpen:()=>expectCompleteRow(items.first().getByRole('button'))});
      await page.evaluate(target=>{const grid=document.querySelector('.research-grid');window.scrollTo(0,grid.getBoundingClientRect().bottom+scrollY-target);},targetBottom);
      await expect.poll(()=>page.locator('.research-grid').evaluate((node,target)=>Math.abs(node.getBoundingClientRect().bottom-target),targetBottom)).toBeLessThanOrEqual(.5);
      await expectCompleteRow(items.first().getByRole('button'));
      const stable=await page.evaluate(async()=>{
        const values=[];for(let frame=0;frame<6;frame++){await new Promise(requestAnimationFrame);values.push({height:document.querySelector('.research-list').getBoundingClientRect().height,gridBottom:document.querySelector('.research-grid').getBoundingClientRect().bottom,documentBottom:document.querySelector('.research-grid').getBoundingClientRect().bottom+scrollY,clearance:document.querySelector('.candidate-scroll').style.getPropertyValue('--candidate-header-clearance')});}return values;
      });
      expect(stable[0].height).toBeLessThan(originalHeight);
      expect(Math.abs(stable[0].documentBottom-boundaryDocumentBottom)).toBeLessThanOrEqual(.5);
      expect(stable.every(value=>Math.abs(value.height-stable[0].height)<=.5&&Math.abs(value.documentBottom-stable[0].documentBottom)<=.5)).toBe(true);
      expect(new Set(stable.map(value=>value.clearance)).size).toBe(1);
      expect((await new AxeBuilder({page}).include('.candidate-columns').withRules(['target-size']).analyze()).violations).toEqual([]);
      // Repeat real page-end coverage once per full/one-row list, after the
      // last recorded boundary for that size.
      if(targetBottom===749.984375)continue;
      // Check the real document end too, without the artificial long tail.
      await page.evaluate(()=>{document.querySelector('[data-sticky-boundary-fixture]')?.remove();document.querySelector('.research-grid').style.removeProperty('min-height');window.scrollTo(0,document.documentElement.scrollHeight);});
      await expectCompleteRow(items.first().getByRole('button'));
      await expectSidebarTargets(page,info,`candidate-page-end-${caseLabel}`,{toggle:true,onOpen:()=>expectCompleteRow(items.first().getByRole('button'))});
      await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
      await expectCompleteRow(items.first().getByRole('button'));
      await expect.poll(()=>sortButtons.evaluateAll(buttons=>buttons.every(button=>{
        const box=button.getBoundingClientRect(),header=document.querySelector('.leader-header').getBoundingClientRect();
        return box.top>=header.bottom && box.height>=24 && box.width>=24 && [.1,.5,.9].every(x=>[.1,.5,.9].every(y=>button.contains(document.elementFromPoint(box.left+box.width*x,box.top+box.height*y))));
      }))).toBe(true);
      expect((await new AxeBuilder({page}).include('.candidate-columns').withRules(['target-size']).analyze()).violations).toEqual([]);
      await page.screenshot({path:info.outputPath(`candidate-page-end-${caseLabel}-first.png`)});
      await scroll.evaluate(node=>{node.scrollTop=node.scrollHeight;});await expectCompleteRow(items.last().getByRole('button'));
      await page.screenshot({path:info.outputPath(`candidate-page-end-${caseLabel}-last.png`)});

    }
    // Exercise a nonzero inner-clearance value independently of the outer cap.
    // This fixture clones the real columns and row, using the production CSS.
    await page.evaluate(()=>{
      const fixture=document.createElement('section');fixture.dataset.clearanceOriginFixture='';fixture.className='candidate-guidance';
      Object.assign(fixture.style,{position:'fixed',left:'800px',top:'150px',width:'452px',height:'160px',display:'flex',flexDirection:'column',zIndex:'1200',background:'var(--panel)'});
      const port=document.createElement('div');port.className='candidate-scroll';port.style.setProperty('--candidate-header-clearance','6px');
      port.append(document.querySelector('.candidate-columns').cloneNode(true));
      const list=document.createElement('div');list.setAttribute('role','list');list.append(document.querySelector('.candidate-scroll [role=listitem]').cloneNode(true));port.append(list);fixture.append(port);document.body.append(fixture);
    });
    const fixture=page.locator('[data-clearance-origin-fixture]');
    let origin,passed=false;
    try {
      origin=await fixture.evaluate(observeCandidateOrigin);
      await info.attach('candidate-nonzero-scroll-origin.json',{body:JSON.stringify(origin,null,2),contentType:'application/json'});
      expect(origin.padding).toBe('0px');expect(origin.listPadding).toBe('6px');
      expect(origin.columnsTop-origin.portTop).toBe(6);expect(origin.rowTop).toBe(origin.columnsBottom);expect(origin.rowHeight).toBe(51);expect(origin.hits).toBe(true);
      passed=true;
    } finally {
      if(!passed)failedOrigins.set(info,fixture);
    }
    await page.screenshot({path:info.outputPath('candidate-nonzero-scroll-origin.png')});
    await page.locator('[data-clearance-origin-fixture]').evaluate(node=>node.remove());
  }
});


test('empty short-detail sidebar keeps glossary and grid stable at its boundary and page end',async({page},info)=>{
  await page.setViewportSize({width:1440,height:900});
  await page.route('**/static-data/**',route=>{
    const file=new URL(route.request().url()).pathname.split('/').pop();
    const payload=file==='manifest.json'?{generated_at:`${date}T23:00:00Z`,research_generation:'empty-scroll-fixture',as_of_date:date,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'}}}}}:file==='research.json'?{as_of_date:date,rows:[]}:{};
    return route.fulfill({json:payload});
  });
  await page.goto('/');await expect(page.getByRole('heading',{name:'対象銘柄 0件'})).toBeVisible();
  await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
  const naturalGrid=await page.locator('.research-grid').evaluate(node=>({height:node.getBoundingClientRect().height,bottom:node.getBoundingClientRect().bottom+scrollY}));
  expect(naturalGrid.height).toBe(844);
  await page.evaluate(()=>{
    const grid=document.querySelector('.research-grid');
    const after=document.createElement('div');after.dataset.emptyBoundaryFixture='';after.style.height='900px';grid.after(after);
    window.scrollTo(0,grid.getBoundingClientRect().bottom+scrollY-750);
  });
  await expect.poll(()=>page.locator('.research-grid').evaluate(node=>Math.abs(node.getBoundingClientRect().bottom-750))).toBeLessThanOrEqual(.5);
  await expectSidebarTargets(page,info,'candidate-empty-boundary',{toggle:true});
  const stable=await page.evaluate(async()=>{
    const values=[];for(let frame=0;frame<6;frame++){await new Promise(requestAnimationFrame);values.push({height:document.querySelector('.research-list').getBoundingClientRect().height,grid:document.querySelector('.research-grid').getBoundingClientRect().bottom+scrollY});}return values;
  });
  expect(Math.abs(stable[0].grid-naturalGrid.bottom)).toBeLessThanOrEqual(.5);
  expect(stable.every(value=>Math.abs(value.height-stable[0].height)<=.5&&Math.abs(value.grid-stable[0].grid)<=.5)).toBe(true);
  await page.setViewportSize({width:700,height:900});await expect(page.locator('.research-list')).not.toHaveCSS('--candidate-board-max-height',/\d/);
  await page.setViewportSize({width:701,height:900});await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>{document.querySelector('[data-empty-boundary-fixture]').remove();window.scrollTo(0,document.documentElement.scrollHeight);});
  await expectSidebarTargets(page,info,'candidate-empty-page-end',{toggle:true});
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await expectSidebarTargets(page,info,'candidate-empty-page-end-restored');
  await page.screenshot({path:info.outputPath('candidate-empty-page-end.png')});
});
