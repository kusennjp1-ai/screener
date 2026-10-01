import { test, expect } from '@playwright/test';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';

const date='2026-09-29';
const rows=Array.from({length:101},(_,index)=>withAuditFixture({
  symbol:`PERF${String(index).padStart(3,'0')}`,company_name:`Synthetic scrolling case ${index}`,market:'US',
  current_price:102,se_pivot_price:100,adv_usd:5e7,rs_rating:95,
},date));

for(const width of [1440,390])test(`offscreen candidates keep height, focus and full pagination at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:900});
  await page.route('**/static-data/**',route=>{
    const file=new URL(route.request().url()).pathname.split('/').pop();
    const payload=file==='manifest.json'?{generated_at:`${date}T23:00:00Z`,research_generation:'scroll-fixture',as_of_date:date,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'}}}}}
      :file==='research.json'?{as_of_date:date,rows}:{};
    return route.fulfill({json:payload});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'候補リスト 101件'})).toBeVisible();
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
  await expect(page.getByRole('heading',{name:'候補リスト 101件'})).toHaveText('候補リスト 101件');
});
