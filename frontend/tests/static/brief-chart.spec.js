// Daily brief stock chart: the chart's periods, on synthetic data.
import { test, expect } from '@playwright/test';
import { date, openBrief, VIEWPORTS } from './brief-fixture.js';

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);
  const phone = name === 'phone';

  test('the weekly period shows the weekly chart', async ({ page }) => {
    // Reached from Today's focus row (on a wide screen the stock opens beside the list), after 3か月.
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    const target = phone ? 'ZZNV' : 'ZZKS';
    const row = focus.locator(`[data-symbol="${target}"]`);
    if (phone) await row.tap(); else await row.click();
    await expect(page).toHaveURL(new RegExp(`#/brief/stock/${target}$`));
    const chart = page.getByTestId('brief-price-chart');
    const periods = page.getByRole('group', { name: '表示期間' });
    await periods.getByRole('button', { name: '3か月' }).click();
    await expect(periods.getByRole('button', { name: '3か月' })).toHaveAttribute('aria-pressed', 'true');
    await periods.getByRole('button', { name: '週足2年' }).click();
    await expect(chart).toHaveAttribute('aria-label', new RegExp(`^${target} の週足チャート（.*〜${date}）`));
    expect(errors).toEqual([]);
  });
});
