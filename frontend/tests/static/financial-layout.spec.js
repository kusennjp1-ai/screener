import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import registry from '../../contracts/financial_instrument_applicability_v1.json' with { type: 'json' };

const date='2026-09-29';
const candidates=Array.from({length:6},(_,index)=>withAuditFixture({symbol:`CASE${index}`,company_name:`Synthetic unknown-evidence company ${index}`,market:'US',current_price:104,se_pivot_price:100,adv_usd:5e7,rs_rating:null,market_above_50dma:true,market_above_200dma:true,chart_path:`CASE${index}.json`},date));
const funds=registry.records.map(record=>withAuditFixture({symbol:record.symbol,company_name:record.name,market:record.market,current_price:100,adv_usd:5e7,rs_rating:95},date));
const rows=[...candidates,...funds];
const bars=Array.from({length:320},(_,index)=>({date:new Date(Date.parse(date)-(319-index)*86400000).toISOString().slice(0,10),open:87.95+index*.05,high:88.8+index*.05,low:87.2+index*.05,close:88.05+index*.05,volume:1e6+index*1000}));

for(const width of [1440,390])for(const theme of ['dark','light'])test(`financial scope and source cautions retain first-screen layout at ${width}px ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:width===390?844:900});
 await page.route('**/static-data/**',route=>{
  const file=new URL(route.request().url()).pathname.split('/').pop(),row=candidates.find(item=>item.chart_path===file);
  const payload=file==='manifest.json'?{as_of_date:date,generated_at:`${date}T23:00:00Z`,research_generation:'financial-layout-fixture',assets:{research:{path:'research.json'}}}
   :file==='research.json'?{as_of_date:date,rows}:row?{symbol:row.symbol,as_of_date:date,bars,rs_line:[],stock_data:row}:{};
  return route.fulfill({json:payload});
 });
 await page.goto('/');
 await expect(page.locator('.candidate-row').first()).toBeVisible();
 if(theme==='light')await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
 const scope=page.locator('.overview-universe');
 await expect(scope).toContainText('価格・流動性対象 9件');
 await expect(scope).toContainText('企業財務判定の対象 6件');
 await expect(scope).toContainText('BITU・SBIT・ETHE');
 await expect(scope).toBeVisible();
 expect((await scope.boundingBox()).height).toBeGreaterThanOrEqual(11);
 if(width===1440){
  await expect(page.locator('.research-detail .research-chart canvas').first()).toBeVisible();
  expect((await page.getByTestId('home-hero').boundingBox()).height).toBeLessThanOrEqual(320);
  expect((await page.locator('.research-detail .research-chart canvas').first().boundingBox()).y).toBeLessThanOrEqual(540);
  expect((await page.getByRole('link',{name:'業種の追い風を見る →'}).boundingBox()).height).toBeGreaterThanOrEqual(44);
 }else{
  const visible=await page.locator('.candidate-row').evaluateAll(rows=>{
   const bottom=document.querySelector('.leader-mobile-nav').getBoundingClientRect().top;
   return rows.filter(row=>{const box=row.getBoundingClientRect();return box.top>=48&&box.bottom<=bottom;}).length;
  });
  expect(visible).toBeGreaterThanOrEqual(3);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).include('#root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`scope-${width}-${theme}.png`)});
 await page.goto('/#/compare');
 await page.getByRole('button',{name:'手法・絞り込み',exact:true}).click();
 await page.getByLabel('あと1条件',{exact:true}).check();
 await page.getByRole('button',{name:'絞り込みを閉じる',exact:true}).click();
 const cards=page.locator('.comparison-card');
 await expect(cards).toHaveCount(6);
 await expect(cards.first().locator('canvas').first()).toBeVisible();
 for(const card of await cards.all()){
  await expect(card.locator('.comparison-company-label')).toHaveText('未確認：RS ≥ 70');
  await expect(card.locator('.comparison-company').getByRole('note')).toHaveAccessibleName(/書籍の追随目安外/);
  const badge=card.locator('.entry-source-badge');
  expect(await badge.evaluate(node=>{const badge=node.getBoundingClientRect(),line=node.parentElement.getBoundingClientRect();return badge.left>=line.left&&badge.right<=line.right&&badge.top>=line.top&&badge.bottom<=line.bottom;})).toBe(true);
 }
 const geometry=await cards.evaluateAll(cards=>{
  const top=document.querySelector('.leader-header').getBoundingClientRect().bottom,bottom=document.querySelector('.leader-mobile-nav')?.getBoundingClientRect().top||innerHeight;
  const boxes=cards.map(card=>card.getBoundingClientRect());
  return {visible:boxes.filter(box=>box.top>=top&&box.bottom<=bottom).length,fraction:boxes.reduce((sum,box)=>sum+Math.max(0,Math.min(box.bottom,bottom)-Math.max(box.top,top))/box.height,0)};
 });
 if(width===1440){
  expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(900);
  expect(geometry.visible).toBeGreaterThanOrEqual(6);
  expect((await page.locator('.comparison-grid').boundingBox()).height).toBeLessThanOrEqual(700);
 }else expect(geometry.fraction).toBeGreaterThanOrEqual(1.5);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).include('#root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`comparison-warnings-${width}-${theme}.png`)});
});
