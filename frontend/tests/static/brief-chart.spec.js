// Daily brief stock chart: the chart's periods, on synthetic data.
import { test, expect } from '@playwright/test';
import { date, openBrief, VIEWPORTS } from './brief-fixture.js';

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);
  const phone = name === 'phone';

  test('the weekly period shows the weekly chart', async ({ page }) => {
    const target = phone ? 'ZZNV' : 'ZZKS';
    const { errors } = await openBrief(page, `#/brief/stock/${target}`);
    const chart = page.getByTestId('brief-price-chart');
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '週足2年' }).click();
    await expect(chart).toHaveAttribute('aria-label', new RegExp(`^${target} の週足チャート（.*〜${date}）`));
    expect(errors).toEqual([]);
  });
});
