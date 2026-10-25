import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../../src/static/testFinancialFixture.js';

// Synthetic test-only shape from bookAnnotations.test.js, with trading dates
// and a longer prefix to exercise the real inline/modal chart implementation.
const points = [[0,50],[60,100],[70,80],[80,98],[88,88],[96,96],[104,91],[110,99]];
const dates = [], day = new Date(`${date}T00:00:00Z`);
while (dates.length < 280) {
  if (![0,6].includes(day.getUTCDay())) dates.unshift(day.toISOString().slice(0,10));
  day.setUTCDate(day.getUTCDate() - 1);
}
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
   :file.endsWith('.json')&&['VCPTEST.json','SECOND.json'].includes(file)?{symbol:file.replace('.json',''),as_of_date:date,bars,stock_data:row,rs_line:[]}:{};
  return route.fulfill({json:payload});
 });
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'市場から、次の候補へ。'})).toBeVisible();
 await expect(page.getByRole('button',{name:/情報技術.*RS中央値/})).toBeVisible();
 await page.getByRole('button',{name:'VCPTEST のチャートを確認'}).click();
 const panel=page.getByRole('region',{name:'VCPTEST のVCP分析'});
 await expect(panel).toContainText('VCP候補を検出');
 await panel.getByRole('button',{name:'VCPの根拠を開く ↑'}).click();
 await expect(panel.locator('.chart-setup-metrics')).toBeVisible();
 await panel.getByRole('button',{name:'C1 の収縮区間を表示'}).click();
 await expect(panel.getByRole('button',{name:'C1 の収縮区間を表示'})).toHaveAttribute('aria-pressed','true');
 await page.locator('.mobile-chart-actions').getByRole('button',{name:'ウォッチに保存',exact:true}).click();
 await page.getByRole('navigation',{name:'リサーチの画面切替'}).getByRole('button',{name:'ウォッチ',exact:true}).click();
 await expect(page.getByRole('button',{name:/^VCPTEST の分析を表示/})).toBeVisible();
 await expect(page.getByRole('button',{name:/^SECOND の分析を表示/})).toHaveCount(0);
 await page.getByRole('navigation',{name:'リサーチの画面切替'}).getByRole('button',{name:'市場',exact:true}).click();
 await page.getByRole('button',{name:'VCPTEST のチャートを確認'}).click();
 await page.getByRole('button',{name:'次の銘柄',exact:true}).click();
 await expect(page.locator('.research-symbol-head h2')).toHaveText('SECOND');
 await expect(page.getByRole('region',{name:'SECOND のVCP分析'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const controls=await page.locator('.mobile-research-nav button,.mobile-chart-actions button').evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
 expect(controls.every(r=>r.w>=44&&r.h>=44)).toBe(true);
 await info.attach('mobile-integrated',{body:await page.screenshot(),contentType:'image/png'});
 expect((await new AxeBuilder({page}).include('.mobile-research-nav').analyze()).violations).toEqual([]);
 expect(errors).toEqual([]);
});
