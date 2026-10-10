import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { newYorkDate } from '../../src/static/evidenceTime.js';

// Synthetic UI regression fixtures, not retained-publication Design evidence.
// Use the real current clock; only these explicit fixture dates vary.
for(const width of [1440,390,320,900]) for(const theme of ['dark','light']) test.describe(`freshness ${width} ${theme}`,()=>{
  test.use({hasTouch:width===900});
  test(`freshness union disclosure ${width} ${theme}`,async({page},info)=>{
  const now=Date.now(),today=newYorkDate(now),oldDate=newYorkDate(now-8*86400000);
  let state='none',generation=0;
  const priceDate=()=>['price','both'].includes(state)?oldDate:today;
  const generated=()=>new Date(now-(['publication','both'].includes(state)?120:1)*3600000).toISOString();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width,height:width<=700?844:900});
  await page.route('**/publication.json',route=>route.fulfill({status:404,body:'Synthetic legacy fixture: no publication receipt'}));
  await page.route('**/static-data/**',route=>{
    const file=new URL(route.request().url()).pathname.split('/').pop(),date=priceDate();
    const row=withAuditFixture({symbol:'TEST',company_name:'Synthetic freshness fixture',market:'US',current_price:102,se_pivot_price:100,adv_usd:5e7,rs_rating:95},date);
    const payload=file==='manifest.json'?{generated_at:generated(),research_generation:`freshness-${generation}`,as_of_date:date,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:`research-${generation}.json`}}}}}
      :file.startsWith('research-')?{as_of_date:date,rows:[row]}:{};
    return route.fulfill({json:payload});
  });
  const warning=page.getByRole('alert',{name:'分析データの鮮度'});
  for(state of ['none','price','publication','both']) {
    generation++;
    await page.goto('/');
    await expect(page.getByRole('button',{name:/^TEST の分析を表示/})).toBeVisible();
    if(theme==='light'&&await page.getByRole('button',{name:'ライトモードに切り替え'}).count())await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
    await expect(warning).toHaveCount(state==='none'?0:1);
    if(state==='none')continue;
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(`分析基準日 ${priceDate()}`);
    await expect(warning.locator('summary')).toHaveCount(['publication','both'].includes(state)?1:0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const summary=warning.locator('summary');
  const bounds=await summary.boundingBox();
  expect(bounds.height).toBeGreaterThanOrEqual(width<=700||width===900?44:24);
  await summary.focus();await page.keyboard.press('Shift+Tab');
  await expect(summary).not.toBeFocused();
  await page.keyboard.press('Tab');await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');await expect(warning.locator('details')).toHaveAttribute('open','');
  await expect(warning.getByText('公開生成時刻（UTC）',{exact:true})).toBeVisible();
  await expect(warning).toContainText(generated());
  await expect(warning).toContainText('更新日時と価格の基準日は別です。');
  await expect(warning).toContainText('財務資料の期限切れ・未確認は合格に数えません。');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const accessibility=await new AxeBuilder({page}).include('.research-freshness-notice').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({path:info.outputPath(`synthetic-freshness-details-${width}-${theme}.png`)});
  await page.keyboard.press('Space');await expect(warning.locator('details')).not.toHaveAttribute('open','');
  await expect(summary).toBeFocused();
  if(width>700){
    await page.getByRole('button',{name:'概況をたたむ'}).click();await expect(warning).toHaveCount(1);await expect(warning).toBeVisible();
    await page.getByRole('button',{name:'概況を展開'}).click();
  }else{
    const activeMethod=await page.getByRole('group',{name:'投資手法'}).locator('button[aria-pressed="true"]').textContent();
    await page.getByRole('button',{name:/^TEST の分析を表示/}).click();
    await expect(warning).toHaveCount(1);await expect(warning).toBeVisible();
    await expect(page.locator('.research-hero .research-freshness-notice')).toHaveCount(0);
    await expect(page.getByRole('main')).toHaveAttribute('data-mobile-view','detail');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const disclosure=warning.locator('.freshness-disclosure');
    expect(await disclosure.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    await summary.click();await expect(warning.locator('details')).toHaveAttribute('open','');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await disclosure.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    await summary.click();await expect(warning.locator('details')).not.toHaveAttribute('open','');
    await page.getByRole('banner').getByRole('button',{name:'← 候補一覧',exact:true}).click();
    await expect(page.getByRole('main')).toHaveAttribute('data-mobile-view','list');
    await expect(page.getByRole('button',{name:/^TEST の分析を表示/})).toBeVisible();
    await expect(page.getByRole('button',{name:'候補を絞り込む'})).toBeVisible();
    await expect(page.getByRole('group',{name:'投資手法'}).locator('button[aria-pressed="true"]')).toHaveText(activeMethod);
    await expect(page.getByRole('button',{name:'絞り込みを閉じる'})).toHaveCount(0);
    await expect(page.locator('.research-hero .research-freshness-notice')).toHaveCount(1);
    await expect(warning.locator('summary')).toContainText('公開データ要確認');
  }
  // A new publication must update the evidence while retaining the stale price.
  state='price';generation++;
  await page.getByRole('button',{name:'候補を絞り込む'}).click();
  await page.getByRole('button',{name:'データを再確認 ↻'}).click();
  await page.getByRole('button',{name:'絞り込みを閉じる'}).click();
  await expect(warning).toHaveCount(1);await expect(warning).toContainText(oldDate);
  await expect(warning.locator('summary')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^TEST の分析を表示/})).toBeVisible();
  await expect(warning).toHaveCount(1);
  await expect(warning).toContainText('更新日時と価格の基準日は別です。');
  await expect(warning).not.toContainText('公開データ要確認');
  state='both';generation++;
  await page.goto('/?freshness-comparison=1#/compare');
  await expect(page.getByRole('article',{name:'TEST 比較チャート'})).toBeVisible();
  if(theme==='light')await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
  await expect(page.locator('.comparison-page-heading .research-freshness-notice')).toHaveCount(1);
  await expect(warning).toContainText(oldDate);
  await expect(warning.locator('summary')).toContainText('公開データ要確認');
  await expect(warning).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`synthetic-freshness-comparison-${width}-${theme}.png`)});
  expect(errors).toEqual([]);
});
});
