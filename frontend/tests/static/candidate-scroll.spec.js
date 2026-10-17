import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';

const date='2026-09-29';
const rows=Array.from({length:101},(_,index)=>withAuditFixture({
  symbol:`PERF${String(index).padStart(3,'0')}`,company_name:`Synthetic scrolling case ${index}`,market:'US',
  current_price:102,se_pivot_price:100,adv_usd:5e7,rs_rating:95,
},date));

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
    for(const count of [50,1]){
      if(count===1){await page.getByRole('button',{name:'次の50件',exact:true}).click();await page.getByRole('button',{name:'次の50件',exact:true}).click();await expect(items).toHaveCount(1);}
      // Reproduce the containing-block boundary for both a full and short
      // board. Only fixture heights change; the real sticky/header code runs.
      await page.evaluate(()=>window.scrollTo(0,0));
      await expect(page.locator('.candidate-scroll')).not.toHaveCSS('--candidate-header-clearance',/\d/);
      const originalHeight=await page.locator('.research-list').evaluate(node=>node.getBoundingClientRect().height);
      await page.evaluate(()=>{
        const grid=document.querySelector('.research-grid'),board=document.querySelector('.research-list'),scroll=document.querySelector('.candidate-scroll');
        grid.style.minHeight='1800px';
        if(!document.querySelector('[data-sticky-boundary-fixture]')){const after=document.createElement('div');after.dataset.stickyBoundaryFixture='';after.style.height='900px';grid.after(after);}
        const gridBottom=grid.getBoundingClientRect().bottom+window.scrollY,boardRect=board.getBoundingClientRect();
        const scrollOffset=scroll.getBoundingClientRect().top-boardRect.top;
        window.scrollTo(0,gridBottom-boardRect.height+scrollOffset-52);
      });
      const sortButtons=page.locator('.candidate-columns button');await expect(sortButtons).toHaveCount(5);
      await expect.poll(()=>sortButtons.evaluateAll(buttons=>{
        const header=document.querySelector('.leader-header').getBoundingClientRect(),scroll=document.querySelector('.candidate-scroll').getBoundingClientRect();
        return scroll.top<header.bottom && buttons.every(button=>{
          const box=button.getBoundingClientRect();
          return box.top>=header.bottom+1 && box.height>=24 && box.width>=24 && [.1,.5,.9].every(x=>[.1,.5,.9].every(y=>button.contains(document.elementFromPoint(box.left+box.width*x,box.top+box.height*y))));
        });
      })).toBe(true);
      const expectCompleteRow=async row=>{
        await expect.poll(()=>row.evaluate(node=>{
          const box=node.getBoundingClientRect(),port=document.querySelector('.candidate-scroll').getBoundingClientRect(),columns=document.querySelector('.candidate-columns').getBoundingClientRect();
          const header=document.querySelector('.leader-header').getBoundingClientRect();
          return box.height===51 && box.top>=Math.max(columns.bottom,header.bottom,port.top)-.5 && box.bottom<=Math.min(port.bottom,innerHeight)+.5 && [.1,.5,.9].every(x=>[.05,.5,.95].every(y=>node.contains(document.elementFromPoint(box.left+box.width*x,box.top+box.height*y))));
        })).toBe(true);
      };
      await scroll.evaluate(node=>{node.scrollTop=0;});await expectCompleteRow(items.first().getByRole('button'));
      await page.screenshot({path:info.outputPath(`candidate-boundary-${count}-first.png`)});
      await scroll.evaluate(node=>{node.scrollTop=node.scrollHeight;});await expectCompleteRow(items.last().getByRole('button'));
      await page.screenshot({path:info.outputPath(`candidate-boundary-${count}-last.png`)});
      await scroll.evaluate(node=>{node.scrollTop=0;});
      const stable=await page.evaluate(async()=>{
        const values=[];for(let frame=0;frame<6;frame++){await new Promise(requestAnimationFrame);values.push({height:document.querySelector('.research-list').getBoundingClientRect().height,clearance:document.querySelector('.candidate-scroll').style.getPropertyValue('--candidate-header-clearance')});}return values;
      });
      expect(stable.every(value=>Math.abs(value.height-originalHeight)<=.5)).toBe(true);
      expect(new Set(stable.map(value=>value.clearance)).size).toBe(1);
      expect((await new AxeBuilder({page}).include('.candidate-columns').withRules(['target-size']).analyze()).violations).toEqual([]);
      // Check the real document end too, without the artificial long tail.
      await page.evaluate(()=>{document.querySelector('[data-sticky-boundary-fixture]')?.remove();document.querySelector('.research-grid').style.removeProperty('min-height');window.scrollTo(0,document.documentElement.scrollHeight);});
      await expectCompleteRow(items.first().getByRole('button'));
      await expect.poll(()=>sortButtons.evaluateAll(buttons=>buttons.every(button=>{
        const box=button.getBoundingClientRect(),header=document.querySelector('.leader-header').getBoundingClientRect();
        return box.top>=header.bottom && box.height>=24 && box.width>=24 && [.1,.5,.9].every(x=>[.1,.5,.9].every(y=>button.contains(document.elementFromPoint(box.left+box.width*x,box.top+box.height*y))));
      }))).toBe(true);
      expect((await new AxeBuilder({page}).include('.candidate-columns').withRules(['target-size']).analyze()).violations).toEqual([]);
      await page.screenshot({path:info.outputPath(`candidate-page-end-${count}-first.png`)});
      await scroll.evaluate(node=>{node.scrollTop=node.scrollHeight;});await expectCompleteRow(items.last().getByRole('button'));
      await page.screenshot({path:info.outputPath(`candidate-page-end-${count}-last.png`)});

    }
  }
});
