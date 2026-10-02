import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { selectionSnapshot, compareSnapshots } from '../../src/static/candidateHistory.js';
import { summarizeWorkbench } from '../../src/static/workbenchSummary.js';

const date = '2026-09-29';
const rows = ['AMD', 'TSM', 'JPM'].map(symbol => withAuditFixture({ symbol, company_name: `Synthetic ${symbol}`, market: 'US', current_price: 102,
  se_pivot_price: 100, adv_usd: 5e7, rs_rating: 95, eps_rating: 92, composite_rating: 96, ibd_group_rank: 10, market_above_50dma: true, market_above_200dma: true }, date));
const previous = selectionSnapshot(rows.map(row => ({ ...row, rs_rating: 10 })), { as_of: '2026-09-28', rule_version: 'test' });
const hash = text => createHash('sha256').update(text).digest('hex');
function publication(mode) {
  const current = selectionSnapshot(rows, { as_of: date, rule_version: mode === 'all' ? 'new-rule' : 'test' });
  if (mode === 'partial') current.records[0].methods.minervini.state = 'unknown';
  const full = { as_of: date, snapshot_id: mode, history: { previous_as_of: previous.as_of }, changes: compareSnapshots(current, previous), sectors: { groups: [] } };
  const raw = JSON.stringify(full), fullRef = { path: `${mode}-workbench.json`, sha256: hash(raw), snapshot_id: mode };
  const summary = JSON.stringify(summarizeWorkbench(full, fullRef));
  return { raw, fullRef, summary, summaryRef: { path: `${mode}-summary.json`, sha256: hash(summary), snapshot_id: mode } };
}

for (const width of [1440, 390]) test(`daily comparison coverage keeps lazy details, focus and layout at ${width}px`, async ({ page }) => {
  let mode = 'comparable', fullRequests = 0;
  const errors = [], geometry = {};
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.route('**/static-data/**', route => {
    const file = new URL(route.request().url()).pathname.split('/').pop(), value = publication(mode);
    if (file === value.fullRef.path) { fullRequests++; return route.fulfill({ body: value.raw, contentType: 'application/json' }); }
    if (file === value.summaryRef.path) return route.fulfill({ body: value.summary, contentType: 'application/json' });
    const payload = file === 'manifest.json'
      ? { generated_at: `${date}T23:00:00Z`, as_of_date: date, default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: date,
        assets: { research: { path: 'research.json' }, workbench: value.fullRef, workbench_summary: value.summaryRef } } } }
      : file === 'research.json' ? { as_of_date: date, rows } : {};
    return route.fulfill({ json: payload });
  });
  for (mode of ['comparable', 'all', 'partial']) {
    fullRequests = 0;
    await page.goto('/');
    const label = mode === 'all' ? '変化：全3銘柄が比較不能' : mode === 'partial' ? '変化：比較不能 1 / 3銘柄' : '変化：新たに通過 3 · 再通過 0 · 脱落 0';
    await expect(page.locator('.changes-desktop')).toHaveText(label);
    await expect(page.getByTestId('home-hero').getByRole('heading', { level: 1 })).toHaveText('ミネルヴィニ選定候補は 3 銘柄。');
    expect(fullRequests).toBe(0);
    await page.evaluate(() => document.fonts.ready);
    const trigger = page.getByRole('button', { name: '候補の日次変化', exact: true });
    const bounds = await trigger.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(await trigger.evaluate(element => parseFloat(getComputedStyle(element).scrollMarginTop))).toBeGreaterThanOrEqual(64);
    geometry[mode] = { hero: (await page.getByTestId('home-hero').boundingBox()).height, header: (await page.locator('.leader-header').boundingBox()).height };
    if (width === 1440) expect(geometry[mode].hero).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '候補の日次変化' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('region', { name: '候補の日次変化' })).toBeVisible();
    expect(fullRequests).toBe(1);
    if (mode !== 'comparable') await expect(dialog.getByRole('alert')).toContainText(mode === 'all' ? '通過・脱落の変化は判定できません' : '比較できた2銘柄分');
    await dialog.getByText('変化の内訳を開く', { exact: true }).click();
    if (mode === 'all') {
      await expect(dialog.getByRole('button', { name: '比較不能 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await dialog.getByText('AMD · 比較不能', { exact: true }).click();
      await expect(dialog.getByText('ルール版・対象範囲の定義が異なるため比較できません。', { exact: true }).first()).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    expect(fullRequests).toBe(1);
    await dialog.getByRole('button', { name: '候補の変化を閉じる' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  for (const variant of ['all', 'partial']) {
    expect(geometry[variant].hero).toBeLessThanOrEqual(geometry.comparable.hero);
    expect(geometry[variant].header).toBe(geometry.comparable.header);
  }
  expect(errors).toEqual([]);
});
