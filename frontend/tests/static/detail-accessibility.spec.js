import { expectSvgChart } from './svg-chart-observation.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../../src/static/testFinancialFixture.js';
import { nativeAnnualFixture } from '../../src/test/fixtures/nativeAnnual.js';
import { expandedChartGeometry, checkExpandedChartGeometry } from '../../tools/expanded-chart-geometry.mjs';

const generatedAt = '2026-10-03T15:35:00Z';
const annual = nativeAnnualFixture('CAD', [1, 0, 2, 4]);
const history = { ...annual, symbol:'SYNTH', as_of_date:date, retrieved_at:generatedAt,
  annual_source:{...annual.annual_source,symbol:'SYNTH',observed_at:generatedAt} };
const rows = ['SYNTH', 'OTHER'].map(symbol => withFinancialProof(withAuditFixture({ symbol, company_name:`Synthetic accessibility ${symbol}`, currency:'USD',
  current_price:102, se_pivot_price:100, adv_usd:5e7, rs_rating:95, eps_rating:null, composite_rating:null,
  eps_growth_yy:30, sales_growth_yy:-4, annual_eps_growth_3y:null, financial_history:symbol==='SYNTH'?history:undefined,
  ibd_group_rank:null, market_above_50dma:true, market_above_200dma:true, chart_path:`${symbol}.json` }, date)));
// Synthetic prices for a registry-known fund exercise the existing N/A state.
rows.push(withAuditFixture({symbol:'BITU',market:'US',company_name:'ProShares Ultra Bitcoin ETF',as_of_date:date,
  current_price:102,se_pivot_price:100,adv_usd:5e7,rs_rating:95,chart_path:'BITU.json',research_detail_path:'failed-detail.json'},date));
const bars = Array.from({length:280}, (_,i) => ({ date:new Date(Date.parse(date)-(279-i)*86400000).toISOString().slice(0,10),
  open:90+i*.04, high:91+i*.04, low:89+i*.04, close:90.5+i*.04, volume:i===279?0:1e6+i*1000 }));

