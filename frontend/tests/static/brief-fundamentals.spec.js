// Daily brief fundamentals: the SEC quarters with their source and reasons, the detail's loading and
// failure states, and the phone's text floor on the fundamentals rows, on synthetic data.
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, horizontalOverflow, SEC_SYMBOL } from './brief-fixture.js';

const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);

  test('fundamentals show the latest SEC quarter with its source and say why a value is missing', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    const card = page.getByTestId('brief-fundamentals');
    await expect(card.getByText('出典：SEC XBRL（10-K 2026-08-09 提出）・2026-06期まで・売上/純利益のQ4は10-K年度値−3四半期で算出')).toBeVisible();
    const epsTile = card.locator('.brief-fact').filter({ hasText: 'EPS 前年比' });
    await expect(epsTile).toContainText('+40%');
    await expect(epsTile).toContainText('2026-03期・最新 2026-06期はQ4のEPSは年次報告のみ');
    // The June quarter's sales are a derived Q4 compared with a derived Q4 a year earlier.
    await expect(card.locator('.brief-fact').filter({ hasText: '売上 前年比' })).toContainText('2026-06期・前期 +60%・前年同期はQ4算出');
    await expect(card.getByText('Q4算出').first()).toBeAttached();
    await expect(card.getByText('Code 33 未確認')).toBeVisible();
    await expect(card).toContainText('EPS の加速は第4四半期の EPS が年次報告（10-K）にしか無いため未確認です');
    await expect(card.getByRole('img', { name: /四半期の前年同期比成長率/ })).toBeVisible();
    // Each grey bar's reason is text (a phone shows no SVG title), and the periods and margins under the
    // bars read at 12px at every width.
    await expect(card.getByRole('list', { name: '値なしの理由' })).toContainText('EPS 前年比：25-06・26-06期はQ4のEPSは年次報告のみ');
    await expect(card).not.toContainText(/カーソル|長押し/);
    const axis = await card.locator('.brief-q-axis > span > *').evaluateAll(nodes => nodes.map(node => [node.textContent, parseFloat(getComputedStyle(node).fontSize), node.scrollWidth > node.clientWidth + 0.5]));
    expect(axis.length).toBeGreaterThanOrEqual(24);
    expect(axis.filter(([, size, cut]) => size < 12 || cut)).toEqual([]);
    // The legend swatches use a radius token (Design Acceptance flags any other corner radius).
    const swatches = await card.locator('.brief-q-legend i').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderTopLeftRadius));
    expect(swatches.length).toBeGreaterThanOrEqual(3);
    for (const radius of swatches) expect(['4px', '8px', '12px', '16px']).toContain(radius);
    await expect(card).not.toContainText('未取得');
    expect(await horizontalOverflow(page)).toBe(0);
    // A stock without a published SEC record names that reason in every tile.
    await page.goto('/#/brief/stock/ZZKS');
    const other = page.getByTestId('brief-fundamentals');
    await expect(other.locator('.brief-fact').first()).toContainText('SEC 未配信');
    await expect(other).toContainText('この銘柄の当日分の SEC 四半期データは配信されていません');
    await expect(other).not.toContainText('未取得');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('while the research detail loads or after it fails, the SEC record is never called 未配信', async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { detailGate: gate });
    const card = page.getByTestId('brief-fundamentals');
    await expect(card.locator('.brief-fact').first()).toContainText('読み込み中…');
    await expect(card).toContainText('Code 33 読み込み中');
    await expect(card).not.toContainText(/SEC 未配信|配信されていません/);
    release();
    await expect(card.getByText(/^出典：SEC XBRL/)).toBeVisible();
    await expect(card).not.toContainText(/読み込み中|未配信/);
    // A detail that answers 503 says it could not be fetched, for good, and never 未配信.
    const failed = await page.context().newPage();
    const second = await openBrief(failed, `#/brief/stock/${SEC_SYMBOL}`, { fail: 'detail' });
    const failedCard = failed.getByTestId('brief-fundamentals');
    await expect(failedCard.locator('.brief-fact').first()).toContainText('取得できません', { timeout: 30000 });
    await expect(failedCard).toContainText('詳細データを取得できません。');
    await expect(failedCard).not.toContainText(/SEC 未配信|配信されていません/);
    expect(errors).toEqual([]);
    expect(second.errors).toEqual([]);
  });
});

test.describe('phone secondary text on the fundamentals rows', () => {
  test.use(phone(375, 812));
  const sizes = (page, selector) => page.locator(selector).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => [node.className, node.textContent.slice(0, 20), parseFloat(getComputedStyle(node).fontSize)]));
  test('reads at 12px or more', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    const fin = page.getByTestId('brief-fundamentals');
    await expect(fin.locator('.brief-q-axis')).toBeVisible();
    const rows = await sizes(page, '.brief-facts.is-fin .brief-fact small, .brief-facts.is-fin .brief-fact em');
    expect(rows).toHaveLength(6);
    expect(rows.filter(([, , size]) => size < 12)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
