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

for (const width of [390,1440]) test(`VCP evidence reveals measured chart intervals inline and expanded at ${width}px`, async ({page}, info) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/*',route=>new URL(route.request().url()).hostname!=='127.0.0.1'?route.abort():route.continue());
  await page.route('**/static-data/**',route=>{
    const file=new URL(route.request().url()).pathname.split('/').pop();
    const payload=file==='manifest.json'?{as_of_date:date,generated_at:'2026-10-03T15:35:00Z',research_generation:'synthetic-vcp-browser',default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'},charts:{path:'index.json'}},pages:{}}}}
      :file==='research.json'?{as_of_date:date,rows:[row]}
      :file==='index.json'?{as_of_date:date,symbols:[{symbol:row.symbol,path:row.chart_path}]}
      :file===row.chart_path?{symbol:row.symbol,as_of_date:date,bars,session_calendar:sessionCalendar,stock_data:row,rs_line:[]}:{};
    return route.fulfill({json:payload});
  });
  await page.goto('/#/');
  if (width === 390) await page.getByRole('button',{name:'一覧・絞り込みで探す →'}).click();
  const candidate=page.getByRole('button',{name:/^VCPTEST の分析を表示/});
  await expect(candidate).toBeVisible();await candidate.click();
  const detail=page.getByRole('region',{name:'銘柄詳細',exact:true});
  if(width===390)await detail.getByRole('tab',{name:'VCP',exact:true}).click();
  const panel=detail.getByRole('region',{name:'VCPTEST のVCP分析'});
  await expect(panel).toContainText('値幅の縮小を確認');
  const initialRange=await detail.getByTestId('chart-visible-range').textContent();
  const first=panel.getByRole('button',{name:'C1 の収縮区間を表示'});
  await first.click();
  if(width===390){
    await expect(detail.getByRole('tab',{name:'チャート',exact:true})).toHaveAttribute('aria-selected','true');
  }else {await expect(first).toHaveAttribute('aria-pressed','true');await expect(first).toBeFocused();}
  await expect(detail.getByTestId('chart-visible-range')).not.toHaveText(initialRange);
  await expect(detail.locator('[data-chart-symbol="VCPTEST"]')).toHaveAttribute('data-chart-annotation-mode','detail');
  const plot=detail.locator('[data-chart-symbol="VCPTEST"]');
  await expect.poll(async()=>{const box=await plot.boundingBox(),header=await page.locator('.leader-header').boundingBox();return box.y>=header.y+header.height-1 && box.y<page.viewportSize().height-100;}).toBe(true);
  await page.screenshot({path:info.outputPath(`vcp-inline-focus-${width}.png`)});
  await detail.getByRole('button',{name:'週足',exact:true}).click();
  if(width===390)await detail.getByRole('tab',{name:'VCP',exact:true}).click();
  await expect(panel).toContainText('日足に切り替えてください');
  await expect(panel.getByRole('button',{name:/の収縮区間を表示/})).toHaveCount(0);
  if(width===390)await detail.getByRole('tab',{name:'チャート',exact:true}).click();
  await detail.getByRole('button',{name:'日足',exact:true}).click();
  if(width===390)await detail.getByRole('tab',{name:'VCP',exact:true}).click();
  await expect(panel.getByRole('button',{name:'C1 の収縮区間を表示'})).toBeVisible();
  if(width===390)await detail.getByRole('tab',{name:'チャート',exact:true}).click();
  await detail.getByRole('button',{name:'日次チャートを分析'}).click();
  const dialog=page.getByRole('dialog'),expanded=dialog.getByRole('region',{name:'VCPTEST のVCP分析'});
  await expect(expanded).toContainText('値幅の縮小を確認');
  const second=expanded.getByRole('button',{name:'C2 の収縮区間を表示'});
  const expandedRange=await dialog.getByTestId('chart-visible-range').textContent();
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed','true');await expect(second).toBeFocused();
  await expect(dialog.getByTestId('chart-visible-range')).not.toHaveText(expandedRange);
  await expect.poll(async()=>{const box=await dialog.locator('[data-chart-symbol="VCPTEST"]').boundingBox(),header=await dialog.getByTestId('expanded-chart-header').boundingBox();return box.y>=header.y+header.height-1 && box.y<page.viewportSize().height-100;}).toBe(true);
  await page.screenshot({path:info.outputPath(`vcp-expanded-focus-${width}.png`)});
  await expanded.scrollIntoViewIfNeeded();
  expect(await expanded.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('[role="dialog"] .chart-setup-evidence').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect(detail.getByRole('button',{name:'日次チャートを分析'})).toBeFocused();
  expect(errors).toEqual([]);
});
