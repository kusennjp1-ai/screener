import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';

const registry=JSON.parse(readFileSync(new URL('../../contracts/financial_instrument_applicability_v1.json',import.meta.url),'utf8'));
const date='2026-10-22';
// Synthetic prices, with authentic reviewed fund identities to keep the scope
// paragraph present. Missing earnings/base evidence remains unknown, not pass.
const rows=[...['ALPHALONG','BETA','GAMMA'].map((symbol,index)=>withAuditFixture({
 symbol,company_name:`Synthetic ordinary company ${index+1}`,market:'US',current_price:102,
 se_pivot_price:100,adv_usd:5e7,rs_rating:95-index,market_above_50dma:true,market_above_200dma:true,
},date)),...registry.records.map(record=>withAuditFixture({symbol:record.symbol,company_name:record.name,
 market:record.market,current_price:102,se_pivot_price:100,adv_usd:5e7,rs_rating:80},date))];
const cases=[
 {width:390,height:844,top:0,bottom:0},
 {width:360,height:780,top:20,bottom:0},
 {width:390,height:844,top:47,bottom:34},
 {width:390,height:844,top:59,bottom:34},
 {width:360,height:780,top:59,bottom:34},
 {width:390,height:844,top:59,bottom:34,collapsed:true},
 {width:360,height:780,top:59,bottom:34,collapsed:true},
];
// Injected inset geometry is a deterministic browser regression, not a claim
// of native iOS Safari or standalone/PWA verification.
for(const fixture of cases)test(`mobile first ${fixture.width}x${fixture.height}, insets ${fixture.top}/${fixture.bottom}, saved collapse ${Boolean(fixture.collapsed)}`,async({page},info)=>{
 test.setTimeout(90000);
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:fixture.width,height:fixture.height});
 await page.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
 await page.addInitScript(({collapsed})=>{localStorage.setItem('research-hero-collapsed',String(Boolean(collapsed)));},fixture);
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.route('**/static-data/**',route=>{
  const name=new URL(route.request().url()).pathname.split('/').pop();
  const json=name==='manifest.json'?{as_of_date:date,generated_at:'2026-10-23T01:00:00Z',research_generation:'synthetic-mobile-first',assets:{research:{path:'research.json'}}}:name==='research.json'?{as_of_date:date,rows}:{};
  return route.fulfill({json});
 });
 await page.goto('/');
 await page.addStyleTag({content:`:root{--research-safe-top:${fixture.top}px;--research-safe-bottom:${fixture.bottom}px}`});
 const list=page.getByRole('list',{name:'投資手法別の銘柄候補'});
 const first=page.getByRole('button',{name:/^ALPHALONG の分析を表示/});
 await expect(first).toBeVisible();
 await expect(page.locator('.overview-universe')).toContainText('企業財務判定の対象 3件');
 await expect(page.locator('.overview-universe')).toContainText('BITU・SBIT・ETHE');
 await expect(page.locator('.leader-pinned-title')).toContainText(`${date} 終値`);
 await expect(page.locator('.overview-market-state')).toBeVisible();
 await expect(page.locator('.overview-market-state')).toContainText('市場未確認 · 新規上限 0%');
 expect(await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop))).toBe(48+fixture.top);
 await expect(page.locator('.setup-radar')).toHaveCount(0);
 await expect(first.locator('.leader-post-judgment')).toContainText('未確認');
 await expect(first.locator('.leader-condition-strip [data-state=unknown]')).not.toHaveCount(0);
 await expect(first.locator('.leader-post-metrics')).toContainText('出来高比');
 await expect(first.locator('.leader-post-metrics')).toContainText('前日比');
 await expect(first.locator('.leader-rs-ring')).toContainText('RS');
 await expect(page.locator('.leader-pinned-title')).toContainText('本日の判断');
 await expect(page.locator('.leader-feed-controls .method-tabs button')).toHaveCount(4);
 await expect(first.locator('.candidate-daily-check')).not.toHaveAttribute('data-ready','true');
 // The X feed separates avatar, full ticker/date, company and condition status.
 // No table-column or two-complete-rows-in-first-fold assumption survives the
 // approved reference03 information density. Identity must still be unclipped.
 for(const symbol of ['ALPHALONG','BETA']) {
  const candidate=page.getByRole('button',{name:new RegExp(`^${symbol} の分析を表示`)});
  await expect(candidate.locator('.leader-post-avatar')).toHaveText(symbol);
  const identity=candidate.locator('.leader-post-identity');
  await expect(identity).toContainText(`@${symbol}`);
  await expect(identity.locator('strong')).toContainText('Synthetic ordinary company');
  expect(await identity.evaluate(element=>{
   const company=element.querySelector('strong'),ticker=element.querySelector(':scope > span');
   const box=element.getBoundingClientRect(),c=company.getBoundingClientRect(),t=ticker.getBoundingClientRect();
   return {unclipped:element.scrollWidth<=element.clientWidth+1&&ticker.scrollWidth<=ticker.clientWidth+1,
    companyFits:c.left>=box.left-1&&c.right<=box.right+1,tickerBelow:t.top>=c.bottom-1};
  })).toEqual({unclipped:true,companyFits:true,tickerBelow:true});
 }
 // Inspect the untouched initial viewport, before any action scrolls content.
 const geometry=await page.evaluate(()=>{
  const rect=element=>{const {top,bottom,left,right,height,width}=element.getBoundingClientRect();return {top,bottom,left,right,height,width};};
  const header=document.querySelector('.leader-header'),nav=document.querySelector('.leader-mobile-nav');
  return {scrollY,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,header:rect(header),nav:rect(nav),
   headerTargets:[...header.querySelectorAll('a,button')].filter(node=>node.getBoundingClientRect().height).map(rect),
   navTargets:[...nav.querySelectorAll('a')].map(rect),rows:[...document.querySelectorAll('.candidate-row')].slice(0,2).map(rect),
   actions:[...document.querySelectorAll('.hero-actions button,.leader-feed-controls button,.candidate-board-heading select')].filter(node=>node.getBoundingClientRect().height).map(rect)};
 });
 await info.attach('initial-injected-inset-geometry.json',{body:JSON.stringify({fixture,geometry},null,2),contentType:'application/json'});
 expect(geometry.scrollY).toBe(0);
 expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
 expect(geometry.header.height).toBeGreaterThanOrEqual(48+fixture.top);
 for(const target of geometry.headerTargets)expect(target.top).toBeGreaterThanOrEqual(fixture.top);
 for(const target of geometry.navTargets)expect(target.bottom).toBeLessThanOrEqual(fixture.height-fixture.bottom+1);
 expect(geometry.rows).toHaveLength(2);
 for(const row of geometry.rows){expect(row.top).toBeGreaterThanOrEqual(geometry.header.bottom);expect(row.height).toBeGreaterThanOrEqual(240);}
 // At least the first post starts above the bottom navigation; richer posts
 // scroll rather than hiding indicators to fit two rows in one screen.
 expect(geometry.rows[0].top).toBeLessThan(geometry.nav.top);
 for(const target of geometry.actions)expect(target.height).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:info.outputPath('initial-mobile-first.png')});
 expect((await new AxeBuilder({page}).include('.research-workbench').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 await page.getByRole('button',{name:'分布を見る',exact:true}).click();
 await expect(page.locator('.setup-radar')).toBeVisible();
 await page.getByRole('button',{name:'分布を閉じる',exact:true}).click();
 await expect(page.locator('.setup-radar')).toHaveCount(0);
 const search=page.locator('.leader-feed-search').getByRole('textbox',{name:'銘柄・企業名を検索'});
 await search.fill('ALPHALONG');
 await expect(list.getByRole('listitem')).toHaveCount(1);
 await page.getByRole('button',{name:'候補を絞り込む',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'候補を絞り込む'});
 await expect(drawer).toBeVisible();
 await expect(drawer.getByRole('textbox',{name:'銘柄・企業名を検索'})).toHaveValue('ALPHALONG');
 const ids=await page.locator('input[id^="candidate-search-"]').evaluateAll(inputs=>inputs.map(input=>input.id));
 expect(ids.length).toBeGreaterThanOrEqual(2);
 expect(new Set(ids).size).toBe(ids.length);
 const title=await drawer.locator('.drawer-title').boundingBox();
 expect(title.y).toBeGreaterThanOrEqual(fixture.top);
 await page.keyboard.press('Escape');
 await expect(drawer).not.toBeVisible();
 const filterTrigger=page.getByRole('button',{name:'候補を絞り込む',exact:true});
 await expect(filterTrigger).toBeFocused();
 const expectRestoredTrigger=async()=>{
  await expect(filterTrigger).toBeFocused();
  await expect.poll(()=>filterTrigger.evaluate(node=>{
   const r=node.getBoundingClientRect(),top=document.querySelector('.leader-header').getBoundingClientRect().bottom,bottom=document.querySelector('.leader-mobile-nav').getBoundingClientRect().top;
   return r.width>=44&&r.height>=44&&r.top>=top&&r.bottom<=bottom&&[.1,.5,.9].every(x=>node.contains(document.elementFromPoint(r.left+r.width*x,r.top+r.height/2)));
  })).toBe(true);
 };
 await expectRestoredTrigger();
 // Close and Escape both restore a usable trigger after the exit transition.
 await filterTrigger.press('Enter');await expect(drawer).toBeVisible();
 await drawer.getByRole('button',{name:'絞り込みを閉じる',exact:true}).click();await expect(drawer).not.toBeVisible();await expectRestoredTrigger();
 await filterTrigger.press('Enter');await expect(drawer).toBeVisible();
 await page.keyboard.press('Escape');await expect(drawer).not.toBeVisible();await expectRestoredTrigger();
 await filterTrigger.press('Enter');await expect(drawer).toBeVisible();
 await drawer.getByRole('button',{name:'候補を確認する →',exact:true}).click();await expect(drawer).not.toBeVisible();
 const settled=await page.evaluate(async()=>{
  const frames=[];for(let frame=0;frame<6;frame++){
   await new Promise(requestAnimationFrame);
   const board=document.getElementById('candidate-board'),header=document.querySelector('.leader-header');
   frames.push({focused:document.activeElement===board,clearance:board.getBoundingClientRect().top-header.getBoundingClientRect().bottom,scrollY,overflow:document.documentElement.scrollWidth>innerWidth});
  }return frames;
 });
 await info.attach('filter-confirm-settled-frames.json',{body:JSON.stringify({fixture,settled}),contentType:'application/json'});
 expect(settled.every(frame=>frame.focused&&frame.clearance>=-1&&!frame.overflow)).toBe(true);
 expect(Math.max(...settled.map(frame=>frame.scrollY))-Math.min(...settled.map(frame=>frame.scrollY))).toBeLessThanOrEqual(1);
 await expect(search).toHaveValue('ALPHALONG');
 await first.click();
 await expect(page.getByRole('region',{name:'銘柄詳細',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'← 候補一覧',exact:true}).click();
 await expect(search).toHaveValue('ALPHALONG');
 await expect(page.locator('#candidate-board')).toBeFocused();
 await expect(first).toBeVisible();
 await search.fill('');
 await expect(list.getByRole('listitem')).toHaveCount(rows.length);
 // The current-list jump button was removed as redundant. Exercise the
 // retained detail-to-list browse path by keyboard, including focus/clearance.
 // Enter intentionally opens comparison; Space keeps the native button
 // activation that opens this stock's detail, without changing that shortcut.
 await first.focus();await first.press('Space');
 await expect(page.getByRole('region',{name:'銘柄詳細',exact:true})).toBeVisible();
 const back=page.getByRole('button',{name:'← 候補一覧',exact:true});await back.focus();await back.press('Enter');
 await expect(page.locator('#candidate-board')).toBeFocused();
 await expect.poll(async()=>page.evaluate(()=>{
  const board=document.getElementById('candidate-board'),header=document.querySelector('.leader-header');
  const clearance=board.getBoundingClientRect().top-header.getBoundingClientRect().bottom;
  // Fractional browser layout can produce -0 when rounded. Bound the actual
  // gap/overlap to one CSS pixel, rather than comparing signed zero values.
  return {margin:parseFloat(getComputedStyle(board).scrollMarginTop),withinOnePixel:clearance>=-1&&clearance<=1};
 })).toEqual({margin:0,withinOnePixel:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
