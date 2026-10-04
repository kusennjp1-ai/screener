import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expandedChartGeometry, checkExpandedChartGeometry } from '../../tools/expanded-chart-geometry.mjs';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../../src/test/fixtures/financialCurrent.js';

// Explicitly synthetic data. This suite proves UI states and geometry, not a
// production evidence replay, source capture, or financial-performance claim.
const row=withSyntheticFinancialProof(withAuditFixture({symbol:'TEST',company_name:'Synthetic financial evidence fixture',current_price:102,se_pivot_price:100,adv_usd:5e7,rs_rating:95,chart_path:'chart.json',eps_rating:99,composite_rating:99},date));
const bars=[];
for(let time=Date.parse(date),count=0;count<300;time-=86400000){
 const day=new Date(time); if([0,6].includes(day.getUTCDay()))continue;
 const close=102-count*.05;
 bars.unshift({date:day.toISOString().slice(0,10),open:close-.2,high:close+.5,low:close-.5,close,volume:1000000});count++;
}
for (const [width,height] of [[1440,900],[1440,760],[360,844],[360,568]]) test(`synthetic financial evidence and short-chart geometry ${width}x${height}`,async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width,height});
 await page.clock.setFixedTime(new Date(now));
 await page.route('**/static-data/**',route=>{
  const file=new URL(route.request().url()).pathname.split('/').pop();
  const payload=file==='manifest.json'?{generated_at:new Date(now).toISOString(),research_generation:'synthetic-finance-g1',as_of_date:date,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'}},pages:{}}}}
   :file==='research.json'?{as_of_date:date,rows:[row]}:file==='chart.json'?{symbol:'TEST',as_of_date:date,bars,stock_data:row}:{};
  return route.fulfill({json:payload});
 });
 await page.goto('/#/?symbol=TEST&method=oneil');
 const summary=page.getByRole('region',{name:'財務の確認状況'});
 await expect(summary.getByRole('button',{name:/^EPS前年比 30%・通過/})).toBeVisible();
 const plot=page.locator('.research-detail [data-chart-symbol="TEST"]');
 await expect(plot).toBeVisible();
 const summaryBox=await summary.boundingBox(),plotBox=await plot.boundingBox();
 expect(summaryBox.height).toBeLessThanOrEqual(width===360?112:64);
 expect(plotBox.height).toBeGreaterThanOrEqual(width===360?320:400);
 expect(summaryBox.y+summaryBox.height).toBeLessThan(plotBox.y);
 await expect(summary).toBeInViewport({ratio:1});
 const targets=await summary.getByRole('button').evaluateAll(buttons=>buttons.map(button=>{
  const style=getComputedStyle(button),rect=button.getBoundingClientRect();
  return {label:button.getAttribute('aria-label'),width:rect.width,height:rect.height,minHeight:style.minHeight,display:style.display};
 }));
 await info.attach('synthetic-financial-targets',{body:JSON.stringify(targets),contentType:'application/json'});
 await page.screenshot({path:info.outputPath(`synthetic-financial-initial-${width}x${height}.png`)});
 for(const target of await summary.getByRole('button').all())expect((await target.boundingBox()).height).toBeGreaterThanOrEqual(44);
 for(const target of await page.locator('.research-detail .research-chart-controls button').all())expect((await target.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await info.attach('synthetic-inline-geometry',{body:JSON.stringify({width,height,summary:summaryBox,plot:plotBox,visiblePlotPixels:Math.max(0,Math.min(height,plotBox.y+plotBox.height)-Math.max(0,plotBox.y))}),contentType:'application/json'});
 for(const theme of ['dark','light']){
  if(theme==='light')await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
  await page.screenshot({path:info.outputPath(`synthetic-financial-${width}x${height}-${theme}.png`)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await summary.getByRole('button',{name:/^EPS前年比/}).click();
  const current=page.locator('#financial-evidence-eps_growth_yy');
  await expect(current).toContainText('30%');await expect(current).toContainText('≥ 25%');
  await expect(current).toContainText('2026-06-30');await expect(current).toContainText('2025-06-30');await expect(current).toContainText('yfinance');
  await page.screenshot({path:info.outputPath(`synthetic-financial-detail-${width}-${theme}.png`),fullPage:true});
  expect((await new AxeBuilder({page}).include('#root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await summary.getByRole('button',{name:/^業績の連続性/}).click();
  await expect(page.locator('#book-financial-evidence')).toHaveAttribute('open','');
  await expect(page.locator('#book-financial-evidence')).toContainText('提出日付きの四半期履歴は未取得');
  await summary.scrollIntoViewIfNeeded();
 }
 await page.getByRole('button',{name:'日次チャートを分析'}).click();
 const expanded=page.getByRole('dialog',{name:/TEST/});
 await expect(expanded.locator('[data-chart-symbol="TEST"]')).toBeVisible();
 const geometry=await expanded.evaluate(expandedChartGeometry);
 checkExpandedChartGeometry(geometry,(condition,message)=>expect(condition,message).toBe(true),`synthetic-${width}x${height}`);
 await page.screenshot({path:info.outputPath(`synthetic-expanded-${width}x${height}.png`)});
 await page.getByRole('button',{name:'チャートを閉じる'}).click();
 await page.clock.setFixedTime(new Date(now+8*86400000));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(summary.getByRole('button',{name:/^EPS前年比/})).toContainText('未確認');
 await expect(summary.getByRole('button',{name:/^EPS前年比/})).not.toContainText('30%');
 expect(errors).toEqual([]);
});
