import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Deterministic UI fixture, not an investment result. No canonical rule is replaced.
const rows = Array.from({length:43}, (_, i) => ({symbol:`TEST${i+1}`,company_name:`Synthetic test company ${i+1}`,market:'US',current_price:100+i,volume:2e8,rs_rating:80,composite_score:70,se_setup_score:65,se_pivot_price:null,se_setup_ready:null,se_volume_vs_50d:1.2,gics_sector:'Technology',se_pattern_primary:'cup_with_handle',pressure_state:'buy',buy_risk_state:'low',tpr_state:'transition',stage:2,rating:'Watch',chart_path:`test-${i}.json`}));
for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
  for (const theme of ['dark','light']) test(`scan accessibility and layout ${viewport.width} ${theme}`, async ({page}, info) => {
    await page.setViewportSize(viewport);
    await page.route('**/static-data/**', async route => {
      const file = new URL(route.request().url()).pathname.split('/').pop();
      const data = file === 'manifest.json' ? {as_of_date:'2026-09-29',pages:{scan:{path:'scan.json',list_path:'scan.json'}}}
        : file === 'scan.json' ? {as_of_date:'2026-09-29',rows_total:rows.length,initial_rows:rows,embedded_chart_paths:true,default_page_size:50,default_filters:{minVolume:100000000},sort:{field:'composite_score',order:'desc'},filter_options:{gics_sectors:['Technology']},preset_screens:[{id:'vcp',tier:1,short_name:'VCP',name:'VCP',filters:{vcpDetected:true},sort_by:'rs_rating',sort_order:'desc'}]} : {};
      await route.fulfill({json:data});
    });
    await page.goto('/#/scan');
    await expect(page.getByRole('heading',{name:'詳細スキャン',exact:true})).toBeVisible();
    await expect(page.getByText('43', {exact:true}).first()).toBeVisible();
    if (theme === 'light') await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
    if (viewport.width === 390) {
      await expect(page.getByTestId('mobile-scan-row')).toHaveCount(20);
      await expect(page.getByRole('navigation',{name:'詳細スキャンのページ送り'})).toContainText('1–20 / 43件');
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(height).toBeLessThanOrEqual(3000);
      await page.getByRole('button',{name:'次へ',exact:true}).click();
      await expect(page.getByRole('navigation',{name:'詳細スキャンのページ送り'})).toContainText('21–40 / 43件');
      await page.getByRole('button',{name:'前へ',exact:true}).click();
    } else {
      await expect(page.locator('th[data-column="rs_trend"]')).toHaveCount(0);
      await expect(page.locator('th[data-column="price_change_1d"]')).toHaveCount(0);
      await expect(page.getByText('補助スコア',{exact:true}).first()).toBeVisible();
    }
    const axe = await new AxeBuilder({page}).include('#root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    expect(axe.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`scan-${viewport.width}-${theme}.png`),fullPage:true});
    // Expanded controls must also retain names and sufficient contrast.
    if (viewport.width === 390) await page.getByRole('button',{name:'絞り込みを開く'}).click();
    await page.getByRole('button',{name:'財務を開く'}).click();
    const expanded = await new AxeBuilder({page}).include('#root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    expect(expanded.violations).toEqual([]);
  });
}
