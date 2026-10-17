import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../../src/static/testFinancialFixture.js';
const row=withFinancialProof(withAuditFixture({symbol:'BOOK',company_name:'Synthetic source comparison company',market:'US',currency:'USD',current_price:104,se_pivot_price:100,adv_usd:5e7,rs_rating:90,sales_growth_yy:20},date));
row.technical_audit.values.aboveLow=27;
row.technical_audit.values.volumeRatio=1.3;
row.financial_history={symbol:'BOOK',as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic provider',retrieved_at:new Date(now-1000).toISOString(),annual:[1,1.2,1.6,2].map((eps,i)=>({end:`${2022+i}-12-31`,eps})),quarterly:[]};

for(const width of [1440,390])test(`four-book source comparison on the real static route at ${width}px`,async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width,height:900});
 await page.clock.setFixedTime(new Date(now));
 await page.route('**/static-data/**',route=>{
  const file=new URL(route.request().url()).pathname.split('/').pop();
  const payload=file==='manifest.json'?{as_of_date:date,generated_at:new Date(now).toISOString(),research_generation:'book-source-fixture',assets:{research:{path:'research.json'}}}:file==='research.json'?{as_of_date:date,rows:[row]}:{};
  return route.fulfill({json:payload});
 });
 await page.goto('/');
 await page.getByRole('button',{name:/^BOOK の分析を表示/}).click();
 const detail=page.getByRole('region',{name:'銘柄詳細',exact:true});
 await detail.getByRole('tab',{name:'書籍検証',exact:true}).click();
 const source=page.getByRole('region',{name:'4冊の条件と現行判定'});
 await expect(source).toBeVisible();
 const card=id=>source.locator(`[data-rule-id="${id}"]`);
 await expect(card('wizard-low')).toHaveAttribute('data-rule-state','fail');
 await expect(card('wizard-low')).toContainText('27.00%');
 const champion=source.locator('summary').filter({hasText:'株式トレード 基本と原則'});
 await champion.press('Enter');
 await expect(card('champion-low')).toHaveAttribute('data-rule-state','pass');
 await expect(card('champion-low')).toBeVisible();
 await expect(card('champion-power-play')).toContainText('全銘柄へ広げない');
 await source.screenshot({path:info.outputPath(`book-profiles-${width}.png`)});
 await champion.press('Enter');
 const masters=source.locator('summary').filter({hasText:'成長株投資の神'});
 await masters.press('Enter');
 await expect(card('masters-minervini-volume')).toHaveAttribute('data-rule-state','pass');
 await expect(card('masters-ryan-volume')).toHaveAttribute('data-rule-state','pass');
 await expect(card('masters-ryan-volume')).toContainText('窓はアプリの選択');
 await expect(card('masters-zanger-volume')).toHaveAttribute('data-rule-state','unknown');
 await expect(card('masters-ritchie-volume')).toHaveAttribute('data-rule-state','review');
 await masters.press('Enter');
 const oneil=source.locator('summary').filter({hasText:'オニールの相場師養成講座'});
 for(let i=0;i<2;i++){
  await oneil.press('Enter');await expect(card('oneil-annual')).toBeVisible();
  await expect(card('oneil-annual')).toHaveAttribute('data-rule-state','pass');
  await expect(card('oneil-annual')).toContainText('25.99%');
  await expect(card('oneil-annual')).toContainText('アプリ閾値との比較（同じ4期で毎年25%以上）：この比較は未充足');
  await expect(card('oneil-sales')).toHaveAttribute('data-rule-state','unknown');
  if(!i)await oneil.press('Enter');
 }
 await card('oneil-annual').scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await source.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
 await source.screenshot({path:info.outputPath(`oneil-comparison-${width}.png`)});
 expect((await new AxeBuilder({page}).include('.book-source-comparison').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
 // Repeated tab navigation must not reclassify unknown evidence or replace the
 // existing primary qualification with a source-comparison result.
 await detail.getByRole('tab',{name:'判定根拠',exact:true}).click();
 await expect(source).toHaveCount(0);
 await expect(detail.getByRole('tabpanel')).toContainText('252日安値から ≥ 30%');
 await expect(detail.getByRole('tabpanel')).toContainText('× 未達');
 await detail.getByRole('tab',{name:'書籍検証',exact:true}).click();
 await expect(source).toBeVisible();
 expect(errors).toEqual([]);
});
