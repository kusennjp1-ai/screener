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
      const scoreHeader=page.locator('th[data-column="composite_score"]');
      await expect(scoreHeader.getByText('補助スコア',{exact:true})).toBeVisible();
      expect(await scoreHeader.evaluate(cell=>cell.scrollWidth<=cell.clientWidth)).toBe(true);
    }
    const axe = await new AxeBuilder({page}).include('#root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    expect(axe.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`scan-${viewport.width}-${theme}.png`),fullPage:true});
    // Expanded controls must also retain names and sufficient contrast.
    if (viewport.width === 390) {
      const tools = page.getByRole('button', {name: /条件・使い方/});
      await expect(tools).toHaveAttribute('aria-expanded', 'false');
      await tools.click();
      await expect(tools).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button',{name:'絞り込みを閉じる'})).toBeVisible();
    } else {
      await page.getByRole('button',{name:'絞り込みを開く'}).click();
    }
    await page.getByRole('button',{name:'財務を開く'}).click();
    const expanded = await new AxeBuilder({page}).include('#root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    expect(expanded.violations).toEqual([]);
  });
}

// Exercise the real overflow strip, not just a screenshot of its clipped edge.
// Synthetic presets intentionally use simple RS filters, not investment rules.
const presetIds=['minervini','minervini_vcp','minervini_usic','canslim','ibd_composite','ibd50','vcp','blue_dot_leaders','vol_break','episodic_pivot','momentum','kell_growth','rs_power','leaders_in_leading_groups','new_highs','pocket_pivot','power_trend','accumulation','se_cup_handle','se_double_bottom','se_high_tight_flag','se_first_pullback','se_three_weeks_tight','se_nr7_inside_day','gainers_4pct','movers_9m','movers_20_weekly','club_97'];
for(const width of [1440,390]) for(const theme of ['dark','light']) {
  test(`scan far-right preset remains reachable ${width} ${theme}`,async({page},info)=>{
    await page.setViewportSize({width,height:width===390?844:900});
    const presetRows=rows.map((row,index)=>({...row,rs_rating:index===0?95:80}));
    const presets=presetIds.map((id,index)=>({id,tier:index<10?1:2,name:id,short_name:id,
      filters:{rsRating:{min:id==='club_97'?90:80,max:null}},sort_by:'rs_rating',sort_order:'desc'}));
    await page.route('**/static-data/**',async route=>{
      const file=new URL(route.request().url()).pathname.split('/').pop();
      const data=file==='manifest.json'?{as_of_date:'2026-09-29',pages:{scan:{path:'scan.json',list_path:'scan.json'}}}
        :file==='scan.json'?{as_of_date:'2026-09-29',rows_total:presetRows.length,initial_rows:presetRows,embedded_chart_paths:true,default_page_size:50,
          default_filters:{minVolume:100000000},sort:{field:'rs_rating',order:'desc'},filter_options:{gics_sectors:['Technology']},preset_screens:presets}:{};
      await route.fulfill({json:data});
    });
    await page.goto('/#/scan');
    await expect(page.getByRole('heading',{name:'詳細スキャン',exact:true})).toBeVisible();
    if(theme==='light') await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
    if(width===390) await page.getByRole('button',{name:/条件・使い方/}).click();
    const allStocks=page.getByRole('button',{name:'全銘柄',exact:true});
    // ScreenSelector's all-stocks chip is a direct child of its scroll Box.
    const strip=allStocks.locator('..');
    const farRight=strip.getByRole('button',{name:'補助 騰落上位3% (1)',exact:true});
    await expect(farRight).toBeEnabled();
    expect(await strip.evaluate(el=>getComputedStyle(el).overflowX)).toBe('auto');
    expect(await strip.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await strip.hover();
    await page.mouse.wheel(10000,0);
    await expect.poll(()=>strip.evaluate(el=>Math.abs(el.scrollWidth-el.clientWidth-el.scrollLeft))).toBeLessThanOrEqual(1);
    const expectCompletePreset=async()=>{
      await expect(farRight).toHaveAccessibleName('補助 騰落上位3% (1)');
      await expect(farRight).toBeInViewport({ratio:1});
      await expect.poll(()=>strip.evaluate(el=>{
        const chips=el.querySelectorAll('[role="button"]'),chip=chips[chips.length-1];
        const box=chip.getBoundingClientRect(),bounds=el.getBoundingClientRect(),label=chip.querySelector('.MuiChip-label');
        return box.left>=Math.max(0,bounds.left) && box.right<=Math.min(innerWidth,bounds.right)+1
          && label.scrollWidth<=label.clientWidth;
      })).toBe(true);
    };
    await expectCompletePreset();
    const chips=strip.getByRole('button');
    await chips.nth(await chips.count()-2).focus();
    await page.keyboard.press('Tab');
    await expect(farRight).toBeFocused();
    await expectCompletePreset();
    await farRight.click();
    await expect(page).toHaveURL(/#\/scan\?screen=club_97$/);
    await expect(farRight).toHaveClass(/MuiChip-filled/);
    if(width===390) await expect(page.getByTestId('mobile-scan-row')).toHaveCount(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expectCompletePreset();
    await page.screenshot({path:info.outputPath(`scan-presets-end-${width}-${theme}.png`)});
  });
}
