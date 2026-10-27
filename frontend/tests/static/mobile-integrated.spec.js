import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { readFileSync } from 'node:fs';
const exchangeCalendar = JSON.parse(readFileSync(new URL('../../src/static/__fixtures__/nyse-sessions-2024-2026.json', import.meta.url), 'utf8'));
const calendarAt = date => ({...exchangeCalendar, as_of_date:date, range_end:date, sessions:exchangeCalendar.sessions.filter(day=>day<=date)});
import { FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../../src/static/testFinancialFixture.js';

// Synthetic test-only shape from bookAnnotations.test.js, with trading dates
// and a longer prefix to exercise the real inline/modal chart implementation.
const points = [[0,50],[60,100],[70,80],[80,98],[88,88],[96,96],[104,91],[110,99]];
const sessionCalendar = calendarAt(date);
const dates = sessionCalendar.sessions.slice(-280);
const bars = dates.map((session, index) => {
  const shapeIndex = index - 169;
  let close = 20 + index * 30 / 169;
  if (shapeIndex >= 0) {
    let segment = 1;
    while (points[segment][0] < shapeIndex) segment++;
    const [start, from] = points[segment-1], [end, to] = points[segment];
    close = from + (to - from) * (shapeIndex - start) / (end - start);
  }
  return {date:session,open:close,close,high:close+.2,low:close-.2,volume:20000-index*40};
});
const row = withAuditFixture({symbol:'VCPTEST',company_name:'Synthetic VCP browser fixture',currency:'USD',market:'US',current_price:99,se_pivot_price:96.2,adv_usd:5e7,rs_rating:95,chart_path:'VCPTEST.json'},date);

for (const width of [320,390]) test(`mobile integrated map, chart, VCP and watch at ${width}px`, async ({page}, info) => {
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width,height:844});
 await page.clock.setFixedTime(new Date(now));
 await page.route('**/static-data/**',route=>{
  const file=new URL(route.request().url()).pathname.split('/').pop();
  const payload=file==='manifest.json'?{as_of_date:date,generated_at:now,research_generation:'integrated-mobile-fixture',assets:{research:{path:'research.json'}}}
   :file==='research.json'?{as_of_date:date,rows:[{...row,gics_sector:'Technology'},{...row,symbol:'SECOND',gics_sector:'Healthcare',chart_path:'SECOND.json'}]}
   :file.endsWith('.json')&&['VCPTEST.json','SECOND.json'].includes(file)?{symbol:file.replace('.json',''),as_of_date:date,bars,session_calendar:sessionCalendar,stock_data:row,rs_line:[]}:{};
  return route.fulfill({json:payload});
 });
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'市場',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'銘柄を確認',exact:true})).toBeVisible();
 await expect(page.getByText('市場から、次の候補へ。',{exact:true})).toHaveCount(0);
 const skip=page.getByRole('link',{name:'メインコンテンツへ',exact:true});
 await skip.focus();await page.keyboard.press('Enter');
 await expect(page.locator('#research-main-content')).toBeFocused();
 await page.getByRole('navigation',{name:'リサーチの画面切替'}).getByRole('button',{name:'ウォッチ',exact:true}).click();
 const explore=page.getByRole('button',{name:'市場から銘柄を探す',exact:true});
 await expect(explore).toBeInViewport();
 await explore.click();
 await expect(page.getByRole('heading',{name:'市場',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'銘柄を確認',exact:true})).toBeVisible();
 await expect(page.getByText('市場から、次の候補へ。',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/情報技術.*RS中央値/})).toBeVisible();
 await page.getByRole('button',{name:'VCPTEST のチャートを確認'}).click();
 await page.getByRole('tab',{name:'VCP',exact:true}).click();
 const panel=page.getByRole('region',{name:'VCPTEST のVCP分析'});
 await expect(panel).toContainText('値幅の縮小を確認');
 const metric=panel.locator('.chart-setup-metrics details').nth(1);
 await expect(metric).not.toHaveAttribute('open');
 await metric.locator('summary').click();
 await expect(metric).toHaveAttribute('open');
 await expect(metric).toContainText('区間高値 − 区間安値');
 await expect(panel.locator('.chart-setup-metrics')).toBeVisible();
 await metric.locator('summary').focus();
 await page.keyboard.press('Enter');
 await expect(metric).not.toHaveAttribute('open');
 await page.keyboard.press('Space');
 await expect(metric).toHaveAttribute('open');
 const summaryBox=await metric.locator('summary').boundingBox();
 expect(summaryBox.height).toBeGreaterThanOrEqual(44);
 expect(summaryBox.width).toBeGreaterThanOrEqual(44);
 await panel.getByRole('button',{name:'C1 の収縮区間を表示'}).click();
 await expect(page.getByRole('tab',{name:'チャート',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'VCP',exact:true}).click();
 await expect(panel.getByRole('button',{name:'C1 の収縮区間を表示'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('tab',{name:'財務・機関',exact:true}).click();
 await expect(page.locator('.leader-detail-code33')).not.toHaveAttribute('open');
 await page.getByRole('tab',{name:'購入条件',exact:true}).click();
 await page.getByRole('button',{name:/^出来高：/}).click();
 const volume=page.locator('#condition-rule-volume details');
 await expect(volume).toHaveAttribute('open');
 await expect(volume.locator('summary')).toBeFocused();
 await expect(page.locator('#condition-rule-market details')).not.toHaveAttribute('open');
 await volume.locator('summary').click();
 await expect(volume).not.toHaveAttribute('open');
 // The old last-child nowrap rule can clip a disclosure while document overflow
 // still passes. Measure the long explanation itself, including its text range.
 const modelRule=page.locator('.condition-rules details').first();
 await modelRule.locator('summary').click();
 const explanation=await modelRule.locator('.metric-disclosure-body').evaluate(node=>{
  const range=document.createRange();range.selectNodeContents(node);
  return {width:node.clientWidth,scrollWidth:node.scrollWidth,box:node.getBoundingClientRect().toJSON(),text:range.getBoundingClientRect().toJSON()};
 });
 expect(explanation.scrollWidth).toBeLessThanOrEqual(explanation.width+1);
 expect(explanation.text.right).toBeLessThanOrEqual(explanation.box.right+1);
 expect(explanation.text.height).toBeGreaterThan(30);
 await modelRule.locator('summary').click();
 await page.locator('.mobile-chart-actions').getByRole('button',{name:'ウォッチに保存',exact:true}).click();
 await page.getByRole('button',{name:'← 候補一覧',exact:true}).click();
 await page.getByRole('navigation',{name:'リサーチの画面切替'}).getByRole('button',{name:'ウォッチ',exact:true}).click();
 await expect(page.getByRole('button',{name:/^VCPTEST の分析を表示/})).toBeVisible();
 await expect(page.getByRole('button',{name:/^SECOND の分析を表示/})).toHaveCount(0);
 await page.getByRole('navigation',{name:'リサーチの画面切替'}).getByRole('button',{name:'市場',exact:true}).click();
 await page.getByRole('button',{name:'VCPTEST のチャートを確認'}).click();
 await page.getByRole('button',{name:'次の銘柄',exact:true}).click();
 await expect(page.locator('.research-symbol-head h2')).toHaveText('SECOND');
 await expect(page.getByRole('tab',{name:'チャート',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'VCP',exact:true}).click();
 await expect(page.getByRole('region',{name:'SECOND のVCP分析'})).toBeVisible();
 await expect(page.locator('.chart-setup-metrics details[open]')).toHaveCount(0);
 await expect(page.locator('.condition-rules details[open]')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const controls=await page.locator('.stock-section-nav button,.mobile-chart-actions button').evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
 expect(controls).toHaveLength(9);
 expect(controls.every(r=>r.w>=44&&r.h>=44)).toBe(true);
 await info.attach('mobile-integrated',{body:await page.screenshot(),contentType:'image/png'});
 expect((await new AxeBuilder({page}).include('.stock-section-nav').analyze()).violations).toEqual([]);
 expect(errors).toEqual([]);
});
