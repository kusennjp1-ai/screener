import { openResearchList } from './research-navigation.js';
import { test, expect } from '@playwright/test';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';

// Synthetic static responses only. No private document URLs, source PDF text,
// financial captures, or live provider responses enter this browser fixture.
const date = '2026-10-02';
const row = withAuditFixture({ symbol: 'SOURCE', company_name: 'Synthetic source explanation fixture', market: 'US',
  current_price: 104, se_pivot_price: 100, adv_usd: 5e7, rs_rating: 95,
  market_above_50dma: true, market_above_200dma: true }, date);

for (const width of [1440, 375]) for (const theme of ['dark', 'light']) test(`book source scope and physical PDF pages at ${width}px ${theme}`, async ({ page }, info) => {
  test.setTimeout(90000);
  const errors = [], external = [], geometry = [];
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
  await page.clock.setFixedTime(new Date('2026-10-03T12:00:00Z'));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.route('**/static-data/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const json = name === 'manifest.json' ? { as_of_date: date, generated_at: '2026-10-03T01:00:00Z', research_generation: 'synthetic-book-source', assets: { research: { path: 'research.json' } } }
      : name === 'research.json' ? { as_of_date: date, rows: [row] } : {};
    return route.fulfill({ json });
  });
  await page.goto('/'); await openResearchList(page);
  const candidate = page.getByRole('button', { name: /^SOURCE の分析を表示/ });
  await expect(candidate).toBeVisible();
  if (theme === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
  if (width === 375) await candidate.click();
  const detail = page.getByRole('region', { name: '銘柄詳細', exact: true });
  const chooseMethod = async name => {
    if (width === 375) await page.getByRole('button', { name: '← 候補一覧', exact: true }).click();
    await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
    const filters = page.getByRole('dialog', { name: '候補を絞り込む' });
    await filters.getByRole('button', { name, exact: true }).click();
    await filters.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
    if (width === 375) await candidate.click();
    await detail.getByRole('tab', { name: '判定根拠', exact: true }).click();
  };
  const inspect = async (locator, stage) => {
    await locator.evaluate(element => element.scrollIntoView({ block: 'start' }));
    const boxes = await locator.locator('p, summary').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent, left: rect.left, right: rect.right, client: element.clientWidth, scroll: element.scrollWidth };
    }));
    for (const box of boxes) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width); expect(box.scroll).toBeLessThanOrEqual(box.client + 1); }
    geometry.push({ stage, boxes });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`book-source-${width}-${theme}-${stage}.png`) });
  };
  await expect(detail.locator('.entry-source-badge')).toHaveAccessibleName(/『株式トレード 基本と原則』のピボット追随目安/);
  const entry = detail.getByText('アプリ設定と書籍の確認範囲', { exact: true }).locator('..');
  if(width===375){
    await detail.getByRole('tab',{name:'購入条件',exact:true}).click();
    await detail.locator('.stock-entry-disclosure > summary').click();
  }
  await entry.locator('summary').click();
  await expect(entry).toContainText('『株式トレード 基本と原則』PDF 245頁');
  await expect(entry).toContainText('『成長株投資の神』（Zanger）PDF 181頁');
  await expect(entry).toContainText('『オニールの相場師養成講座』PDF 147・212頁');
  await expect(entry).toContainText('口座資金に対するリスク率');
  await expect(entry).toContainText('VCPの収縮深度には置き換えません');
  await expect(entry).toContainText('PDFの先頭を1');
  await inspect(entry, 'entry-uses');

  if(width===375)await detail.getByRole('tab',{name:'判定根拠',exact:true}).click();

  const trend = detail.getByText('トレンド条件の出典とアプリの近似', { exact: true }).locator('..');
  await trend.locator('summary').click();
  await expect(trend).toContainText('『ミネルヴィニの成長株投資法』');
  await expect(trend).toContainText('PDF 151–152頁');
  await expect(trend).toContainText('52週安値より30%以上');
  await expect(trend).toContainText('PDFの先頭を1');
  await inspect(trend, 'growth-template');
  await chooseMethod('基本と原則');
  if (!(await trend.evaluate(element => element.open))) await trend.locator('summary').click();
  await expect(trend).toContainText('『株式トレード 基本と原則』');
  await expect(trend).toContainText('PDF 221–222頁');
  await expect(trend).toContainText('52週安値より25%以上');
  await expect(trend).not.toContainText('第2冊の25%指定は未確認');
  await inspect(trend, 'principles-template');

  await chooseMethod('オニール');
  const financialSource = detail.getByText('オニール財務条件の出典とアプリの範囲', { exact: true }).locator('..');
  if (!(await financialSource.evaluate(element => element.open))) await financialSource.locator('summary').click();
  await expect(financialSource).toContainText('『オニールの相場師養成講座』PDF 197頁');
  await expect(financialSource).toContainText('年率複利25%以上と過去3年の各年増益');
  await expect(financialSource).toContainText('より厳しい独自条件');
  await expect(financialSource).toContainText('PDF 66・197・202頁');
  await expect(financialSource).toContainText('より狭い独自条件');
  await expect(financialSource).toContainText('PDFの先頭を1');
  await inspect(financialSource, 'oneil-selection');
  await detail.getByRole('tab', { name: '財務・機関', exact: true }).click();
  const panel = detail.getByRole('region', { name: '財務の判定根拠', exact: true });
  const panelSource = panel.getByText('オニール財務条件の出典とアプリの範囲', { exact: true }).locator('..');
  await panelSource.locator('summary').click();
  await expect(panelSource).toContainText('年率複利や加速とのOR条件へ判定を切り替えたものではありません');
  await expect(panelSource).toContainText('PDFの先頭を1');
  await inspect(panelSource, 'oneil-financial');
  await expect(page.getByText(/ここで示すのは確認済みの該当頁の要旨です/)).toContainText('全文精読や全230規則の実装を意味しません');
  await expect(page.locator('a[href*="drive.google"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(external.filter(url => new URL(url).hostname !== 'fonts.googleapis.com')).toEqual([]);
  await info.attach('synthetic-source-scope', { body: JSON.stringify({ syntheticOnly: true, sourcePdfFetchedByBrowser: false, privateSourceLinks: false,
    unchangedRules: ['entry state/warning/upper price', 'ranking', 'financial thresholds'], blockedExternalRequests: external.length, unexpectedExternalRequests: 0, geometry }), contentType: 'application/json' });
});
