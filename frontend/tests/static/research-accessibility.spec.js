import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';

const date = '2026-09-25';
const row = withAuditFixture({ symbol:'LEAD', company_name:'Chart regression fixture', current_price:102, se_pivot_price:100,
  adv_usd:50000000, rs_rating:95, eps_rating:92, composite_rating:96, ibd_group_rank:10, chart_path:'chart.json',
  market_above_50dma:true, market_above_200dma:true },date);
const bars = Array.from({length:320},(_,i)=>({date:new Date(Date.UTC(2025,10,10+i)).toISOString().slice(0,10),open:85+i*.05,high:86+i*.05,low:84+i*.05,close:85.5+i*.05,volume:1000000+i*1000}));

for (const width of [1440,390]) test(`research navigation and contrast at ${width}px`,async({page},testInfo)=>{
  const pageErrors=[]; page.on('pageerror',error=>pageErrors.push(error.message));
  await page.setViewportSize({width,height:900});
  await page.route('**/static-data/**',async route=>{
    const path=new URL(route.request().url()).pathname.split('/').pop();
    const payload=path==='manifest.json'?{as_of_date:date,generated_at:`${date}T23:00:00Z`,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'}},pages:{}}}}
      :path==='research.json'?{as_of_date:date,rows:[row]}:path==='chart.json'?{symbol:'LEAD',as_of_date:date,bars,rs_line:bars.map((bar,i)=>({time:bar.date,value:1+i*.002})),stock_data:row}:{};
    await route.fulfill({json:payload});
  });
  await page.goto('/');
  await expect(page.getByRole('button',{name:'LEAD の分析を表示'})).toBeVisible();
  await page.getByRole('button',{name:'候補を確認する →'}).click();
  await expect(page.getByRole('region',{name:'候補リスト',exact:true})).toBeFocused();
  await expect(page.getByLabel('銘柄・企業名を検索')).not.toBeFocused();
  if(width===390) await page.getByRole('button',{name:'LEAD の分析を表示'}).click();
  for(const mode of ['dark','light']) {
    if(mode==='light') { await page.getByRole('button',{name:'ライトモードに切り替え'}).click(); if(width===390) await page.getByRole('button',{name:'銘柄分析 LEAD',exact:true}).click(); }
    await expect(page.locator('canvas').first()).toBeVisible();
    const results=await new AxeBuilder({page}).include('#root').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
    await testInfo.attach(`${width}-${mode}`,{body:await page.screenshot(),contentType:'image/png'});
  }
  expect(pageErrors).toEqual([]);
  if(width===390) {
    await expect(page.getByTestId('chart-visible-range')).toHaveText(/2026-.*～.*2026-/);
    const range=await page.getByTestId('chart-visible-range').textContent();
    const dates=range.match(/\d{4}-\d{2}-\d{2}/g);
    expect(dates).toHaveLength(2);
    expect((Date.parse(dates[1])-Date.parse(dates[0]))/86400000).toBeGreaterThanOrEqual(55);
  }
});