for (const width of [375,1440]) for (const theme of ['dark','light']) test(`detail keyboard, financial labels and numeric chart at ${width}px ${theme}`, async ({page}, info) => {
  const errors=[], external=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.setViewportSize({width,height:width===375?812:1000});
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/*', route => {
    if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort();}
    return route.continue();
  });
  await page.route('**/static-data/**', route => {
    const file=new URL(route.request().url()).pathname.split('/').pop(), row=rows.find(r=>r.chart_path===file);
    if(file==='failed-detail.json')return route.fulfill({status:503,json:{error:'Synthetic detail failure'}});
    const data=file==='manifest.json'?{as_of_date:date,generated_at:generatedAt,research_generation:'synthetic-accessibility',default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'},charts:{path:'index.json'}},pages:{}}}}
      :file==='research.json'?{as_of_date:date,rows}
      :file==='index.json'?{as_of_date:date,symbols:rows.map(r=>({symbol:r.symbol,path:r.chart_path}))}
      :row?{symbol:row.symbol,as_of_date:date,generated_at:generatedAt,bars,stock_data:row,rs_line:[]}:{};
    return route.fulfill({json:data});
  });
  await page.goto('/#/?method=oneil');
  if(theme==='light')await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
  const candidate=page.getByRole('button',{name:/^SYNTH の分析を表示/});
  await expect(candidate).toBeVisible();
  await candidate.focus();await page.keyboard.press('Space');
  const detail=page.getByRole('region',{name:'銘柄詳細',exact:true});
  if(width===375)await expect(detail).toBeFocused();
  await expectSvgChart(detail,{symbol:'SYNTH',bars});
  const records=[];
  const visibleFocus=async (locator, label)=>{
    const box=await locator.boundingBox(), header=await page.locator('.leader-header').boundingBox();
    const nav=width===375?await page.locator('.leader-mobile-nav').boundingBox():null;
    expect(box.x,label).toBeGreaterThanOrEqual(0);expect(box.x+box.width,label).toBeLessThanOrEqual(width);
    expect(box.y,label).toBeGreaterThanOrEqual(header.y+header.height);
    expect(box.y+box.height,label).toBeLessThanOrEqual(nav?.y??page.viewportSize().height);
    records.push({label,box,header,nav});
  };
  await detail.locator('.readiness-chip').focus();await page.keyboard.press('Enter');
  const conditionTab=detail.getByRole('tab',{name:'購入条件',exact:true});
  await expect(conditionTab).toBeFocused();await visibleFocus(conditionTab,'purchase-shortcut-focus');
  await page.keyboard.press('ArrowRight');
  const financialTab=detail.getByRole('tab',{name:'財務・機関'});
  await expect(financialTab).toBeFocused();await expect(financialTab).toHaveAttribute('aria-selected','true');
  const financial=detail.getByRole('region',{name:'財務の判定根拠'});
  const financialContext=financial.getByRole('group',{name:'財務根拠の参照情報'});
  const provenance=financialContext.locator('details'),provenanceToggle=provenance.locator('summary');
  const correspondence=financialContext.locator(':scope > p').first();
  await expect(provenance).not.toHaveAttribute('open');
  await expect(correspondence).toBeVisible();
  await expect(correspondence).toHaveText('財務根拠の対象日 2026-10-02 ／ 日付の対応 一致 ／ 配信版の対応 一致');
  await expect(financialContext.getByText('配信版は画面と表示用データの対応を示します。提供元の版や取得日時とは別です。',{exact:true})).toBeVisible();
  await financialContext.evaluate(e=>e.scrollIntoView({block:'center'}));
  await visibleFocus(financialContext,'financial-evidence-context');
  await page.screenshot({path:info.outputPath(`financial-context-${width}-${theme}.png`)});
  await provenanceToggle.focus();await page.keyboard.press('Enter');
  await expect(provenance).toHaveAttribute('open');await expect(provenanceToggle).toBeFocused();
  await expect(provenance.getByText('分析基準日 2026-10-02 ／ 画面の配信版 synthetic-accessibility',{exact:true})).toBeVisible();
  await expect(provenance.getByText('財務根拠の配信版 synthetic-accessibility',{exact:true})).toBeVisible();
  await financialContext.evaluate(e=>e.scrollIntoView({block:'center'}));
  await visibleFocus(financialContext,'financial-provenance-expanded');
  await page.screenshot({path:info.outputPath(`financial-provenance-${width}-${theme}.png`)});
  await page.keyboard.press('Space');
  await expect(provenance).not.toHaveAttribute('open');await expect(provenanceToggle).toBeFocused();
  await visibleFocus(provenanceToggle,'financial-provenance-focus-return');
  await expect(correspondence).toBeVisible();
  const eps=financial.getByRole('heading',{name:'四半期 EPS 前年同期比',exact:true}).locator('..').locator('..').locator('..');
  await expect(eps).toContainText('通過');await expect(eps).toContainText('30%');await expect(eps).toContainText('≥ 25%');
  await expect(eps).toContainText('2026-06-30');await expect(eps).toContainText('2025-06-30');await expect(eps).toContainText('2026-10-03');
  const sales=financial.locator('#financial-evidence-sales_growth_yy');
  await expect(sales).toContainText('未達');await expect(sales).toContainText('−4%');
  await expect(financial.locator('[data-state="unknown"]').first()).toContainText('未確認');
  await expect(financial.locator('#financial-evidence-annual_eps_growth_3y')).toContainText('通常の成長率は比較不可');
  await eps.evaluate(e=>e.scrollIntoView({block:'center'}));await visibleFocus(eps,'eps-reason-threshold-dates');
  await page.screenshot({path:info.outputPath(`financial-${width}-${theme}.png`)});
  expect((await new AxeBuilder({page}).include('.research-detail').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  const financialHistory=detail.getByText('取得した財務履歴 — 年次EPS・四半期業績',{exact:true});
  await financialHistory.focus();await page.keyboard.press('Enter');
  const annualTable=detail.getByRole('table',{name:'年次の希薄化EPS'});
  await expect(annualTable).toContainText('CAD');await expect(annualTable.getByRole('cell',{name:'0',exact:true})).toBeVisible();
  await annualTable.evaluate(e=>e.scrollIntoView({block:'center'}));
  const annualBounds=await annualTable.evaluate(e=>({client:e.parentElement.clientWidth,scroll:e.parentElement.scrollWidth}));
  expect(annualBounds.scroll).toBeLessThanOrEqual(annualBounds.client+1);
  await page.screenshot({path:info.outputPath(`annual-history-${width}-${theme}.png`)});
  const numeric=detail.locator('.chart-numeric-data');
  await numeric.locator('summary').focus();await page.keyboard.press('Space');
  await expect(numeric).toHaveAttribute('open');
  const dates=numeric.getByRole('combobox',{name:'SYNTH の日付'});
  await dates.focus();await page.keyboard.press('ArrowDown');
  await expect(dates).toHaveValue('2026-10-01');await expect(numeric).toContainText('対象日 2026-10-01');
  await page.keyboard.press('Home');await expect(dates).toHaveValue(date);await page.keyboard.press('Tab');
  await expect(detail.locator('[data-chart-asof]')).toHaveAttribute('data-chart-asof',date);
  await expect(numeric.getByText('出来高',{exact:true}).locator('..')).toHaveText('出来高0');
  await numeric.evaluate(e=>e.scrollIntoView({block:'center'}));await visibleFocus(numeric,'daily-numeric-values');
  await page.screenshot({path:info.outputPath(`daily-numeric-${width}-${theme}.png`)});
  const opener=detail.getByRole('button',{name:'日次チャートを分析'});
  await opener.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  if(width===375){
    await page.setViewportSize({width:390,height:568});
    let initialGeometry;
    try {
      await expect.poll(async()=>{
        initialGeometry=await dialog.evaluate(expandedChartGeometry);
        const failures=[];checkExpandedChartGeometry(initialGeometry,(pass,message)=>{if(!pass)failures.push(message);},'short-phone initial',{fullChart:true});return failures;
      }).toEqual([]);
    } finally {
      await info.attach(`short-phone-initial-${theme}.json`,{body:JSON.stringify(initialGeometry??{unavailable:true,reason:'Geometry evaluation did not complete'},null,2),contentType:'application/json'});
    }
    await page.screenshot({path:info.outputPath(`expanded-short-390x568-${theme}.png`)});
    await page.setViewportSize({width:390,height:480});
    await dialog.locator('[data-chart-symbol]').evaluate(node=>node.scrollIntoView({block:'end'}));
    await expect.poll(async()=>{const geometry=await dialog.evaluate(expandedChartGeometry);return geometry.date_axis_visible&&geometry.date_axis_hit&&geometry.close_visible&&geometry.close_hit&&geometry.footer_controls.every(button=>button.visible&&button.hit);}).toBe(true);
    await page.screenshot({path:info.outputPath(`expanded-scrolled-390x480-${theme}.png`)});
    await page.setViewportSize({width,height:812});
    await dialog.getByTestId('expanded-chart-scroll').evaluate(node=>{node.scrollTop=0;});
  }
  const conditions=dialog.getByText(/選定条件の詳細（/);
  await conditions.focus();await page.keyboard.press('Space');
  await expect(dialog.getByText(/選出の一次条件です/)).toContainText('購入条件とは別に確認');
  await expect(dialog.getByRole('group',{name:'選出データの参照情報'})).toContainText('選出データの対象日 2026-10-02 ／ 日付の対応 一致');
  await dialog.getByRole('group',{name:'選出データの参照情報'}).evaluate(e=>e.scrollIntoView({block:'center'}));
  await page.screenshot({path:info.outputPath(`selection-context-${width}-${theme}.png`)});
  const rules=dialog.getByRole('list',{name:'選定条件の判定内訳'});
  await expect(rules).toContainText('EPS 前年同期比 ≥ 25%：✓ 通過 · 30%');
  await expect(rules).toContainText('売上高 前年同期比 ≥ 25%：× 未達 · -4%');
  await expect(rules).toContainText('? 未確認');
  await rules.evaluate(e=>e.scrollIntoView({block:'center'}));
  await page.screenshot({path:info.outputPath(`expanded-conditions-${width}-${theme}.png`)});
  const modalNumeric=dialog.locator('.chart-numeric-data');
  await modalNumeric.locator('summary').focus();await page.keyboard.press('Space');
  await expect(modalNumeric).toHaveAttribute('open');
  await expect(dialog).toHaveAccessibleName(/SYNTH/); // Space on summary must not navigate to OTHER.
  await modalNumeric.evaluate(e=>e.scrollIntoView({block:'center'}));
  await page.screenshot({path:info.outputPath(`expanded-numeric-${width}-${theme}.png`)});
  expect((await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  if(width===375){
    await dialog.getByRole('button',{name:'次の銘柄',exact:true}).click();
    await expect(dialog).toHaveAccessibleName(/BITU/);
    const readiness=dialog.getByTestId('mobile-chart-readiness');
    await expect(readiness).toContainText('対象外：共通購入モデルへの適合');
    await expect(readiness.getByText(/^未達・未確認：/)).not.toContainText('共通購入モデルへの適合');
    await visibleFocus(readiness,'not-applicable-mobile-summary');
    await page.screenshot({path:info.outputPath(`not-applicable-375-${theme}.png`)});
    await page.setViewportSize({width:390,height:568});
    await expect(dialog.getByTestId('expanded-chart-warning')).toContainText('未取得の条件は合格扱いにしていません');
    await expect.poll(async()=>{
      const geometry=await dialog.evaluate(expandedChartGeometry),failures=[];
      checkExpandedChartGeometry(geometry,(pass,message)=>{if(!pass)failures.push(message);},'short-phone failed detail');return failures;
    }).toEqual([]);
    await page.screenshot({path:info.outputPath(`expanded-failed-detail-390x568-${theme}.png`)});
    await page.setViewportSize({width,height:812});
  }
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();await visibleFocus(opener,'expanded-chart-focus-return');
  await financialTab.focus();await page.keyboard.press('End');await expect(detail.getByRole('tab',{name:'メモ'})).toBeFocused();
  await page.keyboard.press('Home');await expect(detail.getByRole('tab',{name:'判定根拠'})).toBeFocused();
  if(width===375){
    const back=page.getByRole('button',{name:'← 候補一覧',exact:true});
    await back.focus();await page.keyboard.press('Enter');
    await expect(page.getByRole('region',{name:'対象銘柄',exact:true})).toBeFocused();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);expect(external.filter(url=>new URL(url).hostname!=='fonts.googleapis.com')).toEqual([]);
  await info.attach('accessibility-measurements',{body:JSON.stringify({records,annualBounds,blockedExternalRequests:external.length,pageErrors:errors}),contentType:'application/json'});
});
