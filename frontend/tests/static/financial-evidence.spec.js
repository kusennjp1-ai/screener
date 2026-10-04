import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expandedChartGeometry, checkExpandedChartGeometry } from '../../tools/expanded-chart-geometry.mjs';
import { researchFeedMetrics, checkResearchFeedMetrics, checkFeedDetailConsistency, checkDetailSourceEvidence, checkFeedDecisionEvidence } from '../../tools/research-feed-acceptance.mjs';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../../src/static/financialEvidencePresentation.js';
import { assess } from '../../src/static/researchEngine.js';
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
// Preserve unexpected wait/source failures too, in addition to the observations
// explicitly retained before each geometry assertion below.
test.afterEach(async({page},info)=>{
 if(info.status===info.expectedStatus||page.isClosed())return;
 const observations=await page.evaluate(researchFeedMetrics);
 await info.attach('synthetic-financial-failure-measurements',{body:JSON.stringify(observations),contentType:'application/json'});
 const path=info.outputPath('synthetic-financial-failure.png');
 await page.screenshot({path});await info.attach('synthetic-financial-failure',{path,contentType:'image/png'});
});
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
 await page.goto('/#/?method=oneil');
 await expect(page.locator('.candidate-feed-card')).toHaveCount(1);
 // Soft geometry checks still fail the test, while retaining later themes and
 // selected/expanded states for diagnosis of the same failing viewport.
 const check=(condition,message)=>expect.soft(condition,message).toBe(true);
 const retain=async(name,measurements,fullPage=false)=>{
  await info.attach(`${name}-measurements`,{body:JSON.stringify(measurements),contentType:'application/json'});
  const path=info.outputPath(`${name}.png`);
  await page.screenshot({path,fullPage});
  await info.attach(name,{path,contentType:'image/png'});
 };
 const decisionEvidence=(method,epoch)=>{
  const context={symbol:row.symbol,date,generation:'synthetic-finance-g1',method,now:epoch};
  const presentation=financialEvidencePresentation({...context,history:row.financial_history,evidence:buildFinancialEvidencePresentation(row,context)});
  return {method,selection:assess(row,method,epoch),annual:presentation.rows.find(item=>item.id==='annual_eps_growth_3y')};
 };
 let feed;
 for(const theme of ['dark','light']){
  if(theme==='light')await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  // Measure first-viewport evidence before any scroll or selection.
  const measurements=await page.evaluate(researchFeedMetrics);
  await retain(`synthetic-feed-${width}x${height}-${theme}`,measurements);
  checkResearchFeedMetrics(measurements,check,`synthetic-feed-${width}x${height}-${theme}`);
  feed=measurements.feed;
  for(const metric of feed.metrics){
   expect(metric.actual.text).toBe('30%');expect(metric.state).toBe('pass');expect(metric.role.text).toBe('必須');
  }
  const expected=decisionEvidence('oneil',measurements.evaluatedAt);
  expect(expected.annual.required).toBe(true);expect(expected.annual.state).toBe('unknown');expect(expected.selection.qualified).toBe(false);
  checkFeedDecisionEvidence(feed,expected,check,`synthetic-required-annual-${width}x${height}-${theme}`);
 }
 // The same absent annual history is a reference for Minervini. Preserve its
 // complete 9/9 technical selection while daily confirmation stays incomplete.
 await page.getByRole('button',{name:'ミネルヴィニ',exact:true}).click();
 await expect(page.locator('.candidate-feed-card [data-check="selection"]')).toContainText('9/9');
 for(const theme of ['dark','light']){
  if(await page.locator('.leader-shell').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:theme==='light'?'ライトモードに切り替え':'ダークモードに切り替え'}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  const measurements=await page.evaluate(researchFeedMetrics);
  await retain(`synthetic-reference-annual-${width}x${height}-${theme}`,measurements);
  checkResearchFeedMetrics(measurements,check,`synthetic-reference-annual-${width}x${height}-${theme}`);
  const expected=decisionEvidence('minervini',measurements.evaluatedAt);
  expect(expected.annual.required).toBe(false);expect(expected.annual.state).toBe('unknown');expect(expected.selection.qualified).toBe(true);
  checkFeedDecisionEvidence(measurements.feed,expected,check,`synthetic-reference-annual-${width}x${height}-${theme}`);
  for(const metric of measurements.feed.metrics){expect(metric.actual.text).toBe('30%');expect(metric.state).toBe('reference');expect(metric.role.text).toBe('参考');}
  check(measurements.feed.decisions.daily.passed<measurements.feed.decisions.daily.total,'Reference annual evidence does not complete daily confirmation');
 }
 await page.getByRole('button',{name:'オニール',exact:true}).click();
 const oneil=decisionEvidence('oneil',now);
 await expect(page.locator('.candidate-feed-card [data-check="selection"]')).toContainText(`${oneil.selection.passed}/${oneil.selection.total}`);
 await page.getByRole('button',{name:'ダークモードに切り替え'}).click();
 await page.getByRole('button',{name:'TEST の財務・日次根拠を見る',exact:true}).click();
 const summary=page.getByRole('region',{name:'財務の確認状況'});
 await expect(summary.getByRole('button',{name:/^EPS前年比 30%・✓ 通過/})).toBeVisible();
 const plot=page.locator('.research-detail [data-chart-symbol="TEST"]');
 const chartSection=page.locator('.research-detail .research-chart');
 await expect(chartSection).toBeVisible();
 const summaryBox=await summary.boundingBox(),chartSectionBox=await chartSection.boundingBox();
 // The new summary includes actual, role, condition, period and source plus
 // annual EPS. The former 64/112px chip-summary cap and whole-summary first
 // viewport requirement no longer describe the requested product.
 const selected=await page.evaluate(researchFeedMetrics);
 await retain(`synthetic-financial-initial-${width}x${height}`,{...selected,summary:summaryBox,chartSection:chartSectionBox});
 checkResearchFeedMetrics(selected,check,`synthetic-detail-${width}x${height}`,{surface:'detail'});
 checkFeedDetailConsistency(feed,selected.detail,check,`synthetic-detail-${width}x${height}`);
 const context={symbol:row.symbol,date,generation:'synthetic-finance-g1',method:'oneil',now:selected.evaluatedAt};
 const canonical=financialEvidencePresentation({...context,history:row.financial_history,evidence:buildFinancialEvidencePresentation(row,context)});
 checkDetailSourceEvidence(selected.detail,{symbol:row.symbol,rows:canonical.rows},check,`synthetic-detail-${width}x${height}`);
 expect(summaryBox.y+summaryBox.height).toBeLessThan(chartSectionBox.y);
 const targets=await summary.getByRole('button').evaluateAll(buttons=>buttons.map(button=>{
  const style=getComputedStyle(button),rect=button.getBoundingClientRect();
  return {label:button.getAttribute('aria-label'),width:rect.width,height:rect.height,minHeight:style.minHeight,display:style.display};
 }));
 await info.attach('synthetic-financial-targets',{body:JSON.stringify(targets),contentType:'application/json'});
 for(const target of await summary.getByRole('button').all()){
  const box=await target.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);
 }
 for(const theme of ['dark','light']){
  if(theme==='light')await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
  const measurements=await page.evaluate(researchFeedMetrics);
  await retain(`synthetic-financial-${width}x${height}-${theme}`,measurements);
  checkResearchFeedMetrics(measurements,check,`synthetic-financial-${width}x${height}-${theme}`,{surface:'detail'});
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
 // The first-view evidence is already retained. Activate the real inline chart
 // only when reaching the chart task, then keep its original readability and
 // control-size gates on rendered pixels rather than on a deferred placeholder.
 await chartSection.scrollIntoViewIfNeeded();
 await expect(plot.locator('canvas').first()).toBeVisible();
 const plotBox=await plot.boundingBox(),activeSummaryBox=await summary.boundingBox();
 const inlineGeometry={width,height,summary:activeSummaryBox,plot:plotBox,visiblePlotPixels:Math.max(0,Math.min(height,plotBox.y+plotBox.height)-Math.max(0,plotBox.y))};
 await info.attach('synthetic-inline-geometry',{body:JSON.stringify(inlineGeometry),contentType:'application/json'});
 await retain(`synthetic-inline-active-${width}x${height}`,inlineGeometry);
 expect(plotBox.height).toBeGreaterThanOrEqual(width===360?320:400);
 expect(activeSummaryBox.y+activeSummaryBox.height).toBeLessThan(plotBox.y);
 const chartControls=page.locator('.research-detail .research-chart-controls button');
 expect(await chartControls.count()).toBeGreaterThan(0);
 for(const target of await chartControls.all())expect((await target.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await page.getByRole('button',{name:'日次チャートを分析'}).click();
 const expanded=page.getByRole('dialog',{name:/TEST/});
 await expect(expanded.locator('[data-chart-symbol="TEST"]')).toBeVisible();
 const geometry=await expanded.evaluate(expandedChartGeometry);
 await retain(`synthetic-expanded-${width}x${height}`,geometry);
 checkExpandedChartGeometry(geometry,check,`synthetic-${width}x${height}`);
 await page.getByRole('button',{name:'チャートを閉じる'}).click();
 await page.clock.setFixedTime(new Date(now+8*86400000));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(summary.locator('[data-metric="eps_growth_yy"] .financial-summary-result strong')).toHaveText('未確認');
 await expect(summary.locator('[data-metric="eps_growth_yy"]')).toHaveAttribute('data-state','unknown');
 await expect(summary.getByRole('button',{name:/^EPS前年比/})).toHaveAccessibleName(/未確認/);
 await page.goto('/#/?method=oneil');await page.reload();
 await expect(page.locator('.candidate-feed-card [data-metric="eps_growth_yy"] .financial-summary-result strong')).toHaveText('未確認');
 await expect(page.locator('.candidate-feed-card [data-metric="sales_growth_yy"]')).toHaveAttribute('data-state','unknown');
 for(const theme of ['dark','light']){
  if(await page.locator('.leader-shell').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:theme==='light'?'ライトモードに切り替え':'ダークモードに切り替え'}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  const measurements=await page.evaluate(researchFeedMetrics);
  await retain(`synthetic-expired-feed-${width}x${height}-${theme}`,measurements);
  checkResearchFeedMetrics(measurements,check,`synthetic-expired-feed-${width}x${height}-${theme}`);
 }
 expect(errors).toEqual([]);
});
