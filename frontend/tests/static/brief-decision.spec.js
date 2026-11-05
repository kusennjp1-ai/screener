// Daily brief buy decision: the stock's conclusion, on synthetic data.
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS } from './brief-fixture.js';

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);
  const phone = name === 'phone';

  test('a focus candidate at the pivot with 1.6× volume is a breakout in the buy zone', async ({ page }) => {
    // Reached as a trader reaches it: Today's focus row (on a wide screen the stock opens beside the list).
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    const target = phone ? 'ZZNV' : 'ZZKS';
    const row = focus.locator(`[data-symbol="${target}"]`);
    if (phone) await row.tap(); else await row.click();
    await expect(page).toHaveURL(new RegExp(`#/brief/stock/${target}$`));
    // The verdict: price at the pivot with 1.6× volume (synthetic audit) is a breakout in the buy zone.
    await expect(page.getByTestId('brief-conclusion')).toHaveClass(/tone-zone/);
    await expect(page.getByTestId('brief-conclusion')).toContainText('ピボットを出来高を伴って上抜け');
    expect(errors).toEqual([]);
  });
});
